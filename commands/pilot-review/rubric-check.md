---
name: pilot-review/rubric-check
description: Orchestrator sub-module — invoked BEFORE agent fan-out (Design Doc §12 step 2). Verifies every active reviewer's required rubric file exists, computes a rubric_hash for each present file, detects scaffold stubs and under-specified rubrics, and emits rubric-state Findings that feed the fail-loud halt decision. Does NOT fan out agents, dedup findings, call eljun, or edit source. Read-only pure function (apart from file reads).
---

**Command Context**: Sub-module of the `/pilot-review` orchestration pipeline. Wired into the main `pilot-review-orchestrator.md` at step 2 of Design Doc §12 "Orchestration Flow" (the "Rubric existence check" step, between roster-resolution and fan-out). This file is the authoritative specification for that step.

**Scope discipline**: This module does **one thing** — inspect rubric files against a static per-agent registry and report the result as a list of canonical `Finding` objects. It does NOT invoke agents, merge findings, run `/verify-claims`, write the dashboard, or perform any eljun I/O. Those responsibilities live elsewhere in the pipeline (Design Doc §12 steps 6–9). Keeping this module narrow prevents edit-contention with sibling sub-modules in Phase 1.4 (T1216 dedup, T1217 verify-claims, T1218 rule-link anchor check).

## Rule 13 framing

Running a reviewer without its rubric is a pure Rule 13 (intellectual honesty) violation — the agent fabricates standards that "sound plausible" and the user cannot tell. This module is the **primary defense at the tool level**: rubric files are mandatory, inputs, and non-falsifiable. An absent rubric halts the run with a `P0 RUBRIC_MISSING` finding. A scaffold stub is surfaced as `P1 rubric_stub_unfilled`. A rubric with fewer than 5 heuristics is surfaced as `P1 rubric_under_heuristic_minimum` because a short rubric invites the reviewer to hallucinate to fill gaps (Design Doc §9 "Minimum heuristic coverage").

The module must NEVER silently downgrade a missing rubric or invent a placeholder. The orchestrator either halts (default) or runs-in-degraded-mode (via `--force`, which separately suppresses eljun filing to prevent action on an incomplete audit — see §14 flag interaction rules in the Design Doc).

---

## Input

The caller (`pilot-review-orchestrator.md` step 2) passes an input object with exactly these fields. Missing or malformed input = fail loud. Do NOT guess defaults.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repoRoot` | `string` (absolute path) | yes | Absolute path to the consuming repo root. Rubric paths are resolved relative to this (`<repoRoot>/docs/review-rubrics/...`). For GuestPad this is `/home/halli/cabin`. |
| `activeAgents` | `AgentDescriptor[]` | yes | The post-flag-filtering reviewer roster (after `--only` / `--skip` / `--include-ux` are applied upstream). Each descriptor exposes `name: string` and `requiredRubrics: string[]` (repo-relative paths). Agents with no required rubrics contribute nothing to this module's output. |
| `force` | `boolean` | yes | The parsed value of `--force`. This module does NOT halt on its own — it records the `haltRequested` signal in its output. The caller halts based on `haltRequested && !force`. |

### `AgentDescriptor`

```ts
interface AgentDescriptor {
  name: string;                // kebab-case, e.g. "privacy-gdpr-reviewer"
  requiredRubrics: string[];   // repo-relative paths, e.g. ["docs/review-rubrics/privacy-gdpr.md"]
}
```

### Rubric registry (GuestPad default — configurable)

For Phase 1, the orchestrator (upstream of this module) constructs the active-agent list using a **hardcoded registry** of required rubrics per agent. The registry below is the Phase 1 source of truth for GuestPad and mirrors Design Doc §3 and T1215's task spec:

| Agent name | Required rubric(s) |
|------------|--------------------|
| `privacy-gdpr-reviewer` | `docs/review-rubrics/privacy-gdpr.md` |
| `payment-reviewer` | `docs/review-rubrics/payment.md` |
| `monitoring-reviewer` | `docs/review-rubrics/monitoring.md` |
| `guest-ux-reviewer` (Phase 2, only when `--include-ux` is set) | `docs/ux-rubrics/guest-tablet.md` |
| `owner-ux-reviewer` (Phase 2, only when `--include-ux` is set) | `docs/ux-rubrics/owner-dashboard.md` |
| `drift-gate` | (none — rubric not required) |
| `codebase-auditor` | (none — rubric not required) |
| `isolation-reviewer` | (none — rubric is §Rule 0 of root CLAUDE.md, verified elsewhere) |
| `auth-boundary-reviewer` | (none — rubric is §Rule 2 of root CLAUDE.md, verified elsewhere) |
| `freshness-reviewer` | (none — rubric is npm/GHSA registries, live-fetched) |

Future projects MAY override this registry; the module itself is agnostic — it consumes whatever `requiredRubrics` the caller passes in each `AgentDescriptor`. The hardcoded table above is a convention-by-default, not a contract of this module. (Phase 2 may extract the registry into a project-level config file; see Out-of-Scope below.)

---

## Output

Return a single `RubricCheckResult` object:

```ts
interface RubricCheckResult {
  /**
   * Canonical Findings covering every rubric-state signal produced by this module.
   * Shape conforms to halli-workflows:types/finding.md. Callers MUST NOT mutate;
   * aggregation/dedup is the orchestrator's job in a later step.
   *
   * Contents:
   *   - One P0 RUBRIC_MISSING finding per absent required rubric.
   *   - One P1 rubric_stub_unfilled finding per present rubric that still has
   *     the "⚠ This rubric is a scaffold" banner as line 1.
   *   - One P1 rubric_under_heuristic_minimum finding per present non-stub
   *     rubric that defines fewer than 5 "### H<digit>" heading entries.
   * Empty array = every rubric is present and well-specified.
   */
  findings: Finding[];

