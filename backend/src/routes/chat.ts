import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { prisma } from '../lib/prisma.js';
import { getOrCreateUser } from '../middleware/clerk.js';

const router = Router();

// GET /api/chat/conversation - Get or create user's conversation with message history
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

    // Get or create conversation
    let conversation = await prisma.chatConversation.findUnique({
      where: { userId: user.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50, // Last 50 messages
        },
      },
    });

    if (!conversation) {
      conversation = await prisma.chatConversation.create({
        data: { userId: user.id },
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

// GET /api/chat/conversation/messages - Get paginated message history
router.get('/conversation/messages', requireAuth(), async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await getOrCreateUser(auth.userId);
    const { before, limit = '50' } = req.query;
    const messageLimit = Math.min(100, parseInt(limit as string, 10) || 50);

    const conversation = await prisma.chatConversation.findUnique({
      where: { userId: user.id },
    });

    if (!conversation) {
      return res.json({ success: true, messages: [], hasMore: false });
    }

    const whereClause: { conversationId: string; createdAt?: { lt: Date } } = {
      conversationId: conversation.id,
    };
    if (before) {
      whereClause.createdAt = { lt: new Date(before as string) };
    }

    const messages = await prisma.chatMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: messageLimit + 1, // Get one extra to check if there are more
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

// DELETE /api/chat/conversation - Clear conversation and all messages
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

    console.log(`[Chat] User ${user.id} cleared conversation`);

    res.json({ success: true, message: 'Conversation cleared' });
  } catch (error) {
    console.error('Clear conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
