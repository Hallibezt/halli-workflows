---
name: pilot-review-orchestrator
description: Plugin-side orchestrator for /pilot-review — fans out to reviewer agents, aggregates findings against the canonical schema, writes a severity-ordered dashboard. Scaffold phase — agents populated in T1207–T1214.
---

**Command Context**: Plugin-side orchestrator for the `/pilot-review` pre-pilot audit squad (Design Doc §3, §11, §12, §22).

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

This command is the plugin-side counterpart to each project's `.claude/commands/pilot-review.md` shim. The shim gathers project-local context (target app, rubric paths, eljun slug, flags) and dispatches here. This command then loads stack context, fans out to ten reviewer agents (none wired yet — T1207–T1214), aggregates findings against the canonical `halli-workflows:types/finding.md` contract, and writes the dashboard.

**Execution protocol**:

1. Load stack context (root CLAUDE.md + routed domain CLAUDE.md files).
2. Resolve the reviewer roster for this run (respect `--skip` / `--only` / `--include-ux`).
3. At the scaffold stage: skip rubric-existence check, skip agent fan-out (roster is empty), skip verify-claims, skip eljun, skip backlog. Proceed to write an empty dashboard.
4. At final shape (T1207+): fan out agents at the configured concurrency, aggregate, verify claims, route by severity.
5. Write `docs/preflight/run-YYYY-MM-DD-HHMM.md` with the Design Doc §11 skeleton even when findings are empty.
6. Never mutate source files. The only writes this command performs are under `docs/preflight/`.

## Inputs (from the shim)

The shim passes these fields in the prompt:

- `repo_root` — absolute path to the consuming repo root
- `app_slug` — the `apps/<slug>` being reviewed (e.g. `guestpad`)
- `eljun_project_slug` — eljun project mapping (e.g. `guestpad`)
- `root_claude_md_path` — absolute path to root `CLAUDE.md`
- `domain_claude_md_paths` — array of additional `CLAUDE.md` files routed via the Context Router (for `guestpad`: `apps/guestpad/src/app/api/CLAUDE.md`)
- `commit_sha` — current short SHA for dashboard run-metadata
- `flags` — parsed flag object from the shim (`app`, `skip`, `only`, `includeUx`, `since`, `dryRun`, `force`, `concurrency`, `scaffoldRubrics`, `commitArtifacts`, `outputFormat`)

If any of these are missing or malformed, fail loud — do NOT guess defaults.

## Execution Flow

### Step 1: Load Stack Context

```bash
# Confirm root CLAUDE.md exists and emit its size so the user sees we read it
! test -f "$ROOT_CLAUDE_MD" || { echo "[pilot-review-orchestrator] ERROR: root CLAUDE.md missing at $ROOT_CLAUDE_MD"; exit 1; }
! wc -l "$ROOT_CLAUDE_MD"
# Confirm each domain CLAUDE.md exists
! for p in $DOMAIN_CLAUDE_MD_PATHS; do test -f "$p" && echo "OK: $p" || { echo "[pilot-review-orchestrator] ERROR: domain CLAUDE.md missing at $p"; exit 1; }; done
```

Read each file with the Read tool (or an equivalent load step) and extract:

- From root CLAUDE.md: Supreme Rules (Rule 0, Rule 1, Rule 2, Rule 3, Rule 4, Rule 11, Rule 12, Rule 13, Rule 14), Context Router, Anti-Patterns list, Current State notes.
- From domain CLAUDE.md: domain-specific patterns, templates, and anti-patterns the orchestrator should include in agent prompts later.

This stack context is NOT displayed to the user. It is passed into each reviewer's prompt during fan-out (T1207+). At the scaffold stage, we simply prove the files were read by logging their paths and line counts.

### Step 2: Resolve the Reviewer Roster

Full roster (from Design Doc §3):

1. `halli-workflows:drift-gate` — shells out to `npm run drift:json` (T1207).
2. `halli-workflows:codebase-auditor` — reused existing agent (T1208).
3. `halli-workflows:isolation-reviewer` — new (T1209).
4. `halli-workflows:auth-boundary-reviewer` — new (T1210).
5. `halli-workflows:privacy-gdpr-reviewer` — new (T1211).
6. `halli-workflows:payment-reviewer` — new (T1212).
7. `halli-workflows:freshness-reviewer` — new (T1213).
8. `halli-workflows:monitoring-reviewer` — new (T1214).
9. `halli-workflows:owner-ux-reviewer` — Phase 2 (deferred).
10. `halli-workflows:guest-ux-reviewer` — Phase 2 (deferred).

