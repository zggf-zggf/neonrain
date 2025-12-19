package types

// UserConfig represents a user's Discord configuration
type UserConfig struct {
	UserID            string
	Token             string
	Email             string
	SelectedGuildID   string
	SelectedGuildName string
	Personality       string
	Rules             string
	Information       string
}

// TokenResponse represents the response from the backend API
type TokenResponse struct {
	Success bool `json:"success"`
	Tokens  []struct {
		UserID            string `json:"userId"`
		UserEmail         string `json:"userEmail"`
		DiscordToken      string `json:"discordToken"`
		SelectedGuildID   string `json:"selectedGuildId"`
		SelectedGuildName string `json:"selectedGuildName"`
		Personality       string `json:"personality"`
		Rules             string `json:"rules"`
		Information       string `json:"information"`
	} `json:"tokens"`
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
