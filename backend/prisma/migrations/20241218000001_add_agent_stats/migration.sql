-- Add agent stats fields to users table
ALTER TABLE "users" ADD COLUMN "last_message_sent_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "last_message_received_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "messages_sent_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "messages_received_count" INTEGER NOT NULL DEFAULT 0;
