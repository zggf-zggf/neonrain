package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/backend"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/client"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/huma"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/server"
)

func main() {
	// Load .env file (optional in Docker)
	_ = godotenv.Load()

	// Get backend URL and API key from environment
	backendURL := os.Getenv("BACKEND_URL")
	if backendURL == "" {
		backendURL = "http://localhost:3000"
	}

	apiKey := os.Getenv("INTERNAL_API_KEY")
	if apiKey == "" {
		apiKey = "default-internal-key"
	}

	// Check for HUMA API key
	humaAPIKey := os.Getenv("HUMA_API_KEY")
	if humaAPIKey == "" {
		log.Fatal("HUMA_API_KEY environment variable is required")
	}

	httpPort := os.Getenv("HTTP_PORT")
	if httpPort == "" {
		httpPort = "8080"
	}

	// Initialize HUMA manager
	humaManager := huma.NewManager(humaAPIKey)

	// Initialize backend client
	backendClient := backend.NewClient(backendURL, apiKey)

	// Set backend client on HUMA manager for agent action reporting
	humaManager.SetBackendClient(backendClient)

	pollInterval := 2 * time.Second
	log.Printf("Starting Discord client service with HUMA integration")
	log.Printf("Backend URL: %s", backendURL)
	log.Printf("HUMA API: https://api.humalike.tech")
	log.Printf("Poll interval: %v", pollInterval)

	// Initialize client manager for multi-user support
	clientManager := client.NewClientManager(humaManager, backendClient)

	// Initialize HTTP server
	httpServer := server.NewServer(httpPort, clientManager)
	httpServer.Start()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM, os.Interrupt)

	// Initial fetch
	go func() {
		tokenConfigs, err := backendClient.FetchTokenConfigs()
		if err != nil {
			log.Printf("Error fetching tokens: %v", err)
			log.Println("Waiting for Discord accounts to be connected...")
		} else if len(tokenConfigs) > 0 {
			// Count total servers across all tokens
			totalServers := 0
			for _, tc := range tokenConfigs {
				totalServers += len(tc.Servers)
			}
			log.Printf("Found %d token(s) with %d total server config(s)", len(tokenConfigs), totalServers)
			clientManager.SyncTokenConfigs(tokenConfigs)
		} else {
			log.Println("No Discord tokens found, waiting for users to connect Discord accounts...")
		}
	}()

	// Poll for config changes
	for {
		select {
		case <-ticker.C:
			tokenConfigs, err := backendClient.FetchTokenConfigs()
			if err != nil {
				log.Printf("Error fetching tokens: %v", err)
				continue
			}

			// Sync all configs with the client manager
			// This handles:
			// - New tokens (creates new connections)
			// - Removed tokens (disconnects)
			// - Updated configs (updates guild monitoring)
			clientManager.SyncTokenConfigs(tokenConfigs)

		case <-sigChan:
			log.Println("\nShutting down...")
			clientManager.DisconnectAll()
			return
		}
	}
}
