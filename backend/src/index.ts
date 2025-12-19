import express, { Request, Response } from 'express';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import discordRoutes from './routes/discord.js';
import { prisma } from './lib/prisma.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Clerk middleware - must be before routes that use auth
app.use(clerkMiddleware());

// Request logging middleware (exclude noisy polling endpoints)
app.use((req, res, next) => {
  // Skip logging for frequently polled endpoints to reduce noise
  if (req.path === '/api/discord/tokens' || req.path === '/health') {
    return next();
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.headers.authorization) {
    console.log(`  Auth: ${req.headers.authorization.substring(0, 20)}...`);
  }
  next();
});

// Routes
app.use('/api/discord', discordRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'chrome-extension-backend'
  });
});

// Status endpoint
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    online: true,
    message: 'Backend is running successfully',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Simple test endpoint
app.get('/api/test', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Hello from backend!',
    data: {
      random: Math.floor(Math.random() * 1000)
    }
  });
});

// Cleanup expired pending tokens every 5 minutes
setInterval(async () => {
  try {
    const deleted = await prisma.pendingDiscordToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        claimed: false
      }
    });
    if (deleted.count > 0) {
      console.log(`[Cleanup] Deleted ${deleted.count} expired pending tokens`);
    }
  } catch (error) {
    console.error('[Cleanup] Error deleting expired tokens:', error);
  }
}, 5 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Status: http://localhost:${PORT}/api/status`);
});