  /**
   * Map of repo-relative rubric path → 8-char lowercase hex SHA-256 prefix,
   * for every rubric file that was PRESENT at check time (missing files excluded).
   * The orchestrator later pipes this into every finding's eljun description footer
   * as `rubric_hash: <hex>` per Design Doc §10. Phase 1 uses it for audit only;
   * Phase 2 (T1309) uses it for task superseding.
   */
  rubricHashes: Record<string, string>;

  /**
   * Names of agents that were skipped because at least one of their required
   * rubrics is missing. The orchestrator excludes these agents from the
   * fan-out roster. An agent appears here AT MOST ONCE even if multiple of
   * its rubrics are missing.
   */
  skippedAgents: string[];

  /**
   * True iff at least one P0 RUBRIC_MISSING finding was emitted. The caller
   * uses this (combined with the `force` flag) to decide whether to halt:
   *
   *   if (result.haltRequested && !input.force) {
   *     writeDashboard(result.findings);   // rubric-gap findings only
   *     process.exit(1);
   *   }
   *
   * P1 stub_unfilled and under_heuristic_minimum findings do NOT set this flag —
   * they are signals, not blockers.
   */
  haltRequested: boolean;
}
```

`Finding` is the canonical schema at `halli-workflows:types/finding.md`. All 10 fields are required; `screenshot` is always `null` for this module's output.

---

## Algorithm

```
Input: { repoRoot, activeAgents, force }

1. Initialize accumulators:
     findings       = []
     rubricHashes   = {}
     skippedSet     = new Set<string>()
     missingAny     = false

2. Flatten required rubrics:
     For each agent in activeAgents:
       For each rubricPath in agent.requiredRubrics:
         record the pair (agent.name, rubricPath) into a working list.
     (If agent.requiredRubrics is empty, agent contributes nothing.)

3. De-duplicate by rubricPath:
     A rubric shared by two agents is read once. Build
       rubricToAgents: Map<rubricPath, string[]>   // agents that require it
     preserving insertion order for deterministic output.

