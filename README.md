# NeonRain

AI-powered Discord bot that responds to messages using HUMA (Human-like AI). Users connect their Discord account via a Chrome extension, configure their bot's personality, and let it chat in their selected server.

## Quick Start (Local Development)

### Prerequisites

- Docker & Docker Compose
- Chrome browser (for the extension)
- A Discord account

### 1. Clone and Setup

```bash
git clone https://github.com/zggf-zggf/neonrain.git
cd neonrain
```

### 2. Create Environment Files

**backend/.env**
```env
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/neonrain?schema=public"
PORT=3000
NODE_ENV=development
INTERNAL_API_KEY="secure-internal-key-change-me"
GO_SERVICE_URL="http://discord-client:8080"

# Clerk Authentication (test keys - shared for dev)
CLERK_PUBLISHABLE_KEY=pk_test_dmVyaWZpZWQtbXVsZS0xMy5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_FmI60UCnBPxvPHM700Z5cJj03o1fRRmUbmAElgzMRd

# HUMA API Key (shared for dev)
HUMA_API_KEY=ak_gVBqFtMwZms8LiolP-dYZERfN04NiG_ZCe-M7U9MtKw
```

**web/.env.local**
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dmVyaWZpZWQtbXVsZS0xMy5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_FmI60UCnBPxvPHM700Z5cJj03o1fRRmUbmAElgzMRd
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
```

### 3. Start Services

```bash
cd backend
docker compose up -d
docker compose exec backend npx prisma migrate deploy
```

Wait for all services to be healthy:
```bash
docker compose ps
```

You should see:
```
NAME                      STATUS
neonrain-postgres         healthy
neonrain-backend          healthy
neonrain-discord-client   healthy
neonrain-web              running
```

### 4. Install Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder from this repo
5. Pin the extension for easy access

### 5. Services URLs

| Service | URL | Description |
|---------|-----|-------------|
| Web Dashboard | http://localhost:3001 | User interface |
| Backend API | http://localhost:3000 | REST API |
| Discord Client | http://localhost:8080 | Go service (internal) |
| PostgreSQL | localhost:5432 | Database |

---

## User Flow (How It Works)

### Step 1: Create Account
1. Go to http://localhost:3001
2. Click **Sign Up**
3. Create account with email (uses Clerk auth)
4. You'll be redirected to the dashboard

### Step 2: Connect Discord
1. Open https://discord.com in Chrome and **log in** to your Discord account
2. Click the **NeonRain extension** icon in Chrome toolbar
3. Click **Capture Discord Token**
4. You'll get a **6-character claim code** (e.g., `A3B7K9`)
5. Go back to dashboard → Click **Claim Discord Token**
6. Enter the claim code
7. Dashboard now shows "Discord Connected"

### Step 3: Select Server
1. In dashboard, click **Select Server**
2. Choose which Discord server the bot should monitor
3. The bot will listen to ALL text channels in that server

### Step 4: Configure AI Personality
In the **Agent Configuration** section, set:

- **Personality**: How the AI should behave
  ```
  Friendly and casual. Uses humor. Likes to help with coding questions.
  ```

- **Rules**: What the AI should/shouldn't do
  ```
  Never discuss politics. Keep responses under 200 words. Don't spam.
  ```

- **Information**: Context the AI should know
  ```
  This is a gaming community. Main games: Minecraft, Valorant.
  Server owner is @AdminUser.
  ```

Click **Save Configuration**

### Step 5: Test It
1. Go to your Discord server (the one you selected)
2. Send a message in any text channel
3. The bot (using your account) will read it and may respond
4. Check the **Agent Statistics** in dashboard to see activity

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    Claim Code    ┌──────────────┐             │
│  │   Chrome     │ ──────────────── │   Next.js    │             │
│  │  Extension   │                  │  Dashboard   │             │
│  │              │                  │ :3001        │             │
│  │ Captures     │                  │              │             │
│  │ Discord      │                  │ - Sign up    │             │
│  │ Token        │                  │ - Claim token│             │
│  └──────────────┘                  │ - Configure  │             │
│         │                          │   AI         │             │
│         │                          └──────┬───────┘             │
│         │                                 │                      │
│         │ POST /submit-token              │ Clerk Auth           │
│         │                                 │                      │
│         ▼                                 ▼                      │
│  ┌────────────────────────────────────────────────┐             │
│  │              Express Backend :3000              │             │
│  │                                                 │             │
│  │  - /api/discord/submit-token (get claim code)  │             │
│  │  - /api/discord/claim-token (link to account)  │             │
│  │  - /api/discord/config (personality/rules)     │             │
│  │  - /api/discord/tokens (internal, for Go)      │             │
│  └─────────────────────┬──────────────────────────┘             │
│                        │                                         │
│                        │ Prisma ORM                              │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────┐            │
│  │              PostgreSQL :5432                    │            │
│  │                                                  │            │
│  │  users: id, discord_token, personality, rules   │            │
│  │  pending_tokens: claim_code, discord_token      │            │
│  └─────────────────────────────────────────────────┘            │
│                        ▲                                         │
│                        │ Polls /api/discord/tokens               │
│                        │                                         │
│  ┌─────────────────────┴───────────────────────────┐            │
│  │           Go Discord Client :8080                │            │
│  │                                                  │            │
│  │  - Connects to Discord as user                  │            │
│  │  - Listens to messages in selected server       │            │
│  │  - Sends messages to HUMA AI                    │            │
│  │  - Types & sends responses                      │            │
│  └─────────────────────┬───────────────────────────┘            │
│                        │                                         │
│                        │ WebSocket                               │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────┐            │
│  │              HUMA AI (External)                  │            │
│  │              api.humalike.tech                   │            │
│  │                                                  │            │
│  │  - Receives message context                     │            │
│  │  - Generates human-like responses               │            │
│  │  - Calls send_message tool                      │            │
│  └─────────────────────────────────────────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Development Commands

### Docker Commands

```bash
# Start everything
cd backend && docker compose up -d

