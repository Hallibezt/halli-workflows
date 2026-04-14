---
name: pilot-review:verify-claims-pass
description: Post-dedup, pre-eljun verification step for the /pilot-review orchestrator. Strips aggregate findings to bare claims and invokes halli-workflows:ground-truth-verifier to check each claim against actual source files. Refuted findings are demoted one tier (P0→P1, P1→P2, P2→P3, P3→discarded-with-note) per Design Doc §6. Never deletes findings silently. Exempts drift-gate, orchestrator RUBRIC_MISSING, and freshness-reviewer live-API-advisory findings from demotion.
---

**Module Context**: Sub-pass of `halli-workflows:pilot-review-orchestrator`. Not a standalone command. Invoked by the orchestrator at §12 step 8d, AFTER `dedup-pass` (T1216) and BEFORE `rule-link-validator-pass` (T1218) and eljun filing (T1222/T1223).

**Design Doc anchors**: §6 "Escalation rules", §12 step 8d "/verify-claims post-pass detail", §13 Q3 (verifier-failure policy), §4.1 (drift-gate exemption), §4.7 (freshness live-API advisory structure).

> **Rule 13 note**: The underlying agent `halli-workflows:ground-truth-verifier` has been verified to exist at `halli-workflows/agents/ground-truth-verifier.md`. Its input/output contract (claims list → verdicts JSON with VERIFIED/REFUTED/UNVERIFIABLE per claim) is the load-bearing interface this pass adapts to. If that agent is removed or its contract changes, this pass must be updated in the same version bump.

---

## Purpose

A reviewer that claims "`apps/guestpad/src/app/api/messages/route.ts:23` does not call `auth.getUser()`" but the actual line 23 does call it must be caught and demoted. This pass is the Rule 13 firewall against reviewer agents hallucinating findings into the pipeline. Refuted findings stay visible on the dashboard (annotated) so reviewer behavior is observable — silent deletion would hide quality signal.

---

## Input

A flat `Finding[]` array, post-dedup. Each finding matches the canonical schema at `halli-workflows:types/finding.md` (10 required fields, validated upstream). Severity levels present: `P0`, `P1`, `P2`, `P3`.

Contract notes:
- The array has already been through `dedup-pass` (multi-witness merge, `witnesses[]` populated, max-severity applied).
- `evidence` strings follow the canonical `"<file>:<line> — <what was seen>"` format where possible (§5 / types/finding.md field table), but some agents emit free-form evidence that the pass must parse defensively.
- `location_key` is present but must NOT be used to pull a line number — line numbers live only in `evidence` (location_key §7 stability rule 1: "No line numbers").

---

## Output

A `Finding[]` array of **the same length** as the input. Each finding is returned with possibly-updated `severity` and possibly-annotated `evidence`:

- **VERIFIED** → finding returned unchanged.
- **REFUTED** → `severity` demoted one tier, `evidence` appended with `" | REFUTED: evidence does not match source at <path>:<range>"`. Never dropped.
  - `P0 → P1`
  - `P1 → P2`
  - `P2 → P3`
  - `P3 → P3` (already the lowest tier; annotated but not dropped). Per §6 "Escalation rules" the design sentence "`P3→discarded with note`" is interpreted here as **keep in findings array with demotion-note; downstream `review-notes.md` is where P3 lives**. Keeping the finding preserves the audit trail.
