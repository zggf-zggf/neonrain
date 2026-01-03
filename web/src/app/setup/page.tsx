"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDiscordStatus, getGuilds, saveSelectedGuild } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
}

export default function SetupPage() {
  const { getToken, isLoaded: isAuthLoaded } = useAuth();
  const { isLoaded: isUserLoaded } = useUser();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthLoaded && isUserLoaded) {
      checkStatusAndLoadGuilds();
    }
  }, [isAuthLoaded, isUserLoaded]);

  async function checkStatusAndLoadGuilds() {
    try {
      const token = await getToken();
      if (!token) {
        router.push("/");
        return;
      }

      const status = await getDiscordStatus(token);

      // If not connected, redirect to claim
      if (!status.connected) {
        router.push("/claim");
        return;
      }

      // If already has a server, redirect to chat
      if (status.selectedGuild) {
        router.push("/chat");
        return;
      }

      // Load guilds
      setLoadingGuilds(true);
      const guildsData = await getGuilds(token);
      setGuilds(guildsData || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
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

      // Redirect to chat after successful selection
      router.push("/chat");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to select server");
      setSavingServer(false);
    }
  }

  if (loading || !isAuthLoaded || !isUserLoaded) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="text-center text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          Discord Connected!
        </h1>
        <p className="text-gray-400">
          Now let&apos;s select a server for your AI assistant
        </p>
      </div>

      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-xl font-semibold text-white mb-2">
          Select a Server
        </h2>

        {/* Important notice */}
        <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-blue-300 font-medium">This won&apos;t activate the bot yet</p>
              <p className="text-blue-400/80 text-sm mt-1">
                You&apos;ll first chat with your AI assistant on the web to configure its personality.
                You can activate the Discord bot later when you&apos;re ready.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {loadingGuilds ? (
          <div className="text-center py-8">
            <div className="inline-block w-8 h-8 border-4 border-gray-600 border-t-indigo-500 rounded-full animate-spin"></div>
            <p className="text-gray-400 mt-4">Loading your servers...</p>
          </div>
        ) : guilds.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">No servers found</p>
            <p className="text-gray-500 text-sm">
              Make sure you&apos;re a member of at least one Discord server.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {guilds.map((guild) => (
              <button
                key={guild.id}
                onClick={() => handleSelectServer(guild)}
                disabled={savingServer}
                className="w-full px-4 py-4 text-left flex items-center gap-4 border border-gray-700 rounded-lg hover:bg-gray-800 hover:border-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  {guild.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{guild.name}</p>
                  <p className="text-gray-500 text-sm">Click to select</p>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 text-center">
        <p className="text-gray-500 text-sm">
          You can change the server later in your dashboard settings.
        </p>
      </div>
    </div>
  );
}
