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

    // Get or create user in our database
    const user = await getOrCreateUser(auth.userId);

    // Transaction: update user with Discord token and mark pending as claimed
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { discordToken: pending.discordToken }
      }),
      prisma.pendingDiscordToken.update({
        where: { id: pending.id },
        data: {
          claimed: true,
          claimedByUserId: user.id
        }
      })
    ]);

    console.log(`[Claim Token] User ${user.id} claimed Discord token with code ${normalizedCode}`);

    res.json({
      success: true,
      message: 'Discord token claimed successfully'
    });
  } catch (error) {
    console.error('Claim token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Discord connection status and stats
router.get('/status', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    res.json({
      success: true,
      connected: !!user.discordToken,
      user: {
        id: user.id,
        email: user.email
      },
      selectedGuild: user.selectedGuildId ? {
        id: user.selectedGuildId,
        name: user.selectedGuildName
      } : null,
      stats: {
        lastMessageSentAt: user.lastMessageSentAt,
        lastMessageReceivedAt: user.lastMessageReceivedAt,
        messagesSentCount: user.messagesSentCount,
        messagesReceivedCount: user.messagesReceivedCount
      }
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

// Save selected guild (server) for user
router.post('/guild', requireAuth(), async (req: Request, res: Response) => {
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

    // Update user with selected guild and server relation
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        selectedGuildId: guildId,
        selectedGuildName: guildName,
        serverId: server.id
      }
    });

    res.json({
      success: true,
      message: 'Server saved successfully',
      guild: {
        id: updatedUser.selectedGuildId,
        name: updatedUser.selectedGuildName
      }
    });
  } catch (error) {
    console.error('Save guild error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get selected guild for user
router.get('/guild', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    res.json({
      success: true,
      guild: user.selectedGuildId ? {
        id: user.selectedGuildId,
        name: user.selectedGuildName
      } : null
    });
  } catch (error) {
    console.error('Get guild error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove selected guild
router.delete('/guild', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        selectedGuildId: null,
        selectedGuildName: null,
        serverId: null
      }
    });

    res.json({
      success: true,
      message: 'Server removed successfully'
    });
  } catch (error) {
    console.error('Remove guild error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save agent configuration (personality, rules, information)
router.post('/config', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { personality, rules, information } = req.body;

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

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Configuration saved successfully',
      config: {
        personality: updatedUser.personality || '',
        rules: updatedUser.rules || '',
        information: updatedUser.information || ''
      }
    });
  } catch (error) {
    console.error('Save config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get agent configuration
router.get('/config', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    res.json({
      success: true,
      config: {
        personality: user.personality || '',
        rules: user.rules || '',
        information: user.information || ''
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
router.post('/stats', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

    if (apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId, event } = req.body;

    if (!userId || !event) {
      return res.status(400).json({ error: 'userId and event are required' });
    }

    if (!['message_sent', 'message_received'].includes(event)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    const now = new Date();

    if (event === 'message_sent') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          lastMessageSentAt: now,
          messagesSentCount: { increment: 1 }
        }
      });
    } else if (event === 'message_received') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          lastMessageReceivedAt: now,
          messagesReceivedCount: { increment: 1 }
        }
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    // User not found is ok - might be deleted
    if (error.code === 'P2025') {
      return res.json({ success: true, message: 'User not found' });
    }
    console.error('Stats update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all Discord tokens (internal endpoint for discord-user-client service)
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    // Simple API key authentication for internal service
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

    if (apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all users with Discord tokens, including their server websites
    const users = await prisma.user.findMany({
      where: {
        discordToken: {
          not: null
        }
      },
      select: {
        id: true,
        email: true,
        discordToken: true,
        selectedGuildId: true,
        selectedGuildName: true,
        personality: true,
        rules: true,
        information: true,
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

    res.json({
      success: true,
      tokens: users.map(user => ({
        userId: user.id,
        userEmail: user.email,
        discordToken: user.discordToken,
        selectedGuildId: user.selectedGuildId,
        selectedGuildName: user.selectedGuildName,
        personality: user.personality || '',
        rules: user.rules || '',
        information: user.information || '',
        websites: user.server?.websites.map(w => ({
          url: w.url,
          name: w.name || '',
          markdown: w.scrapes[0]?.markdownContent || '',
          scrapedAt: w.scrapes[0]?.scrapedAt?.toISOString() || ''
        })) || []
      }))
    });
  } catch (error) {
    console.error('Discord tokens list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