At the scaffold stage (T1201), the roster is **empty** because none of the agents exist yet. Each T1207–T1214 task bumps the plugin version and adds exactly one agent to the roster. T1215 adds the rubric-existence gate.

Flag filtering (applied AFTER the roster is built in later tasks):

- If `flags.only` is set, keep only the named agent.
- Else if `flags.skip` is non-empty, drop those agents.
- If `flags.includeUx` is false, drop UX reviewers (agents 9–10).
- If a reviewer's required rubric file is missing and `flags.force` is false, the orchestrator emits a `RUBRIC_MISSING` P0 finding and skips the reviewer. This gate is wired in T1215.

### Step 3: Fan Out (scaffold: no-op)

At final shape this is:

```
const rawFindings = await runSquad(roster, flags.concurrency || 5);
```

Where `runSquad` is the semaphore in Design Doc §13 (wired in T1225) that invokes each agent via the Task tool with `subagent_type: halli-workflows:<agent-name>`.

At the scaffold stage, `rawFindings = []`. Do NOT invoke any reviewer — agents don't exist yet. Do NOT fabricate findings. This is a Rule 13 guardrail: an empty dashboard is the HONEST output when there are no reviewers.

### Step 4: Aggregate (scaffold: no-op)

At final shape (T1216, T1218):

```
const grouped        = groupByLocationKey(rawFindings);
const merged         = grouped.map(mergeGroup);           // max severity, union witnesses
const verified       = await runGroundTruthVerifier(merged);  // /verify-claims pass
const anchorChecked  = validateRuleLinkAnchors(verified); // rule_link slug resolution
const sorted         = anchorChecked.sort(severityThenWitnessCount);
```

At the scaffold stage, `sorted = []`. Skip all aggregation steps.

### Step 5: Write the Dashboard

Compute the run timestamp and paths:

```
runId      = YYYY-MM-DD-HHMM                    # UTC, derived from Date.now() formatted to minute precision
outputDir  = docs/preflight/run-${runId}        # created if it does not exist — ensure artifacts sub-dir also exists
dashboard  = docs/preflight/run-${runId}.md
```

Ensure `docs/preflight/` exists. If `.gitkeep` is present there from the T1201 scaffold, leave it alone.

Render the dashboard as **the §11 skeleton** (all section headers present, empty bullet lists OK). Use the exact Design Doc §11 section headers (BLOCKERS — MUST FIX BEFORE PILOT / MUST-FIX BEFORE PILOT (P1) / POST-PILOT (P2) / REVIEW NOTES (P3) / TOP DOMAIN CONCENTRATIONS / FRESHNESS SIGNAL / MONITORING SIGNAL / DRIFT SIGNAL / SKIPPED AGENTS / NEXT ACTIONS / RUN METADATA).

The scaffold template (empty run):

```markdown
# Pilot Review Run — {runId}

**Verdict**: 0 P0 blockers, 0 P1, 0 P2, 0 P3-notes
**Squad**: 0/10 ok (scaffold stage — reviewer agents land in T1207–T1214)
**Run time**: <elapsed seconds>s
**Token estimate**: n/a (no agents invoked)
**Flags**: `{flag string as received from shim}`
**Commit SHA**: {commit_sha}
**Target**: `apps/{app_slug}`

---

## BLOCKERS — MUST FIX BEFORE PILOT [0]

_No findings._

---

## MUST-FIX BEFORE PILOT (P1) [0]

_No findings._

---

## POST-PILOT (P2) [0]

_No findings. (P2 items will be appended to `docs/plans/backlog.md` from T1220 onward.)_

---

## REVIEW NOTES (P3) [0]

_No findings. (P3 items will be aggregated into `{outputDir}/review-notes.md` from T1221 onward.)_

---

## TOP DOMAIN CONCENTRATIONS

_No findings to concentrate. Signal appears once reviewers are wired (T1207+)._

---

## FRESHNESS SIGNAL

_Not collected in this run — `halli-workflows:freshness-reviewer` lands in T1213._

---

## MONITORING SIGNAL

_Not collected in this run — `halli-workflows:monitoring-reviewer` lands in T1214._

---

## DRIFT SIGNAL

_Not collected in this run — `halli-workflows:drift-gate` wiring lands in T1207._

---

## SKIPPED AGENTS

All 10 reviewers skipped — scaffold stage. Roster is intentionally empty at T1201. Each of T1207–T1214 adds one reviewer; T1215 adds the rubric-existence gate; T1216/T1218 add dedup + verify-claims; T1220/T1221/T1222/T1223 wire the output fan-out.

---

## NEXT ACTIONS

1. This is the Phase 1 scaffold (T1201). Confirm the wiring by inspecting this file — headers present, source tree untouched.
2. Proceed to T1207 (drift-gate wiring) to land the first reviewer.
3. After T1214, re-run `/pilot-review --app={app_slug}` to exercise the full squad.

---

## RUN METADATA

- Plugin version: `halli-workflows@{plugin.version}` (read from `.claude-plugin/plugin.json`)
- Reviewer models used: none (scaffold)
- Concurrency: {flags.concurrency || 5} (no-op while roster is empty)
- Rubric versions: none (rubric-existence check lands in T1215)
- Cost estimate: $0.00 USD (no LLM invocation beyond this orchestrator)
- Dry-run: {flags.dryRun}
- Force: {flags.force}

---

*Generated by `halli-workflows:pilot-review-orchestrator` (scaffold, T1201). See `docs/design/pilot-review-system-design.md` §11 for the final dashboard shape.*
```

