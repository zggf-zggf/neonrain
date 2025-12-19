"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getDiscordStatus,
  disconnectDiscord,
  getAgentConfig,
  saveAgentConfig,
  getGuilds,
  getSelectedGuild,
  saveSelectedGuild,
  removeSelectedGuild,
  AgentConfig,
} from "@/lib/api";

interface Guild {
  id: string;
  name: string;
}

interface SelectedGuild {
  id: string;
  name: string;
}

interface Stats {
  lastMessageSentAt: string | null;
  lastMessageReceivedAt: string | null;
  messagesSentCount: number;
  messagesReceivedCount: number;
}

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export default function DashboardPage() {
  const { getToken, isLoaded: isAuthLoaded } = useAuth();
  const { isLoaded: isUserLoaded } = useUser();
  const [loading, setLoading] = useState(true);
  const [discordConnected, setDiscordConnected] = useState(false);
  const [selectedGuild, setSelectedGuild] = useState<SelectedGuild | null>(null);

  // Agent config state
  const [config, setConfig] = useState<AgentConfig>({ personality: "", rules: "", information: "" });
  const [savedConfig, setSavedConfig] = useState<AgentConfig>({ personality: "", rules: "", information: "" });
  const [savingConfig, setSavingConfig] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);

  // Server selection state
  const [selectingServer, setSelectingServer] = useState(false);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [savingServer, setSavingServer] = useState(false);

  useEffect(() => {
    // Wait for Clerk to be fully loaded before fetching data
    if (isAuthLoaded && isUserLoaded) {
      loadData();
    }
  }, [isAuthLoaded, isUserLoaded]);

  async function loadData() {
    try {
      const token = await getToken();
      if (!token) return;

      const [statusRes, configRes] = await Promise.all([
        getDiscordStatus(token),
        getAgentConfig(token).catch(() => ({ config: { personality: "", rules: "", information: "" } })),
      ]);

      setDiscordConnected(statusRes.connected);
      setSelectedGuild(statusRes.selectedGuild || null);

      const loadedConfig = {
        personality: configRes.config?.personality || "",
        rules: configRes.config?.rules || "",
        information: configRes.config?.information || "",
      };
      setConfig(loadedConfig);
      setSavedConfig(loadedConfig);

      // Set stats from status response
      if (statusRes.stats) {
        setStats(statusRes.stats);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      await disconnectDiscord(token);
      setDiscordConnected(false);
      setSelectedGuild(null);
      setSuccess("Discord disconnected");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;

      await saveAgentConfig(token, config);
      setSavedConfig(config);
      setSuccess("Configuration saved successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingConfig(false);
    }
  }

  const hasConfigChanges = config.personality !== savedConfig.personality ||
    config.rules !== savedConfig.rules ||
    config.information !== savedConfig.information;

  async function startSelectingServer() {
    setSelectingServer(true);
    setLoadingGuilds(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      const guildsData = await getGuilds(token);
      setGuilds(guildsData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingGuilds(false);
    }
  }

  async function handleSelectServer(guild: Guild) {
    setSavingServer(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      await saveSelectedGuild(token, guild.id, guild.name);
      setSelectedGuild({ id: guild.id, name: guild.name });
      setSelectingServer(false);
      setSuccess(`Now monitoring all channels in ${guild.name}`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingServer(false);
    }
  }

  async function handleRemoveServer() {
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      await removeSelectedGuild(token);
      setSelectedGuild(null);
      setSuccess("Server removed");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function cancelSelection() {
    setSelectingServer(false);
    setGuilds([]);
  }

  if (loading || !isAuthLoaded || !isUserLoaded) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard</h1>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-900/50 border border-green-700 text-green-200 px-4 py-3 rounded-lg mb-6">
          {success}
        </div>
      )}

      {/* Discord Connection */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Discord Connection
        </h2>

        {discordConnected ? (
          <div>
            <div className="flex items-center gap-2 text-green-400 mb-4">
              <span className="w-3 h-3 bg-green-400 rounded-full"></span>
              Connected
            </div>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              Disconnect Discord
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 text-gray-400 mb-4">
              <span className="w-3 h-3 bg-gray-500 rounded-full"></span>
              Not Connected
            </div>
            <p className="text-gray-400 mb-4">
              Use the Chrome extension to capture your Discord token, then claim
              it here.
            </p>
            <Link
              href="/claim"
              className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              Claim Discord Token
            </Link>
          </div>
        )}
      </section>

      {/* Server Selection */}
      {discordConnected && (
        <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">
            Monitored Server
          </h2>

          {selectingServer ? (
            <div>
              {loadingGuilds ? (
                <p className="text-gray-400">Loading servers...</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-gray-400 mb-4">
                    Select a server to monitor. The bot will respond in all channels.
                  </p>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {guilds.map((guild) => (
                      <button
                        key={guild.id}
                        onClick={() => handleSelectServer(guild)}
                        disabled={savingServer}
                        className={`w-full px-4 py-3 text-left flex items-center justify-between border rounded-lg transition ${
                          selectedGuild?.id === guild.id
                            ? "border-indigo-600 bg-indigo-900/30"
                            : "border-gray-700 hover:bg-gray-800"
                        } disabled:opacity-50`}
                      >
                        <span className="text-white">{guild.name}</span>
                        {selectedGuild?.id === guild.id && (
                          <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                            Current
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={cancelSelection}
                      disabled={savingServer}
                      className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {selectedGuild ? (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
                      {selectedGuild.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-medium">{selectedGuild.name}</p>
                      <p className="text-gray-400 text-sm">Monitoring all channels</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={startSelectingServer}
                      className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
                    >
                      Change Server
                    </button>
                    <button
                      onClick={handleRemoveServer}
                      className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-gray-400 mb-4">
                    No server selected. Select a server to start monitoring.
                  </p>
                  <button
                    onClick={startSelectingServer}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                  >
                    Select Server
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Agent Stats */}
      {discordConnected && stats && (
        <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">
            Agent Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Messages Received</div>
              <div className="text-2xl font-bold text-white">{stats.messagesReceivedCount}</div>
              <div className="text-gray-500 text-xs mt-1">
                Last: {formatTimeAgo(stats.lastMessageReceivedAt)}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Messages Sent</div>
              <div className="text-2xl font-bold text-white">{stats.messagesSentCount}</div>
              <div className="text-gray-500 text-xs mt-1">
                Last: {formatTimeAgo(stats.lastMessageSentAt)}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Response Rate</div>
              <div className="text-2xl font-bold text-white">
                {stats.messagesReceivedCount > 0
                  ? Math.round((stats.messagesSentCount / stats.messagesReceivedCount) * 100)
                  : 0}%
              </div>
              <div className="text-gray-500 text-xs mt-1">Sent / Received</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Status</div>
              <div className="flex items-center gap-2 mt-1">
                {selectedGuild ? (
                  <>
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    <span className="text-green-400 font-medium">Active</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                    <span className="text-yellow-400 font-medium">No Server</span>
                  </>
                )}
              </div>
              <div className="text-gray-500 text-xs mt-1">
                {selectedGuild ? `In ${selectedGuild.name}` : "Select a server"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Agent Configuration */}
      {discordConnected && (
        <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-xl font-semibold text-white mb-4">
            Agent Configuration
          </h2>

          {/* Personality */}
          <div className="mb-6">
            <label className="block text-white font-medium mb-2">
              Personality
            </label>
            <p className="text-gray-400 text-sm mb-2">
              Define the character traits and communication style of your AI agent.
            </p>
            <textarea
              value={config.personality}
              onChange={(e) => setConfig({ ...config, personality: e.target.value })}
              placeholder="e.g., Friendly, witty, and knowledgeable. Uses casual language and occasional humor..."
              className="w-full h-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Rules */}
          <div className="mb-6">
            <label className="block text-white font-medium mb-2">
              Rules
            </label>
            <p className="text-gray-400 text-sm mb-2">
              Set behavioral guidelines and restrictions for your AI agent.
            </p>
            <textarea
              value={config.rules}
              onChange={(e) => setConfig({ ...config, rules: e.target.value })}
              placeholder="e.g., Never discuss politics. Always be respectful. Only respond in English..."
              className="w-full h-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Information */}
          <div className="mb-6">
            <label className="block text-white font-medium mb-2">
              Information
            </label>
            <p className="text-gray-400 text-sm mb-2">
              Provide context and knowledge for your AI agent to reference during conversations.
            </p>
            <textarea
              value={config.information}
              onChange={(e) => setConfig({ ...config, information: e.target.value })}
              placeholder="e.g., Our Discord server is for game developers. The main game we discuss is Project X..."
              className="w-full h-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig || !hasConfigChanges}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {savingConfig ? "Saving..." : "Save Configuration"}
            </button>
            {hasConfigChanges && (
              <span className="text-gray-500 text-sm">Unsaved changes</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
