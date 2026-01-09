import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { getOrCreateUser } from '../middleware/clerk.js';

const router = Router();

// Helper to generate a 6-character claim code
function generateClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars (0, O, 1, I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============================================================================
// ANONYMOUS ENDPOINTS (for Chrome extension)
// ============================================================================

// Submit Discord token anonymously and get a claim code
router.post('/submit-token', async (req: Request, res: Response) => {
  try {
    const { discordToken } = req.body;

    if (!discordToken || typeof discordToken !== 'string') {
      return res.status(400).json({ error: 'Discord token is required' });
    }

    if (discordToken.length < 20) {
      return res.status(400).json({ error: 'Invalid Discord token format' });
    }

    // Generate unique claim code (retry if collision)
    let claimCode: string;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      claimCode = generateClaimCode();
      const existing = await prisma.pendingDiscordToken.findUnique({
        where: { claimCode }
      });
      if (!existing) break;
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return res.status(500).json({ error: 'Failed to generate claim code. Please try again.' });
    }

    // Create pending token with 10 minute expiry
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const pending = await prisma.pendingDiscordToken.create({
      data: {
        discordToken,
        claimCode: claimCode!,
        expiresAt
      }
    });

    console.log(`[Submit Token] Created pending token with code: ${pending.claimCode}`);

    res.json({
      success: true,
      claimCode: pending.claimCode,
      expiresAt: pending.expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Submit token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// AUTHENTICATED ENDPOINTS (require Clerk auth)
// ============================================================================

// Helper to fetch Discord user info from token
async function fetchDiscordUserInfo(token: string): Promise<{ username: string; id: string } | null> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: token, // User tokens don't need "Bearer" prefix
      },
    });

    if (!response.ok) {
      console.error(`[Discord API] Failed to fetch user info: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      username: data.username,
      id: data.id,
    };
  } catch (error) {
    console.error('[Discord API] Error fetching user info:', error);
    return null;
  }
}

// Claim a Discord token using a claim code
router.post('/claim-token', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { claimCode } = req.body;

    if (!claimCode || typeof claimCode !== 'string') {
      return res.status(400).json({ error: 'Claim code is required' });
    }

    const normalizedCode = claimCode.toUpperCase().trim();

    if (normalizedCode.length !== 6) {
      return res.status(400).json({ error: 'Claim code must be 6 characters' });
    }

    // Find pending token
    const pending = await prisma.pendingDiscordToken.findUnique({
      where: { claimCode: normalizedCode }
    });

    if (!pending) {
      return res.status(404).json({ error: 'Invalid claim code' });
    }

    if (pending.claimed) {
      return res.status(400).json({ error: 'This code has already been used' });
    }

    if (new Date() > pending.expiresAt) {
      return res.status(400).json({ error: 'This code has expired. Please generate a new one from the extension.' });
    }

    // Fetch Discord user info to get the actual username
    const discordUser = await fetchDiscordUserInfo(pending.discordToken);
    const botName = discordUser?.username || 'Assistant';

    console.log(`[Claim Token] Fetched Discord username: ${botName}`);

    // Get or create user in our database
    const user = await getOrCreateUser(auth.userId);

    // Transaction: update user with Discord token and mark pending as claimed
    // Note: botName is now stored per-server in UserServerConfig, not on User
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          discordToken: pending.discordToken,
        }
      }),
      prisma.pendingDiscordToken.update({
        where: { id: pending.id },
        data: {
          claimed: true,
          claimedByUserId: user.id
        }
      })
    ]);

    console.log(`[Claim Token] User ${user.id} claimed Discord token with code ${normalizedCode}, bot name: ${botName}`);

    res.json({
      success: true,
      message: 'Discord token claimed successfully',
      botName: botName
    });
  } catch (error) {
    console.error('Claim token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Discord connection status and aggregated stats across all servers
router.get('/status', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Get all server configurations for this user
    const serverConfigs = await prisma.userServerConfig.findMany({
      where: { userId: user.id },
      include: { server: true },
      orderBy: { updatedAt: 'desc' }
    });

    // Aggregate stats across all servers
    const totalSent = serverConfigs.reduce((sum, c) => sum + c.messagesSentCount, 0);
    const totalReceived = serverConfigs.reduce((sum, c) => sum + c.messagesReceivedCount, 0);
    const activeCount = serverConfigs.filter(c => c.botActive).length;

    res.json({
      success: true,
      connected: !!user.discordToken,
      serverCount: serverConfigs.length,
      activeServerCount: activeCount,
      user: {
        id: user.id,
        email: user.email
      },
      stats: {
        totalMessagesSent: totalSent,
        totalMessagesReceived: totalReceived
      },
      servers: serverConfigs.map(c => ({
        id: c.id,
        guildId: c.server.guildId,
        guildName: c.server.guildName,
        botActive: c.botActive,
        botName: c.botName,
        messagesSentCount: c.messagesSentCount,
        messagesReceivedCount: c.messagesReceivedCount,
        lastMessageSentAt: c.lastMessageSentAt,
        lastMessageReceivedAt: c.lastMessageReceivedAt
      }))
    });
  } catch (error) {
    console.error('Discord status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Disconnect Discord
router.post('/disconnect', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    await prisma.user.update({
      where: { id: user.id },
      data: { discordToken: null }
    });

    console.log(`[Disconnect] User ${user.id} disconnected Discord`);

    res.json({
      success: true,
      message: 'Discord disconnected successfully'
    });
  } catch (error) {
    console.error('Discord disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Save selected guild - use POST /api/server-configs instead
// Creates a new server config for backward compatibility
router.post('/guild', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] POST /api/discord/guild - Use POST /api/server-configs instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { guildId, guildName } = req.body;

    if (!guildId || typeof guildId !== 'string') {
      return res.status(400).json({ error: 'guildId is required' });
    }

    if (!guildName || typeof guildName !== 'string') {
      return res.status(400).json({ error: 'guildName is required' });
    }

    // Create or update Server record
    const server = await prisma.server.upsert({
      where: { guildId },
      update: { guildName },
      create: { guildId, guildName }
    });

    // Get Discord username for default bot name
    let botName = 'Assistant';
    if (user.discordToken) {
      const discordUser = await fetchDiscordUserInfo(user.discordToken);
      if (discordUser?.username) {
        botName = discordUser.username;
      }
    }

    // Upsert UserServerConfig (create if not exists, update name if exists)
    const config = await prisma.userServerConfig.upsert({
      where: {
        userId_serverId: {
          userId: user.id,
          serverId: server.id
        }
      },
      update: {},
      create: {
        userId: user.id,
        serverId: server.id,
        botName
      },
      include: { server: true }
    });

    res.json({
      success: true,
      message: 'Server saved successfully',
      guild: {
        id: config.server.guildId,
        name: config.server.guildName
      }
    });
  } catch (error) {
    console.error('Save guild error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Get first server config - use GET /api/server-configs instead
router.get('/guild', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] GET /api/discord/guild - Use GET /api/server-configs instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Get first server config
    const config = await prisma.userServerConfig.findFirst({
      where: { userId: user.id },
      include: { server: true },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      success: true,
      guild: config ? {
        id: config.server.guildId,
        name: config.server.guildName
      } : null
    });
  } catch (error) {
    console.error('Get guild error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Remove first server config - use DELETE /api/server-configs/:configId instead
router.delete('/guild', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] DELETE /api/discord/guild - Use DELETE /api/server-configs/:configId instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Delete first server config
    const config = await prisma.userServerConfig.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });

    if (config) {
      await prisma.userServerConfig.delete({
        where: { id: config.id }
      });
    }

    res.json({
      success: true,
      message: 'Server removed successfully'
    });
  } catch (error) {
    console.error('Remove guild error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Get bot active status for first server - use GET /api/server-configs instead
router.get('/bot-status', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] GET /api/discord/bot-status - Use GET /api/server-configs instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Get first server config
    const config = await prisma.userServerConfig.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      success: true,
      active: config?.botActive || false
    });
  } catch (error) {
    console.error('Get bot status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Set bot active status for first server - use PUT /api/server-configs/:configId instead
router.post('/bot-status', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] POST /api/discord/bot-status - Use PUT /api/server-configs/:configId instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { active } = req.body;

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active must be a boolean' });
    }

    // Get first server config
    const config = await prisma.userServerConfig.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });

    if (!config) {
      return res.status(400).json({
        error: 'A server must be configured before activating the bot'
      });
    }

    // Require Discord token to activate
    if (active && !user.discordToken) {
      return res.status(400).json({
        error: 'Discord must be connected to activate the bot'
      });
    }

    const updatedConfig = await prisma.userServerConfig.update({
      where: { id: config.id },
      data: { botActive: active }
    });

    console.log(`[Bot Status] User ${user.id} set botActive to ${active} for config ${config.id}`);

    res.json({
      success: true,
      active: updatedConfig.botActive
    });
  } catch (error) {
    console.error('Set bot status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Save agent config for first server - use PUT /api/server-configs/:configId instead
router.post('/config', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] POST /api/discord/config - Use PUT /api/server-configs/:configId instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { personality, rules, information } = req.body;

    // Get first server config
    const config = await prisma.userServerConfig.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });

    if (!config) {
      return res.status(400).json({
        error: 'A server must be configured before saving configuration'
      });
    }

    // Build update data - only update fields that were provided
    const updateData: { personality?: string; rules?: string; information?: string } = {};

    if (typeof personality === 'string') {
      updateData.personality = personality;
    }
    if (typeof rules === 'string') {
      updateData.rules = rules;
    }
    if (typeof information === 'string') {
      updateData.information = information;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'At least one field (personality, rules, information) must be provided' });
    }

    const updatedConfig = await prisma.userServerConfig.update({
      where: { id: config.id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Configuration saved successfully',
      config: {
        personality: updatedConfig.personality || '',
        rules: updatedConfig.rules || '',
        information: updatedConfig.information || ''
      }
    });
  } catch (error) {
    console.error('Save config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [DEPRECATED] Get agent config for first server - use GET /api/server-configs/:configId instead
router.get('/config', requireAuth(), async (req: Request, res: Response) => {
  try {
    console.warn('[DEPRECATED] GET /api/discord/config - Use GET /api/server-configs/:configId instead');
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Get first server config
    const config = await prisma.userServerConfig.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      success: true,
      config: {
        personality: config?.personality || '',
        rules: config?.rules || '',
        information: config?.information || ''
      }
    });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Proxy endpoint: Get guilds from Go service
router.get('/guilds', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    if (!user.discordToken) {
      return res.status(400).json({ error: 'Discord not connected' });
    }

    // Forward request to Go service with user's token for multi-user support
    const GO_SERVICE_URL = process.env.GO_SERVICE_URL || 'http://localhost:8080';
    console.log(`[Guilds] Fetching from Go service: ${GO_SERVICE_URL}/guilds`);
    const goResponse = await fetch(`${GO_SERVICE_URL}/guilds`, {
      headers: {
        'X-Discord-Token': user.discordToken
      }
    });

    if (!goResponse.ok) {
      console.log(`[Guilds] Go service returned status: ${goResponse.status}`);
      throw new Error('Failed to fetch guilds from Discord service');
    }

    const data = await goResponse.json();
    const guilds = data.guilds || [];
    console.log(`[Guilds] Success! Found ${guilds.length} guilds`);
    res.json(guilds);
  } catch (error) {
    console.error('[Guilds] Error:', error);
    res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

// ============================================================================
// INTERNAL ENDPOINTS (for Go service - API key auth)
// ============================================================================

// Update agent stats (called by Go service when messages are sent/received)
// Now requires guildId to update the correct server configuration
router.post('/stats', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

    if (apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId, event, guildId } = req.body;

    if (!userId || !event) {
      return res.status(400).json({ error: 'userId and event are required' });
    }

    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    if (!['message_sent', 'message_received'].includes(event)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    // Find the UserServerConfig for this user and guild
    const config = await prisma.userServerConfig.findFirst({
      where: {
        userId,
        server: { guildId }
      }
    });

    if (!config) {
      return res.json({ success: true, message: 'Server config not found' });
    }

    const now = new Date();

    if (event === 'message_sent') {
      await prisma.userServerConfig.update({
        where: { id: config.id },
        data: {
          lastMessageSentAt: now,
          messagesSentCount: { increment: 1 }
        }
      });
    } else if (event === 'message_received') {
      await prisma.userServerConfig.update({
        where: { id: config.id },
        data: {
          lastMessageReceivedAt: now,
          messagesReceivedCount: { increment: 1 }
        }
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    // Record not found is ok - might be deleted
    if (error.code === 'P2025') {
      return res.json({ success: true, message: 'Config not found' });
    }
    console.error('Stats update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record agent action (called by Go service when agent sends a message)
router.post('/agent-action', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

    if (apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId, guildId, channelId, channelName, agentMessage, triggerDescription, messageHistory } = req.body;

    if (!userId || !guildId || !channelId || !agentMessage) {
      return res.status(400).json({ error: 'userId, guildId, channelId, and agentMessage are required' });
    }

    // Find the UserServerConfig for this user and guild
    const config = await prisma.userServerConfig.findFirst({
      where: {
        userId,
        server: { guildId }
      }
    });

    if (!config) {
      return res.json({ success: true, message: 'Server config not found' });
    }

    // Create the agent action record
    await prisma.agentAction.create({
      data: {
        userServerConfigId: config.id,
        channelId: channelId,
        channelName: channelName || 'unknown',
        agentMessage: agentMessage,
        triggerDescription: triggerDescription || '',
        messageHistory: messageHistory || { preceding: [], agentResponse: {} }
      }
    });

    res.status(201).json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.json({ success: true, message: 'Config not found' });
    }
    console.error('Agent action error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all Discord tokens (internal endpoint for discord-user-client service)
// Returns tokens grouped with all server configurations per token
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    // Simple API key authentication for internal service
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

    if (apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all users with Discord tokens, including their server configurations
    const users = await prisma.user.findMany({
      where: {
        discordToken: {
          not: null
        }
      },
      select: {
        id: true,
        discordToken: true,
        serverConfigs: {
          include: {
            server: {
              include: {
                websites: {
                  include: {
                    scrapes: {
                      orderBy: { scrapedAt: 'desc' },
                      take: 1
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    // Group by token with multiple servers per token
    res.json({
      success: true,
      tokens: users.map(user => ({
        discordToken: user.discordToken,
        userId: user.id,
        servers: user.serverConfigs.map(config => ({
          guildId: config.server.guildId,
          guildName: config.server.guildName,
          botActive: config.botActive,
          botName: config.botName,
          personality: config.personality || '',
          rules: config.rules || '',
          information: config.information || '',
          websites: config.server.websites.map(w => ({
            url: w.url,
            name: w.name || '',
            markdown: w.scrapes[0]?.markdownContent || '',
            scrapedAt: w.scrapes[0]?.scrapedAt?.toISOString() || ''
          }))
        }))
      }))
    });
  } catch (error) {
    console.error('Discord tokens list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