**Rule: empty-safe rendering.** The renderer MUST produce a valid Markdown file even when every findings bucket is empty. No conditional "skip the section if empty" logic — empty sections render with an `_No findings._` placeholder line so the shape is invariant across runs.

Use the Write tool to write the dashboard file. Do NOT use Edit (the file is fresh on every run).

### Step 6: Output Fan-Out

At final shape (T1220, T1222, T1223):

- Write `{outputDir}/review-notes.md` with all P3 findings (T1221).
- Write `{outputDir}/artifacts/*` per-agent detail files (wired per-reviewer in T1207+).
- Write `{outputDir}/raw-findings.json` with unaggregated findings (T1216).
- If `!flags.dryRun`: file P0+P1 to eljun via MCP (T1222/T1223).
- If `!flags.dryRun`: append P2 to `docs/plans/backlog.md` (T1220).

At the scaffold stage:

- Skip all eljun writes.
- Skip the backlog append.
- Skip `review-notes.md` and `raw-findings.json` (nothing to write — no findings).
- Do create the `{outputDir}/` directory so future runs find an artifacts home, but leave it empty.

### Step 7: Report

Print exactly one line:

```
Dashboard: {absolute path to dashboard .md}
```

The shim reads this line and surfaces it to the user.

## Safety Guarantees (Design Doc §3, §12 step 11)

Every run MUST satisfy:

- No edits to `apps/**`, `packages/**`, `supabase/migrations/**`, `prisma/**`, `package.json`, `package-lock.json`, or any `.ts`/`.tsx`/`.js`/`.jsx`/`.sql` file anywhere in the repo.
- No `git push`, `git commit`, `git checkout`, or other git state changes.
- No PR merges, no destructive operations.
- Writes are confined to `docs/preflight/**`.

Self-check at the end of the run: before printing `Dashboard: ...`, run `git diff --name-only` and confirm all dirty paths start with `docs/preflight/`. If any do not, print a loud stderr warning with the offending paths.

## Completion Criteria

- [ ] Root CLAUDE.md was read (file size / line count logged).
- [ ] Each domain CLAUDE.md path was read (confirmed present).
- [ ] Roster was built. At T1201 the roster is empty; this is correct.
- [ ] `docs/preflight/run-YYYY-MM-DD-HHMM.md` was written with the §11 skeleton headers.
- [ ] The source tree is unchanged (`git diff` shows only `docs/preflight/*`).
- [ ] The dashboard path was printed as the final stdout line.

## References

- Design Doc: `docs/design/pilot-review-system-design.md`
  - §3 System Architecture
  - §11 Dashboard Format (authoritative template)
  - §12 Orchestration Flow (step-by-step)
  - §13 Concurrency and Retry Strategy
  - §14 Scoping Flags
  - §22 Appendix B — Orchestrator Pseudocode
- Canonical contracts: `halli-workflows:types/finding.md`, `halli-workflows:types/location-key.md`, `halli-workflows:types/preflight-hash.md`
- ADR: `docs/adr/ADR-0014-pilot-review-orchestration.md` (in the consuming project, e.g. cabin)

## Rule 13 note

This orchestrator must NEVER fabricate findings. Empty squad → empty dashboard. If a reviewer later returns malformed JSON or an error, emit a `REVIEWER_CRASHED` P3 finding as documented in Design Doc §13 Q2 — do NOT silently drop the error, and do NOT make up a finding to fill the gap.
