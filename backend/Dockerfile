FROM node:20-alpine

# Install OpenSSL for Prisma and Doppler CLI
RUN apk add --no-cache openssl openssl-dev curl bash gnupg && \
    curl -Ls https://cli.doppler.com/install.sh | sh

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Start the application with Doppler injecting secrets
ENTRYPOINT ["doppler", "run", "--", "docker-entrypoint.sh"]