4. For each (rubricPath, requiringAgents) in rubricToAgents:

   4a. Resolve absolute path:
         absPath = repoRoot + "/" + rubricPath
       Refuse to resolve paths that escape repoRoot (e.g. contain "..").
       If escape detected: fail loud (this is a caller bug, not a user error).

   4b. Existence check (fs.existsSync or equivalent):
         If !exists(absPath):
           findings.push(makeMissingFinding(rubricPath))
           missingAny = true
           for agent in requiringAgents: skippedSet.add(agent)
           continue              // do NOT read hash or heuristic count — file is absent
         If exists but is a directory or is unreadable:
           same as absent — emit missing finding, mark skipped.
           (Evidence text distinguishes "does not exist" vs "not readable".)

   4c. Read file contents (utf-8):
         contents = readFile(absPath)
         If contents is empty (zero bytes OR whitespace-only):
           same treatment as missing — emit RUBRIC_MISSING finding with
           evidence noting the file is empty, skip requiring agents.

   4d. Compute rubric_hash:
         rubricHash = sha256(contents).toString("hex").slice(0, 8).toLowerCase()
         rubricHashes[rubricPath] = rubricHash

   4e. Stub detection:
         lines = contents.split("\n")
         firstNonBlankLine = first line l where l.trim() !== ""
         If firstNonBlankLine matches the literal pattern
             "# ⚠ This rubric is a scaffold"
           (case-sensitive, leading "# " required, no trailing content constraint
           beyond the prefix — the full canonical banner is
           "# ⚠ This rubric is a scaffold. Fill in the heuristics for your
           project before running a real review."):
             findings.push(makeStubUnfilledFinding(rubricPath, rubricHash))
             // Do NOT mark agent as skipped. Per Design Doc §9 "Scaffolding",
             // a stub is a soft nudge — the reviewer still runs but will also
             // emit its own rubric_stub_unfilled finding. This module emits
             // at the orchestrator-level for early visibility; the reviewer's
             // duplicate gets merged during dedup (T1216) by location_key.
             // IMPORTANT: skip the heuristic-count check for stubs — stubs
             // are under-specified by definition, so adding a second P1
             // finding on the same file would be noise.
             continue

   4f. Minimum heuristic count check:
         heuristicHeadings = count of lines matching regex
             /^###\s+H\d+\./       (anchored at line start)
         Rationale: Design Doc §9 "File format" specifies heuristics are
         declared as "### H1. <name>" / "### H2. <name>" / ... — the H<digit>
         prefix is the canonical shape. A three-level heading (###) at line
         start with "H" + digits + "." is the stable marker.
         If heuristicHeadings < 5:
           findings.push(makeUnderMinimumFinding(rubricPath, rubricHash,
                                                 heuristicHeadings))
           // Do NOT skip the agent. This is a quality-of-rubric signal, not
           // a presence failure.

5. Assemble result:
     return {
       findings,
       rubricHashes,
       skippedAgents: Array.from(skippedSet),  // deterministic: insertion order
       haltRequested: missingAny,              // true iff any P0 missing finding
     }

6. The CALLER (orchestrator) handles halting:
     if (result.haltRequested && !force) {
       writeDashboard(result.findings)
       print("Rubric files missing: <list>. Scaffold with: /pilot-review --scaffold-rubrics")
       exit(1)
     }
     Otherwise: merge result.findings into the run's finding stream,
                exclude result.skippedAgents from fan-out,
                pass result.rubricHashes to the finding-footer renderer.

7. Flag interaction (caller's responsibility, documented here for reference):
     --force:       run continues with available agents; rubric-missing
                    agents are skipped; eljun filing is suppressed for the
                    entire run (Design Doc §14: "Does NOT file eljun tasks
                    on a forced run — treated as incomplete audit").
     --scaffold-rubrics: a SEPARATE sub-operation. When passed, the
                    orchestrator invokes the scaffolder (authored separately
                    in Phase 1.5) instead of this module and exits without
                    running the review. This module is NOT responsible for
                    scaffolding.
     --dry-run + --force: valid combination per §14. This module treats both
                    flags identically — it only inspects, never writes.
```

### Finding constructor snippets

The three helpers referenced above must produce findings that pass `FindingSchema` validation in `types/finding.md`. Reference shapes:

**`makeMissingFinding(rubricPath)`**:

```json
{
  "agent": "orchestrator",
  "severity": "P0",
  "rule_link": "docs/adr/ADR-0014-pilot-review-orchestration.md#rubric-as-file",
  "verdict": "fail",
  "evidence": "<rubricPath> — required rubric does not exist (resolved path: <absPath>). Requiring agents: <comma-separated list from requiringAgents>. Without this rubric, the listed reviewers would fabricate standards per Rule 13.",
  "location_key": "rubric-gap:<rubricPath>:file_missing",
  "heuristic_id": "RUBRIC_MISSING",
  "suggested_fix": "Run `/pilot-review --scaffold-rubrics` to create a stub, then fill in the heuristics. Or author manually — see halli-workflows:commands/pilot-review-orchestrator.md for the registry of required rubrics and Design Doc §9 'File format' for the rubric template.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

**`makeStubUnfilledFinding(rubricPath, rubricHash)`**:

```json
{
  "agent": "orchestrator",
  "severity": "P1",
  "rule_link": "docs/design/pilot-review-system-design.md#9-rubric-file-convention",
  "verdict": "warn",
  "evidence": "<rubricPath> (rubric_hash: <rubricHash>) — file exists but begins with the scaffold banner '# ⚠ This rubric is a scaffold'. The reviewer will emit its own rubric_stub_unfilled finding; this orchestrator-level finding is for dashboard visibility. The stub does not block the run.",
  "location_key": "rubric-gap:<rubricPath>:stub_unfilled",
  "heuristic_id": "rubric_stub_unfilled",
  "suggested_fix": "Fill in the heuristic table with at least 5 heuristics (per Design Doc §9 'Minimum heuristic coverage') covering the concrete checks for this domain, then remove the '# ⚠ This rubric is a scaffold' banner from line 1.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

**`makeUnderMinimumFinding(rubricPath, rubricHash, count)`**:

```json
{
  "agent": "orchestrator",
  "severity": "P1",
  "rule_link": "docs/design/pilot-review-system-design.md#9-rubric-file-convention",
  "verdict": "warn",
  "evidence": "<rubricPath> (rubric_hash: <rubricHash>) — rubric defines <count> heuristic(s), which is below the Design Doc §9 minimum of 5. Short rubrics invite the reviewer to hallucinate to fill gaps. Headings counted by regex /^###\\s+H\\d+\\./ on line starts.",
  "location_key": "rubric-gap:<rubricPath>:below_minimum_heuristic_coverage",
  "heuristic_id": "rubric_under_heuristic_minimum",
  "suggested_fix": "Expand the rubric to at least 5 heuristics. Follow the '### H<n>. <name>' format with ID, severity tier, pass criteria, fail criteria, evidence format, and suggested-fix template per Design Doc §9 'File format'. See existing GuestPad rubrics (docs/review-rubrics/privacy-gdpr.md is authoritative reference).",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

### Location-key grammar

All three location keys use the `rubric-gap` grammar from `halli-workflows:types/location-key.md` §6:

```
rubric-gap:{rubric_path}:{missing_section}
```

Canonical `missing_section` values for this module:

- `file_missing` — file is absent, empty, or unreadable.
- `stub_unfilled` — file begins with the scaffold banner.
- `below_minimum_heuristic_coverage` — file has fewer than 5 heuristic headings.

No other `missing_section` values are emitted by this module. If the orchestrator needs a different rubric-related signal in the future (e.g. Phase 2 introduces `rubric_checksum_mismatch`), it is added to the type grammar first, then to this module.

### `rubric_hash` computation

```
rubricHash(contents: string): string
  // SHA-256 of file contents as raw bytes (utf-8), hex-encoded, first 8 chars, lowercase.
  return crypto.createHash("sha256").update(contents, "utf8")
               .digest("hex").slice(0, 8).toLowerCase()
```

Notes:

- Hash is computed over file contents exactly as read — no normalization, no whitespace trimming. Two rubrics differing only in trailing newline hash differently. This is intentional: rubric hash is a content fingerprint, not a semantic version.
- Absent files have no hash (they are not added to `rubricHashes`). The finding's `suggested_fix` already tells the user to scaffold; a pseudo-hash would be misleading.
- Empty files (zero bytes or whitespace-only) are treated as missing per §4c; no hash is recorded.
- Phase 2 (Design Doc §15 and T1309) introduces rubric-hash-aware task superseding in eljun dedup. Phase 1 records the hash for audit only; dedup matches by `preflight_hash` alone.

---

## Examples

### Example 1 — All rubrics present and well-specified

Input:

```json
{
  "repoRoot": "/home/halli/cabin",
  "activeAgents": [
    { "name": "privacy-gdpr-reviewer", "requiredRubrics": ["docs/review-rubrics/privacy-gdpr.md"] },
    { "name": "payment-reviewer",      "requiredRubrics": ["docs/review-rubrics/payment.md"] },
    { "name": "monitoring-reviewer",   "requiredRubrics": ["docs/review-rubrics/monitoring.md"] },
    { "name": "drift-gate",            "requiredRubrics": [] }
  ],
  "force": false
}
```

Output:

```json
{
  "findings": [],
  "rubricHashes": {
    "docs/review-rubrics/privacy-gdpr.md": "a0b3c4d5",
    "docs/review-rubrics/payment.md":      "7f3a9e21",
    "docs/review-rubrics/monitoring.md":   "1b2c3d4e"
  },
  "skippedAgents": [],
  "haltRequested": false
}
```

Orchestrator continues to fan-out with all agents. Hashes flow into the eljun footer.

### Example 2 — Privacy rubric deleted; run without `--force`

Input: same as Example 1 but `docs/review-rubrics/privacy-gdpr.md` does not exist.

Output:

```json
{
  "findings": [
    {
      "agent": "orchestrator",
      "severity": "P0",
      "rule_link": "docs/adr/ADR-0014-pilot-review-orchestration.md#rubric-as-file",
      "verdict": "fail",
      "evidence": "docs/review-rubrics/privacy-gdpr.md — required rubric does not exist (resolved path: /home/halli/cabin/docs/review-rubrics/privacy-gdpr.md). Requiring agents: privacy-gdpr-reviewer. Without this rubric, the listed reviewers would fabricate standards per Rule 13.",
      "location_key": "rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing",
      "heuristic_id": "RUBRIC_MISSING",
      "suggested_fix": "Run `/pilot-review --scaffold-rubrics` to create a stub, then fill in the heuristics. Or author manually — see halli-workflows:commands/pilot-review-orchestrator.md for the registry of required rubrics and Design Doc §9 'File format' for the rubric template.",
      "screenshot": null,
      "witnesses": ["orchestrator"]
    }
  ],
  "rubricHashes": {
    "docs/review-rubrics/payment.md":    "7f3a9e21",
    "docs/review-rubrics/monitoring.md": "1b2c3d4e"
  },
  "skippedAgents": ["privacy-gdpr-reviewer"],
  "haltRequested": true
}
```

Because `force=false` and `haltRequested=true`, the orchestrator writes the dashboard with these rubric-gap findings only, prints the scaffold hint, and exits 1.

### Example 3 — Same input with `--force`

Same findings/hashes/skippedAgents as Example 2 but the orchestrator consults `force=true`. It does NOT halt. It excludes `privacy-gdpr-reviewer` from fan-out, runs the remaining agents, writes a full dashboard including the P0 `RUBRIC_MISSING` signal, and **suppresses eljun filing for the entire run** (per §14 flag rules — a forced run is an incomplete audit and must not result in action items).

### Example 4 — Guest-tablet UX rubric is a stub (via `--include-ux`)

Input includes:

```json
{ "name": "guest-ux-reviewer", "requiredRubrics": ["docs/ux-rubrics/guest-tablet.md"] }
```

`docs/ux-rubrics/guest-tablet.md` begins with the scaffold banner. Output:

```json
{
  "findings": [
    {
      "agent": "orchestrator",
      "severity": "P1",
      "rule_link": "docs/design/pilot-review-system-design.md#9-rubric-file-convention",
      "verdict": "warn",
      "evidence": "docs/ux-rubrics/guest-tablet.md (rubric_hash: 5a6b7c8d) — file exists but begins with the scaffold banner '# ⚠ This rubric is a scaffold'. The reviewer will emit its own rubric_stub_unfilled finding; this orchestrator-level finding is for dashboard visibility. The stub does not block the run.",
      "location_key": "rubric-gap:docs/ux-rubrics/guest-tablet.md:stub_unfilled",
      "heuristic_id": "rubric_stub_unfilled",
      "suggested_fix": "Fill in the heuristic table with at least 5 heuristics (per Design Doc §9 'Minimum heuristic coverage') covering the concrete checks for this domain, then remove the '# ⚠ This rubric is a scaffold' banner from line 1.",
      "screenshot": null,
      "witnesses": ["orchestrator"]
    }
  ],
  "rubricHashes": { "docs/ux-rubrics/guest-tablet.md": "5a6b7c8d" },
  "skippedAgents": [],
  "haltRequested": false
}
```

Reviewer still runs. Dashboard shows one P1 under "MUST-FIX BEFORE PILOT". Dedup (T1216) merges with the reviewer's own duplicate finding via `location_key`.

### Example 5 — Rubric with 3 heuristics (under the minimum)

`docs/review-rubrics/monitoring.md` exists, has no scaffold banner, but contains only 3 `### H<n>.` headings. Output finding:

```json
{
  "agent": "orchestrator",
  "severity": "P1",
  "rule_link": "docs/design/pilot-review-system-design.md#9-rubric-file-convention",
  "verdict": "warn",
  "evidence": "docs/review-rubrics/monitoring.md (rubric_hash: 1b2c3d4e) — rubric defines 3 heuristic(s), which is below the Design Doc §9 minimum of 5. Short rubrics invite the reviewer to hallucinate to fill gaps. Headings counted by regex /^###\\s+H\\d+\\./ on line starts.",
  "location_key": "rubric-gap:docs/review-rubrics/monitoring.md:below_minimum_heuristic_coverage",
  "heuristic_id": "rubric_under_heuristic_minimum",
  "suggested_fix": "Expand the rubric to at least 5 heuristics. Follow the '### H<n>. <name>' format with ID, severity tier, pass criteria, fail criteria, evidence format, and suggested-fix template per Design Doc §9 'File format'. See existing GuestPad rubrics (docs/review-rubrics/privacy-gdpr.md is authoritative reference).",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

`haltRequested=false` because this is P1. Agent still runs.

---

## Edge cases and invariants

1. **No line numbers in location_key.** Per `types/location-key.md` stability rule 1, the `missing_section` token of a `rubric-gap` key must never contain digits that look like a line number (`:12:`). The three canonical tokens (`file_missing`, `stub_unfilled`, `below_minimum_heuristic_coverage`) satisfy this by construction.
2. **Deterministic output ordering.** Iterate `rubricToAgents` in insertion order; append findings in the order they are discovered. Two runs against an unchanged filesystem produce byte-identical output (except for timestamps, which this module does NOT emit — those live in the dashboard layer).
3. **No I/O beyond reading rubric files.** This module MUST NOT read source code, call the network, invoke other agents, or write files. Side effects of any kind — including `console.log` — are out of scope. The only permitted operations are `exists()`, `readFile()`, and SHA-256 hashing.
4. **Path traversal safety.** `rubricPath` comes from the caller's agent descriptors, which come from a hardcoded registry — but as a defense-in-depth measure, resolve each path with a check that the absolute result is a descendant of `repoRoot`. If a path escapes, throw (this is a caller bug that must surface, not a user error).
5. **UTF-8 only.** Rubric files are markdown; assume utf-8. If the file cannot be decoded as utf-8, treat it as unreadable (emit `file_missing` with evidence "not readable as utf-8"). Binary files masquerading as markdown should never happen in practice, but this module must not crash.
6. **Windows line endings.** The stub-banner and heuristic-heading regex patterns are newline-agnostic — we split on `\n` after reading, but we also match lines with trailing `\r`. The regex `/^###\s+H\d+\./` matches regardless of trailing whitespace because the line is the substring before `\n`, and `\r` is whitespace per `\s`. No special handling needed.
7. **Idempotency.** Running this module twice back-to-back against an unchanged filesystem produces identical output (same findings, same hashes, same skippedAgents). This is a property the caller relies on for replayability.
8. **No ADR-0014 dependency.** The `rule_link` field on `RUBRIC_MISSING` findings points to `docs/adr/ADR-0014-pilot-review-orchestration.md#rubric-as-file`. This ADR lives in the **consuming project** (e.g. cabin), not in halli-workflows. The anchor-validation pass (Design Doc §12 step 8e) tolerates a broken `rule_link` by demoting the finding; for `RUBRIC_MISSING` findings the hard-coded ceiling in §6 prevents demotion, so a missing ADR results in an annotation but the severity stays P0. Projects adopting this workflow should either (a) commit ADR-0014 (recommended) or (b) accept the annotation.

---

## Testing approach

The following manual tests cover every branch of the algorithm. They are prerequisites for T1215's acceptance criteria and are re-runnable after each edit to this module.

1. **All-clean baseline**: Run `/pilot-review --app=guestpad` in cabin with all three review rubrics filled in. Assert `findings = []`, `rubricHashes` has exactly 3 keys, `skippedAgents = []`, `haltRequested = false`. Orchestrator proceeds to fan-out.
2. **Missing rubric, no `--force`**: `rm docs/review-rubrics/privacy-gdpr.md`; run. Assert the dashboard contains exactly one `P0 RUBRIC_MISSING` with `location_key=rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing`, no other agent findings, exit code 1, scaffold hint printed to stderr.
3. **Missing rubric, with `--force`**: same filesystem state, run with `--force`. Assert the run completes, the P0 RUBRIC_MISSING still appears in the dashboard, `privacy-gdpr-reviewer` is listed under "SKIPPED AGENTS", other reviewers produce their normal findings, and NO eljun tasks are filed (per §14 flag rule — a forced run is an incomplete audit).
4. **Stub rubric**: `cp docs/review-rubrics/privacy-gdpr.md /tmp/backup.md && echo '# ⚠ This rubric is a scaffold. Fill in the heuristics for your project before running a real review.' | cat - /tmp/backup.md > docs/review-rubrics/privacy-gdpr.md`; run with `--force` (since the reviewer also emits a `rubric_stub_unfilled` finding, and we want to confirm dedup works — or run without `--force` and confirm the reviewer is NOT skipped, which is the Phase 1 behavior). Assert exactly one P1 `rubric_stub_unfilled` finding from the orchestrator, the reviewer also emits its own (they merge via dedup in T1216), the run completes. Restore the file afterward.
5. **Short rubric**: Write a custom `docs/review-rubrics/payment.md` with only 3 `### H<n>.` headings. Run. Assert one P1 `rubric_under_heuristic_minimum` with the 3 count in the evidence, the payment-reviewer still runs, dashboard shows the finding under "MUST-FIX BEFORE PILOT".
6. **Empty rubric**: `> docs/review-rubrics/monitoring.md` (zero bytes); run without `--force`. Assert the file is treated as missing (P0 `file_missing`, not P1 `stub_unfilled` or `under_heuristic_minimum` — empty contents cannot meaningfully be either), `monitoring-reviewer` is skipped, run halts.
7. **Directory where rubric should be**: `rm docs/review-rubrics/privacy-gdpr.md && mkdir docs/review-rubrics/privacy-gdpr.md`; run. Assert treated as missing (not readable as a file), P0 emitted, halt.
8. **Hash stability**: Run twice back-to-back without modifying any rubric file. Assert `rubricHashes` is byte-identical across runs.
9. **Hash change detection**: Run once, record a hash. Append a single space to the end of the rubric file. Run again. Assert the hash changed (proves content sensitivity). Revert the file.
10. **`--include-ux` gate**: Delete `docs/ux-rubrics/guest-tablet.md` but run without `--include-ux`. Assert no finding is emitted for it — UX reviewers are not in the active roster, so their rubric is not checked. Add `--include-ux` to the same run — assert a P0 RUBRIC_MISSING for the UX stub path now appears.

---

## Out of scope (explicit list)

- **Scaffolding.** `/pilot-review --scaffold-rubrics` is a separate command path (authored in a sibling sub-module in Phase 1.5). This module DOES NOT create files.
- **Rubric content validation.** Checking that a rubric's heuristic IDs match what the reviewer emits, that severity tiers are valid enums, or that pass/fail criteria are well-formed — all of this is the reviewer agent's concern. This module only verifies presence, non-stub, and heuristic-count ≥ 5.
- **Fan-out, dedup, verify-claims, sorting.** Steps 3–8 of Design Doc §12 live in sibling modules (T1216, T1217, T1218, T1225) — not here.
- **Eljun filing.** This module never calls eljun. Its output is the finding stream; `fileToEljun` in Design Doc Appendix B handles filing downstream.
- **Dashboard rendering.** The dashboard writer consumes this module's findings but is authored separately.
- **Rubric-hash-aware superseding.** Phase 2 / T1309. This module records the hash; it does not compare it to previous runs.
- **Runtime rubric change detection mid-run.** Rubrics are read once at startup. If a rubric changes during agent fan-out, this module does not notice. Acceptable because a single run takes ~5–10 minutes; mid-run edits are a user error.
- **Config-file-driven registries.** Phase 1 uses a hardcoded per-agent registry (see §Input). Extracting it to a project-level config file (e.g. `.claude/pilot-review.config.json`) is a Phase 2 improvement.
- **Heuristic-pattern fuzz tolerance.** Rubrics that use `### h1.` (lowercase) or `### H01.` (zero-padded) or `##### H1.` (five hashes) are NOT counted by the canonical regex. This is deliberate — the canonical §9 format is `### H<n>. <name>` and authors should follow it. If projects diverge, Phase 2 can widen the regex; Phase 1 rewards conformance.

---

## References

- Design Doc: `docs/design/pilot-review-system-design.md`
  - §3 System Architecture (reviewer roster, model assignments)
  - §9 Rubric File Convention (authoritative source — location, format, fail-loud protocol, scaffolding, minimum heuristic coverage)
  - §10 Eljun Integration Protocol (rubric_hash in footer)
  - §12 Orchestration Flow step 2 (where this module is invoked)
  - §14 Scoping Flags (--force, --scaffold-rubrics, flag interaction rules)
  - §22 Appendix B Orchestrator Pseudocode (step 2 "Rubric existence check")
- Canonical contracts:
  - `halli-workflows:types/finding.md` — Finding schema (10 required fields)
  - `halli-workflows:types/location-key.md` §6 (rubric-gap grammar)
  - `halli-workflows:types/preflight-hash.md` (how rubric_hash differs from preflight_hash)
- Plugin-side orchestrator: `halli-workflows:commands/pilot-review-orchestrator.md` — the main orchestrator, which will invoke this sub-module at step 2 once Phase 1.4 sub-modules are wired in (Phase 1.5 integration work).
- Task file: `docs/plans/tasks/T1215-orchestrator-rubric-check.md` (in the consuming project) — acceptance criteria and testing procedure.
- Consuming-project ADR: `docs/adr/ADR-0014-pilot-review-orchestration.md` (cabin) — the `#rubric-as-file` anchor is the `rule_link` target for `RUBRIC_MISSING` findings.

## Rule 13 note

This module itself must obey Rule 13. Concretely:

- NEVER emit a finding whose evidence is not tied to a real file read. If `exists()` returned false, the evidence string must say so explicitly — not "the rubric looks incomplete" or any other vague framing.
- NEVER compute a hash over contents that were not actually read (e.g. synthesizing a default hash for absent files). Absent files are simply excluded from `rubricHashes`.
- NEVER return `haltRequested=false` just because the caller passed `--force`. The flag is consumed by the caller; this module's output is flag-agnostic. Muddying the two is how incomplete audits become silent failures.
- If this module crashes (e.g. permission error on a rubric file), propagate the error — the orchestrator converts it into a P3 `REVIEWER_CRASHED`-style finding per Design Doc §13 Q2. DO NOT swallow the error and return an empty result.
