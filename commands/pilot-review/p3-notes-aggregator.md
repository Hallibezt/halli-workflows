---
name: pilot-review/p3-notes-aggregator
description: Orchestrator sub-module — writes `docs/preflight/run-YYYY-MM-DD-HHMM/review-notes.md` containing every P3 finding from the run (grouped by agent), a dedicated `raw-findings.json` export of the pre-dedup raw input, and separate well-labelled sections for operational degradations (REVIEWER_CRASHED, VERIFICATION_UNAVAILABLE, rubric_stub_unfilled, rubric_under_heuristic_minimum, RUBRIC_MISSING under non-halting `--force`, DRIFT_CHECK_UNAVAILABLE, FRESHNESS_REGISTRY_UNAVAILABLE). Rubric-gap findings are called out with actionable "improve your rubric" prompts per Design Doc §12 step 9b. Anchor-broken demotions (demotions from the T1218 rule-link-validator pass that landed findings at P3) are enumerated so the reviewer can see which rule_link references have drifted. P3 items are NOT filed to eljun and NOT appended to backlog.md — this file is the only destination. Empty-safe: writes a valid markdown file even when zero P3 findings exist, so the path always resolves for dashboard cross-linking.
---

**Module Context**: Orchestration pipeline sub-module, consumed by `halli-workflows:pilot-review-orchestrator`. Authored per Design Doc §6 (P3 destination), §11 (dashboard links to `review-notes.md`), §12 step 9b (output routing), §13 Q2/Q3 (fail-open crash + verifier-unavailable policy), and Task T1221. See `docs/design/pilot-review-system-design.md` in the consuming project (`cabin`). See also task spec `docs/plans/tasks/T1221-output-p3-notes.md`.

**Placement rationale**: This module lives under `commands/pilot-review/` because the halli-workflows plugin is pure-markdown (no TypeScript build step — see `halli-workflows:types/README.md`). Each orchestration pipeline stage is a specification document the orchestrator's inlined implementation follows. The orchestrator references this file when authoring its output-routing logic; the file is NOT an independently-registered command in `plugin.json`.

**Depends on**: `halli-workflows:types/finding.md` (canonical Finding schema), `halli-workflows:types/location-key.md` (grammar for rubric-gap keys), `halli-workflows:pilot-review-orchestrator` (caller). Runs AFTER dedup (T1216), `/verify-claims` (T1217), rule-link validation (T1218), and dashboard render (T1219) — this aggregator is the SECOND output artifact written per run (dashboard first at top-level `docs/preflight/run-YYYY-MM-DD-HHMM.md`, then this at nested `docs/preflight/run-YYYY-MM-DD-HHMM/review-notes.md`, then `raw-findings.json` alongside).

---

## 1. Purpose

P3 findings are low-signal observations, reviewer-uncertain notes, rubric gaps surfaced by agents, and degraded-run signals (agent crashes, verifier unavailability, drift-check errors, freshness registry outages). Per Design Doc §6:

> **P3 — Notes**: Reviewer uncertainty, rubric gaps surfaced by the agent, low-signal observations, items the reviewer thought worth mentioning but is not confident about.
>
> **Destination**: aggregated into `docs/preflight/run-*/review-notes.md`. Not filed anywhere actionable. Useful for rubric evolution — if a reviewer keeps flagging the same P3, the rubric should probably codify it as P1/P2.

This module is the single writer of that aggregate. Key design anchors:

- **Preserve full evidence strings — no truncation.** P3 notes are the deep-dive artifact. The dashboard truncates; `review-notes.md` does not. A reviewer auditing "why did the verifier refute this?" or "what rubric gap did the agent see?" reads this file.
- **Group by agent so the file is scannable.** One H2 per agent; all that agent's P3 items in one place.
- **Rubric evolution surfacing.** When the same `heuristic_id` appears 3+ times across the run, suggest promoting it to the corresponding rubric (human decides — we do NOT auto-promote).
- **Operational degradation visibility.** Agent crashes, verifier outages, drift-check config errors, and freshness registry failures ARE findings (P3 per §13). They each get a dedicated section at the TOP of the file so the reader sees them first — these are the signals that indicate the run itself was degraded, not just a normal low-signal observation.
- **Empty-safe.** When a run has zero P3 findings, write the file anyway with `_No P3 notes this run._` in each section. The dashboard's "REVIEW NOTES" summary line links to this file; the path must always exist.
- **Dry-run writes normally.** P3 notes are informational, not state-changing. `--dry-run` does not suppress this write (unlike eljun filing or backlog append which mutate external state).

## 2. Contract

### Input

```
input: {
  findings: Finding[],            // FINAL post-pipeline findings (after dedup, /verify-claims, rule-link validation, sort)
  rawFindings: Finding[],         // PRE-dedup raw findings (same array the orchestrator passes through unchanged; needed for raw-findings.json)
  runId: string,                  // UTC timestamp, `YYYY-MM-DD-HHMM` form (matches dashboard)
  runIdDisplay: string,           // Human-readable form for headings, `YYYY-MM-DD HH:MM` with a space
  outputDir: string,              // Absolute path to the run directory, e.g. `/home/halli/cabin/docs/preflight/run-2026-04-14-1432`
  dashboardRelPath: string,       // Relative path from review-notes.md up to the dashboard .md file — ALWAYS `../run-YYYY-MM-DD-HHMM.md`
  pluginVersion: string,          // e.g. `1.3.0` read from halli-workflows/.claude-plugin/plugin.json
  rubricRegistry: Record<string, string>,  // Map of heuristic_id prefix → rubric file path. See §4.2. Used to render promotion suggestions.
}
```

