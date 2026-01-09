"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getServerConfig,
  updateServerConfig,
  deleteServerConfig,
  getServerWebsites,
  addServerWebsite,
  removeServerWebsite,
  rescrapeWebsite,
  getWebsiteStatus,
  getAgentActions,
  Website,
  AgentAction,
} from "@/lib/api";

interface ServerConfigData {
  id: string;
  serverId: string;
  guildId: string;
  guildName: string;
  botName: string;
  botActive: boolean;
  personality: string;
  rules: string;
  information: string;
  messagesSentCount: number;
  messagesReceivedCount: number;
  lastMessageSentAt: string | null;
  lastMessageReceivedAt: string | null;
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

function formatMessageTimestamp(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  // Include date for older messages
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr} ${timeStr}`;
}

export default function ServerConfigPage() {
  const params = useParams();
  const router = useRouter();
  const configId = params.configId as string;
  const { getToken, isLoaded: isAuthLoaded } = useAuth();

  const [loading, setLoading] = useState(true);
  const [serverConfig, setServerConfig] = useState<ServerConfigData | null>(null);

  // Editable config state
  const [personality, setPersonality] = useState("");
  const [rules, setRules] = useState("");
  const [information, setInformation] = useState("");
  const [savedConfig, setSavedConfig] = useState({ personality: "", rules: "", information: "" });

  const [savingConfig, setSavingConfig] = useState(false);
  const [togglingBot, setTogglingBot] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Website state
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loadingWebsites, setLoadingWebsites] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  const [newWebsiteUrl, setNewWebsiteUrl] = useState("");
  const [newWebsiteName, setNewWebsiteName] = useState("");
  const [scrapingWebsiteId, setScrapingWebsiteId] = useState<string | null>(null);

  // Agent actions state
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  const [loadingActions, setLoadingActions] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (isAuthLoaded && configId) {
      loadData();
    }
  }, [isAuthLoaded, configId]);

  async function loadData() {
    try {
      const token = await getToken();
      if (!token) return;

      const result = await getServerConfig(token, configId);
      const config = result.server;

      setServerConfig(config);
      setPersonality(config.personality);
      setRules(config.rules);
      setInformation(config.information);
      setSavedConfig({
        personality: config.personality,
        rules: config.rules,
        information: config.information,
      });

      // Load websites and agent actions in parallel
      await Promise.all([
        loadWebsites(token, config.guildId),
        loadAgentActions(token)
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAgentActions(token?: string) {
    const t = token || await getToken();
    if (!t) return;

    setLoadingActions(true);
    try {
      const result = await getAgentActions(t, configId, 5);
      setAgentActions(result.actions || []);
    } catch (err) {
      console.error("Failed to load agent actions:", err);
    } finally {
      setLoadingActions(false);
    }
  }

  async function copyActionToClipboard(action: AgentAction) {
    const preceding = action.messageHistory?.preceding || [];
    const botName = serverConfig?.botName || 'Bot';

    let markdown = `## #${action.channelName}\n\n`;

    for (const msg of preceding) {
      markdown += `**${msg.author}:** ${msg.content}\n\n`;
    }

    markdown += `**${botName}:** ${action.agentMessage}\n`;

