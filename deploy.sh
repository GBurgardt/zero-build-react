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

# Sync en servidor + backend OpenAI (SIN BUILD!)
echo "• Actualizando servidor..."
ssh -i "$SSH_KEY" "$SSH_HOST" "
  set -e
  cd '$REMOTE_DIR'
  git fetch --all --quiet
  git reset --hard origin/main --quiet
  echo '✓ Código actualizado'

  # Subir .env si no existe (se espera que lo subamos desde local, pero por si ya existe, no lo tocamos)
" >/dev/null 2>&1 || true

# Subir .env desde local si existe
if [ -f ".env" ]; then
  echo "• Subiendo .env al servidor..."
  scp -i "$SSH_KEY" ".env" "$SSH_HOST":"$REMOTE_DIR/.env" >/dev/null
fi

# Preparar backend con PM2
ssh -i "$SSH_KEY" "$SSH_HOST" "
  set -e
  cd '$REMOTE_DIR'
  # Instalar deps backend si hay package.json
  if [ -f package.json ]; then
    if command -v pnpm >/dev/null 2>&1; then PM=pnpm; elif command -v yarn >/dev/null 2>&1; then PM=yarn; else PM=npm; fi
    if [ "$PM" = "pnpm" ]; then pnpm install --silent --prod || pnpm install --silent; fi
    if [ "$PM" = "yarn" ]; then yarn install --silent --production || yarn install --silent; fi
    if [ "$PM" = "npm" ]; then npm install --silent --only=prod || npm install --silent; fi
  fi
  if pm2 describe zero-api > /dev/null 2>&1; then
    pm2 restart zero-api --update-env
  else
    pm2 start server.mjs --name zero-api --interpreter node --update-env
  fi
  pm2 save

  # Configurar Nginx para /zero-api si no existe
  if ! sudo grep -q 'location /zero-api' /etc/nginx/conf.d/getreels.app.conf; then
    sudo cp /etc/nginx/conf.d/getreels.app.conf /etc/nginx/conf.d/getreels.app.conf.backup-zero-api || true
    sudo sed -i '/location \/bot {/i\    # Zero-build OpenAI API\n    location /zero-api {\n        proxy_pass http://127.0.0.1:3004/;\n        proxy_set_header Host \$host;\n        proxy_set_header X-Real-IP \$remote_addr;\n        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto \$scheme;\n        rewrite ^/zero-api/?(.*)$ /\$1 break;\n    }\n' /etc/nginx/conf.d/getreels.app.conf
    sudo nginx -t && sudo systemctl reload nginx
  fi
"

# Timer end
END_TIME=$(date +%s)
DEPLOY_TIME=$((END_TIME - START_TIME))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ Deploy completo en ${DEPLOY_TIME} segundos${NC}"
echo -e "${GREEN}🌐 https://zero.getreels.app${NC}"
