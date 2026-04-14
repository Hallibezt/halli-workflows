# Finding — Canonical Schema

> Single source of truth for the JSON shape every pilot-review reviewer agent emits.
> Derived from `docs/design/pilot-review-system-design.md` §5. Any change here is a
> plugin contract change — bump the plugin version.

## Shape

Every finding is a single JSON object with exactly these 10 fields. No extras, no omissions.

```json
{
  "agent": "isolation-reviewer",
  "severity": "P0",
  "rule_link": "CLAUDE.md#rule-0-the-isolation-hierarchy-supreme-rule",
  "verdict": "fail",
  "evidence": "apps/guestpad/supabase/migrations/058_foo.sql:12 — new table `bar` lacks RLS policy",
  "location_key": "db:bar:rls_missing",
  "heuristic_id": "iso.rls.missing",
  "suggested_fix": "Add `CREATE POLICY property_isolation ON bar FOR SELECT USING (property_id = current_setting('request.jwt.claim.property_id')::uuid);`",
  "screenshot": null,
  "witnesses": ["isolation-reviewer"]
}
```

## Field table

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | `string` | yes | Agent name — kebab-case, e.g. `isolation-reviewer`, `auth-boundary-reviewer`, `privacy-gdpr-reviewer`, `payment-reviewer`, `freshness-reviewer`, `monitoring-reviewer`, `codebase-auditor`, `drift-gate`, `orchestrator` |
| `severity` | `Severity` enum | yes | One of `"P0" \| "P1" \| "P2" \| "P3"` — see §Severity below |
| `rule_link` | `string` | yes | Path to a rubric line or CLAUDE.md section. MUST resolve to a real heading slug on the target file. Example: `"CLAUDE.md#rule-2-three-tier-authentication-non-negotiable"` or `"docs/review-rubrics/privacy-gdpr.md#h2-pii-in-logs"` |
| `verdict` | `Verdict` enum | yes | One of `"fail" \| "warn" \| "info" \| "uncertain"` — the agent's assessment of this finding |
| `evidence` | `string` | yes | Human-readable location + description, enough for a reviewer to verify without re-running the agent. Format: `"<file>:<line> — <what was seen>"` when possible |
| `location_key` | `string` | yes | Stable idempotency key. See `halli-workflows:types/location-key.md` for the grammar per finding type |
| `heuristic_id` | `string` | yes | Dotted ID matching the agent's rubric heuristic entry (e.g. `iso.rls.missing`, `auth.getUser_missing`, `gdpr.consent_missing`). Reserved value: `RUBRIC_MISSING` for orchestrator-level rubric gaps |
| `suggested_fix` | `string` | yes | Copy-pasteable fix or remediation guidance. May be the literal string `"(none — manual triage required)"` for findings where no mechanical fix is possible |
| `screenshot` | `string \| null` | yes | Path to an artifact screenshot (Phase 2 UX reviewers only) or `null`. Field is required but value may be `null` |
| `witnesses` | `string[]` | yes | Every reviewer agent that independently flagged this `location_key`. Initially `[agent]` at creation; grows during dedup (see §8 of design doc). Length ≥ 1 |

## Severity — `"P0" | "P1" | "P2" | "P3"`

Ordering (highest first): `P0 > P1 > P2 > P3`.

| Tier | Meaning | Destination |
|------|---------|-------------|
| `P0` | Blocker — business-ending if shipped | eljun auto-filed, `priority: critical, type: bug, status: todo`. Pilot blocked until resolved |
| `P1` | Must-fix-before-pilot — rule violation or known-bad pattern | eljun auto-filed, `priority: high, type: bug, status: todo` |
| `P2` | Post-pilot — polish, medium-severity issues, dead code | Appended to `docs/plans/backlog.md` under a run-dated header. NOT filed to eljun |
| `P3` | Notes — reviewer uncertainty, low-signal observations, rubric-gap signals | Aggregated into `docs/preflight/run-*/review-notes.md`. Not actionable |

### `severityMax(a, b)` — comparator

The orchestrator needs a max operator across witnesses during dedup.

