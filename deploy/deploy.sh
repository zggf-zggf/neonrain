#!/bin/bash
set -e

# NeonRain Deployment Script
# Run this to deploy or update the application

APP_DIR="/mnt/data/neonrain"
COMPOSE_DIR="$APP_DIR/backend"

echo "=== NeonRain Deployment ==="

cd "$APP_DIR"

echo "[1/3] Pulling latest code..."
git pull

echo "[2/3] Building and starting containers..."
cd "$COMPOSE_DIR"
docker compose up -d --build

echo "[3/3] Waiting for services to be healthy..."
sleep 10

# Check health
echo ""
echo "=== Service Status ==="
docker compose ps

echo ""
echo "=== Health Checks ==="
echo -n "Backend: "
curl -sf http://localhost:3000/health && echo "OK" || echo "FAILED"
echo -n "Discord Client: "
curl -sf http://localhost:8080/health && echo "OK" || echo "FAILED"
echo -n "Frontend: "
curl -sf http://localhost:3001 > /dev/null && echo "OK" || echo "FAILED"

echo ""
echo "Deployment complete!"
echo "View logs: docker compose logs -f"
