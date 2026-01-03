package huma

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/mjacniacki/neonrain/discord-user-client/internal/history"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// MonitoredChannel represents a channel the bot monitors
type MonitoredChannel struct {
	ID   string
	Name string
}

// ChannelInfo represents a Discord channel with its details
type ChannelInfo struct {
	ID   string
	Name string
	Type string // "text", "voice", "category", etc.
}

// MessageSender interface for sending Discord messages
type MessageSender interface {
	SendMessage(channelID, content string) error
	SendTypingIndicator(channelID string) error
	GetBotUsername() string
	GetMonitoredChannelsForGuild(guildID string) []MonitoredChannel
	GetAllChannelsForGuild(guildID string) []ChannelInfo
	FetchChannelMessages(channelID string, limit int) ([]history.Message, error)
}

// GuildAgent represents a HUMA agent for a specific guild
type GuildAgent struct {
	GuildID     string
	GuildName   string
	Client      *Client
	AgentID     string
	sender      MessageSender
	history     *history.MessageHistoryManager

	// Agent configuration
	personality string
	rules       string
	information string
	websites    []types.WebsiteData

	// Message queue for typing simulation
	pendingMessage    *PendingMessage
	pendingMu         sync.Mutex
	cancelChan        chan struct{}
}

// PendingMessage represents a message being typed
type PendingMessage struct {
	ToolCallID string
	ChannelID  string
	Message    string
	StartTime  time.Time
}

// Manager manages HUMA agents for multiple guilds
type Manager struct {
	apiKey      string
	agents      map[string]*GuildAgent // guildID -> agent
	mu          sync.RWMutex
	sender      MessageSender
	history     *history.MessageHistoryManager
	personality string
	rules       string
	information string
	websites    []types.WebsiteData
}

// NewManager creates a new HUMA manager
func NewManager(apiKey string) *Manager {
	return &Manager{
		apiKey: apiKey,
		agents: make(map[string]*GuildAgent),
	}
}

// SetMessageSender sets the message sender (Discord client)
func (m *Manager) SetMessageSender(sender MessageSender) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sender = sender
}

// SetHistoryManager sets the history manager
func (m *Manager) SetHistoryManager(history *history.MessageHistoryManager) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.history = history
}

// SetConfig sets the agent configuration (personality, rules, information)
func (m *Manager) SetConfig(personality, rules, information string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.personality = personality
	m.rules = rules
	m.information = information
}

// SetWebsites sets the websites for context
func (m *Manager) SetWebsites(websites []types.WebsiteData) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.websites = websites
}

// RemoveAgent removes an agent (called when connection is dead)
func (m *Manager) RemoveAgent(guildID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if agent, exists := m.agents[guildID]; exists {
		log.Printf("[HUMA-Manager] Removing dead agent for guild %s", guildID)
		agent.Client.Disconnect()
		delete(m.agents, guildID)
	}
}

// GetOrCreateAgent gets an existing agent for a guild or creates a new one
func (m *Manager) GetOrCreateAgent(guildID, guildName string) (*GuildAgent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if agent, exists := m.agents[guildID]; exists {
		return agent, nil
	}

	// Create new HUMA client for this guild
	client := NewClient(m.apiKey)

	// Build agent metadata
	metadata := m.buildAgentMetadata(guildName)

	// Create agent via REST API
	agentResp, err := client.CreateAgent(fmt.Sprintf("Discord-%s", guildName), metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Connect via WebSocket
	if err := client.Connect(agentResp.ID); err != nil {
		return nil, fmt.Errorf("failed to connect to agent: %w", err)
	}

	agent := &GuildAgent{
		GuildID:     guildID,
		GuildName:   guildName,
		Client:      client,
		AgentID:     agentResp.ID,
		sender:      m.sender,
		history:     m.history,
		personality: m.personality,
		rules:       m.rules,
		information: m.information,
		websites:    m.websites,
		cancelChan:  make(chan struct{}),
	}

	// Set up tool call handlers
	client.SetToolCallHandler(func(toolCallID, toolName string, args map[string]interface{}) {
		agent.handleToolCall(toolCallID, toolName, args)
	})

	client.SetCancelToolCallHandler(func(toolCallID, reason string) {
		agent.handleCancelToolCall(toolCallID, reason)
	})

	m.agents[guildID] = agent
	log.Printf("[HUMA-Manager] Created agent for guild %s (%s)", guildName, guildID)

	return agent, nil
}

// GetAgent returns an agent for a guild if it exists
func (m *Manager) GetAgent(guildID string) *GuildAgent {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.agents[guildID]
}

// DisconnectAll disconnects all agents
func (m *Manager) DisconnectAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for guildID, agent := range m.agents {
		log.Printf("[HUMA-Manager] Disconnecting agent for guild %s", guildID)
		agent.Client.Disconnect()
	}

	m.agents = make(map[string]*GuildAgent)
}

