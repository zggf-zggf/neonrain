-- CreateTable
CREATE TABLE "servers" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "guild_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_websites" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_scrapes" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "markdown_content" TEXT NOT NULL,
    "content_length" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "status_code" INTEGER,
    "error_message" TEXT,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_scrapes_pkey" PRIMARY KEY ("id")
);

-- Add server_id to users
ALTER TABLE "users" ADD COLUMN "server_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "servers_guild_id_key" ON "servers"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_websites_server_id_url_key" ON "server_websites"("server_id", "url");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_websites" ADD CONSTRAINT "server_websites_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_scrapes" ADD CONSTRAINT "website_scrapes_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "server_websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
