// Agent metadata for HUMA
export interface AgentMetadata {
  className: string;
  personality: string;
  instructions: string;
  tools: ToolDefinition[];
  routerType: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface CreateAgentRequest {
  name: string;
  agentType: string;
  metadata: AgentMetadata;
}

export interface CreateAgentResponse {
  id: string;
  name: string;
  agentType: string;
  metadata: AgentMetadata;
  state: string;
  createdAt: string;
}

// Events sent to HUMA
export interface HumaEvent {
  type: string;
  content: ContextUpdateContent | ToolResultContent;
}

export interface ContextUpdateContent {
  name: string;
  context: Record<string, unknown>;
  description: string;
}

export interface ToolResultContent {
  type: 'tool-result';
  toolCallId: string;
  status?: 'completed' | 'canceled';
  success: boolean;
  result?: unknown;
  error?: string;
  skipImmediateProcessing?: boolean;
  context?: Record<string, unknown>;
}

// Events received from HUMA
export interface ServerEvent {
  type: 'status' | 'tool-call' | 'cancel-tool-call' | 'error';
  status?: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  reason?: string;
  message?: string;
  code?: string;
}

// Discord-compatible context structure
// Used by both Discord bot and web chat to ensure consistent behavior
export interface DiscordContext {
  guild: {
    id: string;
    name: string;
  };
  you: {
    name: string;
  };
  currentChannel: {
    id: string;
    name: string;
    conversationHistory: string;
  };
  monitoredChannels: Array<{
    id: string;
    name: string;
    recentMessages?: string;
  }>;
  allChannels: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  userInformation?: string;
  customRules?: string;
  customPersonality?: string;
  importantWebsites?: Array<{
    name: string;
    url: string;
    scrapedAt: string;
    content: string;
  }>;
}
