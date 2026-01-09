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
  Website,
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

      // Load websites
      await loadWebsites(token, config.guildId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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
