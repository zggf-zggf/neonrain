package client

import (
	"log"
	"sync"

	"github.com/mjacniacki/neonrain/discord-user-client/internal/backend"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/huma"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// GuildConfigWithUser combines server config with user info for internal tracking
type GuildConfigWithUser struct {
	types.ServerConfig
	UserID string
	Token  string
}

// ClientManager manages multiple Discord clients with token deduplication
// Multiple users can share the same Discord token, but we only create one
// Discord connection per unique token.
type ClientManager struct {
	mu sync.RWMutex

	// One Discord client per unique token
	clients map[string]*DiscordClient // token -> client

	// Track which users have which token
	tokenUsers map[string][]string // token -> []userID

	// Track config per guild (guildID -> config with user info)
	// This allows different users to select different guilds with the same token
	guildConfigs map[string]GuildConfigWithUser // guildID -> config

	// Dependencies
	humaManager   *huma.Manager
	backendClient *backend.Client
}

// NewClientManager creates a new client manager
func NewClientManager(humaManager *huma.Manager, backendClient *backend.Client) *ClientManager {
	return &ClientManager{
		clients:       make(map[string]*DiscordClient),
		tokenUsers:    make(map[string][]string),
		guildConfigs:  make(map[string]GuildConfigWithUser),
		humaManager:   humaManager,
		backendClient: backendClient,
	}
}

// SyncTokenConfigs synchronizes the manager state with the provided token configs
// This handles the new multi-server format where each token can have multiple servers
func (m *ClientManager) SyncTokenConfigs(tokenConfigs []types.TokenConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Build maps of new state
	newTokenUsers := make(map[string][]string)              // token -> []userID
	newGuildConfigs := make(map[string]GuildConfigWithUser) // guildID -> config
	tokenToGuilds := make(map[string][]string)              // token -> []guildID (active guilds only)

	for _, tc := range tokenConfigs {
		if tc.DiscordToken == "" {
			continue
		}

		// Track user->token mapping
		newTokenUsers[tc.DiscordToken] = append(newTokenUsers[tc.DiscordToken], tc.UserID)

		// Track guild->config mapping for all servers
		for _, server := range tc.Servers {
			newGuildConfigs[server.GuildID] = GuildConfigWithUser{
				ServerConfig: server,
				UserID:       tc.UserID,
				Token:        tc.DiscordToken,
			}

			// Only add to monitored guilds if bot is active
			if server.BotActive {
				tokenToGuilds[tc.DiscordToken] = append(tokenToGuilds[tc.DiscordToken], server.GuildID)
			}
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
			log.Printf("[ClientManager] New token detected (users: %v), connecting...", userIDs)
			client := NewMultiGuildDiscordClient(m.humaManager, m.backendClient, m)
			if err := client.ConnectWithToken(token); err != nil {
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
		guilds := tokenToGuilds[token]
		client.UpdateMonitoredGuilds(guilds)
	}
}

// GetConfigForGuild returns the config for a specific guild
func (m *ClientManager) GetConfigForGuild(guildID string) (GuildConfigWithUser, bool) {
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
	m.guildConfigs = make(map[string]GuildConfigWithUser)
}

// GetClientByToken returns the client for a specific Discord token
func (m *ClientManager) GetClientByToken(token string) *DiscordClient {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.clients[token]
}
