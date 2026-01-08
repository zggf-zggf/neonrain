"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDiscordStatus, setDiscordBotStatus } from "@/lib/api";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export default function ChatPage() {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const router = useRouter();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [discordBotActive, setDiscordBotActive] = useState(false);
  const [activatingBot, setActivatingBot] = useState(false);

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState<string>("New conversation");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // User names for chat display
  const [botName, setBotName] = useState<string>("Assistant");
  const userName = user?.firstName || user?.username || "You";

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<Socket | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Load conversations list
  const loadConversations = useCallback(async (token: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations);
      }
    } catch (err) {
      console.error("[Chat] Failed to load conversations:", err);
    }
  }, []);

  // Connect to a specific conversation
  const connectToConversation = useCallback(async (conversationId: string | null) => {
    // Disconnect existing socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    }

    setLoading(true);
    setMessages([]);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication required");
        setLoading(false);
        return;
      }

      const socketInstance = io(BACKEND_URL, {
        path: "/ws/chat",
        auth: { token, conversationId },
        transports: ["websocket"],
      });

      socketInstance.on("connect", () => {
        console.log("[Chat] Connected to WebSocket");
        setConnected(true);
        setError(null);
      });

      socketInstance.on("disconnect", (reason) => {
        console.log("[Chat] Disconnected:", reason);
        setConnected(false);
        if (reason === "io server disconnect") {
          setError("Disconnected by server");
        }
      });

      socketInstance.on("connect_error", (err) => {
        console.error("[Chat] Connection error:", err.message);
        setError(err.message);
        setLoading(false);
      });

      socketInstance.on("chat:ready", async ({ conversationId: connectedId, title }) => {
        console.log("[Chat] Ready, conversation:", connectedId);
        setActiveConversationId(connectedId);
        setActiveConversationTitle(title || "New conversation");
        setLoading(false);

        // Load messages for this conversation
        const response = await fetch(`${BACKEND_URL}/api/chat/conversations/${connectedId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setMessages(data.conversation.messages);
        }

        // Refresh conversations list
        loadConversations(token);
      });

      socketInstance.on("chat:message", (message: ChatMessage) => {
        setMessages((prev) => [...prev, message]);
      });

      socketInstance.on("chat:typing", ({ isTyping: typing }) => {
        setIsTyping(typing);
      });

      socketInstance.on("chat:title-updated", ({ title }) => {
        setActiveConversationTitle(title);
        // Update in conversations list too
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeConversationId ? { ...c, title } : c
          )
        );
      });

      socketInstance.on("chat:error", ({ message, code }) => {
        console.error("[Chat] Error:", message, code);
        setError(message);
        if (code === "NO_SERVER") {
          setTimeout(() => router.push("/setup"), 2000);
        }
      });

      socketRef.current = socketInstance;
      setSocket(socketInstance);
    } catch (err) {
      console.error("[Chat] Setup error:", err);
      setError("Failed to connect");
      setLoading(false);
    }
  }, [getToken, router, loadConversations, activeConversationId]);

  // Initial connection
  useEffect(() => {
    if (!isAuthLoaded || !isUserLoaded) return;

    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    async function initialize() {
      const token = await getToken();
      if (!token) return;

      // Load Discord status (includes bot name and active status)
      try {
        const status = await getDiscordStatus(token);
        setDiscordBotActive(status.botActive);
        if (status.botName) {
          setBotName(status.botName);
        }
      } catch {
        // Ignore
      }

      // Load conversations and connect
      await loadConversations(token);
      connectToConversation(null); // Connect to most recent
    }

    initialize();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [isAuthLoaded, isUserLoaded, isSignedIn, getToken, router, loadConversations, connectToConversation]);

  // Create new conversation
  const createNewConversation = async () => {
    setCreatingConversation(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${BACKEND_URL}/api/chat/conversations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Connect to the new conversation
        connectToConversation(data.conversation.id);
      }
    } catch (err) {
      console.error("[Chat] Failed to create conversation:", err);
    } finally {
      setCreatingConversation(false);
    }
  };

  // Delete conversation
  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;

    try {
      const token = await getToken();
      if (!token) return;

      await fetch(`${BACKEND_URL}/api/chat/conversations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      // If deleting active conversation, switch to another
      if (id === activeConversationId) {
        const remaining = conversations.filter((c) => c.id !== id);
        if (remaining.length > 0) {
          connectToConversation(remaining[0].id);
        } else {
          createNewConversation();
        }
      }

      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("[Chat] Failed to delete conversation:", err);
    }
  };

  // Copy conversation as markdown
  const copyAsMarkdown = async () => {
    const markdown = messages
      .map((msg) => {
        const name = msg.role === "user" ? userName : botName;
        const time = new Date(msg.createdAt).toLocaleString();
        return `**${name}** (${time}):\n${msg.content}`;
      })
      .join("\n\n---\n\n");

    const header = `# ${activeConversationTitle}\n\n`;

    try {
      await navigator.clipboard.writeText(header + markdown);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("[Chat] Failed to copy:", err);
    }
  };

  async function handleActivateBot() {
    setActivatingBot(true);
    try {
      const token = await getToken();
      if (!token) return;

      const result = await setDiscordBotStatus(token, true);
      setDiscordBotActive(result.active);
    } catch (err) {
      console.error("[Chat] Failed to activate bot:", err);
    } finally {
      setActivatingBot(false);
    }
  }

  const sendMessage = useCallback(() => {
    if (!socket || !connected || !inputValue.trim()) return;

    socket.emit("chat:message", { content: inputValue.trim() });
    setInputValue("");
    inputRef.current?.focus();
  }, [socket, connected, inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const cancelResponse = () => {
    if (socket && isTyping) {
      socket.emit("chat:cancel", {});
    }
  };

  if (!isAuthLoaded || !isUserLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-950">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } flex-shrink-0 bg-gray-900 border-r border-gray-800 transition-all duration-300 overflow-hidden flex flex-col`}
      >
        {/* Sidebar Header */}
        <div className="p-3 border-b border-gray-800">
          <button
            onClick={createNewConversation}
            disabled={creatingConversation}
            className="w-full px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {creatingConversation ? "Creating..." : "New Chat"}
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => conv.id !== activeConversationId && connectToConversation(conv.id)}
              className={`group px-3 py-2 cursor-pointer hover:bg-gray-800 flex items-center justify-between ${
                conv.id === activeConversationId ? "bg-gray-800" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-200 truncate">{conv.title}</div>
                <div className="text-xs text-gray-500">
                  {new Date(conv.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 border-b border-indigo-800/50">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Toggle Sidebar */}
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>

                <div>
                  <p className="text-white font-medium truncate max-w-md">{activeConversationTitle}</p>
                  <p className="text-indigo-300 text-sm">
                    {discordBotActive ? "Discord Bot Active" : "Configure your AI assistant"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Copy as Markdown */}
                {messages.length > 0 && (
                  <button
                    onClick={copyAsMarkdown}
                    className={`px-3 py-1.5 text-sm rounded-lg transition flex items-center gap-1 ${
                      copySuccess
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {copySuccess ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        Copy MD
                      </>
                    )}
                  </button>
                )}

                {!discordBotActive && messages.length >= 2 && (
                  <button
                    onClick={handleActivateBot}
                    disabled={activatingBot}
                    className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                  >
                    {activatingBot ? "Activating..." : "Activate Discord Bot"}
                  </button>
                )}
                <button
                  onClick={() => router.push("/dashboard")}
                  className="px-3 py-1.5 text-sm bg-indigo-600/30 text-indigo-200 rounded-lg hover:bg-indigo-600/50 transition"
                >
                  Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading conversation...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Start a New Conversation</h3>
                <p className="text-gray-400 max-w-md mx-auto mb-6">
                  Chat with your AI assistant. The conversation helps shape how it responds on Discord.
                </p>
                <div className="bg-gray-800/50 rounded-xl p-4 max-w-md mx-auto text-left">
                  <p className="text-gray-300 text-sm mb-3">Try saying something like:</p>
                  <ul className="space-y-2 text-sm text-gray-400">
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400">&#8226;</span>
                      <span>&quot;Hi! Tell me about yourself&quot;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400">&#8226;</span>
                      <span>&quot;I want you to be more casual and funny&quot;</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-indigo-400">&#8226;</span>
                      <span>&quot;Our Discord is about gaming, especially FPS games&quot;</span>
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="flex flex-col">
                  {/* Username and timestamp */}
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className={`text-sm font-medium ${
                        msg.role === "user" ? "text-indigo-400" : "text-green-400"
                      }`}
                    >
                      {msg.role === "user" ? userName : botName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(msg.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {/* Message content */}
                  <div className="pl-0">
                    {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none text-gray-100">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap break-words text-gray-100">
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isTyping && (
              <div className="flex flex-col">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-medium text-green-400">{botName}</span>
                  <span className="text-xs text-gray-500">typing...</span>
                </div>
                <div className="flex items-center gap-1 text-gray-400">
                  <span
                    className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-800 px-4 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 resize-none focus:outline-none focus:border-indigo-500"
                  disabled={!connected || loading}
                />
              </div>
              {isTyping && (
                <button
                  onClick={cancelResponse}
                  className="px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={sendMessage}
                disabled={!connected || !inputValue.trim() || loading}
                className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
            {!connected && !loading && (
              <div className="text-yellow-400 text-sm mt-2">Reconnecting...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
