---
name: supabase-rls-performance
description: Canonical pattern for writing performant Supabase Row Level Security policies. Read whenever working on a Supabase-backed project — when writing or reviewing migrations that create/alter RLS policies, when /kickoff scaffolds CLAUDE.md for a Supabase stack, when /audit or /maintain inspects DB performance, or when triaging a Supabase performance-advisor finding labelled `auth_rls_initplan`. Defines the wrapping rule, sweep-migration template, and the self-check grep.
---

# Supabase RLS Performance

> Every Supabase project the halli-workflows plugin manages should bake this
> rule into its CLAUDE.md from day one. We've observed it as a silent linear
> slowdown in multiple production projects — each one had 60+ policies
> regressing the same way before the audit caught it. Without this rule the
> next migration always re-introduces the bug.

## The pitfall — `auth_rls_initplan`

Supabase's performance advisor flags RLS policies that call `auth.uid()`,
`auth.role()`, `auth.jwt()`, or `auth.email()` **directly** inside `USING`,
`WITH CHECK`, or any subquery they reach. The bare form is treated as
**VOLATILE** by Postgres — the function is re-evaluated for every row the
predicate touches. A query that scans 10,000 rows fires 10,000 auth-helper
calls.

Wrapping the call in a scalar subquery `(SELECT auth.<fn>())` flips the
plan: Postgres recognises the constant-folded expression as an **InitPlan**,
computes it once at query start, and re-uses the cached value as a constant
for every row predicate.

Same query → same answer → orders of magnitude fewer function calls. It is
purely a planner hint; the policy semantics are unchanged.

Reference: <https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select>

## The rule (paste into the project's CLAUDE.md)

```markdown
### Rule N: RLS auth calls must be wrapped in `(SELECT ...)` (NON-NEGOTIABLE)

> `auth.uid()` is volatile — Postgres re-evaluates it per row.
> `(SELECT auth.uid())` is an initplan — evaluated once per query. Supabase's
> performance advisor flags the bare form as `auth_rls_initplan`. On a query
> that returns 10k rows the bare form fires 10k auth calls; the wrapped form
> fires 1.

Every `auth.uid()`, `auth.role()`, `auth.jwt()`, and `auth.email()` reference
inside an RLS policy (USING, WITH CHECK, or in any subquery they call) MUST
be wrapped in a scalar subquery `(SELECT auth.<fn>())`.

**Wrong** (per-row volatile, flagged by `auth_rls_initplan`):
\`\`\`sql
CREATE POLICY "owners_read"
  ON properties FOR SELECT
  USING (
    owner_id IN (SELECT id FROM owners WHERE supabase_auth_id = auth.uid()::text)
  );
\`\`\`

**Right** (initplan, one call per query):
\`\`\`sql
CREATE POLICY "owners_read"
  ON properties FOR SELECT
  USING (
    owner_id IN (SELECT id FROM owners WHERE supabase_auth_id = (SELECT auth.uid())::text)
  );
\`\`\`

Applies equally to `auth.role()` / `auth.jwt()` / `auth.email()` and any
`auth.jwt() ->> 'claim'` extractions. Does NOT apply to direct callers in API
routes / Server Components (those run once per request) or inside
`CREATE FUNCTION` bodies (function body runs once per call).

**Self-check before any RLS migration commit**:
1. Run the grep below — every match must be inside `(SELECT ...)`:
   \`\`\`bash
   grep -E "auth\\.(uid|role|jwt|email)\\(\\)" supabase/migrations/NNN_*.sql
   \`\`\`
2. After applying, sanity-check one previously-flagged query with
   `EXPLAIN ANALYZE` — plan should show `InitPlan 1 (...)` near the top,
   not a Function Scan per row.

Reference: <https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select>
```

Also add the anti-pattern bullet under the project's "Anti-Patterns" /
"Never do these" section:

```markdown
- **Bare `auth.uid()` / `auth.role()` / `auth.jwt()` in RLS** → Wrap as
  `(SELECT auth.uid())`. See Rule N.
```