// buildAgentMetadata builds the HUMA agent metadata
func (m *Manager) buildAgentMetadata(guildName string) AgentMetadata {
	botName := "Bot"
	if m.sender != nil {
		botName = m.sender.GetBotUsername()
	}

	// Build personality section
	personality := fmt.Sprintf(`## Core Traits
Helpful, knowledgeable, friendly, and engaging. Responds naturally to conversations.

## Background
%s is an AI assistant participating in the Discord server "%s". They are helpful, patient, and always try to provide clear answers.

## Speech Patterns
- Uses clear, concise language
- Engages naturally in conversations
- References previous messages when relevant
- Admits when they don't know something
- Maintains a friendly, approachable tone

## Current Mood
Attentive and ready to help

## Motivation
To assist community members and contribute positively to conversations`, botName, guildName)

	// Add user's custom personality
	if m.personality != "" {
		personality += "\n\n## Custom Personality\n" + m.personality
	}

	instructions := fmt.Sprintf(`## Your Role
You are %s, participating in Discord conversations in the server "%s". Monitor conversations and respond when appropriate.

## Understanding Context

IMPORTANT: When you receive a new-message event, you will see:
- "newMessage": The message that was just sent (author and content)
- "currentChannel": The channel where the message was sent, including:
  - "id": Channel ID
  - "name": Channel name (e.g., "general")
  - "conversationHistory": Full history of the last 50 messages in format "[timestamp] author: message"
- "monitoredChannels": Array of ALL channels you have access to in this server, each with:
  - "id": Channel ID
  - "name": Channel name
  - "recentMessages": (optional) Last 5 messages from that channel if you've seen activity there

ALWAYS read the currentChannel.conversationHistory to understand what was discussed before responding.
You can also check monitoredChannels to see what channels exist and any recent activity in other channels.

## Rules

### MUST:
- READ the currentChannel.conversationHistory before responding to understand context
- Respond naturally to direct questions or mentions
- Be helpful and provide accurate information
- Reference previous messages when users ask about them
- Keep responses concise and on-topic

### MUST NOT:
- Claim you "can't see" or "don't have access to" previous messages (you DO have them in conversationHistory)
- Spam messages or respond to every single message
- Share harmful, illegal, or inappropriate content
- Pretend to be a human when directly asked
- Respond to your own messages
- Dominate conversations or talk too much - let humans lead
- Send multiple messages in a row without human responses in between
- Respond unless directly addressed, asked a question, or genuinely needed
- "Talk to yourself" by continuing conversations where no humans have replied

### SHOULD:
- Wait for natural conversation moments before responding
- Add value to discussions rather than just acknowledging
- Use appropriate tone for the conversation context
- Consider if a response is actually needed - when in doubt, stay silent
- Be aware of activity in other channels you monitor
- Keep responses SHORT and concise - prefer 1-2 sentences over long paragraphs
- Stay quiet most of the time - only respond when directly needed
- Let conversations flow naturally without constant interjection
- Prefer NOT responding over responding unnecessarily

## Tool Usage Guidelines

### send_message
- Use to send a message to a Discord channel
- Only send when you have something meaningful to contribute
- Keep messages natural, conversational, and SHORT
- channel_id: ALWAYS use currentChannel.id - respond in the same channel where the user messaged you
- message: Your message content (no username prefix needed)
- IMPORTANT: Never respond in a different channel than where the user asked you
- IMPORTANT: Do NOT use this tool unless you are directly addressed or have valuable input
- IMPORTANT: If you just sent a message, do NOT send another until a human responds

### fetch_channel_messages
- Use to READ conversation history from other channels (not to respond there!)
- channel_id: Use an ID from the "allChannels" list in context
- limit: Optional, number of messages to fetch (1-100, default 50)
- Returns messages in chronological order as "[timestamp] author: message"
- Use this when someone asks about conversations in other channels
- After fetching, respond in the CURRENT channel (where the user asked), not the fetched channel

## Information Visibility
You CAN see:
- The new message that was just sent (newMessage field)
- Full conversation history of current channel (currentChannel.conversationHistory - READ THIS)
- List of ALL channels in the server (allChannels array with id, name, and type)
- Recent messages from monitored channels (in monitoredChannels[].recentMessages)
- Guild/server name
- Important websites content (importantWebsites array, if provided)

You CAN fetch on demand:
- Full message history from any text channel using fetch_channel_messages tool

You CANNOT see:
- Private/DM conversations
- User's private information

## Important Websites
If the "importantWebsites" field is present in the context, it contains scraped content from websites
the server owner marked as important. Use this information to:
- Answer questions about the server's topic, products, or community
- Reference documentation or changelogs when relevant
- Provide accurate information based on the scraped content
Each website includes: name, url, scrapedAt (when it was last updated), and content (the markdown)

## Dynamic Configuration
The context may include these fields that can be updated live by the server owner:
- "customRules": Additional rules you MUST follow (takes priority over base rules)
- "customPersonality": Additional personality traits to embody
- "userInformation": Custom information about the server/community
Always check these fields and follow any instructions in customRules strictly.`, botName, guildName)

	// Add user's custom rules to instructions
	if m.rules != "" {
		instructions += "\n\n## Custom Rules\n" + m.rules
	}

	tools := []ToolDefinition{
		{
			Name:        "send_message",
			Description: "Send a message to a Discord channel. Use this to respond to conversations, answer questions, or contribute to discussions. Only send when you have something meaningful to say.",
			Parameters: []ToolParameter{
				{
					Name:        "channel_id",
					Type:        "string",
					Description: "The Discord channel ID to send the message to",
					Required:    true,
				},
				{
					Name:        "message",
					Type:        "string",
					Description: "The message content to send",
					Required:    true,
				},
			},
		},
		{
			Name:        "fetch_channel_messages",
			Description: "Fetch recent messages from any text channel in the server. Use this to read conversation history from channels other than the current one. Returns up to 50 messages.",
			Parameters: []ToolParameter{
				{
					Name:        "channel_id",
					Type:        "string",
					Description: "The Discord channel ID to fetch messages from. Use IDs from the 'allChannels' list in context.",
					Required:    true,
				},
				{
					Name:        "limit",
					Type:        "number",
					Description: "Number of messages to fetch (1-100, default 50)",
					Required:    false,
				},
			},
		},
	}

	return AgentMetadata{
		ClassName:    botName,
		Personality:  personality,
		Instructions: instructions,
		Tools:        tools,
		RouterType:   "conversational", // Good for chat applications
	}
}

