# Docker Deployment

This document explains how to build and run the Discord User Client in Docker.

## Quick Start (Part of Full Stack)

The recommended way to run this service is as part of the full NeonRain stack using Docker Compose from the backend directory:

```bash
cd /home/mjacniacki/kodzik/neonrain/backend
./docker-start.sh
```

See [../DOCKER_SETUP.md](../DOCKER_SETUP.md) for comprehensive Docker Compose documentation.

## Standalone Docker Build

If you want to build and run only the Discord client in Docker:

### Build the Image

```bash
docker build -t neonrain-discord-client .
```

### Run the Container

```bash
docker run -d \
  --name discord-client \
  -p 8080:8080 \
  -e OPENAI_API_KEY="your-openai-key" \
  -e BACKEND_URL="http://backend:3000" \
  -e INTERNAL_API_KEY="your-internal-key" \
  -e HTTP_PORT="8080" \
  neonrain-discord-client
```

### Environment Variables

Required:
- `OPENAI_API_KEY` - Your OpenAI API key

Optional (with defaults):
- `BACKEND_URL` - Backend service URL (default: `http://localhost:3000`)
- `INTERNAL_API_KEY` - Internal API authentication key (default: `default-internal-key`)
- `HTTP_PORT` - HTTP server port (default: `8080`)

### View Logs

```bash
docker logs -f discord-client
```

### Stop Container

```bash
docker stop discord-client
docker rm discord-client
```

## Dockerfile Explanation

The Dockerfile uses a multi-stage build for optimal image size:

**Stage 1: Builder**
- Based on `golang:1.24-alpine`
- Installs Git for dependency management
- Downloads Go modules
- Builds the application from `./cmd/discord-client`
- Creates static binary with CGO_ENABLED=0

**Stage 2: Runtime**
- Based on `alpine:latest` (minimal base image)
- Installs CA certificates for HTTPS
- Copies only the compiled binary
- Exposes port 8080
- Runs the application

**Benefits:**
- Small final image size (~20MB vs ~300MB with full Go toolchain)
- Fast startup time
- Secure (minimal attack surface)
- Efficient layer caching

## Docker Compose Integration

When running with Docker Compose, the discord-client service:

1. **Depends on backend**: Waits for backend to be healthy before starting
2. **Health checks**: Provides HTTP health endpoint at `/health`
3. **Auto-restart**: Automatically restarts on failure
4. **Network isolation**: Runs on isolated Docker network with backend and database

## Development with Docker

### Rebuild After Code Changes

```bash
# From backend directory
cd /home/mjacniacki/kodzik/neonrain/backend
docker-compose build discord-client
docker-compose up -d discord-client
```

### Access Container Shell

```bash
docker exec -it neonrain-discord-client sh
```

### View Real-time Logs

```bash
docker-compose logs -f discord-client
```

You should see logs like:
```
[HISTORY] Initializing channel channel123
[HISTORY] Channel channel123 initialized with 50 messages
[AI] Processing message from #general - user123: What is AI?
[Discord] Typing indicator sent to channel
[AI-STREAM] Received: AI
[AI-CHUNK] Sending: AI stands for Artificial Intelligence.
[AI-RATELIMIT] Delaying 8.6s to simulate 70 WPM
[AI] Chunk sent to #general
```

## Troubleshooting

### Build Fails

**Error: go.mod not found**
```
Solution: Ensure you're building from the discord-user-client directory
```

**Error: cannot find package**
```
Solution: Run 'go mod tidy' before building
```

### Container Won't Start

**Check logs:**
```bash
docker logs discord-client
```

**Common issues:**

1. Missing OPENAI_API_KEY:
   ```
   Error: OPENAI_API_KEY environment variable is required
   ```
   Solution: Add `-e OPENAI_API_KEY="your-key"` to docker run

2. Port already in use:
   ```
   Error: bind: address already in use
   ```
   Solution: Change port mapping: `-p 8081:8080`

3. Cannot connect to backend:
   ```
   Error: error fetching tokens from backend
   ```
   Solution: Ensure backend is running and BACKEND_URL is correct

### Health Check Failing

Test the health endpoint:
```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "connected"
}
```

or (if not connected):
```json
{
  "status": "disconnected"
}
```

## Image Size Optimization

Current optimizations:
- Multi-stage build (reduces from ~800MB to ~20MB)
- Alpine base image
- Static binary (no runtime dependencies)
- .dockerignore excludes unnecessary files

Further optimizations possible:
- Use scratch image for even smaller size (~15MB)
- Strip debug symbols with `-ldflags="-s -w"`

Example with scratch:
```dockerfile
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/discord-client .
CMD ["./discord-client"]
```

## Security Considerations

1. **Non-root user**: Consider adding a non-root user:
   ```dockerfile
   RUN adduser -D -u 1000 discord
   USER discord
   ```

2. **Read-only filesystem**: Run with read-only root:
   ```bash
   docker run --read-only ...
   ```

3. **Resource limits**: Set CPU and memory limits:
   ```bash
   docker run --cpus=1.0 --memory=512m ...
   ```

4. **Secrets**: Never hardcode API keys in Dockerfile - always use environment variables or Docker secrets

## Monitoring

### Prometheus Metrics (Future Enhancement)

Could add Prometheus metrics endpoint:
```go
import "github.com/prometheus/client_golang/prometheus/promhttp"

http.Handle("/metrics", promhttp.Handler())
```

Then scrape metrics from `/metrics` endpoint.

### Health Check Details

The `/health` endpoint returns:
- `200 OK` with `{"status": "connected"}` when Discord session is active
- `200 OK` with `{"status": "disconnected"}` when not connected

Docker Compose uses this for health checks:
```yaml
healthcheck:
  test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Performance Tuning

### Go Runtime Tuning

Set Go runtime environment variables:
```bash
docker run \
  -e GOMAXPROCS=2 \
  -e GOMEMLIMIT=512MiB \
  ...
```

### Resource Allocation

For production, set appropriate limits in docker-compose.yml:
```yaml
services:
  discord-client:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## Related Documentation

- [Main README](./README.md) - Application features and usage
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Docker Compose Setup](../DOCKER_SETUP.md) - Full stack deployment
