#!/bin/bash
set -e

# NeonRain GCloud Deployment Script
# This script deploys NeonRain to a single Google Cloud VM

# Configuration
PROJECT_ID="${GCLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${GCLOUD_ZONE:-us-central1-a}"
VM_NAME="neonrain-vm"
MACHINE_TYPE="e2-small"  # ~$13/month, upgrade to e2-medium if needed

echo "=== NeonRain GCloud Deployment ==="
echo "Project: $PROJECT_ID"
echo "Zone: $ZONE"
echo "VM: $VM_NAME"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not installed. Install from https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if project is set
if [ -z "$PROJECT_ID" ]; then
    echo "Error: No GCloud project set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

# Enable required APIs
echo "=== Enabling required APIs ==="
gcloud services enable compute.googleapis.com --project=$PROJECT_ID

# Check if VM already exists
if gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID &> /dev/null; then
    echo "VM $VM_NAME already exists."
    read -p "Delete and recreate? (y/N): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        echo "Deleting existing VM..."
        gcloud compute instances delete $VM_NAME --zone=$ZONE --project=$PROJECT_ID --quiet
    else
        echo "Connecting to existing VM..."
        gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID
        exit 0
    fi
fi

# Create firewall rules if they don't exist
echo "=== Setting up firewall rules ==="
if ! gcloud compute firewall-rules describe allow-neonrain --project=$PROJECT_ID &> /dev/null; then
    gcloud compute firewall-rules create allow-neonrain \
        --allow tcp:80,tcp:443,tcp:3000,tcp:3001,tcp:8080 \
        --target-tags=neonrain \
        --description="Allow HTTP/HTTPS and NeonRain ports" \
        --project=$PROJECT_ID
else
    echo "Firewall rule already exists"
fi

# Create VM
echo "=== Creating VM ==="
gcloud compute instances create $VM_NAME \
    --zone=$ZONE \
    --machine-type=$MACHINE_TYPE \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-ssd \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --tags=neonrain,http-server,https-server \
    --project=$PROJECT_ID \
    --metadata=startup-script='#!/bin/bash
# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker $(ls /home | head -1)

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Signal that setup is complete
touch /tmp/docker-ready
'

echo "=== Waiting for VM to be ready ==="
sleep 10

# Wait for Docker to be installed (max 3 minutes)
echo "Waiting for Docker installation..."
for i in {1..36}; do
    if gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command="test -f /tmp/docker-ready" 2>/dev/null; then
        echo "Docker is ready!"
        break
    fi
    echo "  Waiting... ($i/36)"
    sleep 5
done

# Get VM external IP
EXTERNAL_IP=$(gcloud compute instances describe $VM_NAME --zone=$ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo ""
echo "=== VM Created ==="
echo "External IP: $EXTERNAL_IP"
echo ""

# Create setup script to run on VM
echo "=== Creating setup script ==="
cat > /tmp/neonrain-setup.sh << 'SETUP_SCRIPT'
#!/bin/bash
set -e

cd ~

# Clone repo if not exists
if [ ! -d "neonrain" ]; then
    echo "Cloning repository..."
    git clone https://github.com/mjacniacki/neonrain.git
fi

cd neonrain/backend

# Check for .env file
if [ ! -f ".env" ]; then
    echo ""
    echo "=== Environment Configuration ==="
    echo "Please create .env file with your configuration:"
    echo ""
    cat << 'ENV_TEMPLATE'
# Copy this to .env and fill in your values:

# Database (leave as-is for Docker)
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/neonrain

# Clerk Authentication (from clerk.com dashboard)
CLERK_SECRET_KEY=sk_live_xxx
CLERK_PUBLISHABLE_KEY=pk_live_xxx

# Internal API Key (generate a random string)
INTERNAL_API_KEY=change-this-to-random-string

# HUMA API Key (from humalike.tech)
HUMA_API_KEY=your-huma-api-key

# For web container
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
ENV_TEMPLATE
    echo ""
    echo "Run: nano .env"
    echo "Then run this script again."
    exit 1
fi

# Start services
echo "=== Starting services ==="
docker compose down 2>/dev/null || true
docker compose build
docker compose up -d

# Wait for backend to be healthy
echo "Waiting for services to start..."
sleep 10

# Run migrations
echo "=== Running database migrations ==="
docker compose exec -T backend npx prisma migrate deploy

echo ""
echo "=== Deployment Complete ==="
docker compose ps
echo ""
echo "Services are running!"
echo "  - Backend: http://$(curl -s ifconfig.me):3000"
echo "  - Web: http://$(curl -s ifconfig.me):3001"
echo ""
SETUP_SCRIPT

# Copy and run setup script
echo "=== Deploying to VM ==="
gcloud compute scp /tmp/neonrain-setup.sh $VM_NAME:~/setup.sh --zone=$ZONE --project=$PROJECT_ID
gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT_ID --command="chmod +x ~/setup.sh && ~/setup.sh"

echo ""
echo "=== Deployment Info ==="
echo "VM External IP: $EXTERNAL_IP"
echo ""
echo "To connect to the VM:"
echo "  gcloud compute ssh $VM_NAME --zone=$ZONE"
echo ""
echo "To view logs:"
echo "  gcloud compute ssh $VM_NAME --zone=$ZONE --command='cd neonrain/backend && docker compose logs -f'"
echo ""
echo "Services:"
echo "  - Backend API: http://$EXTERNAL_IP:3000"
echo "  - Web Dashboard: http://$EXTERNAL_IP:3001"
echo ""
