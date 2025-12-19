package client

import (
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/history"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// MockSession is a mock Discord session for testing
type MockSession struct {
	messages      map[string][]*discordgo.Message
	typingCalls   int
	sentMessages  []string
	currentUserID string
}

func NewMockSession() *MockSession {
	return &MockSession{
		messages:      make(map[string][]*discordgo.Message),
		typingCalls:   0,
		sentMessages:  []string{},
		currentUserID: "bot123",
	}
}

func (m *MockSession) ChannelMessages(channelID string, limit int, beforeID, afterID, aroundID string, options ...discordgo.RequestOption) ([]*discordgo.Message, error) {
	if msgs, exists := m.messages[channelID]; exists {
		// Discord returns messages in reverse order (newest first)
		// Get the messages to return
		var toReturn []*discordgo.Message
		if len(msgs) > limit {
			toReturn = msgs[len(msgs)-limit:]
		} else {
			toReturn = msgs
		}

		// Reverse them (newest first)
		reversed := make([]*discordgo.Message, len(toReturn))
		for i, msg := range toReturn {
			reversed[len(toReturn)-1-i] = msg
		}
		return reversed, nil
	}
	return []*discordgo.Message{}, nil
}

func (m *MockSession) ChannelMessageSend(channelID, content string) (*discordgo.Message, error) {
	m.sentMessages = append(m.sentMessages, content)
	return &discordgo.Message{
		ID:        "msg_sent",
		ChannelID: channelID,
		Content:   content,
	}, nil
}

func (m *MockSession) ChannelTyping(channelID string) error {
	m.typingCalls++
	return nil
}

func (m *MockSession) AddMockMessage(channelID, msgID, content, authorID, authorName string) {
	if _, exists := m.messages[channelID]; !exists {
		m.messages[channelID] = []*discordgo.Message{}
	}
	m.messages[channelID] = append(m.messages[channelID], &discordgo.Message{
		ID:        msgID,
		ChannelID: channelID,
		Content:   content,
		Author: &discordgo.User{
			ID:       authorID,
			Username: authorName,
		},
		Timestamp: time.Now(),
	})
}

// TestChannelInitialization tests that channels are properly initialized on first message
func TestChannelInitialization(t *testing.T) {
	manager := history.NewMessageHistoryManager()
	mockSession := NewMockSession()

	// Add some historical messages
	mockSession.AddMockMessage("channel1", "msg1", "Hello!", "user1", "Alice")
	mockSession.AddMockMessage("channel1", "msg2", "Hi there!", "user2", "Bob")
	mockSession.AddMockMessage("channel1", "msg3", "How are you?", "user1", "Alice")

	// Channel should not be initialized yet
	if manager.IsChannelInitialized("channel1") {
		t.Error("Channel should not be initialized yet")
	}

	// Initialize the channel
	err := manager.InitializeChannel(mockSession, "channel1", 50)
	if err != nil {
		t.Fatalf("Failed to initialize channel: %v", err)
	}

	// Channel should now be initialized
	if !manager.IsChannelInitialized("channel1") {
		t.Error("Channel should be initialized after InitializeChannel call")
	}

	// Check that messages were loaded
	messages := manager.GetMessages("channel1")
	if len(messages) != 3 {
		t.Errorf("Expected 3 messages, got %d", len(messages))
	}

	// Verify message order and content
	if messages[0].Content != "Hello!" || messages[0].Author != "Alice" {
		t.Errorf("First message incorrect: %s by %s", messages[0].Content, messages[0].Author)
	}
	if messages[2].Content != "How are you?" || messages[2].Author != "Alice" {
		t.Errorf("Last message incorrect: %s by %s", messages[2].Content, messages[2].Author)
	}
}

// TestHistoryLimit tests that history maintains only last 50 messages
func TestHistoryLimit(t *testing.T) {
	manager := history.NewMessageHistoryManager()
	mockSession := NewMockSession()

	// Add 55 messages to mock session
	for i := 0; i < 55; i++ {
		mockSession.AddMockMessage(
			"channel1",
			"msg"+string(rune(i)),
			"Message "+string(rune(i)),
			"user1",
			"TestUser",
		)
	}

	// Initialize with limit of 50
	err := manager.InitializeChannel(mockSession, "channel1", 50)
	if err != nil {
		t.Fatalf("Failed to initialize channel: %v", err)
	}

	messages := manager.GetMessages("channel1")
	if len(messages) != 50 {
		t.Errorf("Expected 50 messages (limit), got %d", len(messages))
	}

	// Add 10 more messages via AddMessage
	for i := 0; i < 10; i++ {
		msg := &discordgo.MessageCreate{
			Message: &discordgo.Message{
				ID:        "newmsg" + string(rune(i)),
				ChannelID: "channel1",
				Content:   "New message " + string(rune(i)),
				Author: &discordgo.User{
					ID:       "user1",
					Username: "TestUser",
				},
				Timestamp: time.Now(),
			},
		}
		manager.AddMessage(msg)
	}

	// Should still have only 50 messages
	messages = manager.GetMessages("channel1")
	if len(messages) != 50 {
		t.Errorf("Expected 50 messages after adding more, got %d", len(messages))
	}
}

// TestThirdPersonPromptGeneration tests the third-person prompt building
func TestThirdPersonPromptGeneration(t *testing.T) {
	dc := NewDiscordClient()
	dc.botUsername = "TestBot"
	dc.userPrompt = "Be friendly and helpful"

	// Add some conversation history
	dc.historyManager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg1",
			ChannelID: "channel1",
			Content:   "What is AI?",
			Author:    &discordgo.User{ID: "user1", Username: "Alice"},
			Timestamp: time.Now(),
		},
	})

	dc.historyManager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg2",
			ChannelID: "channel1",
			Content:   "AI stands for Artificial Intelligence.",
			Author:    &discordgo.User{ID: "bot123", Username: "TestBot"},
			Timestamp: time.Now(),
		},
	})

	dc.historyManager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg3",
			ChannelID: "channel1",
			Content:   "Can you tell me more?",
			Author:    &discordgo.User{ID: "user1", Username: "Alice"},
			Timestamp: time.Now(),
		},
	})

	// Build the prompt
	conversationHistory := dc.historyManager.FormatConversation("channel1", dc.botUsername)
	prompt := dc.buildThirdPersonPrompt(conversationHistory, "general")

	// Verify prompt contains key elements
	if !contains(prompt, "TestBot is a helpful AI assistant") {
		t.Error("Prompt should describe bot in third person")
	}

	if !contains(prompt, "channel #general") {
		t.Error("Prompt should mention channel name")
	}

	if !contains(prompt, "Be friendly and helpful") {
		t.Error("Prompt should include custom user instructions")
	}

	if !contains(prompt, "Alice: What is AI?") {
		t.Error("Prompt should contain conversation history")
	}

	if !contains(prompt, "TestBot: AI stands for Artificial Intelligence.") {
		t.Error("Prompt should contain bot's previous response")
	}

	if !contains(prompt, "Alice: Can you tell me more?") {
		t.Error("Prompt should contain latest user message")
	}

	if !contains(prompt, "Generate the next message that TestBot would send") {
		t.Error("Prompt should instruct to generate next message")
	}

	if !contains(prompt, "You MUST format your response as:") {
		t.Error("Prompt should require username prefix format")
	}
}

