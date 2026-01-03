import express, { Request, Response } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import discordRoutes from './routes/discord.js';
import serverRoutes from './routes/servers.js';
import chatRoutes from './routes/chat.js';
import { scheduler, tokenCleanupJob, websiteScrapeJob } from './jobs/index.js';
import { ChatManager } from './websocket/chatManager.js';

const app = express();
const httpServer = createServer(app);
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
app.use('/api/servers', serverRoutes);
app.use('/api/chat', chatRoutes);

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

// Register and start background jobs
scheduler.register(tokenCleanupJob);
scheduler.register(websiteScrapeJob);
scheduler.start();

// Initialize WebSocket for chat
const humaApiKey = process.env.HUMA_API_KEY;
let chatManager: ChatManager | null = null;
if (humaApiKey) {
  chatManager = new ChatManager(httpServer, humaApiKey);
  console.log('[WebSocket] Chat WebSocket server initialized');
} else {
  console.warn('[WebSocket] HUMA_API_KEY not set, web chat disabled');
}

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

  // Shutdown chat manager first (closes WebSocket connections)
  if (chatManager) {
    chatManager.shutdown();
  }

  // Stop accepting new connections
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');

    // Stop background jobs
    scheduler.stop();
    console.log('[Server] Background jobs stopped');

    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('[Server] Force exiting...');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Status: http://localhost:${PORT}/api/status`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws/chat`);
});