- **UNVERIFIABLE** → `severity` unchanged (the reviewer might still be right; we just can't prove the claim from the repo). `evidence` appended with `" | verify_status: unverifiable — <brief reason>"`.
- **EXEMPT** (see §Exemption list) → pass through unchanged, no verification attempted, no annotation.

The pass MUST NOT:
- Drop findings (even refuted ones at P3).
- Re-order findings.
- Mutate `location_key`, `heuristic_id`, `rule_link`, `witnesses`, `agent`, `verdict`, `suggested_fix`, or `screenshot`.
- Merge findings (dedup already ran).

If the verifier itself fails (invocation error, malformed JSON after retry, 429 exhaustion), emit a single `P3` `VERIFICATION_UNAVAILABLE` finding APPENDED to the output array (so output length is `input.length + 1` in that degraded case only) and pass input findings through unchanged with each non-exempt finding's evidence annotated `" | verify_status: not-verified-this-run"`. Per Design Doc §13 Q3: "If the verifier itself fails, emit a P3 VERIFICATION_UNAVAILABLE note and let the findings pass through without verification."

---

## Behavior (step-by-step)

### Step 1 — Exit-early guards

```
if input.length === 0:        return []    # Nothing to verify.
if all findings are exempt:   return input # Nothing to send to the verifier.
```

Do NOT invoke the verifier when there is nothing it can possibly act on. This saves tokens and time on clean runs.

### Step 2 — Partition by exemption list

Build three buckets:

| Bucket | Routing |
|--------|---------|
| `exempt` | Pass through unchanged at the end. No verifier call. |
| `verify` | Sent to the verifier. Every P0 and P1 NON-exempt finding goes here. (P2/P3 are skipped per cost-saving decision documented in task T1217 "Out of Scope".) |
| `passthrough` | P2 and P3 non-exempt findings. Returned unchanged (not verified this run; verifier cost scales with P0/P1 volume). |

The `exempt` bucket is formed by applying every rule in §Exemption list below.

### Step 3 — Extract bare claims from `verify` bucket

For each finding in `verify`, build one `claim` entry:

```
claim.id         = "F{index}"   # F0, F1, F2... maps back to verify[index]
claim.claim      = <bare assertion extracted from evidence>
claim.category   = <one of the 5 categories from ground-truth-verifier spec>
```

Claim extraction rules (match the `/verify-claims` top-level command's Step 1 semantics so the verifier behavior is consistent whether invoked manually or via this pass):

- A claim is **specific, checkable, atomic, and stripped of reasoning**.
- Strip "because …", "which means …", "so …", and all recommendation language ("we should", "fix by").
- Keep only what a verifier can check against source: a file path, an optional line or range, and what the finding asserts is true/false there.
- One finding → ONE claim in Phase 1. (Compound findings are a rarity post-dedup; if one appears, extract the primary claim — the one most likely to collapse the finding if refuted.)
- Preferred format: `"<path>:<line-or-range> — <assertion>"`. If line/range cannot be parsed from evidence, emit just the assertion and let the verifier search the file.

Regex for the line/range portion of an evidence string (defensive — evidence format varies):
```
/\b([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|sql|md|json|yml|yaml)):(\d+)(?:-(\d+))?/
```

If the regex produces multiple matches (evidence concatenated from dedup), use the FIRST match — that is the canonical witness location for this finding.

Pass the `codebase_root` from the orchestrator's `repo_root` shim input.

### Step 4 — Invoke `halli-workflows:ground-truth-verifier`

Use the Task tool:

```
subagent_type: halli-workflows:ground-truth-verifier
prompt: |
  Verify these claims against the actual codebase. Go directly to source files.

  DO NOT read any prior agent analysis, research notes, findings documents,
  or pilot-review dashboards. Each claim is a hypothesis — treat it as unproven
  until you find the source.

  Claims:
  [numbered claim list from Step 3]

  Codebase root: {repo_root}
```

The verifier returns JSON matching `halli-workflows:agents/ground-truth-verifier.md` §Output Format:

```json
{
  "summary": { "total": N, "verified": X, "refuted": Y, "unverifiable": Z, "false_discoveries": W },
  "verdicts": [
    { "id": "F0", "claim": "...", "verdict": "VERIFIED|REFUTED|UNVERIFIABLE", "false_discovery": bool,
      "evidence": { "file": "...", "line": N, "excerpt": "...", "notes": "..." },
      "confidence": "high|medium|low" }
  ],
  "high_value_findings": [...],
  "noise_findings": [...]
}
```

Retry policy (§13 Q3 alignment with the rest of the orchestrator):
- Transient error (network, 429, 500): retry once after 5s backoff.
- Persistent error OR malformed JSON after retry → emit `VERIFICATION_UNAVAILABLE` P3 and fall through (see §Verifier failure).

### Step 5 — Apply verdicts to findings

For each `verdict` in the verifier response, match it back to `verify[verdict.id.replace("F", "")]` and apply:

```
switch (verdict.verdict) {
  case "VERIFIED":
    // No change. Finding stays as-is.
    break;
  case "REFUTED":
    finding.severity = demote(finding.severity);
    finding.evidence +=
      " | REFUTED: evidence does not match source at "
      + verdict.evidence.file + ":" + verdict.evidence.line
      + (verdict.false_discovery ? " (false discovery — codebase already correct)" : "");
    break;
  case "UNVERIFIABLE":
    // Severity unchanged — reviewer might still be right.
    finding.evidence +=
      " | verify_status: unverifiable — " + (verdict.evidence.notes || "verifier could not locate source");
    break;
}
```

`demote(severity)`:
```
"P0" → "P1"
"P1" → "P2"
"P2" → "P3"
"P3" → "P3"   # already at floor; annotation added but no further demotion
```

### Step 6 — Reassemble and return

Concatenate in this order:

```
return [...exempt, ...verifyAfter, ...passthrough]
```

Where `verifyAfter` is the post-verdict array from Step 5. The original overall ordering from dedup is not strictly preserved — the orchestrator's §12 step 9 sort (severity then witness count) runs after this pass and re-sorts the full list, so this pass does not need to maintain a stable index against input.

If the verifier failed (§Verifier failure), append one `VERIFICATION_UNAVAILABLE` P3 finding to the output.

---

## Exemption list (§Design Doc §6 "Hard-coded ceiling" + §4.1 + §4.7)

A finding is EXEMPT from verification (and from demotion) when any of these match. The pass skips the verifier call for exempt findings entirely — they pass through untouched.

| Rule | Check | Rationale |
|------|-------|-----------|
| **drift-gate findings** | `finding.agent === "drift-gate"` OR `location_key` matches `/^db:.+:drift$/` | Per §4.1, drift-gate shells out to `scripts/drift-check.ts` (no LLM — ground-truth is already the JSON output of a deterministic tool). Demotion is nonsensical. Also covered by §6 "Hard-coded ceiling: drift-gate findings … are always P0 and cannot be demoted." |
| **orchestrator RUBRIC_MISSING** | `finding.heuristic_id === "RUBRIC_MISSING"` (always `agent === "orchestrator"`) | Meta-finding about file absence, not a code claim. The verifier has no source line to check. §6 "Hard-coded ceiling: … orchestrator `RUBRIC_MISSING` findings are always P0 and cannot be demoted." |
| **freshness-reviewer live-API advisories** | `finding.agent === "freshness-reviewer"` AND `heuristic_id` matches `/^fresh\.cve\./` | Per §4.7 and the freshness-reviewer agent contract: every `fresh.cve.*` finding's evidence and `rule_link` already come from a live `api.github.com/advisories/<GHSA>` or `osv.dev` response. Rule 13 compliance is enforced upstream. Reading a repo file cannot refute a live advisory. (Non-CVE freshness findings like `fresh.deprecated_upstream` are NOT exempt — those can be checked against the manifest file.) |
| **Non-code finding types** | `location_key` matches `/^(dep|mon|rubric-gap):/` | Dependency, monitoring, and rubric-gap findings are declarative — there is no source line to match. The verifier cannot add signal here. (Code, db, and ux finding types ARE verified.) |

Implementation note: the exemption check runs BEFORE claim extraction. An exempt finding never reaches the verifier, so it cannot be annotated by it.

### Why these four exemptions and not more

Keeping the exemption list narrow preserves coverage. Every additional exemption is a place where a hallucinated claim slips through. These four are the minimum set where verification is **provably impossible** (the verifier has no source to read) or **already done** (live API at emit time). Future exemptions require a Design Doc amendment.

---

## Verifier failure

Per §13 Q3: "If the verifier itself fails, emit a P3 `VERIFICATION_UNAVAILABLE` note and let the findings pass through without verification. The dashboard annotates affected findings with 'not verified this run.'"

Implementation:

```
{
  "agent": "orchestrator",
  "severity": "P3",
  "rule_link": "docs/design/pilot-review-system-design.md#q3-verify-claims-pass-failures",
  "verdict": "uncertain",
  "evidence": "halli-workflows:ground-truth-verifier invocation failed: <error summary>. {N} P0/P1 findings passed through unverified this run.",
  "location_key": "orchestrator:verify-claims-pass:verifier-unavailable",
  "heuristic_id": "VERIFICATION_UNAVAILABLE",
  "suggested_fix": "Re-run /pilot-review when the issue is resolved. Check the Anthropic API status and retry.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

And every non-exempt finding that was in the `verify` bucket gets `evidence += " | verify_status: not-verified-this-run"` so the dashboard shows which findings are unverified.

---

## What this pass does NOT do

- **Does not verify P2/P3** — cost-saving decision per T1217 "Out of Scope". Re-open in Phase 2 if refutation rate warrants.
- **Does not rewrite or rescore the ground-truth-verifier agent** — wraps its invocation only.
- **Does not extract multiple claims from one finding** — one claim per finding (primary assertion only). If a finding carries a compound claim post-dedup, the primary claim is the first file:line reference in `evidence`.
- **Does not verify `dep:`, `mon:`, `rubric-gap:` findings** — non-code evidence; see exemption rule 4.
- **Does not cite the Anthropic rate-limit response structure** — we handle 429 as an opaque "retry once" signal because retry semantics live in the verifier agent's own tool layer.
- **Does not read prior agent analysis on the verifier's behalf** — the verifier is a cold firewall by design (§agent spec line 11). This pass forwards claims only.

---

## Integration with the orchestrator

Called by `halli-workflows:pilot-review-orchestrator` at Step 4 (aggregation), between `dedup-pass` and `rule-link-validator-pass`:

```
const rawFindings   = await runSquad(roster, flags.concurrency || 5);   // T1225
const merged        = await dedupPass(rawFindings);                     // T1216
const verified      = await verifyClaimsPass(merged, repo_root);        // THIS MODULE
const anchorChecked = await ruleLinkValidatorPass(verified);            // T1218
const sorted        = anchorChecked.sort(severityThenWitnessCount);
```

Inputs:
- `merged: Finding[]` — post-dedup findings
- `repo_root: string` — absolute path to consuming repo root (from shim input)

Output:
- `Finding[]` — same length (or `length + 1` on verifier failure), possibly-demoted severities, possibly-annotated evidence, original `location_key`/`witnesses`/`heuristic_id` preserved.

---

## Acceptance criteria (T1217)

This module satisfies the following criteria from `docs/plans/tasks/T1217-orchestrator-verify-claims.md`:

- Invokes existing `halli-workflows:ground-truth-verifier` agent (verified present at `agents/ground-truth-verifier.md` before authoring).
- Runs AFTER dedup — integrates between `dedupPass` and `ruleLinkValidatorPass`.
- Processes every P0 and P1 non-exempt finding. P2/P3 pass through unchanged by design.
- For each verified finding, extracts `<path>:<line-or-range>` from evidence using the defensive regex in Step 3.
- Refuted findings: demoted one tier, evidence annotated `"REFUTED: evidence does not match source at <path>:<range>"`. NEVER silently dropped.
- Drift-gate findings (`agent === "drift-gate"` OR `location_key` matches `/^db:.+:drift$/`) stay P0 regardless of verification outcome.
- Orchestrator `RUBRIC_MISSING` findings stay P0.
- On verifier failure: emits single P3 `VERIFICATION_UNAVAILABLE` finding; non-exempt findings annotated `"not verified this run"`.
- Returns the updated findings array (same length in normal operation, `length + 1` only on verifier failure).

### Additional exemption coverage beyond T1217 minimum

The task file only calls out drift-gate and RUBRIC_MISSING exemptions. The user's invocation brief extended this to also cover freshness-reviewer live-API advisories (`fresh.cve.*`) and declarative finding types (`dep:`, `mon:`, `rubric-gap:`). Both are justified above in §Exemption list and are consistent with Rule 13 ("verification is impossible or already done at emit time").

---

## Testing approach

Synthetic-input unit tests should cover:

1. **Empty input** → returns `[]`, verifier NOT invoked.
2. **All-exempt input** (e.g. 3 drift-gate + 1 RUBRIC_MISSING) → returns input unchanged, verifier NOT invoked.
3. **P0 finding with fabricated line** (e.g. evidence cites `some/file.ts:99999` that doesn't exist) → demoted to P1, evidence annotated with `REFUTED: …`.
4. **P0 finding with accurate evidence** → no demotion, `severity` stays P0.
5. **P0 drift-gate finding with fabricated line** → stays P0, NO annotation (exemption respected).
6. **P0 finding with UNVERIFIABLE verdict** → severity unchanged, evidence annotated `verify_status: unverifiable`.
7. **Verifier returns malformed JSON twice (retry exhausted)** → single P3 `VERIFICATION_UNAVAILABLE` appended, verify-bucket findings annotated `not-verified-this-run`.
8. **Mix of 5 findings: 2 P0 verified, 1 P1 refuted, 1 P2, 1 exempt drift-gate** → output length 5; P1 refuted → P2; P2 unchanged (not sent to verifier — cost tier); drift-gate unchanged.
9. **P3 finding REFUTED** → severity stays P3 (floor), evidence annotated.
10. **False-discovery flag from verifier** → evidence includes `(false discovery — codebase already correct)`.

Every test asserts final `Finding[].length`, each `severity` transition, and each `evidence` annotation presence — NOT on mock internals. Testing the mock instead of the behavior contract is a Rule 13 violation (see `halli-workflows:skills/testing-principles`).

---

## References

- Design Doc: `docs/design/pilot-review-system-design.md` — §4.1 (drift-gate), §4.7 (freshness), §6 (escalation), §12 step 8d (this pass), §13 Q3 (verifier failure policy).
- Agent: `halli-workflows:agents/ground-truth-verifier.md` — the worker this pass wraps.
- Sibling pass: `halli-workflows:commands/pilot-review/dedup-pass.md` (T1216 — runs before this).
- Sibling pass: `halli-workflows:commands/pilot-review/rule-link-validator-pass.md` (T1218 — runs after this).
- Top-level standalone command (not invoked by this pass but shares claim-extraction semantics): `halli-workflows:commands/verify-claims.md`.
- Finding schema: `halli-workflows:types/finding.md`.
- Location key grammar: `halli-workflows:types/location-key.md`.
- Task file: `docs/plans/tasks/T1217-orchestrator-verify-claims.md`.

## Rule 13 self-check

Before handing this module off, the author verified:

1. `halli-workflows:ground-truth-verifier` agent exists at `halli-workflows/agents/ground-truth-verifier.md` — its input format (numbered claim list) and output JSON shape are documented there and referenced verbatim above.
2. The freshness-reviewer `fresh.cve.*` heuristic pattern and live-API sourcing of `rule_link` is documented at `halli-workflows/agents/freshness-reviewer.md` lines 369–371.
3. The drift-gate finding shape (`location_key` = `db:{table}:{col}:drift`) is documented at Design Doc §4.1 lines 205–208.
4. The severity demotion ordering (`P0→P1→P2→P3`) is documented at Design Doc §6 and `halli-workflows:types/finding.md` §Severity.
5. The verifier-failure policy (P3 `VERIFICATION_UNAVAILABLE`, pass-through-unverified) is documented at Design Doc §13 Q3.

No interface in this module was invented. Every external contract is cited.
