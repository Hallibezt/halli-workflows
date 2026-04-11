#!/usr/bin/env bash
# worktree-remove.sh — safely remove a git worktree with a merge-status check.
#
# Refuses to remove a worktree whose branch has uncommitted work, unpushed
# commits, or unmerged commits, unless --force is passed. Companion to
# worktree-add.sh. See CLAUDE.md "Multi-session workflow" section.
#
# Usage:
#   scripts/worktree-remove.sh <worktree-dir-name>          # safe mode
#   scripts/worktree-remove.sh <worktree-dir-name> --force  # skip safety checks
#   scripts/worktree-remove.sh --list                       # list worktrees
#
# <worktree-dir-name> can be the bare directory name (e.g. "cabin-T-foo") or
# an absolute path. The script resolves it relative to the parent of the main
# repo directory.

set -euo pipefail

# ---- Arg parsing ---------------------------------------------------------------

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <worktree-dir-name> [--force]" >&2
  echo "       $0 --list" >&2
  exit 2
fi

FORCE=false
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)
      git worktree list
      exit 0
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      sed -n '/^# Usage:/,/^# <worktree/p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *)
      if [[ -z "$TARGET" ]]; then
        TARGET="$1"
      else
        echo "Error: unexpected argument: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Error: missing worktree directory name" >&2
  echo "Usage: $0 <worktree-dir-name> [--force]" >&2
  exit 2
fi

# ---- Resolve target path -------------------------------------------------------

REPO_ROOT=$(git rev-parse --show-toplevel)

if [[ "$TARGET" = /* ]]; then
  WORKTREE_DIR="$TARGET"
else
  WORKTREE_DIR="$(dirname "$REPO_ROOT")/$TARGET"
fi

if [[ ! -d "$WORKTREE_DIR" ]]; then
  echo "Error: worktree directory not found: $WORKTREE_DIR" >&2
  echo "" >&2
  echo "Existing worktrees:" >&2
  git worktree list >&2
  exit 1
fi

if [[ "$WORKTREE_DIR" = "$REPO_ROOT" ]]; then
  echo "Error: refusing to remove the main worktree (you are currently in it)" >&2
  exit 1
fi

# ---- Get the branch name of the worktree ---------------------------------------

BRANCH=$(git -C "$WORKTREE_DIR" symbolic-ref --short HEAD 2>/dev/null || echo "")
if [[ -z "$BRANCH" ]]; then
  echo "Warning: worktree is in detached HEAD state" >&2
fi

# ---- Safety checks -------------------------------------------------------------

if ! $FORCE; then
  UNSAFE=false

  # 1. Uncommitted changes
  if ! git -C "$WORKTREE_DIR" diff --quiet HEAD 2>/dev/null; then
    echo "✗ Unsafe: worktree has uncommitted changes"
    UNSAFE=true
  fi

  # 2. Untracked files (excluding .env.local which is always expected)
  UNTRACKED=$(git -C "$WORKTREE_DIR" ls-files --others --exclude-standard | grep -v '\.env\.local$' | head -5 || true)
  if [[ -n "$UNTRACKED" ]]; then
    echo "✗ Unsafe: worktree has untracked files:"
    echo "$UNTRACKED" | sed 's/^/    /'
    UNSAFE=true
  fi

  # 3. Unpushed / unmerged commits (only if branch exists)
  if [[ -n "$BRANCH" ]]; then
    # Check if branch has commits not reachable from main
    UNMERGED=$(git rev-list --count "main..$BRANCH" 2>/dev/null || echo "0")
    if [[ "$UNMERGED" != "0" ]]; then
      echo "✗ Unsafe: branch $BRANCH has $UNMERGED commit(s) not merged into main"
      UNSAFE=true
    fi
  fi

  if $UNSAFE; then
    echo ""
    echo "Remove anyway with --force (work will be lost if not committed + merged)."
    exit 1
  fi
fi

# ---- Do the removal ------------------------------------------------------------

echo "→ Removing worktree: $WORKTREE_DIR"
if $FORCE; then
  git worktree remove --force "$WORKTREE_DIR"
else
  git worktree remove "$WORKTREE_DIR"
fi

echo "✓ Removed: $WORKTREE_DIR"

# Optional branch cleanup prompt
if [[ -n "$BRANCH" ]] && [[ "$BRANCH" != "main" ]] && [[ "$BRANCH" != "master" ]]; then
  # Only offer to delete the branch if it's fully merged into main
  if git merge-base --is-ancestor "$BRANCH" main 2>/dev/null; then
    echo ""
    echo "Branch $BRANCH is fully merged into main."
    echo "Delete it with:  git branch -d $BRANCH"
  fi
fi
