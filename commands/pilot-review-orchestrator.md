---
name: pilot-review-orchestrator
description: Plugin-side orchestrator for /pilot-review — parses flags, loads stack context, pre-flights rubrics, fans out to 8 reviewer agents in parallel (semaphore default 5), runs the full aggregation pipeline (dedup → verify-claims → anchor-validator), routes findings by severity (P0+P1 → eljun, P2 → backlog.md, P3 → review-notes.md), and writes a severity-ordered dashboard. Read-only on source tree. Every sub-stage follows a dedicated pure-markdown spec under commands/pilot-review/.
---

**Command Context**: Plugin-side orchestrator for the `/pilot-review` pre-pilot audit squad (Design Doc §3, §11, §12, §22).

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

This command is the plugin-side counterpart to each project's `.claude/commands/pilot-review.md` shim. The shim gathers project-local context (target app, rubric paths, eljun slug, flags) and dispatches here. This command is the single coordinator of the end-to-end pipeline — every sub-stage is specified in a pure-markdown module under `halli-workflows:commands/pilot-review/`. The orchestrator's job is to follow those specs and wire them together in order; it does NOT re-specify their internal algorithms.

**Execution protocol at a glance**:

1. Parse flags per `commands/pilot-review/flags.md`. Fail loud on invalid combos.
2. Load stack context — root CLAUDE.md + routed domain CLAUDE.md files.
3. Resolve reviewer roster (8 backend agents by default; +2 UX when `--include-ux`). Apply `--only` / `--skip`.
4. Rubric-existence pre-flight per `commands/pilot-review/rubric-check.md`. Halt on P0 RUBRIC_MISSING unless `--force`.
5. Fan out to reviewers in parallel per `commands/pilot-review/concurrency.md` + `commands/pilot-review/retry-fail-open.md`.
6. Collect `Finding[]` from every agent. Validate against `halli-workflows:types/finding.md`.
7. Dedup per `commands/pilot-review/dedup.md` (group by `location_key`, max severity, union witnesses).
8. Verify-claims post-pass per `commands/pilot-review/verify-claims-pass.md` (demotion on refutation).
9. Anchor validation per `commands/pilot-review/anchor-validator.md` (demote on broken rule_link).
10. Sort by severity-then-witness-count. Route findings:
    - P0+P1 → eljun per `commands/pilot-review/eljun-wiring.md` + `commands/pilot-review/eljun-client.md` (skipped on `--dry-run` or `--force`)
    - P2 → `commands/pilot-review/backlog-appender.md` (skipped on `--dry-run`)
    - P3 → `commands/pilot-review/p3-notes-aggregator.md` (always runs; also writes `raw-findings.json`)
11. Render dashboard per `commands/pilot-review/dashboard-generator.md`. Write to `docs/preflight/run-YYYY-MM-DD-HHMM.md`.
12. Self-check: confirm `git diff` only touches `docs/preflight/**` and `docs/plans/backlog.md`. Print final dashboard path.

## Inputs (from the shim)

The shim passes these fields in the prompt:

- `repo_root` — absolute path to the consuming repo root
- `app_slug` — the `apps/<slug>` being reviewed (e.g. `guestpad`)
- `eljun_project_slug` — eljun project mapping (e.g. `guestpad`)
- `root_claude_md_path` — absolute path to root `CLAUDE.md`
- `domain_claude_md_paths` — array of additional `CLAUDE.md` files routed via the Context Router (for `guestpad`: `apps/guestpad/src/app/api/CLAUDE.md`)
- `commit_sha` — current short SHA for dashboard run-metadata
- `flags` — the raw `$ARGUMENTS` string as received by the shim (the orchestrator re-parses per §Step 1 — do not trust a pre-parsed object)

If any of these are missing or malformed, fail loud — do NOT guess defaults.

## Execution Flow

### Step 1: Parse Flags

Follow `halli-workflows:commands/pilot-review/flags.md` exactly. The orchestrator constructs the `env: FlagEnv` input itself:

```
env = {
  repoRoot: <repo_root from shim>,
  knownAgents: [
    "drift-gate-reviewer",
    "codebase-auditor-adapter",
    "isolation-reviewer",
    "auth-boundary-reviewer",
    "privacy-gdpr-reviewer",
    "payment-reviewer",
    "freshness-reviewer",
    "monitoring-reviewer",
    "owner-ux-reviewer",      // Phase 2 — legal only with --include-ux
    "guest-ux-reviewer",      // Phase 2 — legal only with --include-ux
  ],
  uxAgents: ["owner-ux-reviewer", "guest-ux-reviewer"],
}
```

