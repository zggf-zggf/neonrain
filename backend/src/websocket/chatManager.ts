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
  // Changed: keyed by socket.id to allow multiple tabs per user
  private sessions: Map<string, UserSession> = new Map();
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

        // Attach user ID and conversationId to socket
        (socket as any).clerkUserId = payload.sub;
        (socket as any).conversationId = socket.handshake.auth.conversationId || null;
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
    const requestedConversationId = (socket as any).conversationId;
    console.log(
      `[WebSocket] User connected: ${clerkUserId}, socket: ${socket.id}, conversation: ${requestedConversationId || 'new'}`
    );

    try {
      // Get user
      const user = await prisma.user.findUnique({
        where: { clerkUserId },
      });

      if (!user) {
        socket.emit('chat:error', { message: 'User not found' });
        socket.disconnect();
        return;
      }

      // Get first server config (for now, chat uses the first configured server)
      // TODO: Support selecting specific server for chat
      const serverConfig = await prisma.userServerConfig.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
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
        },
      });

      if (!serverConfig) {
        socket.emit('chat:error', {
          message: 'No server configured. Please configure a server first.',
          code: 'NO_SERVER',
        });
        socket.disconnect();
        return;
      }

      // Get or create conversation
      let conversation;

      if (requestedConversationId) {
        // Validate the conversation belongs to this user
        conversation = await prisma.chatConversation.findFirst({
          where: {
            id: requestedConversationId,
            userId: user.id,
          },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 50,
            },
          },
        });

        if (!conversation) {
          socket.emit('chat:error', { message: 'Conversation not found' });
          socket.disconnect();
          return;
        }
      } else {
        // No conversation specified - get most recent or create new
        conversation = await prisma.chatConversation.findFirst({
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
      }

      // Build websites data from server config
      const websites = serverConfig.server.websites.map((w) => ({
        url: w.url,
        name: w.name || '',
        markdown: w.scrapes[0]?.markdownContent || '',
        scrapedAt: w.scrapes[0]?.scrapedAt?.toISOString() || '',
      }));

      // Create chat agent with conversation-specific ID
      const agent = new ChatAgent(
        this.humaApiKey,
        conversation.id, // Use conversation ID for agent (not user ID)
        user.email || 'User',
        serverConfig.botName || 'Assistant', // Bot name from server config
        {
          personality: serverConfig.personality || '',
          rules: serverConfig.rules || '',
          information: serverConfig.information || '',
        },
        websites
      );

      // Set up agent callbacks - use socket.id to find session
      agent.setMessageCallback(async (message) => {
        await this.handleAgentMessage(socket.id, message);
      });

      agent.setTypingCallback((isTyping) => {
        socket.emit('chat:typing', { isTyping });
      });

      // Initialize HUMA connection
      await agent.initialize();

      // Store session keyed by socket.id (allows multiple tabs)
      const session: UserSession = {
        socket,
        agent,
        clerkUserId,
        dbUserId: user.id,
        conversationId: conversation.id,
      };
      this.sessions.set(socket.id, session);

      // Handle events - use socket.id instead of clerkUserId
      socket.on('chat:message', (data) => this.handleUserMessage(socket.id, data));
      socket.on('chat:cancel', () => this.handleCancel(socket.id));
      socket.on('disconnect', () => this.handleDisconnect(socket.id));

      // Send ready event with conversation details
      socket.emit('chat:ready', {
        conversationId: conversation.id,
        title: conversation.title,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WebSocket] Connection error:', error);
      socket.emit('chat:error', { message: `Failed to initialize chat: ${errorMessage}` });
      socket.disconnect();
    }
  }

  private async handleUserMessage(
    socketId: string,
    data: { content: string; senderName?: string }
  ): Promise<void> {
    const session = this.sessions.get(socketId);
    if (!session) return;

    const { content, senderName } = data;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      session.socket.emit('chat:error', { message: 'Message cannot be empty' });
      return;
    }

    try {
      // Save user message to database with sender name
      const userMessage = await prisma.chatMessage.create({
        data: {
          conversationId: session.conversationId,
          role: 'user',
          content: content.trim(),
          senderName: senderName || null,
        },
      });

      // Update conversation's updatedAt and potentially title
      const conversation = await prisma.chatConversation.findUnique({
        where: { id: session.conversationId },
        select: { title: true },
      });

      // Auto-generate title from first message if still default
      if (conversation?.title === 'New conversation') {
        const newTitle = content.trim().slice(0, 50) + (content.length > 50 ? '...' : '');
        await prisma.chatConversation.update({
          where: { id: session.conversationId },
          data: { title: newTitle },
        });
        // Notify client of title change
        session.socket.emit('chat:title-updated', { title: newTitle });
      } else {
        // Just touch updatedAt
        await prisma.chatConversation.update({
          where: { id: session.conversationId },
          data: { updatedAt: new Date() },
        });
      }

      // Echo back to client
      session.socket.emit('chat:message', {
        id: userMessage.id,
        role: 'user',
        content: userMessage.content,
        senderName: userMessage.senderName,
        createdAt: userMessage.createdAt,
      });

      // Get conversation history
      const history = await prisma.chatMessage.findMany({
        where: { conversationId: session.conversationId },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      // Send to HUMA agent with sender name
      await session.agent.sendMessage(content.trim(), senderName || 'User', history);
    } catch (error) {
      console.error('[WebSocket] Message error:', error);
      session.socket.emit('chat:error', { message: 'Failed to send message' });
    }
  }

  private async handleAgentMessage(socketId: string, message: string): Promise<void> {
    const session = this.sessions.get(socketId);
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

      // Update conversation's updatedAt
      await prisma.chatConversation.update({
        where: { id: session.conversationId },
        data: { updatedAt: new Date() },
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

  private handleCancel(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      session.agent.cancelPendingResponse();
    }
  }

  private handleDisconnect(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      console.log(`[WebSocket] Socket disconnected: ${socketId} (user: ${session.clerkUserId})`);
      session.agent.disconnect();
      this.sessions.delete(socketId);
    }
  }

  shutdown(): void {
    console.log('[WebSocket] Shutting down chat manager...');

    // Disconnect all agents
    for (const [socketId, session] of this.sessions) {
      console.log(`[WebSocket] Disconnecting socket: ${socketId}`);
      session.agent.disconnect();
      session.socket.disconnect(true);
    }
    this.sessions.clear();

    // Close Socket.IO server
    this.io.close();
    console.log('[WebSocket] Chat manager shut down');
  }
}
