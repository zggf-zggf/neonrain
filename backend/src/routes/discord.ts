import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/auth.js';

const router = Router();

// Save Discord token for user
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { discordToken } = req.body;

    if (!discordToken) {
      return res.status(400).json({ error: 'Discord token is required' });
    }

    // Update user with Discord token
    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: { discordToken }
    });

    res.json({
      success: true,
      message: 'Discord connected successfully',
      user: {
        id: user.id,
        email: user.email,
        hasDiscord: !!user.discordToken
      }
    });
  } catch (error) {
    console.error('Discord connect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Discord connection status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        discordToken: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      connected: !!user.discordToken,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Discord status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Disconnect Discord
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    await prisma.user.update({
      where: { id: decoded.userId },
      data: { discordToken: null }
    });

    res.json({
      success: true,
      message: 'Discord disconnected successfully'
    });
  } catch (error) {
    console.error('Discord disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
