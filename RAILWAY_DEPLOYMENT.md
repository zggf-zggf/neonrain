# Railway Deployment Guide

This guide explains how to deploy NeonRain to Railway with a full CD pipeline.

## Architecture Overview

NeonRain consists of four components:

| Service | Description | Port |
|---------|-------------|------|
| **backend** | Express.js API with Prisma | 3000 |
| **web** | Next.js frontend | 3000 |
| **discord-client** | Go Discord service | 8080 |
| **PostgreSQL** | Database (Railway plugin) | 5432 |

## Quick Start

### Option 1: One-Click Deploy (Manual)

```bash
# First time setup
./scripts/setup-railway.sh

# Deploy all services
./scripts/deploy.sh --all

# Or deploy a specific service
./scripts/deploy.sh --service backend
./scripts/deploy.sh --service web
./scripts/deploy.sh --service discord-client
```

### Option 2: GitHub Actions (Automated)

Push to `main` branch to auto-deploy changed services, or use the "Deploy to Railway" workflow manually.

## Initial Setup

### 1. Install Railway CLI

```bash
npm install -g @railway/cli
```

### 2. Login and Create Project

```bash
railway login
railway init --name neonrain
```

### 3. Add PostgreSQL

```bash
railway add --plugin postgresql
```

### 4. Set Environment Variables

Required variables:

```bash
# Clerk Authentication
railway variables set CLERK_PUBLISHABLE_KEY=pk_...
railway variables set CLERK_SECRET_KEY=sk_...
railway variables set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...

# Internal Communication (generate a secure random string)
railway variables set INTERNAL_API_KEY=$(openssl rand -hex 32)

# Optional
railway variables set HUMA_API_KEY=your-key
```

### 5. Configure Service URLs

After first deployment, update these with your Railway URLs:

```bash
# Backend URL for web frontend
railway variables set NEXT_PUBLIC_BACKEND_URL=https://your-backend.railway.app

# Backend URL for discord-client
railway variables set BACKEND_URL=https://your-backend.railway.app

# Discord client URL for backend
railway variables set GO_SERVICE_URL=https://your-discord-client.railway.app
```

## GitHub Actions Setup

### 1. Get Railway Token

1. Go to [Railway Account Tokens](https://railway.app/account/tokens)
2. Create a new token named `github-actions`
3. Copy the token

### 2. Add GitHub Secret

1. Go to your GitHub repository Settings
2. Navigate to Secrets and variables > Actions
3. Add new secret:
   - Name: `RAILWAY_TOKEN`
   - Value: (paste your token)

### 3. Workflow Features

The CD workflow (`deploy.yml`) provides:

- **Auto-deploy on push**: Only deploys services with changes
- **Manual deploy**: Choose specific services or deploy all
- **Change detection**: Uses path filters to detect which services changed
- **Deployment summary**: Shows status of each service

#### Manual Deployment

Go to Actions > "Deploy to Railway" > "Run workflow"

Options:
- `environment`: production or staging
- `services`: "all" or comma-separated list (backend,web,discord-client)

## Service Configuration

### Backend (Express + Prisma)

The backend handles:
- Database migrations on startup via `docker-entrypoint.sh`
- Health checks at `/health`
- API routes at `/api/*`

### Web (Next.js)

Build-time environment variables:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_BACKEND_URL`

Uses standalone output for optimal Docker deployment.

### Discord Client (Go)

Connects to:
- Backend API for token management
- Discord for message handling

## Deployment Commands

```bash
# View project status
railway status

# View logs
railway logs
railway logs --service backend

# View/set variables
railway variables
railway variables set KEY=value

# Open Railway dashboard
railway open

# Redeploy a service
railway up --service backend
```

## Rollback

To rollback a deployment:

```bash
# View deployment history
railway deployments

# Rollback to previous deployment
railway rollback
```

Or use the Railway dashboard to select a specific deployment to restore.

## Monitoring

### Health Checks

All services expose health endpoints:
- Backend: `GET /health`
- Web: `GET /`
- Discord Client: `GET /health`

### Logs

```bash
# Stream logs
railway logs --service backend --follow

# View recent logs
railway logs --service web --lines 100
```

## Troubleshooting

### Database Connection Issues

Ensure `DATABASE_URL` is set (auto-configured when using Railway PostgreSQL plugin):

```bash
railway variables | grep DATABASE_URL
```

### Service Communication

Services communicate via internal Railway networking. Ensure URLs are set correctly:

1. Backend to Discord Client: `GO_SERVICE_URL`
2. Web to Backend: `NEXT_PUBLIC_BACKEND_URL`
3. Discord Client to Backend: `BACKEND_URL`

### Build Failures

Check build logs:

```bash
railway logs --service <service-name> --deployment
```

Common issues:
- Missing environment variables at build time
- Node/Go version compatibility
- Prisma generation failures

## Cost Optimization

Railway pricing tips:
- Use sleep mode for non-production environments
- Monitor resource usage in the dashboard
- Consider horizontal scaling for high traffic
