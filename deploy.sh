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

# Verificar sintaxis de JavaScript
echo "• Verificando sintaxis de JavaScript..."
ERRORS_FOUND=false

# Verificar app.js
if [ -f "public/app.js" ]; then
  if ! node -c "public/app.js" 2>/dev/null; then
    echo -e "${RED}✗ Error de sintaxis en public/app.js:${NC}"
    node -c "public/app.js" 2>&1 | head -10
    ERRORS_FOUND=true
  fi
fi

# Verificar server.mjs
if [ -f "server.mjs" ]; then
  if ! node -c "server.mjs" 2>/dev/null; then
    echo -e "${RED}✗ Error de sintaxis en server.mjs:${NC}"
    node -c "server.mjs" 2>&1 | head -10
    ERRORS_FOUND=true
  fi
fi

# Verificar todos los archivos .js y .mjs en el proyecto
for file in $(find . -name "*.js" -o -name "*.mjs" | grep -v node_modules | grep -v ".git"); do
  if ! node -c "$file" 2>/dev/null; then
    echo -e "${RED}✗ Error de sintaxis en $file${NC}"
    ERRORS_FOUND=true
  fi
done

# Verificar archivos JSON
for file in $(find . -name "*.json" | grep -v node_modules | grep -v ".git"); do
  if ! python3 -m json.tool "$file" >/dev/null 2>&1; then
    echo -e "${RED}✗ Error de sintaxis JSON en $file${NC}"
    ERRORS_FOUND=true
  fi
done

# Verificar archivos CSS (sintaxis básica)
for file in $(find . -name "*.css" | grep -v node_modules | grep -v ".git"); do
  # Verificar paréntesis y llaves balanceadas usando Python
  if ! python3 -c "
import sys
try:
    with open('$file', 'r') as f:
        content = f.read()
        # Remover comentarios CSS
        import re
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        
        # Contar llaves y paréntesis
        open_braces = content.count('{')
        close_braces = content.count('}')
        open_parens = content.count('(')
        close_parens = content.count(')')
        
        if open_braces != close_braces or open_parens != close_parens:
            sys.exit(1)
except:
    sys.exit(1)
" 2>/dev/null; then
    echo -e "${RED}✗ Posible error de sintaxis CSS en $file (llaves o paréntesis desbalanceados)${NC}"
    ERRORS_FOUND=true
  fi
done

# Si hay errores, detener el deploy
if [ "$ERRORS_FOUND" = true ]; then
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}✗ Deploy cancelado: Arreglá los errores de sintaxis primero${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Sintaxis verificada correctamente${NC}"

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
  # Clean up legacy directories that may shadow file routes
  if [ -d 'zero/mornings' ]; then
    rm -rf 'zero/mornings'
  fi
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
    if command -v pnpm >/dev/null 2>&1; then
      pnpm install --silent --prod || pnpm install --silent
    elif command -v yarn >/dev/null 2>&1; then
      yarn install --silent --production || yarn install --silent
    else
      npm install --silent --only=prod || npm install --silent
    fi
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
