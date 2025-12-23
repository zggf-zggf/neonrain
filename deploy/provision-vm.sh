#!/bin/bash
set -e

# NeonRain GCloud VM Provisioning Script
# Prerequisites: gcloud CLI installed and authenticated

# Configuration - adjust as needed
VM_NAME="neonrain-vm"
ZONE="us-central1-a"
MACHINE_TYPE="e2-medium"  # 2 vCPU, 4GB RAM (~$25/month)
DISK_SIZE="50GB"          # Enough for Docker images
IMAGE_FAMILY="ubuntu-2404-lts-amd64"
IMAGE_PROJECT="ubuntu-os-cloud"

echo "=== NeonRain VM Provisioning ==="
echo "VM Name: $VM_NAME"
echo "Zone: $ZONE"
echo "Machine Type: $MACHINE_TYPE"
echo "Disk Size: $DISK_SIZE"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not installed"
    echo "Install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if VM already exists
if gcloud compute instances describe "$VM_NAME" --zone="$ZONE" &> /dev/null; then
    echo "VM '$VM_NAME' already exists in zone '$ZONE'"
    echo "Delete it first: gcloud compute instances delete $VM_NAME --zone=$ZONE"
    exit 1
fi

echo "[1/4] Creating VM..."
gcloud compute instances create "$VM_NAME" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project="$IMAGE_PROJECT" \
    --boot-disk-size="$DISK_SIZE" \
    --boot-disk-type="pd-balanced" \
    --tags="http-server,https-server" \
    --metadata=startup-script='#!/bin/bash
# This runs on first boot
apt-get update
apt-get install -y git curl'

echo "[2/4] Creating firewall rules (if not exist)..."
gcloud compute firewall-rules create allow-http \
    --allow=tcp:80 \
    --target-tags=http-server \
    --description="Allow HTTP" 2>/dev/null || echo "HTTP rule already exists"

gcloud compute firewall-rules create allow-https \
    --allow=tcp:443 \
    --target-tags=https-server \
    --description="Allow HTTPS" 2>/dev/null || echo "HTTPS rule already exists"

echo "[3/4] Waiting for VM to be ready..."
sleep 30

echo "[4/4] Getting VM external IP..."
EXTERNAL_IP=$(gcloud compute instances describe "$VM_NAME" \
    --zone="$ZONE" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "=== VM Created Successfully ==="
echo ""
echo "External IP: $EXTERNAL_IP"
echo ""
echo "Next steps:"
echo ""
echo "1. Add DNS A records pointing to $EXTERNAL_IP:"
echo "   - neonrain.humalike.ai"
echo "   - api.neonrain.humalike.ai"
echo ""
echo "2. SSH into VM and run setup:"
echo "   gcloud compute ssh $VM_NAME --zone=$ZONE"
echo ""
echo "3. Once connected, run:"
echo "   curl -sSL https://raw.githubusercontent.com/zggf-zggf/neonrain/main/deploy/setup-vm.sh | bash"
echo "   cd /mnt/data/neonrain/backend && docker compose up -d --build"
echo ""
echo "Or run everything in one command:"
echo "   gcloud compute ssh $VM_NAME --zone=$ZONE -- 'curl -sSL https://raw.githubusercontent.com/zggf-zggf/neonrain/main/deploy/setup-vm.sh | bash && cd /mnt/data/neonrain/backend && docker compose up -d --build'"
echo ""
