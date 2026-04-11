# {{PROJECT_NAME}} — Engineering Bible

> Supreme rules + context routing. Domain-specific patterns live in directory-level CLAUDE.md files.

## Session Start

1. **Read this file** — always loaded, contains rules that must never be violated
2. **Read `docs/plans/product-roadmap.md`** — find the first unchecked item
3. **Check `git log --oneline -20`** — see what was done recently
4. **Follow the Context Router below** — read domain-specific context for your task

## Context Router (MANDATORY)

| Working on... | Read before starting |
|---------------|---------------------|
| {{DOMAIN_1}} | `{{CLAUDE_MD_PATH_1}}` |
| {{DOMAIN_2}} | `{{CLAUDE_MD_PATH_2}}` |
| Planning / roadmap | `docs/plans/CLAUDE.md` |

## Project Overview

{{PROJECT_DESCRIPTION}}

- **Target users**: {{TARGET_USERS}}
- **Revenue model**: {{REVENUE_MODEL}}
- **Stack**: {{STACK_DESCRIPTION}}
- **Ambition**: {{AMBITION_TIER}} (MVP / Production / Enterprise)

### Current State

**Working**: (updated as work progresses)

**Completed**: (phases/features marked done)

**Next up**: (what to work on next)

---

## Critical Rules

### Rule 1: {{RULE_1_TITLE}}
{{RULE_1_DESCRIPTION}}

### Rule 2: {{RULE_2_TITLE}}
{{RULE_2_DESCRIPTION}}

### Rule 14: Deployment Integrity Gate (NON-NEGOTIABLE — include if project has a database)

> **Committing a migration file is not the same as applying it. Claude's word is not the same as the production state.**
> This rule exists because schema drift — where a migration is committed to the repo but never (or only partially) applied to production — is the single most common silent-failure class in Claude-assisted development. Discovered in 3 separate production incidents on 2026-04-11 (Aurora Hunter + GuestPad). Never trust "I ran it" without the gate's exit 0 confirmation.

**Before marking ANY task or roadmap item complete** that touches migrations, edge functions, deployments, env vars, or cron schedules, Claude MUST:

1. Run `npm run drift` from the project root
2. Verify the exit code is 0 (printed as `✓ All projects clean`)
3. Paste the drift output (or its exit code confirmation) into the session before marking the roadmap item `[x]`

**Marking a task `[x]` while drift is red is a Rule 13 violation.** If drift reports a mismatch you believe unrelated to your task, surface it to the user — do not hide it.

**The gate runs automatically in three places:**
- **Pre-push hook** (`.githooks/pre-push`) — blocks `git push` on drift. Activated via `npm install` postinstall (`git config core.hooksPath .githooks`).
- **GitHub Actions** (`.github/workflows/drift-check.yml`) — runs on every push to `main`, every PR touching migrations, and daily at 07:00 UTC. Opens a GitHub issue on scheduled failure.
- **Manual** — `npm run drift` / `npm run drift:verbose` / `npm run drift:json`

**Onboarding a new managed-database project**: see `docs/drift-gate.md`. Creating the `drift_reader` role is 5 minutes of SQL. Adding the project to `scripts/drift-check.ts` `PROJECTS` array is 10 lines.

---

## Anti-Patterns (NEVER DO THESE)

- **{{ANTI_PATTERN_1}}** -> {{WHY_AND_WHAT_INSTEAD}}
- **{{ANTI_PATTERN_2}}** -> {{WHY_AND_WHAT_INSTEAD}}

---

## Coding Standards

### TypeScript
- Strict mode, no `any`, no `@ts-ignore`
- Zod for runtime validation at API boundaries
- Prefer `interface` over `type` for object shapes

### File Naming
- Components: PascalCase (`Button.tsx`)
- Utilities/hooks: camelCase (`useAuth.ts`)
- Pages/routes: lowercase with hyphens

### Database
- Table/column names: `snake_case`
- TypeScript models: `camelCase`
- Always `created_at` and `updated_at` timestamps

### Git
- Branch: `feature/TXXX-short-description`
- Commits: concise, imperative mood
- One logical change per commit
- Never commit secrets

### Multi-session workflow (use git worktree for concurrent Claude Code sessions)

When running **multiple Claude Code terminals on this repo at the same time**, use `git worktree` — NOT multiple terminal tabs in the same directory. Git branches are per-working-directory, not per-terminal, so `git checkout` in one tab silently switches HEAD in every other tab pointing at the same working directory. A Claude session in tab A can commit to the wrong branch because tab B switched HEAD.

**To start a new concurrent session on a different branch:**

```bash
scripts/worktree-add.sh feature/T-your-thing
# Open a new terminal, cd into the printed path, run `claude`
```

The script creates a new worktree at `../{{PROJECT_NAME}}-T-your-thing` with:
- Its own isolated branch checkout (git enforces that the same branch cannot be checked out in two worktrees at once)
- Copies of all `.env.local` files (untracked, would NOT be in a vanilla worktree)
- Its own `node_modules` (fresh `npm install`)

**Flags:** `--base=<branch>` (base from elsewhere), `--move` (also move uncommitted changes), `--no-install` (skip npm install).

**When done:** `scripts/worktree-remove.sh <worktree-dir>` — refuses to remove if there's uncommitted work or unmerged commits, unless `--force`.

**List active worktrees:** `scripts/worktree-remove.sh --list` or `git worktree list`.

---

## Keeping Docs In Sync (NON-NEGOTIABLE)

When ANY work completes, update ALL of these:
- **`docs/plans/product-roadmap.md`** — check off completed items
- **`docs/plans/backlog.md`** — mark resolved items as `DONE (date)`
- **`docs/plans/tasks/TXXX-*.md`** — check off completed steps
- **This file (`CLAUDE.md`)** — update "Current State" if significant

**Rule: Never close a session with unmarked completed work.**

---

## Key Documents

| Document | Path |
|----------|------|
| Master Roadmap | `docs/plans/product-roadmap.md` |
| Backlog | `docs/plans/backlog.md` |
| Build Testing | `docs/plans/build-testing.md` |
| Infrastructure | `docs/infrastructure.md` |
| PRD | `docs/prd/{{PROJECT_NAME}}-prd.md` |
| **Drift Gate Runbook** | `docs/drift-gate.md` (if database) |
