#!/usr/bin/env bash
set -euo pipefail

# Zero logs: muestra tus console.log del servidor (zero-api)
# Uso: ./logs.sh [filtro_regex]
#   - Por defecto muestra las últimas 200 líneas y termina
#   - Para seguir en vivo: FOLLOW=1 ./logs.sh
#   - Con filtro: ./logs.sh "ERROR|WARNING"
#   - Sin ping: NOPING=1 ./logs.sh

SSH_KEY="${SSH_KEY:-$HOME/.aws/german_mac.pem}"
SSH_HOST="${SSH_HOST:-ec2-user@getreels.app}"
BASE_URL="${BASE_URL:-https://getreels.app}"
FILTER_RE="${1:-}"
FOLLOW="${FOLLOW:-0}"
NOPING="${NOPING:-0}"
LINES="${LINES:-200}"

# Colores para mejor legibilidad
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ping opcional para generar actividad
if [ "$NOPING" != "1" ]; then
  echo -e "${BLUE}→ Generando ping de prueba...${NC}" >&2
  curl -fsS -m 3 "$BASE_URL/zero-api/ping" >/dev/null 2>&1 || true
  sleep 0.2
fi

echo -e "${GREEN}📋 Mostrando logs de zero-api${NC}" >&2
echo -e "${GREEN}───────────────────────────────${NC}" >&2

# Construir comando según el modo
if [ "$FOLLOW" = "1" ]; then
  echo -e "${YELLOW}Modo: Siguiendo logs en vivo (Ctrl+C para salir)${NC}" >&2
  TAIL_CMD="tail -n $LINES -F"
else
  echo -e "${YELLOW}Modo: Últimas $LINES líneas${NC}" >&2
  TAIL_CMD="tail -n $LINES"
fi

# Logs principales (out) y errores (error)
LOG_FILES="~/.pm2/logs/zero-api-out.log ~/.pm2/logs/zero-api-error.log"

# Ejecutar SSH con el comando apropiado
if [ -n "$FILTER_RE" ]; then
  echo -e "${YELLOW}Filtro: $FILTER_RE${NC}" >&2
  echo -e "${GREEN}───────────────────────────────${NC}" >&2
  ssh -i "$SSH_KEY" "$SSH_HOST" "$TAIL_CMD $LOG_FILES 2>/dev/null | grep -E --line-buffered '$FILTER_RE' || true"
else
  echo -e "${GREEN}───────────────────────────────${NC}" >&2
  ssh -i "$SSH_KEY" "$SSH_HOST" "$TAIL_CMD $LOG_FILES 2>/dev/null || true"
fi
