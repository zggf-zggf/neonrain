# Neonrain

Chrome extension with Svelte frontend and Node.js backend for Discord integration.

## Project Structure

```
neonrain/
├── chrome-extension/    # Svelte-based Chrome extension
│   ├── src/
│   │   ├── popup/      # Extension popup UI
│   │   ├── content/    # Content scripts for Discord integration
│   │   └── background/ # Background service worker
│   └── dist/           # Built extension (load this in Chrome)
│
└── backend/            # Express.js + TypeScript backend
    ├── src/
    │   └── routes/     # API routes (auth, discord)
    └── prisma/         # Database schema and migrations
```

## Features

- User authentication (register/login with JWT)
- Discord token capture with user consent
- PostgreSQL database with Prisma ORM
- Docker support for easy deployment

## Setup

### Backend

1. Start the backend with Docker:
   ```bash
   cd backend
   docker-compose up --build
   ```

2. Backend will be available at `http://localhost:3000`

### Chrome Extension

1. Build the extension:
   ```bash
   cd chrome-extension
   npm install
   npm run build
   ```

2. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `chrome-extension/dist` folder

## Usage

1. Register/Login in the extension popup
2. Navigate to Discord in your browser
3. Click "Connect Discord" in the extension
4. Your Discord token will be securely captured and saved

## Development

### Backend
```bash
cd backend
npm run dev  # Run with hot reload
```

### Chrome Extension
```bash
cd chrome-extension
npm run dev  # Watch mode for development
```

## Tech Stack

- **Frontend**: Svelte, Vite, Chrome Extension API
- **Backend**: Express.js, TypeScript, Prisma
- **Database**: PostgreSQL
- **DevOps**: Docker, Docker Compose
