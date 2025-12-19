#!/bin/bash
# Docker Compose startup script for NeonRain stack

set -e

echo "🚀 NeonRain Docker Compose Startup"
echo "=================================="

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo ""
    echo "Please create .env file from .env.example:"
    echo "  cp .env.example .env"
    echo ""
    echo "Then edit .env and set:"
    echo "  - OPENAI_API_KEY (required)"
    echo "  - JWT_SECRET (recommended)"
    echo "  - INTERNAL_API_KEY (recommended)"
    exit 1
fi

# Check if OPENAI_API_KEY is set
source .env
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: OPENAI_API_KEY not set in .env file"
    echo ""
    echo "Please edit .env and add your OpenAI API key:"
    echo "  OPENAI_API_KEY=\"sk-proj-your-key-here\""
    exit 1
fi

echo "✓ Environment configuration found"
echo ""

# Build and start services
echo "📦 Building Docker images..."
docker-compose build

echo ""
echo "🚢 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check service health
echo ""
echo "🔍 Checking service status..."
docker-compose ps

echo ""
echo "✅ Services started!"
echo ""
echo "Service URLs:"
echo "  - Backend:        http://localhost:3000"
echo "  - Discord Client: http://localhost:8080"
echo "  - PostgreSQL:     localhost:5432"
echo ""
echo "Useful commands:"
echo "  - View logs:      docker-compose logs -f"
echo "  - Stop services:  docker-compose down"
echo "  - Restart:        docker-compose restart"
echo ""
echo "Health checks:"
echo "  - Backend:        curl http://localhost:3000/health"
echo "  - Discord Client: curl http://localhost:8080/health"
echo ""
echo "View logs with: docker-compose logs -f"
