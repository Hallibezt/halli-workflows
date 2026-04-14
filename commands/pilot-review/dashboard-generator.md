---
name: pilot-review/dashboard-generator
description: Orchestrator sub-module — renders the Markdown dashboard at docs/preflight/run-YYYY-MM-DD-HHMM.md after dedup, verify-claims, and anchor-validator post-passes. Also writes raw-findings.json sibling for debugging. Pure function over the aggregated Finding[] plus run metadata; no eljun I/O, no backlog append, no source mutation. Design Doc §11 template reproduced verbatim. Invoked at §12 step 9.
---

**Module Context**: Prompt-style specification for the `generateDashboard(input): DashboardOutput` consumer of the aggregated pipeline. Invoked by `halli-workflows:pilot-review-orchestrator` at step 9 of the orchestration flow (Design Doc §12 step 9a-9d). Consumes the post-sort `Finding[]` produced by T1216 (dedup) → T1217 (verify-claims) → T1218 (anchor-validator). Produces the single user-facing artifact of the whole pipeline: the dashboard Markdown file.

**Design Doc anchors**: §11 "Dashboard Format" (the literal template this module reproduces), §8 "Dedup and Multi-Witness Confidence" (the `[N witnesses]` annotation rule on multi-agent findings), §6 "Severity Taxonomy" (the P0/P1/P2/P3 buckets that form the sections), §12 step 9 (this module's placement in the flow), §10 (eljun footer rubric_hash — referenced from RUN METADATA, not populated here).

**Placement rationale**: Pure-markdown specification that the orchestrator's inlined implementation follows. The module is NOT an independently registered slash-command in `plugin.json` — it is wired by the orchestrator the same way `dedup.md`, `verify-claims-pass.md`, and `anchor-validator.md` are wired. No version bump in `plugin.json` at authoring time (T1219 cross-repo instructions explicit).

**Depends on (runtime)**: `halli-workflows:types/finding.md` (canonical Finding schema), `halli-workflows:pilot-review-orchestrator` (caller — owns the run metadata, timing, token counts, and eljun link table this module consumes).

**Runs AFTER**: `anchor-validator.md` (T1218). **Runs BEFORE**: `backlog-appender.md` (T1220), `review-notes.md` aggregator (T1221), eljun filing (T1222/T1223). The dashboard is written even if subsequent fan-out steps fail — the user gets the triage view first, then the eljun/backlog/review-notes sidecars when those complete.

> **Rule 13 note**: This module reproduces the Design Doc §11 template **verbatim**. Any deviation from the template headers, verdict-line format, or section ordering is a Rule 13 failure — it would silently change the user-visible format that reviewers are trained to read and would break dashboard diffs across runs. The §11 template is copied into §3 of this spec as the authoritative source; if §11 changes, this spec changes in the same commit. Do not infer template fields from other sibling modules; their scaffold stubs predate the final template shape.

---

## 1. Purpose

The dashboard is the **primary user-facing output** of `/pilot-review`. It is a Markdown file committed to git at `docs/preflight/run-YYYY-MM-DD-HHMM.md` so every run leaves a reviewable audit trail. A user opens the file in their editor (or GitHub preview), scrolls the BLOCKERS section first, confirms P0s are filed to eljun, optionally reviews P1s grouped by domain, and is done. Everything downstream of the dashboard (eljun filing, backlog append, P3 review-notes, per-agent artifacts) is a sidecar the user consults only when the dashboard line item motivates it.

A dashboard that diverges from the §11 template — renaming a header, moving a section, or dropping the verdict line — degrades the entire review flow because the user is scanning for predictable anchors. This module's job is to be boring and exact. It produces byte-stable output for a byte-stable input.

## 2. Contract

### Signature

```ts
export function generateDashboard(input: DashboardInput): DashboardOutput;
```

### Input

The orchestrator assembles and passes this object after `sorted = anchorChecked.sort(severityThenWitnessCount)` completes in §12 step 8f. All fields are required; missing fields are a caller bug.

```ts
interface DashboardInput {
  /** Final Finding[] post-dedup, post-verify-claims, post-anchor-validator, post-sort. */
  findings: Finding[];

  /** Pre-dedup Finding[] — raw emission from every reviewer. Used to write raw-findings.json. */
  rawFindings: Finding[];

  /** UTC run-start timestamp. Used for `runId` (YYYY-MM-DD-HHMM) and title. */
  runStartedAt: Date;

  /** UTC run-end timestamp (at the time this module is called). Used for "Run time" line. */
  runEndedAt: Date;

  /** Original flag string as received from the shim, e.g. "--app=guestpad" or "--app=guestpad --dry-run". */
  flagString: string;

  /** Parsed flags for behavior branching. */
  flags: {
    app: string;              // e.g. "guestpad" (for the "Target" line)
    dryRun: boolean;          // if true, eljun link column renders "(dry-run — no tasks filed)"
    force: boolean;           // surfaced in RUN METADATA
    concurrency: number;      // e.g. 5 — surfaced in RUN METADATA
    includeUx: boolean;       // Phase 2 reviewers — affects SKIPPED AGENTS line
  };

  /** Short git SHA, result of `git rev-parse --short HEAD` captured at run start. */
  commitSha: string;

  /** Semver string of the halli-workflows plugin at run time, read from plugin.json. */
  pluginVersion: string;

  /**
   * Squad state captured by the orchestrator's fan-out step:
   *   total: expected roster size (10 at Phase 1, or 8 when --include-ux is false per §3)
   *   ok: number of reviewers that ran to completion without REVIEWER_CRASHED
   *   reused: agents whose rubric was unchanged from a prior run (Phase 2 concept — may be 0 in Phase 1)
   *   new:     ok - reused (agents whose rubric or code paths were new this run)
   */
  squad: { total: number; ok: number; reused: number; new: number };

  /** Token usage summed across all reviewer Task invocations. */
  tokens: { input: number; output: number };

  /**
   * USD cost estimate. Orchestrator computes this from per-model pricing × token counts
   * at run date. This module formats — it does NOT recompute.
   */
  costUsd: number;

  /**
   * Map of finding.location_key → eljun task URL. Populated by the eljun filer
   * (T1222/T1223) BEFORE this module runs when !flags.dryRun. When flags.dryRun
   * is true, the map is empty and this module renders "(dry-run — no tasks filed)"
   * in place of each link.
   */
  eljunLinks: Record<string, string>;

  /**
   * Rubric hashes emitted by rubric-check (T1215). Map of repo-relative rubric
   * path → 8-char hex. Included verbatim in RUN METADATA.
   */
  rubricHashes: Record<string, string>;

  /**
   * Names of reviewer agents skipped (e.g. rubric missing, --skip flag, UX reviewers
   * when --include-ux is unset). Rendered in "SKIPPED AGENTS" section.
   */
  skippedAgents: string[];

  /**
   * Per-agent reviewer model used, keyed by agent name. Comes from §4 assignments.
   * Example: { "isolation-reviewer": "claude-opus-4-6", "freshness-reviewer": "claude-haiku-4-5", "drift-gate": "none" }.
   * Rendered in RUN METADATA.
   */
  reviewerModels: Record<string, string>;

  /**
   * Absolute path to the consuming repository root. Used to resolve artifact paths.
   */
  repoRoot: string;

  /**
   * Artifact paths that individual agents wrote under docs/preflight/run-*/artifacts/.
   * Map of finding.location_key → repo-relative artifact path.
   * Optional — a finding without an artifact entry simply omits the "Artifact:" line.
   */
  artifactPaths: Record<string, string>;
}
```

### Output

```ts
interface DashboardOutput {
  /** Absolute path of the dashboard Markdown file the orchestrator will write. */
  dashboardPath: string;

  /** Absolute path of the raw-findings.json sibling the orchestrator will write. */
  rawFindingsPath: string;

  /** Full dashboard Markdown content (to be written verbatim to dashboardPath). */
  dashboardMarkdown: string;

  /** Pretty-printed JSON of the input.rawFindings array (to be written to rawFindingsPath). */
  rawFindingsJson: string;

  /**
   * The runId string (YYYY-MM-DD-HHMM UTC) that the orchestrator uses elsewhere
   * (review-notes.md path, artifacts dir, eljun footer). Deterministically
   * derivable from runStartedAt — exposed so callers do not reimplement the
   * same formatting and drift.
   */
  runId: string;
}
```

### Purity and side effects

- **This module does NOT perform file I/O.** It returns strings; the orchestrator owns the Write tool calls. Separating rendering from writing makes the module trivially unit-testable against fixed fixtures.
- **No clock reads.** `runStartedAt` and `runEndedAt` are inputs. The module must not call `Date.now()` or `new Date()` internally — that would break snapshot tests.
- **No git calls.** `commitSha` is an input.
- **No network.** No eljun fetching (links are pre-populated by T1222/T1223).
- **Referential transparency.** Same input → same output strings, byte-for-byte. (This is load-bearing for the T1219 acceptance criterion "Snapshot test: fixed fixture + fixed timestamp → byte-for-byte match".)

---

## 3. Authoritative template (Design Doc §11 — REPRODUCE VERBATIM)

This is the reference the renderer follows. Do NOT introduce variant headers, extra blank lines, or reordered sections. Anything that breaks from this template must be approved as a Design Doc §11 edit FIRST, then mirrored here.

```markdown
# Pilot Review Run — 2026-04-14 14:32

**Verdict**: 2 P0 blockers, 14 P1, 38 P2, 91 P3-notes
**Squad**: 10/10 ok (2 reused + 8 new)
**Run time**: 4m 23s
**Token estimate**: ~1.8M input, ~180k output
**Flags**: `--app=guestpad`
**Commit SHA**: c069601

---

## BLOCKERS — MUST FIX BEFORE PILOT [2]

### 1. [P0] [isolation + auth — 2 witnesses] RLS missing on `bar` table, reachable via /api/bar
- **Location**: `db:bar:rls_missing`
- **Evidence**: apps/guestpad/supabase/migrations/058_foo.sql:12 — table `bar` lacks RLS policy. Also: apps/guestpad/src/app/api/bar/route.ts:18 — queried from anon-authenticated route without owner check.
- **Fix**: (1) Add RLS policy to migration 059. (2) Fix route to use owner-scoped client.
- **eljun**: [GUE-0147](https://eljun.vercel.app/projects/guestpad/items/GUE-0147)
- **Artifact**: `artifacts/isolation/bar-rls.md`

### 2. [P0] [payment] Stripe webhook signature not verified
- **Location**: `code:apps/guestpad/src/app/api/webhooks/stripe/route.ts:POST:pay.webhook_signature_missing`
- **Evidence**: …
- **Fix**: …
- **eljun**: [GUE-0148](...)

---

## MUST-FIX BEFORE PILOT (P1) [14]

(Grouped by domain, collapsed titles with expandable details. Dashboard consumer scrolls and clicks through.)

### privacy-gdpr (5)
- [P1] PII in Sentry breadcrumbs — `mon:apps/guestpad:pii_scrub_absent` — [GUE-0149]
- [P1] Guest message retention policy missing — `db:guest_messages:retention_missing` — [GUE-0150]
- …

### auth-boundary (4)
- [P1] Zod validation missing on PATCH /api/alert-settings — [GUE-0152]
- …

### freshness (3)
- [P1] axios CVE (GHSA-xxxx-yyyy-zzzz, CVSS 7.5) — [GUE-0155]
- …

### codebase-auditor (2)
- [P1] Phantom import in aurora-engine/adapters — [GUE-0158]
- …

---

## POST-PILOT (P2) [38]

Appended to `docs/plans/backlog.md` under "Pilot Review — Run 2026-04-14 14:32". Not filed to eljun.

Short list:
- code:...:dead_code — 12 items
- mon:...:structured_logging_absent — 5 items
- fresh:*:major_version_behind — 8 items
- …

---

## REVIEW NOTES (P3) [91]

See `review-notes.md` for full list.

- 12 rubric-gap notes — consider updating `docs/review-rubrics/privacy-gdpr.md` to codify these.
- 8 reviewer-uncertain notes — worth a human look.
- Remaining 71 are low-signal observations.

---

## TOP DOMAIN CONCENTRATIONS

- **privacy-gdpr**: 12 findings (9 in API routes, 3 in analytics integration)
- **isolation**: 9 findings (5 in migrations, 4 in API routes)
- **monitoring**: 9 findings (Sentry missing on aurora-api, PII scrubbing on guestpad, alert noise)
- **codebase-auditor**: 38 findings (mostly P2 — dead code, weak tests)

---

## FRESHNESS SIGNAL

- **3** deps with known CVEs (see `artifacts/freshness/cves.md`):
  - axios 1.5.0 → GHSA-xxxx (CVSS 7.5)
  - next 15.0.1 → GHSA-yyyy (CVSS 5.3)
  - sharp 0.32.0 → GHSA-zzzz (CVSS 8.1)
- **1** dep deprecated upstream: `@deprecated/foo` → migrate to `@new/foo`.
- **0** typosquat risk flags.
- Otherwise clean.

---

## MONITORING SIGNAL

- **Missing**: Sentry not configured in `apps/aurora-api/` (no error capture on `/forecast`).
- **Weak**: PII scrubber in guestpad Sentry `beforeSend` doesn't strip email from `guest-message` errors.
- **Alert noise**: 3 alerts fired 40+ times last week (needs tuning — see `artifacts/monitoring/alert-log.md`).

---

## DRIFT SIGNAL

- **drift-check exit code**: 0 (✓ All projects clean)
- No schema drift detected across guestpad, aurora-hunter, aurora-hunter-web Supabase projects.

---

## SKIPPED AGENTS

None (all 10 agents ran successfully).

---

## NEXT ACTIONS

1. Fix 2 P0 blockers (~2–4h) — see eljun tasks GUE-0147, GUE-0148.
2. Review/prioritize 14 P1s (~30min) — grouped by domain above.
3. Optional: promote/close P2 items (~30min) — see backlog.md.
4. Re-run `/pilot-review` to verify P0 resolution and ensure no new findings.
5. Once P0 = 0 and P1 = 0, pilot is technically cleared.

---

## RUN METADATA

- Rubric versions:
  - `docs/review-rubrics/privacy-gdpr.md@a0b3c4d5`
  - `docs/review-rubrics/payment.md@e1f2g3h4`
  - `docs/review-rubrics/monitoring.md@i5j6k7l8`
- Plugin version: `halli-workflows@1.2.3`
- Reviewer models used (see §4 per-reviewer assignments): claude-opus-4-6 (isolation-reviewer, auth-boundary-reviewer, privacy-gdpr-reviewer, payment-reviewer), claude-sonnet-4-5 (monitoring-reviewer, owner-ux-reviewer, guest-ux-reviewer), claude-haiku-4-5 (codebase-auditor wrapper, freshness-reviewer). Drift-gate is pure shell-out with no LLM invocation.
- Concurrency: 5 (semaphore)
- Cost estimate: ~$4.20 USD

---

*This dashboard was generated by `/pilot-review` (halli-workflows@1.2.3). See `docs/adr/ADR-0014-pilot-review-orchestration.md` for the orchestration pattern.*
```

Section order (for any future doubt): **Header block → BLOCKERS → MUST-FIX (P1) → POST-PILOT (P2) → REVIEW NOTES (P3) → TOP DOMAIN CONCENTRATIONS → FRESHNESS SIGNAL → MONITORING SIGNAL → DRIFT SIGNAL → SKIPPED AGENTS → NEXT ACTIONS → RUN METADATA → footer paragraph**. The Design Doc §11 template order is canonical even where T1219's task-file numbered list omits DRIFT SIGNAL and SKIPPED AGENTS (the task file acceptance criteria reinstate them; §11 is the final authority).

---

## 4. Algorithm

### 4.1 Compute `runId` and paths

```
runId          = format(runStartedAt, "YYYY-MM-DD-HHMM")   # UTC
outputDir      = {repoRoot}/docs/preflight/run-{runId}
dashboardPath  = {repoRoot}/docs/preflight/run-{runId}.md
rawFindingsPath= {outputDir}/raw-findings.json
```

`format(Date, "YYYY-MM-DD-HHMM")` uses UTC components (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCHours`, `getUTCMinutes`) zero-padded to 2 digits (month and day also 2 digits). The title line renders the same timestamp in a more human form: `YYYY-MM-DD HH:MM` (hyphen between date and space before time) — both derive from the same UTC components so they are internally consistent.

Example: `runStartedAt = 2026-04-14T14:32:07.000Z` →
- `runId` = `"2026-04-14-1432"`
- Title = `"# Pilot Review Run — 2026-04-14 14:32"`

Rule 13 guard: **no locale-dependent formatting** (`toLocaleString`, `Intl.DateTimeFormat`) anywhere in this module. UTC-only, zero-padded. Otherwise the same input on two different machines produces different file names, and the snapshot test at §9 fails non-deterministically.

### 4.2 Partition findings by severity

```
p0 = findings.filter(f => f.severity === "P0")
p1 = findings.filter(f => f.severity === "P1")
p2 = findings.filter(f => f.severity === "P2")
p3 = findings.filter(f => f.severity === "P3")
```

Order within each bucket is **already sorted by witness-count descending** by the upstream sort in §12 step 8f. This module does NOT re-sort — preserving input order lets the sort contract live in one place (the dedup module §Step 4).

### 4.3 Render the header block

```
# Pilot Review Run — {humanTimestamp}

**Verdict**: {p0.length} P0 blockers, {p1.length} P1, {p2.length} P2, {p3.length} P3-notes
**Squad**: {squad.ok}/{squad.total} ok ({squad.reused} reused + {squad.new} new)
**Run time**: {formatDuration(runEndedAt - runStartedAt)}
**Token estimate**: ~{formatTokenCount(tokens.input)} input, ~{formatTokenCount(tokens.output)} output
**Flags**: `{flagString}`
**Commit SHA**: {commitSha}
```

- `humanTimestamp` = `YYYY-MM-DD HH:MM` (UTC — see §4.1).
- `formatDuration(ms)`:
  - `< 60_000` → `"{s}s"` (e.g. `"23s"`)
  - `< 3_600_000` → `"{m}m {s}s"` (e.g. `"4m 23s"`)
  - `>= 3_600_000` → `"{h}h {m}m"` (e.g. `"1h 12m"`)
  - Always integer seconds/minutes; discard milliseconds.
- `formatTokenCount(n)`:
  - `n < 1_000` → `"{n}"` (e.g. `"450"`)
  - `n < 1_000_000` → `"{n/1000}k"` rounded to nearest integer (e.g. `"180k"`)
  - `n >= 1_000_000` → `"{n/1_000_000}M"` to ONE decimal place (e.g. `"1.8M"`)
  - The `~` tilde prefix comes from the template, not the formatter (the formatter emits the number only).
- `flagString` renders inside backticks verbatim. If `flagString === ""` (no flags), render `` `(no flags)` ``.
- `squad.total`: when `flags.includeUx === false`, the expected roster is 8 (Phase 1 non-UX), not 10. The orchestrator passes the correct number in `squad.total` — this module does not recompute.

The `**Target**: \`apps/{app_slug}\`` line shown in the T1201 scaffold template (orchestrator §Step 5) is ABSENT from Design Doc §11. The scaffold is a superset; the final template in §11 is what this module emits. A reader who relied on the scaffold's `Target:` line must scan the `**Flags**:` line instead — the `--app=<slug>` flag encodes the same information.

### 4.4 Render the BLOCKERS section

```
---

## BLOCKERS — MUST FIX BEFORE PILOT [{p0.length}]
```

- If `p0.length === 0`: emit `_No findings._` on its own line immediately after the header, then the `---` separator.
- Else: for each finding in `p0`, index `i` starting at 1, render one subsection per §4.7 "Finding rendering (BLOCKERS format)".

### 4.5 Render the MUST-FIX (P1) section

```
---

## MUST-FIX BEFORE PILOT (P1) [{p1.length}]

(Grouped by domain, collapsed titles with expandable details. Dashboard consumer scrolls and clicks through.)
```

- If `p1.length === 0`: emit `_No findings._` then the separator.
- Else: **group by `finding.agent`** (the primary attribution after dedup). The canonical agent groups and their human-readable labels:

  | finding.agent | Section heading |
  |---------------|-----------------|
  | `isolation-reviewer` | `### isolation ({n})` |
  | `auth-boundary-reviewer` | `### auth-boundary ({n})` |
  | `privacy-gdpr-reviewer` | `### privacy-gdpr ({n})` |
  | `payment-reviewer` | `### payment ({n})` |
  | `monitoring-reviewer` | `### monitoring ({n})` |
  | `freshness-reviewer` | `### freshness ({n})` |
  | `drift-gate` | `### drift-gate ({n})` |
  | `codebase-auditor-adapter` | `### codebase-auditor ({n})` (template uses the short form) |
  | `orchestrator` | `### orchestrator ({n})` |
  | `owner-ux-reviewer` (Phase 2) | `### owner-ux ({n})` |
  | `guest-ux-reviewer` (Phase 2) | `### guest-ux ({n})` |
  | anything else | `### {agent} ({n})` (fallback — verbatim kebab-case; preserves Rule 13 by not silently renaming unknown agents) |

  Group order within the section follows **first-appearance order** in the already-sorted `p1` array. The upstream sort puts high-witness-count findings first, so the group whose leader was first-seen leads. This is stable and deterministic.

- For each group, render one `### {label} ({count})` heading, then one list item per finding in its original `p1` order via §4.8 "Finding rendering (P1 list format)".

### 4.6 Render the POST-PILOT (P2) section

```
---

## POST-PILOT (P2) [{p2.length}]
```

- If `p2.length === 0`:
  ```
  _No findings._
  ```
- Else:
  ```
  Appended to `docs/plans/backlog.md` under "Pilot Review — Run {humanTimestamp}". Not filed to eljun.

  Short list:
  {for each of top-N P2 heuristic_id groups by count:}
  - {location_key_prefix}:*:{heuristic_id} — {count} items
  …
  ```
  - "Short list" caps at the top 5 groups by count (to keep the dashboard scannable). If there are > 5 distinct groups, append a final line `- … and {remaining} more (see backlog.md)`.
  - Grouping key: `{first two `:`-delimited segments of location_key}:*:{heuristic_id}`. Example: `code:apps/guestpad/src/lib:*:dead_code`. This mirrors the §11 example lines `code:...:dead_code` / `mon:...:structured_logging_absent`.
  - When `flags.dryRun === true`, replace the first sentence with: `(Dry-run — not appended to backlog.md.) Short list:` — otherwise the reference to backlog.md misleads the reader.

### 4.7 Render the REVIEW NOTES (P3) section

```
---

## REVIEW NOTES (P3) [{p3.length}]
```

- If `p3.length === 0`:
  ```
  _No findings._
  ```
- Else:
  ```
  See `review-notes.md` for full list.

  - {rubricGapCount} rubric-gap notes — consider updating `docs/review-rubrics/privacy-gdpr.md` to codify these.
  - {uncertainCount} reviewer-uncertain notes — worth a human look.
  - Remaining {lowSignalCount} are low-signal observations.
  ```
  - `rubricGapCount` = count of P3 findings where `heuristic_id === "rubric_gap"`.
  - `uncertainCount` = count where `heuristic_id === "anchor_validator_uncertain"` OR `verdict === "uncertain"` OR `heuristic_id === "VERIFICATION_UNAVAILABLE"`.
  - `lowSignalCount` = `p3.length - rubricGapCount - uncertainCount`. Clamp to `>= 0` defensively (should not be negative; if it is, emit a warning and render 0).
  - The `docs/review-rubrics/privacy-gdpr.md` suggestion text is a literal template copy — the real orchestrator may want to name the actual rubric whose gap was widest, but that heuristic is a Phase 2 refinement; Phase 1 emits the literal §11 text.

### 4.8 Render TOP DOMAIN CONCENTRATIONS

```
---

## TOP DOMAIN CONCENTRATIONS
```

- If `findings.length === 0`: emit `_No findings to concentrate._` on the next line.
- Else: group ALL findings (P0+P1+P2+P3, not just P1 as in the MUST-FIX section) by `finding.agent` and render the top 4 groups by count:

  ```
  - **{agent-short-name}**: {count} findings ({breakdown})
  ```

  Where `{breakdown}` is a short summary derived from the most common `location_key` prefixes in the group. Example: `"5 in migrations, 4 in API routes"`. Derivation:
  - For each finding in the group, take the second `:`-delimited segment of `location_key` (e.g. `code:apps/guestpad/src/app/api/...` → `apps/guestpad/src/app/api`).
  - Collapse by a small fixed prefix dictionary:
    - `apps/*/src/app/api/` → `"API routes"`
    - `apps/*/supabase/migrations/` → `"migrations"`
    - `apps/aurora-api/` → `"aurora-api"`
    - `apps/guestpad/src/components/` → `"guest UI"`
    - `apps/*/src/lib/` → `"libraries"`
    - `db:` prefix (the whole key starts with `db:`) → `"database"`
    - `mon:` prefix → `"monitoring integration"`
    - `dep:` prefix → `"dependencies"`
    - everything else → `"other"`
  - Count per category, render the top 2 as `"{n1} in {cat1}, {n2} in {cat2}"`.
  - If only one category is present, render `"{n} in {cat}"` (no comma).
  - Cap total concentration list at 4 agents; append nothing further if there are more (the full distribution is derivable from the sections above).
- If a group has `< 5` findings, omit it from this section (the §11 example implies this is a high-signal section, not a full distribution).

### 4.9 Render FRESHNESS / MONITORING / DRIFT SIGNAL sections

These three sections are **signal summaries**, not finding enumerations. They consume ONLY the subset of findings emitted by their corresponding reviewer agents.

#### 4.9.1 FRESHNESS SIGNAL

```
---

## FRESHNESS SIGNAL
```

Subset: `findings.filter(f => f.agent === "freshness-reviewer")`.

- If subset is empty: emit `_Freshness clean — no CVEs, no deprecations, no typosquat flags._` (the reviewer ran and reported clean).
- If the freshness-reviewer is in `skippedAgents`: emit `_Not collected this run — freshness-reviewer was skipped._`
- Else: group by `heuristic_id`:

  ```
  - **{cveCount}** deps with known CVEs (see `artifacts/freshness/cves.md`):
    - {evidence line, stripped of the "file:line — " prefix since freshness evidence is the CVE summary itself}
    - …
  - **{deprecatedCount}** dep(s) deprecated upstream: {list}
  - **{typosquatCount}** typosquat risk flag(s).
  - Otherwise clean.
  ```

  Where:
  - `cveCount` = count of `heuristic_id` matching `/^fresh\.cve\./`.
  - Each CVE line renders just the evidence text (which per `agents/freshness-reviewer.md` §4.7 is already `"<package> <version> → <GHSA-id> (CVSS {score})"`).
  - `deprecatedCount` = count of `heuristic_id === "fresh.deprecated_upstream"`.
  - `typosquatCount` = count of `heuristic_id === "fresh.typosquat_flag"`.
  - Omit lines whose count is zero (e.g. if there are no deprecations, skip the "dep(s) deprecated" line entirely, except the `0 typosquat risk flags.` line is retained to match §11's explicit `**0** typosquat risk flags.` line — zeros are signal when the reviewer actively checked).
  - The path `artifacts/freshness/cves.md` is RELATIVE to `outputDir` (i.e. full path `{outputDir}/artifacts/freshness/cves.md`). The dashboard lives at `docs/preflight/run-{runId}.md` and references its sibling directory `run-{runId}/` by a RELATIVE path like `run-{runId}/artifacts/freshness/cves.md`. **Deviation from §11**: the §11 example renders it as `artifacts/freshness/cves.md` which would be relative to the dashboard file's directory (i.e. `docs/preflight/`), resolving to `docs/preflight/artifacts/...` — wrong. This module emits `run-{runId}/artifacts/freshness/cves.md` to match the actual artifacts layout from §11.artifact-directory. Document this as a §11-template-bug-we-fix-silently; flag for Design Doc cleanup.

#### 4.9.2 MONITORING SIGNAL

Subset: `findings.filter(f => f.agent === "monitoring-reviewer")`.

Same empty/skipped semantics as freshness. Rendering: take the top 3 findings by witness count (already the sort order), and for each emit a bullet:

```
- **{category}**: {evidence}
```

Where `{category}` is derived from `heuristic_id`:
- `mon.sentry_missing` → `Missing`
- `mon.pii_scrub_absent` → `Weak`
- `mon.alert_noise_*` → `Alert noise`
- `mon.structured_logging_absent` → `Logging`
- fallback → the raw `heuristic_id`.

The §11 example's `artifacts/monitoring/alert-log.md` reference follows the same path-correction rule as freshness (§4.9.1).

#### 4.9.3 DRIFT SIGNAL

Subset: `findings.filter(f => f.agent === "drift-gate")`.

- If subset is empty:
  ```
  - **drift-check exit code**: 0 (✓ All projects clean)
  - No schema drift detected across {project list from drift-gate config, or "all Supabase projects" fallback}.
  ```
  The drift-gate reviewer exit code is captured by the orchestrator; this module assumes the orchestrator has supplied it through a `skippedAgents` entry when drift-gate failed to run. When drift-gate ran AND emitted no findings, exit code is by definition 0.
- If subset is non-empty:
  ```
  - **drift-check exit code**: {nonzero from orchestrator metrics, or "non-zero" as placeholder if not wired}
  - {f.evidence} (filed as eljun: {eljunLink})
  - …
  ```
  All drift-gate findings are P0 per §6 hard-coded ceiling; they ALSO appear in the BLOCKERS section. The DRIFT SIGNAL section re-surfaces them as a dedicated summary so a reader who scrolls to DRIFT first sees them immediately.
- If drift-gate is in `skippedAgents`:
  ```
  _Not collected this run — drift-gate was skipped._
  ```

### 4.10 Render SKIPPED AGENTS section

```
---

## SKIPPED AGENTS
```

- If `skippedAgents.length === 0`:
  ```
  None (all {squad.total} agents ran successfully).
  ```
- Else:
  ```
  - `{agent-1}` — {reason if known, otherwise "skipped"}
  - `{agent-2}` — …
  ```
  The orchestrator may pass a richer `skippedAgents` structure in Phase 2 (e.g. an object `{name, reason}`); for Phase 1 the input is a plain `string[]` and the reason slot renders as `"skipped"` by default. When a rubric is missing, the orchestrator-side rubric-check module (T1215) already emits a `RUBRIC_MISSING` P0 finding; the SKIPPED AGENTS line here is complementary, not redundant.

### 4.11 Render NEXT ACTIONS section

```
---

## NEXT ACTIONS
```

The section is **template-driven** with count substitutions. If all bucket counts are zero AND no agents skipped, render a clean-run variant; otherwise render the standard variant.

**Clean-run variant** (`p0 = p1 = p2 = p3 = 0` AND `skippedAgents.length === 0`):
```
1. Clean run — no blockers, no must-fixes, no backlog items, no review notes.
2. Pilot is technically cleared from a /pilot-review perspective.
3. Consider a re-run closer to pilot launch to catch freshness drift (CVEs, deprecated deps).
```

**Standard variant**:
```
1. Fix {p0.length} P0 blocker{s if plural} (~2–4h per blocker) — see {eljun link list or "eljun tasks filed in this run"}.
2. Review/prioritize {p1.length} P1{s if plural} (~30min) — grouped by domain above.
3. Optional: promote/close P2 items (~30min) — see backlog.md.
4. Re-run `/pilot-review` to verify P0 resolution and ensure no new findings.
5. Once P0 = 0 and P1 = 0, pilot is technically cleared.
```

- If `p0.length === 0`: replace line 1 with `1. No P0 blockers this run — nice.` and renumber.
- If `p1.length === 0`: replace line 2 with `2. No P1 must-fixes this run.` and renumber.
- If `flags.dryRun === true`: append line 0: `0. (Dry-run — no eljun tasks or backlog entries were written. Re-run without --dry-run to commit triage.)` — inserted before line 1 so the user sees it first.
- The "eljun link list" in line 1 enumerates the first 3 P0 eljun tasks as `[GUE-0147](url), [GUE-0148](url), …`. If `flags.dryRun === true` or `eljunLinks` is empty for all P0s, render `"(no eljun tasks filed — see BLOCKERS above)"` instead.

### 4.12 Render RUN METADATA section

```
---

## RUN METADATA

- Rubric versions:
{for each [path, hash] in rubricHashes (alphabetical by path):}
  - `{path}@{hash}`
- Plugin version: `halli-workflows@{pluginVersion}`
- Reviewer models used (see §4 per-reviewer assignments): {modelSummary}
- Concurrency: {flags.concurrency} (semaphore)
- Cost estimate: ~${costUsd.toFixed(2)} USD
- Dry-run: {flags.dryRun ? "true" : "false"}
- Force: {flags.force ? "true" : "false"}
- Run ID: {runId}
```

Where `{modelSummary}` is built from `reviewerModels`:

1. Group agents by their assigned model name (e.g. `"claude-opus-4-6"`, `"claude-sonnet-4-5"`, `"claude-haiku-4-5"`, `"none"`).
2. For each model (sorted by the canonical order `opus → sonnet → haiku → none`), render `{modelName} ({agent1}, {agent2}, …)`.
3. The `"none"` bucket renders as `"{model=none}: drift-gate (pure shell-out with no LLM invocation)"`.
4. Join groups with `, `.
5. If a model has zero agents (all skipped), omit it entirely.

Example output when every reviewer ran:

```
claude-opus-4-6 (isolation-reviewer, auth-boundary-reviewer, privacy-gdpr-reviewer, payment-reviewer), claude-sonnet-4-5 (monitoring-reviewer), claude-haiku-4-5 (codebase-auditor-adapter, freshness-reviewer). Drift-gate is pure shell-out with no LLM invocation.
```

- If `rubricHashes` is empty: render `- Rubric versions: _(no rubrics required for this run's active reviewers)_` instead of the nested list.
- If `flags.includeUx === true`: add `owner-ux-reviewer` and `guest-ux-reviewer` to the claude-sonnet-4-5 bucket per §4 assignments.

### 4.13 Render footer paragraph

```
---

*This dashboard was generated by `/pilot-review` (halli-workflows@{pluginVersion}). See `docs/adr/ADR-0014-pilot-review-orchestration.md` for the orchestration pattern.*
```

Single line, italic, block-ended with a blank line (required — Markdown readers otherwise render the closing asterisk as emphasis against the file EOF).

### 4.14 Assemble and return

Concatenate all section strings with a single `\n` separator between them. The `---` separators between sections are part of the section strings themselves (per §3 template), NOT inserted at assembly time.

Return:

```
{
  dashboardPath,
  rawFindingsPath,
  dashboardMarkdown,
  rawFindingsJson: JSON.stringify(rawFindings, null, 2),
  runId,
}
```

---

## 5. Finding rendering details

### 5.1 BLOCKERS subsection format (P0)

```
### {index}. [P0] [{agentTag}{witnessTag}] {shortDescription}
- **Location**: `{finding.location_key}`
- **Evidence**: {renderedEvidence}
- **Fix**: {finding.suggested_fix}
- **eljun**: {eljunCell}
- **Artifact**: `{relativeArtifactPath}`
```

- `{index}` — 1-based counter within the BLOCKERS section.
- `{agentTag}` — primary agent's short name (e.g. `isolation`, `auth`, `payment`). Short-name mapping mirrors the MUST-FIX group table in §4.5.
- `{witnessTag}` — computed as:
  - If `finding.witnesses.length >= 2`: render the union of short-names from §4.5 joined by ` + `, followed by ` — {N} witnesses`.
    Example: `[isolation + auth — 2 witnesses]`.
  - If `finding.witnesses.length < 2`: omit the witness tag entirely (just the agent tag in brackets).
- `{shortDescription}` — first sentence of `finding.evidence`, stripped of any leading `{file}:{line} — ` prefix and capped at 120 chars. If the evidence is shorter than one sentence, use the whole thing. Suffix with `…` if truncated.
- `{renderedEvidence}` — `finding.evidence` with the following transformations (applied in order):
  1. If the evidence contains ` | REFUTED: ` (from verify-claims pass): split on that substring; emit `{original}\n  _REFUTED: {refutation note}_` (italicized annotation on its own indented line). The original severity before demotion is surfaced via an inline note `(verify-claims demoted from P0 to P1)` ONLY IF the orchestrator passes the pre-demotion severity in the finding; since the current Finding schema does not carry that history, the demotion is inferred from the `REFUTED:` annotation's presence alone. **Rule 13 note**: never fabricate a pre-demotion severity. If the schema does not carry it, omit that parenthetical.
  2. If the evidence contains ` | rule_link_broken: ` or ` | rule_link_file_missing: ` or ` | rule_link_malformed: ` (from anchor-validator pass): split similarly; emit `{original}\n  _anchor-validator: {note}{ suggested slug if any}_`.
  3. If the evidence contains ` | verify_status: unverifiable — `: split; emit `{original}\n  _(unverifiable this run: {reason})_`.
  4. If the evidence contains ` | verify_status: not-verified-this-run`: split; emit `{original}\n  _(not verified this run — verifier unavailable)_`.
  5. If multiple `|` segments remain (the dedup-merged evidence from multiple witnesses), replace each `| ` with `\n  - ` to break them out as sub-bullets. The `Evidence:` line then reads as a lead paragraph followed by an indented bulleted list.
- `{eljunCell}`:
  - `flags.dryRun === true`: `(dry-run — no tasks filed)`
  - `eljunLinks[finding.location_key]` is undefined (not filed, e.g. cap hit): `(not filed — eljun cap reached)`
  - Else: `[{taskId extracted from URL}]({url})`.
- `{relativeArtifactPath}`:
  - If `artifactPaths[finding.location_key]` is defined, render the whole `- **Artifact**:` line using that path (relative to `outputDir`).
  - Else, OMIT the `- **Artifact**:` line entirely (do not render an empty placeholder).

Each P0 subsection is separated from the next by a single blank line.

### 5.2 MUST-FIX (P1) list item format

```
- [P1] {shortDescription} — `{finding.location_key}` — {eljunTag}
```

- `{shortDescription}` — same rule as §5.1.
- `{eljunTag}` — `[{taskId}]` in dry-run, else `[{taskId}]({url})`.
- If the finding was demoted from P0 by verify-claims (evidence contains `REFUTED:`), append ` — _demoted from P0_` to the line.
- If the finding has `witnesses.length >= 2`, append ` — {N} witnesses` to the line.

Sub-bullets for P1 findings (evidence, fix) are NOT rendered by default — P1 stays compact per §11's "collapsed titles with expandable details" directive. Phase 2 UX improvement: wrap the list in `<details>`/`<summary>` HTML so GitHub renders a collapsible disclosure. **Phase 1: plain bullet list; no HTML.**

### 5.3 Witness annotation rule

Per §8 "Multi-Witness Confidence Signal", any finding with `witnesses.length >= 2` gets an annotation regardless of section:
- In P0 subsection headings: `[{agent1} + {agent2}{ + …} — {N} witnesses]` in the tag bracket.
- In P1 list items: appended as `— {N} witnesses`.
- In the freshness/monitoring/drift summary sections: not applicable (those sections summarize heuristic categories, not individual witnesses).

The `[N witnesses]` suffix is ONLY for N >= 2. Single-witness findings (the common case) do NOT carry the annotation — it would be noise since every P0 is at least one-witness by definition.

---

## 6. raw-findings.json format

`JSON.stringify(input.rawFindings, null, 2)`. Written to `{outputDir}/raw-findings.json`.

- Uses the PRE-dedup array (every per-agent finding, untouched). This is the auditable source a reviewer consults when they want to see "what did each agent individually say before aggregation?" It is fundamentally different from `findings` (the post-aggregation view).
- Pretty-printed with 2-space indent for git-diffability.
- Deterministic ordering: rawFindings is passed in by the orchestrator in agent-invocation order (semaphore-scheduled), NOT sorted. The module preserves this order — sorting would destroy the "which agent found this?" audit trail.
- Not a ND-JSON or JSONL file — a single JSON array. Small enough (< 500 findings × ~2KB each = 1 MB) for any editor.

---

## 7. Flags affecting output

| Flag | Effect on dashboard |
|------|---------------------|
| `--dry-run` | Replaces all eljun links with `(dry-run — no tasks filed)`. Rewrites POST-PILOT section intro to skip the backlog.md reference. Prepends a NEXT ACTIONS line-0 warning. |
| `--force` | Surfaced in RUN METADATA as `Force: true`. Affects nothing else at this layer — the rubric-gap filtering already happened upstream (T1215). |
| `--app={slug}` | Surfaced verbatim in the `Flags:` line. `flags.app` separately drives project-specific logic like the backlog path (out of scope here). |
| `--concurrency={n}` | Surfaced verbatim in RUN METADATA. Affects nothing else. |
| `--include-ux` | Raises `squad.total` from 8 to 10 (Phase 2 expansion). Affects agent model summary in RUN METADATA. |
| `--only={agent-list}`, `--skip={agent-list}` | Caught upstream; this module sees the resulting `skippedAgents` and renders them in the SKIPPED AGENTS section. |
| `--commit-artifacts` | No effect here. Handled by T1224 (separate module) to adjust `.gitignore`. |

---

## 8. Rule 13 compliance declaration

This module's primary Rule 13 risks are:

1. **Verbal drift from the §11 template.** The template in §3 is a literal copy of Design Doc §11. The `generate*` renderers must produce strings that match §11's structural anchors (header hierarchy, section order, separator usage). Byte-for-byte match is not required (count values, timestamps, and counts legitimately vary), but any change to header text (e.g. "BLOCKERS" → "CRITICAL") is a Rule 13 violation regardless of whether it "reads better".
2. **Fabricated aggregates.** The MUST-FIX grouping counts MUST be derived from the input findings array. Don't precompute and pass. Don't read counts from another module's cache and trust them.
3. **Invented eljun URLs.** If `eljunLinks[finding.location_key]` is absent, DO NOT synthesize `https://eljun.vercel.app/projects/...` — render the explicit `(not filed — ...)` placeholder so the user sees that filing failed.
4. **Fake model assignments.** `reviewerModels` is an input. Do not hard-code the §4 table in the renderer as a fallback; hard-coding creates a place where the renderer claims an agent ran on Opus when it actually ran on Sonnet. If `reviewerModels[agent]` is undefined for an agent in `squad`, render `{unknown}` and emit a stderr warning.
5. **Locale-dependent formatting.** All timestamps and numbers format with explicit UTC / en-US conventions (digit grouping with `,`, decimal point with `.`). Never use `toLocaleString`. Tests on a non-en-US CI runner must produce the same output as a local run.
6. **Truncation that hides evidence.** §5.1's 120-char description cap is for the short-description header only. The full `evidence` string ALWAYS renders in the Evidence: line. Never truncate evidence for "readability" — the user is scanning for the bug, not for prose.

Self-check for the implementer before committing:
- Run the module against a fixture with known zero-count inputs. Confirm every section header still appears.
- Run against a fixture with one P0. Confirm the BLOCKERS section has exactly one subsection indexed `1.`.
- Run against a fixture where every reviewer agent emitted at least one finding. Confirm every MUST-FIX group is present and counts are correct.

---

## 9. Testing contract

Fixtures live alongside the orchestrator TypeScript implementation (when it materializes). This spec defines the expected cases.

| # | Case | Expected |
|---|------|----------|
| 1 | Empty findings, `squad={0,0,0,0}`, `skippedAgents=[]` | Dashboard renders with verdict `0 P0 blockers, 0 P1, 0 P2, 0 P3-notes`; every section header present; `_No findings._` placeholders; NEXT ACTIONS clean-run variant |
| 2 | Two P0 (isolation + auth), three P1 (privacy-gdpr × 2, freshness × 1), five P2, ten P3 | Verdict `2 P0 blockers, 3 P1, 5 P2, 10 P3-notes`; BLOCKERS has exactly 2 subsections; MUST-FIX has 2 groups (privacy-gdpr count 2, freshness count 1); POST-PILOT "Short list" derived from P2 `location_key`/`heuristic_id` group counts |
| 3 | Fixed fixture of 20 findings across agents, `runStartedAt = 2026-04-14T14:32:07.000Z`, `runEndedAt = 2026-04-14T14:36:30.000Z`, `tokens = {input: 1_800_000, output: 180_000}`, `flags.dryRun = false` | Byte-for-byte match against committed `fixtures/dashboard/run-2026-04-14-1432.md` snapshot. Any whitespace or header drift fails the test |
| 4 | `flags.dryRun = true` with 1 P0 | eljun column for the P0 subsection reads `(dry-run — no tasks filed)`; POST-PILOT intro rewritten; NEXT ACTIONS prepended line-0 |
| 5 | P0 finding with `witnesses = ["isolation-reviewer", "auth-boundary-reviewer"]` | BLOCKERS subsection header reads `[P0] [isolation + auth — 2 witnesses]` |
| 6 | P0 finding whose evidence was demoted by verify-claims (contains ` | REFUTED: …`) and its primary severity is still P0 (would-have-been-higher-before-demotion, but schema doesn't encode that) | BLOCKERS subsection renders the refutation note as an indented italicized line below the Evidence: lead |
| 7 | P1 finding with `rule_link_broken` annotation and a `(did you mean ...)` suggestion | P1 list item renders with the broken-link annotation appended as an italic sub-line |
| 8 | Finding with `witnesses.length === 1` | No `[N witnesses]` annotation anywhere |
| 9 | Ten P2 findings spread across 6 heuristic_ids, unevenly | POST-PILOT "Short list" shows top 5 groups, final line reads `… and 1 more (see backlog.md)` |
| 10 | All 10 reviewers ran successfully | SKIPPED AGENTS section reads `None (all 10 agents ran successfully).` |
| 11 | `rubricHashes` empty (e.g. because `isolation-reviewer` is the only active agent and has no rubric) | RUN METADATA renders `- Rubric versions: _(no rubrics required for this run's active reviewers)_` |
| 12 | `reviewerModels` missing an entry for an agent that did run | Renderer emits `{unknown}` for that agent in the model summary and logs a stderr warning, does NOT crash |
| 13 | `runEndedAt - runStartedAt = 7_000ms` | Run time renders `7s` (no minute part) |
| 14 | `runEndedAt - runStartedAt = 3_900_000ms` | Run time renders `1h 5m` |
| 15 | `tokens.output = 450` | Token estimate output renders `~450 output` (under-1000 formatter) |
| 16 | `tokens.input = 1_750_000` | Token estimate input renders `~1.8M input` (one decimal place) |
| 17 | `flagString = ""` | Flags line renders `**Flags**: \`(no flags)\`` |
| 18 | Non-UTC server (e.g. TZ=America/Los_Angeles) with `runStartedAt = 2026-04-14T14:32:00Z` | runId = `"2026-04-14-1432"` regardless of host TZ. Title = `"Pilot Review Run — 2026-04-14 14:32"` |
| 19 | Referential transparency | Calling `generateDashboard(input)` twice with the same input produces byte-identical outputs (test with `assert.strictEqual(out1.dashboardMarkdown, out2.dashboardMarkdown)`) |
| 20 | Input `findings` array not mutated | Post-call, `input.findings === originalRef` and `JSON.stringify(input.findings) === originalJson` |
| 21 | `rawFindings` with 50 entries | raw-findings.json contains all 50 entries in input order, pretty-printed |

Every test asserts on final string content and path values. Do NOT test against mock internals — the module has no mocks (it is a pure string producer).

---

## 10. Wiring into the orchestrator

Per Design Doc §12 step 9, the orchestrator calls this module after the final sort:

```ts
// After §12 step 8f: final sort by severity and witness count
const dashboard = generateDashboard({
  findings: sorted,
  rawFindings: rawFindings,                   // pre-dedup, collected at §12 step 8a
  runStartedAt: runStart,
  runEndedAt: new Date(),                     // NOW, at step 9 entry
  flagString: shim.flagString,
  flags: parsedFlags,
  commitSha: await getShortCommitSha(),       // `git rev-parse --short HEAD`
  pluginVersion: pluginJson.version,
  squad: squadState,
  tokens: tokenCounter.total(),
  costUsd: tokenCounter.estimateUsd(),
  eljunLinks: eljunFiler.linksByLocationKey(),
  rubricHashes: rubricCheck.rubricHashes,
  skippedAgents: rubricCheck.skippedAgents.concat(manuallySkippedAgents),
  reviewerModels: AGENT_MODEL_TABLE,           // static §4 table + runtime overrides
  repoRoot: input.repoRoot,
  artifactPaths: artifactRegistry.paths,
});

// Actual file writes — owned by the orchestrator, not this module:
await mkdir(dirname(dashboard.dashboardPath), { recursive: true });
await mkdir(dirname(dashboard.rawFindingsPath), { recursive: true });
await writeFile(dashboard.dashboardPath, dashboard.dashboardMarkdown, "utf8");
await writeFile(dashboard.rawFindingsPath, dashboard.rawFindingsJson, "utf8");

// Print to stdout so the shim can surface it
console.log(`Dashboard: ${dashboard.dashboardPath}`);
```

At the scaffold stage of the orchestrator (T1201), `eljunFiler`, `tokenCounter`, `rubricCheck`, and `artifactRegistry` do not exist yet. The orchestrator passes placeholder values (zeros, empty maps) and renders the `_No findings._` variant of every section. Wiring per-component happens progressively through T1215 (rubric-check), T1216 (dedup), T1217 (verify-claims), T1218 (anchor-validator), T1220 (backlog append), T1221 (review-notes), T1222/T1223 (eljun filer).

### Integration order

```
step 8a  rawFindings = await runSquad(roster, concurrency)       # §12 step 6/7
step 8b  merged      = dedup(rawFindings)                        # T1216
step 8c  verified    = await verifyClaimsPass(merged, repoRoot)  # T1217
step 8d  anchored    = validateRuleLinkAnchors(verified, repoRoot)# T1218
step 8e  sorted      = anchored.sort(severityThenWitnessCount)

step 9a  dashboard   = generateDashboard({ ...sorted, rawFindings, run metadata })  # THIS MODULE
step 9b  orchestrator writes dashboardMarkdown -> dashboardPath
step 9c  orchestrator writes rawFindingsJson   -> rawFindingsPath
step 9d  orchestrator prints `Dashboard: {path}` to stdout
step 9e  T1221 writes review-notes.md from P3 subset
step 9f  T1220 appends backlog.md from P2 subset (skipped if --dry-run)
step 9g  T1222/T1223 file P0+P1 to eljun (skipped if --dry-run)
```

Steps 9e-9g are sidecars — they run AFTER the dashboard is written so the user can open the dashboard even if eljun is unreachable.

---

## 11. Completion criteria (matches task T1219)

- [x] Pure function `generateDashboard(input): DashboardOutput` specified — produces both the dashboard Markdown string and the raw-findings.json string
- [x] Output path `docs/preflight/run-YYYY-MM-DD-HHMM.md` at UTC minute precision (§4.1)
- [x] Artifacts directory `docs/preflight/run-YYYY-MM-DD-HHMM/` with siblings for review-notes, raw-findings, artifacts (§3 Artifact directory; external modules write them per §10)
- [x] All §11 template sections present: Title, Verdict, Squad, Run time, Token estimate, Flags, Commit SHA, BLOCKERS, MUST-FIX (P1), POST-PILOT (P2), REVIEW NOTES (P3), TOP DOMAIN CONCENTRATIONS, FRESHNESS SIGNAL, MONITORING SIGNAL, DRIFT SIGNAL, SKIPPED AGENTS, NEXT ACTIONS, RUN METADATA, footer paragraph (§3 + §4 ordering tables)
- [x] `[N witnesses]` annotation rendered for findings with `witnesses.length >= 2` (§5.3)
- [x] `REFUTED:` (verify-claims) and `rule_link_broken:` (anchor-validator) annotations rendered verbatim (§5.1)
- [x] Dry-run path: eljun cells render `(dry-run — no tasks filed)`, POST-PILOT rewritten, NEXT ACTIONS line-0 prepended (§4.6, §5.1, §7)
- [x] Commit SHA is an input — orchestrator captures via `git rev-parse --short HEAD` per task acceptance criterion; this module formats verbatim
- [x] Token estimate formatted with ~`{k}k` / `{M}M` conventions (§4.3, `formatTokenCount`)
- [x] Run time formatted with s / m / h bands (§4.3, `formatDuration`)
- [x] Reviewer-models-per-agent rendered via `reviewerModels` input; §4 default assignments are the orchestrator's responsibility to populate, not hard-coded here (§4.12 modelSummary, Rule 13 guard #4)
- [x] `raw-findings.json` written (as a string return; orchestrator does the `writeFile`) from the pre-dedup `rawFindings` input (§6)
- [x] Dashboard path returned to stdout via orchestrator-side `console.log` (§10 integration order step 9d)
- [x] Byte-stable output for byte-stable input (pure function — §2 "Purity and side effects", §9 test case 19)
- [x] Empty findings case renders a clean dashboard with zero counts and no crashes (§9 test case 1)
- [x] Locale independence (§8 Rule 13 guard #5, §9 test case 18)

---

## 12. Out of scope

- **`review-notes.md` content** — T1221 module owns that. This module only counts P3s and references the file by name.
- **`backlog.md` append** — T1220 module owns that. This module only references the file by name when P2 items exist.
- **eljun task filing** — T1222/T1223. This module consumes the pre-populated `eljunLinks` map.
- **Per-agent artifact file authoring** — each reviewer writes its own `artifacts/{agent}/*.md`. This module only references the paths via `artifactPaths`.
- **HTML dashboard / web UI** — Markdown is the single output. A future Phase 2 plugin may re-render the MD to HTML, but Phase 1 does not.
- **Historical trend across runs** — Phase 2. Each run is standalone; the dashboard does not link to prior runs.
- **i18n of the dashboard text** — all strings are English. No `next-intl` integration. Reviewers operate in English regardless of the consuming project's UI locales.
- **Auto-scroll / collapsible disclosures** — GitHub's Markdown renderer is the target. `<details>`/`<summary>` HTML is a Phase 2 P1 polish item (see §5.2 note).
- **Delta-from-previous-run summary** — Phase 2. Requires reading prior run files and comparing; out of scope for the pure renderer.

---

## 13. References

- Design Doc: `docs/design/pilot-review-system-design.md` (in the consuming project)
  - §11 "Dashboard Format" — the authoritative template (lines 969–1136, reproduced in §3 of this spec)
  - §12 "Orchestration Flow" step 9 — the invocation placement (lines 1197–1205)
  - §8 "Dedup and Multi-Witness Confidence" — the `[N witnesses]` rule (source of §5.3)
  - §6 "Severity Taxonomy" — P0/P1/P2/P3 semantics
  - §4 "Agent Specifications" — per-reviewer model assignments (source of §4.12 model grouping)
  - §10 "eljun Integration" — `rubric_hash` footer referenced from RUN METADATA
- Canonical Finding schema: `halli-workflows:types/finding.md` (Severity, severityMax, witnesses, evidence, rule_link fields)
- Location-key grammar: `halli-workflows:types/location-key.md` (TOP DOMAIN CONCENTRATIONS prefix dictionary derives from this)
- Plugin version source: `halli-workflows/.claude-plugin/plugin.json` (pluginVersion input)
- Sibling pipeline modules (upstream):
  - `halli-workflows:commands/pilot-review/rubric-check.md` (T1215 — emits `rubricHashes` and initial `skippedAgents` this module consumes)
  - `halli-workflows:commands/pilot-review/dedup.md` (T1216 — emits the post-merge findings array this module's counts are derived from)
  - `halli-workflows:commands/pilot-review/verify-claims-pass.md` (T1217 — injects `REFUTED:` annotations §5.1 renders)
  - `halli-workflows:commands/pilot-review/anchor-validator.md` (T1218 — injects `rule_link_broken:` annotations §5.1 renders)
- Sibling pipeline modules (downstream):
  - `halli-workflows:commands/pilot-review/backlog-appender.md` (T1220 — NOT YET AUTHORED; will read the same `findings` array)
  - `halli-workflows:commands/pilot-review/review-notes.md` (T1221 — NOT YET AUTHORED)
  - `halli-workflows:commands/pilot-review/eljun-filer.md` (T1222/T1223 — NOT YET AUTHORED; populates `eljunLinks`)
- Orchestrator: `halli-workflows:commands/pilot-review-orchestrator.md` (the caller; currently at T1201 scaffold stage — already writes an §11-skeleton dashboard; this module upgrades that skeleton to full findings-aware rendering)
- Task file: `docs/plans/tasks/T1219-output-dashboard-generator.md` (in the consuming project `cabin`)

---

## 14. Change log

| Plugin version | Change |
|----------------|--------|
| (unreleased — authored T1219) | Initial authoring. Module specification only; no plugin version bump per T1219 cross-repo instructions ("DO NOT bump plugin.json. DO NOT sync. DO NOT commit."). Wiring into the orchestrator happens as part of the Phase 1.5 output-fan-out sequence (T1219–T1223) which lands as a single plugin version increment. |

---

## 15. Rule 13 self-check

Before handing this module off, the author verified:

1. Design Doc §11 template copied verbatim into §3 of this spec (visually confirmed against `docs/design/pilot-review-system-design.md` lines 975–1115 on 2026-04-14).
2. Section ordering reconciled: task-file T1219's numbered list omits DRIFT SIGNAL and SKIPPED AGENTS; the task's acceptance criteria reinstate both; Design Doc §11 includes both in the order this module emits (between MONITORING and NEXT ACTIONS). The orchestrator scaffold (T1201) already emits the same order. No invention.
3. Reviewer model assignments (§4.12) are **input-driven**, not hard-coded. The §4 table is documentation only; the `reviewerModels` input is the source of truth at run-time. Rule 13 guard #4 is active.
4. `formatDuration` / `formatTokenCount` / `formatUtcDate` are UTC- and en-US-locale-explicit. No `toLocaleString`. Rule 13 guard #5 active.
5. All external interfaces this module consumes (Finding schema, plugin.json, orchestrator metrics) are real and cited (§13).
6. No test assertion was weakened to make a hypothetical test pass. §9 test cases require exact string output, exact counts, and byte-for-byte snapshot match.
7. `artifacts/` path correction in §4.9.1 is explicitly flagged as a §11 template bug rather than silently emitted — the renderer chooses the correct path AND documents the deviation so the Design Doc author can fix the template in a future edit.

No interface in this module was invented. Every external contract is cited.