# View all logs
docker compose logs -f

# View specific service
docker compose logs -f discord-client
docker compose logs -f backend
docker compose logs -f web

# Restart after code changes
docker compose build --no-cache && docker compose up -d

# Restart single service
docker compose restart discord-client

# Stop everything
docker compose down

# Stop and delete data
docker compose down -v
```

### Database Commands

```bash
# Run migrations
docker compose exec backend npx prisma migrate deploy

# Create new migration
docker compose exec backend npx prisma migrate dev --name your_migration_name

# Access database directly
docker compose exec postgres psql -U postgres -d neonrain

# Useful SQL queries
SELECT * FROM users;
SELECT * FROM pending_discord_tokens;
```

### Local Development (without Docker)

If you want to run services locally for faster iteration:

**Backend:**
```bash
cd backend
npm install
# Set DATABASE_URL to localhost:5432 in .env
npx prisma generate
npx prisma migrate dev
npm run dev
```

**Web:**
```bash
cd web
npm install
npm run dev
```

**Discord Client:**
```bash
cd discord-user-client
go mod download
# Set BACKEND_URL=http://localhost:3000 in environment
go run cmd/discord-client/main.go
```

---

## Project Structure

```
neonrain/
│
├── backend/                      # Express.js API
│   ├── src/
│   │   ├── routes/
│   │   │   └── discord.ts       # All Discord-related endpoints
│   │   ├── middleware/
│   │   │   └── clerk.ts         # Clerk auth middleware
│   │   └── lib/
│   │       └── prisma.ts        # Database client
│   ├── prisma/
│   │   ├── schema.prisma        # Database schema
│   │   └── migrations/          # SQL migrations
│   └── docker-compose.yml       # All services defined here
│
├── web/                          # Next.js Dashboard
│   └── src/
│       ├── app/
│       │   ├── page.tsx         # Landing page
│       │   ├── dashboard/       # Main dashboard
│       │   ├── claim/           # Claim token page
│       │   └── sign-in/         # Auth pages
│       └── lib/
│           └── api.ts           # Backend API client
│
├── discord-user-client/          # Go Discord Bot
│   ├── cmd/
│   │   └── discord-client/
│   │       └── main.go          # Entry point
│   └── internal/
│       ├── client/
│       │   └── discord.go       # Discord connection
│       ├── huma/
│       │   ├── client.go        # HUMA WebSocket client
│       │   └── manager.go       # Agent management
│       ├── backend/
│       │   └── config.go        # Backend API client
│       └── history/
│           └── message_history.go
│
└── chrome-extension/             # Token Capture Extension
    ├── manifest.json
    ├── popup/
    │   ├── popup.html
    │   ├── popup.js
    │   └── popup.css
    └── src/
        └── content/
            └── discord-injector.js  # Token extraction
```

---

## API Endpoints

### Public (Chrome Extension)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/discord/submit-token` | Submit Discord token, get claim code |

### Authenticated (Clerk)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/discord/claim-token` | Claim token with code |
| GET | `/api/discord/status` | Get connection status & stats |
| POST | `/api/discord/disconnect` | Disconnect Discord |
| GET | `/api/discord/guilds` | List user's Discord servers |
| POST | `/api/discord/guild` | Select server to monitor |
| DELETE | `/api/discord/guild` | Remove server selection |
| GET | `/api/discord/config` | Get AI configuration |
| POST | `/api/discord/config` | Save AI configuration |

### Internal (API Key)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/discord/tokens` | Get all tokens (for Go client) |
| POST | `/api/discord/stats` | Report message stats |

---

## Troubleshooting

### "No Discord tokens found"
- Make sure you've claimed a token in the dashboard
- Check backend logs: `docker compose logs backend`

### Extension not capturing token
- Make sure you're logged into Discord (discord.com)
- Refresh Discord page, then try again
- Check browser console for errors (F12)

### Bot not responding
- Check discord-client logs: `docker compose logs discord-client`
- Verify HUMA_API_KEY is correct
- Make sure you selected a server in dashboard

### Database issues
```bash
# Reset everything
docker compose down -v
docker compose up -d
docker compose exec backend npx prisma migrate deploy
```

---

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Auth**: Clerk
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL, Prisma ORM
- **Discord Bot**: Go, discordgo
- **AI**: HUMA (humalike.tech)
- **DevOps**: Docker, Docker Compose