// TestConversationFormatting tests that conversation is formatted correctly
func TestConversationFormatting(t *testing.T) {
	manager := history.NewMessageHistoryManager()

	// Add messages from multiple users
	messages := []*discordgo.MessageCreate{
		{
			Message: &discordgo.Message{
				ID:        "msg1",
				ChannelID: "channel1",
				Content:   "Hello everyone!",
				Author:    &discordgo.User{ID: "user1", Username: "Alice"},
				Timestamp: time.Now(),
			},
		},
		{
			Message: &discordgo.Message{
				ID:        "msg2",
				ChannelID: "channel1",
				Content:   "Hi Alice! How are you?",
				Author:    &discordgo.User{ID: "bot123", Username: "BotHelper"},
				Timestamp: time.Now(),
			},
		},
		{
			Message: &discordgo.Message{
				ID:        "msg3",
				ChannelID: "channel1",
				Content:   "I'm doing great, thanks!",
				Author:    &discordgo.User{ID: "user1", Username: "Alice"},
				Timestamp: time.Now(),
			},
		},
	}

	for _, msg := range messages {
		manager.AddMessage(msg)
	}

	formatted := manager.FormatConversation("channel1", "BotHelper")
	expected := "Alice: Hello everyone!\nBotHelper: Hi Alice! How are you?\nAlice: I'm doing great, thanks!\n"

	if formatted != expected {
		t.Errorf("Conversation formatting incorrect.\nExpected:\n%s\nGot:\n%s", expected, formatted)
	}
}

// TestMultipleChannels tests that history manager handles multiple channels independently
func TestMultipleChannels(t *testing.T) {
	manager := history.NewMessageHistoryManager()

	// Add messages to channel1
	manager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg1",
			ChannelID: "channel1",
			Content:   "Channel 1 message",
			Author:    &discordgo.User{ID: "user1", Username: "Alice"},
			Timestamp: time.Now(),
		},
	})

	// Add messages to channel2
	manager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg2",
			ChannelID: "channel2",
			Content:   "Channel 2 message",
			Author:    &discordgo.User{ID: "user2", Username: "Bob"},
			Timestamp: time.Now(),
		},
	})

	// Verify channels are independent
	messages1 := manager.GetMessages("channel1")
	messages2 := manager.GetMessages("channel2")

	if len(messages1) != 1 || messages1[0].Content != "Channel 1 message" {
		t.Error("Channel 1 messages incorrect")
	}

	if len(messages2) != 1 || messages2[0].Content != "Channel 2 message" {
		t.Error("Channel 2 messages incorrect")
	}

	// Initialize one channel
	mockSession := NewMockSession()
	mockSession.AddMockMessage("channel1", "hist1", "History 1", "user3", "Charlie")

	err := manager.InitializeChannel(mockSession, "channel1", 50)
	if err != nil {
		t.Fatalf("Failed to initialize channel1: %v", err)
	}

	// Only channel1 should be initialized
	if !manager.IsChannelInitialized("channel1") {
		t.Error("Channel1 should be initialized")
	}
	if manager.IsChannelInitialized("channel2") {
		t.Error("Channel2 should not be initialized")
	}
}

