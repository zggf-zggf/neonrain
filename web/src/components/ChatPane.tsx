"use client";

import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { io, Socket } from "socket.io-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  senderName?: string;
  createdAt: string;
}

interface Persona {
  id: string;
  nickname: string;
  color: string;
}

export interface ChatPaneRef {
  sendMessage: (content: string, senderName?: string) => void;
  isConnected: () => boolean;
  getCurrentSenderName: () => string;
}

interface ChatPaneProps {
  conversationId: string;
  token: string;
  botName: string;
  defaultUserName: string;
  personas: Persona[];
  onPersonaCreate: (nickname: string) => Promise<Persona | null>;
  onPersonaDelete: (id: string) => Promise<void>;
  onTitleUpdate?: (title: string) => void;
  paneIndex: number;
  totalPanes: number;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export const ChatPane = forwardRef<ChatPaneRef, ChatPaneProps>(function ChatPane(
  {
    conversationId,
    token,
    botName,
    defaultUserName,
    personas,
    onPersonaCreate,
    onPersonaDelete,
    onTitleUpdate,
    paneIndex,
    totalPanes,
  },
  ref
) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Persona state
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [personaDropdownOpen, setPersonaDropdownOpen] = useState(false);
  const [newPersonaName, setNewPersonaName] = useState("");
  const [creatingPersona, setCreatingPersona] = useState(false);

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);
  const currentSenderName = selectedPersona?.nickname || defaultUserName;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const personaDropdownRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Close persona dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (personaDropdownRef.current && !personaDropdownRef.current.contains(event.target as Node)) {
        setPersonaDropdownOpen(false);
      }
    };

    if (personaDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [personaDropdownOpen]);

  // Connect to WebSocket
  useEffect(() => {
    if (!token || !conversationId) return;

    const socketInstance = io(BACKEND_URL, {
      path: "/ws/chat",
      auth: { token, conversationId },
      transports: ["websocket"],
    });

    socketInstance.on("connect", () => {
      console.log(`[ChatPane ${paneIndex}] Connected to WebSocket`);
      setConnected(true);
      setError(null);
    });

    socketInstance.on("disconnect", (reason) => {
      console.log(`[ChatPane ${paneIndex}] Disconnected:`, reason);
      setConnected(false);
    });

    socketInstance.on("connect_error", (err) => {
      console.error(`[ChatPane ${paneIndex}] Connection error:`, err.message);
      setError(err.message);
      setLoading(false);
    });

    socketInstance.on("chat:ready", async () => {
      console.log(`[ChatPane ${paneIndex}] Ready`);
      setLoading(false);

      // Load messages for this conversation
      try {
        const response = await fetch(`${BACKEND_URL}/api/chat/conversations/${conversationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setMessages(data.conversation.messages);
        }
      } catch (err) {
        console.error(`[ChatPane ${paneIndex}] Failed to load messages:`, err);
      }
    });

    socketInstance.on("chat:message", (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    socketInstance.on("chat:typing", ({ isTyping: typing }) => {
      setIsTyping(typing);
    });

    socketInstance.on("chat:title-updated", ({ title }) => {
      onTitleUpdate?.(title);
    });

    socketInstance.on("chat:error", ({ message }) => {
      console.error(`[ChatPane ${paneIndex}] Error:`, message);
      setError(message);
    });

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [token, conversationId, paneIndex, onTitleUpdate]);

  const sendMessageInternal = useCallback(
    (content: string, senderName?: string) => {
      if (!socketRef.current || !connected || !content.trim()) return;
      socketRef.current.emit("chat:message", {
        content: content.trim(),
        senderName: senderName || currentSenderName,
      });
    },
    [connected, currentSenderName]
  );

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    sendMessage: sendMessageInternal,
    isConnected: () => connected,
    getCurrentSenderName: () => currentSenderName,
  }));

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;
    sendMessageInternal(inputValue.trim());
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, sendMessageInternal]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const cancelResponse = () => {
    if (socket && isTyping) {
      socket.emit("chat:cancel", {});
    }
  };

  const handleCreatePersona = async () => {
    if (!newPersonaName.trim()) return;
    setCreatingPersona(true);
    try {
      const persona = await onPersonaCreate(newPersonaName.trim());
      if (persona) {
        setSelectedPersonaId(persona.id);
        setNewPersonaName("");
        setPersonaDropdownOpen(false);
      }
    } finally {
      setCreatingPersona(false);
    }
  };

  const handleDeletePersona = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await onPersonaDelete(id);
    if (selectedPersonaId === id) {
      setSelectedPersonaId(null);
    }
  };

  return (
    <div className="flex flex-col h-full border-r border-gray-800 last:border-r-0">
      {/* Pane Header */}
      {totalPanes > 1 && (
        <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 text-xs text-gray-400">
          Pane {paneIndex + 1}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-400 text-sm">{error}</div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              Start a conversation...
            </div>
          ) : (
            messages.map((msg, index) => {
              const senderName = msg.role === "user" ? (msg.senderName || defaultUserName) : botName;
              const matchingPersona = personas.find((p) => p.nickname === msg.senderName);
              const userColor = matchingPersona?.color || "#818cf8";

              const prevMsg = index > 0 ? messages[index - 1] : null;
              const prevSenderName = prevMsg
                ? prevMsg.role === "user"
                  ? (prevMsg.senderName || defaultUserName)
                  : botName
                : null;
              const isContinuation = prevSenderName === senderName;

              return (
                <div key={msg.id} className={`flex flex-col ${isContinuation ? "mt-0.5" : index > 0 ? "mt-3" : ""}`}>
                  {!isContinuation && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span
                        className="text-xs font-medium"
                        style={{ color: msg.role === "user" ? userColor : "#4ade80" }}
                      >
                        {senderName}
                      </span>
                      <span className="text-xs text-gray-600">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                  <div className="text-sm">
                    {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none text-gray-200">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap break-words text-gray-200">{msg.content}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {isTyping && (
            <div className="flex flex-col mt-3">
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-xs font-medium text-green-400">{botName}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-800 p-2">
        {/* Persona Selector */}
        <div className="mb-2 relative" ref={personaDropdownRef}>
          <button
            onClick={() => setPersonaDropdownOpen(!personaDropdownOpen)}
            className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs hover:bg-gray-750 transition"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: selectedPersona?.color || "#818cf8" }}
            />
            <span className="text-gray-200 truncate max-w-[100px]">{currentSenderName}</span>
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {personaDropdownOpen && (
            <div className="absolute bottom-full mb-1 left-0 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 text-xs">
              <div
                onClick={() => {
                  setSelectedPersonaId(null);
                  setPersonaDropdownOpen(false);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-700 ${
                  !selectedPersonaId ? "bg-gray-700" : ""
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-indigo-400" />
                <span className="text-gray-200 flex-1 truncate">{defaultUserName}</span>
                <span className="text-gray-500">default</span>
              </div>

              {personas.map((persona) => (
                <div
                  key={persona.id}
                  onClick={() => {
                    setSelectedPersonaId(persona.id);
                    setPersonaDropdownOpen(false);
                  }}
                  className={`group flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-700 ${
                    selectedPersonaId === persona.id ? "bg-gray-700" : ""
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: persona.color }} />
                  <span className="text-gray-200 flex-1 truncate">{persona.nickname}</span>
                  <button
                    onClick={(e) => handleDeletePersona(persona.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-red-400"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              <div className="border-t border-gray-700 p-1.5">
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newPersonaName}
                    onChange={(e) => setNewPersonaName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (newPersonaName.trim()) {
                          handleCreatePersona();
                        } else {
                          setPersonaDropdownOpen(false);
                        }
                      } else if (e.key === "Escape") {
                        setPersonaDropdownOpen(false);
                      }
                    }}
                    placeholder="New persona..."
                    maxLength={32}
                    className="min-w-0 flex-1 px-1.5 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleCreatePersona}
                    disabled={!newPersonaName.trim() || creatingPersona}
                    className="flex-shrink-0 px-1.5 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-indigo-500"
            disabled={!connected || loading}
          />
          {isTyping ? (
            <button
              onClick={cancelResponse}
              className="px-2 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!connected || !inputValue.trim() || loading}
              className="px-2 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
