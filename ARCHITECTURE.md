# NeonRain - Architecture & Documentation

AI-powered Discord automation via Chrome extension interface.

## Overview

NeonRain is a full-stack application that enables AI-powered responses in Discord channels. Users authenticate via a Chrome extension, connect their Discord account, select channels to monitor, and the system automatically responds to messages using HUMA (human-like AI agents).

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Chrome Extension│────►│     Backend     │────►│  Discord Client │
│    (Svelte)     │     │  (Node/Express) │     │      (Go)       │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │   PostgreSQL    │     │   Discord API   │
                        └─────────────────┘     │    HUMA API     │
                                                └─────────────────┘
```

## Components

### 1. Chrome Extension (`chrome-extension/`)

**Tech Stack:** Svelte, Vite, Chrome Extension Manifest V3

**Features:**
- User registration/login with JWT auth
- Discord token capture from web Discord
- Guild/channel browser with multi-select
- Custom AI prompt configuration
- Backend health monitoring

**Key Files:**
| File | Purpose |
|------|---------|
| `src/popup/App.svelte` | Main UI (auth, Discord config, channel selection) |
| `src/content/discord-injector.js` | Captures Discord auth token from page |
| `src/content/discord-content.js` | Bridge between page and extension |
| `src/background/background.js` | Service worker for message routing |
| `public/manifest.json` | Extension permissions and configuration |

**Build:**
```bash
cd chrome-extension
npm install
npm run build
# Load dist/ folder in Chrome as unpacked extension
```

---

### 2. Backend (`backend/`)

**Tech Stack:** Node.js, Express, TypeScript, Prisma, PostgreSQL

**Features:**
- JWT authentication (7-day expiry)
- User management with bcrypt password hashing
- Discord token storage per user
- Channel selection persistence (JSON array)
- Custom prompt storage
- Internal API for Discord client polling
- Proxy endpoints to Discord client

**API Endpoints:**

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | - | Health check |
| `/api/auth/register` | POST | - | Create account |
| `/api/auth/login` | POST | - | Login, get JWT |
| `/api/auth/me` | GET | JWT | Get current user |
| `/api/discord/connect` | POST | JWT | Save Discord token |
| `/api/discord/status` | GET | JWT | Check Discord connection |
| `/api/discord/disconnect` | POST | JWT | Remove Discord token |
| `/api/discord/channels` | GET/POST | JWT | Get/save selected channels |
| `/api/discord/prompt` | GET/POST | JWT | Get/save custom prompt |
| `/api/discord/guilds` | GET | JWT | Proxy to Go service |
| `/api/discord/guilds/:id/channels` | GET | JWT | Proxy to Go service |
| `/api/discord/tokens` | GET | API Key | Internal: fetch all configs |

**Database Schema:**
```prisma
model User {
  id               String   @id @default(uuid())
  email            String   @unique
  password         String   // bcrypt hashed
  discordToken     String?  // Discord auth token
  selectedChannels Json[]   // [{channelId, guildId}, ...]
  prompt           String?  // Custom AI instructions
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

**Environment Variables:**
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/neonrain?schema=public"
JWT_SECRET="your-secret-key"
INTERNAL_API_KEY="secure-internal-key"
HUMA_API_KEY="your-huma-api-key"
PORT=3000
GO_SERVICE_URL="http://localhost:8080"
```

---

### 3. Discord Client (`discord-user-client/`)

**Tech Stack:** Go, discordgo (Beeper fork), HUMA API

**Features:**
- Polls backend every 2 seconds for config changes
- Connects to Discord via user token (WebSocket)
- Monitors only selected channels
- Maintains conversation history (last 50 messages per channel)
- **One HUMA agent per Discord guild (server)**
- HUMA decides when and how to respond (human-like behavior)
- Simulates typing at ~90 WPM with typing indicators
- Message cancellation (newer message supersedes pending one)
- Hot-reloads channel/prompt changes without restart

**Package Structure:**
```
discord-user-client/
├── cmd/discord-client/main.go    # Entry point, polling loop
├── internal/
│   ├── client/discord.go         # Discord connection & message handling
│   ├── huma/
│   │   ├── client.go             # HUMA WebSocket client
│   │   ├── manager.go            # Guild agent manager
│   │   └── types.go              # HUMA types and events
│   ├── history/message_history.go # Conversation tracking
│   ├── backend/config.go         # Backend API client
│   └── server/http.go            # HTTP API (/health, /guilds, /channels)
└── pkg/types/types.go            # Shared type definitions
```

**HTTP Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Connection status |
| `/guilds` | GET | List user's Discord servers |
| `/channels?guild_id=X` | GET | List text channels in guild |

**Environment Variables:**
```bash
HUMA_API_KEY="your-huma-api-key"
BACKEND_URL="http://localhost:3000"
INTERNAL_API_KEY="secure-internal-key"
HTTP_PORT="8080"
```

---

## HUMA Integration

### What is HUMA?

HUMA is an async, stateful API for creating human-like AI agents. Unlike direct LLM APIs, HUMA:
- Decides **when** to respond (not every message needs a reply)
- Maintains personality and behavioral consistency
- Uses tool calls for actions (like `send_message`)
- Handles real-time WebSocket communication

### Architecture

```
Discord Message → Discord Client → HUMA Agent (per guild)
                                        │
                                        ▼
                              HUMA decides to respond
                                        │
                                        ▼
                              Tool call: send_message
                                        │
                                        ▼
                    Discord Client executes with typing simulation
                                        │
                                        ▼
                              Message sent to Discord
```

### One Agent Per Guild

Each Discord server (guild) gets its own HUMA agent:
- Agents are created on first message from that guild
- Each agent maintains its own personality context
- Conversation history is per-channel within the guild

### Tool: `send_message`

HUMA can call `send_message` to respond:
```json
{
  "name": "send_message",
  "parameters": [
    {"name": "channel_id", "type": "string", "required": true},
    {"name": "message", "type": "string", "required": true}
  ]
}
```

### Message Queue & Cancellation

When HUMA calls `send_message`:
1. Message enters queue with typing simulation delay
2. Typing indicator starts
3. If HUMA sends another message before first completes:
   - Previous message is **canceled**
   - Tool result "canceled" sent to HUMA
   - New message takes over

This prevents message pile-up and ensures only the most recent response is sent.

### Context Sent to HUMA

Each message event sends full context:
```json
{
  "guild": {"id": "...", "name": "Server Name"},
  "you": {"name": "BotUsername"},
  "channels": {
    "channel_id": {
      "id": "...",
      "name": "general",
      "messages": [...]
    }
  },
  "currentMessage": {
    "author": "Username",
    "content": "Hello!",
    ...
  }
}
```

---

## Data Flow

### 1. User Setup Flow
```
1. User registers in Chrome extension
   └─► POST /api/auth/register → JWT token stored

2. User clicks "Connect Discord" on discord.com
   └─► Extension captures auth token from page
   └─► POST /api/discord/connect → Token stored in DB

3. User selects channels to monitor
   └─► GET /api/discord/guilds → Lists servers
   └─► GET /api/discord/guilds/:id/channels → Lists channels
   └─► POST /api/discord/channels → Saves selection

4. User sets custom prompt (optional)
   └─► POST /api/discord/prompt → Saves prompt
```

### 2. Message Response Flow (with HUMA)
```
1. Discord Client polls backend (every 2s)
   └─► GET /api/discord/tokens → Gets user config

2. Someone sends message in monitored channel
   └─► Discord WebSocket delivers MessageCreate event

3. Client checks if channel is selected
   └─► If yes, initializes history if needed (fetch last 50 msgs)

4. Client sends context update to HUMA
   └─► Gets or creates HUMA agent for this guild
   └─► Sends "message-received" event with full context

5. HUMA decides whether to respond
   └─► If yes, calls send_message tool
   └─► If no, stays quiet (human-like behavior)

6. Client receives tool call
   └─► Starts typing simulation (90 WPM delay)
   └─► Shows typing indicator
   └─► Sends message to Discord
   └─► Returns tool result to HUMA
```

---

## Service Communication

### Chrome Extension → Backend
- **Protocol:** HTTP REST
- **Auth:** JWT Bearer token
- **Base URL:** `http://localhost:3000`

### Backend → Discord Client
- **Protocol:** HTTP REST (proxy)
- **Auth:** None (internal network)
- **Used for:** Guild/channel fetching

### Discord Client → Backend
- **Protocol:** HTTP REST
- **Auth:** `X-API-Key` header
- **Endpoint:** `GET /api/discord/tokens`
- **Frequency:** Every 2 seconds

### Discord Client → External APIs
- **Discord:** WebSocket (events) + REST (messages)
- **HUMA:** WebSocket (bidirectional real-time)

---

## Docker Deployment

All services run via Docker Compose from the `backend/` directory:

```bash
cd backend
cp .env.example .env
# Edit .env: set HUMA_API_KEY

docker-compose up -d
```

**Services:**
| Service | Port | Health Check |
|---------|------|--------------|
| postgres | 5432 | pg_isready |
| backend | 3000 | GET /health |
| discord-client | 8080 | GET /health |

**Commands:**
```bash
docker-compose ps              # Check status
docker-compose logs -f         # All logs
docker-compose logs -f backend # Specific service
docker-compose down            # Stop (keep data)
docker-compose down -v         # Stop + delete data
docker-compose up -d --build   # Rebuild and start
```

---

## Configuration Reference

### Selected Channels Format
```json
[
  { "channelId": "123456789", "guildId": "987654321" },
  { "channelId": "111111111", "guildId": "987654321" }
]
```

### HUMA Agent Personality

The agent personality is built from:
1. **Base traits:** Helpful, knowledgeable, friendly
2. **Server context:** Guild name and role
3. **User's custom prompt:** Added to personality

### HUMA Agent Instructions

Instructions define:
- When to use `send_message` tool
- Rules for responding (don't spam, be helpful)
- Information visibility (what the agent can/cannot see)

---

## Security Notes

**Discord Token Capture:**
- Tokens are captured with user consent only
- Stored encrypted in PostgreSQL
- User tokens (self-bot) may violate Discord ToS
- Use at your own risk for educational/testing purposes

**Production Checklist:**
- [ ] Change JWT_SECRET
- [ ] Change INTERNAL_API_KEY
- [ ] Change PostgreSQL password
- [ ] Don't expose postgres port externally
- [ ] Enable HTTPS via reverse proxy
- [ ] Configure CORS for specific origins

---

## Development

### Backend
```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

### Discord Client
```bash
cd discord-user-client
go mod download
go run ./cmd/discord-client
```

### Chrome Extension
```bash
cd chrome-extension
npm install
npm run build
# Load dist/ in Chrome → Extensions → Load unpacked
```

### Run Tests
```bash
cd discord-user-client
go test ./...
```

---

## Troubleshooting

**Bot not responding:**
1. Check Discord client logs: `docker-compose logs -f discord-client`
2. Verify channels are selected in extension
3. Check HUMA API key is valid
4. Ensure backend has your Discord token: `GET /api/discord/status`
5. Note: HUMA decides when to respond - it may choose not to reply to every message

**Extension can't connect:**
1. Verify backend is running: `curl http://localhost:3000/health`
2. Check browser console for CORS errors
3. Reload Discord page after installing extension

**Database issues:**
```bash
# Reset database
docker-compose down -v
docker-compose up -d

# Run migrations manually
docker exec -it chrome-extension-backend npx prisma migrate deploy
```

**HUMA connection issues:**
1. Verify HUMA_API_KEY is set correctly
2. Check logs for WebSocket connection errors
3. Ensure network allows outbound connections to `api.humalike.tech`