// SendNewMessage sends a new message event to HUMA
func (a *GuildAgent) SendNewMessage(channelID, channelName, authorID, authorName, content, messageID string) error {
	// Build context with current state
	context := a.buildContext(channelID, channelName, authorName, content)

	description := fmt.Sprintf("User %s sent a new message in channel #%s: \"%s\". Review the conversationHistory field to see the full conversation context before responding.",
		authorName, channelName, truncateString(content, 100))

	return a.Client.SendContextUpdate("new-message", description, context)
}

// buildContext builds the context object for HUMA
func (a *GuildAgent) buildContext(currentChannelID, currentChannelName, lastAuthor, lastMessage string) map[string]interface{} {
	botName := "Bot"
	if a.sender != nil {
		botName = a.sender.GetBotUsername()
	}

	// Build current channel's conversation history (last 50 messages)
	var currentChannelHistory string
	if a.history != nil {
		messages := a.history.GetMessages(currentChannelID)
		for _, msg := range messages {
			currentChannelHistory += fmt.Sprintf("[%s] %s: %s\n", msg.Timestamp, msg.Author, msg.Content)
		}
	}

	// Build list of all monitored channels with their recent history
	var monitoredChannels []map[string]interface{}
	if a.sender != nil {
		channels := a.sender.GetMonitoredChannelsForGuild(a.GuildID)
		for _, ch := range channels {
			channelInfo := map[string]interface{}{
				"id":   ch.ID,
				"name": ch.Name,
			}

			// For non-current channels, include last 5 messages
			if ch.ID != currentChannelID && a.history != nil {
				messages := a.history.GetMessages(ch.ID)
				var recentHistory string
				startIdx := 0
				if len(messages) > 5 {
					startIdx = len(messages) - 5
				}
				for i := startIdx; i < len(messages); i++ {
					msg := messages[i]
					recentHistory += fmt.Sprintf("[%s] %s: %s\n", msg.Timestamp, msg.Author, msg.Content)
				}
				if recentHistory != "" {
					channelInfo["recentMessages"] = recentHistory
				}
			}

			monitoredChannels = append(monitoredChannels, channelInfo)
		}
	}

	// Build list of ALL channels in the guild (for fetch_channel_messages tool)
	var allChannels []map[string]interface{}
	if a.sender != nil {
		channels := a.sender.GetAllChannelsForGuild(a.GuildID)
		for _, ch := range channels {
			allChannels = append(allChannels, map[string]interface{}{
				"id":   ch.ID,
				"name": ch.Name,
				"type": ch.Type,
			})
		}
	}

	context := map[string]interface{}{
		"guild": map[string]interface{}{
			"id":   a.GuildID,
			"name": a.GuildName,
		},
		"you": map[string]interface{}{
			"name": botName,
		},
		"currentChannel": map[string]interface{}{
			"id":                  currentChannelID,
			"name":                currentChannelName,
			"conversationHistory": currentChannelHistory,
		},
		"newMessage": map[string]interface{}{
			"author":  lastAuthor,
			"content": lastMessage,
		},
		// List of all channels the bot monitors in this guild (with recent messages)
		"monitoredChannels": monitoredChannels,
		// List of ALL channels in the guild (for fetch_channel_messages tool)
		"allChannels": allChannels,
	}

	// Add user-provided information to context (dynamic context data)
	if a.information != "" {
		context["userInformation"] = a.information
	}

	// Add custom rules to context (can be updated live)
	if a.rules != "" {
		context["customRules"] = a.rules
	}

	// Add custom personality to context (can be updated live)
	if a.personality != "" {
		context["customPersonality"] = a.personality
	}

	// Add important websites to context
	if len(a.websites) > 0 {
		var websiteContexts []map[string]interface{}
		for _, w := range a.websites {
			websiteContexts = append(websiteContexts, map[string]interface{}{
				"name":      w.Name,
				"url":       w.URL,
				"scrapedAt": w.ScrapedAt,
				"content":   w.Markdown,
			})
		}
		context["importantWebsites"] = websiteContexts
	}

	return context
}