Invoke `parseFlags(argString, env)` as specified in that module. On any thrown error, print the error message verbatim to stderr and exit non-zero. Do NOT continue with partial flags.

The returned `Flags` object is the single source of truth for every behavioral branch downstream. Never re-parse flags inline; always read from `flags`.

**Rule 13 note**: The flag parser fails loud on unknown flags, malformed concurrency, mutual-exclusion violations, and Playwright-absent-with-`--include-ux`. Do NOT attempt graceful degradation here — the contract in flags.md is "throw on user error". A silent-ignore lets the user think they ran the configuration they typed when in fact they ran a different one.

### Step 2: Load Stack Context

```bash
# Confirm root CLAUDE.md exists and emit its size so the user sees we read it
! test -f "{root_claude_md_path}" || { echo "[pilot-review-orchestrator] ERROR: root CLAUDE.md missing at {root_claude_md_path}"; exit 1; }
! wc -l "{root_claude_md_path}"
# Confirm each domain CLAUDE.md exists
! for p in {domain_claude_md_paths}; do test -f "$p" && echo "OK: $p" || { echo "[pilot-review-orchestrator] ERROR: domain CLAUDE.md missing at $p"; exit 1; }; done
```

Read each file with the Read tool. Extract:

- From root CLAUDE.md: Supreme Rules (Rule 0, Rule 1, Rule 2, Rule 3, Rule 4, Rule 11, Rule 12, Rule 13, Rule 14), Context Router, Anti-Patterns, Current State.
- From each domain CLAUDE.md: domain-specific patterns, templates, and anti-patterns.

This stack context is NOT displayed to the user. It is threaded into each reviewer's prompt during fan-out (Step 5). Every reviewer agent that requires CLAUDE.md context reads these files itself too — the orchestrator's read is both a presence check and a way to include the content in the fan-out prompt when the agent needs concatenated context.

### Step 3: Resolve Reviewer Roster

**Phase 1 default roster (8 backend agents)** — invokable via `halli-workflows:<name>`:

| # | Agent name | Model | Required rubric |
|---|------------|-------|-----------------|
| 1 | `drift-gate-reviewer` | none (shell wrapper) | none |
| 2 | `codebase-auditor-adapter` | haiku | none |
| 3 | `isolation-reviewer` | opus | none (rubric = CLAUDE.md Rule 0 / Rule 4) |
| 4 | `auth-boundary-reviewer` | opus | none (rubric = CLAUDE.md Rule 2 / Rule 3 / api/CLAUDE.md) |
| 5 | `privacy-gdpr-reviewer` | opus | `docs/review-rubrics/privacy-gdpr.md` |
| 6 | `payment-reviewer` | opus | `docs/review-rubrics/payment.md` |
| 7 | `monitoring-reviewer` | sonnet | `docs/review-rubrics/monitoring.md` |
| 8 | `freshness-reviewer` | haiku | none (live npm/GHSA/deps.dev — stack-agnostic per §4.7) |

**Phase 2 roster additions (only when `flags.includeUx === true`)**:

| # | Agent name | Model | Required rubric |
|---|------------|-------|-----------------|
| 9 | `owner-ux-reviewer` | sonnet | `docs/ux-rubrics/owner-dashboard.md` |
| 10 | `guest-ux-reviewer` | sonnet | `docs/ux-rubrics/guest-tablet.md` |

Build the initial roster in the order above.

**Flag filtering** (applied AFTER building the default roster):

1. If `flags.only.length > 0`: keep only those agents; drop everything else.
2. Else if `flags.skip.length > 0`: drop those agents.
3. If `flags.includeUx === false`: drop Phase 2 UX reviewers. (The shim and `parseFlags` already validate `--only` vs UX, but apply here for belt-and-suspenders.)
4. If `flags.includeUx === true && flags.playwrightAvailable === false`: emit the `PLAYWRIGHT_ABSENT` P0 finding (shape in flags.md §"PLAYWRIGHT_ABSENT finding") and drop UX reviewers from the roster. The run continues for non-UX agents — this is `--include-ux` without infrastructure; fail-open with visible dashboard signal.

After filtering, the roster is a `AgentDescriptor[]` where each descriptor carries `{ name, requiredRubrics }` for the rubric-check step. If the roster is empty (e.g. `--only` reduced it to zero), proceed anyway — an empty-safe dashboard is the correct output.

**Rule 13 note**: Never fabricate a reviewer. If a name in `flags.only` doesn't match the roster, `parseFlags` has already thrown in Step 1. If the shim passes a roster that includes a name not in the table above, fail loud (caller bug, not user error).