```
severityMax(a, b)  returns the HIGHER-PRIORITY severity
  ordering: P0 > P1 > P2 > P3
  severityMax("P1", "P0")  →  "P0"
  severityMax("P2", "P3")  →  "P2"
  severityMax("P1", "P1")  →  "P1"
  severityMax("P3", "P0")  →  "P0"
```

Reference implementation (TypeScript — to be implemented by the orchestrator):

```ts
const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

function severityMax(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}
```

Lower rank number = higher priority. `P0` has rank 0 and wins.

### Escalation rules (from design §6)

- **Multi-witness**: severity = `severityMax` across all witnesses for the same `location_key`.
- **`/verify-claims` refutation**: if the post-pass cannot verify evidence against the source,
  the finding is demoted one tier (`P0→P1`, `P1→P2`, `P2→P3`) and `evidence` is annotated
  with the refutation. Findings are NEVER silently deleted.
- **Hard-coded ceiling**: `drift-gate` findings and `orchestrator` `RUBRIC_MISSING` findings
  are always `P0` and CANNOT be demoted.

## Verdict — `"fail" | "warn" | "info" | "uncertain"`

Per-agent per-finding judgment. Distinct from severity.

- `fail` — the check failed; rubric violated
- `warn` — the check raised a concern but is not a clear violation
- `info` — informational observation; not a violation
- `uncertain` — the agent could not decide. Automatically `P3` unless `/verify-claims` upgrades it by verifying evidence against source

## Verdict vs. severity

- `verdict` is what the **agent** produced.
- `severity` is what the **orchestrator** assigned after dedup and escalation.
- `verdict` does not get "merged" across witnesses — after dedup the canonical finding
  inherits `verdict: "fail"` (see dedup algorithm in design §8, line 737).

## Validation rules (orchestrator enforces these)

The orchestrator's Zod schema MUST enforce the following. Agents that emit invalid findings
are treated as malformed (the orchestrator logs a P3 `AGENT_OUTPUT_INVALID` finding and
drops the malformed entries).

1. All 10 fields present. Missing field = reject.
2. `agent` is a non-empty string, kebab-case (regex: `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`).
3. `severity` ∈ `{"P0", "P1", "P2", "P3"}` exactly. Case-sensitive. Reject `"p0"`, `"critical"`, etc.
4. `verdict` ∈ `{"fail", "warn", "info", "uncertain"}` exactly.
5. `rule_link` is a non-empty string. Anchor resolution (does the fragment exist in the target
   file?) is checked by the orchestrator as a POST-VALIDATION pass — findings with broken
   anchors are demoted one tier and annotated, NOT rejected.
6. `evidence` is a non-empty string, length ≥ 10 chars.
7. `location_key` is a non-empty string matching one of the 6 grammars in
   `halli-workflows:types/location-key.md`. Keys with embedded line numbers (any `:<digits>:`
   segment that looks like a line number) MUST be rejected — stability rule.
8. `heuristic_id` is a non-empty string. Dotted lowercase or `RUBRIC_MISSING` uppercase.
9. `suggested_fix` is a non-empty string.
10. `screenshot` is either `null` or a non-empty string path.
11. `witnesses` is a non-empty array of agent names (same format as `agent`). Array must
    contain `agent` itself (agent is always a witness of its own finding).

## Zod schema specification

The orchestrator implements this Zod schema in its TypeScript source. Reviewers do not
import Zod — they emit plain JSON and the orchestrator validates on aggregation.

```ts
import { z } from "zod";

const AgentName = z.string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "agent must be kebab-case");

export const Severity = z.enum(["P0", "P1", "P2", "P3"]);
export type Severity = z.infer<typeof Severity>;

export const Verdict = z.enum(["fail", "warn", "info", "uncertain"]);
export type Verdict = z.infer<typeof Verdict>;

export const FindingSchema = z.object({
  agent: AgentName,
  severity: Severity,
  rule_link: z.string().min(1),
  verdict: Verdict,
  evidence: z.string().min(10),
  location_key: z.string().min(1).refine(
    (k) => !/:[0-9]+(:|$)/.test(k),
    { message: "location_key must not contain line numbers" }
  ),
  heuristic_id: z.string().min(1),
  suggested_fix: z.string().min(1),
  screenshot: z.string().min(1).nullable(),
  witnesses: z.array(AgentName).min(1),
}).strict(); // reject unknown fields

export type Finding = z.infer<typeof FindingSchema>;
```

