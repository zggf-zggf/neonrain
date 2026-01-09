# Multi-Server Support Specification

## Overview

Extend Neonrain to support multiple Discord servers per account. One Discord token can be used across multiple servers, with each server having its own independent HUMA bot configuration.

---

## Current State

- One Discord token per user
- One selected guild (`selectedGuildId`) per user
- Global bot configuration (`personality`, `rules`, `information`) on User model
- Single `discordBotActive` toggle (global on/off)
- Websites linked to Server, but Server is 1:1 with User
- Chat conversations not linked to specific servers

---

## Target State

- One Discord token per user (unchanged)
- Multiple server configurations per user
- Per-server bot configuration (personality, rules, information)
- Per-server bot activation toggle
- Per-server website collections
- Chat conversations linked to specific servers

---

## Database Schema Changes

### New Model: `UserServerConfig`

Junction table between User and Server with per-server configuration.

```prisma
model UserServerConfig {
  id            String   @id @default(uuid())
  userId        String
  serverId      String

  // Per-server bot configuration
  botName       String   @default("Assistant")
  personality   String   @default("")
  rules         String   @default("")
  information   String   @default("")

  // Per-server activation
  botActive     Boolean  @default(false)

  // Stats per server
  messagesSentCount     Int @default(0)
  messagesReceivedCount Int @default(0)
  lastMessageSentAt     DateTime?
  lastMessageReceivedAt DateTime?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  server        Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)

  // Unique constraint: one config per user-server pair
  @@unique([userId, serverId])
}
```

### Modified Model: `User`

Remove server-specific fields, keep only Discord token.

```prisma
model User {
  id               String   @id @default(uuid())
  clerkUserId      String   @unique
  email            String?

  // Discord connection (shared across all servers)
  discordToken     String?

  // REMOVE these fields (moved to UserServerConfig):
  // - selectedGuildId
  // - selectedGuildName
  // - serverId
  // - discordBotActive
  // - personality
  // - rules
  // - information
  // - botName
  // - messagesSentCount
  // - messagesReceivedCount
  // - lastMessageSentAt
  // - lastMessageReceivedAt

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // Relations
  serverConfigs           UserServerConfig[]
  chatConversationGroups  ChatConversationGroup[]
  chatConversations       ChatConversation[]
  chatPersonas            ChatPersona[]
}
```

### Modified Model: `Server`

Update relation to support multiple users.

```prisma
model Server {
  id        String   @id @default(uuid())
  guildId   String   @unique
  guildName String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  userConfigs UserServerConfig[]
  websites    ServerWebsite[]
}
```

### Modified Model: `ServerWebsite`

Already linked to Server - no changes needed. Each UserServerConfig references a Server, which has its own websites.

### Modified Model: `ChatConversationGroup`

Add server reference.

```prisma
model ChatConversationGroup {
  id        String   @id @default(uuid())
  userId    String
  serverId  String?  // NEW: Link to specific server (nullable for backward compat)
  name      String?
  paneCount Int      @default(1)

  // ... rest unchanged

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  server    Server?  @relation(fields: [serverId], references: [id], onDelete: SetNull)
}
```

---

## API Changes

### New Endpoints

#### `GET /api/servers`
List all server configurations for the authenticated user.

**Response:**
```json
{
  "servers": [
    {
      "id": "config-uuid",
      "serverId": "server-uuid",
      "guildId": "discord-guild-id",
      "guildName": "My Server",
      "botName": "Assistant",
      "botActive": true,
      "personality": "...",
      "rules": "...",
      "information": "...",
      "messagesSentCount": 42,
      "messagesReceivedCount": 100,
      "lastMessageSentAt": "2026-01-09T...",
      "websiteCount": 3
    }
  ]
}
```

#### `POST /api/servers`
Add a new server configuration.

**Request:**
```json
{
  "guildId": "discord-guild-id",
  "guildName": "My Server"
}
```

**Response:**
```json
{
  "id": "config-uuid",
  "serverId": "server-uuid",
  "guildId": "discord-guild-id",
  "guildName": "My Server",
  "botActive": false,
  "personality": "",
  "rules": "",
  "information": ""
}
```

#### `GET /api/servers/:serverId`
Get specific server configuration.

#### `PUT /api/servers/:serverId`
Update server configuration (personality, rules, information, botActive).

**Request:**
```json
{
  "botName": "Custom Bot",
  "personality": "Be helpful",
  "rules": "No spam",
  "information": "Product info...",
  "botActive": true
}
```

#### `DELETE /api/servers/:serverId`
Remove server configuration.

#### `GET /api/servers/:serverId/websites`
List websites for a specific server.

#### `POST /api/servers/:serverId/websites`
Add website to server.

#### `DELETE /api/servers/:serverId/websites/:websiteId`
Remove website from server.

### Modified Endpoints

#### `GET /api/discord/status`
Return aggregated stats across all servers.

**Response:**
```json
{
  "connected": true,
  "serverCount": 3,
  "activeServerCount": 2,
  "totalMessagesSent": 150,
  "totalMessagesReceived": 500
}
```

#### `GET /api/discord/tokens` (Internal - for Go client)
Return all active server configs grouped by token.

**Response:**
```json
{
  "tokens": [
    {
      "discordToken": "token_xyz",
      "userId": "user-uuid",
      "servers": [
        {
          "guildId": "guild-1",
          "guildName": "Server 1",
          "botActive": true,
          "botName": "Assistant",
          "personality": "...",
          "rules": "...",
          "information": "...",
          "websites": [...]
        },
        {
          "guildId": "guild-2",
          "guildName": "Server 2",
          "botActive": false,
          "botName": "Helper",
          "personality": "...",
          "rules": "...",
          "information": "...",
          "websites": [...]
        }
      ]
    }
  ]
}
```