### Step 4: Rubric Existence Pre-Flight

Follow `halli-workflows:commands/pilot-review/rubric-check.md`. Invoke `rubricCheck(input)` where:

```
input = {
  repoRoot: <repo_root>,
  activeAgents: <roster from Step 3 with { name, requiredRubrics }>,
  force: flags.force,
}
```

The module returns `{ findings, rubricHashes, skippedAgents, haltRequested }`.

Handle the return:

- **Merge `findings` into the run's finding stream**. These are orchestrator-emitted P0 `RUBRIC_MISSING` and P1 `rubric_stub_unfilled` / `rubric_under_heuristic_minimum` findings. They flow through the same dedup / verify-claims / anchor-validator pipeline as reviewer findings (verify-claims exempts `RUBRIC_MISSING` per its exemption list).
- **Drop `skippedAgents` from the roster** before fan-out. An agent without its required rubric would fabricate standards per Rule 13.
- **Preserve `rubricHashes`** for use in the eljun footer (T1222 `preflight_hash`) and the dashboard's RUN METADATA section.
- **Halt decision**: if `haltRequested === true && flags.force === false`, short-circuit the pipeline:
  1. Render an early dashboard via `dashboard-generator.md` with ONLY the `RUBRIC_MISSING` findings in the BLOCKERS bucket and an empty rest.
  2. Write the dashboard file and the `raw-findings.json` sidecar.
  3. Print `Dashboard: <path>` plus a helpful stderr message: "Rubric files missing: <comma-separated list>. Scaffold with: /pilot-review --scaffold-rubrics, or re-run with --force to skip the gate."
  4. Exit non-zero.

If `flags.force === true`, the rubric gate is a soft warning — the run continues with the remaining agents, but per `flags.md` §Force semantics, **eljun filing is suppressed for the entire run** regardless of `dryRun`. Record this in a local `eljunSuppressedReason = "force"` so Step 10 knows.

**Scaffold-safe invariant**: if `activeAgents` is empty (e.g. `--only` dropped it to zero in Step 3), the rubric-check returns `{ findings: [], rubricHashes: {}, skippedAgents: [], haltRequested: false }` and the pipeline proceeds to Step 5 which also no-ops. The dashboard renders well-formed with zero findings.

### Step 5: Fan Out to Reviewers in Parallel

Follow `halli-workflows:commands/pilot-review/concurrency.md` and `halli-workflows:commands/pilot-review/retry-fail-open.md`.

Build an `Agent[]` array by wrapping each roster member with its invocation function:

```
agents = roster.map(r => ({
  name: r.name,
  invoke: () => invokeViaTaskTool({
    subagent_type: `halli-workflows:${r.name}`,
    description: `pilot-review — ${r.name}`,
    prompt: buildAgentPrompt(r.name, {
      repo_root,
      app_slug,
      root_claude_md_path,
      domain_claude_md_paths,
      since_ref: sinceAppliesTo(r.name) ? flags.since : null,
    }),
  }),
}))
```

**`sinceAppliesTo(agentName)`** — per flags.md §since:
- Returns `flags.since` for: `codebase-auditor-adapter`, `isolation-reviewer`, `auth-boundary-reviewer`, `privacy-gdpr-reviewer`, `payment-reviewer`, `owner-ux-reviewer`, `guest-ux-reviewer`.
- Returns `null` (always full-scope) for: `drift-gate-reviewer`, `freshness-reviewer`, `monitoring-reviewer`.

**`buildAgentPrompt`** constructs the per-agent prompt. Each reviewer's own system prompt describes what it expects as user input; the orchestrator's prompt is a thin invocation note:

```
prompt: |
  You are invoked as part of the pilot-review squad.

  Target project: {repo_root}
  Target app: {app_slug} (apps/{app_slug})
  Root CLAUDE.md: {root_claude_md_path}
  Domain CLAUDE.md files routed by Context Router: {domain_claude_md_paths joined by ", "}
  Since ref (scope to files changed since this ref; null = full scope): {since_ref ?? "null"}

  Follow your system prompt. Read the rubric (if any) yourself. Emit a JSON
  array of canonical Finding objects per halli-workflows:types/finding.md on
  stdout (or via your Output Format section). Emit nothing else on stdout.
```

**Concurrency + retry wrapping** — per concurrency.md §5 and retry-fail-open.md §4:

