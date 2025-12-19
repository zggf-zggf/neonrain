package client

import (
	"context"
	"fmt"
	"log"

	"github.com/bwmarrin/discordgo"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/backend"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/history"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/huma"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// DiscordClient manages Discord connection and message processing
type DiscordClient struct {
	session           *discordgo.Session
	token             string
	userID            string
	userEmail         string
	readyHandled      bool
	selectedGuildID   string
	selectedGuildName string
	personality       string
	rules             string
	information       string
	historyManager    *history.MessageHistoryManager
	botUsername       string
	humaManager       *huma.Manager
	backendClient     *backend.Client
}

// NewDiscordClient creates a new Discord client
func NewDiscordClient(humaManager *huma.Manager, backendClient *backend.Client) *DiscordClient {
	return &DiscordClient{
		historyManager: history.NewMessageHistoryManager(),
		humaManager:    humaManager,
		backendClient:  backendClient,
	}
}

// Connect establishes a connection to Discord
func (dc *DiscordClient) Connect(config types.UserConfig) error {
	dc.token = config.Token
	dc.userID = config.UserID
	dc.userEmail = config.Email
	dc.selectedGuildID = config.SelectedGuildID
	dc.selectedGuildName = config.SelectedGuildName
	dc.personality = config.Personality
	dc.rules = config.Rules
	dc.information = config.Information
	dc.readyHandled = false

	// Log configuration
	if dc.selectedGuildID != "" {
		log.Printf("User: %s, Monitoring all channels in server: %s", dc.userEmail, dc.selectedGuildName)
	} else {
		log.Printf("User: %s, No server selected", dc.userEmail)
	}

	// Create Discord session
	session, err := discordgo.New(config.Token)
	if err != nil {
		return fmt.Errorf("error creating Discord session: %w", err)
	}

	// Enable state tracking
	session.StateEnabled = true

	// Set EventHandler
	session.EventHandler = func(rawEvt any) {
		go func() {
			switch evt := rawEvt.(type) {
			case *discordgo.Ready:
				if !dc.readyHandled {
					dc.readyHandled = true
					dc.botUsername = evt.User.Username

					// Configure HUMA manager with Discord client as sender
					if dc.humaManager != nil {
						dc.humaManager.SetMessageSender(dc)
						dc.humaManager.SetHistoryManager(dc.historyManager)
						dc.humaManager.SetConfig(dc.personality, dc.rules, dc.information)
					}

					log.Printf("✓ Connected as: %s (for user: %s)", evt.User.Username, dc.userEmail)
					log.Printf("✓ Bot username: %s", dc.botUsername)
					if dc.selectedGuildID != "" {
						log.Printf("✓ Monitoring all channels in server: %s (%s)", dc.selectedGuildName, dc.selectedGuildID)
					} else {
						log.Printf("⚠ No server selected - not monitoring any channels")
					}
					log.Printf("✓ HUMA integration enabled")
					log.Println("✓ Listening for messages...")
				}
			case *discordgo.MessageCreate:
				// Ignore our own messages
				if evt.Author.ID == session.State.User.ID {
					return
				}

				// Check if message is from the selected guild
				if dc.isFromSelectedGuild(evt.GuildID) {
					dc.processMessageWithHUMA(evt)
				}
			}
		}()
	}

	// Load main page (required for user tokens)
	if session.IsUser {
		log.Println("Loading Discord...")
		err = session.LoadMainPage(context.Background())
		if err != nil {
			log.Printf("Warning: Failed to load main page: %v", err)
		}
	}

	// Connect
	log.Println("Connecting to Discord...")
	err = session.Open()
	if err != nil {
		return fmt.Errorf("error connecting to Discord: %w", err)
	}

	dc.session = session
	return nil
}

// Disconnect closes the Discord connection
func (dc *DiscordClient) Disconnect() {
	// Disconnect all HUMA agents
	if dc.humaManager != nil {
		dc.humaManager.DisconnectAll()
	}

	if dc.session != nil {
		log.Printf("Disconnecting Discord session for user: %s", dc.userEmail)
		dc.session.Close()
		dc.session = nil
	}
}

// UpdateConfig updates the client configuration
func (dc *DiscordClient) UpdateConfig(config types.UserConfig) {
	dc.selectedGuildID = config.SelectedGuildID
	dc.selectedGuildName = config.SelectedGuildName
	dc.personality = config.Personality
	dc.rules = config.Rules
	dc.information = config.Information

	// Update HUMA manager with new config
	if dc.humaManager != nil {
		dc.humaManager.SetConfig(dc.personality, dc.rules, dc.information)
	}

	if dc.selectedGuildID != "" {
		log.Printf("Updated: Monitoring all channels in server: %s", dc.selectedGuildName)
	} else {
		log.Printf("Updated: No server selected")
	}
}

// isFromSelectedGuild checks if a message is from the selected guild
func (dc *DiscordClient) isFromSelectedGuild(guildID string) bool {
	if dc.selectedGuildID == "" {
		return false
	}
	return guildID == dc.selectedGuildID
}

// processMessageWithHUMA processes a Discord message using HUMA
func (dc *DiscordClient) processMessageWithHUMA(msg *discordgo.MessageCreate) {
	channelID := msg.ChannelID
	guildID := msg.GuildID

	// Get channel info
	channel, err := dc.session.Channel(channelID)
	channelName := channelID
	if err == nil && channel != nil {
		channelName = channel.Name
	}

	// Use stored guild name or look it up
	guildName := dc.selectedGuildName
	if guildName == "" {
		guild, err := dc.session.Guild(guildID)
		if err == nil && guild != nil {
			guildName = guild.Name
		} else {
			guildName = guildID
		}
	}

	log.Printf("[HUMA] Message from #%s in %s - %s: %s", channelName, guildName, msg.Author.Username, msg.Content)

	// Report message received to backend
	if dc.backendClient != nil && dc.userID != "" {
		go func() {
			if err := dc.backendClient.ReportStats(dc.userID, "message_received"); err != nil {
				log.Printf("[Stats] Failed to report message_received: %v", err)
			}
		}()
	}

	// Initialize channel history if needed
	if !dc.historyManager.IsChannelInitialized(channelID) {
		log.Printf("[HISTORY] Initializing channel %s", channelID)
		if err := dc.historyManager.InitializeChannel(dc.session, channelID, 50); err != nil {
			log.Printf("[HISTORY] Warning: Failed to initialize channel: %v", err)
		}
	}

	// Add message to history
	dc.historyManager.AddMessage(msg)

	// Get or create HUMA agent for this guild
	if dc.humaManager == nil {
		log.Printf("[HUMA] No HUMA manager available")
		return
	}

	agent, err := dc.humaManager.GetOrCreateAgent(guildID, guildName)
	if err != nil {
		log.Printf("[HUMA] Error getting/creating agent: %v", err)
		return
	}

	// Update agent config
	agent.UpdateConfig(dc, dc.historyManager, dc.personality, dc.rules, dc.information)

	// Send message event to HUMA
	err = agent.SendNewMessage(
		channelID,
		channelName,
		msg.Author.ID,
		msg.Author.Username,
		msg.Content,
		msg.ID,
	)
	if err != nil {
		log.Printf("[HUMA] Error sending message to HUMA: %v", err)
	}
}

// SendMessage implements the huma.MessageSender interface
func (dc *DiscordClient) SendMessage(channelID, content string) error {
	if dc.session == nil {
		return fmt.Errorf("no active Discord session")
	}

	_, err := dc.session.ChannelMessageSend(channelID, content)
	if err != nil {
		return fmt.Errorf("error sending message to Discord: %w", err)
	}

	log.Printf("[Discord] Message sent to channel %s", channelID)

	// Report message sent to backend
	if dc.backendClient != nil && dc.userID != "" {
		go func() {
			if err := dc.backendClient.ReportStats(dc.userID, "message_sent"); err != nil {
				log.Printf("[Stats] Failed to report message_sent: %v", err)
			}
		}()
	}

	return nil
}

// SendTypingIndicator implements the huma.MessageSender interface
func (dc *DiscordClient) SendTypingIndicator(channelID string) error {
	if dc.session == nil {
		return fmt.Errorf("no active Discord session")
	}

	err := dc.session.ChannelTyping(channelID)
	if err != nil {
		return fmt.Errorf("error sending typing indicator to Discord: %w", err)
	}

	return nil
}

// GetBotUsername implements the huma.MessageSender interface
func (dc *DiscordClient) GetBotUsername() string {
	if dc.botUsername != "" {
		return dc.botUsername
	}
	return "Bot"
}

// GetSession returns the Discord session (for HTTP handlers)
func (dc *DiscordClient) GetSession() *discordgo.Session {
	return dc.session
}

// GetToken returns the Discord token
func (dc *DiscordClient) GetToken() string {
	return dc.token
}

// GetUserEmail returns the user email
func (dc *DiscordClient) GetUserEmail() string {
	return dc.userEmail
}

// GetSelectedGuildID returns the selected guild ID
func (dc *DiscordClient) GetSelectedGuildID() string {
	return dc.selectedGuildID
}

// GetSelectedGuildName returns the selected guild name
func (dc *DiscordClient) GetSelectedGuildName() string {
	return dc.selectedGuildName
}

// GetPersonality returns the personality config
func (dc *DiscordClient) GetPersonality() string {
	return dc.personality
}

// GetRules returns the rules config
func (dc *DiscordClient) GetRules() string {
	return dc.rules
}

// GetInformation returns the information config
func (dc *DiscordClient) GetInformation() string {
	return dc.information
}

// GetMonitoredChannelsForGuild returns all text channels in the selected guild
func (dc *DiscordClient) GetMonitoredChannelsForGuild(guildID string) []huma.MonitoredChannel {
	var channels []huma.MonitoredChannel

	// Only return channels if this is the selected guild
	if dc.selectedGuildID == "" || guildID != dc.selectedGuildID {
		return channels
	}

	if dc.session == nil {
		return channels
	}

	// Get all channels from the guild
	guildChannels, err := dc.session.GuildChannels(guildID)
	if err != nil {
		log.Printf("[Discord] Failed to get guild channels: %v", err)
		return channels
	}

	// Filter to text channels only (type 0 = text channel)
	for _, ch := range guildChannels {
		if ch.Type == discordgo.ChannelTypeGuildText {
			channels = append(channels, huma.MonitoredChannel{
				ID:   ch.ID,
				Name: ch.Name,
			})
		}
	}

	return channels
}
