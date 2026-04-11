---
name: project-bootstrap
description: Templates and patterns for project skeleton generation — CLAUDE.md structure, doc templates, directory conventions. Used by project-bootstrapper agent during /kickoff.
---

# Project Bootstrap Guide

## CLAUDE.md Structure

The CLAUDE.md is the **engineering bible** — the single source of truth for how the project works. It must be:
- **Concise** — not overloaded. Domain details go in subdirectory CLAUDE.md files.
- **Actionable** — rules with rationale, not just descriptions
- **Maintained** — Current State section updated as work progresses

### Sections (in order)

1. **Session Start** — What to do every session (read this, check roadmap, check git log)
2. **Context Router** — Table mapping work domains to CLAUDE.md files
3. **Project Overview** — What this project is, who it's for, tech stack
4. **Current State** — What's done, what's in progress, what's next
5. **Critical Rules** — Numbered, NON-NEGOTIABLE rules with rationale
6. **Anti-Patterns** — Things to NEVER do with explanation of why
7. **Coding Standards** — TypeScript, file naming, database conventions
8. **Git & Build Rules** — Branch naming, commit style, build cost optimization
9. **Locked Decisions** — ADR reference table
10. **Key Documents** — Table of all important docs with paths

### Key Principles

- **Keep CLAUDE.md under 300 lines** — Use Context Router to offload domain details
- **Rules say WHY** — Not just "don't do X" but "don't do X because Y happens"
- **Anti-patterns are specific** — Include the wrong code AND the right code
- **Update Current State** — After every significant change

## Doc Sync Rules (NON-NEGOTIABLE)

These rules must be baked into EVERY CLAUDE.md:

> When ANY work completes, update ALL of these:
> - `docs/plans/product-roadmap.md` — check off completed items
> - `docs/plans/backlog.md` — mark resolved items as DONE (date)
> - `docs/plans/tasks/TXXX-*.md` — check off completed steps
> - CLAUDE.md — update Current State if significant change
>
> **Rule: Never close a session with unmarked completed work.**

## Pre-Merge Testing Rule

> Before pushing to main:
> 1. Append new section to `docs/plans/build-testing.md`
> 2. Include: description, setup steps, manual testing checklist, notes
> 3. Commit the updated testing doc as part of the branch

## Reference Templates

See the `references/` directory for fill-in-the-blank templates:
- `claude-md-template.md` — CLAUDE.md skeleton (includes Rule 14 drift-gate rule)
- `roadmap-template.md` — Product roadmap
- `backlog-template.md` — Backlog
- `build-testing-template.md` — Build testing checklist
- `infrastructure-template.md` — Infrastructure doc
- `drift-gate-scaffold/` — complete drift-gate installation (see below)

---

## Deployment Integrity Gate Scaffold (MANDATORY for DB-backed projects)

**When to install**: ANY new project whose stack includes a managed database (Supabase, Neon, Railway Postgres, PlanetScale, etc.). If the project has no database, skip — but document WHY in the CLAUDE.md.

**Why it's mandatory**: The #1 silent-failure mode in Claude-assisted development is "Claude says 'I've run the migration' and it hasn't." This gate makes that class of bug impossible. Three production incidents on 2026-04-11 (Aurora Hunter + GuestPad) triggered its creation.

### Files to install

Copy from `references/drift-gate-scaffold/` into the new project root, renaming `dot-github` → `.github` and `dot-githooks` → `.githooks`:

```
scripts/drift-check.ts               — the actual drift detection script (TypeScript)
scripts/drift-check.allowlist.json   — empty allowlist with default project entry
scripts/setup-drift-role.sql         — idempotent SQL to create drift_reader role
.github/workflows/drift-check.yml    — CI workflow (push/PR/daily/manual)
.githooks/pre-push                   — git pre-push hook (blocks on drift)
docs/drift-gate.md                   — full runbook for onboarding + troubleshooting
```

### package.json additions

The new project's `package.json` MUST include:

```jsonc
{
  "scripts": {
    "drift": "tsx scripts/drift-check.ts",
    "drift:verbose": "tsx scripts/drift-check.ts --verbose",
    "drift:json": "tsx scripts/drift-check.ts --json",
    "postinstall": "git config core.hooksPath .githooks 2>/dev/null || true"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/pg": "^8.11.10",
    "pg": "^8.13.1",
    "tsx": "^4.21.0"
  }
}
```

Make `.githooks/pre-push` executable: `chmod +x .githooks/pre-push`.

### PROJECTS array customization

The template `drift-check.ts` has a placeholder `PROJECTS` entry with `name: "default"`. The project-bootstrapper agent MUST customize this to match the actual project:

- For a single-database project: rename `default` to the project's actual name.
- For a monorepo with multiple Supabase projects: add one entry per `apps/<project>/supabase/migrations` directory.

The env var name should follow the pattern `DRIFT_DB_URL_<UPPER_SNAKE_CASE_PROJECT>`.

### drift_reader role setup (manual — document clearly in onboarding)

The drift_reader Postgres role MUST be created AT KICKOFF TIME, not "later":

1. As part of `/kickoff` output, print the exact commands the user needs to run:
   ```
   DRIFT_PW=$(openssl rand -hex 32)
   psql "$DATABASE_URL" --single-transaction -v pw="'$DRIFT_PW'" -f scripts/setup-drift-role.sql
   ```
2. Tell the user to build the connection string and add to `.env.local`:
   ```
   DRIFT_DB_URL_<PROJECT>=postgresql://drift_reader.<project_ref>:$DRIFT_PW@aws-<region>.pooler.supabase.com:5432/postgres
   ```
3. Tell the user to add the same connection string to GitHub Actions secrets (`Settings → Secrets → Actions → New repository secret`).
4. Tell the user to run `npm run drift` to verify setup.

### CLAUDE.md Rule 14

The `claude-md-template.md` already includes Rule 14 (Deployment Integrity Gate) as a NON-NEGOTIABLE rule. When generating a new CLAUDE.md for a DB-backed project, this rule stays in. For a project with NO database, the agent may remove it and note "no managed database — drift gate not applicable".

### Checkpoint for /kickoff

During project skeleton generation, the project-bootstrapper agent should ask:

> "Does this project use a managed database (Supabase, Neon, PlanetScale, etc.)? If yes, I'll install the deployment integrity gate automatically — this is the defense against 'I ran the migration' verbal promises that don't match production. If no, I'll skip it and note in CLAUDE.md."

Default: YES unless the user explicitly says no.
- `infrastructure-template.md` — Infrastructure doc
