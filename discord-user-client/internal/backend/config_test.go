package backend

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

func TestFetchDiscordTokens_Success(t *testing.T) {
	// Create a mock server
	mockResponse := types.TokenResponse{
		Success: true,
		Tokens: []struct {
			UserID           string             `json:"userId"`
			UserEmail        string             `json:"userEmail"`
			DiscordToken     string             `json:"discordToken"`
			SelectedChannels []types.ChannelInfo `json:"selectedChannels"`
			Prompt           string             `json:"prompt"`
		}{
			{
				UserID:       "user123",
				UserEmail:    "test@example.com",
				DiscordToken: "token123",
				SelectedChannels: []types.ChannelInfo{
					{ChannelID: "channel1", GuildID: "guild1"},
				},
				Prompt: "Be helpful",
			},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify API key
		if r.Header.Get("X-API-Key") != "test-key" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Verify endpoint
		if r.URL.Path != "/api/discord/tokens" {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	// Create client
	client := NewClient(server.URL, "test-key")

	// Fetch tokens
	configs, err := client.FetchDiscordTokens()
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	// Verify results
	if len(configs) != 1 {
		t.Fatalf("Expected 1 config, got %d", len(configs))
	}

	config := configs[0]
	if config.Token != "token123" {
		t.Errorf("Expected token 'token123', got '%s'", config.Token)
	}
	if config.Email != "test@example.com" {
		t.Errorf("Expected email 'test@example.com', got '%s'", config.Email)
	}
	if config.Prompt != "Be helpful" {
		t.Errorf("Expected prompt 'Be helpful', got '%s'", config.Prompt)
	}
	if len(config.SelectedChannels) != 1 {
		t.Fatalf("Expected 1 selected channel, got %d", len(config.SelectedChannels))
	}
	if config.SelectedChannels[0].ChannelID != "channel1" {
		t.Errorf("Expected channel ID 'channel1', got '%s'", config.SelectedChannels[0].ChannelID)
	}
}

func TestFetchDiscordTokens_EmptyTokens(t *testing.T) {
	mockResponse := types.TokenResponse{
		Success: true,
		Tokens:  []struct {
			UserID           string             `json:"userId"`
			UserEmail        string             `json:"userEmail"`
			DiscordToken     string             `json:"discordToken"`
			SelectedChannels []types.ChannelInfo `json:"selectedChannels"`
			Prompt           string             `json:"prompt"`
		}{},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	configs, err := client.FetchDiscordTokens()

	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(configs) != 0 {
		t.Errorf("Expected 0 configs, got %d", len(configs))
	}
}

func TestFetchDiscordTokens_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()

	client := NewClient(server.URL, "wrong-key")
	_, err := client.FetchDiscordTokens()

	if err == nil {
		t.Error("Expected error for unauthorized request, got nil")
	}
}

func TestFetchDiscordTokens_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	_, err := client.FetchDiscordTokens()

	if err == nil {
		t.Error("Expected error for invalid JSON, got nil")
	}
}

func TestFetchDiscordTokens_SuccessFalse(t *testing.T) {
	mockResponse := types.TokenResponse{
		Success: false,
		Tokens:  []struct {
			UserID           string             `json:"userId"`
			UserEmail        string             `json:"userEmail"`
			DiscordToken     string             `json:"discordToken"`
			SelectedChannels []types.ChannelInfo `json:"selectedChannels"`
			Prompt           string             `json:"prompt"`
		}{},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-key")
	_, err := client.FetchDiscordTokens()

	if err == nil {
		t.Error("Expected error when success=false, got nil")
	}
}
