# Quick Start Guide

## Demo (No Discord Required)

**One-liner to test AI streaming:**
```bash
cd /home/mjacniacki/kodzik/neonrain/discord-user-client && source ~/.bashrc && go run ./test/demo/streaming_demo.go
```

Or use the script:
```bash
./run-demo.sh
```

## Build Everything

```bash
# Build main application
go build -o bin/discord-client ./cmd/discord-client

# Build demo
go build -o bin/streaming-demo ./test/demo

# Run all tests
go test ./...
```

## Run Main Application

```bash
# Make sure these are set in ~/.bashrc or .env:
# - OPENAI_API_KEY
# - BACKEND_URL (optional, defaults to http://localhost:3000)
# - INTERNAL_API_KEY (optional)

source ~/.bashrc
./bin/discord-client
```

## Project Structure

```
cmd/discord-client/    → Main application
internal/ai/           → AI streaming & chunking
internal/backend/      → Backend API client
internal/client/       → Discord connection
internal/server/       → HTTP API
pkg/types/             → Shared types
test/demo/             → Interactive demo
```

## What It Does

1. **Main App**: Connects to Discord, monitors channels, responds with AI
2. **Demo App**: Shows streaming behavior without Discord connection
3. **Tests**: Comprehensive unit tests with mocks

## API Endpoints

- `GET /health` - Check connection status
- `GET /guilds` - List Discord servers
- `GET /channels?guild_id=X` - List channels in a server

## See Full Documentation

Check [README.md](README.md) for complete documentation.
