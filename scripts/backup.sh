#!/bin/bash
# Daily PostgreSQL backup with 7-day rotation
# Cron: 0 3 * * * /opt/network-pulse/scripts/backup.sh
set -euo pipefail

BACKUP_DIR="/backups"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dvn_health_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump database (uses PGPASSWORD from env or .pgpass)
docker compose exec -T postgres pg_dump -U dvn dvn_health | gzip > "$BACKUP_FILE"

echo "Backup created: ${BACKUP_FILE}"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "dvn_health_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "Cleaned up backups older than ${RETENTION_DAYS} days"
