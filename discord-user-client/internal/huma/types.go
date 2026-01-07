package huma

// AgentMetadata defines the agent configuration for HUMA
type AgentMetadata struct {
	ClassName    string           `json:"className"`
	Personality  string           `json:"personality"`
	Instructions string           `json:"instructions"`
	Tools        []ToolDefinition `json:"tools"`
	RouterType   string           `json:"routerType"`
}

// ToolDefinition defines a tool that HUMA can call
type ToolDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  []ToolParameter `json:"parameters"`
}

// ToolParameter defines a parameter for a tool
type ToolParameter struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

// CreateAgentRequest is the request body for creating an agent
type CreateAgentRequest struct {
	Name      string        `json:"name"`
	AgentType string        `json:"agentType"`
	Metadata  AgentMetadata `json:"metadata"`
}

// CreateAgentResponse is the response from creating an agent
type CreateAgentResponse struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	AgentType string        `json:"agentType"`
	Metadata  AgentMetadata `json:"metadata"`
	State     string        `json:"state"`
	CreatedAt string        `json:"createdAt"`
}

// HumaEvent is the base event structure sent to HUMA
type HumaEvent struct {
	Type    string      `json:"type"`
	Content interface{} `json:"content"`
}

// ContextUpdateContent is the content for context update events
type ContextUpdateContent struct {
	Name        string                 `json:"name"`
	Context     map[string]interface{} `json:"context"`
	Description string                 `json:"description"`
}

// ToolResultContent is the content for tool result events
type ToolResultContent struct {
	Type                    string                 `json:"type"`
	ToolCallID              string                 `json:"toolCallId"`
	Status                  string                 `json:"status,omitempty"` // "completed" or "canceled"
	Success                 bool                   `json:"success"`
	Result                  interface{}            `json:"result,omitempty"`
	Error                   string                 `json:"error,omitempty"`
	SkipImmediateProcessing bool                   `json:"skipImmediateProcessing,omitempty"`
	Context                 map[string]interface{} `json:"context,omitempty"`
}

// ServerEvent represents events received from HUMA server
type ServerEvent struct {
	Type       string                 `json:"type"`
	Status     string                 `json:"status,omitempty"`
	ToolCallID string                 `json:"toolCallId,omitempty"`
	ToolName   string                 `json:"toolName,omitempty"`
	Arguments  map[string]interface{} `json:"arguments,omitempty"`
	Reason     string                 `json:"reason,omitempty"`
	Message    string                 `json:"message,omitempty"`
	Code       string                 `json:"code,omitempty"`
}

// DiscordContext represents the state sent to HUMA for a guild
type DiscordContext struct {
	Guild          GuildContext             `json:"guild"`
	You            BotContext               `json:"you"`
	Channels       map[string]ChannelState  `json:"channels"`
	CurrentMessage *MessageContext          `json:"currentMessage,omitempty"`
	RecentHistory  []HistoryEntry           `json:"recentHistory"`
}

// GuildContext represents the Discord guild info
type GuildContext struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// BotContext represents the bot's own data
type BotContext struct {
	Name             string   `json:"name"`
	SelectedChannels []string `json:"selectedChannels"`
}

// ChannelState represents the state of a channel
type ChannelState struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Messages []MessageContext `json:"messages"`
}

// MessageContext represents a message in the context
type MessageContext struct {
	ID        string `json:"id"`
	ChannelID string `json:"channelId"`
	Author    string `json:"author"`
	AuthorID  string `json:"authorId"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
}

// HistoryEntry represents a recent event for context
type HistoryEntry struct {
	Type        string `json:"type"`
	Description string `json:"description"`
	Timestamp   string `json:"timestamp"`
}

// SendMessageArgs represents the arguments for send_message tool
type SendMessageArgs struct {
	ChannelID string `json:"channel_id"`
	Message   string `json:"message"`
}
