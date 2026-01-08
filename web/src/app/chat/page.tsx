"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getDiscordStatus, setDiscordBotStatus } from "@/lib/api";
import { ChatPane, ChatPaneRef } from "@/components/ChatPane";

interface Persona {
  id: string;
  nickname: string;
  color: string;
}

interface ConversationInfo {
  id: string;
  paneIndex: number;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    senderName?: string;
    createdAt: string;
  }>;
}

interface Group {
  id: string;
  title: string;
  paneCount: number;
  createdAt: string;
  updatedAt: string;
  conversations: ConversationInfo[];
}

interface GroupListItem {
  id: string;
  title: string;
  paneCount: number;
  updatedAt: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export default function ChatPage() {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discordBotActive, setDiscordBotActive] = useState(false);
  const [activatingBot, setActivatingBot] = useState(false);

  // Group state
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showPaneSelector, setShowPaneSelector] = useState(false);

  // User names for chat display
  const [botName, setBotName] = useState<string>("Assistant");
  const defaultUserName = user?.firstName || user?.username || "You";

  // Personas (shared across all panes)
  const [personas, setPersonas] = useState<Persona[]>([]);

  // Global send-to-all input
  const [globalInputValue, setGlobalInputValue] = useState("");

  // Refs to each chat pane
  const paneRefs = useRef<(ChatPaneRef | null)[]>([]);

  // Load groups list
  const loadGroups = useCallback(async (authToken: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/groups`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups);
        return data.groups;
      }
    } catch (err) {
      console.error("[Chat] Failed to load groups:", err);
    }
    return [];
  }, []);

  // Load personas
  const loadPersonas = useCallback(async (authToken: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/personas`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setPersonas(data.personas);
      }
    } catch (err) {
      console.error("[Chat] Failed to load personas:", err);
    }
  }, []);

  // Load specific group
  const loadGroup = useCallback(async (authToken: string, groupId: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setActiveGroup(data.group);
        return data.group;
      }
    } catch (err) {
      console.error("[Chat] Failed to load group:", err);
    }
    return null;
  }, []);

  // Create new group
  const createGroup = async (paneCount: number) => {
    setCreatingGroup(true);
    setShowPaneSelector(false);
    try {
      // Get fresh token
      const freshToken = await getToken();
      if (!freshToken) {
        console.error("[Chat] No token available");
        return;
      }
      setToken(freshToken);

      const url = `${BACKEND_URL}/api/chat/groups`;
      console.log("[Chat] Creating group at:", url, "paneCount:", paneCount);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${freshToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paneCount }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("[Chat] Group created:", data.group.id);
        setActiveGroup(data.group);
        await loadGroups(freshToken);
      } else {
        const errorText = await response.text();
        console.error("[Chat] Failed to create group:", response.status, errorText);
      }
    } catch (err) {
      console.error("[Chat] Failed to create group:", err);
    } finally {
      setCreatingGroup(false);
    }
  };

  // Delete group
  const deleteGroup = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token || !confirm("Delete this chat?")) return;

    try {
      await fetch(`${BACKEND_URL}/api/chat/groups/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const updatedGroups = groups.filter((g) => g.id !== id);
      setGroups(updatedGroups);

      if (activeGroup?.id === id) {
        if (updatedGroups.length > 0) {
          await loadGroup(token, updatedGroups[0].id);
        } else {
          setActiveGroup(null);
        }
      }
    } catch (err) {
      console.error("[Chat] Failed to delete group:", err);
    }
  };

  // Create persona
  const createPersona = async (nickname: string): Promise<Persona | null> => {
    if (!token) return null;
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/personas`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nickname }),
      });

      if (response.ok) {
        const data = await response.json();
        setPersonas((prev) => [...prev, data.persona]);
        return data.persona;
      }
    } catch (err) {
      console.error("[Chat] Failed to create persona:", err);
    }
    return null;
  };

  // Delete persona
  const deletePersona = async (id: string) => {
    if (!token) return;
    try {
      await fetch(`${BACKEND_URL}/api/chat/personas/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setPersonas((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("[Chat] Failed to delete persona:", err);
    }
  };

  // Send to all panes
  const sendToAll = useCallback(() => {
    if (!globalInputValue.trim()) return;
    const content = globalInputValue.trim();
    setGlobalInputValue("");

    paneRefs.current.forEach((ref) => {
      if (ref?.isConnected()) {
        ref.sendMessage(content);
      }
    });
  }, [globalInputValue]);

  // Initialize
  useEffect(() => {
    if (!isAuthLoaded || !isUserLoaded) return;

    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    async function initialize() {
      const authToken = await getToken();
      if (!authToken) return;
      setToken(authToken);

      // Load Discord status
      try {
        const status = await getDiscordStatus(authToken);
        setDiscordBotActive(status.botActive);
        if (status.botName) {
          setBotName(status.botName);
        }
      } catch {
        // Ignore
      }

      // Load personas and groups
      await loadPersonas(authToken);
      const groupList = await loadGroups(authToken);

      // Load most recent group or show empty state
      if (groupList.length > 0) {
        await loadGroup(authToken, groupList[0].id);
      }

      setLoading(false);
    }

    initialize();
  }, [isAuthLoaded, isUserLoaded, isSignedIn, getToken, router, loadPersonas, loadGroups, loadGroup]);

  async function handleActivateBot() {
    if (!token) return;
    setActivatingBot(true);
    try {
      const result = await setDiscordBotStatus(token, true);
      setDiscordBotActive(result.active);
    } catch (err) {
      console.error("[Chat] Failed to activate bot:", err);
    } finally {
      setActivatingBot(false);
    }
  }

  if (!isAuthLoaded || !isUserLoaded || loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-gray-400">Loading...</div>
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
            onClick={() => setShowPaneSelector(true)}
            disabled={creatingGroup}
            className="w-full px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {creatingGroup ? "Creating..." : "New Chat"}
          </button>
        </div>

        {/* Groups List */}
        <div className="flex-1 overflow-y-auto">
          {groups.map((group) => (
            <div
              key={group.id}
              onClick={() => token && loadGroup(token, group.id)}
              className={`group px-3 py-2 cursor-pointer hover:bg-gray-800 flex items-center justify-between ${
                activeGroup?.id === group.id ? "bg-gray-800" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200 truncate">{group.title}</span>
                  {group.paneCount > 1 && (
                    <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                      {group.paneCount}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(group.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={(e) => deleteGroup(group.id, e)}
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

      {/* Pane Count Selector Modal */}
      {showPaneSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-medium text-white mb-4">How many conversation panes?</h3>
            <div className="flex gap-3">
              {[1, 3, 5].map((count) => (
                <button
                  key={count}
                  onClick={() => createGroup(count)}
                  className="flex-1 py-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-medium transition"
                >
                  {count}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowPaneSelector(false)}
              className="w-full mt-4 py-2 text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 border-b border-indigo-800/50">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>

                <div>
                  <p className="text-white font-medium truncate max-w-md">
                    {activeGroup?.title || "No chat selected"}
                    {activeGroup && activeGroup.paneCount > 1 && (
                      <span className="ml-2 text-xs text-indigo-300">({activeGroup.paneCount} panes)</span>
                    )}
                  </p>
                  <p className="text-indigo-300 text-sm">
                    {discordBotActive ? "Discord Bot Active" : "Configure your AI assistant"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!discordBotActive && activeGroup && (
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

        {/* Chat Panes */}
        {activeGroup && token && activeGroup.conversations?.length > 0 ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 flex min-h-0">
              {activeGroup.conversations.map((conv, index) => (
                <div key={conv.id} className="flex-1 min-w-0 h-full">
                  <ChatPane
                    ref={(el) => {
                      paneRefs.current[index] = el;
                    }}
                    conversationId={conv.id}
                    token={token}
                    botName={botName}
                    defaultUserName={defaultUserName}
                    personas={personas}
                    onPersonaCreate={createPersona}
                    onPersonaDelete={deletePersona}
                    paneIndex={index}
                    totalPanes={activeGroup.paneCount}
                  />
                </div>
              ))}
            </div>

            {/* Global Send-to-All Input (only show for multi-pane) */}
            {activeGroup.paneCount > 1 && (
              <div className="border-t border-gray-700 bg-gray-900 px-4 py-3">
                <div className="flex gap-3 items-center">
                  <span className="text-xs text-gray-400 whitespace-nowrap">Send to all:</span>
                  <input
                    type="text"
                    value={globalInputValue}
                    onChange={(e) => setGlobalInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        sendToAll();
                      }
                    }}
                    placeholder="Type a message to send to all panes..."
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={sendToAll}
                    disabled={!globalInputValue.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 text-sm"
                  >
                    Send All
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Start a New Chat</h3>
              <p className="text-gray-400 mb-6">
                Create a new chat with 1, 3, or 5 conversation panes.
              </p>
              <button
                onClick={() => setShowPaneSelector(true)}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                New Chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