// handleToolCall handles tool calls from HUMA
func (a *GuildAgent) handleToolCall(toolCallID, toolName string, args map[string]interface{}) {
	switch toolName {
	case "send_message":
		a.handleSendMessage(toolCallID, args)
	case "fetch_channel_messages":
		a.handleFetchChannelMessages(toolCallID, args)
	default:
		log.Printf("[HUMA-Agent] Unknown tool: %s", toolName)
		a.Client.SendToolResult(toolCallID, false, nil, fmt.Sprintf("Unknown tool: %s", toolName))
	}
}

// handleSendMessage handles the send_message tool call
func (a *GuildAgent) handleSendMessage(toolCallID string, args map[string]interface{}) {
	// Parse arguments
	channelID, ok := args["channel_id"].(string)
	if !ok {
		a.Client.SendToolResult(toolCallID, false, nil, "Missing or invalid channel_id")
		return
	}

	message, ok := args["message"].(string)
	if !ok {
		a.Client.SendToolResult(toolCallID, false, nil, "Missing or invalid message")
		return
	}

	log.Printf("[HUMA-Agent] send_message called: channel=%s, message=%s", channelID, truncateString(message, 50))

	a.pendingMu.Lock()

	// If there's already a pending message, cancel it
	if a.pendingMessage != nil {
		log.Printf("[HUMA-Agent] Canceling previous pending message (ID: %s)", a.pendingMessage.ToolCallID)

		// Send canceled result for previous message
		go a.Client.SendToolCanceled(a.pendingMessage.ToolCallID, "Superseded by newer message")

		// Signal cancellation
		select {
		case a.cancelChan <- struct{}{}:
		default:
		}

		// Create new cancel channel
		a.cancelChan = make(chan struct{})
	}

	// Set new pending message
	a.pendingMessage = &PendingMessage{
		ToolCallID: toolCallID,
		ChannelID:  channelID,
		Message:    message,
		StartTime:  time.Now(),
	}

	cancelChan := a.cancelChan
	a.pendingMu.Unlock()

	// Process message with typing simulation in goroutine
	go a.processMessageWithTyping(toolCallID, channelID, message, cancelChan)
}

