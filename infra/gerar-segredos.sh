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

# Chaves VAPID (Web Push): par de chaves EC P-256 em base64url, usado para
# notificar corretores no celular/desktop mesmo com o CRM fechado. Só gera se
# ambas estiverem vazias (idempotente). Prefere o web-push (Node); sem Node,
# cai no openssl — o resultado é equivalente.
if grep -qE '^VAPID_PUBLIC_KEY=$' .env && grep -qE '^VAPID_PRIVATE_KEY=$' .env; then
  vpub=""; vpriv=""
  if command -v npx >/dev/null 2>&1 && npx --yes web-push generate-vapid-keys --json >/tmp/vapid.$$.json 2>/dev/null; then
    vpub=$(sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p' /tmp/vapid.$$.json)
    vpriv=$(sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p' /tmp/vapid.$$.json)
    rm -f /tmp/vapid.$$.json
  fi
  if [ -z "$vpub" ] || [ -z "$vpriv" ]; then
    # Fallback sem Node: gera o par com openssl. tr -d '\n' remove a quebra que o
    # base64 do GNU insere a cada 76 colunas (o do busybox não quebra).
    _pem=$(mktemp)
    openssl ecparam -name prime256v1 -genkey -noout -out "$_pem" 2>/dev/null
    vpub=$(openssl ec -in "$_pem" -pubout -outform DER 2>/dev/null | tail -c 65 | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
    vpriv=$(openssl ec -in "$_pem" -outform DER 2>/dev/null | dd bs=1 skip=7 count=32 2>/dev/null | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
    rm -f "$_pem"
  fi
  fill VAPID_PUBLIC_KEY "$vpub"
  fill VAPID_PRIVATE_KEY "$vpriv"
fi

chmod 600 .env
echo "Pronto. Guarde uma cópia do .env em local seguro (gerenciador de senhas)."
