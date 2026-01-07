package client

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/bwmarrin/discordgo"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/backend"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/history"
	"github.com/mjacniacki/neonrain/discord-user-client/internal/huma"
	"github.com/mjacniacki/neonrain/discord-user-client/pkg/types"
)

// ConfigProvider provides config for a specific guild
type ConfigProvider interface {
	GetConfigForGuild(guildID string) (types.UserConfig, bool)
}

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
	websites          []types.WebsiteData
	historyManager    *history.MessageHistoryManager
	botUsername       string
	humaManager       *huma.Manager
	backendClient     *backend.Client

	// Multi-guild support
	monitoredGuilds map[string]bool // guildID -> true
	configProvider  ConfigProvider
	mu              sync.RWMutex
}

// NewDiscordClient creates a new Discord client (single-guild mode for backward compatibility)
func NewDiscordClient(humaManager *huma.Manager, backendClient *backend.Client) *DiscordClient {
	return &DiscordClient{
		historyManager:  history.NewMessageHistoryManager(),
		humaManager:     humaManager,
		backendClient:   backendClient,
		monitoredGuilds: make(map[string]bool),
	}
}

// NewMultiGuildDiscordClient creates a new Discord client with multi-guild support
func NewMultiGuildDiscordClient(humaManager *huma.Manager, backendClient *backend.Client, configProvider ConfigProvider) *DiscordClient {
	return &DiscordClient{
		historyManager:  history.NewMessageHistoryManager(),
		humaManager:     humaManager,
		backendClient:   backendClient,
		monitoredGuilds: make(map[string]bool),
		configProvider:  configProvider,
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
	dc.websites = config.Websites
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
						dc.humaManager.SetWebsites(dc.websites)
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
	dc.websites = config.Websites

	// Update HUMA manager with new config
	if dc.humaManager != nil {
		dc.humaManager.SetConfig(dc.personality, dc.rules, dc.information)
		dc.humaManager.SetWebsites(dc.websites)
	}

	if dc.selectedGuildID != "" {
		log.Printf("Updated: Monitoring all channels in server: %s", dc.selectedGuildName)
	} else {
		log.Printf("Updated: No server selected")
	}
}

// isFromSelectedGuild checks if a message is from a monitored guild
func (dc *DiscordClient) isFromSelectedGuild(guildID string) bool {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	// Multi-guild mode: check if guild is in monitored list
	if len(dc.monitoredGuilds) > 0 {
		return dc.monitoredGuilds[guildID]
	}

	// Single-guild mode (backward compatibility)
	if dc.selectedGuildID == "" {
		return false
	}
	return guildID == dc.selectedGuildID
}

// UpdateMonitoredGuilds updates the list of guilds this client monitors
func (dc *DiscordClient) UpdateMonitoredGuilds(guildIDs []string) {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	// Check if anything changed
	if len(guildIDs) == len(dc.monitoredGuilds) {
		allMatch := true
		for _, guildID := range guildIDs {
			if !dc.monitoredGuilds[guildID] {
				allMatch = false
				break
			}
		}
		if allMatch {
			return // No changes
		}
	}

	// Clear old guilds
	dc.monitoredGuilds = make(map[string]bool)

	// Add new guilds
	for _, guildID := range guildIDs {
		dc.monitoredGuilds[guildID] = true
	}

	if len(guildIDs) > 0 {
		log.Printf("[Discord] Now monitoring %d guild(s)", len(guildIDs))
	} else {
		log.Printf("[Discord] No guilds to monitor")
	}
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

	// Get guild-specific config if available (multi-guild mode)
	var personality, rules, information string
	var websites []types.WebsiteData
	var guildName string
	var userID string

	if dc.configProvider != nil {
		config, exists := dc.configProvider.GetConfigForGuild(guildID)
		if !exists {
			// Guild not in our config, skip
			return
		}
		if !config.BotActive {
			// Bot is not active for this guild, skip
			return
		}
		guildName = config.SelectedGuildName
		personality = config.Personality
		rules = config.Rules
		information = config.Information
		websites = config.Websites
		userID = config.UserID
	}

	// Fallback to stored values (single-guild mode)
	if guildName == "" {
		guildName = dc.selectedGuildName
	}
	if guildName == "" {
		guild, err := dc.session.Guild(guildID)
		if err == nil && guild != nil {
			guildName = guild.Name
		} else {
			guildName = guildID
		}
	}
	if personality == "" {
		personality = dc.personality
	}
	if rules == "" {
		rules = dc.rules
	}
	if information == "" {
		information = dc.information
	}
	if len(websites) == 0 {
		websites = dc.websites
	}
	if userID == "" {
		userID = dc.userID
	}

	log.Printf("[HUMA] Message from #%s in %s - %s: %s", channelName, guildName, msg.Author.Username, msg.Content)

	// Report message received to backend
	if dc.backendClient != nil && userID != "" {
		go func() {
			if err := dc.backendClient.ReportStats(userID, "message_received"); err != nil {
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

	// Update agent config with guild-specific settings
	agent.UpdateConfig(dc, dc.historyManager, personality, rules, information, websites)

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
		// Connection might be dead - reconnect and retry
		// Covers: "websocket: close", "connection reset", "i/o timeout", "EOF", etc.
		errStr := err.Error()
		isConnectionError := strings.Contains(errStr, "websocket") ||
			strings.Contains(errStr, "close") ||
			strings.Contains(errStr, "reset") ||
			strings.Contains(errStr, "timeout") ||
			strings.Contains(errStr, "EOF") ||
			strings.Contains(errStr, "broken pipe")
		if isConnectionError {
			log.Printf("[HUMA] Connection dead, reconnecting...")
			dc.humaManager.RemoveAgent(guildID)

			// Reconnect and retry once
			agent, err = dc.humaManager.GetOrCreateAgent(guildID, guildName)
			if err != nil {
				log.Printf("[HUMA] Failed to reconnect: %v", err)
				return
			}
			agent.UpdateConfig(dc, dc.historyManager, personality, rules, information, websites)

			err = agent.SendNewMessage(
				channelID,
				channelName,
				msg.Author.ID,
				msg.Author.Username,
				msg.Content,
				msg.ID,
			)
			if err != nil {
				log.Printf("[HUMA] Retry failed: %v", err)
			} else {
				log.Printf("[HUMA] Reconnected and sent message successfully")
			}
		}
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

	// Report message sent to backend - find the correct user for this channel's guild
	if dc.backendClient != nil {
		go func() {
			// Determine which user to report stats for
			userID := dc.userID // fallback to default

			// In multi-guild mode, look up the user from the channel's guild
			if dc.configProvider != nil {
				channel, err := dc.session.Channel(channelID)
				if err == nil && channel != nil {
					if config, exists := dc.configProvider.GetConfigForGuild(channel.GuildID); exists {
						userID = config.UserID
					}
				}
			}

			if userID != "" {
				if err := dc.backendClient.ReportStats(userID, "message_sent"); err != nil {
					log.Printf("[Stats] Failed to report message_sent: %v", err)
				}
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

// GetWebsites returns the websites configuration
func (dc *DiscordClient) GetWebsites() []types.WebsiteData {
	return dc.websites
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

// GetAllChannelsForGuild returns all channels in the guild with their types
func (dc *DiscordClient) GetAllChannelsForGuild(guildID string) []huma.ChannelInfo {
	var channels []huma.ChannelInfo

	if dc.session == nil {
		return channels
	}

	// Get all channels from the guild
	guildChannels, err := dc.session.GuildChannels(guildID)
	if err != nil {
		log.Printf("[Discord] Failed to get guild channels: %v", err)
		return channels
	}

	for _, ch := range guildChannels {
		channelType := "unknown"
		switch ch.Type {
		case discordgo.ChannelTypeGuildText:
			channelType = "text"
		case discordgo.ChannelTypeGuildVoice:
			channelType = "voice"
		case discordgo.ChannelTypeGuildCategory:
			channelType = "category"
		case discordgo.ChannelTypeGuildNews:
			channelType = "news"
		case discordgo.ChannelTypeGuildForum:
			channelType = "forum"
		case discordgo.ChannelTypeGuildStageVoice:
			channelType = "stage"
		}

		channels = append(channels, huma.ChannelInfo{
			ID:   ch.ID,
			Name: ch.Name,
			Type: channelType,
		})
	}

	return channels
}

// FetchChannelMessages fetches messages from a specific channel
func (dc *DiscordClient) FetchChannelMessages(channelID string, limit int) ([]history.Message, error) {
	if dc.session == nil {
		return nil, fmt.Errorf("no active Discord session")
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	messages, err := dc.session.ChannelMessages(channelID, limit, "", "", "")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch messages: %w", err)
	}

	// Convert to history.Message format (messages come newest first, reverse them)
	result := make([]history.Message, 0, len(messages))
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		result = append(result, history.Message{
			ID:        msg.ID,
			ChannelID: msg.ChannelID,
			Author:    msg.Author.Username,
			AuthorID:  msg.Author.ID,
			Content:   msg.Content,
			Timestamp: msg.Timestamp.Format("2006-01-02 15:04:05"),
		})
	}

	return result, nil
}
