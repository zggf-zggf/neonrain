#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== NeonRain Railway Deployment ===${NC}"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo -e "${YELLOW}Railway CLI not found. Installing...${NC}"
    npm install -g @railway/cli
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo -e "${YELLOW}Not logged into Railway. Please login:${NC}"
    railway login
fi

# Parse arguments
SERVICE=""
ENVIRONMENT="production"

while [[ $# -gt 0 ]]; do
    case $1 in
        --service|-s)
            SERVICE="$2"
            shift 2
            ;;
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --all|-a)
            SERVICE="all"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  -s, --service NAME   Deploy specific service (backend, web, discord-client)"
            echo "  -a, --all            Deploy all services"
            echo "  -e, --env ENV        Environment (production, staging)"
            echo "  -h, --help           Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Default to all if no service specified
if [ -z "$SERVICE" ]; then
    echo -e "${YELLOW}No service specified. Deploy all? [Y/n]${NC}"
    read -r response
    if [[ "$response" =~ ^[Nn]$ ]]; then
        echo "Usage: $0 --service <backend|web|discord-client> or --all"
        exit 1
    fi
    SERVICE="all"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

deploy_service() {
    local service=$1
    local dir=$2

    echo -e "${BLUE}Deploying ${service}...${NC}"
    cd "$PROJECT_ROOT/$dir"

    if railway up --service "$service" --detach; then
        echo -e "${GREEN}✓ ${service} deployed successfully${NC}"
    else
        echo -e "${RED}✗ Failed to deploy ${service}${NC}"
        return 1
    fi
}

case $SERVICE in
    backend)
        deploy_service "backend" "backend"
        ;;
    web)
        deploy_service "web" "web"
        ;;
    discord-client)
        deploy_service "discord-client" "discord-user-client"
        ;;
    all)
        echo -e "${BLUE}Deploying all services...${NC}"
        echo ""

        # Deploy backend first (has migrations)
        deploy_service "backend" "backend"
        echo -e "${YELLOW}Waiting for backend to initialize...${NC}"
        sleep 30

        # Deploy remaining services
        deploy_service "web" "web"
        deploy_service "discord-client" "discord-user-client"

        echo ""
        echo -e "${GREEN}=== All services deployed! ===${NC}"
        ;;
    *)
        echo -e "${RED}Unknown service: $SERVICE${NC}"
        echo "Valid services: backend, web, discord-client, all"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}View deployment status:${NC}"
echo "  railway status"
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  railway logs --service <service-name>"
