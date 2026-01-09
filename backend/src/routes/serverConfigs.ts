import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { getOrCreateUser } from '../middleware/clerk.js';

const router = Router();

// Helper to fetch Discord user info from token
async function fetchDiscordUserInfo(token: string): Promise<{ username: string; id: string } | null> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: token,
      },
    });

    if (!response.ok) {
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

// GET /api/server-configs - List all server configs for authenticated user
router.get('/', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    const configs = await prisma.userServerConfig.findMany({
      where: { userId: user.id },
      include: {
        server: {
          include: {
            websites: {
              select: { id: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({
      success: true,
      servers: configs.map(c => ({
        id: c.id,
        serverId: c.server.id,
        guildId: c.server.guildId,
        guildName: c.server.guildName,
        botName: c.botName,
        botActive: c.botActive,
        personality: c.personality,
        rules: c.rules,
        information: c.information,
        messagesSentCount: c.messagesSentCount,
        messagesReceivedCount: c.messagesReceivedCount,
        lastMessageSentAt: c.lastMessageSentAt,
        lastMessageReceivedAt: c.lastMessageReceivedAt,
        websiteCount: c.server.websites.length
      }))
    });
  } catch (error) {
    console.error('List server configs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/server-configs - Add new server configuration
router.post('/', requireAuth(), async (req: Request, res: Response) => {
  try {
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

    // Check if user already has config for this server
    const existing = await prisma.userServerConfig.findUnique({
      where: {
        userId_serverId: {
          userId: user.id,
          serverId: server.id
        }
      }
    });

    if (existing) {
      return res.status(400).json({ error: 'Server already configured', existingConfigId: existing.id });
    }

    // Get Discord username for default bot name
    let botName = 'Assistant';
    if (user.discordToken) {
      const discordUser = await fetchDiscordUserInfo(user.discordToken);
      if (discordUser?.username) {
        botName = discordUser.username;
      }
    }

    const config = await prisma.userServerConfig.create({
      data: {
        userId: user.id,
        serverId: server.id,
        botName
      },
      include: {
        server: true
      }
    });

    console.log(`[Server Config] Created config ${config.id} for user ${user.id}, server ${server.guildName}`);

    res.json({
      success: true,
      server: {
        id: config.id,
        serverId: config.server.id,
        guildId: config.server.guildId,
        guildName: config.server.guildName,
        botName: config.botName,
        botActive: config.botActive,
        personality: config.personality,
        rules: config.rules,
        information: config.information,
        messagesSentCount: config.messagesSentCount,
        messagesReceivedCount: config.messagesReceivedCount,
        lastMessageSentAt: config.lastMessageSentAt,
        lastMessageReceivedAt: config.lastMessageReceivedAt,
        websiteCount: 0
      }
    });
  } catch (error) {
    console.error('Create server config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server-configs/:configId - Get specific server configuration
router.get('/:configId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { configId } = req.params;

    const config = await prisma.userServerConfig.findUnique({
      where: { id: configId },
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
    });

    if (!config) {
      return res.status(404).json({ error: 'Server configuration not found' });
    }

    // Verify ownership
    if (config.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      server: {
        id: config.id,
        serverId: config.server.id,
        guildId: config.server.guildId,
        guildName: config.server.guildName,
        botName: config.botName,
        botActive: config.botActive,
        personality: config.personality,
        rules: config.rules,
        information: config.information,
        messagesSentCount: config.messagesSentCount,
        messagesReceivedCount: config.messagesReceivedCount,
        lastMessageSentAt: config.lastMessageSentAt,
        lastMessageReceivedAt: config.lastMessageReceivedAt,
        websites: config.server.websites.map(w => ({
          id: w.id,
          url: w.url,
          name: w.name,
          lastScrapedAt: w.scrapes[0]?.scrapedAt,
          lastScrapeStatus: w.scrapes[0]?.errorMessage ? 'error' : (w.scrapes[0] ? 'success' : 'pending'),
          contentSize: w.scrapes[0]?.contentLength || 0
        }))
      }
    });
  } catch (error) {
    console.error('Get server config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/server-configs/:configId - Update server configuration
router.put('/:configId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { configId } = req.params;
    const { botName, personality, rules, information, botActive } = req.body;

    // Verify ownership
    const existing = await prisma.userServerConfig.findUnique({
      where: { id: configId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Server configuration not found' });
    }

    if (existing.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build update data - only update fields that were provided
    const updateData: {
      botName?: string;
      personality?: string;
      rules?: string;
      information?: string;
      botActive?: boolean;
    } = {};

    if (typeof botName === 'string') {
      updateData.botName = botName;
    }
    if (typeof personality === 'string') {
      updateData.personality = personality;
    }
    if (typeof rules === 'string') {
      updateData.rules = rules;
    }
    if (typeof information === 'string') {
      updateData.information = information;
    }
    if (typeof botActive === 'boolean') {
      // Additional validation: require Discord token to activate bot
      if (botActive && !user.discordToken) {
        return res.status(400).json({ error: 'Discord token required to activate bot' });
      }
      updateData.botActive = botActive;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided' });
    }

    const config = await prisma.userServerConfig.update({
      where: { id: configId },
      data: updateData,
      include: {
        server: true
      }
    });

    console.log(`[Server Config] Updated config ${config.id}: ${Object.keys(updateData).join(', ')}`);

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      server: {
        id: config.id,
        serverId: config.server.id,
        guildId: config.server.guildId,
        guildName: config.server.guildName,
        botName: config.botName,
        botActive: config.botActive,
        personality: config.personality,
        rules: config.rules,
        information: config.information
      }
    });
  } catch (error) {
    console.error('Update server config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/server-configs/:configId - Remove server configuration
router.delete('/:configId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { configId } = req.params;

    // Verify ownership
    const existing = await prisma.userServerConfig.findUnique({
      where: { id: configId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Server configuration not found' });
    }

    if (existing.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.userServerConfig.delete({
      where: { id: configId }
    });

    console.log(`[Server Config] Deleted config ${configId} for user ${user.id}`);

    res.json({
      success: true,
      message: 'Server configuration removed successfully'
    });
  } catch (error) {
    console.error('Delete server config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server-configs/:configId/actions - Get recent agent actions for a server config
router.get('/:configId/actions', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { configId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);

    // Verify ownership
    const config = await prisma.userServerConfig.findUnique({
      where: { id: configId }
    });

    if (!config) {
      return res.status(404).json({ error: 'Server configuration not found' });
    }

    if (config.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch recent agent actions
    const actions = await prisma.agentAction.findMany({
      where: { userServerConfigId: configId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    res.json({
      success: true,
      actions: actions.map(a => ({
        id: a.id,
        channelId: a.channelId,
        channelName: a.channelName,
        agentMessage: a.agentMessage,
        triggerDescription: a.triggerDescription,
        messageHistory: a.messageHistory,
        createdAt: a.createdAt
      }))
    });
  } catch (error) {
    console.error('Get agent actions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
