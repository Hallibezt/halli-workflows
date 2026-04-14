---
name: pilot-review/dedup
description: Orchestrator sub-module — merges reviewer findings sharing a location_key into one deduplicated finding with max severity, union witnesses, and combined evidence. Phase 1 dedup matches by preflight_hash / location_key ONLY; rubric_hash is audit-only per Design Doc §7.stability-rule-6.
---

**Module Context**: Prompt-style specification for the `dedup(findings: Finding[]): Finding[]` pure helper consumed by `halli-workflows:commands/pilot-review-orchestrator` at step 4 of the orchestration flow (Design Doc §12 step 4; §22 Appendix B lines 1721-1723). This file is NOT a slash-command; it is a module specification that a future TypeScript implementation in `halli-workflows/lib/orchestrator/dedup.ts` can consume directly as its design contract.

## Purpose

Take the combined `Finding[]` returned from all reviewer agents (drift-gate, isolation-reviewer, auth-boundary-reviewer, privacy-gdpr-reviewer, payment-reviewer, freshness-reviewer, monitoring-reviewer, codebase-auditor-adapter, orchestrator-emitted RUBRIC_MISSING findings) and produce a deduplicated `Finding[]` where each distinct `location_key` is represented by exactly one merged finding. The merge carries the highest severity any witness saw, the union of all witnessing agents, combined evidence, and a sensibly-joined suggested fix.

This is the first transformation in the aggregation pipeline (`groupByLocationKey -> mergeGroup -> verifyClaims -> validateRuleLinkAnchors -> sort`). It is a pure function: no file I/O, no clock, no network, no mutation of the input array.

## Contract

### Signature

```ts
export function dedup(findings: Finding[]): Finding[];
```

- **Input**: `Finding[]` as defined by `halli-workflows:types/finding.md`. Each element already passed the orchestrator's Zod validation at the aggregation boundary — this function assumes well-formed input and does NOT re-validate.
- **Output**: `Finding[]` where `output.map(f => f.location_key)` has no duplicates.
- **Purity**: no side effects. Same input array -> same output array (referentially equal if sort ties are stable, structurally equal always).
- **Stability**: when two findings tie on the sort key (severity, -witness-count), preserve input relative order. Use a stable sort (JavaScript `Array.prototype.sort` since ES2019 is stable — do not introduce a custom unstable sort).

### Phase boundary

**Phase 1**: dedup key is `location_key` alone. `preflight_hash = sha256(project_slug + ":" + location_key)[:8]` is a 1:1 function of `(project_slug, location_key)` — within a single run the project slug is constant, so grouping by `location_key` and grouping by `preflight_hash` are equivalent. This helper uses `location_key` directly because it is available on every `Finding` object without a hash computation.

**Phase 2** (NOT implemented here — deferred to T1309): rubric-hash-aware superseding. When the same `location_key` is filed across two runs and the rubric_hash differs, Phase 2 will close the old eljun task as "superseded" and open a new one. That logic lives at the eljun filing layer (§10 dedup algorithm, §15 Phase 2 items), NOT inside this orchestrator-side dedup. `rubric_hash` is preserved on each finding via the eljun footer for audit purposes but is NOT part of any match key touched by `dedup`.

## Merge Algorithm

The merge follows Design Doc §8 line 712-748 literally, adapted to TypeScript-ready prose:

### Step 1 — Group by location_key (first-seen ordering)

Iterate `findings` in input order. Maintain a `Map<string, Finding[]>` keyed by `location_key`:

```
for (const f of findings) {
  const bucket = groups.get(f.location_key) ?? [];
  bucket.push(f);
  groups.set(f.location_key, bucket);
}
```

- `Map` iteration order in JavaScript matches insertion order. The first time a `location_key` is seen, it gets a new bucket in that slot; subsequent findings with the same key append to an existing bucket without changing its Map position.
- After grouping, `groups.size` == number of distinct location keys.

### Step 2 — Merge each group

For each `[locationKey, group]` in `groups`:

