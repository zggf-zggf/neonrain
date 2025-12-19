package huma

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	humaAPIURL = "https://api.humalike.tech"
	humaWSURL  = "wss://api.humalike.tech"
)

// ToolCallHandler is called when HUMA requests a tool execution
type ToolCallHandler func(toolCallID, toolName string, args map[string]interface{})

// Client manages connection to HUMA API
type Client struct {
	apiKey           string
	agentID          string
	conn             *websocket.Conn
	mu               sync.RWMutex
	writeMu          sync.Mutex // Protects websocket writes
	connected        bool
	namespaceReady   bool // True after "40" response received
	onToolCall       ToolCallHandler
	onCancelToolCall func(toolCallID, reason string)
	stopChan         chan struct{}
	doneChan         chan struct{}
	readyChan        chan struct{} // Signals namespace is ready
}

// NewClient creates a new HUMA client
func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:   apiKey,
		stopChan: make(chan struct{}),
		doneChan: make(chan struct{}),
	}
}

// CreateAgent creates a new HUMA agent via REST API
func (c *Client) CreateAgent(name string, metadata AgentMetadata) (*CreateAgentResponse, error) {
	reqBody := CreateAgentRequest{
		Name:      name,
		AgentType: "HUMA-0.1",
		Metadata:  metadata,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", humaAPIURL+"/api/agents", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var agentResp CreateAgentResponse
	if err := json.Unmarshal(body, &agentResp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	c.agentID = agentResp.ID
	log.Printf("[HUMA] Created agent: %s (ID: %s)", agentResp.Name, agentResp.ID)
	return &agentResp, nil
}

// Connect establishes WebSocket connection to HUMA
func (c *Client) Connect(agentID string) error {
	c.mu.Lock()

	if c.connected {
		c.mu.Unlock()
		return fmt.Errorf("already connected")
	}

	c.agentID = agentID

	// Build WebSocket URL with query params
	u, err := url.Parse(humaWSURL + "/socket.io/")
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("failed to parse URL: %w", err)
	}

	q := u.Query()
	q.Set("agentId", agentID)
	q.Set("apiKey", c.apiKey)
	q.Set("EIO", "4")
	q.Set("transport", "websocket")
	u.RawQuery = q.Encode()

	log.Printf("[HUMA] Connecting to WebSocket: %s", u.String())

	dialer := websocket.Dialer{
		HandshakeTimeout: 30 * time.Second,
	}

	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		c.mu.Unlock()
		return fmt.Errorf("failed to connect WebSocket: %w", err)
	}

	c.conn = conn
	c.connected = true
	c.namespaceReady = false
	c.stopChan = make(chan struct{})
	c.doneChan = make(chan struct{})
	c.readyChan = make(chan struct{})

	// Start message reader
	go c.readMessages()

	c.mu.Unlock()

	// Wait for namespace connection (with timeout)
	select {
	case <-c.readyChan:
		log.Printf("[HUMA] Connected to agent %s (namespace ready)", agentID)
	case <-time.After(10 * time.Second):
		c.Disconnect()
		return fmt.Errorf("timeout waiting for namespace connection")
	}

	return nil
}

// Disconnect closes the WebSocket connection
func (c *Client) Disconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected {
		return
	}

	close(c.stopChan)
	<-c.doneChan

	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}

	c.connected = false
	log.Printf("[HUMA] Disconnected from agent %s", c.agentID)
}

