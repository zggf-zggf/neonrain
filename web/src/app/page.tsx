import { SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-6">
          AI-Powered Discord Automation
        </h1>
        <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
          Connect your Discord account and let HUMA AI respond to messages with
          human-like intelligence. Configure channels, customize behavior, and
          automate your Discord presence.
        </p>

        <SignedOut>
          <Link
            href="/sign-up"
            className="inline-block px-8 py-4 text-lg bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
          >
            Get Started Free
          </Link>
        </SignedOut>

        <SignedIn>
          <Link
            href="/dashboard"
            className="inline-block px-8 py-4 text-lg bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
          >
            Go to Dashboard
          </Link>
        </SignedIn>
      </div>

      <div className="mt-20 grid md:grid-cols-3 gap-8">
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <div className="text-3xl mb-4">1</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Install Extension
          </h3>
          <p className="text-gray-400">
            Install our Chrome extension to securely capture your Discord token.
          </p>
        </div>

        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <div className="text-3xl mb-4">2</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Connect Discord
          </h3>
          <p className="text-gray-400">
            Use the extension on Discord.com to get a claim code, then link it
            here.
          </p>
        </div>

        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <div className="text-3xl mb-4">3</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Configure & Go
          </h3>
          <p className="text-gray-400">
            Select channels to monitor, set your AI prompt, and let HUMA handle
            the rest.
          </p>
        </div>
      </div>
    </div>
  );
}
