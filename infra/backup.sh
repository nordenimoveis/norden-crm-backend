#!/bin/bash
# Backup diário dos três bancos. Agende no cron da VPS:
#   0 3 * * * cd /opt/norden-crm/infra && ./backup.sh >> backups/backup.log 2>&1
# Recomendado: copiar a pasta backups/ para fora da VPS (ex.: rclone para Google Drive).
set -euo pipefail
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p backups
for db in crm chatwoot n8n; do
  docker compose exec -T postgres pg_dump -U postgres -Fc "$db" > "backups/${db}_${STAMP}.dump"
done
# Mantém 14 dias
find backups -name '*.dump' -mtime +14 -delete
echo "$(date) backup ok"