```
wrappedAgents = agents.map(a => ({
  name: a.name,
  invoke: () => runAgentWithRetry(a, {
    timeoutMs: (process.env.PILOT_REVIEW_AGENT_TIMEOUT ? parseInt * 1000 : 300_000),
    retryDelayMs: (process.env.PILOT_REVIEW_RETRY_DELAY ? parseInt * 1000 : 5000),
    ruleLink: "docs/adr/ADR-0014-pilot-review-orchestration.md#consequences",
    heuristicId: "REVIEWER_CRASHED",
    validateFindings: zodValidateFindingArray,   // orchestrator's Finding[] schema
  }),
}))

rawFindings = await runSquad(wrappedAgents, flags.concurrency)
```

- `runSquad` is the semaphore from concurrency.md. Default 5; clamped to `[1, 10]` with a stderr warning if `flags.concurrency` is outside the range (belt-and-suspenders — `parseFlags` already rejects `<1`).
- `runAgentWithRetry` is the retry wrapper from retry-fail-open.md. It NEVER throws. On persistent failure or malformed output, it returns `[crashFinding]` (a single synthetic `REVIEWER_CRASHED` P3 finding).
- The semaphore's own `catch` block is a second-line defense. Under normal operation the retry layer catches all errors.

**Token + cost tracking**: the semaphore's `onInvocationEnd` callback is where per-agent telemetry is captured. Keep a running tally of `{ inputTokens, outputTokens, costUsd }` by reading from the Task tool's return envelope where available. When the environment does not surface token counts (common in Phase 1), emit `tokens: { input: 0, output: 0 }` and `costUsd: 0` into the dashboard and note the absence — do NOT fabricate numbers per Rule 13.

**Rule 13 note**: If ALL reviewers in the roster crash, the output is `roster.length` synthetic `REVIEWER_CRASHED` P3 findings — NOT a halt. The dashboard renders with those findings in REVIEW NOTES (P3) and SKIPPED AGENTS, and the user sees the full crash signal.

### Step 6: Validate and Collect Findings

`rawFindings` is a flat `Finding[]` concatenated from every reviewer's output.

Each finding must conform to `halli-workflows:types/finding.md` — 10 required fields, no extras. Use the orchestrator's Zod schema (`zodValidateFindingArray` injected in Step 5).

Validation behavior:
- If a reviewer returns a single malformed finding, that reviewer's output was already discarded by the retry wrapper's `validateFindings` call and replaced with a `REVIEWER_CRASHED` finding. No malformed findings should reach this step.
- Belt-and-suspenders: filter `rawFindings` through the Zod schema one more time. Any findings that fail are logged to stderr with full details and dropped from the live pipeline, but PRESERVED verbatim in `raw-findings.json` (Step 10c) so the audit trail is complete. Emit ONE orchestrator-level P3 finding per dropped finding with `heuristic_id: "MALFORMED_FINDING"`, `location_key: "mon:pilot-review:malformed_finding:<agent>:<index>"`, and `evidence: "Reviewer <agent> emitted finding at index <i> that failed Finding schema validation: <zod error summary>. Original content preserved in raw-findings.json."`

After this step, `rawFindings` is the pre-dedup audit source, and `validFindings` is the pipeline input for Step 7.

### Step 7: Dedup

Follow `halli-workflows:commands/pilot-review/dedup.md`. Invoke `dedup(validFindings)`.

The module groups by `location_key`, merges each group (max severity, union witnesses, first-seen agent as primary, first-seen rule_link), and returns a `Finding[]` where `output.map(f => f.location_key)` has no duplicates.

Call it `dedupedFindings`. Length may be less than `validFindings.length`.

### Step 8: Verify-Claims Post-Pass

Follow `halli-workflows:commands/pilot-review/verify-claims-pass.md`. Invoke `verifyClaimsPass(dedupedFindings, { repo_root })`.

The module partitions findings into exempt / verify / passthrough buckets:
- **Exempt** (no verifier call): `agent === "drift-gate-reviewer"`, `heuristic_id === "RUBRIC_MISSING"`, `agent === "freshness-reviewer" && heuristic_id ~ /^fresh\.cve\./`, `location_key` matches `/^(dep|mon|rubric-gap):/`.
- **Verify** (sent to `halli-workflows:ground-truth-verifier`): every non-exempt P0 and P1 finding.
- **Passthrough** (no verifier call this run): non-exempt P2 and P3 findings.

On REFUTED verdicts the module demotes one tier (`P0→P1→P2→P3→P3`) and annotates evidence. On UNVERIFIABLE it leaves severity unchanged and annotates. On verifier failure it appends a single `VERIFICATION_UNAVAILABLE` P3 finding and passes inputs through with a `verify_status: not-verified-this-run` annotation.

