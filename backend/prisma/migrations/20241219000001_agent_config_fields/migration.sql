-- Replace prompt with personality, rules, and information fields
-- Drop the old prompt column
ALTER TABLE "users" DROP COLUMN IF EXISTS "prompt";

-- Add new agent configuration fields
ALTER TABLE "users" ADD COLUMN "personality" TEXT DEFAULT '';
ALTER TABLE "users" ADD COLUMN "rules" TEXT DEFAULT '';
ALTER TABLE "users" ADD COLUMN "information" TEXT DEFAULT '';
