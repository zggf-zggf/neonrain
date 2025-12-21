#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== NeonRain Railway Project Setup ===${NC}"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo -e "${YELLOW}Railway CLI not found. Installing...${NC}"
    npm install -g @railway/cli
fi

# Login to Railway
echo -e "${BLUE}Step 1: Login to Railway${NC}"
if ! railway whoami &> /dev/null; then
    railway login
else
    echo -e "${GREEN}Already logged in as: $(railway whoami)${NC}"
fi
echo ""

# Create or link project
echo -e "${BLUE}Step 2: Create/Link Railway Project${NC}"
echo -e "${YELLOW}Do you want to create a new project or link to existing? [new/link]${NC}"
read -r project_action

if [ "$project_action" = "new" ]; then
    echo -e "${YELLOW}Enter project name:${NC}"
    read -r project_name
    railway init --name "$project_name"
else
    railway link
fi
echo ""

# Add PostgreSQL database
echo -e "${BLUE}Step 3: Add PostgreSQL Database${NC}"
echo -e "${YELLOW}Add PostgreSQL database? [Y/n]${NC}"
read -r add_db
if [[ ! "$add_db" =~ ^[Nn]$ ]]; then
    railway add --plugin postgresql
    echo -e "${GREEN}PostgreSQL added. DATABASE_URL will be auto-configured.${NC}"
fi
echo ""

# Configure environment variables
echo -e "${BLUE}Step 4: Configure Environment Variables${NC}"
echo -e "${YELLOW}Setting up required environment variables...${NC}"
echo ""

echo "Please provide the following values (or press Enter to skip):"
echo ""

read -p "CLERK_PUBLISHABLE_KEY: " clerk_pub_key
read -p "CLERK_SECRET_KEY: " clerk_secret_key
read -p "INTERNAL_API_KEY (for internal service communication): " internal_api_key
read -p "HUMA_API_KEY (optional): " huma_api_key

# Set environment variables
if [ -n "$clerk_pub_key" ]; then
    railway variables set CLERK_PUBLISHABLE_KEY="$clerk_pub_key"
    railway variables set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$clerk_pub_key"
fi

if [ -n "$clerk_secret_key" ]; then
    railway variables set CLERK_SECRET_KEY="$clerk_secret_key"
fi

if [ -n "$internal_api_key" ]; then
    railway variables set INTERNAL_API_KEY="$internal_api_key"
else
    # Generate a random key
    random_key=$(openssl rand -hex 32)
    railway variables set INTERNAL_API_KEY="$random_key"
    echo -e "${YELLOW}Generated random INTERNAL_API_KEY${NC}"
fi

if [ -n "$huma_api_key" ]; then
    railway variables set HUMA_API_KEY="$huma_api_key"
fi

echo ""
echo -e "${BLUE}Step 5: Create Services${NC}"
echo -e "${YELLOW}Creating service configurations...${NC}"

# The services will be created on first deploy
echo -e "${GREEN}Services will be created automatically on first deploy.${NC}"
echo ""

echo -e "${BLUE}Step 6: Generate Railway Token for CI/CD${NC}"
echo -e "${YELLOW}To enable GitHub Actions deployment:${NC}"
echo ""
echo "1. Go to: https://railway.app/account/tokens"
echo "2. Create a new token named 'github-actions'"
echo "3. Copy the token"
echo "4. Add it to your GitHub repository secrets as RAILWAY_TOKEN"
echo ""

echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Run: ./scripts/deploy.sh --all"
echo "2. Or push to main branch to trigger GitHub Actions"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  railway status          - View project status"
echo "  railway logs            - View logs"
echo "  railway variables       - View/set variables"
echo "  railway open            - Open Railway dashboard"