Call the result `verifiedFindings`. Length is `dedupedFindings.length` or `dedupedFindings.length + 1` (degraded verifier case).

### Step 9: Anchor Validation

Follow `halli-workflows:commands/pilot-review/anchor-validator.md`. Invoke `validateRuleLinks(verifiedFindings, repo_root)`.

The module parses each `rule_link` into `(targetPath, anchor)`, reads the target file (cached by path), builds a GitHub-slugger-style heading index, and checks whether the anchor resolves. On malformed rule_link or broken anchor: demote one tier + annotate. On missing target file: hard-demote to P3 + annotate. Exempt findings are skipped per §6 ceiling rules.

Call the result `anchorCheckedFindings`. Same length as input.

**Sort**: `sortedFindings = anchorCheckedFindings.sort(severityThenWitnessCount)` — severity ascending (P0 first), witness count descending as tiebreaker, first-seen index as final tiebreaker for determinism.

### Step 10: Route Findings by Severity

Partition `sortedFindings`:

```
p0 = sortedFindings.filter(f => f.severity === "P0")
p1 = sortedFindings.filter(f => f.severity === "P1")
p2 = sortedFindings.filter(f => f.severity === "P2")
p3 = sortedFindings.filter(f => f.severity === "P3")
```

#### 10a. Eljun filing (P0 + P1)

Skip entirely if ANY of these is true:
- `flags.dryRun === true` (record `eljunSuppressedReason = "dry-run"`)
- `eljunSuppressedReason === "force"` from Step 4 (rubric gate short-circuited eljun)
- `p0.length + p1.length === 0` (record `eljunSuppressedReason = "no-p0-p1"`)

Otherwise, follow `halli-workflows:commands/pilot-review/eljun-wiring.md`. The wiring module calls `fileToEljun` from `commands/pilot-review/eljun-client.md` under the hood. Inputs:

```
context = {
  projectSlug:     eljun_project_slug,
  apiBaseUrl:      "https://eljun.vercel.app/api/v1",
  apiKey:          readEnv("ELJUN_API_KEY"),  // fail loud if absent and not dry-run/force
  runId:           <runId — see Step 11>,
  dashboardPath:   <relative dashboard path — docs/preflight/run-{runId}.md>,
  reviewNotesPath: <relative review-notes path>,
  pluginVersion:   <read from halli-workflows/.claude-plugin/plugin.json>,
  rubricHashes:    <from Step 4>,
  flags: { dryRun, force, app: flags.app },
  fetch: <default fetch>,
  now: () => new Date(),
}
```

The wiring returns `{ eljunLinks, filed, patched, overflow, manualFileRequired, collisionUpgrades, skippedReason }`.

**Rule 13 guard**: if `flags.force === true && flags.dryRun === false`, eljun filing MUST remain suppressed (per flags.md §Force semantics — an incomplete audit must not file action items). The eljun-wiring module enforces this internally; the orchestrator must ALSO short-circuit on `eljunSuppressedReason === "force"` as a belt-and-suspenders check.

#### 10b. P2 backlog append

Skip if `flags.dryRun === true` or `p2.length === 0`.

Otherwise, follow `halli-workflows:commands/pilot-review/backlog-appender.md`. Invoke `appendBacklog(sortedFindings, context)` where:

```
context = {
  backlogPath:   <repo_root>/docs/plans/backlog.md,
  runTimestamp: <runStartedAt>,
  runId:        <runId — see Step 11>,
  dashboardPath: docs/preflight/run-{runId}.md,
  pluginVersion: <from plugin.json>,
  rubricHashes:  <from Step 4>,
  projectSlug:   eljun_project_slug,
  dryRun:        false,   // already guarded above
}
```

The module is idempotent via HTML-comment hash markers — re-runs update existing entries rather than duplicate.

#### 10c. P3 notes + raw-findings.json

ALWAYS run, even on `--dry-run` (P3 notes and raw-findings are informational, not state-changing; see p3-notes-aggregator.md §1).

Follow `halli-workflows:commands/pilot-review/p3-notes-aggregator.md`. Invoke `writeP3Notes(input)` where:

```
input = {
  findings:     sortedFindings,
  rawFindings:  rawFindings,          // pre-dedup — for raw-findings.json
  runId:        <runId>,
  runIdDisplay: <runId with space between date and time>,
  outputDir:    <repo_root>/docs/preflight/run-{runId},
  dashboardRelPath: `../run-{runId}.md`,
  pluginVersion: <from plugin.json>,
  rubricRegistry: {
    "gdpr.": "docs/review-rubrics/privacy-gdpr.md",
    "pay.":  "docs/review-rubrics/payment.md",
    "mon.":  "docs/review-rubrics/monitoring.md",
  },
}
```

