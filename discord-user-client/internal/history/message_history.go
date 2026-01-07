package history

import (
	"fmt"
	"log"
	"sync"

	"github.com/bwmarrin/discordgo"
)

// SessionInterface defines the Discord session methods needed for history management
type SessionInterface interface {
	ChannelMessages(channelID string, limit int, beforeID, afterID, aroundID string, options ...discordgo.RequestOption) ([]*discordgo.Message, error)
}

// Message represents a stored message with relevant metadata
type Message struct {
	ID        string
	ChannelID string
	Author    string // Username for display
	AuthorID  string // User ID
	Content   string
	Timestamp string
}

// ChannelHistory stores message history for a single channel
type ChannelHistory struct {
	ChannelID    string
	Messages     []Message
	Initialized  bool
	MaxMessages  int
	mu           sync.RWMutex
}

// MessageHistoryManager manages message history for multiple channels
type MessageHistoryManager struct {
	channels map[string]*ChannelHistory
	mu       sync.RWMutex
}

// NewMessageHistoryManager creates a new message history manager
func NewMessageHistoryManager() *MessageHistoryManager {
	return &MessageHistoryManager{
		channels: make(map[string]*ChannelHistory),
	}
}

// GetOrCreateChannel gets existing channel history or creates a new one
func (m *MessageHistoryManager) GetOrCreateChannel(channelID string) *ChannelHistory {
	m.mu.Lock()
	defer m.mu.Unlock()

	if ch, exists := m.channels[channelID]; exists {
		return ch
	}

	ch := &ChannelHistory{
		ChannelID:   channelID,
		Messages:    make([]Message, 0, 50),
		Initialized: false,
		MaxMessages: 50,
	}
	m.channels[channelID] = ch
	return ch
}

// IsChannelInitialized checks if a channel's history has been initialized
func (m *MessageHistoryManager) IsChannelInitialized(channelID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if ch, exists := m.channels[channelID]; exists {
		ch.mu.RLock()
		defer ch.mu.RUnlock()
		return ch.Initialized
	}
	return false
}

// InitializeChannel fetches the last N messages from Discord and initializes the channel
func (m *MessageHistoryManager) InitializeChannel(session SessionInterface, channelID string, limit int) error {
	ch := m.GetOrCreateChannel(channelID)

	ch.mu.Lock()
	defer ch.mu.Unlock()

	if ch.Initialized {
		log.Printf("[HISTORY] Channel %s already initialized", channelID)
		return nil
	}

	log.Printf("[HISTORY] Initializing channel %s, fetching last %d messages", channelID, limit)

	// Fetch messages from Discord
	messages, err := session.ChannelMessages(channelID, limit, "", "", "")
	if err != nil {
		return fmt.Errorf("failed to fetch messages for channel %s: %w", channelID, err)
	}

	// Messages come in reverse order (newest first), so reverse them
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		ch.Messages = append(ch.Messages, Message{
			ID:        msg.ID,
			ChannelID: msg.ChannelID,
			Author:    msg.Author.Username,
			AuthorID:  msg.Author.ID,
			Content:   msg.Content,
			Timestamp: msg.Timestamp.Format("2006-01-02 15:04:05"),
		})
	}

	ch.Initialized = true
	log.Printf("[HISTORY] Channel %s initialized with %d messages", channelID, len(ch.Messages))
	return nil
}

// AddMessage adds a new message to the channel history
func (m *MessageHistoryManager) AddMessage(msg *discordgo.MessageCreate) {
	ch := m.GetOrCreateChannel(msg.ChannelID)

	ch.mu.Lock()
	defer ch.mu.Unlock()

	// Check if message already exists (can happen when InitializeChannel fetches
	// recent messages that include the message that triggered the event)
	for _, existing := range ch.Messages {
		if existing.ID == msg.ID {
			return // Already have this message
		}
	}

	newMsg := Message{
		ID:        msg.ID,
		ChannelID: msg.ChannelID,
		Author:    msg.Author.Username,
		AuthorID:  msg.Author.ID,
		Content:   msg.Content,
		Timestamp: msg.Timestamp.Format("2006-01-02 15:04:05"),
	}

	// Add to history
	ch.Messages = append(ch.Messages, newMsg)

	// Keep only last MaxMessages
	if len(ch.Messages) > ch.MaxMessages {
		ch.Messages = ch.Messages[len(ch.Messages)-ch.MaxMessages:]
	}

	log.Printf("[HISTORY] Added message to %s (total: %d)", msg.ChannelID, len(ch.Messages))
}

// GetMessages returns a copy of messages for a channel
func (m *MessageHistoryManager) GetMessages(channelID string) []Message {
	m.mu.RLock()
	ch, exists := m.channels[channelID]
	m.mu.RUnlock()

	if !exists {
		return []Message{}
	}

	ch.mu.RLock()
	defer ch.mu.RUnlock()

	// Return a copy to avoid race conditions
	messages := make([]Message, len(ch.Messages))
	copy(messages, ch.Messages)
	return messages
}

// FormatConversation formats the conversation history for AI prompting (third-person)
func (m *MessageHistoryManager) FormatConversation(channelID string, botUsername string) string {
	messages := m.GetMessages(channelID)

	if len(messages) == 0 {
		return ""
	}

	var formatted string
	for _, msg := range messages {
		formatted += fmt.Sprintf("%s: %s\n", msg.Author, msg.Content)
	}

	return formatted
}

// GetChannelStats returns statistics about a channel's history
func (m *MessageHistoryManager) GetChannelStats(channelID string) (initialized bool, messageCount int) {
	m.mu.RLock()
	ch, exists := m.channels[channelID]
	m.mu.RUnlock()

	if !exists {
		return false, 0
	}

	ch.mu.RLock()
	defer ch.mu.RUnlock()

	return ch.Initialized, len(ch.Messages)
}
