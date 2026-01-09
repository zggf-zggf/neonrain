# CLAUDE.md

Project-specific instructions for Claude Code.

## Project Structure

Monorepo with four components:
- `backend/` - Express.js API server with Prisma ORM (TypeScript)
- `web/` - Next.js frontend (TypeScript)
- `discord-user-client/` - Go service for Discord user client connections
- `chrome-extension/` - Browser extension for Discord token extraction

## Type Checking After Schema Changes

**CRITICAL**: After modifying `backend/prisma/schema.prisma`, always:

1. Regenerate Prisma client:
   ```bash
   cd backend && npx prisma generate
   ```

2. Run TypeScript type check to catch stale references:
   ```bash
   cd backend && npx tsc --noEmit
   ```

3. If removing fields from a model, search for all usages:
   ```bash
   grep -r "fieldName" --include="*.ts" backend/src/
   ```

This prevents bugs where code references fields that no longer exist in the schema.

## Common Commands

```bash
# Backend
cd backend && npm run dev          # Start dev server
cd backend && npx prisma studio    # Database GUI
cd backend && npx prisma migrate dev --name <name>  # Create migration

# Web
cd web && npm run dev              # Start Next.js dev server

# Go client
cd discord-user-client && go run cmd/discord-client/main.go

# Type checking (run before committing)
cd backend && npx prisma generate && npx tsc --noEmit
cd web && npx tsc --noEmit
```

## Database

- PostgreSQL with Prisma ORM
- Schema: `backend/prisma/schema.prisma`
- Migrations: `backend/prisma/migrations/`

## Key Patterns

- User authentication via Clerk
- Discord tokens stored per-user, server configs per user-server pair
- Internal API endpoints use `X-API-Key` header for Go client communication