The module writes `{outputDir}/review-notes.md` and `{outputDir}/raw-findings.json` and returns `{ reviewNotesPath, rawFindingsPath, p3Count, promotionSuggestions }`.

### Step 11: Render Dashboard

Follow `halli-workflows:commands/pilot-review/dashboard-generator.md`. Invoke `generateDashboard(input)` where:

```
runStartedAt = <captured at start of pipeline>
runEndedAt   = <captured just before this call>
runId        = format(runStartedAt, "YYYY-MM-DD-HHMM")   # UTC, per dashboard-generator.md §4.1

input = {
  findings:        sortedFindings,
  rawFindings:     rawFindings,
  runStartedAt,
  runEndedAt,
  flagString:      <raw flags string from shim>,
  flags: {
    app:        flags.app ?? app_slug,
    dryRun:     flags.dryRun,
    force:      flags.force,
    concurrency: flags.concurrency,
    includeUx:  flags.includeUx,
  },
  commitSha:       commit_sha,
  pluginVersion:   <read from halli-workflows/.claude-plugin/plugin.json>,
  squad: {
    total:  roster.length (before rubric-check skipping) + (flags.includeUx ? 2 : 0 — Phase 2 inclusion),
    ok:     <count of agents whose Finding[] did NOT include a REVIEWER_CRASHED finding>,
    reused: 0,   // Phase 2 concept; always 0 in Phase 1
    new:    <same as ok in Phase 1>,
  },
  tokens: { input: <from telemetry>, output: <from telemetry> },
  costUsd: <from telemetry, or 0 if unavailable>,
  eljunLinks: <from Step 10a, or empty object>,
  rubricHashes: <from Step 4>,
  skippedAgents: <union of (rubric-check skipped) + (flag-filtered) + (crashed) — deduped>,
  reviewerModels: {
    "drift-gate-reviewer":        "none",
    "codebase-auditor-adapter":   "claude-haiku-4-5",
    "isolation-reviewer":         "claude-opus-4-6",
    "auth-boundary-reviewer":     "claude-opus-4-6",
    "privacy-gdpr-reviewer":      "claude-opus-4-6",
    "payment-reviewer":           "claude-opus-4-6",
    "monitoring-reviewer":        "claude-sonnet-4-5",
    "freshness-reviewer":         "claude-haiku-4-5",
    // Add UX entries only if includeUx:
    // "owner-ux-reviewer":       "claude-sonnet-4-5",
    // "guest-ux-reviewer":       "claude-sonnet-4-5",
  },
  repoRoot:       repo_root,
  artifactPaths:  <map of finding.location_key → repo-relative artifact path, populated by per-agent artifact writes if any>,
}
```

The module returns `{ dashboardPath, rawFindingsPath, dashboardMarkdown, rawFindingsJson, runId }`.

The orchestrator writes `dashboardMarkdown` to `dashboardPath` using the Write tool. `rawFindingsJson` was already written by the P3 aggregator in Step 10c — dashboard-generator returns it for symmetry but the orchestrator does NOT double-write. (Both modules produce identical JSON; the aggregator wrote first so it "owns" the file. Rule 13 note: if the two outputs diverge, investigate — they are generated from the same `rawFindings` array and should be byte-identical.)

#### 11a. RUN METADATA content

The dashboard's RUN METADATA section must include:

```
- Plugin version: halli-workflows@{pluginVersion}
- Reviewer models used: {reviewerModels map rendered human-readable, e.g. "claude-opus-4-6 (isolation-reviewer, auth-boundary-reviewer, privacy-gdpr-reviewer, payment-reviewer), claude-sonnet-4-5 (monitoring-reviewer), claude-haiku-4-5 (codebase-auditor-adapter, freshness-reviewer). Drift-gate is pure shell-out with no LLM invocation."}
- Concurrency: {flags.concurrency}
- Rubric versions:
  - docs/review-rubrics/privacy-gdpr.md@{rubricHashes["docs/review-rubrics/privacy-gdpr.md"] ?? "missing"}
  - docs/review-rubrics/payment.md@{rubricHashes["docs/review-rubrics/payment.md"] ?? "missing"}
  - docs/review-rubrics/monitoring.md@{rubricHashes["docs/review-rubrics/monitoring.md"] ?? "missing"}
  - (UX rubrics only when --include-ux)
- Cost estimate: {costUsd > 0 ? `~$${costUsd.toFixed(2)} USD` : "n/a (telemetry unavailable)"}
- Run duration: {runEndedAt - runStartedAt} ms
- Dry-run: {flags.dryRun}
- Force: {flags.force}
- Agents skipped: {skippedAgents.length === 0 ? "none" : skippedAgents joined with commas and reason annotations, e.g. "owner-ux-reviewer (--include-ux not set), payment-reviewer (rubric missing)"}
```

