FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application from cmd/discord-client
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o discord-client ./cmd/discord-client

# Final stage
FROM alpine:latest

# Install Doppler CLI
RUN apk --no-cache add ca-certificates curl bash && \
    curl -Ls https://cli.doppler.com/install.sh | sh

WORKDIR /root/

# Copy the binary from builder
COPY --from=builder /app/discord-client .

# Expose the HTTP port
EXPOSE 8080

# Run the application with Doppler injecting secrets
CMD ["doppler", "run", "--", "./discord-client"]
