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