// handleFetchChannelMessages handles the fetch_channel_messages tool call
func (a *GuildAgent) handleFetchChannelMessages(toolCallID string, args map[string]interface{}) {
	// Parse channel_id
	channelID, ok := args["channel_id"].(string)
	if !ok {
		a.Client.SendToolResult(toolCallID, false, nil, "Missing or invalid channel_id")
		return
	}

	// Parse limit (optional, default 50)
	limit := 50
	if limitVal, ok := args["limit"].(float64); ok {
		limit = int(limitVal)
	}

	log.Printf("[HUMA-Agent] fetch_channel_messages called: channel=%s, limit=%d", channelID, limit)

	if a.sender == nil {
		a.Client.SendToolResult(toolCallID, false, nil, "No message sender available")
		return
	}

	// Fetch messages from Discord
	messages, err := a.sender.FetchChannelMessages(channelID, limit)
	if err != nil {
		log.Printf("[HUMA-Agent] Error fetching messages: %v", err)
		a.Client.SendToolResult(toolCallID, false, nil, fmt.Sprintf("Failed to fetch messages: %v", err))
		return
	}

	// Format messages as readable text
	var result string
	if len(messages) == 0 {
		result = "No messages found in this channel."
	} else {
		for _, msg := range messages {
			result += fmt.Sprintf("[%s] %s: %s\n", msg.Timestamp, msg.Author, msg.Content)
		}
	}

	log.Printf("[HUMA-Agent] Fetched %d messages from channel %s", len(messages), channelID)
	a.Client.SendToolResult(toolCallID, true, result, "")
}

// processMessageWithTyping sends a message with typing simulation
func (a *GuildAgent) processMessageWithTyping(toolCallID, channelID, message string, cancelChan chan struct{}) {
	if a.sender == nil {
		a.Client.SendToolResult(toolCallID, false, nil, "No message sender available")
		return
	}

	// Calculate typing delay for 90 WPM
	delay := calculateTypingDelay(message)
	log.Printf("[HUMA-Agent] Simulating typing for %v at 90 WPM", delay)

	// Start typing indicator
	if err := a.sender.SendTypingIndicator(channelID); err != nil {
		log.Printf("[HUMA-Agent] Error sending typing indicator: %v", err)
	}

	// Typing indicator loop
	typingTicker := time.NewTicker(8 * time.Second)
	defer typingTicker.Stop()

	// Wait for typing delay or cancellation
	delayTimer := time.NewTimer(delay)
	defer delayTimer.Stop()

	for {
		select {
		case <-cancelChan:
			log.Printf("[HUMA-Agent] Message sending canceled (ID: %s)", toolCallID)
			return

		case <-delayTimer.C:
			// Delay complete, send message
			a.pendingMu.Lock()
			// Double-check this is still the current pending message
			if a.pendingMessage == nil || a.pendingMessage.ToolCallID != toolCallID {
				a.pendingMu.Unlock()
				log.Printf("[HUMA-Agent] Message no longer pending, skipping (ID: %s)", toolCallID)
				return
			}
			a.pendingMessage = nil
			a.pendingMu.Unlock()

			// Send the message
			if err := a.sender.SendMessage(channelID, message); err != nil {
				log.Printf("[HUMA-Agent] Error sending message: %v", err)
				a.Client.SendToolResult(toolCallID, false, nil, fmt.Sprintf("Failed to send message: %v", err))
				return
			}

			log.Printf("[HUMA-Agent] Message sent successfully (ID: %s)", toolCallID)

			// Build updated conversation history including the new bot message
			updatedHistory := a.buildUpdatedConversationHistory(channelID, message)
			extraContext := map[string]interface{}{
				"conversationHistory": updatedHistory,
			}

			a.Client.SendToolResultWithContext(toolCallID, true, "Message sent successfully", "", extraContext)
			return

		case <-typingTicker.C:
			// Refresh typing indicator
			if err := a.sender.SendTypingIndicator(channelID); err != nil {
				log.Printf("[HUMA-Agent] Error refreshing typing indicator: %v", err)
			}
		}
	}
}

