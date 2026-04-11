#!/usr/bin/env bash
# worktree-add.sh — create a git worktree ready for a fresh Claude Code session.
#
# Why this exists:
# Running multiple Claude Code terminals in the same working directory causes
# branch-switch races. `git checkout` is per-working-directory, not per-terminal,
# so terminal A doing `git checkout main` silently moves terminal B to main too.
# This has caused real incidents in this repo — see CLAUDE.md "Multi-session
# workflow" section.
#
# Solution: git worktree. One .git store, multiple isolated working directories.
# Each worktree has its own branch state, and git enforces that the same branch
# can't be checked out in two worktrees at once. Two Claude sessions in two
# worktrees can't race on branch state.
#
# This script wraps `git worktree add` with the setup that Claude sessions need
# but a vanilla worktree lacks:
#   1. Copy .env.local files (untracked, not included in git's worktree setup)
#   2. Run npm install (node_modules is per-worktree, not shared)
#   3. Optionally move uncommitted changes from the current worktree (--move)
#
# Usage:
#   scripts/worktree-add.sh <branch-name>                # from main (default base)
#   scripts/worktree-add.sh <branch-name> --base=<branch> # from a different base
#   scripts/worktree-add.sh <branch-name> --move         # also move uncommitted work
#   scripts/worktree-add.sh <branch-name> --no-install   # skip npm install
#
# Branch name can be new (will be created from base) or existing.
#
# Companion: scripts/worktree-remove.sh <dir>

set -euo pipefail

# ---- Argument parsing ---------------------------------------------------------

BRANCH=""
BASE="main"
MOVE_UNCOMMITTED=false
SKIP_INSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base=*)
      BASE="${1#--base=}"
      shift
      ;;
    --move)
      MOVE_UNCOMMITTED=true
      shift
      ;;
    --no-install)
      SKIP_INSTALL=true
      shift
      ;;
    -h|--help)
      sed -n '/^# Usage:/,/^# Companion/p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    -*)
      echo "Error: unknown flag $1" >&2
      echo "Usage: $0 <branch> [--base=<base>] [--move] [--no-install]" >&2
      exit 2
      ;;
    *)
      if [[ -z "$BRANCH" ]]; then
        BRANCH="$1"
      else
        echo "Error: unexpected positional arg: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$BRANCH" ]]; then
  echo "Usage: $0 <branch-name> [--base=<base>] [--move] [--no-install]" >&2
  echo "" >&2
  echo "Example: $0 feature/T-foo              # new branch from main" >&2
  echo "Example: $0 feature/T-foo --base=dev   # new branch from dev" >&2
  echo "Example: $0 feature/T-existing          # existing branch" >&2
  exit 2
fi

# ---- Path derivation ----------------------------------------------------------

REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
# Short name: strip feature/ prefix, replace / with -, keep everything readable
SHORT=$(echo "$BRANCH" | sed 's|^feature/||; s|/|-|g')
WORKTREE_DIR="$(dirname "$REPO_ROOT")/${REPO_NAME}-${SHORT}"

if [[ -d "$WORKTREE_DIR" ]]; then
  echo "Error: target directory already exists: $WORKTREE_DIR" >&2
  echo "" >&2
  echo "If this is a stale worktree, remove it first:" >&2
  echo "  scripts/worktree-remove.sh $(basename "$WORKTREE_DIR")" >&2
  exit 1
fi

# ---- Stash rescue (optional) --------------------------------------------------

STASH_REF=""
if $MOVE_UNCOMMITTED; then
  # Check if there's anything to stash (tracked modifications OR untracked files)
  if ! git diff --quiet HEAD 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo "→ Stashing uncommitted changes for move to new worktree…"
    git stash push -u -m "worktree-add rescue: $BRANCH" > /dev/null
    STASH_REF=$(git rev-parse stash@{0})
  else
    echo "→ --move requested but no uncommitted changes to move. Continuing."
    MOVE_UNCOMMITTED=false
  fi
elif ! git diff --quiet HEAD 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard | grep -v '\.env\.local$')" ]]; then
  # Warn if there are uncommitted changes and --move wasn't passed
  # (but ignore .env.local — we'll copy those separately)
  echo ""
  echo "⚠️  Warning: you have uncommitted changes in the current worktree."
  echo "   They will NOT be moved to the new worktree. To move them,"
  echo "   re-run with --move."
  echo ""
fi

# ---- Create the worktree -------------------------------------------------------

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "→ Branch $BRANCH already exists — creating worktree from it"
  git worktree add "$WORKTREE_DIR" "$BRANCH"
else
  echo "→ Creating new branch $BRANCH from $BASE in new worktree"
  # Verify base exists
  if ! git show-ref --verify --quiet "refs/heads/$BASE" && ! git show-ref --verify --quiet "refs/remotes/origin/$BASE"; then
    echo "Error: base branch '$BASE' does not exist locally or on origin" >&2
    exit 2
  fi
  git worktree add -b "$BRANCH" "$WORKTREE_DIR" "$BASE"
fi

# ---- Copy .env.local files -----------------------------------------------------
# Untracked so git's worktree doesn't include them. Claude needs them to
# connect to Supabase / aurora-api / drift gate etc.

echo "→ Copying .env.local files to the new worktree"
ENV_COUNT=0
while IFS= read -r -d '' envfile; do
  rel="${envfile#"$REPO_ROOT/"}"
  dest="$WORKTREE_DIR/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$envfile" "$dest"
  echo "   $rel"
  ENV_COUNT=$((ENV_COUNT + 1))
done < <(find "$REPO_ROOT" -maxdepth 4 -name ".env.local" -not -path "*/node_modules/*" -print0 2>/dev/null)

if [[ $ENV_COUNT -eq 0 ]]; then
  echo "   (none found — if this project needs env vars, copy them manually)"
fi

# ---- Apply stashed changes in the new worktree ---------------------------------

if $MOVE_UNCOMMITTED && [[ -n "$STASH_REF" ]]; then
  echo "→ Applying stashed changes in the new worktree"
  (
    cd "$WORKTREE_DIR"
    if git stash pop "$STASH_REF" 2>&1; then
      echo "   ✓ uncommitted work moved to $WORKTREE_DIR"
    else
      echo "   ⚠ stash pop had conflicts — stash is still available via 'git stash list'"
      echo "   Resolve manually in the new worktree."
    fi
  )
fi

# ---- Install dependencies ------------------------------------------------------

if ! $SKIP_INSTALL && [[ -f "$WORKTREE_DIR/package.json" ]]; then
  echo "→ Installing dependencies (npm install — this takes ~30s)"
  if (cd "$WORKTREE_DIR" && npm install --silent > /dev/null 2>&1); then
    echo "   ✓ dependencies installed"
  else
    echo "   ⚠ npm install failed — run it manually in the new worktree"
  fi
fi

# ---- Done ----------------------------------------------------------------------

echo ""
echo "✓ Worktree ready at: $WORKTREE_DIR"
echo ""
echo "Next steps:"
echo "  1. Open a NEW terminal"
echo "  2. cd $WORKTREE_DIR"
echo "  3. claude"
echo ""
echo "This worktree is ISOLATED from your current terminal's branch state."
echo "Safe to run multiple Claude sessions concurrently on different branches."
echo ""
echo "When done with this branch:"
echo "  scripts/worktree-remove.sh $(basename "$WORKTREE_DIR")"
