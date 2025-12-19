-- Migration: clerk_migration
-- This migration switches from custom JWT auth to Clerk auth

-- Step 1: Drop existing users (breaking change - requires fresh signup with Clerk)
-- If you need to preserve users, you'd need a data migration script
DELETE FROM "users";

-- Step 2: Drop password column and add clerkUserId
ALTER TABLE "users" DROP COLUMN "password";
ALTER TABLE "users" ADD COLUMN "clerk_user_id" TEXT NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_user_id_key" UNIQUE ("clerk_user_id");

-- Step 3: Make email nullable (Clerk may use phone or other methods)
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- Step 4: Create pending_discord_tokens table for claim code flow
CREATE TABLE "pending_discord_tokens" (
    "id" TEXT NOT NULL,
    "discord_token" TEXT NOT NULL,
    "claim_code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimed_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_discord_tokens_pkey" PRIMARY KEY ("id")
);

-- Step 5: Add unique constraint on claim_code
CREATE UNIQUE INDEX "pending_discord_tokens_claim_code_key" ON "pending_discord_tokens"("claim_code");