    try {
      await navigator.clipboard.writeText(markdown);
      setCopiedActionId(action.id);
      setTimeout(() => setCopiedActionId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  async function loadWebsites(token?: string, guildId?: string) {
    const t = token || await getToken();
    const g = guildId || serverConfig?.guildId;
    if (!t || !g) return;

    setLoadingWebsites(true);
    try {
      const result = await getServerWebsites(t, g);
      setWebsites(result.websites || []);
    } catch (err) {
      console.error("Failed to load websites:", err);
    } finally {
      setLoadingWebsites(false);
    }
  }

  async function handleToggleBot() {
    if (!serverConfig) return;
    setTogglingBot(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      const newActive = !serverConfig.botActive;
      const result = await updateServerConfig(token, configId, { botActive: newActive });
      setServerConfig({ ...serverConfig, botActive: result.server.botActive });
      setSuccess(newActive ? "Bot activated" : "Bot deactivated");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTogglingBot(false);
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      await updateServerConfig(token, configId, {
        personality,
        rules,
        information,
      });

      setSavedConfig({ personality, rules, information });
      setSuccess("Configuration saved");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      await deleteServerConfig(token, configId);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  }

  async function handleAddWebsite() {
    if (!serverConfig || !newWebsiteUrl.trim()) return;

    setAddingWebsite(true);
    setError("");

    try {
      const token = await getToken();
      if (!token) return;

      const result = await addServerWebsite(
        token,
        serverConfig.guildId,
        newWebsiteUrl.trim(),
        newWebsiteName.trim() || undefined
      );

      const newWebsite = result.website;
      setWebsites([...websites, newWebsite]);
      setNewWebsiteUrl("");
      setNewWebsiteName("");
      setSuccess("Website added. Scraping in progress...");
      setScrapingWebsiteId(newWebsite.id);

      // Poll for scrape completion
      pollWebsiteStatus(newWebsite.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingWebsite(false);
    }
  }

  async function handleRemoveWebsite(websiteId: string) {
    if (!serverConfig) return;

    try {
      const token = await getToken();
      if (!token) return;

      await removeServerWebsite(token, serverConfig.guildId, websiteId);
      setWebsites(websites.filter((w) => w.id !== websiteId));
      setSuccess("Website removed");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRescrape(websiteId: string) {
    if (!serverConfig) return;

    setScrapingWebsiteId(websiteId);

    try {
      const token = await getToken();
      if (!token) return;

      await rescrapeWebsite(token, serverConfig.guildId, websiteId);
      setSuccess("Scraping started...");

      pollWebsiteStatus(websiteId);
    } catch (err: any) {
      setError(err.message);
      setScrapingWebsiteId(null);
    }
  }

  async function pollWebsiteStatus(websiteId: string) {
    if (!serverConfig) return;

    const startTime = Date.now();
    const maxDuration = 60000;

    const poll = async () => {
      if (Date.now() - startTime > maxDuration) {
        setScrapingWebsiteId(null);
        return;
      }

      try {
        const token = await getToken();
        if (!token || !serverConfig) return;

        const result = await getWebsiteStatus(token, serverConfig.guildId, websiteId);
        const website = result.website;

        if (website.lastScrapeStatus !== "pending") {
          setWebsites((prev) =>
            prev.map((w) => (w.id === websiteId ? website : w))
          );
          setScrapingWebsiteId(null);
          setSuccess(
            website.lastScrapeStatus === "success"
              ? "Scrape completed!"
              : "Scrape failed"
          );
          setTimeout(() => setSuccess(""), 3000);
          return;
        }

        setTimeout(poll, 2000);
      } catch {
        setTimeout(poll, 2000);
      }
    };

    setTimeout(poll, 2000);
  }

  const hasConfigChanges =
    personality !== savedConfig.personality ||
    rules !== savedConfig.rules ||
    information !== savedConfig.information;

  if (loading || !isAuthLoaded) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!serverConfig) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Server configuration not found.</p>
          <Link href="/dashboard" className="text-indigo-400 hover:text-indigo-300">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/dashboard"
          className="text-gray-400 hover:text-white transition"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
            {serverConfig.guildName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{serverConfig.guildName}</h1>
            <p className="text-gray-400 text-sm">Server Configuration</p>
          </div>
        </div>
      </div>

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

      {/* Bot Status */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">Bot Status</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white font-medium">
              {serverConfig.botActive ? "Bot is active" : "Bot is inactive"}
            </p>
            <p className="text-gray-400 text-sm">
              {serverConfig.botActive
                ? `Responding to messages in ${serverConfig.guildName}`
                : "Enable to start responding to Discord messages"}
            </p>
          </div>
          <button
            onClick={handleToggleBot}
            disabled={togglingBot}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              serverConfig.botActive ? "bg-green-600" : "bg-gray-600"
            } ${togglingBot ? "opacity-50" : ""}`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                serverConfig.botActive ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Messages Received</div>
            <div className="text-2xl font-bold text-white">{serverConfig.messagesReceivedCount}</div>
            <div className="text-gray-500 text-xs mt-1">
              Last: {formatTimeAgo(serverConfig.lastMessageReceivedAt)}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Messages Sent</div>
            <div className="text-2xl font-bold text-white">{serverConfig.messagesSentCount}</div>
            <div className="text-gray-500 text-xs mt-1">
              Last: {formatTimeAgo(serverConfig.lastMessageSentAt)}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Response Rate</div>
            <div className="text-2xl font-bold text-white">
              {serverConfig.messagesReceivedCount > 0
                ? Math.round((serverConfig.messagesSentCount / serverConfig.messagesReceivedCount) * 100)
                : 0}%
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Status</div>
            <div className="flex items-center gap-2 mt-1">
              {serverConfig.botActive ? (
                <>
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  <span className="text-green-400 font-medium">Active</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                  <span className="text-gray-400 font-medium">Inactive</span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Recent Agent Actions */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold text-white mb-2">Recent Agent Actions</h2>
        <p className="text-gray-400 text-sm mb-4">
          Messages sent by your AI agent with conversation context.
        </p>

        {loadingActions ? (
          <p className="text-gray-400">Loading actions...</p>
        ) : agentActions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No agent actions yet.</p>
            <p className="text-gray-600 text-sm mt-1">
              Actions will appear here when your bot responds to messages.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {agentActions.map((action) => {
              const isExpanded = expandedActionId === action.id;
              const preceding = action.messageHistory?.preceding || [];
              const displayMessages = isExpanded ? preceding : preceding.slice(-3);

              return (
                <div
                  key={action.id}
                  className="bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:bg-gray-750 transition"
                  onClick={() => setExpandedActionId(isExpanded ? null : action.id)}
                >
                  <div className="p-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-indigo-400 rounded-full" />
                        <span className="text-white font-medium">#{action.channelName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">{formatTimeAgo(action.createdAt)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyActionToClipboard(action);
                          }}
                          className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition"
                          title="Copy conversation"
                        >
                          {copiedActionId === action.id ? (
                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* Trigger description (only when expanded) */}
                    {isExpanded && action.triggerDescription && (
                      <div className="text-xs text-gray-500 mb-3 pb-2 border-b border-gray-700">
                        Trigger: {action.triggerDescription}
                      </div>
                    )}

                    {/* Message history - unified view */}
                    <div className="space-y-2 text-sm">
                      {displayMessages.map((msg, idx) => (
                        <div key={idx} className={isExpanded ? 'flex gap-2' : 'flex gap-2 truncate'}>
                          <span className="text-gray-500 text-xs whitespace-nowrap flex-shrink-0">
                            {formatMessageTimestamp(msg.timestamp)}
                          </span>
                          <div className={isExpanded ? 'break-words' : 'truncate'}>
                            <span className="text-gray-400 font-medium">{msg.author}:</span>
                            <span className="text-gray-300 ml-1">{msg.content}</span>
                          </div>
                        </div>
                      ))}

                      {/* Agent response - highlighted */}
                      <div className={isExpanded
                        ? 'flex gap-2 bg-indigo-900/30 -mx-4 px-4 py-2 border-l-2 border-indigo-500'
                        : 'flex gap-2 bg-indigo-900/30 -mx-4 px-4 py-2 border-l-2 border-indigo-500 truncate'
                      }>
                        <span className="text-gray-500 text-xs whitespace-nowrap flex-shrink-0">
                          {formatMessageTimestamp(action.createdAt)}
                        </span>
                        <div className={isExpanded ? 'break-words' : 'truncate'}>
                          <span className="text-indigo-400 font-medium">{serverConfig?.botName || 'Bot'}:</span>
                          <span className="text-indigo-200 ml-1">{action.agentMessage}</span>
                        </div>
                      </div>
                    </div>

                    {/* Expand hint when collapsed */}
                    {!isExpanded && preceding.length > 3 && (
                      <div className="text-xs text-gray-500 mt-2 text-center">
                        Click to see {preceding.length - 3} more message{preceding.length - 3 > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Websites */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold text-white mb-2">Important Websites</h2>
        <p className="text-gray-400 text-sm mb-4">
          These websites are scraped daily and provided to HUMA as context.
        </p>

        {loadingWebsites ? (
          <p className="text-gray-400">Loading websites...</p>
        ) : (
          <>
            {websites.length > 0 && (
              <div className="space-y-3 mb-4">
                {websites.map((website) => (
                  <div
                    key={website.id}
                    className="bg-gray-800 rounded-lg p-4 flex items-start justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium truncate">
                          {website.name || new URL(website.url).hostname}
                        </span>
                        {website.lastScrapeStatus === "success" && (
                          <span className="w-2 h-2 bg-green-400 rounded-full" />
                        )}
                        {website.lastScrapeStatus === "error" && (
                          <span className="w-2 h-2 bg-red-400 rounded-full" />
                        )}
                        {website.lastScrapeStatus === "pending" && (
                          <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                        )}
                      </div>
                      <p className="text-gray-400 text-sm truncate">{website.url}</p>
                      <p className="text-gray-500 text-xs mt-1">
                        Last scraped: {formatTimeAgo(website.lastScrapedAt)}
                        {website.contentSize > 0 && ` · ${(website.contentSize / 1024).toFixed(1)} KB`}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleRescrape(website.id)}
                        disabled={scrapingWebsiteId === website.id}
                        className="px-3 py-1 text-sm bg-gray-700 text-white rounded hover:bg-gray-600 transition disabled:opacity-50"
                      >
                        {scrapingWebsiteId === website.id ? "Scraping..." : "Rescrape"}
                      </button>
                      <button
                        onClick={() => handleRemoveWebsite(website.id)}
                        className="px-3 py-1 text-sm bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-gray-800 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="url"
                  value={newWebsiteUrl}
                  onChange={(e) => setNewWebsiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 md:col-span-2"
                />
                <input
                  type="text"
                  value={newWebsiteName}
                  onChange={(e) => setNewWebsiteName(e.target.value)}
                  placeholder="Name (optional)"
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                onClick={handleAddWebsite}
                disabled={addingWebsite || !newWebsiteUrl.trim()}
                className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {addingWebsite ? "Adding..." : "Add Website"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Agent Configuration */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">Agent Configuration</h2>

        {/* Personality */}
        <div className="mb-6">
          <label className="block text-white font-medium mb-2">Personality</label>
          <p className="text-gray-400 text-sm mb-2">
            Define the character traits and communication style.
          </p>
          <textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="e.g., Friendly, witty, and knowledgeable..."
            className="w-full h-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>

        {/* Rules */}
        <div className="mb-6">
          <label className="block text-white font-medium mb-2">Rules</label>
          <p className="text-gray-400 text-sm mb-2">
            Set behavioral guidelines and restrictions.
          </p>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder="e.g., Never discuss politics. Always be respectful..."
            className="w-full h-24 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>

        {/* Information */}
        <div className="mb-6">
          <label className="block text-white font-medium mb-2">Information</label>
          <p className="text-gray-400 text-sm mb-2">
            Provide context and knowledge for your AI agent.
          </p>
          <textarea
            value={information}
            onChange={(e) => setInformation(e.target.value)}
            placeholder="e.g., Our Discord server is for game developers..."
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

      {/* Danger Zone */}
      <section className="bg-gray-900 rounded-xl p-6 border border-red-900/50">
        <h2 className="text-xl font-semibold text-red-400 mb-4">Danger Zone</h2>
        {showDeleteConfirm ? (
          <div>
            <p className="text-gray-400 mb-4">
              Are you sure you want to remove this server? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Yes, Remove Server"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-gray-400 mb-4">
              Remove this server configuration. This will stop the bot from monitoring this server.
            </p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition"
            >
              Remove Server
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