This is exactly the schema dashboard-generator.md §4.3 renders — the orchestrator provides the data, the module renders it.

### Step 12: Self-Check and Report

Before printing the final stdout line:

```bash
# Confirm no source files were mutated
! git diff --name-only
```

Verify every dirty path starts with one of:
- `docs/preflight/`
- `docs/plans/backlog.md` (only if `!flags.dryRun && p2.length > 0`)

If any path falls outside this allowlist, print a loud stderr warning listing the offending paths. Do NOT attempt automated cleanup — the user needs to see what happened.

**Print exactly one stdout line**:

```
Dashboard: {absolute path to dashboard .md}
```

The shim reads this line and surfaces it to the user. If `flags.outputFormat === "json"`, dashboard-generator wrote `dashboard.json` alongside; print that path instead.

## Safety Guarantees (Design Doc §3, §12 step 11)

Every run MUST satisfy:

- **Read-only on source tree** — no edits to `apps/**`, `packages/**`, `supabase/migrations/**`, `prisma/**`, `package.json`, `package-lock.json`, or any `.ts`/`.tsx`/`.js`/`.jsx`/`.sql` file anywhere in the repo.
- **Write allowlist (tight)**: ONLY under `docs/preflight/**` and (conditionally) `docs/plans/backlog.md` via the backlog-appender module.
- **Dry-run purity**: `flags.dryRun === true` produces ONLY the dashboard, `review-notes.md`, and `raw-findings.json`. Zero eljun POSTs/PATCHes. Zero backlog append.
- **Force semantics**: `flags.force === true` permits missing rubrics but STILL suppresses eljun writes (incomplete audit must not file action items). Backlog append and P3 notes still run.
- **No halt on single agent crash**: retry-fail-open.md guarantees persistent failures emit `REVIEWER_CRASHED` P3 findings and the run continues with remaining agents.
- **No halt on verifier failure**: verify-claims-pass.md guarantees verifier crashes emit `VERIFICATION_UNAVAILABLE` P3 and the pipeline continues.
- **No git state changes**: no `git push`, `git commit`, `git checkout`, no PR merges, no `git reset`, no destructive operations.
- **Every finding has a resolvable rule_link**: enforced by anchor-validator.md — broken anchors demote, they do not pass through silently.

Self-check at the end of the run (Step 12) confirms these invariants. Violations are surfaced to stderr but the run does not revert — the user is in the loop.

## Scaffold-Safe Rendering

Several edge cases must still produce a well-formed dashboard rather than crashing:

- **Empty roster** (e.g. `--only=some-missing-agent` — wait, `parseFlags` throws; so really: `--only=drift-gate-reviewer` + drift-gate crashes → empty usable findings). Dashboard renders with `_No findings._` in every bucket and SKIPPED AGENTS lists the crashed entry.
- **All rubrics missing + `--force`** — Step 4 keeps only agents without required rubrics (`drift-gate-reviewer`, `isolation-reviewer`, `auth-boundary-reviewer`, `freshness-reviewer`). Those 4 still run. Dashboard includes their findings and the rubric-missing P0s.
- **Every reviewer crashes** — roster.length `REVIEWER_CRASHED` P3 findings flow through dedup (each has a unique location_key so no merging), verify-claims (exempt via `mon:` prefix), and anchor-validator (exempt because they are operational, not code). Dashboard renders them in REVIEW NOTES (P3) and SKIPPED AGENTS.
- **Anchor-validator fails on every finding** — all findings demote one tier; the dashboard still renders in the (now-lower) severity bucket.

The invariant: **the dashboard file is always written** (Step 11 is unconditional). If any earlier step crashes HARD (pre-dashboard), emit a single orchestrator-level P3 finding describing the crash, write a minimal dashboard via dashboard-generator with that finding, and print `Dashboard: <path>` to stdout. The user always gets an artifact. Silence is prohibited.

## Completion Criteria

