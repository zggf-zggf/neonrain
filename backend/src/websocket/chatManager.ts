import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server } from 'http';
import { verifyToken } from '@clerk/backend';
import { prisma } from '../lib/prisma.js';
import { ChatAgent } from '../huma/chatAgent.js';

interface UserSession {
  socket: Socket;
  agent: ChatAgent;
  clerkUserId: string;
  dbUserId: string;
  conversationId: string;
}

export class ChatManager {
  private io: SocketIOServer;
  private sessions: Map<string, UserSession> = new Map(); // clerkUserId -> session
  private humaApiKey: string;

  constructor(httpServer: Server, humaApiKey: string) {
    this.humaApiKey = humaApiKey;

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3001',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      path: '/ws/chat',
    });

    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Verify Clerk token
        const payload = await verifyToken(token, {
          secretKey: process.env.CLERK_SECRET_KEY!,
        });

        if (!payload?.sub) {
          return next(new Error('Invalid token'));
        }

        // Attach user ID to socket
        (socket as any).clerkUserId = payload.sub;
        next();
      } catch (error) {
        console.error('[WebSocket] Auth error:', error);
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => this.handleConnection(socket));
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const clerkUserId = (socket as any).clerkUserId;
    console.log(`[WebSocket] User connected: ${clerkUserId}`);

    try {
      // If user already has a session, disconnect the old one
      const existingSession = this.sessions.get(clerkUserId);
      if (existingSession) {
        console.log(`[WebSocket] Disconnecting existing session for ${clerkUserId}`);
        existingSession.agent.disconnect();
        existingSession.socket.disconnect();
        this.sessions.delete(clerkUserId);
      }

      // Get user and their configuration
      const user = await prisma.user.findUnique({
        where: { clerkUserId },
        include: {
          server: {
            include: {
              websites: {
                include: {
                  scrapes: {
                    orderBy: { scrapedAt: 'desc' },
                    take: 1,
                  },
                },
              },
            },
          },
          chatConversation: {
            include: {
              messages: {
                orderBy: { createdAt: 'asc' },
                take: 50,
              },
            },
          },
        },
      });

      if (!user) {
        socket.emit('chat:error', { message: 'User not found' });
        socket.disconnect();
        return;
      }

      if (!user.selectedGuildId) {
        socket.emit('chat:error', {
          message: 'No server configured. Please configure a server first.',
          code: 'NO_SERVER',
        });
        socket.disconnect();
        return;
      }

      // Get or create conversation
      let conversation = user.chatConversation;
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

      // Build websites data
      const websites =
        user.server?.websites.map((w) => ({
          url: w.url,
          name: w.name || '',
          markdown: w.scrapes[0]?.markdownContent || '',
          scrapedAt: w.scrapes[0]?.scrapedAt?.toISOString() || '',
        })) || [];

      // Create chat agent
      const agent = new ChatAgent(
        this.humaApiKey,
        user.id,
        user.email || 'User',
        {
          personality: user.personality || '',
          rules: user.rules || '',
          information: user.information || '',
        },
        websites
      );

      // Set up agent callbacks
      agent.setMessageCallback(async (message) => {
        await this.handleAgentMessage(clerkUserId, message);
      });

      agent.setTypingCallback((isTyping) => {
        socket.emit('chat:typing', { isTyping });
      });

      // Initialize HUMA connection
      await agent.initialize();

      // Store session
      const session: UserSession = {
        socket,
        agent,
        clerkUserId,
        dbUserId: user.id,
        conversationId: conversation.id,
      };
      this.sessions.set(clerkUserId, session);

      // Handle events
      socket.on('chat:message', (data) => this.handleUserMessage(clerkUserId, data));
      socket.on('chat:cancel', () => this.handleCancel(clerkUserId));
      socket.on('disconnect', () => this.handleDisconnect(clerkUserId));

      // Send ready event
      socket.emit('chat:ready', { conversationId: conversation.id });
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      socket.emit('chat:error', { message: 'Failed to initialize chat' });
      socket.disconnect();
    }
  }

  private async handleUserMessage(
    clerkUserId: string,
    data: { content: string }
  ): Promise<void> {
    const session = this.sessions.get(clerkUserId);
    if (!session) return;

    const { content } = data;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      session.socket.emit('chat:error', { message: 'Message cannot be empty' });
      return;
    }

    try {
      // Save user message to database
      const userMessage = await prisma.chatMessage.create({
        data: {
          conversationId: session.conversationId,
          role: 'user',
          content: content.trim(),
        },
      });

      // Echo back to client
      session.socket.emit('chat:message', {
        id: userMessage.id,
        role: 'user',
        content: userMessage.content,
        createdAt: userMessage.createdAt,
      });

      // Get conversation history
      const history = await prisma.chatMessage.findMany({
        where: { conversationId: session.conversationId },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      // Send to HUMA agent
      await session.agent.sendMessage(content.trim(), history);
    } catch (error) {
      console.error('[WebSocket] Message error:', error);
      session.socket.emit('chat:error', { message: 'Failed to send message' });
    }
  }

  private async handleAgentMessage(clerkUserId: string, message: string): Promise<void> {
    const session = this.sessions.get(clerkUserId);
    if (!session) return;

    try {
      // Save assistant message to database
      const assistantMessage = await prisma.chatMessage.create({
        data: {
          conversationId: session.conversationId,
          role: 'assistant',
          content: message,
        },
      });

      // Send to client
      session.socket.emit('chat:message', {
        id: assistantMessage.id,
        role: 'assistant',
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt,
      });
    } catch (error) {
      console.error('[WebSocket] Agent message error:', error);
    }
  }

  private handleCancel(clerkUserId: string): void {
    const session = this.sessions.get(clerkUserId);
    if (session) {
      session.agent.cancelPendingResponse();
    }
  }

  private handleDisconnect(clerkUserId: string): void {
    const session = this.sessions.get(clerkUserId);
    if (session) {
      console.log(`[WebSocket] User disconnected: ${clerkUserId}`);
      session.agent.disconnect();
      this.sessions.delete(clerkUserId);
    }
  }

  shutdown(): void {
    console.log('[WebSocket] Shutting down chat manager...');

    // Disconnect all agents
    for (const [clerkUserId, session] of this.sessions) {
      console.log(`[WebSocket] Disconnecting user: ${clerkUserId}`);
      session.agent.disconnect();
      session.socket.disconnect(true);
    }
    this.sessions.clear();

    // Close Socket.IO server
    this.io.close();
    console.log('[WebSocket] Chat manager shut down');
  }
}
