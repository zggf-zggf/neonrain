"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { claimDiscordToken } from "@/lib/api";

export default function ClaimPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) {
        setError("Please sign in to claim your Discord token");
        return;
      }

      await claimDiscordToken(token, code);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Failed to claim token");
    } finally {
      setLoading(false);
    }
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Only allow alphanumeric characters and uppercase
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (value.length <= 6) {
      setCode(value);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-white mb-4 text-center">
        Claim Discord Token
      </h1>
      <p className="text-gray-400 text-center mb-8">
        Enter the 6-character code from the NeonRain Chrome extension.
      </p>

      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="code"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Claim Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={handleCodeChange}
              placeholder="ABC123"
              className="w-full px-4 py-4 text-center text-2xl tracking-widest font-mono bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 uppercase"
              maxLength={6}
              autoComplete="off"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {loading ? "Claiming..." : "Claim Token"}
          </button>
        </form>
      </div>

      <div className="mt-8 text-center">
        <h3 className="text-lg font-medium text-white mb-4">
          How to get a claim code:
        </h3>
        <ol className="text-gray-400 text-left space-y-2 max-w-sm mx-auto">
          <li className="flex gap-3">
            <span className="text-indigo-400">1.</span>
            Install the NeonRain Chrome extension
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400">2.</span>
            Go to{" "}
            <a
              href="https://discord.com/app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline"
            >
              discord.com
            </a>{" "}
            and log in
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400">3.</span>
            Click the NeonRain extension icon
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400">4.</span>
            Click &quot;Capture Discord Token&quot;
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400">5.</span>
            Copy the 6-character code shown
          </li>
        </ol>
      </div>
    </div>
  );
}