### Deprecated Endpoints

These endpoints will be removed or redirected:

- `POST /api/discord/guild` -> Use `POST /api/servers`
- `GET /api/discord/guild` -> Use `GET /api/servers`
- `DELETE /api/discord/guild` -> Use `DELETE /api/servers/:serverId`
- `GET/POST /api/discord/bot-status` -> Use `PUT /api/servers/:serverId`
- `GET/POST /api/discord/config` -> Use `PUT /api/servers/:serverId`

---

## Go Discord Client Changes

### `types.go`

Update `UserConfig` to support multiple servers:

```go
type TokenConfig struct {
    DiscordToken string         `json:"discordToken"`
    UserID       string         `json:"userId"`
    Servers      []ServerConfig `json:"servers"`
}

type ServerConfig struct {
    GuildID     string          `json:"guildId"`
    GuildName   string          `json:"guildName"`
    BotActive   bool            `json:"botActive"`
    BotName     string          `json:"botName"`
    Personality string          `json:"personality"`
    Rules       string          `json:"rules"`
    Information string          `json:"information"`
    Websites    []WebsiteConfig `json:"websites"`
}
```

### `manager.go`

Update `SyncConfigs` to handle multiple servers per token:

```go
// For each token, monitor all active guilds
for _, tokenConfig := range configs {
    activeGuilds := []string{}
    for _, server := range tokenConfig.Servers {
        if server.BotActive {
            activeGuilds = append(activeGuilds, server.GuildID)
            // Store per-guild config
            cm.guildConfigs[server.GuildID] = server
        }
    }
    client.UpdateMonitoredGuilds(activeGuilds)
}
```

### `backend/config.go`

Update `FetchUserConfigs` to parse new response structure.

---

## Frontend Changes

### New Pages

#### `/dashboard` (Main Dashboard)
- Aggregated stats across all servers
- List of configured servers with quick stats
- "Add Server" button
- Server cards showing: name, status (active/inactive), message counts

#### `/dashboard/servers/:serverId` (Server Dashboard)
- Server-specific configuration
- Bot activation toggle
- Personality, rules, information editors
- Website management
- Server-specific stats

### Modified Pages

#### `/chat`
- Left sidebar shows conversations grouped by server
- Server selector when creating new conversation group
- Conversation list filtered by selected server (or "All")

### Navigation

```
Dashboard (/)
├── Overview (stats, server list)
├── Server: My Gaming Server (/dashboard/servers/abc)
│   ├── Configuration
│   ├── Websites
│   └── Stats
├── Server: Support Server (/dashboard/servers/def)
│   ├── Configuration
│   ├── Websites
│   └── Stats
└── Add Server

Chat (/chat)
├── All Conversations
├── My Gaming Server
│   └── Conversation 1
│   └── Conversation 2
└── Support Server
    └── Conversation 3
```

---

## Migration Strategy

### Database Migration

1. Create `UserServerConfig` table
2. For each existing user with `selectedGuildId`:
   - Create `UserServerConfig` record with existing config values
   - Copy `personality`, `rules`, `information`, `botName`, `botActive`
   - Copy message stats
3. Update `ChatConversationGroup` to reference migrated server
4. Remove deprecated columns from `User` table

### Migration SQL (Prisma will generate, but conceptually):

```sql
-- Step 1: Create new table
CREATE TABLE "UserServerConfig" (...);

-- Step 2: Migrate existing data
INSERT INTO "UserServerConfig" (
  id, userId, serverId, botName, personality, rules, information,
  botActive, messagesSentCount, messagesReceivedCount,
  lastMessageSentAt, lastMessageReceivedAt, createdAt, updatedAt
)
SELECT
  gen_random_uuid(), u.id, u.serverId, u.botName, u.personality,
  u.rules, u.information, u.discordBotActive, u.messagesSentCount,
  u.messagesReceivedCount, u.lastMessageSentAt, u.lastMessageReceivedAt,
  NOW(), NOW()
FROM "User" u
WHERE u.serverId IS NOT NULL;

-- Step 3: Update chat conversation groups
UPDATE "ChatConversationGroup" g
SET "serverId" = u."serverId"
FROM "User" u
WHERE g."userId" = u.id AND u."serverId" IS NOT NULL;

-- Step 4: Drop old columns (after verifying migration)
ALTER TABLE "User" DROP COLUMN "selectedGuildId";
ALTER TABLE "User" DROP COLUMN "selectedGuildName";
ALTER TABLE "User" DROP COLUMN "serverId";
-- ... etc
```

---

## Implementation Order

### Phase 1: Database & Backend
1. Create Prisma migration with new schema
2. Write data migration script
3. Update `/api/discord/tokens` endpoint (critical for Go client)
4. Implement new `/api/servers/*` endpoints
5. Update Go client types and config fetching

### Phase 2: Frontend - Dashboard
1. Create main dashboard page with server list
2. Create server-specific dashboard page
3. Migrate existing dashboard components
4. Update navigation

### Phase 3: Frontend - Chat
1. Add server selector to conversation creation
2. Update sidebar to show server grouping
3. Filter conversations by server

### Phase 4: Cleanup
1. Remove deprecated API endpoints
2. Remove old frontend routes
3. Clean up unused code

---

## Testing Checklist

- [ ] Existing users with one server continue working after migration
- [ ] New users can add multiple servers
- [ ] Each server has independent configuration
- [ ] Bot can be activated/deactivated per server
- [ ] Websites are scoped to individual servers
- [ ] Go client monitors only active servers
- [ ] HUMA agents receive correct per-server configuration
- [ ] Chat conversations are correctly linked to servers
- [ ] Stats are tracked per-server
- [ ] Aggregated stats display correctly on main dashboard
