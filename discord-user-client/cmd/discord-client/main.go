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

	pollInterval := 2 * time.Second
	log.Printf("Starting Discord client service with HUMA integration")
	log.Printf("Backend URL: %s", backendURL)
	log.Printf("HUMA API: https://api.humalike.tech")
	log.Printf("Poll interval: %v", pollInterval)

	// Initialize HTTP server (will be updated with client later)
	var currentClient *client.DiscordClient
	httpServer := server.NewServer(httpPort, nil)
	httpServer.Start()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM, os.Interrupt)

	// Initial fetch
	go func() {
		configs, err := backendClient.FetchDiscordTokens()
		if err != nil {
			log.Printf("Error fetching tokens: %v", err)
			log.Println("Waiting for Discord account to be connected...")
		} else if len(configs) > 0 {
			log.Printf("Found %d Discord token(s), connecting with the first one", len(configs))
			currentClient = client.NewDiscordClient(humaManager, backendClient)
			if err := currentClient.Connect(configs[0]); err != nil {
				log.Printf("Error connecting: %v", err)
				currentClient = nil
			} else {
				httpServer.UpdateClient(currentClient)
			}
		} else {
			log.Println("No Discord tokens found, waiting for user to connect Discord account...")
		}
	}()

	// Poll for token changes
	for {
		select {
		case <-ticker.C:
			configs, err := backendClient.FetchDiscordTokens()
			if err != nil {
				log.Printf("Error fetching tokens: %v", err)
				continue
			}

			// No tokens found
			if len(configs) == 0 {
				if currentClient != nil {
					log.Println("No tokens found in database, disconnecting...")
					currentClient.Disconnect()
					currentClient = nil
					httpServer.UpdateClient(nil)
				}
				continue
			}

			// Token found
			currentConfig := configs[0]

			// If we don't have a client yet, connect
			if currentClient == nil {
				log.Printf("New Discord account detected (user: %s), connecting...", currentConfig.Email)
				currentClient = client.NewDiscordClient(humaManager, backendClient)
				if err := currentClient.Connect(currentConfig); err != nil {
					log.Printf("Error connecting: %v", err)
					currentClient = nil
				} else {
					httpServer.UpdateClient(currentClient)
				}
				continue
			}

			// If token changed, reconnect
			if currentClient.GetToken() != currentConfig.Token {
				log.Printf("Discord token changed (user: %s), reconnecting...", currentConfig.Email)
				currentClient.Disconnect()
				currentClient = client.NewDiscordClient(humaManager, backendClient)
				if err := currentClient.Connect(currentConfig); err != nil {
					log.Printf("Error connecting: %v", err)
					currentClient = nil
					httpServer.UpdateClient(nil)
				} else {
					httpServer.UpdateClient(currentClient)
				}
				continue
			}

			// Update selected guild and config fields if they changed
			guildChanged := currentClient.GetSelectedGuildID() != currentConfig.SelectedGuildID
			configChanged := currentClient.GetPersonality() != currentConfig.Personality ||
				currentClient.GetRules() != currentConfig.Rules ||
				currentClient.GetInformation() != currentConfig.Information

			if guildChanged || configChanged {
				log.Printf("Configuration changed, updating...")
				currentClient.UpdateConfig(currentConfig)
			}

		case <-sigChan:
			log.Println("\nShutting down...")
			if currentClient != nil {
				currentClient.Disconnect()
			}
			return
		}
	}
}
