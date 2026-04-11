---
name: drift
description: Run the DB schema drift check for the current project. Compares committed Supabase migration files against actual production state. Catches "I ran the migration" verbal promises that don't match reality.
---

**Command Context**: Ad-hoc invocation of the Deployment Integrity Gate.

## Purpose

Detect schema drift between committed migration files and actual production state for any Supabase projects configured in `scripts/drift-check.ts` `PROJECTS` array.

This is the MANUAL way to run the gate. It ALSO runs automatically via:
- `.githooks/pre-push` — blocks pushes on drift
- `.github/workflows/drift-check.yml` — on push, PR, and daily schedule

Use `/drift` when:
- You've just run a migration manually and want to confirm it landed
- Before marking a schema-touching roadmap item complete (CLAUDE.md Rule 14)
- You suspect production is out of sync with the repo
- As a health check during /maintain or after a /review

## Execution

### Default: full check

```bash
! npm run drift
```

Exit 0 → all projects clean. Exit 1 → drift detected. Exit 2 → config error.

### Verbose: see expected vs actual counts per project

```bash
! npm run drift:verbose
```

Useful when the parser has been updated or when onboarding a new project.

### One project only

```bash
! npm run drift -- --project=$ARGUMENTS
```

### Machine-readable

```bash
! npm run drift:json
```

## What to do with the results

### Exit 0 (clean)

Paste the output into the session. If this run was to satisfy CLAUDE.md Rule 14 before marking a roadmap item `[x]`, you're cleared.

### Exit 1 (drift detected)

STOP. Do not mark any schema-touching task complete. Investigate each missing item:

1. **Is it a migration that was never applied?**
   - Find the migration file: `grep -l "CREATE TABLE <name>" <project>/supabase/migrations/*.sql`
   - Apply it: `psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f <migration>.sql`
   - Re-run `/drift` to confirm clean

2. **Is it a known false positive** (e.g., a table renamed in a later migration that the parser can't track)?
   - Verify the artifact exists in prod under a different name or location
   - Add to `scripts/drift-check.allowlist.json` with a `notes` entry explaining WHY

3. **Can't explain it?**
   - Surface to the user immediately. Don't add to the allowlist without understanding.

### Exit 2 (config error)

Usually means a `DRIFT_DB_URL_<PROJECT>` env var is missing. Check `.env.local` at the project root. For CI runs, check GitHub Actions secrets (`Settings → Secrets → Actions`).

See `docs/drift-gate.md` for full runbook + troubleshooting.

## Setup (first time, per project)

If `/drift` has never been run on this project, you need to set up the `drift_reader` Postgres role first:

```bash
! DRIFT_PW=$(openssl rand -hex 32)
! psql "$DATABASE_URL" --single-transaction -v pw="'$DRIFT_PW'" -f scripts/setup-drift-role.sql
! echo "Connection string: postgresql://drift_reader.<ref>:$DRIFT_PW@aws-<region>.pooler.supabase.com:5432/postgres"
```

Then add the connection string to `.env.local` as `DRIFT_DB_URL_<PROJECT>` AND to GitHub Actions secrets.

Full setup: `docs/drift-gate.md` → "Onboarding a new Supabase project"
