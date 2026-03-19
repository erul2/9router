#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-dir>" >&2
  exit 1
fi

GLOBAL_BASE="${GLOBAL_BASE:-/home/erul/.nvm/versions/node/v24.14.0/lib/node_modules/9router}"
GLOBAL_APP="$GLOBAL_BASE/app"
BACKUP_DIR="$1"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Backup dir not found: $BACKUP_DIR" >&2
  exit 1
fi

mkdir -p "$GLOBAL_APP"
rsync -a --delete "$BACKUP_DIR/" "$GLOBAL_APP/"

echo "Restore complete from: $BACKUP_DIR"
echo "Restart 9router from your terminal to use the restored app."
