import express, { Request, Response } from 'express';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import discordRoutes from './routes/discord.js';
import serverRoutes from './routes/servers.js';
import { scheduler, tokenCleanupJob, websiteScrapeJob } from './jobs/index.js';

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
app.use('/api/servers', serverRoutes);

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

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Status: http://localhost:${PORT}/api/status`);
});
