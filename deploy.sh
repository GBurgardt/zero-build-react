#!/usr/bin/env bash
set -euo pipefail

# ===========================================
# Deploy Zero-Build (Sin NPM Build!)
# ===========================================

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Config
SSH_KEY="$HOME/.aws/german_mac.pem"
SSH_HOST="ec2-user@getreels.app"
REMOTE_DIR="/home/ec2-user/zero-build-react"

echo -e "${GREEN}🚀 Zero-Build Deploy${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verificar branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${RED}✗ Estás en '$CURRENT_BRANCH'. Cambiá a 'main' para desplegar.${NC}"
  exit 1
fi

# Timer start
START_TIME=$(date +%s)

# Git commit + push (si hay cambios)
if [ -z "$(git status --porcelain)" ]; then
  echo -e "${YELLOW}• No hay cambios locales${NC}"
else
  echo "• Commiteando cambios..."
  git add .
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')" --quiet
fi

echo "• Pusheando a GitHub..."
git push origin main --quiet

# Sync en servidor (SIN BUILD!)
echo "• Actualizando servidor..."
ssh -i "$SSH_KEY" "$SSH_HOST" "
  set -e
  cd '$REMOTE_DIR'
  git fetch --all --quiet
  git reset --hard origin/main --quiet
  echo '✓ Código actualizado'
"

# Timer end
END_TIME=$(date +%s)
DEPLOY_TIME=$((END_TIME - START_TIME))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ Deploy completo en ${DEPLOY_TIME} segundos${NC}"
echo -e "${GREEN}🌐 https://zero.getreels.app${NC}"