// IsConnected returns whether the client is connected
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// writeMessage safely writes a message to the websocket
func (c *Client) writeMessage(data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

// SetToolCallHandler sets the callback for tool call events
func (c *Client) SetToolCallHandler(handler ToolCallHandler) {
	c.onToolCall = handler
}

// SetCancelToolCallHandler sets the callback for cancel tool call events
func (c *Client) SetCancelToolCallHandler(handler func(toolCallID, reason string)) {
	c.onCancelToolCall = handler
}

// SendContextUpdate sends a context update event to HUMA
func (c *Client) SendContextUpdate(eventName, description string, context map[string]interface{}) error {
	c.mu.RLock()
	if !c.connected || c.conn == nil || !c.namespaceReady {
		c.mu.RUnlock()
		return fmt.Errorf("not connected or namespace not ready")
	}
	c.mu.RUnlock()

	event := HumaEvent{
		Type: "huma-0.1-event",
		Content: ContextUpdateContent{
			Name:        eventName,
			Context:     context,
			Description: description,
		},
	}

	// Socket.IO message format: "42" prefix for event messages
	jsonData, err := json.Marshal([]interface{}{"message", event})
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	message := "42" + string(jsonData)
	log.Printf("[HUMA] Sending context update: %s", eventName)

	if err := c.writeMessage([]byte(message)); err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	return nil
}

// SendToolResult sends a tool result back to HUMA
func (c *Client) SendToolResult(toolCallID string, success bool, result interface{}, errMsg string) error {
	c.mu.RLock()
	if !c.connected || c.conn == nil {
		c.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	c.mu.RUnlock()

	content := ToolResultContent{
		Type:       "tool-result",
		ToolCallID: toolCallID,
		Status:     "completed",
		Success:    success,
	}

	if success {
		content.Result = result
	} else {
		content.Error = errMsg
	}

	event := HumaEvent{
		Type:    "huma-0.1-event",
		Content: content,
	}

	jsonData, err := json.Marshal([]interface{}{"message", event})
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	message := "42" + string(jsonData)
	log.Printf("[HUMA] Sending tool result for %s (success: %v)", toolCallID, success)

	if err := c.writeMessage([]byte(message)); err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	return nil
}

// SendToolCanceled sends a canceled tool result to HUMA
func (c *Client) SendToolCanceled(toolCallID, reason string) error {
	c.mu.RLock()
	if !c.connected || c.conn == nil {
		c.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	c.mu.RUnlock()

	content := ToolResultContent{
		Type:       "tool-result",
		ToolCallID: toolCallID,
		Status:     "canceled",
		Success:    false,
		Error:      reason,
	}

	event := HumaEvent{
		Type:    "huma-0.1-event",
		Content: content,
	}

	jsonData, err := json.Marshal([]interface{}{"message", event})
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	message := "42" + string(jsonData)
	log.Printf("[HUMA] Sending tool canceled for %s: %s", toolCallID, reason)

	if err := c.writeMessage([]byte(message)); err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	return nil
}

// readMessages reads incoming WebSocket messages
func (c *Client) readMessages() {
	defer close(c.doneChan)

	for {
		select {
		case <-c.stopChan:
			return
		default:
			c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			_, message, err := c.conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					log.Printf("[HUMA] WebSocket closed normally")
					return
				}
				log.Printf("[HUMA] Error reading message: %v", err)
				return
			}

			c.handleMessage(message)
		}
	}
}

// handleMessage processes incoming WebSocket messages
func (c *Client) handleMessage(message []byte) {
	msgStr := string(message)

	// Handle Socket.IO protocol messages
	if len(msgStr) == 0 {
		return
	}

	// Socket.IO Engine.IO message types:
	// 0 - OPEN (server sends session info)
	// 1 - CLOSE
	// 2 - PING
	// 3 - PONG
	// 4 - MESSAGE (Socket.IO packet)
	//
	// Socket.IO packet types (after "4"):
	// 0 - CONNECT
	// 1 - DISCONNECT
	// 2 - EVENT
	// 3 - ACK
	// 4 - ERROR
	//
	// So "40" = MESSAGE + CONNECT (connect to namespace)
	// And "42" = MESSAGE + EVENT (event message)

	switch {
	case msgStr == "2":
		// Engine.IO Ping - respond with pong
		c.writeMessage([]byte("3"))
		return

	case msgStr[0] == '0':
		// Engine.IO OPEN - server sent session info
		// We need to send "40" to connect to the default namespace
		log.Printf("[HUMA] Socket.IO handshake received, connecting to namespace...")
		if err := c.writeMessage([]byte("40")); err != nil {
			log.Printf("[HUMA] Error sending namespace connect: %v", err)
		}
		return

	case len(msgStr) >= 2 && msgStr[:2] == "40":
		// Socket.IO CONNECT response - connected to namespace
		log.Printf("[HUMA] Connected to Socket.IO namespace")
		c.mu.Lock()
		c.namespaceReady = true
		// Signal that namespace is ready
		select {
		case <-c.readyChan:
			// Already closed
		default:
			close(c.readyChan)
		}
		c.mu.Unlock()
		return

	case len(msgStr) >= 2 && msgStr[:2] == "41":
		// Socket.IO DISCONNECT
		log.Printf("[HUMA] Disconnected from Socket.IO namespace")
		return

	case len(msgStr) >= 2 && msgStr[:2] == "42":
		// Socket.IO EVENT message
		c.handleEventMessage(msgStr[2:])
		return

	case len(msgStr) >= 2 && msgStr[:2] == "44":
		// Socket.IO ERROR
		log.Printf("[HUMA] Socket.IO error: %s", msgStr[2:])
		return

	default:
		log.Printf("[HUMA] Unknown message: %s", msgStr[:min(100, len(msgStr))])
	}
}

// handleEventMessage processes Socket.IO event messages
func (c *Client) handleEventMessage(jsonStr string) {
	var eventData []json.RawMessage
	if err := json.Unmarshal([]byte(jsonStr), &eventData); err != nil {
		log.Printf("[HUMA] Failed to parse event: %v", err)
		return
	}

	if len(eventData) < 2 {
		return
	}

	var eventName string
	if err := json.Unmarshal(eventData[0], &eventName); err != nil {
		return
	}

	if eventName != "event" {
		return
	}

	var serverEvent ServerEvent
	if err := json.Unmarshal(eventData[1], &serverEvent); err != nil {
		log.Printf("[HUMA] Failed to parse server event: %v", err)
		return
	}

	switch serverEvent.Type {
	case "status":
		log.Printf("[HUMA] Agent status: %s", serverEvent.Status)

	case "tool-call":
		log.Printf("[HUMA] Tool call received: %s (ID: %s)", serverEvent.ToolName, serverEvent.ToolCallID)
		if c.onToolCall != nil {
			c.onToolCall(serverEvent.ToolCallID, serverEvent.ToolName, serverEvent.Arguments)
		}

	case "cancel-tool-call":
		log.Printf("[HUMA] Tool call canceled: %s (reason: %s)", serverEvent.ToolCallID, serverEvent.Reason)
		if c.onCancelToolCall != nil {
			c.onCancelToolCall(serverEvent.ToolCallID, serverEvent.Reason)
		}

	case "error":
		log.Printf("[HUMA] Error from server: %s (code: %s)", serverEvent.Message, serverEvent.Code)

	default:
		log.Printf("[HUMA] Unknown event type: %s", serverEvent.Type)
	}
}

// GetAgentID returns the current agent ID
func (c *Client) GetAgentID() string {
	return c.agentID
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
