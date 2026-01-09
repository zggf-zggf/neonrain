-- CreateTable: user_server_configs
CREATE TABLE "user_server_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "bot_name" TEXT NOT NULL DEFAULT 'Assistant',
    "personality" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL DEFAULT '',
    "information" TEXT NOT NULL DEFAULT '',
    "bot_active" BOOLEAN NOT NULL DEFAULT false,
    "messages_sent_count" INTEGER NOT NULL DEFAULT 0,
    "messages_received_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_sent_at" TIMESTAMP(3),
    "last_message_received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_server_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_server_configs_user_id_idx" ON "user_server_configs"("user_id");

-- CreateIndex
CREATE INDEX "user_server_configs_server_id_idx" ON "user_server_configs"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_server_configs_user_id_server_id_key" ON "user_server_configs"("user_id", "server_id");

-- AddColumn: server_id to chat_conversation_groups
ALTER TABLE "chat_conversation_groups" ADD COLUMN "server_id" TEXT;

-- CreateIndex
CREATE INDEX "chat_conversation_groups_server_id_idx" ON "chat_conversation_groups"("server_id");

-- MigrateData: Copy existing user configurations to user_server_configs
INSERT INTO "user_server_configs" (
    "id",
    "user_id",
    "server_id",
    "bot_name",
    "personality",
    "rules",
    "information",
    "bot_active",
    "messages_sent_count",
    "messages_received_count",
    "last_message_sent_at",
    "last_message_received_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    u.id,
    u.server_id,
    COALESCE(u.bot_name, 'Assistant'),
    COALESCE(u.personality, ''),
    COALESCE(u.rules, ''),
    COALESCE(u.information, ''),
    u.discord_bot_active,
    u.messages_sent_count,
    u.messages_received_count,
    u.last_message_sent_at,
    u.last_message_received_at,
    NOW(),
    NOW()
FROM "users" u
WHERE u.server_id IS NOT NULL;

-- MigrateData: Link chat_conversation_groups to servers
UPDATE "chat_conversation_groups" g
SET "server_id" = u."server_id"
FROM "users" u
WHERE g."user_id" = u.id AND u."server_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "user_server_configs" ADD CONSTRAINT "user_server_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_server_configs" ADD CONSTRAINT "user_server_configs_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversation_groups" ADD CONSTRAINT "chat_conversation_groups_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey (if exists)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_server_id_fkey";

-- DropColumns from users
ALTER TABLE "users" DROP COLUMN IF EXISTS "selected_guild_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "selected_guild_name";
ALTER TABLE "users" DROP COLUMN IF EXISTS "discord_bot_active";
ALTER TABLE "users" DROP COLUMN IF EXISTS "server_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "personality";
ALTER TABLE "users" DROP COLUMN IF EXISTS "rules";
ALTER TABLE "users" DROP COLUMN IF EXISTS "information";
ALTER TABLE "users" DROP COLUMN IF EXISTS "bot_name";
ALTER TABLE "users" DROP COLUMN IF EXISTS "messages_sent_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "messages_received_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_message_sent_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_message_received_at";
