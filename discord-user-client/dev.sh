#!/bin/bash
# Run the Discord client service in development mode
# Uses Doppler to inject secrets

cd "$(dirname "$0")"

# Build and run with Doppler
echo "Building and starting Discord client service..."
go build -o bin/discord-client ./cmd/discord-client && doppler run -- ./bin/discord-client
