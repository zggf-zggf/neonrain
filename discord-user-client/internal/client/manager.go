package client

import (
	"log"
	"sync"

	"github.com/mjacniacki/neonrain/discord-user-client/internal/backend"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/huma"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// ClientManager manages multiple Discord clients with token deduplication
// Multiple users can share the same Discord token, but we only create one
// Discord connection per unique token.
type ClientManager struct {
	mu sync.RWMutex

	// One Discord client per unique token
	clients map[string]*DiscordClient // token -> client

	// Track which users have which token
	tokenUsers map[string][]string // token -> []userID

	// Track config per guild (guildID -> config)
	// This allows different users to select different guilds with the same token
	guildConfigs map[string]types.UserConfig // guildID -> config

	// Dependencies
	humaManager   *huma.Manager
	backendClient *backend.Client
}

// NewClientManager creates a new client manager
func NewClientManager(humaManager *huma.Manager, backendClient *backend.Client) *ClientManager {
	return &ClientManager{
		clients:       make(map[string]*DiscordClient),
		tokenUsers:    make(map[string][]string),
		guildConfigs:  make(map[string]types.UserConfig),
		humaManager:   humaManager,
		backendClient: backendClient,
	}
}

// SyncConfigs synchronizes the manager state with the provided configs
// It handles:
// - Creating new connections for new tokens
// - Removing connections for tokens that are no longer present
// - Updating configs for existing connections
func (m *ClientManager) SyncConfigs(configs []types.UserConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Build maps of current state from configs
	newTokenUsers := make(map[string][]string)    // token -> []userID
	newGuildConfigs := make(map[string]types.UserConfig) // guildID -> config

	for _, config := range configs {
		if config.Token == "" {
			continue
		}

		// Track user->token mapping
		newTokenUsers[config.Token] = append(newTokenUsers[config.Token], config.UserID)

		// Track guild->config mapping (if user has selected a guild)
		if config.SelectedGuildID != "" {
			// If multiple users select the same guild, last one wins
			// This is an edge case that shouldn't happen often
			newGuildConfigs[config.SelectedGuildID] = config
		}
	}

	// Find tokens to remove (exist in current but not in new)
	for token := range m.clients {
		if _, exists := newTokenUsers[token]; !exists {
			log.Printf("[ClientManager] Token removed, disconnecting...")
			m.clients[token].Disconnect()
			delete(m.clients, token)
		}
	}

	// Find tokens to add (exist in new but not in current)
	for token, userIDs := range newTokenUsers {
		if _, exists := m.clients[token]; !exists {
			// Find a config with this token to get initial connection info
			var configForToken types.UserConfig
			for _, config := range configs {
				if config.Token == token {
					configForToken = config
					break
				}
			}

			log.Printf("[ClientManager] New token detected (users: %v), connecting...", userIDs)
			client := NewMultiGuildDiscordClient(m.humaManager, m.backendClient, m)
			if err := client.Connect(configForToken); err != nil {
				log.Printf("[ClientManager] Error connecting: %v", err)
				continue
			}
			m.clients[token] = client
		}
	}

	// Update internal state
	m.tokenUsers = newTokenUsers
	m.guildConfigs = newGuildConfigs

	// Update all active clients with their monitored guilds
	for token, client := range m.clients {
		// Collect all guilds monitored by this token
		var monitoredGuilds []string
		for _, config := range configs {
			if config.Token == token && config.SelectedGuildID != "" {
				monitoredGuilds = append(monitoredGuilds, config.SelectedGuildID)
			}
		}
		client.UpdateMonitoredGuilds(monitoredGuilds)
	}
}

// GetConfigForGuild returns the config for a specific guild
func (m *ClientManager) GetConfigForGuild(guildID string) (types.UserConfig, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	config, exists := m.guildConfigs[guildID]
	return config, exists
}

// GetAllClients returns all active Discord clients
func (m *ClientManager) GetAllClients() []*DiscordClient {
	m.mu.RLock()
	defer m.mu.RUnlock()

	clients := make([]*DiscordClient, 0, len(m.clients))
	for _, client := range m.clients {
		clients = append(clients, client)
	}
	return clients
}

// GetClientCount returns the number of active connections
func (m *ClientManager) GetClientCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.clients)
}

// GetMonitoredGuildCount returns the number of monitored guilds
func (m *ClientManager) GetMonitoredGuildCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.guildConfigs)
}

// DisconnectAll disconnects all clients
func (m *ClientManager) DisconnectAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for token, client := range m.clients {
		log.Printf("[ClientManager] Disconnecting client for token...")
		client.Disconnect()
		delete(m.clients, token)
	}

	m.tokenUsers = make(map[string][]string)
	m.guildConfigs = make(map[string]types.UserConfig)
}

// GetFirstClient returns the first available client (for backward compatibility)
func (m *ClientManager) GetFirstClient() *DiscordClient {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, client := range m.clients {
		return client
	}
	return nil
}

// GetClientByToken returns the client for a specific Discord token
func (m *ClientManager) GetClientByToken(token string) *DiscordClient {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[token]
}
