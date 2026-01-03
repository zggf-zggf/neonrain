FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Install Doppler CLI for build-time secrets (NEXT_PUBLIC_* vars)
RUN apk add --no-cache curl bash gnupg && \
    curl -Ls https://cli.doppler.com/install.sh | sh

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build with Doppler injecting NEXT_PUBLIC_* vars
ARG DOPPLER_TOKEN
RUN doppler run -- npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
