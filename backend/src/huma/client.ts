import { io, Socket } from 'socket.io-client';
import {
  AgentMetadata,
  CreateAgentResponse,
  HumaEvent,
  ContextUpdateContent,
  ToolResultContent,
  ServerEvent,
} from './types.js';

const HUMA_API_URL = 'https://api.humalike.tech';

export type ToolCallHandler = (
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
) => void;

export type CancelToolCallHandler = (toolCallId: string, reason: string) => void;

export class HumaClient {
  private apiKey: string;
  private agentId: string | null = null;
  private socket: Socket | null = null;
  private connected = false;
  private onToolCall: ToolCallHandler | null = null;
  private onCancelToolCall: CancelToolCallHandler | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createAgent(name: string, metadata: AgentMetadata): Promise<CreateAgentResponse> {
    const response = await fetch(`${HUMA_API_URL}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        name,
        agentType: 'HUMA-0.1',
        metadata,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HUMA API error (${response.status}): ${body}`);
    }

    const agentResp: CreateAgentResponse = await response.json();
    this.agentId = agentResp.id;
    console.log(`[HUMA] Created agent: ${agentResp.name} (ID: ${agentResp.id})`);
    return agentResp;
  }

  async connect(agentId: string): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }

    this.agentId = agentId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.socket) {
          this.socket.disconnect();
        }
        reject(new Error('Connection timeout'));
      }, 30000);

      // Connect using Socket.IO client
      this.socket = io(HUMA_API_URL, {
        path: '/socket.io/',
        query: {
          agentId,
          apiKey: this.apiKey,
        },
        transports: ['websocket'],
        timeout: 30000,
      });

      this.socket.on('connect', () => {
        console.log(`[HUMA] Connected to WebSocket`);
        this.connected = true;
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log(`[HUMA] Disconnected: ${reason}`);
        this.connected = false;
      });

      this.socket.on('connect_error', (err) => {
        console.error(`[HUMA] Connection error: ${err.message}`);
        clearTimeout(timeout);
        reject(err);
      });

      this.socket.on('event', (data: ServerEvent) => {
        this.handleServerEvent(data);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    console.log(`[HUMA] Disconnected from agent ${this.agentId}`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  setToolCallHandler(handler: ToolCallHandler): void {
    this.onToolCall = handler;
  }

  setCancelToolCallHandler(handler: CancelToolCallHandler): void {
    this.onCancelToolCall = handler;
  }

  sendContextUpdate(
    eventName: string,
    description: string,
    context: Record<string, unknown>
  ): void {
    if (!this.isConnected() || !this.socket) {
      throw new Error('Not connected');
    }

    const event: HumaEvent = {
      type: 'huma-0.1-event',
      content: {
        name: eventName,
        context,
        description,
      } as ContextUpdateContent,
    };

    this.socket.emit('message', event);
    console.log(`[HUMA] Sent context update: ${eventName}`);
  }

  sendToolResult(
    toolCallId: string,
    success: boolean,
    result?: unknown,
    error?: string
  ): void {
    if (!this.isConnected() || !this.socket) {
      throw new Error('Not connected');
    }

    const content: ToolResultContent = {
      type: 'tool-result',
      toolCallId,
      status: 'completed',
      success,
    };

    if (success) {
      content.result = result;
    } else {
      content.error = error;
    }

    const event: HumaEvent = {
      type: 'huma-0.1-event',
      content,
    };

    this.socket.emit('message', event);
    console.log(`[HUMA] Sent tool result for ${toolCallId} (success: ${success})`);
  }

  sendToolCanceled(toolCallId: string, reason: string): void {
    if (!this.isConnected() || !this.socket) {
      throw new Error('Not connected');
    }

    const content: ToolResultContent = {
      type: 'tool-result',
      toolCallId,
      status: 'canceled',
      success: false,
      error: reason,
    };

    const event: HumaEvent = {
      type: 'huma-0.1-event',
      content,
    };

    this.socket.emit('message', event);
    console.log(`[HUMA] Sent tool canceled for ${toolCallId}: ${reason}`);
  }

  private handleServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'status':
        console.log(`[HUMA] Agent status: ${event.status}`);
        break;

      case 'tool-call':
        console.log(`[HUMA] Tool call: ${event.toolName} (ID: ${event.toolCallId})`);
        if (this.onToolCall && event.toolCallId && event.toolName) {
          this.onToolCall(event.toolCallId, event.toolName, event.arguments || {});
        }
        break;

      case 'cancel-tool-call':
        console.log(`[HUMA] Cancel tool call: ${event.toolCallId}`);
        if (this.onCancelToolCall && event.toolCallId) {
          this.onCancelToolCall(event.toolCallId, event.reason || 'Unknown reason');
        }
        break;

      case 'error':
        console.error(`[HUMA] Error: ${event.message} (code: ${event.code})`);
        break;

      default:
        console.log(`[HUMA] Unknown event type: ${event.type}`);
    }
  }

  getAgentId(): string | null {
    return this.agentId;
  }
}
