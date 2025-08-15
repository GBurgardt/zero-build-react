#!/usr/bin/env bash
set -euo pipefail

# Zero logs: muestra tus console.log del servidor (zero-api)
# Uso: ./logs.sh [filtro_regex]
#   - Por defecto muestra las últimas 200 líneas y termina (no queda colgado)
#   - Para seguir en vivo, seteá FOLLOW=1:  FOLLOW=1 ./logs.sh "ERROR|PING"
#   - Siempre dispara un ping a /zero-api/ping para generar una línea visible

SSH_KEY="${SSH_KEY:-$HOME/.aws/german_mac.pem}"
SSH_HOST="${SSH_HOST:-ec2-user@getreels.app}"
BASE_URL="${BASE_URL:-https://getreels.app}"
FILTER_RE="${1:-}"
FOLLOW="${FOLLOW:-0}"

ssh_base() { ssh -i "$SSH_KEY" "$SSH_HOST" "$@"; }

echo "→ Generando ping de prueba en $BASE_URL/zero-api/ping (para forzar una línea nueva en logs)..." >&2
curl -fsS -m 3 "$BASE_URL/zero-api/ping" >/dev/null || true
sleep 0.3

echo "→ Archivos remotos de logs disponibles (~/.pm2/logs):" >&2
ssh_base bash -lc 'ls -1 "$HOME"/.pm2/logs | grep -E "zero-api-(out|error).*log" || true' >&2

if [ "$FOLLOW" = "1" ]; then
  REMOTE_CMD='tail -n 200 -F "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log'
else
  REMOTE_CMD='tail -n 200 "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log'
fi

if [ -n "$FILTER_RE" ]; then
  ssh_base bash -lc "$REMOTE_CMD | stdbuf -oL -eL grep --line-buffered -E -- '$FILTER_RE'"
else
  ssh_base bash -lc "$REMOTE_CMD"
fi
