"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getDiscordStatus,
  disconnectDiscord,
  getGuilds,
  getServerConfigs,
  addServerConfig,
  ServerConfig,
} from "@/lib/api";

interface Guild {
  id: string;
  name: string;
}

interface AggregatedStats {
  totalMessagesSent: number;
  totalMessagesReceived: number;
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

  // Server configs
  const [serverConfigs, setServerConfigs] = useState<ServerConfig[]>([]);
  const [stats, setStats] = useState<AggregatedStats | null>(null);

  // Add server flow
  const [addingServer, setAddingServer] = useState(false);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [savingServer, setSavingServer] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (isAuthLoaded && isUserLoaded) {
      loadData();
    }
  }, [isAuthLoaded, isUserLoaded]);

  async function loadData() {
    try {
      const token = await getToken();
      if (!token) return;

      const [statusRes, configsRes] = await Promise.all([
        getDiscordStatus(token),
        getServerConfigs(token).catch(() => ({ servers: [] })),
      ]);

      setDiscordConnected(statusRes.connected);
      setServerConfigs(configsRes.servers || []);

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
      setServerConfigs([]);
      setSuccess("Discord disconnected");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function startAddingServer() {
    setAddingServer(true);
    setLoadingGuilds(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      const guildsData = await getGuilds(token);
      // Filter out guilds that are already configured
      const configuredGuildIds = new Set(serverConfigs.map(c => c.guildId));
      const availableGuilds = (guildsData || []).filter(
        (g: Guild) => !configuredGuildIds.has(g.id)
      );
      setGuilds(availableGuilds);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingGuilds(false);
    }
  }

  async function handleAddServer(guild: Guild) {
    setSavingServer(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      const result = await addServerConfig(token, guild.id, guild.name);
      setServerConfigs([...serverConfigs, result.server]);
      setAddingServer(false);
      setSuccess(`Added ${guild.name} - configure it to start monitoring`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingServer(false);
    }
  }

  function cancelAddServer() {
    setAddingServer(false);
    setGuilds([]);
  }

  const activeServerCount = serverConfigs.filter(c => c.botActive).length;

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-green-400">
              <span className="w-3 h-3 bg-green-400 rounded-full"></span>
              Connected
            </div>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              Disconnect
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

      {/* Overview Stats */}
      {discordConnected && stats && (
        <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Servers</div>
              <div className="text-2xl font-bold text-white">{serverConfigs.length}</div>
              <div className="text-gray-500 text-xs mt-1">
                {activeServerCount} active
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Messages Received</div>
              <div className="text-2xl font-bold text-white">{stats.totalMessagesReceived}</div>
              <div className="text-gray-500 text-xs mt-1">Across all servers</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Messages Sent</div>
              <div className="text-2xl font-bold text-white">{stats.totalMessagesSent}</div>
              <div className="text-gray-500 text-xs mt-1">Across all servers</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Response Rate</div>
              <div className="text-2xl font-bold text-white">
                {stats.totalMessagesReceived > 0
                  ? Math.round((stats.totalMessagesSent / stats.totalMessagesReceived) * 100)
                  : 0}%
              </div>
              <div className="text-gray-500 text-xs mt-1">Sent / Received</div>
            </div>
          </div>
        </section>
      )}

      {/* Server List */}
      {discordConnected && (
        <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Servers</h2>
            {!addingServer && (
              <button
                onClick={startAddingServer}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm"
              >
                Add Server
              </button>
            )}
          </div>

          {/* Add Server Flow */}
          {addingServer && (
            <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
              <h3 className="text-white font-medium mb-3">Select a server to add</h3>
              {loadingGuilds ? (
                <p className="text-gray-400">Loading servers...</p>
              ) : guilds.length === 0 ? (
                <p className="text-gray-400">No more servers available to add.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                  {guilds.map((guild) => (
                    <button
                      key={guild.id}
                      onClick={() => handleAddServer(guild)}
                      disabled={savingServer}
                      className="w-full px-4 py-3 text-left flex items-center justify-between border border-gray-700 rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                          {guild.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-white">{guild.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={cancelAddServer}
                disabled={savingServer}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Server Cards */}
          {serverConfigs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 mb-4">No servers configured yet.</p>
              {!addingServer && (
                <button
                  onClick={startAddingServer}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  Add Your First Server
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {serverConfigs.map((config) => (
                <Link
                  key={config.id}
                  href={`/dashboard/servers/${config.id}`}
                  className="block p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">
                        {config.guildName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-white font-medium">{config.guildName}</h3>
                        <p className="text-gray-400 text-sm">
                          {config.botActive ? (
                            <span className="text-green-400">Active</span>
                          ) : (
                            <span className="text-gray-500">Inactive</span>
                          )}
                          {config.websiteCount > 0 && ` · ${config.websiteCount} website${config.websiteCount !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-gray-400 text-sm">
                        {config.messagesSentCount} sent / {config.messagesReceivedCount} received
                      </div>
                      <div className="text-gray-500 text-xs">
                        Last activity: {formatTimeAgo(config.lastMessageSentAt || config.lastMessageReceivedAt)}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Quick Links */}
      {discordConnected && serverConfigs.length > 0 && (
        <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-xl font-semibold text-white mb-4">Quick Links</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/chat"
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition"
            >
              Open Chat
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
