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
	port   string
	client *client.DiscordClient
}

// NewServer creates a new HTTP server
func NewServer(port string, client *client.DiscordClient) *Server {
	return &Server{
		port:   port,
		client: client,
	}
}

// Start starts the HTTP server
func (s *Server) Start() {
	http.HandleFunc("/guilds", s.handleGetGuilds)
	http.HandleFunc("/channels", s.handleGetChannels)
	http.HandleFunc("/health", s.handleHealth)

	log.Printf("Starting HTTP server on port %s", s.port)
	go func() {
		if err := http.ListenAndServe(":"+s.port, nil); err != nil {
			log.Printf("HTTP server error: %v", err)
		}
	}()
}

// UpdateClient updates the server's client reference
func (s *Server) UpdateClient(client *client.DiscordClient) {
	s.client = client
}

func (s *Server) handleGetGuilds(w http.ResponseWriter, r *http.Request) {
	if s.client == nil || s.client.GetSession() == nil {
		http.Error(w, `{"error":"No Discord session active"}`, http.StatusServiceUnavailable)
		return
	}

	guilds, err := s.client.GetSession().UserGuilds(100, "", "", false)
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
	if s.client == nil || s.client.GetSession() == nil {
		http.Error(w, `{"error":"No Discord session active"}`, http.StatusServiceUnavailable)
		return
	}

	// Get guild ID from URL path
	guildID := r.URL.Query().Get("guild_id")
	if guildID == "" {
		http.Error(w, `{"error":"guild_id parameter required"}`, http.StatusBadRequest)
		return
	}

	channels, err := s.client.GetSession().GuildChannels(guildID)
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
	status := "disconnected"
	if s.client != nil && s.client.GetSession() != nil {
		status = "connected"
	}
	json.NewEncoder(w).Encode(map[string]string{
		"status": status,
	})
}
