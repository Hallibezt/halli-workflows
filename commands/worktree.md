---
name: worktree
description: Create an isolated git worktree for a new Claude Code session. Use when running multiple concurrent Claude terminals on the same repo — avoids branch-switch races.
---

**Command Context**: Spawn a new git worktree so two Claude Code sessions can work on different branches concurrently without racing on HEAD.

## Why this exists

Git branches are per-working-directory, not per-terminal. If terminal A runs `git checkout main` while terminal B is on `feature/foo`, terminal B's working tree silently switches to main too. Two Claude sessions on the same repo will step on each other if they both try to manage branch state.

`git worktree` solves this: one `.git` store, multiple isolated working directories. Each worktree has its own branch checkout, and git enforces that the same branch can't be checked out in two worktrees simultaneously. Two Claude sessions in two worktrees can't race.

## Usage

### Fast path — project has the helper script

If the project has `scripts/worktree-add.sh` (installed by `/kickoff` for every new project), use it directly:

```bash
! scripts/worktree-add.sh $ARGUMENTS
```

Flags supported: `--base=<branch>`, `--move`, `--no-install`. See the script's `--help`.

### Fallback — project does NOT have the helper script

If `scripts/worktree-add.sh` doesn't exist in the current repo (legacy project or the gate hasn't been installed), run the worktree creation steps manually:

```bash
# 1. Derive the target directory
! REPO_ROOT=$(git rev-parse --show-toplevel) && \
  REPO_NAME=$(basename "$REPO_ROOT") && \
  SHORT=$(echo "$ARGUMENTS" | sed 's|^feature/||; s|/|-|g') && \
  WORKTREE_DIR="$(dirname "$REPO_ROOT")/${REPO_NAME}-${SHORT}" && \
  echo "Target: $WORKTREE_DIR"

# 2. Create the worktree (from main by default)
! git worktree add -b "$ARGUMENTS" "$WORKTREE_DIR" main

# 3. Copy .env.local files so the new session has credentials
! find "$REPO_ROOT" -maxdepth 4 -name ".env.local" -not -path "*/node_modules/*" | \
  while read f; do
    rel="${f#$REPO_ROOT/}"
    mkdir -p "$WORKTREE_DIR/$(dirname "$rel")"
    cp "$f" "$WORKTREE_DIR/$rel"
    echo "copied: $rel"
  done

# 4. npm install in the new worktree (node_modules is per-worktree)
! (cd "$WORKTREE_DIR" && npm install --silent 2>&1 | tail -5)

# 5. Print next steps
! echo "" && echo "✓ Worktree ready. Open a new terminal and:" && \
  echo "  cd $WORKTREE_DIR" && \
  echo "  claude"
```

Also offer to install the helper scripts into the current project so next time is frictionless:

> "I ran the worktree creation manually this time. Want me to install `scripts/worktree-add.sh` + `scripts/worktree-remove.sh` from the halli-workflows scaffold at `references/worktree-scaffold/`? It's a one-time copy so future `/worktree` calls are a single-script invocation."

## List existing worktrees

```bash
! git worktree list
```

or if the project has the helper:

```bash
! scripts/worktree-remove.sh --list
```

## Remove a worktree

If the project has the helper (safety-checked):

```bash
! scripts/worktree-remove.sh <worktree-dir-name>
```

Otherwise:

```bash
! git worktree remove <worktree-path>
```

The scripted version refuses to remove a worktree with uncommitted work, untracked files (except `.env.local`), or unmerged commits, unless `--force` is passed.

## Completion

- [ ] Worktree created and git worktree list confirms it
- [ ] .env.local files copied (or documented manually)
- [ ] npm install completed (or skipped with --no-install)
- [ ] Next-steps instructions printed to user (cd + claude)
