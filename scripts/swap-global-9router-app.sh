#!/usr/bin/env bash
set -euo pipefail

GLOBAL_BASE="${GLOBAL_BASE:-/home/erul/.nvm/versions/node/v24.14.0/lib/node_modules/9router}"
GLOBAL_APP="$GLOBAL_BASE/app"
REPO_DIR="${REPO_DIR:-/home/erul/.openclaw/workspace/research/9router-erul2}"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_DIR/.deploy-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/9router-app-$STAMP"

if [[ ! -d "$GLOBAL_APP" ]]; then
  echo "Global app dir not found: $GLOBAL_APP" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR/.next" ]]; then
  echo "Build artifacts not found in $REPO_DIR/.next" >&2
  echo "Run: cd $REPO_DIR && NODE_ENV=production npm run build" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "== Backing up current global app to =="
echo "$BACKUP_DIR"
rsync -a --delete "$GLOBAL_APP/" "$BACKUP_DIR/"

echo
echo "== Overlaying updated app files from repo =="
install -d "$GLOBAL_APP"
rsync -a --delete "$REPO_DIR/.next/" "$GLOBAL_APP/.next/"
rsync -a --delete "$REPO_DIR/public/" "$GLOBAL_APP/public/"
rsync -a --delete "$REPO_DIR/src/" "$GLOBAL_APP/src/"
install -m 0644 "$REPO_DIR/package.json" "$GLOBAL_APP/package.json"
if [[ -f "$REPO_DIR/server.js" ]]; then
  install -m 0644 "$REPO_DIR/server.js" "$GLOBAL_APP/server.js"
fi

echo
echo "Swap complete."
echo "Backup saved at: $BACKUP_DIR"
echo "Now restart 9router from your terminal when you're ready."
