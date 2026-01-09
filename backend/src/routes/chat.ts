import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { getOrCreateUser } from '../middleware/clerk.js';

const router = Router();

// Preset colors for personas (auto-assigned)
const PERSONA_COLORS = [
  '#818cf8', // indigo
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#f87171', // red
  '#4ade80', // green
];

// ============================================================================
// PERSONA ENDPOINTS
// ============================================================================

// GET /api/chat/personas - List all personas for user
router.get('/personas', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    const personas = await prisma.chatPersona.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      success: true,
      personas: personas.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
      })),
    });
  } catch (error) {
    console.error('List personas error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/personas - Create new persona
router.post('/personas', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { nickname } = req.body;

    if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
      return res.status(400).json({ error: 'Nickname is required' });
    }

    if (nickname.trim().length > 32) {
      return res.status(400).json({ error: 'Nickname must be 32 characters or less' });
    }

    // Count existing personas to pick next color
    const existingCount = await prisma.chatPersona.count({
      where: { userId: user.id },
    });

    const color = PERSONA_COLORS[existingCount % PERSONA_COLORS.length];

    const persona = await prisma.chatPersona.create({
      data: {
        userId: user.id,
        nickname: nickname.trim(),
        color,
      },
    });

    console.log(`[Chat] User ${user.id} created persona: ${persona.nickname}`);

    res.json({
      success: true,
      persona: {
        id: persona.id,
        nickname: persona.nickname,
        color: persona.color,
      },
    });
  } catch (error) {
    console.error('Create persona error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/personas/:id - Delete persona
router.delete('/personas/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;

    // Verify user owns this persona
    const existing = await prisma.chatPersona.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    await prisma.chatPersona.delete({
      where: { id },
    });

    console.log(`[Chat] User ${user.id} deleted persona: ${existing.nickname}`);

    res.json({ success: true, message: 'Persona deleted' });
  } catch (error) {
    console.error('Delete persona error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// CONVERSATION GROUP ENDPOINTS
// ============================================================================

// GET /api/chat/groups - List all conversation groups for user (newest first)
router.get('/groups', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    const groups = await prisma.chatConversationGroup.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        server: true,
        conversations: {
          select: {
            id: true,
            paneIndex: true,
            _count: { select: { messages: true } },
          },
          orderBy: { paneIndex: 'asc' },
        },
      },
    });

    res.json({
      success: true,
      groups: groups.map((g) => ({
        id: g.id,
        title: g.title,
        paneCount: g.paneCount,
        serverId: g.serverId,
        serverName: g.server.guildName,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        conversations: g.conversations.map((c) => ({
          id: c.id,
          paneIndex: c.paneIndex,
          messageCount: c._count.messages,
        })),
      })),
    });
  } catch (error) {
    console.error('List groups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/groups - Create new conversation group
router.post('/groups', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { paneCount, serverId } = req.body;

    // Validate paneCount
    if (![1, 3, 5].includes(paneCount)) {
      return res.status(400).json({ error: 'paneCount must be 1, 3, or 5' });
    }

    // Validate serverId
    if (!serverId || typeof serverId !== 'string') {
      return res.status(400).json({ error: 'serverId is required' });
    }

    // Verify the server config belongs to this user
    const serverConfig = await prisma.userServerConfig.findFirst({
      where: {
        userId: user.id,
        serverId: serverId,
      },
      include: {
        server: true,
      },
    });

    if (!serverConfig) {
      return res.status(400).json({
        error: 'Server not found or not configured',
        code: 'INVALID_SERVER',
      });
    }

    // Create group with conversations in a transaction
    const group = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.chatConversationGroup.create({
        data: {
          userId: user.id,
          serverId: serverId,
          title: 'New chat',
          paneCount,
        },
      });

      // Create conversations for each pane
      const conversationPromises = [];
      for (let i = 0; i < paneCount; i++) {
        conversationPromises.push(
          tx.chatConversation.create({
            data: {
              userId: user.id,
              groupId: newGroup.id,
              paneIndex: i,
              title: `Pane ${i + 1}`,
            },
          })
        );
      }
      const conversations = await Promise.all(conversationPromises);

      return { ...newGroup, conversations, server: serverConfig.server };
    });

    console.log(`[Chat] User ${user.id} created group ${group.id} with ${paneCount} panes for server ${serverConfig.server.guildName}`);

    res.json({
      success: true,
      group: {
        id: group.id,
        title: group.title,
        paneCount: group.paneCount,
        serverId: group.serverId,
        serverName: group.server.guildName,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        conversations: group.conversations.map((c) => ({
          id: c.id,
          paneIndex: c.paneIndex,
          messages: [],
        })),
      },
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/groups/:id - Get specific group with all conversations and messages
router.get('/groups/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;

    const group = await prisma.chatConversationGroup.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        server: true,
        conversations: {
          orderBy: { paneIndex: 'asc' },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 50,
            },
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({
      success: true,
      group: {
        id: group.id,
        title: group.title,
        paneCount: group.paneCount,
        serverId: group.serverId,
        serverName: group.server.guildName,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        conversations: group.conversations.map((c) => ({
          id: c.id,
          paneIndex: c.paneIndex,
          messages: c.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            senderName: m.senderName,
            createdAt: m.createdAt,
          })),
        })),
      },
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/chat/groups/:id - Update group (title)
router.patch('/groups/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;
    const { title } = req.body;

    const existing = await prisma.chatConversationGroup.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = await prisma.chatConversationGroup.update({
      where: { id },
      data: { title: title || existing.title },
    });

    res.json({
      success: true,
      group: {
        id: group.id,
        title: group.title,
        updatedAt: group.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/groups/:id - Delete group and all its conversations
router.delete('/groups/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;

    const existing = await prisma.chatConversationGroup.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Cascade delete will handle conversations and messages
    await prisma.chatConversationGroup.delete({
      where: { id },
    });

    console.log(`[Chat] User ${user.id} deleted group ${id}`);

    res.json({ success: true, message: 'Group deleted' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// CONVERSATION ENDPOINTS
// ============================================================================

// GET /api/chat/conversations - List all conversations for user (newest first)
router.get('/conversations', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    const conversations = await prisma.chatConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    res.json({
      success: true,
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c._count.messages,
      })),
    });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/chat/conversations - Create new conversation
router.post('/conversations', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Check if user has at least one server configured
    const serverConfigCount = await prisma.userServerConfig.count({
      where: { userId: user.id }
    });

    if (serverConfigCount === 0) {
      return res.status(400).json({
        error: 'No server configured',
        code: 'NO_SERVER_CONFIGURED',
      });
    }

    const conversation = await prisma.chatConversation.create({
      data: {
        userId: user.id,
        title: 'New conversation',
      },
    });

    console.log(`[Chat] User ${user.id} created new conversation ${conversation.id}`);

    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: [],
      },
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/conversations/:id - Get specific conversation with messages
router.get('/conversations/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;

    const conversation = await prisma.chatConversation.findFirst({
      where: {
        id,
        userId: user.id, // Ensure user owns this conversation
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50, // Last 50 messages
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          senderName: m.senderName,
          createdAt: m.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/chat/conversations/:id/messages - Get paginated messages for conversation
router.get('/conversations/:id/messages', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;
    const { before, limit = '50' } = req.query;
    const messageLimit = Math.min(100, parseInt(limit as string, 10) || 50);

    // Verify user owns this conversation
    const conversation = await prisma.chatConversation.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const whereClause: { conversationId: string; createdAt?: { lt: Date } } = {
      conversationId: id,
    };
    if (before) {
      whereClause.createdAt = { lt: new Date(before as string) };
    }

    const messages = await prisma.chatMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: messageLimit + 1,
    });

    const hasMore = messages.length > messageLimit;
    if (hasMore) messages.pop();

    res.json({
      success: true,
      messages: messages.reverse().map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        senderName: m.senderName,
        createdAt: m.createdAt,
      })),
      hasMore,
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/chat/conversations/:id - Update conversation (title)
router.patch('/conversations/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;
    const { title } = req.body;

    // Verify user owns this conversation
    const existing = await prisma.chatConversation.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = await prisma.chatConversation.update({
      where: { id },
      data: { title: title || existing.title },
    });

    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/conversations/:id - Delete specific conversation
router.delete('/conversations/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { id } = req.params;

    // Verify user owns this conversation
    const existing = await prisma.chatConversation.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await prisma.chatConversation.delete({
      where: { id },
    });

    console.log(`[Chat] User ${user.id} deleted conversation ${id}`);

    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// LEGACY ENDPOINTS (for backwards compatibility - redirect to first conversation)
// ============================================================================

// GET /api/chat/conversation - Get or create user's first conversation (legacy)
router.get('/conversation', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    // Check if user has at least one server configured
    const serverConfigCount = await prisma.userServerConfig.count({
      where: { userId: user.id }
    });

    if (serverConfigCount === 0) {
      return res.status(400).json({
        error: 'No server configured',
        code: 'NO_SERVER_CONFIGURED',
      });
    }

    // Get most recent conversation or create one
    let conversation = await prisma.chatConversation.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
        },
      },
    });

    if (!conversation) {
      conversation = await prisma.chatConversation.create({
        data: { userId: user.id, title: 'New conversation' },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    }

    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        messages: conversation.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          senderName: m.senderName,
          createdAt: m.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/chat/conversation - Clear all conversations (legacy)
router.delete('/conversation', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);

    await prisma.chatConversation.deleteMany({
      where: { userId: user.id },
    });

    console.log(`[Chat] User ${user.id} cleared all conversations`);

    res.json({ success: true, message: 'All conversations cleared' });
  } catch (error) {
    console.error('Clear conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