- [ ] Flags parsed per flags.md; invalid combos failed loud.
- [ ] Root CLAUDE.md was read; each domain CLAUDE.md path was read.
- [ ] Roster built per Step 3 table; filtering applied per flags.
- [ ] Rubric pre-flight ran per rubric-check.md; `haltRequested` handled correctly per `--force`.
- [ ] Fan-out executed per concurrency.md at clamped concurrency; per-agent retry per retry-fail-open.md.
- [ ] `rawFindings` validated against `halli-workflows:types/finding.md` Zod schema.
- [ ] `dedup` → `verify-claims` → `anchor-validator` → `sort` pipeline executed in that order per the sibling module specs.
- [ ] P0+P1 routed to eljun per eljun-wiring.md (skipped on `--dry-run` or `--force`).
- [ ] P2 routed to backlog.md per backlog-appender.md (skipped on `--dry-run`).
- [ ] P3 routed to review-notes.md + raw-findings.json per p3-notes-aggregator.md.
- [ ] Dashboard rendered per dashboard-generator.md §11 template. RUN METADATA includes plugin version, reviewer models, concurrency, rubric hashes, cost, duration, dry-run, force, skipped-agents list.
- [ ] Source tree unchanged (`git diff` allowlist check in Step 12).
- [ ] Dashboard path printed as the final stdout line.

## References

- Design Doc: `docs/design/pilot-review-system-design.md`
  - §3 System Architecture
  - §4 Reviewer Agent Details
  - §5 Canonical Finding Schema
  - §6 Severity Taxonomy + Escalation Rules
  - §7 location_key Grammar
  - §8 Dedup and Multi-Witness Confidence
  - §9 Rubric File Convention
  - §10 Eljun Integration Protocol
  - §11 Dashboard Format (authoritative template)
  - §12 Orchestration Flow (step-by-step)
  - §13 Concurrency and Retry Strategy
  - §14 Scoping Flags
  - §22 Appendix B — Orchestrator Pseudocode
- Canonical contracts: `halli-workflows:types/finding.md`, `halli-workflows:types/location-key.md`, `halli-workflows:types/preflight-hash.md`
- ADR: `docs/adr/ADR-0014-pilot-review-orchestration.md` (in the consuming project, e.g. cabin)
- Pipeline sub-modules (each authored as a pure-markdown spec the orchestrator follows):
  - `halli-workflows:commands/pilot-review/flags.md` — flag parser
  - `halli-workflows:commands/pilot-review/rubric-check.md` — pre-flight
  - `halli-workflows:commands/pilot-review/concurrency.md` — semaphore (runSquad)
  - `halli-workflows:commands/pilot-review/retry-fail-open.md` — per-agent retry + fail-open
  - `halli-workflows:commands/pilot-review/dedup.md` — location_key group/merge
  - `halli-workflows:commands/pilot-review/verify-claims-pass.md` — ground-truth post-pass
  - `halli-workflows:commands/pilot-review/anchor-validator.md` — rule_link anchor check
  - `halli-workflows:commands/pilot-review/eljun-wiring.md` — severity routing
  - `halli-workflows:commands/pilot-review/eljun-client.md` — HTTP client (POST/PATCH, idempotent)
  - `halli-workflows:commands/pilot-review/backlog-appender.md` — P2 → backlog.md
  - `halli-workflows:commands/pilot-review/p3-notes-aggregator.md` — P3 → review-notes.md + raw-findings.json
  - `halli-workflows:commands/pilot-review/dashboard-generator.md` — §11 dashboard render
- Reviewer agents (invokable via `halli-workflows:<name>`):
  - `halli-workflows:drift-gate-reviewer` (shell wrapper)
  - `halli-workflows:codebase-auditor-adapter` (haiku, wraps existing codebase-auditor)
  - `halli-workflows:isolation-reviewer` (opus)
  - `halli-workflows:auth-boundary-reviewer` (opus)
  - `halli-workflows:privacy-gdpr-reviewer` (opus)
  - `halli-workflows:payment-reviewer` (opus)
  - `halli-workflows:monitoring-reviewer` (sonnet)
  - `halli-workflows:freshness-reviewer` (haiku)

## Rule 13 Note

This orchestrator must NEVER fabricate findings. Empty squad → empty dashboard. If a reviewer returns malformed JSON or errors out, the retry-fail-open layer emits a `REVIEWER_CRASHED` P3 finding as documented in Design Doc §13 Q2 — do NOT silently drop the error, and do NOT invent a finding to fill the gap. If the verifier fails, verify-claims-pass emits `VERIFICATION_UNAVAILABLE` P3 — same principle. The dashboard is the truth-telling surface; every degradation signal MUST land there.

Every external interface the orchestrator depends on — the 8 reviewer agents, the 12 sub-module specs, the types/ contracts, the plugin.json version, the ADR anchor — has been verified at author time. If any of those paths return a 404 at runtime, fail loud with the literal path in the error message. Do not guess a "close enough" path.