`Finding` is the canonical schema at `halli-workflows:types/finding.md`. All 10 required fields must be present on every input finding (the orchestrator's Zod validator has already confirmed this upstream — this module does NOT re-validate).

`findings` is the POST-processing array (the one the dashboard renders from). `rawFindings` is the PRE-dedup array (every reviewer's raw output) used only for `raw-findings.json`. Keeping both is deliberate: the dashboard and review-notes reflect the curated state; `raw-findings.json` preserves the unaggregated audit trail per Design Doc §11 "Artifact directory" and §12 step 9d.

### Output

The module writes TWO files and returns a summary object:

```
output: {
  reviewNotesPath: string,        // Absolute path to the written review-notes.md
  rawFindingsPath: string,        // Absolute path to the written raw-findings.json
  p3Count: number,                // Total P3 findings (length of findings.filter(f => f.severity === "P3"))
  promotionSuggestions: Array<{ heuristic_id: string; count: number; rubric_path: string | null }>,
}
```

### Side effects

- Creates `outputDir` if it does not exist (`mkdir -p` semantics). The orchestrator may have created it already during dashboard write — idempotent creation is required.
- Writes `{outputDir}/review-notes.md` (overwrites if exists — each run is fresh).
- Writes `{outputDir}/raw-findings.json` (overwrites if exists).
- Does NOT write to the top-level `docs/preflight/run-YYYY-MM-DD-HHMM.md` (that is the dashboard, owned by T1219).
- Does NOT mutate any finding object (the input `findings` array is read-only).
- Does NOT invoke external services, call eljun, or touch source code.
- Prints no stdout (the orchestrator prints the dashboard path; this module is silent on success).

---

## 3. Output File Layout

```
docs/preflight/
└── run-YYYY-MM-DD-HHMM.md          ← dashboard (owned by T1219 — NOT touched by this module)
└── run-YYYY-MM-DD-HHMM/
    ├── review-notes.md             ← owned by THIS module (T1221)
    ├── raw-findings.json           ← owned by THIS module (T1221)
    └── artifacts/                  ← owned by individual agents (per-reviewer artifact writes)
```

The dashboard lives at the TOP LEVEL of `docs/preflight/`. This aggregator's outputs live in a SUBDIRECTORY named identically to the dashboard file (minus the `.md` suffix). The dashboard's `## REVIEW NOTES (P3)` section links into `run-YYYY-MM-DD-HHMM/review-notes.md` via the relative path `run-YYYY-MM-DD-HHMM/review-notes.md`; `review-notes.md` links back to the dashboard via `../run-YYYY-MM-DD-HHMM.md` (one level up, because `review-notes.md` is one directory deeper).

---

## 4. `review-notes.md` Template

### 4.1 Template (illustrative — empty placeholders shown)

```markdown
# P3 Review Notes — Run {runIdDisplay}

See dashboard: [{dashboardRelPath}]({dashboardRelPath})

**Total P3 findings**: {p3Count}
**Plugin version**: `halli-workflows@{pluginVersion}`

> This file aggregates every P3 finding from the run. P3 is the "notes" severity — reviewer uncertainty, rubric gaps, and low-signal observations. P3 findings are NOT filed to eljun and NOT appended to `docs/plans/backlog.md`. They live here for rubric evolution and post-hoc review.

---

## OPERATIONAL DEGRADATIONS

> Signals that the run itself was degraded (agent crashes, verifier outages, tool unavailability). These are fail-open P3 notes per Design Doc §13 — the run completed but is not at full fidelity.

### Reviewer Crashes — `REVIEWER_CRASHED` [N]

> Agents that failed catastrophically. Per §13 Q2: fail-open with a P3 note is the policy — the other reviewers' output is still in the dashboard. Crashed agents also appear in the dashboard's "SKIPPED AGENTS" section.

_No reviewer crashes this run._

### Verifier Unavailable — `VERIFICATION_UNAVAILABLE` [N]

> `/verify-claims` post-pass failed. Per §13 Q3: findings from the P0/P1 verify bucket passed through without verification. Dashboard annotates affected findings with "not verified this run."

_The /verify-claims post-pass completed this run._

### Drift Check Unavailable — `DRIFT_CHECK_UNAVAILABLE` [N]

> `npm run drift:json` exited with configuration error or unparseable output. Per `docs/drift-gate.md`: drift state is UNKNOWN for this run — NOT verified clean. Do NOT interpret the absence of drift findings as a green drift signal.

_Drift-check completed this run._

### Freshness Registry Unavailable — `dep.check_unavailable` / `FRESHNESS_REGISTRY_UNAVAILABLE` [N]

> npm / GHSA / deps.dev registries unreachable. Freshness findings for the affected source are missing from this run. Re-run `/pilot-review` with network access for accurate CVE and deprecation signal.

_Freshness registries reached this run._

### Rubric Freshness Registry Unavailable — other `*_UNAVAILABLE` signals [N]

> Additional operational P3s not matched above (future categories land here automatically via the catch-all matcher).

_No additional operational degradations._

---

## RUBRIC GAPS — "IMPROVE YOUR RUBRICS"

> These findings indicate rubric files that are missing, stubbed, or too short. They are actionable for the human reviewer. Fix the rubric, then re-run `/pilot-review`.

### Missing Rubric Files — `RUBRIC_MISSING` [N]

> Only present when the run was invoked with `--force` (non-halting mode). Without `--force`, a missing rubric halts the run and the dashboard shows P0 RUBRIC_MISSING only.

_No missing rubrics this run._

### Unfilled Rubric Stubs — `rubric_stub_unfilled` [N]

> Rubric files that still begin with the scaffold banner `# ⚠ This rubric is a scaffold`. The corresponding reviewers ran in degraded mode — they emitted their own `rubric_stub_unfilled` findings at P1, plus the orchestrator emitted one at P1 for dashboard visibility. If any P3-tier duplicates landed here (via demotion), they are listed.

_No rubric stubs this run._

### Under-Minimum Rubric Coverage — `rubric_under_heuristic_minimum` [N]

> Rubric files with fewer than 5 heuristic headings per Design Doc §9. Short rubrics invite hallucination. Expand the rubric.

_No rubrics below the minimum this run._

---

## ANCHOR-BROKEN DEMOTIONS

> Findings whose `rule_link` anchor did not resolve on the target file, AND whose severity was demoted to P3 by the rule-link validator (T1218). If the file itself was missing, the hard-demote-to-P3 rule applies and the evidence field includes `rule_link_file_missing: <path>`. If the anchor was missing but the file existed, the evidence includes `rule_link_broken: <path>#<slug> (did you mean #<suggestion>?)`.

_No anchor-broken demotions this run._

---

## P3 FINDINGS BY AGENT

> The core P3 signal. Grouped by originating agent (primary — not witnesses). Items within each agent's section are ordered as they appear in the input `findings` array (post-sort by severity + witness count per T1216/T1219 pipeline).

_No P3 notes this run._

---

## RUBRIC EVOLUTION SIGNAL

> Heuristic IDs that appeared 3+ times in this run. These are candidates for promotion: if a reviewer keeps flagging the same pattern, the rubric should probably codify it as P1/P2 so the pattern becomes an explicit rule rather than a repeated reviewer observation. This is a soft signal — a human decides whether to promote.

_No heuristic_id appeared 3+ times this run._

---

## RAW FINDINGS JSON

The complete pre-aggregation raw finding output from every reviewer (one per witness, before dedup) is captured in the sibling file `raw-findings.json` alongside this file. Every finding there matches the canonical schema at `halli-workflows:types/finding.md`. Use it to:

- Audit individual reviewer behavior before merge (dedup may have combined multiple witness findings into one).
- Replay failures deterministically when debugging a reviewer prompt.
- Compute run-over-run heuristic-frequency statistics (out of scope for Phase 1, but the data is here if needed).

---

*Generated by `halli-workflows:pilot-review/p3-notes-aggregator` (see `commands/pilot-review/p3-notes-aggregator.md`). See Design Doc §6, §11, §12 step 9b, §13 for authoritative destination and format rules.*
```

### 4.2 Heuristic-to-rubric registry

The "Rubric Evolution Signal" section suggests promoting a `heuristic_id` to a specific rubric when its occurrence count ≥ 3. The mapping from heuristic_id prefix → rubric path is passed in via `input.rubricRegistry`. Phase 1 GuestPad default (supplied by the orchestrator — this module does not hard-code it):

```json
{
  "gdpr.": "docs/review-rubrics/privacy-gdpr.md",
  "pay.":  "docs/review-rubrics/payment.md",
  "mon.":  "docs/review-rubrics/monitoring.md"
}
```

Heuristic IDs whose dotted prefix does not match any registry entry get a `null` rubric_path in the promotion suggestion — the suggestion still surfaces the ID and count, just without a target rubric ("Consider codifying `<heuristic_id>` in an appropriate rubric — no current rubric mapped to prefix").

Heuristic IDs `RUBRIC_MISSING`, `VERIFICATION_UNAVAILABLE`, `REVIEWER_CRASHED`, `rubric_stub_unfilled`, `rubric_under_heuristic_minimum`, `drift.unavailable`, `drift.detected`, `dep.check_unavailable`, `dep.registry_rate_limited`, `dep.socket_unavailable`, `dep.manifest_unsupported` are the **operational / meta heuristics** — they are NEVER candidates for promotion (they describe tool state, not code/domain patterns). They are excluded from the rubric-evolution suggestion list even at 3+ occurrences.

### 4.3 Section-fill algorithm

When a section has at least one matching finding, the `_No <description> this run._` placeholder is replaced with a list of entries. Each entry renders the full finding using the per-finding template (§4.4).

When a section is empty, the placeholder stays. This ensures the shape of the file is invariant across runs (a reviewer reading `review-notes.md` always sees the same section headers in the same order).

### 4.4 Per-finding render template

Every finding in every section (operational degradations, rubric gaps, anchor-broken demotions, P3 findings by agent) renders using the same template. This keeps the file scannable and consistent.

```markdown
#### {index}. {heuristic_id} — `{location_key}`

- **Agent**: `{agent}` (primary){witnesses_suffix}
- **Severity**: {severity} ({demotion_annotation_if_any})
- **Rule link**: [`{rule_link}`]({rule_link_resolvable_or_raw})
- **Evidence**: {evidence_full_no_truncation}
- **Suggested fix**: {suggested_fix}
```

Template variables:

- `{index}` — 1-based within the section. Reset per section.
- `{heuristic_id}` — finding's `heuristic_id` field, literal.
- `{location_key}` — finding's `location_key` field, backticked for readability.
- `{agent}` — finding's `agent` field (primary, not witnesses).
- `{witnesses_suffix}` — if `witnesses.length >= 2`, render ` [{N} witnesses: {a, b, c}]`; else empty string. The comma-separated list preserves input order of `witnesses`.
- `{severity}` — always `P3` in this file. Kept literal for consistency with dashboard.
- `{demotion_annotation_if_any}` — if `evidence` contains `REFUTED:`, `rule_link_broken:`, `rule_link_file_missing:`, or `rule_link_malformed:`, annotate inline: e.g. `(demoted by /verify-claims)`, `(demoted by rule-link validator — anchor broken)`, `(demoted by rule-link validator — file missing)`, `(demoted by rule-link validator — malformed link)`. Detection is by substring match on the evidence string. If none, empty parens `()` are omitted entirely.
- `{rule_link_resolvable_or_raw}` — For URLs (`http://`, `https://`), render as a markdown link. For `path#anchor`, render as `{repoRoot-relative}` path without link resolution (we are not resolving anchors here — T1218 already did that; just render the literal for copy-paste). For bare paths, same — literal. Never apply slug transforms here.
- `{evidence_full_no_truncation}` — finding's `evidence` field verbatim. No truncation. If the string contains newlines, preserve them (markdown renders as space-joined but the raw text remains correct for grep).
- `{suggested_fix}` — finding's `suggested_fix` field verbatim.

Rationale for no truncation: the dashboard (§11) is the scannable overview — it may truncate. `review-notes.md` is the audit file. Truncating here defeats the purpose (a future reviewer comparing "what did run A see vs run B" needs the full strings).

---

## 5. Section-to-finding mapping

Each finding in the input `findings` array is routed to exactly one section. The mapping is deterministic and priority-ordered (first match wins):

| Priority | Section | Match predicate |
|----------|---------|-----------------|
| 1 | Reviewer Crashes | `heuristic_id === "REVIEWER_CRASHED"` |
| 2 | Verifier Unavailable | `heuristic_id === "VERIFICATION_UNAVAILABLE"` |
| 3 | Drift Check Unavailable | `heuristic_id === "drift.unavailable"` OR `location_key` matches `/^mon:drift-gate:/` |
| 4 | Freshness Registry Unavailable | `heuristic_id` starts with `dep.` AND ends with `_unavailable`, `_rate_limited`, `_unsupported` (i.e. the 4 freshness-reviewer operational IDs: `dep.check_unavailable`, `dep.registry_rate_limited`, `dep.socket_unavailable`, `dep.manifest_unsupported`) |
| 5 | Other `*_UNAVAILABLE` | `heuristic_id` ends with `_UNAVAILABLE` (uppercase) AND not already matched above — catch-all for future operational heuristics |
| 6 | Missing Rubric Files | `heuristic_id === "RUBRIC_MISSING"` (only reachable at P3 when `--force` demotes — orchestrator's ceiling rules keep `RUBRIC_MISSING` at P0 in normal runs per §6) |
| 7 | Unfilled Rubric Stubs | `heuristic_id === "rubric_stub_unfilled"` |
| 8 | Under-Minimum Rubric Coverage | `heuristic_id === "rubric_under_heuristic_minimum"` |
| 9 | Anchor-Broken Demotions | `evidence` contains any of: `rule_link_broken:`, `rule_link_file_missing:`, `rule_link_malformed:` AND NOT already matched above |
| 10 | P3 Findings by Agent | All remaining P3 findings (default bucket) |

**Filtering**: The module considers only findings where `severity === "P3"`. Findings at P0/P1/P2 are never rendered here (they go to the dashboard, eljun, or backlog respectively). If the orchestrator's pipeline somehow produced a non-P3 finding in the input, the module drops it at the section-routing step and logs a stderr warning `p3-notes-aggregator: unexpected non-P3 severity in input, skipping: <location_key>`.

**Priority-ordering rationale**:

- Operational degradations go first so the reader sees "this run was degraded" before wading through regular notes.
- Rubric gaps go second because they indicate a systemic issue (the rubric itself) rather than a code/domain issue.
- Anchor-broken demotions go third because they indicate a doc-reference issue that crosses the rubric/finding boundary.
- Regular P3 findings go last because they are the most common category and the reader scrolls past the above to reach them.

**Ordering within a section**: The input `findings` array is already sorted by severity then witness count descending (from T1216 dedup + T1219 dashboard sort). Within the P3 bucket, witness count descending is the dominant order. This module preserves that order within each section — it filters the P3 bucket into sections but does NOT re-sort.

---

## 6. `raw-findings.json` format

Write `input.rawFindings` (the PRE-dedup array) to `{outputDir}/raw-findings.json` as pretty-printed JSON (2-space indent) with a UTF-8 BOM-less encoding. The schema is an array of `Finding` objects per `halli-workflows:types/finding.md`.

```json
[
  {
    "agent": "isolation-reviewer",
    "severity": "P0",
    "rule_link": "CLAUDE.md#rule-0-the-isolation-hierarchy-supreme-rule",
    "verdict": "fail",
    "evidence": "apps/guestpad/supabase/migrations/058_foo.sql:12 — table `bar` lacks RLS policy",
    "location_key": "db:bar:rls_missing",
    "heuristic_id": "iso.rls.missing",
    "suggested_fix": "Add `CREATE POLICY property_isolation ON bar FOR SELECT USING (property_id = current_setting('request.jwt.claim.property_id')::uuid);`",
    "screenshot": null,
    "witnesses": ["isolation-reviewer"]
  },
  {
    "agent": "auth-boundary-reviewer",
    "severity": "P0",
    "rule_link": "CLAUDE.md#rule-2-three-tier-authentication-non-negotiable",
    "verdict": "fail",
    "evidence": "apps/guestpad/src/app/api/bar/route.ts:18 — queried from anon-authenticated route without owner check",
    "location_key": "db:bar:rls_missing",
    "heuristic_id": "auth.anon_route_queries_tenant_table",
    "suggested_fix": "Add auth.getUser() call and filter by owner_id before the .from('bar') read.",
    "screenshot": null,
    "witnesses": ["auth-boundary-reviewer"]
  }
]
```

Note that in the above illustrative example the two findings share a `location_key` — they are the raw per-agent inputs BEFORE dedup collapsed them into one finding with `witnesses: ["isolation-reviewer", "auth-boundary-reviewer"]`. That raw shape is preserved in `raw-findings.json` for audit per Design Doc §12 step 9d. The dashboard and `review-notes.md` render the merged post-dedup shape.

**Empty-safe**: When `rawFindings.length === 0`, write the literal `[]` array. Do NOT omit the file.

**Do not deviate from canonical order**: preserve the input array order exactly. The orchestrator's fan-out produces findings in a semi-deterministic order (agents emit as they complete); downstream consumers may rely on this for reproducibility. Sorting or reshuffling would break replay.

---

## 7. Algorithm (step-by-step)

```
function aggregateP3Notes(input):

  # Step 1 — Ensure output directory exists (mkdir -p semantics).
  mkdir_recursive(input.outputDir)

  # Step 2 — Write raw-findings.json first. This file is independent of the P3
  # findings — it writes the PRE-dedup raw array regardless of P3 count.
  writeFile(
    path: input.outputDir + "/raw-findings.json",
    content: JSON.stringify(input.rawFindings, null, 2) + "\n"   # trailing newline convention
  )

  # Step 3 — Filter to P3 findings only. Log non-P3 intrusions.
  p3Findings = []
  for f in input.findings:
    if f.severity === "P3":
      p3Findings.push(f)
    else if f.severity in {"P0", "P1", "P2"}:
      # Normal — not a P3. These go elsewhere (dashboard / eljun / backlog).
      continue
    else:
      # Unexpected — log to stderr.
      console.error("p3-notes-aggregator: unexpected non-P3 severity in input, skipping: " + f.location_key)

  # Step 4 — Route each P3 into a section bucket. See §5 priority table.
  buckets = {
    reviewerCrashed:           [],
    verificationUnavailable:   [],
    driftCheckUnavailable:     [],
    freshnessRegistryUnavailable: [],
    otherUnavailable:          [],
    rubricMissing:             [],
    rubricStubUnfilled:        [],
    rubricUnderMinimum:        [],
    anchorBrokenDemotions:     [],
    byAgent:                   Map<string, Finding[]>()  # key: agent name, preserves insertion order
  }

  for f in p3Findings:
    section = routeFindingToSection(f)
    if section === "byAgent":
      bucket = buckets.byAgent.get(f.agent) or []
      bucket.push(f)
      buckets.byAgent.set(f.agent, bucket)
    else:
      buckets[section].push(f)

  # Within each bucket, ordering is already correct (inherited from input array order).
  # No additional sort needed.

  # Step 5 — Compute heuristic-evolution statistics (only over the "byAgent" bucket —
  # operational/rubric/anchor buckets are excluded per §4.2).
  heuristicCounts = new Map<string, int>()
  for [_, findings] of buckets.byAgent:
    for f in findings:
      heuristicCounts.set(f.heuristic_id, (heuristicCounts.get(f.heuristic_id) or 0) + 1)

  # Strip the operational / meta heuristics (never candidates for promotion).
  excludedPromotionIds = Set([
    "RUBRIC_MISSING", "VERIFICATION_UNAVAILABLE", "REVIEWER_CRASHED",
    "rubric_stub_unfilled", "rubric_under_heuristic_minimum",
    "drift.unavailable", "drift.detected",
    "dep.check_unavailable", "dep.registry_rate_limited",
    "dep.socket_unavailable", "dep.manifest_unsupported"
  ])

  promotionSuggestions = []
  for [heuristicId, count] of heuristicCounts:
    if count < 3:
      continue
    if excludedPromotionIds.has(heuristicId):
      continue
    rubric_path = lookupRubricForHeuristic(heuristicId, input.rubricRegistry)  # see §4.2
    promotionSuggestions.push({ heuristic_id: heuristicId, count, rubric_path })

  # Sort promotion suggestions by count descending, then heuristic_id alphabetically
  # (stable tie-breaker for deterministic output).
  promotionSuggestions.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.heuristic_id.localeCompare(b.heuristic_id)
  })

  # Step 6 — Render markdown and write review-notes.md.
  markdown = renderMarkdown(input, buckets, promotionSuggestions, p3Findings.length)
  writeFile(
    path: input.outputDir + "/review-notes.md",
    content: markdown
  )

  # Step 7 — Return summary to orchestrator (which may log it).
  return {
    reviewNotesPath: input.outputDir + "/review-notes.md",
    rawFindingsPath: input.outputDir + "/raw-findings.json",
    p3Count: p3Findings.length,
    promotionSuggestions
  }
```

### 7.1 `routeFindingToSection(f)` — the section dispatcher

```
function routeFindingToSection(f) → string:
  # Priority 1: Reviewer crashes.
  if f.heuristic_id === "REVIEWER_CRASHED":
    return "reviewerCrashed"

  # Priority 2: Verifier unavailable.
  if f.heuristic_id === "VERIFICATION_UNAVAILABLE":
    return "verificationUnavailable"

  # Priority 3: Drift check unavailable.
  if f.heuristic_id === "drift.unavailable":
    return "driftCheckUnavailable"
  if f.location_key.startsWith("mon:drift-gate:"):
    return "driftCheckUnavailable"

  # Priority 4: Freshness registry unavailable (4 known operational IDs).
  if f.heuristic_id in {"dep.check_unavailable", "dep.registry_rate_limited",
                        "dep.socket_unavailable", "dep.manifest_unsupported"}:
    return "freshnessRegistryUnavailable"

  # Priority 5: Other operational unavailability (catch-all for future IDs).
  if f.heuristic_id.endsWith("_UNAVAILABLE"):
    return "otherUnavailable"

  # Priority 6: Missing rubric at P3 (only reachable under --force demotion).
  if f.heuristic_id === "RUBRIC_MISSING":
    return "rubricMissing"

  # Priority 7: Stubbed rubric.
  if f.heuristic_id === "rubric_stub_unfilled":
    return "rubricStubUnfilled"

  # Priority 8: Under-minimum rubric.
  if f.heuristic_id === "rubric_under_heuristic_minimum":
    return "rubricUnderMinimum"

  # Priority 9: Anchor-broken demotions (evidence-based match).
  if f.evidence.includes("rule_link_broken:") or
     f.evidence.includes("rule_link_file_missing:") or
     f.evidence.includes("rule_link_malformed:"):
    return "anchorBrokenDemotions"

  # Priority 10: Default — regular P3 by agent.
  return "byAgent"
```

### 7.2 `lookupRubricForHeuristic(heuristicId, registry)` — rubric mapping

```
function lookupRubricForHeuristic(heuristicId, registry) → string | null:
  # Find the longest-prefix match. E.g. `gdpr.pii_in_logs` matches the prefix `gdpr.`.
  # Registry keys are dotted prefixes ending in `.`.
  best = null
  bestLen = 0
  for [prefix, rubricPath] of registry:
    if heuristicId.startsWith(prefix) and prefix.length > bestLen:
      best = rubricPath
      bestLen = prefix.length
  return best
```

Longest-prefix match is used so a future more-specific mapping (e.g. `gdpr.pii.` → `docs/review-rubrics/privacy-gdpr-pii.md`) takes precedence over a shorter prefix (`gdpr.` → `docs/review-rubrics/privacy-gdpr.md`). Phase 1 GuestPad has no nested mappings, so this reduces to simple prefix match, but the algorithm handles future extension.

---

## 8. Edge cases and defensive behavior

- **Empty `findings` array**: Write the file with every section showing its `_No ... this run._` placeholder. `p3Count` = 0 rendered in the header. Promotion suggestions section shows `_No heuristic_id appeared 3+ times this run._`. **File is still written** — dashboard cross-link always resolves.
- **Empty `rawFindings` array**: Write `raw-findings.json` as `[]\n`. Still exists — debug tooling relies on the file's presence.
- **Dashboard path that does not match the expected `../run-YYYY-MM-DD-HHMM.md` pattern**: Trust the caller — render the `dashboardRelPath` as-is. We do NOT validate or transform it. If the caller passes a malformed path, the resulting markdown link may be broken, but the aggregator is not the right place to enforce path conventions.
- **`findings` contains non-P3 entries**: Drop silently-with-warning (console.error) per Step 3. Do NOT halt. The dashboard handles P0/P1/P2 correctly; those slipping into this module is a caller bug but should not block the output.
- **`rawFindings` contains malformed entries** (missing fields): Write them to JSON as received — the orchestrator's Zod already validated upstream, and `raw-findings.json` is a verbatim dump for audit. If a malformed entry slipped through, the audit file will expose it (signal, not silent failure).
- **Heuristic ID with ≥ 3 occurrences but excluded from promotion**: Not rendered in Rubric Evolution Signal section. The exclusion set in §7 Step 5 handles this.
- **Same heuristic ID appearing in both `byAgent` bucket AND operational bucket** (should not happen by routing logic but defensive): Only counted once per finding — a finding is routed to exactly one section. Promotion count is over `byAgent` findings only.
- **Output directory cannot be created (filesystem permission error)**: Propagate the error — the orchestrator surfaces it as a run failure. Do NOT silently swallow.
- **`outputDir` already exists**: Idempotent — the orchestrator may have created it for the dashboard run. Do not fail.
- **Finding with a `\0` null byte in evidence** (malformed upstream): Write as-is — the agent emitted it, the Zod schema accepts any non-empty string, and JSON.stringify handles nulls. The markdown renderer may render it as a control character; that is the agent's problem to emit a cleaner evidence string, not this module's to sanitize.
- **Finding with multi-line evidence**: Render verbatim. Markdown renders newlines inside a list-item block as soft-breaks (no effect on paragraph break); the raw text is preserved for grep and copy-paste.
- **Rubric-evolution promotion count tie**: Stable secondary sort by `heuristic_id.localeCompare` — deterministic output across runs with identical inputs.

---

## 9. Rule 13 / Intellectual Honesty Guardrails

This module is a pure aggregator. The Rule 13 failure modes we must actively avoid:

- **No fabricated findings.** The output `review-notes.md` lists exactly the P3 findings the caller passed in, routed into sections by their own `heuristic_id` / `location_key` / `evidence` strings. We do NOT invent a P3 when a section is empty ("insert placeholder note to fill the void") — empty sections render `_No ... this run._` verbatim so the reader can see the category is clean.
- **No truncation.** The evidence field is rendered verbatim. This is the audit file — the dashboard is the scannable view. Truncating here would destroy the value proposition.
- **No silent dropping.** Non-P3 findings that slip into the input are logged to stderr before being dropped. The raw-findings.json is always written in full.
- **No auto-promotion.** The "Rubric Evolution Signal" section is a **suggestion**, not automation. A human decides whether to codify `iso.rls.missing` in the isolation rubric. This module surfaces the count; it does not edit the rubric.
- **No invented external interfaces.** We write exactly two files (`review-notes.md`, `raw-findings.json`) under `outputDir`. We do not call eljun, we do not write to `docs/plans/backlog.md`, we do not modify source code. The path constraints are bounded by the module's contract.
- **No placeholder evidence.** When a finding has `suggested_fix: "(none — manual triage required)"`, render that literal string — do NOT substitute "N/A" or elide the field.
- **Test the behavior, not the mock.** Test assertions are on the rendered markdown content, the written JSON shape, and the returned summary object. Tests that check "did we call the file-write function with the right path" pass the mock but prove nothing about the output. See §10.

---

## 10. Testing

### 10.1 Fixtures

The implementer MUST author tests covering these fixtures. Tests are pure (the module has file I/O but no network/LLM calls — snapshot-style testing works well).

| # | Fixture | Expected behavior |
|---|---------|-------------------|
| 1 | 15 P3 findings across 3 agents (5 each), no operational degradations, no rubric gaps, no anchor breaks | All 15 appear under "P3 FINDINGS BY AGENT" grouped into 3 subheadings. Operational / rubric / anchor sections render their empty placeholders. File length reflects full evidence (no truncation). |
| 2 | 0 P3 findings | File still written. Every section shows its `_No ... this run._` placeholder. Header shows `**Total P3 findings**: 0`. `raw-findings.json` written (even if the raw array itself is non-empty from P0/P1 findings). |
| 3 | `heuristic_id = "iso.rls.missing"` appearing 5 times in the `byAgent` bucket | "Rubric Evolution Signal" section lists `iso.rls.missing` with count 5 and a promotion suggestion. If `rubricRegistry` has no `iso.` prefix, `rubric_path` is null and the suggestion text reflects "no current rubric mapped". |
| 4 | Mix of 3 REVIEWER_CRASHED, 2 VERIFICATION_UNAVAILABLE, 1 rubric_stub_unfilled, 1 DRIFT_CHECK_UNAVAILABLE, 10 regular P3 | Each category appears in its dedicated section with the right count. "P3 FINDINGS BY AGENT" contains exactly 10 (not 17 — operational/rubric are routed out of this bucket). |
| 5 | 1 finding with `heuristic_id: "RUBRIC_MISSING"` at P3 (only reachable under --force demotion) | Appears in "Missing Rubric Files" section, not in "P3 FINDINGS BY AGENT". |
| 6 | 2 findings with evidence containing `rule_link_broken:` substring | Both routed to "Anchor-Broken Demotions" section. Inline `(demoted by rule-link validator — anchor broken)` annotation rendered. |
| 7 | 1 finding with evidence containing `rule_link_file_missing:` substring | Routed to "Anchor-Broken Demotions". Inline `(demoted by rule-link validator — file missing)` annotation rendered. |
| 8 | 3 findings with `witnesses: ["a", "b", "c"]` (length 3) | ` [3 witnesses: a, b, c]` suffix appears on each of the 3 entries' rendered Agent line. |
| 9 | A P0 finding accidentally in `input.findings` (orchestrator bug) | Stderr warning logged; finding NOT rendered. File still written. Test asserts stderr content AND verifies the P0 finding's `location_key` does not appear anywhere in `review-notes.md`. |
| 10 | `input.rawFindings` is 50 findings, `input.findings` is 20 (dedup reduced) | `raw-findings.json` contains 50 entries; `review-notes.md` sections total exactly the P3 subset of 20. |
| 11 | Promotion-count ties (two heuristics each appearing 3 times) | Both listed, sorted alphabetically by heuristic_id. |
| 12 | `dep.check_unavailable` appears 4 times (network was flaky) | Routed to "Freshness Registry Unavailable" section. Does NOT appear in promotion suggestions (excluded per §7 Step 5). |
| 13 | A finding with evidence containing a newline (`\n`) | Evidence rendered with the newline preserved; markdown may render it as soft-break but raw file content is byte-identical to input. |
| 14 | A finding with evidence referencing `rule_link_malformed:` | Routed to "Anchor-Broken Demotions", inline annotation `(demoted by rule-link validator — malformed link)`. |
| 15 | Two runs back-to-back with identical inputs | Byte-identical output files (deterministic render — stable sort, stable hash-free output). |
| 16 | `outputDir` already exists with stale `review-notes.md` from a prior run | File is overwritten cleanly; no merge of prior content. |
| 17 | `findings` array empty, `rawFindings` array empty | Both output files written: `review-notes.md` with empty placeholders, `raw-findings.json` literally `[]`. |
| 18 | A finding with `suggested_fix: "(none — manual triage required)"` | That literal string appears in the rendered fix field — NOT substituted with "N/A". |
| 19 | A finding in the "other unavailable" catch-all (heuristic `FOO_UNAVAILABLE` that doesn't match known operational IDs) | Routed to "Other Unavailable" section. |

### 10.2 Snapshot testing

Golden-file comparison for fixtures 1, 2, and 4 ensures the markdown shape is stable run-to-run. Commit the snapshots under `halli-workflows/lib/orchestrator/__snapshots__/p3-notes-aggregator/`.

### 10.3 Do-not-weaken assertions

Tests MUST assert:

- Exact markdown string content for at least one key section per fixture.
- Exact `raw-findings.json` JSON content for the 50-finding fixture.
- Full evidence strings are present byte-for-byte in the rendered file (NO truncation).
- Promotion-suggestion list is in the expected order.
- Stderr warnings are emitted for unexpected-severity inputs.

Tests MUST NOT:

- Only check that a file exists (weak — doesn't validate content).
- Mock the writeFile function and only verify it was called (Rule 13 — testing the mock, not the behavior).
- Use `toBeTruthy()` or `toBeDefined()` for content assertions (weak — any non-empty string passes).

---

## 11. Integration with the orchestrator

Consumption point: `halli-workflows:pilot-review-orchestrator` at Step 6 (Output Fan-Out). The aggregator runs AFTER the dashboard write, so by the time it runs:

- `runId` and `outputDir` are computed.
- `findings` has been through dedup (T1216), `/verify-claims` (T1217), rule-link validation (T1218), and sort (per T1219 pipeline).
- `rawFindings` is the unaggregated array from the fan-out semaphore (T1225) — preserved separately from `findings` for the raw-findings.json export.
- The dashboard at `docs/preflight/run-YYYY-MM-DD-HHMM.md` is already on disk (T1219 wrote it). Its `## REVIEW NOTES (P3)` section hyperlinks to `run-YYYY-MM-DD-HHMM/review-notes.md` which is what this module is about to write.

Replace the scaffold-stage no-op in the orchestrator:

```
// scaffold (T1201): skip review-notes.md
```

with:

```
import { aggregateP3Notes } from "halli-workflows/lib/orchestrator/p3-notes-aggregator";

// ... after the dashboard write:
const p3Summary = await aggregateP3Notes({
  findings: anchorChecked,      // post-pipeline
  rawFindings,                   // from the fan-out, pre-dedup
  runId,
  runIdDisplay: formatRunIdDisplay(runId),
  outputDir,                     // e.g. /home/halli/cabin/docs/preflight/run-YYYY-MM-DD-HHMM
  dashboardRelPath: `../${runId}.md`,
  pluginVersion,
  rubricRegistry: PHASE1_RUBRIC_REGISTRY, // from §4.2 — GuestPad Phase 1 default
});

// Optional: log promotion suggestions if any exist
if (p3Summary.promotionSuggestions.length > 0) {
  console.log(`Rubric evolution suggestions: ${p3Summary.promotionSuggestions.length} heuristic(s) appeared 3+ times. See ${p3Summary.reviewNotesPath}`);
}
```

This module runs under `--dry-run` (P3 notes are informational — dry-run only suppresses state-changing external I/O: eljun filing in T1222/T1223 and backlog.md append in T1220).

This module runs under `--force` (in the non-halting rubric-missing case — the run completed partially and still has output to write).

---

## 12. References

- Design Doc: `docs/design/pilot-review-system-design.md`
  - §6 (Severity Taxonomy — P3 destination) — lines 583-641
  - §11 (Dashboard Format — REVIEW NOTES section + Artifact directory) — lines 969-1136
  - §12 step 9 (Orchestration Flow — output routing) — lines 1197-1214
  - §13 Q2 (Reviewer crashes — fail-open with P3 REVIEWER_CRASHED) — lines 1241-1247
  - §13 Q3 (Verifier failure — P3 VERIFICATION_UNAVAILABLE) — lines 1249-1251
  - §22 Appendix B (Orchestrator Pseudocode, `renderP3Notes` invocation) — lines 1737
- Canonical schema: `halli-workflows:types/finding.md`
- Location-key grammar (for `rubric-gap:` and `mon:` keys): `halli-workflows:types/location-key.md`
- Sibling modules:
  - `halli-workflows:commands/pilot-review/dedup.md` (T1216) — upstream (pre-dedup)
  - `halli-workflows:commands/pilot-review/verify-claims-pass.md` (T1217) — upstream (verifier-unavailable source)
  - `halli-workflows:commands/pilot-review/anchor-validator.md` (T1218) — upstream (anchor-broken demotion source)
  - `halli-workflows:commands/pilot-review/rubric-check.md` (T1215) — upstream (rubric-gap source)
- Agents emitting operational P3s:
  - `halli-workflows:agents/drift-gate-reviewer.md` — emits `drift.unavailable` / `mon:drift-gate:drift_check_unavailable`
  - `halli-workflows:agents/freshness-reviewer.md` — emits `dep.check_unavailable` and 3 sibling IDs
  - `halli-workflows:agents/codebase-auditor-adapter.md` — emits `REVIEWER_CRASHED`
- Task file: `docs/plans/tasks/T1221-output-p3-notes.md`
- ADR: `docs/adr/ADR-0014-pilot-review-orchestration.md` (in the consuming project, e.g. cabin)

---

## 13. Phase Boundary Reminder (for future implementers)

- **Phase 1 (this module)**: write review-notes.md + raw-findings.json per run. Rubric-evolution signal is a one-shot count per run (no cross-run aggregation).
- **Phase 2 (deferred — NOT implemented here)**:
  - Historical trend of P3 findings across runs (e.g. "this heuristic has been P3 in every run for 6 weeks — promote to rubric"). Requires stateful aggregation at a higher layer; this module stays per-run.
  - Filtering P3 by `heuristic_id` via flags. If that becomes a need, it belongs in a separate post-processing command (`/pilot-review-p3-filter`), not inside this aggregator.
  - Merging review-notes.md across `--app` runs in a monorepo. Current design: one file per (run, app) pair, located under that app's run subdirectory.

The Phase 1 contract is: take the final findings list + raw array, render one file + one JSON. Nothing more. Resist feature creep.

## 14. Rule 13 self-check

Before handing this module off, the author verified:

1. Every field referenced (e.g. `f.heuristic_id`, `f.location_key`, `f.witnesses`, `f.evidence`, `f.agent`, `f.severity`, `f.suggested_fix`, `f.rule_link`) exists on the canonical `Finding` schema at `halli-workflows/types/finding.md` and is required (no optional fields referenced).
2. The operational heuristic IDs cited (`REVIEWER_CRASHED`, `VERIFICATION_UNAVAILABLE`, `drift.unavailable`, `dep.check_unavailable`, `dep.registry_rate_limited`, `dep.socket_unavailable`, `dep.manifest_unsupported`, `RUBRIC_MISSING`, `rubric_stub_unfilled`, `rubric_under_heuristic_minimum`) are real — each is emitted by a specific upstream module/agent referenced in §12.
3. The location-key grammar examples (`rubric-gap:`, `mon:drift-gate:`) are valid per `halli-workflows/types/location-key.md` (§6 for `rubric-gap`, §5 for `mon`).
4. The output path `docs/preflight/run-YYYY-MM-DD-HHMM/review-notes.md` matches Design Doc §11 "Artifact directory" (line 1121) and §12 step 9b (line 1199).
5. The dashboard cross-link direction (`../run-YYYY-MM-DD-HHMM.md` from inside the run subdirectory up to the dashboard) is correct — the dashboard is at `docs/preflight/run-YYYY-MM-DD-HHMM.md`, review-notes is one level deeper at `docs/preflight/run-YYYY-MM-DD-HHMM/review-notes.md`, so `..` is the right relative-path up-step.
6. Anchor-broken-demotion evidence substrings (`rule_link_broken:`, `rule_link_file_missing:`, `rule_link_malformed:`) match the annotation strings the T1218 rule-link-validator module writes (see `halli-workflows/commands/pilot-review/anchor-validator.md` §3 lines 60-96).
7. `--dry-run` behavior (write normally, informational-not-state-changing) is consistent with Design Doc §14 "Flag interaction rules" — dry-run suppresses eljun filing and backlog.md append, but artifacts under `docs/preflight/` are always written.
8. `--force` behavior (run continues with rubric gaps, eljun filing suppressed) is consistent with Design Doc §14 — in this case the review-notes.md will contain `RUBRIC_MISSING` entries because they were demoted from P0 to "halt-less" paths; the aggregator handles this via the priority-6 section.

No interface in this module was invented. Every external contract is cited to its source file and line range.
