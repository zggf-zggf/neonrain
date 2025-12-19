package client

import (
	"testing"

	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

func TestIsChannelSelected(t *testing.T) {
	dc := NewDiscordClient()

	tests := []struct {
		name             string
		selectedChannels []types.ChannelInfo
		testChannelID    string
		expected         bool
	}{
		{
			name:             "No channels selected",
			selectedChannels: []types.ChannelInfo{},
			testChannelID:    "channel1",
			expected:         false,
		},
		{
			name: "Channel is selected",
			selectedChannels: []types.ChannelInfo{
				{ChannelID: "channel1", GuildID: "guild1"},
				{ChannelID: "channel2", GuildID: "guild1"},
			},
			testChannelID: "channel1",
			expected:      true,
		},
		{
			name: "Channel not in list",
			selectedChannels: []types.ChannelInfo{
				{ChannelID: "channel1", GuildID: "guild1"},
				{ChannelID: "channel2", GuildID: "guild1"},
			},
			testChannelID: "channel3",
			expected:      false,
		},
		{
			name: "Single channel selected - match",
			selectedChannels: []types.ChannelInfo{
				{ChannelID: "only-channel", GuildID: "guild1"},
			},
			testChannelID: "only-channel",
			expected:      true,
		},
		{
			name: "Single channel selected - no match",
			selectedChannels: []types.ChannelInfo{
				{ChannelID: "only-channel", GuildID: "guild1"},
			},
			testChannelID: "other-channel",
			expected:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dc.selectedChannels = tt.selectedChannels
			result := dc.isChannelSelected(tt.testChannelID)

			if result != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestUpdateConfig(t *testing.T) {
	dc := NewDiscordClient()

	// Initial config
	initialConfig := types.UserConfig{
		Token:            "token1",
		Email:            "test@example.com",
		SelectedChannels: []types.ChannelInfo{
			{ChannelID: "channel1", GuildID: "guild1"},
		},
		Prompt: "Be helpful",
	}

	dc.token = initialConfig.Token
	dc.userEmail = initialConfig.Email
	dc.selectedChannels = initialConfig.SelectedChannels
	dc.userPrompt = initialConfig.Prompt

	// Update config
	newConfig := types.UserConfig{
		Token:            "token1", // Same token
		Email:            "test@example.com",
		SelectedChannels: []types.ChannelInfo{
			{ChannelID: "channel1", GuildID: "guild1"},
			{ChannelID: "channel2", GuildID: "guild1"},
		},
		Prompt: "Be very helpful",
	}

	dc.UpdateConfig(newConfig)

	// Verify updates
	if len(dc.selectedChannels) != 2 {
		t.Errorf("Expected 2 selected channels, got %d", len(dc.selectedChannels))
	}

	if dc.userPrompt != "Be very helpful" {
		t.Errorf("Expected prompt 'Be very helpful', got '%s'", dc.userPrompt)
	}

	// Verify token and email weren't changed by UpdateConfig
	if dc.token != "token1" {
		t.Errorf("Token should not be changed by UpdateConfig")
	}
}

func TestGetters(t *testing.T) {
	dc := NewDiscordClient()

	testConfig := types.UserConfig{
		Token:            "test-token-123",
		Email:            "user@example.com",
		SelectedChannels: []types.ChannelInfo{
			{ChannelID: "ch1", GuildID: "g1"},
		},
		Prompt: "Test prompt",
	}

	dc.token = testConfig.Token
	dc.userEmail = testConfig.Email
	dc.selectedChannels = testConfig.SelectedChannels
	dc.userPrompt = testConfig.Prompt

	// Test getters
	if dc.GetToken() != "test-token-123" {
		t.Errorf("GetToken() = %s, want test-token-123", dc.GetToken())
	}

	if dc.GetUserEmail() != "user@example.com" {
		t.Errorf("GetUserEmail() = %s, want user@example.com", dc.GetUserEmail())
	}

	if dc.GetUserPrompt() != "Test prompt" {
		t.Errorf("GetUserPrompt() = %s, want Test prompt", dc.GetUserPrompt())
	}

	channels := dc.GetSelectedChannels()
	if len(channels) != 1 || channels[0].ChannelID != "ch1" {
		t.Errorf("GetSelectedChannels() returned unexpected result")
	}
}

func TestSendMessage_NoSession(t *testing.T) {
	dc := NewDiscordClient()

	err := dc.SendMessage("channel1", "test message")
	if err == nil {
		t.Error("Expected error when sending message without session, got nil")
	}
}

func TestNewDiscordClient(t *testing.T) {
	dc := NewDiscordClient()

	if dc == nil {
		t.Fatal("NewDiscordClient() returned nil")
	}

	// Verify initial state
	if dc.session != nil {
		t.Error("New client should not have an active session")
	}

	if dc.readyHandled {
		t.Error("readyHandled should be false initially")
	}

	if len(dc.selectedChannels) != 0 {
		t.Error("selectedChannels should be empty initially")
	}
}

// Note: Testing Connect() requires mocking the discordgo library,
// which is complex and would require dependency injection.
// In a production environment, you might use interfaces to make this testable.
