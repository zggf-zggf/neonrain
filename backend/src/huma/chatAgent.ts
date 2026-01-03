import { HumaClient } from './client.js';
import { AgentMetadata, WebChatContext } from './types.js';
import { ChatMessage } from '@prisma/client';

interface WebsiteData {
  url: string;
  name: string;
  markdown: string;
  scrapedAt: string;
}

interface PendingResponse {
  toolCallId: string;
  message: string;
  startTime: Date;
  timeoutId: NodeJS.Timeout;
}

type MessageCallback = (message: string) => void;
type TypingCallback = (isTyping: boolean) => void;

export class ChatAgent {
  private client: HumaClient;
  private userId: string;
  private userName: string;
  private personality: string;
  private rules: string;
  private information: string;
  private websites: WebsiteData[];

  private pendingResponse: PendingResponse | null = null;
  private cancelRequested = false;
  private onMessage: MessageCallback | null = null;
  private onTyping: TypingCallback | null = null;

  constructor(
    apiKey: string,
    userId: string,
    userName: string,
    config: { personality: string; rules: string; information: string },
    websites: WebsiteData[]
  ) {
    this.client = new HumaClient(apiKey);
    this.userId = userId;
    this.userName = userName;
    this.personality = config.personality;
    this.rules = config.rules;
    this.information = config.information;
    this.websites = websites;
  }

  async initialize(): Promise<void> {
    const metadata = this.buildAgentMetadata();
    const agent = await this.client.createAgent(`WebChat-${this.userId}`, metadata);
    await this.client.connect(agent.id);

    this.client.setToolCallHandler((toolCallId, toolName, args) => {
      this.handleToolCall(toolCallId, toolName, args);
    });

    this.client.setCancelToolCallHandler((toolCallId, reason) => {
      this.handleCancelToolCall(toolCallId, reason);
    });
  }

  disconnect(): void {
    if (this.pendingResponse) {
      clearTimeout(this.pendingResponse.timeoutId);
      this.pendingResponse = null;
    }
    this.client.disconnect();
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  setMessageCallback(callback: MessageCallback): void {
    this.onMessage = callback;
  }

  setTypingCallback(callback: TypingCallback): void {
    this.onTyping = callback;
  }

  async sendMessage(content: string, conversationHistory: ChatMessage[]): Promise<void> {
    const context = this.buildContext(content, conversationHistory);
    const description = `User sent a message: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`;

    this.client.sendContextUpdate('new-message', description, context as unknown as Record<string, unknown>);
  }

  cancelPendingResponse(): void {
    if (this.pendingResponse) {
      this.cancelRequested = true;
      clearTimeout(this.pendingResponse.timeoutId);
      this.client.sendToolCanceled(this.pendingResponse.toolCallId, 'User canceled');
      this.pendingResponse = null;
      this.onTyping?.(false);
    }
  }

  private buildAgentMetadata(): AgentMetadata {
    let personality = `## Core Traits
Helpful, knowledgeable, friendly, and engaging. Responds naturally to conversations.

## Background
You are an AI assistant having a 1-on-1 conversation with ${this.userName}. Be helpful, patient, and provide clear answers.

## Speech Patterns
- Uses clear, concise language
- Engages naturally in conversations
- References previous messages when relevant
- Admits when you don't know something
- Maintains a friendly, approachable tone`;

    if (this.personality) {
      personality += `\n\n## Custom Personality\n${this.personality}`;
    }

    let instructions = `## Your Role
You are having a direct 1-on-1 conversation with ${this.userName} via web chat.

## Understanding Context
You will receive the conversation history and the new message. Use the history to maintain context.

## Rules

### MUST:
- Respond naturally and helpfully
- Reference previous messages when relevant
- Be accurate and helpful
- Keep responses focused

### MUST NOT:
- Ignore the conversation history
- Share harmful content
- Pretend to be human when asked

### SHOULD:
- Add value to the conversation
- Be concise but thorough
- Use appropriate tone

## Tool Usage
Use send_message to respond to the user. Only respond when you have something meaningful to say.`;

    if (this.rules) {
      instructions += `\n\n## Custom Rules\n${this.rules}`;
    }

    return {
      className: 'WebChatAssistant',
      personality,
      instructions,
      tools: [
        {
          name: 'send_message',
          description: 'Send a message to the user in the web chat.',
          parameters: [
            {
              name: 'message',
              type: 'string',
              description: 'The message content to send',
              required: true,
            },
          ],
        },
      ],
      routerType: 'conversational',
    };
  }

  private buildContext(newMessage: string, history: ChatMessage[]): WebChatContext {
    // Build conversation history string
    const historyStr = history
      .map((msg) => {
        const role = msg.role === 'user' ? this.userName : 'Assistant';
        const time = msg.createdAt.toISOString();
        return `[${time}] ${role}: ${msg.content}`;
      })
      .join('\n');

    const context: WebChatContext = {
      platform: 'web_chat',
      user: {
        id: this.userId,
        name: this.userName,
      },
      conversationHistory: historyStr,
      newMessage: {
        author: this.userName,
        content: newMessage,
      },
    };

    if (this.information) {
      context.userInformation = this.information;
    }
    if (this.rules) {
      context.customRules = this.rules;
    }
    if (this.personality) {
      context.customPersonality = this.personality;
    }

    if (this.websites.length > 0) {
      context.importantWebsites = this.websites.map((w) => ({
        name: w.name,
        url: w.url,
        scrapedAt: w.scrapedAt,
        content: w.markdown,
      }));
    }

    return context;
  }

  private handleToolCall(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    if (toolName !== 'send_message') {
      this.client.sendToolResult(toolCallId, false, undefined, `Unknown tool: ${toolName}`);
      return;
    }

    const message = args.message as string;
    if (!message) {
      this.client.sendToolResult(toolCallId, false, undefined, 'Missing message');
      return;
    }

    // Start typing indicator
    this.onTyping?.(true);
    this.cancelRequested = false;

    // Calculate typing delay (90 WPM)
    const delay = this.calculateTypingDelay(message);
    console.log(`[ChatAgent] Simulating typing for ${delay}ms`);

    const timeoutId = setTimeout(() => {
      if (this.cancelRequested || !this.pendingResponse) {
        return;
      }

      // Send the message
      this.onTyping?.(false);
      this.onMessage?.(message);
      this.client.sendToolResult(toolCallId, true, 'Message sent');
      this.pendingResponse = null;
    }, delay);

    this.pendingResponse = {
      toolCallId,
      message,
      startTime: new Date(),
      timeoutId,
    };
  }

  private handleCancelToolCall(toolCallId: string, reason: string): void {
    if (this.pendingResponse?.toolCallId === toolCallId) {
      this.cancelRequested = true;
      clearTimeout(this.pendingResponse.timeoutId);
      this.pendingResponse = null;
      this.onTyping?.(false);
    }
  }

  private calculateTypingDelay(text: string): number {
    const WPM = 90;
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    const seconds = (words / WPM) * 60;
    const delay = Math.max(500, Math.min(30000, seconds * 1000));
    return delay;
  }
}
