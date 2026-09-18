#!/bin/bash
# Preenche os segredos vazios do .env com valores aleatórios fortes.
set -euo pipefail
[ -f .env ] || cp .env.example .env

fill() {
  local key="$1" value="$2"
  if grep -qE "^${key}=$" .env; then
    sed -i "s|^${key}=$|${key}=${value}|" .env
    echo "✓ ${key}"
  fi
}

hex() { openssl rand -hex "$1"; }

fill POSTGRES_ROOT_PASSWORD "$(hex 24)"
fill CHATWOOT_DB_PASSWORD "$(hex 24)"
fill N8N_DB_PASSWORD "$(hex 24)"
fill CRM_DB_PASSWORD "$(hex 24)"
fill REDIS_PASSWORD "$(hex 24)"
fill CHATWOOT_SECRET_KEY_BASE "$(hex 64)"
fill N8N_ENCRYPTION_KEY "$(hex 32)"
fill JWT_SECRET "$(hex 48)"
fill ENCRYPTION_KEY "$(openssl rand -base64 32)"
fill INTERNAL_API_KEY "$(hex 32)"
fill CHATWOOT_WEBHOOK_TOKEN "$(hex 32)"
fill IMOBZI_WEBHOOK_TOKEN "$(hex 32)"
chmod 600 .env
echo "Pronto. Guarde uma cópia do .env em local seguro (gerenciador de senhas)."
