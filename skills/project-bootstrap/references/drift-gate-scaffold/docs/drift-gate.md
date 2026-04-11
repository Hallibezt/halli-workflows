# Deployment Integrity Gate — Runbook

**Status:** Active, Phase 1 (DB schema drift only)
**Last updated:** {{DATE}}

## What this is

A read-only gate that compares committed Supabase migration files against actual production schema state. Refuses to let you declare work done — via local `npm run drift`, pre-push hook, or GitHub Actions CI — when they don't match.

**Why it exists:** "Committing a migration file is not the same as applying it." The halli-workflows Deployment Integrity Gate is installed on every project that has a managed database because this class of bug (schema drift) is the single most common silent-failure mode in Claude-assisted development.

See also: CLAUDE.md Rule 14 — the mandatory-run rule this gate enforces.

---

## How it works

`scripts/drift-check.ts` (TypeScript, run via `tsx`):

1. **Parse** every `.sql` file under the configured migrations directory and extract declared artifacts:
   - `CREATE TABLE [IF NOT EXISTS] name`
   - `ALTER TABLE t ADD COLUMN [IF NOT EXISTS] c` (multi-line aware)
   - `CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON …`
   - `CREATE [OR REPLACE] FUNCTION name(…`
   - `ADD CONSTRAINT name CHECK (col IN ('a','b'))` — captures the string-literal value set
2. **Strip** SQL comments (`--` and `/* */`) and PL/pgSQL function bodies (`$TAG$ ... $TAG$`) so DDL that only appears as format strings inside functions doesn't get counted.
3. **Apply** `scripts/drift-check.allowlist.json` to remove known false positives.
4. **Connect** to each Supabase project via a dedicated `drift_reader` Postgres role (read-only, `pg_read_all_data`). Connection string from `DRIFT_DB_URL_<PROJECT>` env var.
5. **Query** `pg_tables` / `information_schema.columns` / `pg_indexes` / `pg_proc` / `pg_constraint` for actual state.
6. **Diff** expected vs actual. Any missing item = drift.
7. **Exit** 0 (clean), 1 (drift detected), or 2 (config error).

---

## Usage

```bash
# Check all configured projects
npm run drift

# Check one project only
npm run drift -- --project=<name>

# Verbose: dump expected vs actual counts before comparing
npm run drift:verbose

# Machine-readable output (for CI consumption)
npm run drift:json
```

### Environment variables

In `.env.local` at the project root (gitignored):

```
DRIFT_DB_URL_<PROJECT>=postgresql://drift_reader.<project_ref>:<password>@aws-<region>.pooler.supabase.com:5432/postgres
```

The drift script auto-loads `.env.local` on startup.

---

## Where the gate runs

### 1. Locally (manual)

Run `npm run drift` whenever you finish a migration task. Required by CLAUDE.md Rule 14 before marking any schema-touching roadmap item `[x]`.

### 2. Pre-push hook

`.githooks/pre-push` runs automatically on every `git push`. Activated by `npm install` postinstall (`git config core.hooksPath .githooks`).

**Bypass** with `git push --no-verify` — emergency only. Document the justification in the commit message.

### 3. GitHub Actions

`.github/workflows/drift-check.yml` runs on:
- **push** to `main` — post-merge safety net
- **pull_request** to `main` touching migrations or the drift script
- **schedule** daily at 07:00 UTC — catches out-of-band drift
- **workflow_dispatch** — manual trigger

On scheduled failure, opens a GitHub issue labeled `db-drift` with the drift report, deduped to 1 per 24h.

**Secrets required** in repo settings (`Settings → Secrets and variables → Actions`):
- `DRIFT_DB_URL_<PROJECT>` — one per Supabase project

---

## Onboarding a new Supabase project

Takes ~10 minutes.

### Step 1 — Create the read-only role

Run `scripts/setup-drift-role.sql` as the `postgres` superuser:

```bash
DRIFT_PW=$(openssl rand -hex 32)
psql "$DATABASE_URL" --single-transaction -v pw="'$DRIFT_PW'" -f scripts/setup-drift-role.sql
```

### Step 2 — Test the connection

```bash
psql "postgresql://drift_reader.<project_ref>:<pw>@aws-<region>.pooler.supabase.com:5432/postgres" -c "SELECT current_user;"
```

### Step 3 — Store the connection string

- Add to `.env.local` as `DRIFT_DB_URL_<PROJECT>=postgresql://...`
- Add the same to GitHub Actions secrets (`Settings → Secrets → Actions`)

### Step 4 — Register the project

Add an entry to the `PROJECTS` array in `scripts/drift-check.ts`:

```typescript
const PROJECTS: Project[] = [
  // ...existing...
  {
    name: "myproject",
    migrationsDir: path.join(REPO_ROOT, "supabase/migrations"),
    envVar: "DRIFT_DB_URL_MYPROJECT",
  },
];
```

### Step 5 — Register the secret in CI

Edit `.github/workflows/drift-check.yml` and add the new env var to both `env:` blocks.

### Step 6 — Verify

`npm run drift:verbose` — the new project should report CLEAN alongside existing ones.

---

## Password rotation

Every 90 days, re-run `scripts/setup-drift-role.sql` with a fresh password, update `.env.local` and the GitHub secret.

---

## Adding a known false positive

Sometimes the parser flags drift that isn't real (e.g., table renamed by a later migration — the parser doesn't track `ALTER TABLE ... RENAME TO`). Add to `scripts/drift-check.allowlist.json`:

```json
{
  "myproject": {
    "columns": ["oldtable.oldcol"],
    "notes": {
      "oldtable.oldcol": "Renamed to newtable.newcol by migration NNN. The parser doesn't track RENAME TO."
    }
  }
}
```

**Always include a `notes` entry.** The allowlist is a decision record, not a dumping ground.

---

## When drift is detected

### Scenario A — Missing table / column / index / function

Almost always means the migration file was added to the repo but never applied to production.

1. Identify the file: `grep -l "CREATE TABLE <name>" supabase/migrations/*.sql`
2. Apply it:
   ```bash
   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
   ```
3. Re-run `npm run drift` to confirm clean.

### Scenario B — CHECK constraint mismatch

A later migration `DROP`s and re-`ADD`s a CHECK constraint with an expanded value set, but that migration was never applied.

Fix: apply the migration that contains the expanded CHECK.

### Scenario C — False positive you don't understand

Don't add to the allowlist without first verifying the artifact actually exists in prod under a different name or location. If you can't explain it, ask for help.

---

## v2 roadmap (known blind spots)

- **Initial-column parsing** — parser only tracks `ALTER TABLE ADD COLUMN`, not columns inside initial `CREATE TABLE (col1, col2)`.
- **`ALTER TABLE RENAME TO` tracking** — would remove most false positives.
- **`CREATE POLICY` / RLS body comparison**
- **`CREATE TRIGGER` body comparison**
- **Deploy-head drift** — verify Vercel/Railway/Expo deployed commit SHA matches main
- **Env var drift** — requires a committed `env.manifest.ts` per app

---

## References

- Root CLAUDE.md Rule 14 — the mandatory-run rule
- Supabase built-in roles: https://supabase.com/docs/guides/auth/row-level-security#authenticated-role
- Postgres `pg_read_all_data`: https://www.postgresql.org/docs/current/predefined-roles.html