- **`agent`** = `group[0].agent` (first-seen reviewer is the primary — provides the canonical attribution and is what the dashboard renders in the "[agent]" tag before the `[N witnesses]` suffix).
- **`witnesses`** = deduplicated union of `f.agent` across all `f in group`. Preserve first-seen order of agents within the group. Length is always >= 1. The primary `agent` MUST appear in `witnesses` (it always does because the primary is `group[0].agent`, which is necessarily in the union).
- **`severity`** = `severityMax` reduced across `group`. See `halli-workflows:types/finding.md` §severityMax — ordering `P0 > P1 > P2 > P3`, `severityMax` returns the higher-priority tier. Implementation: `group.reduce((acc, f) => severityMax(acc, f.severity), "P3")`.
- **`rule_link`** = `group[0].rule_link`. Design Doc §8 line 736: "First agent's rule_link is canonical." The first-seen reviewer's link wins for attribution; if a later witness's link is more specific, that is a rubric-authoring concern, not a dedup concern. (Rule 13 note: we do not "pick the most specific" because "most specific" is unverifiable from inside this pure function — it would require parsing the rule_link and resolving anchors, which is T1218's job in a later pipeline step.)
- **`verdict`** = `"fail"` literal. Design Doc §8 pseudocode line 737 hardcodes this. Rationale from `halli-workflows:types/finding.md` §"Verdict vs. severity": "verdict does not get merged across witnesses — after dedup the canonical finding inherits verdict: 'fail'." The orchestrator-level aggregation converts any non-fail verdicts (warn/info/uncertain) into the single canonical dedup output shape. The pre-merge per-agent verdict is preserved for audit in `raw-findings.json` (which the orchestrator writes from the PRE-dedup array in step 6).
- **`evidence`** = `group.map(f => f.evidence).join(" | ")`. Example from §8 line 761:
  ```
  "apps/guestpad/supabase/migrations/058_foo.sql:12 — table `bar` lacks RLS policy | apps/guestpad/src/app/api/bar/route.ts:18 — queried from anon-authenticated route without owner check"
  ```
  If `group.length == 1`, the result is the single evidence string unchanged (no separator inserted). If two witnesses submitted the same evidence string verbatim, DO NOT dedupe it — the join runs over the raw array, because each witness independently reporting the same observation is signal worth preserving in the audit trail. The dashboard may collapse this visually later; the dedup helper does not.
- **`location_key`** = the key itself (trivially).
- **`heuristic_id`** = `group[0].heuristic_id`. Per §7.stability-rule-3 each heuristic on the same symbol yields a different `location_key`, so findings that survived the group step SHOULD all share a heuristic_id. **Defensive behavior**: if the group contains divergent heuristic_ids (should not happen by §7 stability rules, but a mis-authored rubric could cause it), keep `group[0].heuristic_id` and log a warning of the form `orchestrator-dedup: heuristic_id divergence in group ${locationKey} (${distinct_heuristic_ids.join(", ")})` to stderr. Do not fail the run — the run must complete and produce a dashboard. The warning goes into the run's metadata block (§11 RUN METADATA) so the rubric author can investigate.
- **`screenshot`** = first non-null from `group.map(f => f.screenshot)`, else `null`. `findNonNull(arr)` iterates in input order and returns the first non-null value or null if all entries are null. In Phase 1 all agents emit `null` here (screenshots are Phase 2 UX territory), so the branch is typically a no-op.
- **`suggested_fix`** = result of `mergeFixes(group.map(f => f.suggested_fix))` — see next section.

### Step 3 — Suggested-fix merging

Per Design Doc §8 lines 765-772:

1. If the group has exactly one member, the fix is passed through unchanged.
2. If every fix string in the group is **exactly identical** (trimmed character-for-character match after `.trim()` on both sides), emit the single shared fix. Do not duplicate it.
3. Otherwise, emit a numbered list formatted as:
   ```
   (1) From <agent>: <fix>. (2) From <agent>: <fix>.
   ```
   - `<agent>` is the agent name of the emitting reviewer (the `.agent` field of the finding that produced that fix).
   - Each item is separated by a single space after the terminating period, matching the Design Doc §8 example (line 771 shows newlines but §8 §Suggested-fix merging shows single-line joined form; we pick the single-line form because it survives eljun's markdown stripping and Slack previews). A consumer that wants line breaks can post-process.
   - Preserve first-seen order: `(1)` is the fix from `group[0]`, `(2)` is the fix from the next DISTINCT fix (skip duplicates — if `group[0]` and `group[1]` emitted identical fixes, they collapse into one entry).
   - Trailing period: if the original fix ends with punctuation, do not add a second period. If it does not, add one before the closing space so the grammar is consistent.

### Step 4 — Sort

Sort the merged array by:

1. **Severity ascending in rank** (P0 rank 0, P1 rank 1, P2 rank 2, P3 rank 3) — higher-priority findings float to the top.
2. **Witness count descending** — findings with more witnesses rank before findings with fewer at the same severity. Design Doc §8 line 747: "Sort by severity, then by witness count descending (more witnesses = higher confidence)."
3. **Input order** (stable sort tiebreaker) — when two findings tie on both keys, their relative order is the order in which their PRIMARY agent's first finding appeared in the input. The relied-upon stable-sort property of `Array.prototype.sort` delivers this for free.

Reference comparator:

```
function severityThenWitnessCount(a: Finding, b: Finding): number {
  const sevCmp = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sevCmp !== 0) return sevCmp;
  return b.witnesses.length - a.witnesses.length;
}
```

## Multi-Witness Confidence Signal

**What this module emits**: a `witnesses: string[]` array on each output finding whose length IS the confidence signal.

**What this module does NOT emit**: a new `confidence` field, probability score, or severity escalation beyond max. Design Doc §8 line 752 explicitly: "This is not a probability; it is a pragmatic signal." The dashboard renderer (T1219) reads `finding.witnesses.length` and appends ` [N witnesses]` to the header when `N >= 2` (per §11 template line 990). No change to severity — a P1 with 3 witnesses stays P1. A P0 with 1 witness stays P0.

**Why not escalate on multi-witness?** Because `severityMax` already handles the cross-agent escalation: if any witness saw it as P0, the merged finding is P0. Counting witnesses to escalate further would double-count the same signal.

**Where the count flows**: into the dashboard (as `[N witnesses]` annotation), into the eljun task body (as a line in the description), and into `raw-findings.json` for audit.

## Edge Cases and Defensive Behavior

- **Empty input**: `dedup([])` returns `[]`. No allocation, no exception.
- **Single finding**: `dedup([f])` returns `[{...f, witnesses: [f.agent]}]`. If the input already had `witnesses: [f.agent]` (which it should per the agent-output contract in `halli-workflows:types/finding.md` §AgentPromptTemplate), the output is structurally identical — the "merge" is a no-op beyond guaranteeing the shape.
- **Pre-populated witnesses on input**: reviewer agents emit `witnesses: [their-own-agent-name]` — a single-element array. If a reviewer erroneously emits a multi-witness array (shouldn't happen; they are not the orchestrator), this helper treats those entries as additional witnesses and merges them into the union. Deduplication of the witnesses array happens via a `Set<string>` construction that preserves first-seen insertion order (use `[...new Set(iter)]` — JavaScript `Set` preserves insertion order for both `add` and iteration).
- **Two findings, same location_key, divergent heuristic_id**: should not occur by §7 stability rules, but if it does, the module proceeds with the group anyway using `group[0].heuristic_id` and logs the divergence warning described in Step 2. It does NOT split the group — because splitting would mean the deduplicated output has two findings sharing one `location_key`, which violates this module's output guarantee.
- **All entries null-screenshot**: `screenshot = null`. No error.
- **All entries same fix string with different whitespace** (e.g. `"Add RLS policy."` vs `"Add RLS policy. "` with trailing space): the `.trim()` comparison in Step 3 considers them identical; emit the first one unchanged.
- **Three-or-more distinct fixes with one pair identical**: dedupe the identical pair first, then number the distinct fixes `(1)`, `(2)`, `(3)` in first-seen order.
- **Agent name casing**: all agent names are kebab-case per `halli-workflows:types/finding.md` §ValidationRule2. Do NOT case-fold when comparing; treat them as case-sensitive strings. (Any case drift is a pre-validation issue caught by Zod upstream.)
- **Input not sorted**: no assumption is made about input order beyond first-seen-wins for attribution and sort stability.
- **Input size**: the function runs in O(N) for grouping and O(M log M) for the final sort where M <= N is the number of distinct location keys. Allocations: one `Map` (N entries worst case), one output array (M entries), one `Set` per group for witness dedup. Safe at pilot-review scale (observed N ~= 50-200).

## Pseudocode (TypeScript-ready)

```typescript
import type { Finding, Severity } from "halli-workflows:types/finding";

const SEVERITY_RANK: Record<Severity, number> = {
  P0: 0, P1: 1, P2: 2, P3: 3,
};

function severityMax(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

function mergeEvidence(items: string[]): string {
  return items.join(" | ");
}

function mergeFixes(entries: Array<{ agent: string; fix: string }>): string {
  if (entries.length === 1) return entries[0].fix;

  // Collapse exact-duplicate fixes (trimmed compare), preserving first-seen order.
  const seenFixes = new Map<string, { agent: string; fix: string }>();
  for (const entry of entries) {
    const key = entry.fix.trim();
    if (!seenFixes.has(key)) seenFixes.set(key, entry);
  }
  const distinct = [...seenFixes.values()];

  if (distinct.length === 1) return distinct[0].fix;

  // Numbered list: "(1) From A: fixA. (2) From B: fixB."
  return distinct
    .map((e, i) => {
      const fix = e.fix.trim();
      const withPeriod = /[.!?]$/.test(fix) ? fix : `${fix}.`;
      return `(${i + 1}) From ${e.agent}: ${withPeriod}`;
    })
    .join(" ");
}

function firstNonNull<T>(items: Array<T | null>): T | null {
  for (const item of items) {
    if (item !== null) return item;
  }
  return null;
}

function uniqueInOrder<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function dedup(findings: Finding[]): Finding[] {
  // Step 1 — group by location_key, preserving first-seen order.
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = groups.get(f.location_key);
    if (bucket) {
      bucket.push(f);
    } else {
      groups.set(f.location_key, [f]);
    }
  }

  // Step 2 — merge each group.
  const merged: Finding[] = [];
  for (const [locationKey, group] of groups) {
    const primary = group[0];

    // Witnesses: union of all emitting-agent names, deduped, first-seen order.
    // Flatten each finding's own `witnesses` array first (defensive — reviewers emit
    // single-element arrays containing their own name, but unioning explicitly is safer).
    const witnessSources: string[] = [];
    for (const f of group) {
      witnessSources.push(f.agent);
      for (const w of f.witnesses) witnessSources.push(w);
    }
    const witnesses = uniqueInOrder(witnessSources);

    const severity = group.reduce<Severity>(
      (acc, f) => severityMax(acc, f.severity),
      "P3",
    );

    const evidence = mergeEvidence(group.map(f => f.evidence));
    const suggested_fix = mergeFixes(
      group.map(f => ({ agent: f.agent, fix: f.suggested_fix })),
    );
    const screenshot = firstNonNull(group.map(f => f.screenshot));

    // Defensive heuristic_id divergence warning (should not occur per §7.3).
    const distinctHeuristics = uniqueInOrder(group.map(f => f.heuristic_id));
    if (distinctHeuristics.length > 1) {
      console.warn(
        `orchestrator-dedup: heuristic_id divergence in group ${locationKey} ` +
        `(${distinctHeuristics.join(", ")}) — keeping group[0].heuristic_id`,
      );
    }

    merged.push({
      agent: primary.agent,
      severity,
      rule_link: primary.rule_link,
      verdict: "fail",
      evidence,
      location_key: locationKey,
      heuristic_id: primary.heuristic_id,
      suggested_fix,
      screenshot,
      witnesses,
    });
  }

  // Step 3 — sort: severity ascending in rank (P0 first), witness count descending.
  // `Array.prototype.sort` is stable as of ES2019, so ties preserve input order.
  merged.sort((a, b) => {
    const sevCmp = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevCmp !== 0) return sevCmp;
    return b.witnesses.length - a.witnesses.length;
  });

  return merged;
}
```

## Rule 13 / Intellectual Honesty Guardrails

This module is a pure function. The Rule 13 failure modes we must actively avoid:

- **No hidden severity escalation.** `severityMax` is the ONLY severity transform here. Do not invent "2 witnesses bumps P1 to P0" logic. The witness count is a UI signal, not a severity input.
- **No evidence fabrication.** `evidence` is always a concatenation of input evidence strings with `" | "`. Never synthesize a summary; never truncate; never reorder to hide a contradictory witness.
- **No silent dropping.** If a finding cannot be merged (e.g. divergent heuristic_ids), log the anomaly and proceed with a best-effort merge — do NOT drop findings to make the output shape "cleaner". Dropping findings is a silent failure; the dashboard would then under-report problems.
- **No placeholder fixes.** If every witness emitted `"(none — manual triage required)"`, the output fix is exactly that string — not a pretty-printed "N/A". The agent-emitted canonical form flows through untouched.
- **No test weakening to chase green.** See §Testing below: the testing plan includes assertions on exact string content, exact ordering, and the numbered-list fix format. Do not relax any of these to make a flaky test pass.

## Consumption Point

Invoked by `halli-workflows:commands/pilot-review-orchestrator` at step 4 of the orchestration flow (see that command's "Execution Flow" §Step 4). Replace the scaffold-stage no-op:

```
// scaffold (T1201): sorted = []
```

with:

```ts
import { dedup } from "halli-workflows/lib/orchestrator/dedup";
// ... after fan-out:
const merged = dedup(rawFindings);
// then continue with: verified = await runGroundTruthVerifier(merged); ...
```

`rawFindings` is the flat array returned by the fan-out semaphore (§13). The orchestrator writes `docs/preflight/run-*/raw-findings.json` from the PRE-dedup `rawFindings` (so per-agent verdicts remain auditable), and uses the POST-dedup `merged` array for the dashboard, eljun filing, backlog append, and review-notes output.

## Testing Contract

The implementer MUST write unit tests covering these cases. See `halli-workflows:skills/testing-principles` for structure; this module has no I/O so tests are pure function tests with no mocks.

| # | Case | Expected |
|---|------|----------|
| 1 | `dedup([])` | `[]` (empty array; no allocations beyond the bare Array literal) |
| 2 | `dedup([singleFinding])` | single-element array; `out[0].witnesses` == `[singleFinding.agent]` (deduped even if input had the agent listed twice); all other fields identical to input |
| 3 | Two findings, same `location_key`, severities P1 and P2 | one output, `severity == "P1"`, `witnesses` contains both agents in first-seen order, `evidence` concatenated with `" | "` |
| 4 | Two findings, same `location_key`, severities P1 (agent A first) and P0 (agent B second) | one output, `severity == "P0"`, `witnesses == ["A", "B"]`, `agent == "A"` (first-seen), `rule_link == A.rule_link` |
| 5 | Two findings with identical `suggested_fix` strings | single fix in output (not duplicated); no `(1) From ... (2) From ...` numbering |
| 6 | Two findings with different `suggested_fix` strings from agents A and B | `suggested_fix == "(1) From A: <fixA>. (2) From B: <fixB>."` (trailing periods normalized, single space between items) |
| 7 | Three findings with same key; two agents submitted identical fix, third differs | numbered list with TWO entries: the deduped common fix + the distinct one, in first-seen order |
| 8 | Two separate location_keys, each with one P1 finding, one with 2 witnesses and one with 1 witness | sort order puts the 2-witness finding first |
| 9 | Two P1 findings, both with 2 witnesses each | stable sort preserves input order (no arbitrary reordering) |
| 10 | One P0 with 1 witness, one P1 with 5 witnesses | P0 ranks first despite fewer witnesses (severity dominates) |
| 11 | Input with all-null screenshots | `screenshot == null` on merged finding; no exception |
| 12 | Input with one null + one non-null screenshot in a group | `screenshot` == the non-null path |
| 13 | Group with divergent `heuristic_id` (synthetic malformed input) | merged finding has `group[0].heuristic_id`; `console.warn` called once with the divergence message |
| 14 | Two agents' evidence strings are byte-identical | output evidence still contains both copies joined by `" | "` (no evidence-level dedup — rubric intent preserves independent reports) |
| 15 | 100 findings across 30 distinct location_keys | output length == 30; function runs in under 10ms on typical hardware; no exception |
| 16 | Finding with `witnesses: []` in input (Zod should have rejected but defensive check) | NOT tested — Zod at the aggregation boundary enforces `witnesses.min(1)`. If it slipped through, behavior is undefined at this layer; the dedup helper trusts its input shape |
| 17 | Referential transparency | `dedup(input)` called twice returns structurally equal arrays; input array is never mutated (`Object.isFrozen` check on a frozen input still works) |

## References

- Design Doc §6 (Severity Taxonomy + Escalation rules) — `docs/design/pilot-review-system-design.md` lines 583-641
- Design Doc §7 (location_key Strategy, stability rule 6 — Phase 1 dedup by preflight_hash only) — lines 644-706
- Design Doc §8 (Dedup and Multi-Witness Confidence — the source algorithm) — lines 708-773
- Design Doc §12 step 4 (Orchestration Flow — aggregate step) — lines 1140ff
- Design Doc §22 Appendix B (Orchestrator Pseudocode, lines 1721-1723 for the merge call site, lines 1753-1757 for the Phase 1 preflight_hash-only match clause)
- Canonical schema: `halli-workflows:types/finding.md` §severityMax, §"Verdict vs. severity", §ValidationRules
- Location-key grammar: `halli-workflows:types/location-key.md`
- Preflight hash: `halli-workflows:types/preflight-hash.md` (Phase 1 match key — hash is derivable from `(project_slug, location_key)`, so grouping by `location_key` within a single run is equivalent)

## Phase Boundary Reminder (for future implementers)

- **Phase 1 (this module)**: group by `location_key`, emit union-witness confidence. Rubric edits do NOT retrigger findings because `rubric_hash` is not in the match key.
- **Phase 2 (T1309, deferred — DO NOT IMPLEMENT HERE)**: rubric-hash-aware superseding at the eljun filing layer. When `rubric_hash` changes for a matched `preflight_hash`, the eljun filer closes the old task and opens a new one. The `dedup` helper in this file remains unchanged — the Phase 2 change is upstream of eljun, not inside the orchestrator-side dedup.
