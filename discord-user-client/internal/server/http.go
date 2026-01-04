package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/mjacniacki/neonrain/discord-user-client/internal/client"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// Server provides HTTP endpoints for the Discord client
type Server struct {
	port          string
	clientManager *client.ClientManager
}

// NewServer creates a new HTTP server
func NewServer(port string, clientManager *client.ClientManager) *Server {
	return &Server{
		port:          port,
		clientManager: clientManager,
	}
}

// Start starts the HTTP server
func (s *Server) Start() {
	http.HandleFunc("/guilds", s.handleGetGuilds)
	http.HandleFunc("/channels", s.handleGetChannels)
	http.HandleFunc("/health", s.handleHealth)
	http.HandleFunc("/status", s.handleStatus)

	log.Printf("Starting HTTP server on port %s", s.port)
	go func() {
		if err := http.ListenAndServe(":"+s.port, nil); err != nil {
			log.Printf("HTTP server error: %v", err)
		}
	}()
}

func (s *Server) handleGetGuilds(w http.ResponseWriter, r *http.Request) {
	if s.clientManager == nil {
		http.Error(w, `{"error":"No client manager available"}`, http.StatusServiceUnavailable)
		return
	}

	// Get client for the specific user's Discord token
	// The backend passes X-Discord-Token header to identify which user's guilds to fetch
	token := r.Header.Get("X-Discord-Token")
	if token == "" {
		// SECURITY: Token header is required to prevent cross-user data leakage
		http.Error(w, `{"error":"X-Discord-Token header is required"}`, http.StatusBadRequest)
		return
	}

	discordClient := s.clientManager.GetClientByToken(token)
	if discordClient == nil || discordClient.GetSession() == nil {
		// Token provided but no active client for this token
		http.Error(w, `{"error":"No Discord session active for this token"}`, http.StatusServiceUnavailable)
		return
	}

	guilds, err := discordClient.GetSession().UserGuilds(100, "", "", false)
	if err != nil {
		log.Printf("Error fetching guilds: %v", err)
		http.Error(w, fmt.Sprintf(`{"error":"Failed to fetch guilds: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	var guildList []types.GuildInfo
	for _, guild := range guilds {
		guildList = append(guildList, types.GuildInfo{
			ID:   guild.ID,
			Name: guild.Name,
			Icon: guild.Icon,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"guilds":  guildList,
	})
}

func (s *Server) handleGetChannels(w http.ResponseWriter, r *http.Request) {
	if s.clientManager == nil {
		http.Error(w, `{"error":"No client manager available"}`, http.StatusServiceUnavailable)
		return
	}

	// Get client for the specific user's Discord token
	token := r.Header.Get("X-Discord-Token")
	if token == "" {
		// SECURITY: Token header is required to prevent cross-user data leakage
		http.Error(w, `{"error":"X-Discord-Token header is required"}`, http.StatusBadRequest)
		return
	}

	discordClient := s.clientManager.GetClientByToken(token)
	if discordClient == nil || discordClient.GetSession() == nil {
		// Token provided but no active client for this token
		http.Error(w, `{"error":"No Discord session active for this token"}`, http.StatusServiceUnavailable)
		return
	}

	// Get guild ID from URL path
	guildID := r.URL.Query().Get("guild_id")
	if guildID == "" {
		http.Error(w, `{"error":"guild_id parameter required"}`, http.StatusBadRequest)
		return
	}

	channels, err := discordClient.GetSession().GuildChannels(guildID)
	if err != nil {
		log.Printf("Error fetching channels: %v", err)
		http.Error(w, fmt.Sprintf(`{"error":"Failed to fetch channels: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	var channelList []types.ChannelListInfo
	for _, channel := range channels {
		// Only include text channels (type 0) and announcement channels (type 5)
		if channel.Type == 0 || channel.Type == 5 {
			channelList = append(channelList, types.ChannelListInfo{
				ID:   channel.ID,
				Name: channel.Name,
				Type: int(channel.Type),
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"channels": channelList,
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if s.clientManager == nil {
		json.NewEncoder(w).Encode(map[string]string{
			"status": "no_manager",
		})
		return
	}

	clientCount := s.clientManager.GetClientCount()
	if clientCount == 0 {
		json.NewEncoder(w).Encode(map[string]string{
			"status": "disconnected",
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status": "connected",
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if s.clientManager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"connected":       false,
			"clientCount":     0,
			"guildCount":      0,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":       s.clientManager.GetClientCount() > 0,
		"clientCount":     s.clientManager.GetClientCount(),
		"guildCount":      s.clientManager.GetMonitoredGuildCount(),
	})
}
