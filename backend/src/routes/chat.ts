import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { getOrCreateUser } from '../middleware/clerk.js';

const router = Router();

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

    // Check if user has required configuration
    if (!user.selectedGuildId) {
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

    // Check if user has required configuration
    if (!user.selectedGuildId) {
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
