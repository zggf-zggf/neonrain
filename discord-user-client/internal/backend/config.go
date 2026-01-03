package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// Client handles communication with the backend API
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewClient creates a new backend API client
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// FetchDiscordTokens retrieves Discord tokens and configurations from the backend
func (c *Client) FetchDiscordTokens() ([]types.UserConfig, error) {
	req, err := http.NewRequest("GET", c.baseURL+"/api/discord/tokens", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tokens: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("backend returned status %d: %s", resp.StatusCode, string(body))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var tokenResp types.TokenResponse
	if err := json.Unmarshal(bodyBytes, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if !tokenResp.Success {
		return nil, fmt.Errorf("backend returned success=false")
	}

	var configs []types.UserConfig
	for _, t := range tokenResp.Tokens {
		if t.DiscordToken != "" {
			configs = append(configs, types.UserConfig{
				UserID:            t.UserID,
				Token:             t.DiscordToken,
				Email:             t.UserEmail,
				BotActive:         t.DiscordBotActive,
				SelectedGuildID:   t.SelectedGuildID,
				SelectedGuildName: t.SelectedGuildName,
				Personality:       t.Personality,
				Rules:             t.Rules,
				Information:       t.Information,
				Websites:          t.Websites,
			})
		}
	}

	return configs, nil
}

// ReportStats sends a stats event to the backend
func (c *Client) ReportStats(userID, event string) error {
	payload := fmt.Sprintf(`{"userId":"%s","event":"%s"}`, userID, event)

	req, err := http.NewRequest("POST", c.baseURL+"/api/discord/stats", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Body = io.NopCloser(strings.NewReader(payload))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send stats: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("backend returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
