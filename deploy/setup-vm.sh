#!/bin/bash
set -e

# NeonRain VM Setup Script
# Run on a fresh Ubuntu 22.04/24.04 VM
# Usage: curl -sSL https://raw.githubusercontent.com/zggf-zggf/neonrain/main/deploy/setup-vm.sh | bash

echo "=== NeonRain VM Setup ==="

# Configuration
DATA_DIR="/mnt/data"
APP_DIR="$DATA_DIR/neonrain"
DOCKER_DATA_DIR="$DATA_DIR/docker"
DOMAIN="neonrain.humalike.ai"
API_DOMAIN="api.neonrain.humalike.ai"

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    SUDO="sudo"
else
    SUDO=""
fi

echo "[1/6] Updating system packages..."
$SUDO apt-get update
$SUDO apt-get upgrade -y

echo "[2/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | $SUDO sh
    $SUDO usermod -aG docker $USER
    echo "Docker installed. You may need to log out and back in for group changes."
else
    echo "Docker already installed."
fi

echo "[3/6] Installing Caddy..."
if ! command -v caddy &> /dev/null; then
    $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list
    $SUDO apt-get update
    $SUDO apt-get install -y caddy
else
    echo "Caddy already installed."
fi

echo "[4/6] Setting up data directory..."
# Create data directory if it doesn't exist (for VMs without separate data disk)
if [ ! -d "$DATA_DIR" ]; then
    $SUDO mkdir -p "$DATA_DIR"
    $SUDO chown $USER:$USER "$DATA_DIR"
fi

# Move Docker data to data partition
if [ ! -L /var/lib/docker ] && [ -d /var/lib/docker ]; then
    echo "Moving Docker data to $DOCKER_DATA_DIR..."
    $SUDO systemctl stop docker || true
    $SUDO mv /var/lib/docker "$DOCKER_DATA_DIR" || $SUDO mkdir -p "$DOCKER_DATA_DIR"
    $SUDO ln -sf "$DOCKER_DATA_DIR" /var/lib/docker
    $SUDO systemctl start docker
elif [ ! -d /var/lib/docker ]; then
    $SUDO mkdir -p "$DOCKER_DATA_DIR"
    $SUDO ln -sf "$DOCKER_DATA_DIR" /var/lib/docker
fi

# Docker config directory
mkdir -p "$DATA_DIR/.docker"
ln -sf "$DATA_DIR/.docker" ~/.docker 2>/dev/null || true

echo "[5/6] Configuring Caddy..."
$SUDO tee /etc/caddy/Caddyfile > /dev/null <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3001
}

$API_DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF

$SUDO systemctl enable caddy
$SUDO systemctl restart caddy

echo "[6/6] Cloning repository..."
if [ ! -d "$APP_DIR" ]; then
    git clone https://github.com/zggf-zggf/neonrain.git "$APP_DIR"
else
    echo "Repository already exists at $APP_DIR"
    cd "$APP_DIR" && git pull
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Make sure DNS A records point to this VM:"
echo "   - $DOMAIN"
echo "   - $API_DOMAIN"
echo ""
echo "2. Deploy the application:"
echo "   cd $APP_DIR/backend"
echo "   docker compose up -d --build"
echo ""
echo "3. Check logs:"
echo "   docker compose logs -f"
echo ""
