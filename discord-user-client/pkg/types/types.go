package types

// WebsiteData represents scraped website content
type WebsiteData struct {
	URL       string `json:"url"`
	Name      string `json:"name"`
	Markdown  string `json:"markdown"`
	ScrapedAt string `json:"scrapedAt"`
}

// ServerConfig represents per-server bot configuration
type ServerConfig struct {
	GuildID     string        `json:"guildId"`
	GuildName   string        `json:"guildName"`
	BotActive   bool          `json:"botActive"`
	BotName     string        `json:"botName"`
	Personality string        `json:"personality"`
	Rules       string        `json:"rules"`
	Information string        `json:"information"`
	Websites    []WebsiteData `json:"websites"`
}

// TokenConfig represents a user's token with all their server configs
type TokenConfig struct {
	DiscordToken string         `json:"discordToken"`
	UserID       string         `json:"userId"`
	Servers      []ServerConfig `json:"servers"`
}

// TokenResponse represents the response from the backend API (new multi-server format)
type TokenResponse struct {
	Success bool          `json:"success"`
	Tokens  []TokenConfig `json:"tokens"`
}

// UserConfig represents a user's Discord configuration (for internal use)
// Deprecated: Use TokenConfig + ServerConfig instead
type UserConfig struct {
	UserID            string
	Token             string
	Email             string
	BotActive         bool // Whether the bot should respond to messages
	SelectedGuildID   string
	SelectedGuildName string
	Personality       string
	Rules             string
	Information       string
	Websites          []WebsiteData
}

// GuildInfo represents a Discord guild
type GuildInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// ChannelListInfo represents a Discord channel for API responses
type ChannelListInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type int    `json:"type"`
}