The `.strict()` modifier rejects findings with extra fields — this catches drift early
(if an agent invents a `confidence` or `probability` field, it will fail validation
instead of silently contaminating downstream consumers).

## Worked examples

### Single-witness code finding

```json
{
  "agent": "auth-boundary-reviewer",
  "severity": "P1",
  "rule_link": "CLAUDE.md#rule-2-three-tier-authentication-non-negotiable",
  "verdict": "fail",
  "evidence": "apps/guestpad/src/app/api/messages/route.ts:23 — POST handler does not call supabase.auth.getUser() before insert",
  "location_key": "code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.getUser_missing",
  "heuristic_id": "auth.getUser_missing",
  "suggested_fix": "Add `const { data: { user }, error } = await supabase.auth.getUser(); if (!user) return unauthorized();` before the insert.",
  "screenshot": null,
  "witnesses": ["auth-boundary-reviewer"]
}
```

### Multi-witness DB finding (after dedup)

`agent` is the primary (first-seen) reviewer. `witnesses` lists every reviewer agent that
independently flagged this `location_key`.

```json
{
  "agent": "isolation-reviewer",
  "severity": "P0",
  "rule_link": "CLAUDE.md#rule-0-the-isolation-hierarchy-supreme-rule",
  "verdict": "fail",
  "evidence": "apps/guestpad/supabase/migrations/058_foo.sql:12 — table `bar` lacks RLS policy AND is queried from anon-authenticated API route /api/bar/route.ts:18",
  "location_key": "db:bar:rls_missing",
  "heuristic_id": "iso.rls.missing",
  "suggested_fix": "(1) Add RLS policy to migration 059. (2) Fix /api/bar/route.ts to use owner-scoped Supabase client.",
  "screenshot": null,
  "witnesses": ["isolation-reviewer", "auth-boundary-reviewer"]
}
```

### Rubric-missing fail-loud

Emitted by the orchestrator itself when a required rubric file is absent. Always `P0`,
severity cannot be demoted.

```json
{
  "agent": "orchestrator",
  "severity": "P0",
  "rule_link": "docs/adr/ADR-0014-pilot-review-orchestration.md#rubric-as-file",
  "verdict": "fail",
  "evidence": "docs/review-rubrics/privacy-gdpr.md does not exist. privacy-gdpr-reviewer cannot run without its rubric.",
  "location_key": "rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing",
  "heuristic_id": "RUBRIC_MISSING",
  "suggested_fix": "Run `/pilot-review --scaffold-rubrics` or author the rubric manually using the template at halli-workflows:skills/documentation-criteria.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

## Agent prompt template (what reviewer authors should include)

Every reviewer agent prompt should include this block (or equivalent language):

> ## Output format
>
> Emit an array of Finding JSON objects. Each finding must match the canonical schema
> documented at `halli-workflows:types/finding.md`. The 10 required fields are:
> `agent`, `severity`, `rule_link`, `verdict`, `evidence`, `location_key`, `heuristic_id`,
> `suggested_fix`, `screenshot` (use `null` unless you have an artifact), `witnesses`
> (initially `[your-own-agent-name]`; the orchestrator grows this during dedup).
>
> Use the location_key grammar from `halli-workflows:types/location-key.md`.
> NEVER embed line numbers in location_key. NEVER use absolute paths.
> Do NOT compute preflight_hash — that is the orchestrator's responsibility.
>
> If you cannot emit evidence tied to a real file/line, emit `verdict: "uncertain"` and
> the orchestrator's `/verify-claims` pass will either confirm or demote it.

## Non-goals

- This document does NOT define the Zod *runtime object* — only the specification the
  orchestrator's Zod object must satisfy. The orchestrator lives in the consuming
  project (e.g. `.claude/commands/pilot-review.md` + TypeScript helpers in `cabin`).
- This document does NOT define the dedup algorithm. See design doc §8.
- This document does NOT define eljun footer format. See design doc §10.
- This document does NOT define `rubric_hash`. See design doc §9.