And one bullet under the Database coding-standards section:

```markdown
- **`auth.uid()` / `auth.role()` / `auth.jwt()` in RLS policies MUST be
  wrapped in `(SELECT ...)`** — see Rule N. Bare form is a per-row volatile
  call (slow at scale).
```

## Auditing an existing project

Three-step flow when adopting this rule on a project that already has many
policies:

### Step 1 — Count the offending occurrences

```bash
grep -rEn 'auth\.(uid|role|jwt|email)\(\)' supabase/migrations/ 2>/dev/null \
  | grep -v 'select auth\.' | grep -v 'SELECT auth\.' \
  | wc -l
```

Anything > 0 is a sweep candidate. Report the number to the user **before**
writing the sweep migration so they can sanity-check the blast radius
(small project: 5–10; medium: 30–60; large project we missed: 100+).

### Step 2 — Identify the affected policies

```sql
SELECT schemaname, tablename, policyname,
       cmd, qual, with_check
FROM pg_policies
WHERE qual ~ 'auth\.(uid|role|jwt|email)\(\)'
   OR with_check ~ 'auth\.(uid|role|jwt|email)\(\)';
```

Filter out any matches that already wrap the call in `(select auth.…)` — the
regex above catches both wrapped and unwrapped forms; eyeball each row.

### Step 3 — One sweeping migration

The fix is policy-DDL only — no data changes, no downtime. Drop and recreate
each affected policy with the wrapped form in one migration:

```sql
-- supabase/migrations/NNN_rls_initplan_sweep.sql
-- Wraps every bare auth.uid() / auth.role() / auth.jwt() / auth.email() call
-- in policies <list-the-policies-here> inside (SELECT ...) so the Postgres
-- planner treats it as an InitPlan instead of a per-row volatile call.
-- Supabase performance-advisor finding: auth_rls_initplan.
-- See: <halli-workflows skill: supabase-rls-performance>

BEGIN;

-- ── table: <tablename> ────────────────────────────────────────────────
DROP POLICY IF EXISTS "<policyname>" ON <tablename>;
CREATE POLICY "<policyname>"
  ON <tablename>
  FOR <cmd>
  USING (<wrapped qual>)
  WITH CHECK (<wrapped with_check>);
-- ── repeat for every policy in the audit ──────────────────────────────

COMMIT;
```

Apply via the project's standard ritual (`psql "$DATABASE_URL" -f …`
per CLAUDE.md Rule 1) and re-run the grep + the drift gate.

### Step 4 — Verify the planner agrees

Pick one previously-flagged predicate and run `EXPLAIN ANALYZE`. The output
must show `InitPlan 1 (returns $0)` near the top of the plan. If you still
see `Filter: (auth.uid() = ...)` with no InitPlan line, the wrap didn't take
— the policy was recreated wrong or there's a SECURITY DEFINER function
hiding another bare call. Investigate before declaring victory.

## When NOT to wrap

The wrap is harmless but only useful inside RLS policy bodies. Don't blanket
it everywhere:

- **API routes / Server Components / hooks** — the auth helpers run once per
  request. No per-row concern.
- **`CREATE FUNCTION` bodies** — when the function is called, the body runs
  once. (RLS policies are not function bodies.)
- **Cron jobs / service-role contexts** — service-role calls bypass RLS
  entirely (`createServiceClient()`).
- **`SELECT auth.uid()` already wrapped** — re-wrapping (`(SELECT (SELECT auth.uid()))`)
  is legal but pointless.

## How to enforce going forward

The rule belongs in CLAUDE.md (so every new agent session sees it) and in
this skill (so it propagates to new projects via `/kickoff`). The grep
self-check is the cheapest enforcement gate available — it catches the
mistake before commit, without needing a custom hook.

Optional: a project-side pre-commit hook that runs the grep against any
`supabase/migrations/*.sql` files in the staged diff and blocks the commit
if it finds a bare call. The halli-workflows code-debt registry approach
(see `code-debt-registry` skill) is the right pattern to follow.