// TestBotResponseTracking tests that bot responses are added to history
func TestBotResponseTracking(t *testing.T) {
	manager := history.NewMessageHistoryManager()

	// Add user message
	manager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg1",
			ChannelID: "channel1",
			Content:   "What is Go?",
			Author:    &discordgo.User{ID: "user1", Username: "Alice"},
			Timestamp: time.Now(),
		},
	})

	// Simulate bot response being added
	botMessage := &discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "bot_response",
			ChannelID: "channel1",
			Content:   "Go is a programming language.",
			Author: &discordgo.User{
				ID:       "bot123",
				Username: "BotHelper",
			},
			Timestamp: time.Now(),
		},
	}
	manager.AddMessage(botMessage)

	// Verify both messages are in history
	messages := manager.GetMessages("channel1")
	if len(messages) != 2 {
		t.Errorf("Expected 2 messages (user + bot), got %d", len(messages))
	}

	if messages[1].Author != "BotHelper" || messages[1].Content != "Go is a programming language." {
		t.Error("Bot response not properly tracked in history")
	}

	// Verify formatted conversation includes bot response
	formatted := manager.FormatConversation("channel1", "BotHelper")
	if !contains(formatted, "BotHelper: Go is a programming language.") {
		t.Error("Formatted conversation should include bot's response")
	}
}

// TestEmptyConversationHistory tests handling of empty history
func TestEmptyConversationHistory(t *testing.T) {
	dc := NewDiscordClient()
	dc.botUsername = "TestBot"
	dc.userPrompt = ""

	// Build prompt with no history
	conversationHistory := dc.historyManager.FormatConversation("nonexistent", dc.botUsername)
	prompt := dc.buildThirdPersonPrompt(conversationHistory, "general")

	// Should still have basic structure
	if !contains(prompt, "TestBot is a helpful AI assistant") {
		t.Error("Prompt should describe bot even with no history")
	}

	// Should not have conversation section if empty
	if conversationHistory != "" {
		t.Error("Expected empty conversation history for nonexistent channel")
	}
}

// TestConfigUpdate tests that updating config doesn't affect history
func TestConfigUpdate(t *testing.T) {
	dc := NewDiscordClient()

	// Add some history
	dc.historyManager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg1",
			ChannelID: "channel1",
			Content:   "Test message",
			Author:    &discordgo.User{ID: "user1", Username: "Alice"},
			Timestamp: time.Now(),
		},
	})

	// Update config
	newConfig := types.UserConfig{
		Token: "new_token",
		Email: "newemail@example.com",
		SelectedChannels: []types.ChannelInfo{
			{ChannelID: "channel2", GuildID: "guild1"},
		},
		Prompt: "New prompt",
	}

	dc.UpdateConfig(newConfig)

	// History should remain unchanged
	messages := dc.historyManager.GetMessages("channel1")
	if len(messages) != 1 {
		t.Error("History should be preserved after config update")
	}

	// New config values should be set
	if dc.userPrompt != "New prompt" {
		t.Error("User prompt should be updated")
	}
	if len(dc.selectedChannels) != 1 || dc.selectedChannels[0].ChannelID != "channel2" {
		t.Error("Selected channels should be updated")
	}
}

// TestStripUsernamePrefix tests that username prefix is correctly stripped
func TestStripUsernamePrefix(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		username string
		expected string
	}{
		{
			name:     "Standard prefix",
			input:    "TestBot: Hello, how can I help?",
			username: "TestBot",
			expected: "Hello, how can I help?",
		},
		{
			name:     "No prefix",
			input:    "Hello, how can I help?",
			username: "TestBot",
			expected: "Hello, how can I help?",
		},
		{
			name:     "Different username",
			input:    "OtherBot: Hello",
			username: "TestBot",
			expected: "OtherBot: Hello", // Not stripped because wrong username
		},
		{
			name:     "Username in content",
			input:    "TestBot: I am TestBot, nice to meet you",
			username: "TestBot",
			expected: "I am TestBot, nice to meet you",
		},
		{
			name:     "Empty message",
			input:    "TestBot: ",
			username: "TestBot",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripUsernamePrefix(tt.input, tt.username)
			if result != tt.expected {
				t.Errorf("stripUsernamePrefix() = %q, want %q", result, tt.expected)
			}
		})
	}
}

// Helper function to check if a string contains a substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && indexOf(s, substr) >= 0))
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
