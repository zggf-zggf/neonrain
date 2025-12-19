package history

import (
	"fmt"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
)

func TestNewMessageHistoryManager(t *testing.T) {
	manager := NewMessageHistoryManager()

	if manager == nil {
		t.Fatal("NewMessageHistoryManager returned nil")
	}

	if manager.channels == nil {
		t.Error("channels map not initialized")
	}
}

func TestGetOrCreateChannel(t *testing.T) {
	manager := NewMessageHistoryManager()

	// First call should create new channel
	ch1 := manager.GetOrCreateChannel("channel1")
	if ch1 == nil {
		t.Fatal("GetOrCreateChannel returned nil")
	}
	if ch1.ChannelID != "channel1" {
		t.Errorf("Expected ChannelID 'channel1', got '%s'", ch1.ChannelID)
	}
	if ch1.Initialized {
		t.Error("New channel should not be initialized")
	}

	// Second call should return same channel
	ch2 := manager.GetOrCreateChannel("channel1")
	if ch1 != ch2 {
		t.Error("GetOrCreateChannel should return same instance")
	}
}

func TestIsChannelInitialized(t *testing.T) {
	manager := NewMessageHistoryManager()

	// Non-existent channel
	if manager.IsChannelInitialized("nonexistent") {
		t.Error("Non-existent channel should not be initialized")
	}

	// Create but don't initialize
	ch := manager.GetOrCreateChannel("channel1")
	if manager.IsChannelInitialized("channel1") {
		t.Error("Created but uninitialized channel should return false")
	}

	// Manually set initialized
	ch.mu.Lock()
	ch.Initialized = true
	ch.mu.Unlock()

	if !manager.IsChannelInitialized("channel1") {
		t.Error("Initialized channel should return true")
	}
}

func TestAddMessage(t *testing.T) {
	manager := NewMessageHistoryManager()

	// Create mock message
	msg := &discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg1",
			ChannelID: "channel1",
			Content:   "Test message",
			Author: &discordgo.User{
				ID:       "user1",
				Username: "TestUser",
			},
			Timestamp: time.Now(),
		},
	}

	// Add message
	manager.AddMessage(msg)

	// Verify message was added
	messages := manager.GetMessages("channel1")
	if len(messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(messages))
	}

	if messages[0].Content != "Test message" {
		t.Errorf("Expected content 'Test message', got '%s'", messages[0].Content)
	}
	if messages[0].Author != "TestUser" {
		t.Errorf("Expected author 'TestUser', got '%s'", messages[0].Author)
	}
}

func TestAddMessage_MaxLimit(t *testing.T) {
	manager := NewMessageHistoryManager()

	// Add more than max messages
	for i := 0; i < 60; i++ {
		msg := &discordgo.MessageCreate{
			Message: &discordgo.Message{
				ID:        fmt.Sprintf("msg%d", i),
				ChannelID: "channel1",
				Content:   fmt.Sprintf("Message %d", i),
				Author: &discordgo.User{
					ID:       "user1",
					Username: "TestUser",
				},
				Timestamp: time.Now(),
			},
		}
		manager.AddMessage(msg)
	}

	// Should keep only last 50
	messages := manager.GetMessages("channel1")
	if len(messages) != 50 {
		t.Errorf("Expected 50 messages (max), got %d", len(messages))
	}

	// First message should be message 10 (0-9 were dropped)
	if messages[0].Content != "Message 10" {
		t.Errorf("Expected oldest message 'Message 10', got '%s'", messages[0].Content)
	}

	// Last message should be message 59
	if messages[49].Content != "Message 59" {
		t.Errorf("Expected newest message 'Message 59', got '%s'", messages[49].Content)
	}
}

func TestGetMessages_EmptyChannel(t *testing.T) {
	manager := NewMessageHistoryManager()

	messages := manager.GetMessages("nonexistent")
	if len(messages) != 0 {
		t.Errorf("Expected 0 messages for non-existent channel, got %d", len(messages))
	}
}

func TestFormatConversation(t *testing.T) {
	manager := NewMessageHistoryManager()

	// Add some messages
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
				Content:   "Hi Alice!",
				Author:    &discordgo.User{ID: "user2", Username: "Bob"},
				Timestamp: time.Now(),
			},
		},
	}

	for _, msg := range messages {
		manager.AddMessage(msg)
	}

	formatted := manager.FormatConversation("channel1", "Bot")
	expected := "Alice: Hello everyone!\nBob: Hi Alice!\n"

	if formatted != expected {
		t.Errorf("Expected formatted:\n%s\nGot:\n%s", expected, formatted)
	}
}

func TestGetChannelStats(t *testing.T) {
	manager := NewMessageHistoryManager()

	// Non-existent channel
	initialized, count := manager.GetChannelStats("nonexistent")
	if initialized || count != 0 {
		t.Error("Non-existent channel should return false, 0")
	}

	// Create and add messages
	manager.AddMessage(&discordgo.MessageCreate{
		Message: &discordgo.Message{
			ID:        "msg1",
			ChannelID: "channel1",
			Content:   "Test",
			Author:    &discordgo.User{ID: "user1", Username: "User"},
			Timestamp: time.Now(),
		},
	})

	initialized, count = manager.GetChannelStats("channel1")
	if initialized {
		t.Error("Channel should not be initialized yet")
	}
	if count != 1 {
		t.Errorf("Expected count 1, got %d", count)
	}

	// Mark as initialized
	ch := manager.GetOrCreateChannel("channel1")
	ch.mu.Lock()
	ch.Initialized = true
	ch.mu.Unlock()

	initialized, count = manager.GetChannelStats("channel1")
	if !initialized {
		t.Error("Channel should be initialized")
	}
	if count != 1 {
		t.Errorf("Expected count 1, got %d", count)
	}
}
