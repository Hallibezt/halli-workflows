#!/bin/bash
# Syncs source repo → all local plugin locations after committing changes
# Run this after: git commit && git push

REPO="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HOME/.claude/plugins/cache/halli-workflows/halli-workflows/1.0.0"
MARKETPLACE="$HOME/.claude/plugins/marketplaces/halli-workflows"

EXCLUDE="--exclude=.git --exclude=LICENSE --exclude=README.md --exclude=SELF.md --exclude=plugin --exclude=sync-cache.sh"

synced=0

if [ -d "$MARKETPLACE" ]; then
  echo "=== Syncing to marketplaces ==="
  rsync -av $EXCLUDE "$REPO/" "$MARKETPLACE/"
  synced=$((synced + 1))
fi

if [ -d "$CACHE" ]; then
  echo ""
  echo "=== Syncing to cache ==="
  rsync -av $EXCLUDE "$REPO/" "$CACHE/"
  synced=$((synced + 1))
fi

if [ $synced -eq 0 ]; then
  echo "No plugin locations found — is halli-workflows installed?"
  exit 1
fi

echo ""
echo "Synced to $synced location(s). Start a new Claude Code session to pick up changes."
