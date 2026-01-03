import type { Metadata } from "next";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeonRain - Discord AI Automation",
  description: "AI-powered Discord automation via Chrome extension",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen">
          <header className="border-b border-gray-800 px-6 py-4">
            <nav className="max-w-6xl mx-auto flex items-center justify-between">
              <a href="/" className="text-xl font-bold text-white">
                NeonRain
              </a>
              <div className="flex items-center gap-4">
                <SignedOut>
                  <Link
                    href="/sign-in"
                    className="px-4 py-2 text-sm text-gray-300 hover:text-white transition"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/sign-up"
                    className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                  >
                    Get Started
                  </Link>
                </SignedOut>
                <SignedIn>
                  <a
                    href="/dashboard"
                    className="px-4 py-2 text-sm text-gray-300 hover:text-white transition"
                  >
                    Dashboard
                  </a>
                  <a
                    href="/chat"
                    className="px-4 py-2 text-sm text-gray-300 hover:text-white transition"
                  >
                    Chat
                  </a>
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
              </div>
            </nav>
          </header>
          <main>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
