"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export default function ChatPage() {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { isLoaded: isUserLoaded } = useUser();
  const router = useRouter();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!isAuthLoaded || !isUserLoaded) return;

    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    let socketInstance: Socket | null = null;

    async function connect() {
      try {
        const token = await getToken();
        if (!token) {
          setError("Authentication required");
          setLoading(false);
          return;
        }

        socketInstance = io(BACKEND_URL, {
          path: "/ws/chat",
          auth: { token },
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

        socketInstance.on("chat:ready", ({ conversationId }) => {
          console.log("[Chat] Ready, conversation:", conversationId);
          setLoading(false);
          loadMessages(token);
        });

        socketInstance.on("chat:message", (message: ChatMessage) => {
          setMessages((prev) => [...prev, message]);
        });

        socketInstance.on("chat:typing", ({ isTyping: typing }) => {
          setIsTyping(typing);
        });

        socketInstance.on("chat:error", ({ message, code }) => {
          console.error("[Chat] Error:", message, code);
          setError(message);
          if (code === "NO_SERVER") {
            setTimeout(() => router.push("/setup"), 2000);
          }
        });

        setSocket(socketInstance);
      } catch (err) {
        console.error("[Chat] Setup error:", err);
        setError("Failed to connect");
        setLoading(false);
      }
    }

    connect();

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, [isAuthLoaded, isUserLoaded, isSignedIn, getToken, router]);

  async function loadMessages(token: string) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/conversation`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.code === "NO_SERVER_CONFIGURED") {
          setError("Please select a server first");
          setTimeout(() => router.push("/setup"), 2000);
          return;
        }
        throw new Error(data.error || "Failed to load messages");
      }

      const data = await response.json();
      setMessages(data.conversation.messages);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load messages";
      console.error("[Chat] Load messages error:", err);
      setError(errorMessage);
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

  if (loading || !isAuthLoaded || !isUserLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-gray-400">Loading chat...</div>
      </div>
    );
  }

  if (error) {
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
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Setup Banner */}
      <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 border-b border-indigo-800/50">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold">
                2
              </div>
              <div>
                <p className="text-white font-medium">Configure Your AI Assistant</p>
                <p className="text-indigo-300 text-sm">Chat to shape its personality and behavior</p>
              </div>
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-3 py-1.5 text-sm bg-indigo-600/30 text-indigo-200 rounded-lg hover:bg-indigo-600/50 transition"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Meet Your AI Assistant</h3>
              <p className="text-gray-400 max-w-md mx-auto mb-6">
                This is your private space to chat with and configure your AI.
                The conversation here helps shape how it will respond on Discord.
              </p>
              <div className="bg-gray-800/50 rounded-xl p-4 max-w-md mx-auto text-left">
                <p className="text-gray-300 text-sm mb-3">Try saying something like:</p>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>&quot;Hi! Tell me about yourself&quot;</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>&quot;I want you to be more casual and funny&quot;</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>&quot;Our Discord is about gaming, especially FPS games&quot;</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-100"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                )}
                <div
                  className={`text-xs mt-1 ${
                    msg.role === "user" ? "text-indigo-200" : "text-gray-500"
                  }`}
                >
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-2xl px-4 py-3 text-gray-400">
                <div className="flex items-center gap-1">
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
                disabled={!connected || isTyping}
              />
            </div>
            {isTyping ? (
              <button
                onClick={cancelResponse}
                className="px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!connected || !inputValue.trim()}
                className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            )}
          </div>
          {!connected && (
            <div className="text-yellow-400 text-sm mt-2">Reconnecting...</div>
          )}
        </div>
      </div>
    </div>
  );
}
