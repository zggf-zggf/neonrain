import express, { Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import discordRoutes from './routes/discord.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
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

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Status: http://localhost:${PORT}/api/status`);
});
