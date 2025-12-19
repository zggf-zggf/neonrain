-- AlterTable
-- Step 1: Add temp column
ALTER TABLE "users" ADD COLUMN "selected_channels_new" jsonb[] DEFAULT ARRAY[]::jsonb[];

-- Step 2: Migrate data
UPDATE "users" SET "selected_channels_new" = (
  SELECT array_agg(jsonb_build_object('channelId', elem, 'guildId', ''))
  FROM unnest("selected_channels") AS elem
)
WHERE "selected_channels" IS NOT NULL AND array_length("selected_channels", 1) > 0;

-- Step 3: Drop old column
ALTER TABLE "users" DROP COLUMN "selected_channels";

-- Step 4: Rename new column
ALTER TABLE "users" RENAME COLUMN "selected_channels_new" TO "selected_channels";
