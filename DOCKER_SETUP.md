# Docker Compose Setup Guide

This guide explains how to run the entire NeonRain stack (backend + Discord client) using Docker Compose.

## Architecture

The stack consists of three services:

1. **PostgreSQL** - Database for backend
2. **Backend** (Node.js) - Chrome extension backend API
3. **Discord Client** (Go) - AI-powered Discord bot with conversation history

```
┌─────────────┐
│  PostgreSQL │ :5432
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Backend   │ :3000
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Discord   │ :8080
│   Client    │
└─────────────┘
```

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- OpenAI API key

## Quick Start

### 1. Set Environment Variables

Navigate to the backend directory and copy the example env file:

```bash
cd /home/mjacniacki/kodzik/neonrain/backend
cp .env.example .env
```

Edit the `.env` file and set your secrets:

```bash
# Required: Set your OpenAI API key
OPENAI_API_KEY="sk-proj-your-actual-openai-key-here"

# Recommended: Change these in production
JWT_SECRET="your-secure-jwt-secret"
INTERNAL_API_KEY="your-secure-internal-api-key"

# Database (default is fine for development)
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/neonrain?schema=public"

# Server config
PORT=3000
NODE_ENV=production
```

**Important:** Never commit the `.env` file to version control!

### 2. Build and Start All Services

From the backend directory:

```bash
docker-compose up -d
```

This will:
1. Build the backend container
2. Build the Discord client container from `../discord-user-client`
3. Start PostgreSQL database
4. Start all services with proper dependencies

### 3. Verify Services

Check that all services are running:

```bash
docker-compose ps
```

Expected output:
```
NAME                        STATUS              PORTS
neonrain-postgres           Up (healthy)        0.0.0.0:5432->5432/tcp
chrome-extension-backend    Up (healthy)        0.0.0.0:3000->3000/tcp
neonrain-discord-client     Up (healthy)        0.0.0.0:8080->8080/tcp
```

Test the services:

```bash
# Backend health check
curl http://localhost:3000/health

# Discord client health check
curl http://localhost:8080/health
```

### 4. View Logs

View logs for all services:

```bash
docker-compose logs -f
```

View logs for specific service:

```bash
# Backend logs
docker-compose logs -f backend

# Discord client logs
docker-compose logs -f discord-client

# Database logs
docker-compose logs -f postgres
```

## Service Details

### PostgreSQL

- **Port:** 5432 (exposed to host)
- **Database:** neonrain
- **Username:** postgres
- **Password:** postgres
- **Data persistence:** Volume `postgres_data`

### Backend (Node.js)

- **Port:** 3000 (exposed to host)
- **Health check:** `GET /health`
- **Depends on:** PostgreSQL (waits for healthy status)
- **Auto-restart:** Yes

### Discord Client (Go)

- **Port:** 8080 (exposed to host)
- **Health check:** `GET /health`
- **Depends on:** Backend (waits for healthy status)
- **Auto-restart:** Yes
- **Features:**
  - AI-powered responses using OpenAI GPT-4o
  - Conversation history (last 50 messages per channel)
  - Third-person prompting for natural conversations
  - Streaming responses with paragraph chunking
  - 70 WPM rate limiting
  - Typing indicators

## Managing Services

### Start Services

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d backend
docker-compose up -d discord-client
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop but keep volumes (preserves database)
docker-compose down

# Stop and remove volumes (destroys database)
docker-compose down -v
```

### Rebuild Services

When you modify code, rebuild the containers:

```bash
# Rebuild all services
docker-compose build

# Rebuild specific service
docker-compose build backend
docker-compose build discord-client

# Rebuild and restart
docker-compose up -d --build
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart discord-client
```

## Development Workflow

### Making Changes

1. **Backend changes:**
   ```bash
   cd /home/mjacniacki/kodzik/neonrain/backend
   # Make your changes
   docker-compose build backend
   docker-compose up -d backend
   ```

2. **Discord client changes:**
   ```bash
   cd /home/mjacniacki/kodzik/neonrain/discord-user-client
   # Make your changes
   cd ../backend
   docker-compose build discord-client
   docker-compose up -d discord-client
   ```

### Accessing Containers

Execute commands inside containers:

```bash
# Access backend container
docker exec -it chrome-extension-backend sh

