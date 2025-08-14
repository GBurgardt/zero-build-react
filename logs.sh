#!/usr/bin/env bash
set -euo pipefail

# Log viewer para ver tus console.log del servidor en vivo
#
# Uso:
#   ./logs.sh api [pattern]       # Muestra logs de zero-api (stdout+stderr). Opcional: filtrar por regex.
#   ./logs.sh web                 # Logs de zero-web (pm2)
#   ./logs.sh nginx               # Nginx access/error
#   ./logs.sh all [pattern]       # api + web + nginx. Opcional: filtro regex que se aplica a todos.
#   ./logs.sh last <N> [pattern]  # Últimas N líneas de zero-api, con filtro opcional, y termina.

SSH_KEY="${SSH_KEY:-$HOME/.aws/german_mac.pem}"
SSH_HOST="${SSH_HOST:-ec2-user@getreels.app}"
REMOTE_DIR="${REMOTE_DIR:-/home/ec2-user/zero-build-react}"

MODE="${1:-api}"
ARG2="${2:-}"

ssh_base() { ssh -i "$SSH_KEY" "$SSH_HOST" "$@"; }

# Tailing crudo de PM2 (sin formateo) para que aparezcan exactamente tus console.log
tail_api_follow() {
  local FILTER_RE="${1:-}"
  # Ejecutar con $HOME del servidor (no expandir localmente)
  if [ -n "$FILTER_RE" ]; then
    ssh_base bash -lc 'tail -n 200 -F "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log | stdbuf -oL -eL grep --line-buffered -E -- '"$FILTER_RE"''
  else
    ssh_base bash -lc 'tail -n 200 -F "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log'
  fi
}

tail_api_last() {
  local LINES="${1:-200}"
  local FILTER_RE="${2:-}"
  if [ -n "$FILTER_RE" ]; then
    ssh_base bash -lc 'tail -n '"$LINES"' "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log | grep -E -- '"$FILTER_RE"''
  else
    ssh_base bash -lc 'tail -n '"$LINES"' "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log'
  fi
}

case "$MODE" in
  api)
    tail_api_follow "$ARG2"
    ;;
  web)
    ssh_base "pm2 logs zero-web"
    ;;
  nginx)
    # Follow nginx logs (requires sudo)
    ssh_base "sudo tail -F /var/log/nginx/access.log /var/log/nginx/error.log"
    ;;
  all)
    # Interleave: api (raw PM2 files), web (pm2), nginx
    # Filtro opcional que se aplica a todos los streams
    FILTER="$ARG2"
    ssh_base bash -lc 'set -m; \
      (tail -n 200 -F "$HOME"/.pm2/logs/zero-api-out.log "$HOME"/.pm2/logs/zero-api-error.log'" ${FILTER:+" | stdbuf -oL -eL grep --line-buffered -E -- '$FILTER'"}"' &) ; \
      (pm2 logs zero-web'" ${FILTER:+" | grep -E -- '$FILTER'"}"' &) ; \
      (sudo tail -F /var/log/nginx/access.log /var/log/nginx/error.log'" ${FILTER:+" | grep -E -- '$FILTER'"}"' &) ; \
      wait'
    ;;
  last)
    # Últimas N líneas de backend con filtro opcional
    LINES="${ARG2:-200}"
    FILTER="${3:-}"
    tail_api_last "$LINES" "$FILTER"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo "Try: api | web | nginx | all | last <N>" >&2
    exit 1
    ;;
esac
