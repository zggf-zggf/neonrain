#!/bin/bash
set -e

REGISTRY="us-central1-docker.pkg.dev/neonrain-prod/neonrain"

echo "=== Building and pushing images to Artifact Registry ==="

# Build and push backend
echo "Building backend..."
docker build -t $REGISTRY/backend:latest ./backend
docker push $REGISTRY/backend:latest

# Build and push web (with build args)
echo "Building web..."
docker build \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dmVyaWZpZWQtbXVsZS0xMy5jbGVyay5hY2NvdW50cy5kZXYk \
  --build-arg NEXT_PUBLIC_BACKEND_URL=http://104.154.141.204:3000 \
  -t $REGISTRY/web:latest ./web
docker push $REGISTRY/web:latest

# Build and push discord-client
echo "Building discord-client..."
docker build -t $REGISTRY/discord-client:latest ./discord-user-client
docker push $REGISTRY/discord-client:latest

echo ""
echo "=== All images pushed! ==="
echo "Now SSH to VM and run: cd ~/neonrain/backend && docker compose pull && docker compose up -d"