# Access Discord client container
docker exec -it neonrain-discord-client sh

# Access PostgreSQL
docker exec -it neonrain-postgres psql -U postgres -d neonrain
```

### Database Operations

```bash
# Backup database
docker exec neonrain-postgres pg_dump -U postgres neonrain > backup.sql

# Restore database
docker exec -i neonrain-postgres psql -U postgres neonrain < backup.sql

# Reset database (WARNING: destroys all data)
docker-compose down -v
docker-compose up -d
```

## Troubleshooting

### Services Won't Start

**Check logs:**
```bash
docker-compose logs backend
docker-compose logs discord-client
```

**Common issues:**

1. **Port already in use:**
   ```
   Error: bind: address already in use
   ```
   Solution: Stop the conflicting service or change ports in docker-compose.yml

2. **Missing environment variables:**
   ```
   Error: OPENAI_API_KEY environment variable is required
   ```
   Solution: Ensure `.env` file exists in backend directory with all required variables

3. **Health check failing:**
   ```
   Waiting for backend to become healthy...
   ```
   Solution: Check backend logs, ensure database is accessible

### Discord Client Not Connecting

1. Verify backend is healthy:
   ```bash
   curl http://localhost:3000/health
   ```

2. Check Discord client logs:
   ```bash
   docker-compose logs -f discord-client
   ```

3. Common issues:
   - Missing OPENAI_API_KEY
   - Invalid Discord token in backend database
   - Backend not accessible from discord-client container

### OpenAI API Errors

If you see OpenAI errors in logs:

1. Verify API key is correct in `.env`
2. Check API key has sufficient credits
3. Ensure API key is not rate-limited

### Database Connection Issues

```bash
# Test database connection
docker exec -it chrome-extension-backend sh
# Inside container:
npx prisma db push
```

## Production Considerations

### Security

1. **Change default secrets:**
   - Set strong JWT_SECRET
   - Set strong INTERNAL_API_KEY
   - Consider changing PostgreSQL password

2. **Environment variables:**
   - Never commit `.env` to version control
   - Use Docker secrets or environment variable injection in production

3. **Network isolation:**
   - Consider creating a custom Docker network
   - Don't expose PostgreSQL port to host in production

### Performance

1. **Resource limits:**
   Add to docker-compose.yml:
   ```yaml
   services:
     discord-client:
       deploy:
         resources:
           limits:
             cpus: '1.0'
             memory: 512M
   ```

2. **Logging:**
   Configure log rotation:
   ```yaml
   services:
     discord-client:
       logging:
         driver: "json-file"
         options:
           max-size: "10m"
           max-file: "3"
   ```

### Monitoring

Add monitoring services:

```yaml
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    # ... configuration

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    # ... configuration
```

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     Docker Network                        │
│                                                           │
│  ┌────────────────┐                                      │
│  │   PostgreSQL   │                                      │
│  │                │                                      │
│  │  neonrain DB   │◄────────┐                           │
│  └────────────────┘          │                           │
│                              │                           │
│  ┌────────────────┐          │                           │
│  │    Backend     │          │                           │
│  │   (Node.js)    │──────────┘                           │
│  │                │                                      │
│  │  Port 3000     │◄────────┐                           │
│  └────────────────┘          │                           │
│                              │                           │
│  ┌────────────────┐          │                           │
│  │ Discord Client │          │                           │
│  │     (Go)       │──────────┘                           │
│  │                │                                      │
│  │  Port 8080     │◄──── HTTP API                       │
│  │                │                                      │
│  │  Features:     │                                      │
│  │  - AI Stream   │◄──── OpenAI API                     │
│  │  - History     │                                      │
│  │  - Context     │◄──── Discord WebSocket              │
│  └────────────────┘                                      │
│                                                           │
└──────────────────────────────────────────────────────────┘
        ▲              ▲              ▲
        │              │              │
     :5432          :3000          :8080
     (DB)         (Backend)      (Discord)
```

## Additional Resources

- [Backend README](./backend/README.md)
- [Discord Client README](./discord-user-client/README.md)
- [Discord Client Changelog](./discord-user-client/CHANGELOG.md)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

## Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Verify all environment variables are set
3. Ensure Docker and Docker Compose are up to date
4. Review troubleshooting section above
