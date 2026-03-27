#!/bin/bash
# One-command VPS deployment for Network Pulse
set -euo pipefail

REPO_DIR="/opt/network-pulse"
COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "=== Network Pulse Deployment ==="

# 1. Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# 2. Clone or update repo
if [ -d "$REPO_DIR" ]; then
  echo "Updating repository..."
  cd "$REPO_DIR"
  git pull
else
  echo "Cloning repository..."
  git clone https://github.com/yourusername/layerzero.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# 3. Generate secrets if .env doesn't exist
if [ ! -f .env ]; then
  echo "Generating .env from template..."
  cp .env.production.example .env
  sed -i "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env
  sed -i "s/^REDIS_PASSWORD=$/REDIS_PASSWORD=$(openssl rand -hex 32)/" .env
  sed -i "s/^API_KEY=$/API_KEY=$(openssl rand -hex 32)/" .env
  echo ""
  echo ">>> Edit .env to set DOMAIN and RPC URLs, then re-run this script <<<"
  exit 0
fi

# 4. Build and start services
echo "Building and starting services..."
$COMPOSE_CMD up -d --build

# 5. Wait for health check
echo "Waiting for API health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "API is healthy!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Health check failed after 30 attempts"
    $COMPOSE_CMD logs api
    exit 1
  fi
  sleep 2
done

# 6. Set up backup cron
CRON_JOB="0 3 * * * ${REPO_DIR}/scripts/backup.sh"
if ! crontab -l 2>/dev/null | grep -q "backup.sh"; then
  echo "Setting up daily backup cron..."
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
fi

# 7. Print status
echo ""
echo "=== Deployment Complete ==="
echo "Services:"
$COMPOSE_CMD ps
echo ""
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
echo "API: https://${DOMAIN}/health"
echo "API Key: $(grep '^API_KEY=' .env | cut -d= -f2)"
