#!/usr/bin/env bash
set -euo pipefail

# Simple remote logs tailer for the Zero app
# Usage:
#   ./logs.sh api      # PM2 logs of zero-api (backend)
#   ./logs.sh web      # PM2 logs of zero-web (static server)
#   ./logs.sh nginx    # Nginx access/error logs
#   ./logs.sh all      # Backend + Web + Nginx together
#   ./logs.sh last 200 # Show last 200 lines (api) and exit

SSH_KEY="${SSH_KEY:-$HOME/.aws/german_mac.pem}"
SSH_HOST="${SSH_HOST:-ec2-user@getreels.app}"
REMOTE_DIR="${REMOTE_DIR:-/home/ec2-user/zero-build-react}"

MODE="${1:-api}"
ARG2="${2:-}"

ssh_base() {
  ssh -i "$SSH_KEY" "$SSH_HOST" "$@"
}

case "$MODE" in
  api)
    # Stream PM2 logs for backend
    ssh_base "pm2 logs zero-api"
    ;;
  web)
    ssh_base "pm2 logs zero-web"
    ;;
  nginx)
    # Follow nginx logs (requires sudo)
    ssh_base "sudo tail -F /var/log/nginx/access.log /var/log/nginx/error.log"
    ;;
  all)
    # Run all important logs in one SSH session, interleaved
    # pm2 logs already prefixes lines with process name; nginx will be raw
    ssh_base "bash -lc 'set -m; (pm2 logs zero-api &) ; (pm2 logs zero-web &) ; (sudo tail -F /var/log/nginx/access.log /var/log/nginx/error.log &) ; wait'"
    ;;
  last)
    # Show last N lines of backend logs (default 200)
    LINES="${ARG2:-200}"
    ssh_base "tail -n $LINES $HOME/.pm2/logs/zero-api-out.log $HOME/.pm2/logs/zero-api-error.log"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo "Try: api | web | nginx | all | last <N>" >&2
    exit 1
    ;;
esac
