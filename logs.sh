#!/usr/bin/env bash
set -euo pipefail

# Zero logs: muestra tus console.log del servidor (zero-api)
# Uso: ./logs.sh [filtro_regex]
# - Muestra ~/.pm2/logs/zero-api-{out,error}.log del servidor en vivo
# - Dispara un ping a /zero-api/ping para generar una línea visible

SSH_KEY="${SSH_KEY:-$HOME/.aws/german_mac.pem}"
SSH_HOST="${SSH_HOST:-ec2-user@getreels.app}"
BASE_URL="${BASE_URL:-https://getreels.app}"
FILTER_RE="${1:-}"

ssh_base() { ssh -i "$SSH_KEY" "$SSH_HOST" "$@"; }

echo "→ Generando ping de prueba en $BASE_URL/zero-api/ping (para forzar una línea nueva en logs)..." >&2
curl -fsS "$BASE_URL/zero-api/ping" >/dev/null || true
sleep 0.3

REMOTE_CMD='tail -n 200 -F "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log'
if [ -n "$FILTER_RE" ]; then
  ssh_base bash -lc "$REMOTE_CMD | stdbuf -oL -eL grep --line-buffered -E -- '$FILTER_RE'"
else
  ssh_base bash -lc "$REMOTE_CMD"
fi
