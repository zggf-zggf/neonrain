-- Change from channel selection to guild (server) selection
-- Drop the old selected_channels column
ALTER TABLE "users" DROP COLUMN IF EXISTS "selected_channels";

-- Add new guild selection columns
ALTER TABLE "users" ADD COLUMN "selected_guild_id" TEXT;
ALTER TABLE "users" ADD COLUMN "selected_guild_name" TEXT;
