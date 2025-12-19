# NeonRain

AI-powered Discord bot that responds to messages using HUMA (Human-like AI). Users connect their Discord account via a Chrome extension, configure their bot's personality, and let it chat in their selected server.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Chrome Extension│     │   Next.js Web   │     │  Go Discord     │
│ (Token Capture) │     │   (Dashboard)   │     │    Client       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │    Claim Code         │    Clerk Auth         │    HUMA AI
         └───────────┬───────────┴───────────┬───────────┘
                     │                       │
              ┌──────┴──────┐         ┌──────┴──────┐
              │   Backend   │         │  PostgreSQL │
              │  (Express)  ├─────────┤             │
              └─────────────┘         └─────────────┘
```

## Components

- **Chrome Extension** - Captures Discord token from discord.com and generates a claim code
- **Web Dashboard** - Next.js app with Clerk auth for managing bot settings
- **Backend API** - Express server handling auth, tokens, and configuration
- **Discord Client** - Go service that connects to Discord and integrates with HUMA AI
- **PostgreSQL** - Database for users, tokens, and settings

## Local Development Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development without Docker)
- Go 1.21+ (for local development without Docker)

### Quick Start (Docker)

```bash
# Clone the repo
git clone https://github.com/zggf-zggf/neonrain.git
cd neonrain

# Create environment files
cp backend/.env.example backend/.env
cp web/.env.local.example web/.env.local

# Start all services
cd backend
docker compose up -d

# Run database migrations
docker compose exec backend npx prisma migrate deploy

# Check status
docker compose ps
```

Services will be available at:
- **Web Dashboard**: http://localhost:3001
- **Backend API**: http://localhost:3000
- **Discord Client API**: http://localhost:8080
- **PostgreSQL**: localhost:5432

### Environment Variables

#### backend/.env

```env
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/neonrain?schema=public"
PORT=3000
NODE_ENV=development
INTERNAL_API_KEY="secure-internal-key-change-me"
GO_SERVICE_URL="http://discord-client:8080"

# Clerk Authentication (test keys)
CLERK_PUBLISHABLE_KEY=pk_test_dmVyaWZpZWQtbXVsZS0xMy5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_FmI60UCnBPxvPHM700Z5cJj03o1fRRmUbmAElgzMRd

# HUMA API Key
HUMA_API_KEY=ak_gVBqFtMwZms8LiolP-dYZERfN04NiG_ZCe-M7U9MtKw
```

#### web/.env.local

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dmVyaWZpZWQtbXVsZS0xMy5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_FmI60UCnBPxvPHM700Z5cJj03o1fRRmUbmAElgzMRd

# Clerk redirect URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# Backend API URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
```

### Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. Go to discord.com and click the extension icon
6. Click "Capture Token" to get a claim code
7. Enter the claim code in the web dashboard at http://localhost:3001/claim

### Common Commands

```bash
# Start all services
cd backend && docker compose up -d

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f discord-client

# Restart a service
docker compose restart discord-client

# Stop all services
docker compose down

# Rebuild after code changes
docker compose build --no-cache && docker compose up -d

# Run migrations
docker compose exec backend npx prisma migrate deploy

# Access database
docker compose exec postgres psql -U postgres -d neonrain
```

### Development Without Docker

#### Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

#### Web

```bash
cd web
npm install
npm run dev
```

#### Discord Client

```bash
cd discord-user-client
go mod download
go run cmd/discord-client/main.go
```

## Configuration

### Agent Configuration (via Dashboard)

- **Personality** - Character traits and communication style
- **Rules** - Behavioral guidelines and restrictions
- **Information** - Context and knowledge for the AI to reference

### How It Works

1. User installs Chrome extension and captures their Discord token
2. User claims the token in the web dashboard using a 6-character code
3. User selects which Discord server to monitor
4. User configures the AI personality, rules, and information
5. The Go client connects to Discord using the user's token
6. When messages are received, they're sent to HUMA AI
7. HUMA generates responses based on the configuration
8. Responses are sent back to Discord with typing simulation

## Project Structure

```
neonrain/
├── backend/                 # Express API server
│   ├── src/
│   │   ├── routes/         # API endpoints
│   │   ├── middleware/     # Clerk auth middleware
│   │   └── lib/            # Database client
│   ├── prisma/             # Database schema & migrations
│   └── docker-compose.yml  # All services
│
├── web/                     # Next.js dashboard
│   └── src/
│       ├── app/            # Pages (dashboard, claim, auth)
│       └── lib/            # API client
│
├── discord-user-client/     # Go Discord bot
│   ├── cmd/                # Main entry point
│   └── internal/
│       ├── client/         # Discord connection
│       ├── huma/           # HUMA AI integration
│       └── history/        # Message history
│
└── chrome-extension/        # Token capture extension
    └── popup/              # Extension UI
```

## Troubleshooting

### Services not starting

```bash
# Check logs for errors
docker compose logs

# Ensure ports aren't in use
lsof -i :3000 -i :3001 -i :5432 -i :8080
```

### Database connection issues

```bash
# Restart postgres
docker compose restart postgres

# Check if postgres is healthy
docker compose ps
```

### Discord client not connecting

```bash
# Check discord-client logs
docker compose logs discord-client

# Ensure HUMA_API_KEY is set correctly
# Ensure a Discord token has been claimed in the dashboard
```

### Chrome extension not working

- Make sure you're on discord.com
- Check browser console for errors
- Try reloading the extension

## License

MIT
