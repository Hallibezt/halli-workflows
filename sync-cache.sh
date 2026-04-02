#!/bin/bash
# Syncs source repo → local cache after committing changes
# Run this after: git commit && git push

REPO="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HOME/.claude/plugins/cache/halli-workflows/halli-workflows/1.0.0"

if [ ! -d "$CACHE" ]; then
  echo "Cache not found at $CACHE — is the plugin installed?"
  exit 1
fi

rsync -av \
  --exclude='.git' \
  --exclude='LICENSE' \
  --exclude='README.md' \
  --exclude='SELF.md' \
  --exclude='plugin' \
  --exclude='sync-cache.sh' \
  "$REPO/" "$CACHE/"

echo ""
echo "Cache synced. Restart Claude Code (or open a new session) to pick up changes."