// handleCancelToolCall handles tool cancellation from HUMA
func (a *GuildAgent) handleCancelToolCall(toolCallID, reason string) {
	a.pendingMu.Lock()
	defer a.pendingMu.Unlock()

	if a.pendingMessage != nil && a.pendingMessage.ToolCallID == toolCallID {
		log.Printf("[HUMA-Agent] Canceling tool call %s: %s", toolCallID, reason)

		// Signal cancellation
		select {
		case a.cancelChan <- struct{}{}:
		default:
		}

		a.pendingMessage = nil
		a.cancelChan = make(chan struct{})

		// Send canceled result
		a.Client.SendToolCanceled(toolCallID, reason)
	}
}

// buildUpdatedConversationHistory builds the conversation history string including a new bot message
func (a *GuildAgent) buildUpdatedConversationHistory(channelID, newBotMessage string) string {
	botName := "Bot"
	if a.sender != nil {
		botName = a.sender.GetBotUsername()
	}

	// Get current history
	var historyStr string
	if a.history != nil {
		messages := a.history.GetMessages(channelID)
		for _, msg := range messages {
			historyStr += fmt.Sprintf("[%s] %s: %s\n", msg.Timestamp, msg.Author, msg.Content)
		}
	}

	// Add the new bot message
	now := time.Now().Format(time.RFC3339)
	historyStr += fmt.Sprintf("[%s] %s: %s\n", now, botName, newBotMessage)

	return historyStr
}

// UpdateConfig updates the agent configuration
func (a *GuildAgent) UpdateConfig(sender MessageSender, history *history.MessageHistoryManager, personality, rules, information string, websites []types.WebsiteData) {
	a.sender = sender
	a.history = history
	a.personality = personality
	a.rules = rules
	a.information = information
	a.websites = websites
}

// calculateTypingDelay calculates delay for 90 WPM typing speed
func calculateTypingDelay(text string) time.Duration {
	const targetWPM = 90.0
	const secondsPerMinute = 60.0

	// Count words
	wordCount := 0
	inWord := false
	for _, r := range text {
		if r == ' ' || r == '\n' || r == '\t' {
			inWord = false
		} else if !inWord {
			inWord = true
			wordCount++
		}
	}

	if wordCount == 0 {
		return 500 * time.Millisecond // Minimum delay
	}

	// Calculate delay
	seconds := (float64(wordCount) / targetWPM) * secondsPerMinute
	delay := time.Duration(seconds * float64(time.Second))

	// Minimum 500ms, maximum 30s
	if delay < 500*time.Millisecond {
		delay = 500 * time.Millisecond
	}
	if delay > 30*time.Second {
		delay = 30 * time.Second
	}

	return delay
}

// truncateString truncates a string to maxLen characters
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// MarshalContext marshals context to JSON for debugging
func MarshalContext(ctx map[string]interface{}) string {
	data, err := json.MarshalIndent(ctx, "", "  ")
	if err != nil {
		return fmt.Sprintf("error: %v", err)
	}
	return string(data)
}
