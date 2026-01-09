const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

export async function fetchWithAuth(path: string, token: string, options?: RequestInit) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export async function getDiscordStatus(token: string) {
  return fetchWithAuth('/api/discord/status', token);
}

export async function claimDiscordToken(token: string, claimCode: string) {
  return fetchWithAuth('/api/discord/claim-token', token, {
    method: 'POST',
    body: JSON.stringify({ claimCode }),
  });
}

export async function disconnectDiscord(token: string) {
  return fetchWithAuth('/api/discord/disconnect', token, {
    method: 'POST',
  });
}

export async function getDiscordBotStatus(token: string): Promise<{ success: boolean; active: boolean }> {
  return fetchWithAuth('/api/discord/bot-status', token);
}

export async function setDiscordBotStatus(token: string, active: boolean): Promise<{ success: boolean; active: boolean }> {
  return fetchWithAuth('/api/discord/bot-status', token, {
    method: 'POST',
    body: JSON.stringify({ active }),
  });
}

export async function getSelectedGuild(token: string) {
  return fetchWithAuth('/api/discord/guild', token);
}

export async function saveSelectedGuild(token: string, guildId: string, guildName: string) {
  return fetchWithAuth('/api/discord/guild', token, {
    method: 'POST',
    body: JSON.stringify({ guildId, guildName }),
  });
}

export async function removeSelectedGuild(token: string) {
  return fetchWithAuth('/api/discord/guild', token, {
    method: 'DELETE',
  });
}

export async function getGuilds(token: string) {
  return fetchWithAuth('/api/discord/guilds', token);
}

export interface AgentConfig {
  personality: string;
  rules: string;
  information: string;
}

export async function getAgentConfig(token: string) {
  return fetchWithAuth('/api/discord/config', token);
}

export async function saveAgentConfig(token: string, config: Partial<AgentConfig>) {
  return fetchWithAuth('/api/discord/config', token, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// Server configuration (multi-server support)
export interface ServerConfig {
  id: string;
  serverId: string;
  guildId: string;
  guildName: string;
  botName: string;
  botActive: boolean;
  personality: string;
  rules: string;
  information: string;
  messagesSentCount: number;
  messagesReceivedCount: number;
  lastMessageSentAt: string | null;
  lastMessageReceivedAt: string | null;
  websiteCount: number;
}

export async function getServerConfigs(token: string): Promise<{ success: boolean; servers: ServerConfig[] }> {
  return fetchWithAuth('/api/server-configs', token);
}

export async function addServerConfig(token: string, guildId: string, guildName: string): Promise<{ success: boolean; server: ServerConfig }> {
  return fetchWithAuth('/api/server-configs', token, {
    method: 'POST',
    body: JSON.stringify({ guildId, guildName }),
  });
}

export async function getServerConfig(token: string, configId: string): Promise<{ success: boolean; server: ServerConfig }> {
  return fetchWithAuth(`/api/server-configs/${configId}`, token);
}

export async function updateServerConfig(
  token: string,
  configId: string,
  config: Partial<{
    botName: string;
    personality: string;
    rules: string;
    information: string;
    botActive: boolean;
  }>
): Promise<{ success: boolean; server: ServerConfig }> {
  return fetchWithAuth(`/api/server-configs/${configId}`, token, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function deleteServerConfig(token: string, configId: string): Promise<{ success: boolean }> {
  return fetchWithAuth(`/api/server-configs/${configId}`, token, {
    method: 'DELETE',
  });
}

// Website management
export interface Website {
  id: string;
  url: string;
  name: string | null;
  lastScrapedAt: string | null;
  lastScrapeStatus: 'success' | 'error' | 'pending';
  contentSize: number;
}

export async function getServerWebsites(token: string, guildId: string): Promise<{ success: boolean; websites: Website[] }> {
  return fetchWithAuth(`/api/servers/${guildId}/websites`, token);
}

export async function addServerWebsite(token: string, guildId: string, url: string, name?: string) {
  return fetchWithAuth(`/api/servers/${guildId}/websites`, token, {
    method: 'POST',
    body: JSON.stringify({ url, name }),
  });
}

export async function removeServerWebsite(token: string, guildId: string, websiteId: string) {
  return fetchWithAuth(`/api/servers/${guildId}/websites/${websiteId}`, token, {
    method: 'DELETE',
  });
}

export async function rescrapeWebsite(token: string, guildId: string, websiteId: string) {
  return fetchWithAuth(`/api/servers/${guildId}/websites/${websiteId}/scrape`, token, {
    method: 'POST',
  });
}

export async function getWebsiteStatus(token: string, guildId: string, websiteId: string): Promise<{ success: boolean; website: Website }> {
  return fetchWithAuth(`/api/servers/${guildId}/websites/${websiteId}`, token);
}

// Chat API
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
}

export async function getChatConversation(token: string): Promise<{
  success: boolean;
  conversation: ChatConversation;
}> {
  return fetchWithAuth('/api/chat/conversation', token);
}

export async function getChatMessages(
  token: string,
  before?: string,
  limit?: number
): Promise<{
  success: boolean;
  messages: ChatMessage[];
  hasMore: boolean;
}> {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (limit) params.set('limit', limit.toString());

  const query = params.toString();
  return fetchWithAuth(`/api/chat/conversation/messages${query ? `?${query}` : ''}`, token);
}

export async function clearChatConversation(token: string): Promise<{ success: boolean }> {
  return fetchWithAuth('/api/chat/conversation', token, { method: 'DELETE' });
}
