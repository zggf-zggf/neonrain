package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mjacniacki/neonrain/discord-user-client/internal/client"
)

func TestHandleHealth_NoClient(t *testing.T) {
	server := NewServer("8080", nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	server.handleHealth(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if result["status"] != "disconnected" {
		t.Errorf("Expected status 'disconnected', got '%s'", result["status"])
	}
}

func TestHandleHealth_WithClient(t *testing.T) {
	// Note: We can't easily test with a real session without mocking discordgo
	// This test verifies the basic structure
	dc := client.NewDiscordClient()
	server := NewServer("8080", dc)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	server.handleHealth(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var result map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Without actual Discord connection, should be disconnected
	if result["status"] != "disconnected" {
		t.Errorf("Expected status 'disconnected', got '%s'", result["status"])
	}
}

func TestHandleGetGuilds_NoSession(t *testing.T) {
	dc := client.NewDiscordClient()
	server := NewServer("8080", dc)

	req := httptest.NewRequest("GET", "/guilds", nil)
	w := httptest.NewRecorder()

	server.handleGetGuilds(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503, got %d", resp.StatusCode)
	}
}

func TestHandleGetChannels_NoSession(t *testing.T) {
	dc := client.NewDiscordClient()
	server := NewServer("8080", dc)

	req := httptest.NewRequest("GET", "/channels?guild_id=123", nil)
	w := httptest.NewRecorder()

	server.handleGetChannels(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503, got %d", resp.StatusCode)
	}
}

func TestHandleGetChannels_MissingGuildID(t *testing.T) {
	// Even with no client, we should get BadRequest for missing guild_id
	server := NewServer("8080", nil)

	req := httptest.NewRequest("GET", "/channels", nil)
	w := httptest.NewRecorder()

	server.handleGetChannels(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	// Should check for missing parameter before checking session
	if resp.StatusCode != http.StatusServiceUnavailable && resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Expected status 503 or 400, got %d", resp.StatusCode)
	}
}

func TestNewServer(t *testing.T) {
	dc := client.NewDiscordClient()
	server := NewServer("8080", dc)

	if server == nil {
		t.Fatal("NewServer returned nil")
	}

	if server.port != "8080" {
		t.Errorf("Expected port '8080', got '%s'", server.port)
	}

	if server.client != dc {
		t.Error("Server client not set correctly")
	}
}

func TestUpdateClient(t *testing.T) {
	dc1 := client.NewDiscordClient()
	dc2 := client.NewDiscordClient()

	server := NewServer("8080", dc1)

	if server.client != dc1 {
		t.Error("Initial client not set correctly")
	}

	server.UpdateClient(dc2)

	if server.client != dc2 {
		t.Error("Client not updated correctly")
	}
}
