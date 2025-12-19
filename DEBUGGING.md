# Debugging Guide

## Quick Status Check

```bash
# Check all containers are running
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Expected output:
# neonrain-discord-client    Up X minutes              0.0.0.0:8080->8080/tcp
# chrome-extension-backend   Up X minutes (healthy)    0.0.0.0:3000->3000/tcp
# neonrain-postgres          Up X minutes (healthy)    0.0.0.0:5432->5432/tcp
```

## Watch Backend Logs in Real-Time

```bash
cd /home/mjacniacki/kodzik/neonrain/backend
docker logs chrome-extension-backend -f
```

This will show you:
- Every HTTP request to the backend
- Authentication attempts
- Guild/channel fetch operations
- Errors and stack traces

## Watch Discord Client Logs

```bash
docker logs neonrain-discord-client -f
```

Shows Discord messages as they arrive.

## Common Issues

### 1. "Cannot connect to backend"

**Check if backend is accessible:**
```bash
curl http://localhost:3000/api/status
```

**Should return:**
```json
{"online":true,"message":"Backend is running successfully",...}
```

**If it fails:** Restart services
```bash
docker-compose up -d
```

### 2. "Failed to fetch guilds"

**Watch logs while clicking "Select Channels":**
```bash
docker logs chrome-extension-backend -f
```

Look for:
- `[Guilds] Request received` - Request arrived
- `[Guilds] Invalid token` - Auth issue
- `[Guilds] User has no Discord token` - Need to connect Discord first
- `[Guilds] Success! Found X guilds` - Working correctly

### 3. Extension shows old code behavior

**Rebuild the extension:**
```bash
cd /home/mjacniacki/kodzik/neonrain/chrome-extension
npm run build
```

Then reload in Chrome: `chrome://extensions` → Reload button

### 4. Containers keep stopping

**Check Docker logs:**
```bash
docker-compose logs
```

Look for OOM (out of memory) or other errors.

## Testing the Full Flow

### Step 1: Check Backend Health
```bash
curl http://localhost:3000/api/status
```

### Step 2: Test Go Service (from backend container)
```bash
docker exec chrome-extension-backend wget -qO- http://discord-client:8080/health
```

### Step 3: Test Backend → Go Service Proxy
First, get a valid auth token from the extension or create a test user:

```bash
# Register test user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Response will include: {"token":"...", ...}
```

Then test guilds endpoint (replace TOKEN):
```bash
curl http://localhost:3000/api/discord/guilds \
  -H "Authorization: Bearer TOKEN"
```

## Restart Everything

```bash
cd /home/mjacniacki/kodzik/neonrain/backend
docker-compose down
docker-compose up --build -d
```

## Check Database

```bash
docker exec neonrain-postgres psql -U postgres -d neonrain -c \
  "SELECT id, email, CASE WHEN \"discordToken\" IS NOT NULL THEN 'YES' ELSE 'NO' END as has_discord FROM \"User\";"
```

## Architecture Flow

```
Chrome Extension (localhost)
    ↓ HTTP: localhost:3000
    ↓ Headers: Authorization: Bearer <token>
    ↓
Node.js Backend (Docker: chrome-extension-backend)
    ↓ Validates JWT token
    ↓ Checks user has Discord token in DB
    ↓ HTTP: http://discord-client:8080 (Docker network)
    ↓
Go Discord Service (Docker: neonrain-discord-client)
    ↓ Returns guilds/channels from Discord API
    ↓
Response flows back to extension
```
