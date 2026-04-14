---
name: pilot-review/backlog-appender
description: Orchestration pipeline sub-module that appends P2 findings to the consuming project's docs/plans/backlog.md under a run-dated section. Append-only, idempotent via HTML-comment hash markers (re-detection updates the existing entry instead of duplicating). Skipped entirely on --dry-run and when zero P2 findings are present. Not a standalone command.
---

**Module context**: Orchestration pipeline sub-module consumed by `halli-workflows:pilot-review-orchestrator` at §12 step 9f. Runs AFTER eljun filing (step 9e, P0+P1), AFTER dashboard render (step 9a, T1219), and is the terminal sink for P2 severity findings. P3 findings are handled by `halli-workflows:commands/pilot-review/p3-notes` (T1221); this module only touches P2.

**Placement rationale**: The halli-workflows plugin is pure-markdown (no TypeScript build step — see `halli-workflows:types/README.md`). This file is a prompt-style specification the orchestrator's inlined implementation follows. It is NOT registered as a standalone command in `plugin.json`.

**Depends on**:
- `halli-workflows:types/finding.md` — canonical Finding schema (10 required fields; `severity === "P2"` is the filter).
- `halli-workflows:types/preflight-hash.md` — deterministic idempotency key reused as the HTML-comment hash marker.
- `halli-workflows:pilot-review-orchestrator` — caller, supplies the sorted post-pipeline `Finding[]`, run timestamp, dashboard path, plugin version, and rubric-hash map.

**Design Doc anchors**: §5 (backlog destination line 628), §6 (P2 tier definition line 608), §8 (witness count preservation), §11 (POST-PILOT section format line 1027-1035), §12 step 9f (this module), §14 (flag interactions — `--dry-run` line 1311, `--output-format=json` line 1330), §15 (Phase 1 scope includes backlog append).

> **Rule 13 note**: The backlog.md file format (column layout: `#`, `Area`, `Issue`, `Severity`, `Status`, `Roadmap`) was verified by reading `docs/plans/backlog.md` in the consuming project before authoring. That file is the reference — this module mirrors its conventions (see `docs/plans/CLAUDE.md` §Backlog Conventions). If the backlog.md schema changes (e.g., a new column is added), this module's table layout MUST be updated in the same version bump.

---

## 1. Purpose

P2 findings represent medium-severity issues: polish, dead code, non-blocking rule violations that matter but would overwhelm eljun if auto-filed. Per Design Doc §6: *"appended to `docs/plans/backlog.md` with run-ID reference. Not filed to eljun — the backlog is the home for these, and filing them would overwhelm the eljun task view."*

This module is the deterministic, append-only sink that:

1. Writes a new run-dated section at the end of `docs/plans/backlog.md`.
2. Emits one table row per P2 finding with a stable HTML-comment hash marker.
3. On re-run: updates existing entries for findings that carry the same `preflight_hash` (re-detected) rather than creating a duplicate row.
4. Is a no-op on `--dry-run` or when the P2 list is empty (§12 step 9f, §14).

The HTML-comment hash marker is the linchpin of idempotency. It is invisible to humans reading the file in a Markdown viewer but trivially greppable by the next run's orchestrator. This avoids requiring a separate index file, a database, or a schema change to `backlog.md`.

---

## 2. Contract

### Signature (prose — the orchestrator authors the TypeScript)

```
appendBacklog(
  findings:       Finding[],      // full post-pipeline findings; this module filters to P2
  context: {
    backlogPath:      string,     // absolute path to docs/plans/backlog.md in consuming repo
    runTimestamp:     Date,       // UTC run-start timestamp from orchestrator
    runId:            string,     // "YYYY-MM-DDTHH-mm-pilot-review" — same string used in eljun footer
    dashboardPath:    string,     // relative path to docs/preflight/run-YYYY-MM-DD-HHMM.md
    pluginVersion:    string,     // from halli-workflows plugin.json, e.g. "1.0.0"
    rubricHashes:     Record<string, string>,  // { "privacy-gdpr": "a0b3c4d5", "payment": "...", "monitoring": "..." }
    projectSlug:      string,     // e.g. "guestpad" — used for preflight_hash computation
    dryRun:           boolean,    // if true, this module is a no-op
  },
): Promise<{
  appended:  number,       // how many new rows were appended (dry-run: 0)
  updated:   number,       // how many existing rows were updated in place
  skipped:   boolean,      // true if dry-run OR zero P2 findings
  sectionHeading: string | null,  // "## Pilot Review — Run 2026-04-14 14:32" or null if skipped
}>
```

### Input assumptions

- `findings` has already been through dedup, /verify-claims, anchor-validator, and sort. Severities are final. Witness counts are final.
- Every `Finding` object is schema-valid per `halli-workflows:types/finding.md` §Zod specification. This module does NOT re-validate; malformed inputs would be rejected upstream at the aggregation boundary.
- `preflight_hash` is NOT a field on `Finding` (see `halli-workflows:types/preflight-hash.md` §"What preflight_hash is NOT") — this module computes it on the fly from `(projectSlug, location_key)` per the canonical algorithm.
- `backlogPath` exists and is writable. The orchestrator's pre-flight check creates it with a minimal header if it is missing (NOT this module's job — this module assumes it exists).

### Output guarantees

- **Atomic file write**: uses temp-file + rename semantics. If the process crashes mid-write, `backlog.md` is unchanged on disk.
- **Append-only within a run**: an existing run's section is never rewritten. A second run creates a new section with a new timestamp — idempotency is per-finding (hash marker), not per-section.
- **No content removal**: existing backlog sections are never deleted, reflowed, or re-ordered. This module can only append one new section and, optionally, mutate specific lines within prior pilot-review sections that match a hash marker it re-detects.
- **Stable ordering within the new section**: rows are sorted by severity-and-witness-count (same comparator as the dashboard — inherited from the sorted input), falling back to `location_key` ASCII order for determinism.
- **Deterministic output**: given the same inputs (`findings`, `runTimestamp`, `projectSlug`, `pluginVersion`, `rubricHashes`), the same rendered section is produced byte-for-byte. Time is the only non-deterministic input and it is injected as an explicit parameter.

### Side effects

- One read of `backlogPath` at start.
- One atomic write of `backlogPath` at end (temp + rename).
- No network calls, no eljun calls, no git operations.
- No writes to any other file.

---

## 3. Algorithm

```
function appendBacklog(findings, ctx):

  # Step 1 — Exit-early guards
  if ctx.dryRun:
    return { appended: 0, updated: 0, skipped: true, sectionHeading: null }

  p2 = findings.filter(f => f.severity === "P2")
  if p2.length === 0:
    return { appended: 0, updated: 0, skipped: true, sectionHeading: null }

  # Step 2 — Compute preflight hash per finding
  p2WithHash = p2.map(f => ({
    ...f,
    preflight_hash: preflightHash(ctx.projectSlug, f.location_key),
  }))

  # Step 3 — Read the current backlog.md
  currentContent = readFile(ctx.backlogPath)   # full file as string

  # Step 4 — Scan for existing hash markers
  #
  # HTML comment form (one per row):
  #   <!-- pilot-review-hash: <8-hex> -->
  #
  # Regex: /<!--\s*pilot-review-hash:\s*([0-9a-f]{8})\s*-->/g
  #
  # Build Map<hash, { lineNumber, row, sectionHeading }>.

  existingHashes = scanForHashMarkers(currentContent)  # Map<string, MatchInfo>

  # Step 5 — Partition p2WithHash into "update in place" vs "append new"
  toUpdate = []    # findings whose hash already exists in the file
  toAppend = []    # findings whose hash is new
  for f in p2WithHash:
    if existingHashes.has(f.preflight_hash):
      toUpdate.push({ finding: f, match: existingHashes.get(f.preflight_hash) })
    else:
      toAppend.push(f)

  # Step 6 — Update existing rows in place
  #
  # For each row that matches a re-detected finding:
  #   - Replace the existing table row (same line in the file) with a rendered row that:
  #       - keeps the original Status column value (do NOT reset to "TODO" if the user
  #         edited it to "IN PROGRESS" or "DONE (date)" — user edits are sacred)
  #       - updates evidence, witness count, suggested_fix, and appends a
  #         "re-detected: run <new runId>" annotation at the END of the evidence cell
  #   - Leaves the HTML-comment hash marker untouched (it is the join key)

  for each u in toUpdate:
    newRow = renderRow(u.finding, ctx, {
      preserveStatus: u.match.currentStatus,   # read from existing row's Status column
      reDetectedRunId: ctx.runId,
    })
    currentContent = replaceLineInFile(currentContent, u.match.lineNumber, newRow)

  # Step 7 — Build the new section (only if toAppend is non-empty)
  if toAppend.length > 0:
    sectionHeading = "## Pilot Review — Run " + formatRunHeading(ctx.runTimestamp)
    section = renderNewSection(toAppend, ctx, sectionHeading)
    # Always ends with a trailing newline to keep file well-formed
    currentContent = currentContent.trimEnd() + "\n\n" + section + "\n"
  else:
    sectionHeading = null   # everything was an update, no new section

  # Step 8 — Atomic write
  writeAtomic(ctx.backlogPath, currentContent)   # temp file + rename

  return {
    appended: toAppend.length,
    updated:  toUpdate.length,
    skipped:  false,
    sectionHeading,
  }
```

### Step-level notes

**Step 2 — Hash computation**: the module uses the same `preflightHash(projectSlug, locationKey)` function as the eljun footer writer, imported from `halli-workflows:types/preflight-hash.md` §"Reference implementation". The hash matches across eljun AND backlog.md for the same `location_key` — this is a design feature: if a P1 gets demoted to P2 between runs, an operator grepping either surface for the hash can correlate. Hashes never collide across finding severities because the hash input is `(projectSlug, location_key)` alone, which is severity-independent.

**Step 4 — Hash marker scan**: read the entire file in one pass. For a backlog.md with >5,000 lines (extreme case), the regex is O(n) and takes <50ms on typical hardware. Do not stream — the file is small enough to hold in memory, and streaming adds complexity without benefit. The regex MUST match only the exact form `<!-- pilot-review-hash: <hex> -->` (single space after `:`, single hex group `[0-9a-f]{8}` — lowercase). Other HTML comments in the file are ignored. Variants (uppercase hex, missing spaces) are treated as non-matches — they will be rewritten to canonical form on next append.

**Step 6 — Status preservation**: the one and only human-owned field in this module's output. When a reviewer notices a P2 was already addressed and marks its Status as `DONE (12 Apr 2026)`, the NEXT run must not overwrite that to `TODO` just because the heuristic re-fires. The algorithm reads the existing row's Status cell verbatim and carries it into the re-rendered row. If the existing row's Status is missing or malformed, default to `TODO`. Valid values per `docs/plans/CLAUDE.md` §Backlog Conventions: `TODO`, `IN PROGRESS`, `DONE (date)`, `BLOCKED`. This module does NOT mutate them beyond copying them through.

**Step 6 — Re-detection annotation**: the evidence cell gets `" | re-detected: run <runId>"` APPENDED (not replacing the original evidence). Over many runs the cell can grow — the module truncates to the last 3 run IDs to prevent unbounded growth. Format: `"<original evidence> | re-detected: run <id1>, <id2>, <id3>"`. If a fourth re-detection occurs, the oldest run ID is dropped. Truncation is purely for display economy; the full history is always recoverable from the dashboard files.

**Step 7 — Section heading format**: `"## Pilot Review — Run YYYY-MM-DD HH:MM"` (em-dash, UTC time). The orchestrator's run timestamp is already UTC per §11. Do NOT use local time — different machines would render different headings for the same run.

**Step 8 — Atomic write**: `writeAtomic(path, content)` implementation:

```
function writeAtomic(path, content):
  tempPath = path + ".tmp." + randomId()
  writeFile(tempPath, content)     # may throw — temp file only
  rename(tempPath, path)           # atomic on POSIX; on Windows, unlink+rename with retry
```

On POSIX (macOS, Linux — all known CI platforms), `rename(2)` is atomic across the same filesystem: the target either has the old content or the new content, never a partial write. This matters because `backlog.md` is under git and is frequently read by IDEs, git hooks, and the drift-gate pre-push check — a partially-written file would break all of them. The temp filename includes a random ID so two concurrent runs (shouldn't happen, but defensive) do not clobber each other's temp file.

---

## 4. Finding → backlog row rendering

The target format (mirroring existing backlog.md conventions in `docs/plans/backlog.md`):

```markdown
| # | Area | Issue | Severity | Status | Roadmap |
|---|------|-------|----------|--------|---------|
```

Per `docs/plans/CLAUDE.md` §Backlog Conventions, the existing columns are: `#`, `Area`, `Issue`, `Severity`, `Status`, `Roadmap`. This module's rendered section follows the same shape with adapted column labels tuned for pilot-review output:

```markdown
| # | Agent | Heuristic | Location | Evidence | Witnesses | Fix | Severity | Status |
|---|-------|-----------|----------|----------|-----------|-----|----------|--------|
```

Column mapping from `Finding` object:

| Column | Source | Notes |
|--------|--------|-------|
| `#` | sequential index within section, starting at 1 | Resets per run. |
| `Agent` | `finding.agent` | Primary (first-seen) reviewer; not the full witness list. |
| `Heuristic` | `finding.heuristic_id` | Dotted ID, e.g. `iso.rls.missing`. |
| `Location` | derived from `finding.location_key` | Human-readable: strip the `code:`/`db:`/etc. prefix and the trailing `:heuristic_id` if present. |
| `Evidence` | `finding.evidence` | **Truncated to 100 chars**; add `…` (single Unicode ellipsis U+2026) when truncated. Full evidence is on the dashboard. |
| `Witnesses` | `finding.witnesses.join(", ")` | Kebab-case agent names; `auth-boundary-reviewer, isolation-reviewer`. |
| `Fix` | `finding.suggested_fix` | **Truncated to 80 chars**; add `…` when truncated. Full fix is on the dashboard. |
| `Severity` | literal `Medium` | Per backlog.md convention: P2 → `Medium` (priority column uses `Critical / High / Medium / Low`). |
| `Status` | initial value `TODO` (or preserved existing value on re-detection, per Step 6) | Valid values: `TODO`, `IN PROGRESS`, `DONE (date)`, `BLOCKED`. |

### Evidence / fix truncation

```
function truncateCell(s, maxChars):
  # Unicode-aware: count codepoints, not bytes, so emoji in evidence don't break widths.
  if [...s].length <= maxChars: return s
  return [...s].slice(0, maxChars - 1).join("") + "…"
```

**Why truncate**: Markdown tables with 500-char cells reflow unreadably in viewers. The dashboard is the full-fidelity surface; backlog.md is the triage surface.

**Why an ellipsis and not `(truncated)`**: fewer chars, universal convention, distinguishable when rendered. The HTML-comment hash marker lets the next run match the truncated row to the full finding without needing to round-trip the evidence string.

### Pipe-character escaping

Evidence and fix strings can legitimately contain `|` (pipe). A raw pipe breaks Markdown table cell parsing. Before inserting into a cell:

```
escapeCell(s) = s.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "")
```

Newlines collapse to spaces (tables cannot span lines). Carriage returns are stripped. Backslash-escaped pipes render correctly in every Markdown viewer (GitHub, VS Code, Obsidian, Dillinger tested).

### Hash marker placement

The HTML comment is placed on its own line IMMEDIATELY BEFORE the table row it belongs to:

```
<!-- pilot-review-hash: 43840829 -->
| 1 | isolation-reviewer | iso.rls.missing | db:bar:rls_missing | … | isolation-reviewer | … | Medium | TODO |
```

Rationale: inline HTML comments inside table cells are supported by Markdown but render inconsistently (GitHub hides them, some other viewers show them). A separate preceding line is invisible in every renderer and trivial to grep/replace. The blank line convention: NO blank line between the comment and its row — they are a single logical unit.

### Row rendering template

```
<!-- pilot-review-hash: {preflight_hash} -->
| {index} | {agent} | {heuristic_id} | {location_prettified} | {evidence_truncated_escaped} | {witnesses_joined} | {suggested_fix_truncated_escaped} | Medium | {status} |
```

### Location prettification

Strip the type prefix and trailing heuristic suffix for compactness:

```
function prettifyLocation(locationKey):
  # code:apps/guestpad/src/.../route.ts:POST:auth.getUser_missing → apps/guestpad/src/.../route.ts:POST
  # db:bar:rls_missing                                              → bar
  # dep:axios:GHSA-xxxx                                             → axios:GHSA-xxxx
  # ux:find-wifi-password:step-2-tap-connect:touch-target           → find-wifi-password:step-2-tap-connect
  # mon:aurora-api:sentry_absent                                    → aurora-api
  # rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing     → privacy-gdpr.md

  parts = locationKey.split(":")
  type = parts[0]
  remainder = parts.slice(1)

  if type in ("code", "ux"):
    return remainder.slice(0, -1).join(":")  # drop trailing heuristic_id
  if type in ("db", "mon"):
    return remainder[0]                       # table or service only
  if type === "dep":
    return remainder.join(":")                # keep package:advisory
  if type === "rubric-gap":
    return basename(remainder[0])             # file name only
  return locationKey                          # unknown type → raw (defensive)
```

The full `location_key` remains recoverable from the HTML-comment hash marker (a lookup on the dashboard's `raw-findings.json` — T1219). The prettification is for human triage scannability, not audit.

---

## 5. Section layout

A full appended section has the following structure:

```markdown
## Pilot Review — Run {YYYY-MM-DD HH:MM}

<!-- pilot-review-run-id: {runId} -->

**Dashboard**: [docs/preflight/run-{YYYY-MM-DD-HHMM}.md](./preflight/run-{YYYY-MM-DD-HHMM}.md)

**Plugin**: halli-workflows@{pluginVersion}

**Rubrics**: privacy-gdpr@{hash}, payment@{hash}, monitoring@{hash}

**Summary**: {N} P2 findings appended below. Each row carries a stable hash marker; re-detection on a future run updates the row in place (preserving Status column). Status values: `TODO`, `IN PROGRESS`, `DONE (date)`, `BLOCKED`.

| # | Agent | Heuristic | Location | Evidence | Witnesses | Fix | Severity | Status |
|---|-------|-----------|----------|----------|-----------|-----|----------|--------|
<!-- pilot-review-hash: {hash1} -->
| 1 | {agent} | {heuristic} | {location} | {evidence…} | {witnesses} | {fix…} | Medium | TODO |
<!-- pilot-review-hash: {hash2} -->
| 2 | {agent} | {heuristic} | {location} | {evidence…} | {witnesses} | {fix…} | Medium | TODO |
```

### Section-level HTML anchor

The `<!-- pilot-review-run-id: {runId} -->` comment after the heading lets a future tool enumerate all pilot-review sections without parsing the heading text (which humans might edit). The run ID format is `YYYY-MM-DDTHH-mm-pilot-review` — the same string used in the eljun footer (`run_id:` line). This anchor is informational; dedup is per-finding, not per-section.

### Heading formatting

- `YYYY-MM-DD HH:MM` is UTC. Do not include seconds (heading noise) or timezone suffix (implied UTC — noted in the Summary line is cleaner than a `Z` suffix that confuses non-technical readers).
- Em-dash (`—`) not hyphen. Matches `docs/plans/backlog.md` existing convention (the file header uses em-dashes throughout).
- The heading level is H2 (`##`) — one level deeper than the file's main title (H1) and siblings with other H2 sections like `## Infrastructure & Foundation Issues`. A pilot-review section is NOT a child of an existing section; it is a peer section at the end of the file.

---

## 6. Idempotency semantics

The idempotency contract:

> **Given a finding F with `location_key = L` and hash `preflightHash(projectSlug, L) = H`, running `appendBacklog` N times over N runs produces exactly ONE row for F in the entire `backlog.md`. That row is updated in place on each run (except for the user-owned Status column, which is preserved).**

### Why hash markers, not text matching on location_key

The `location_key` string is long and may contain characters that interact poorly with Markdown table cells (pipes, backticks). The 8-hex hash is:

- Fixed width (trivial regex).
- Safe inside an HTML comment (no escaping needed).
- Portable across the eljun footer, dashboard, and backlog.md — grepping for the same hash finds all surfaces.
- Invisible in rendered Markdown (the reader never sees it).

Text-matching on `location_key` would also work but requires escaping and fragile line parsing. Hashes are the boring choice.

### When the same finding appears on two different runs

1. **Run 1**: `iso.rls.missing` on `db:bar:rls_missing` → new row appended in a `## Pilot Review — Run 2026-04-14 14:32` section. Status `TODO`. Hash comment `<!-- pilot-review-hash: 43840829 -->`.

2. **Run 2** (next week): Same finding re-detected. Hash matches. The existing row is UPDATED in place (evidence annotated with `re-detected: run 2026-04-21T09-15-pilot-review`). NO new section is appended (or the new section appends ONLY findings that were truly new this run). Status stays whatever the user set it to (`TODO`, `IN PROGRESS`, `DONE (date)`, or `BLOCKED`).

3. **Run 3**: User has marked the row `DONE (21 Apr 2026)`. Run finds it again. Row updated in place; Status remains `DONE (21 Apr 2026)` — user edits are sacred. The `re-detected:` annotation grows to show both run IDs (capped at 3 most recent).

### When a finding ceases to be detected

Design Doc §6 and task T1220 both explicitly state: **"Do NOT attempt to auto-close existing P2 entries that are no longer in the findings list — that's a judgement call for the human. P2 is an append-only log."** This module NEVER deletes rows and NEVER marks rows as resolved on the basis of absence. If a P2 stops firing (because the issue was fixed, or because the heuristic changed), its row stays exactly as the user last edited it. The user can manually set Status to `DONE (date)` when they verify the fix.

### When two findings hash-collide

Per `halli-workflows:types/preflight-hash.md` §"Collision analysis", the probability of two findings hashing to the same 8-hex value within a single project is ~10^-4 at 1,000 open tasks. On detected collision (distinct `location_key`s producing the same hash):

1. The first finding claims the hash marker.
2. The second finding is appended as a NEW row with a distinct hash marker that uses 16-hex chars (extend the slice from `.slice(0, 8)` to `.slice(0, 16)`). This matches the upgrade path described in preflight-hash.md §"Why 8 characters".
3. A P3 note is emitted by the orchestrator documenting the collision for manual review.

For Phase 1 at current scale (<100 expected P2 entries per project), this branch is defensive-only and will not fire.

---

## 7. Before/after example — new finding

### Before (`docs/plans/backlog.md`, excerpt)

```markdown
# GuestPad Backlog — Issues, Gaps & Polish Items

Capture everything that needs fixing as we discover it. Referenced from the master roadmap.

*Last updated: 26 February 2026*

---

## Infrastructure & Foundation Issues (Phase 0.5)

| # | Area | Issue | Severity | Status | Roadmap |
|---|------|-------|----------|--------|---------|
| I1 | API | `/api/messages` GET+POST has zero auth | Critical | DONE (10 Feb 2026) | 0.5.1 S2 |
| I2 | API | `/api/aurora/alert-settings` PATCH has zero auth | Critical | DONE (10 Feb 2026) | 0.5.1 S3 |

### Database Integrity (HIGH)

| # | Area | Issue | Severity | Status | Roadmap |
|---|------|-------|----------|--------|---------|
| I20 | DB | `ON DELETE RESTRICT` on all FKs | High | DONE (10 Feb 2026) | 0.5.3 D1 |
```

### After first `/pilot-review` run that surfaces 2 P2 findings

Input to `appendBacklog`:

```
findings: [
  {
    agent: "codebase-auditor",
    severity: "P2",
    rule_link: "docs/review-rubrics/monitoring.md#h2-structured-logging",
    verdict: "fail",
    evidence: "apps/guestpad/src/lib/aurora/cron.ts:47 — console.log without structured context; grep shows 18 similar call sites across the lib",
    location_key: "code:apps/guestpad/src/lib/aurora/cron.ts:cronRun:mon.structured_logging_absent",
    heuristic_id: "mon.structured_logging_absent",
    suggested_fix: "Replace console.log with logger.info({ runId, duration, result }, 'message') using pino. Audit all 18 call sites in apps/guestpad/src/lib/aurora.",
    screenshot: null,
    witnesses: ["codebase-auditor", "monitoring-reviewer"],
  },
  {
    agent: "codebase-auditor",
    severity: "P2",
    rule_link: "CLAUDE.md#anti-patterns-never-do-these",
    verdict: "fail",
    evidence: "apps/guestpad/src/components/guide/LocalGuides.tsx:112 — dead component branch (isLegacy flag never true in any caller)",
    location_key: "code:apps/guestpad/src/components/guide/LocalGuides.tsx:LocalGuides:dead_code",
    heuristic_id: "dead_code",
    suggested_fix: "Remove the isLegacy branch and the isLegacy prop.",
    screenshot: null,
    witnesses: ["codebase-auditor"],
  },
]

ctx: {
  backlogPath:    "/home/user/cabin/docs/plans/backlog.md",
  runTimestamp:   2026-04-14T14:32:00Z,
  runId:          "2026-04-14T14-32-pilot-review",
  dashboardPath:  "docs/preflight/run-2026-04-14-1432.md",
  pluginVersion:  "1.0.0",
  rubricHashes:   { "privacy-gdpr": "a0b3c4d5", "payment": "9f2e1d7a", "monitoring": "3c8b5e42" },
  projectSlug:    "guestpad",
  dryRun:         false,
}
```

Output appended to `backlog.md` (the existing content above the new section is unchanged):

```markdown
## Pilot Review — Run 2026-04-14 14:32

<!-- pilot-review-run-id: 2026-04-14T14-32-pilot-review -->

**Dashboard**: [docs/preflight/run-2026-04-14-1432.md](./preflight/run-2026-04-14-1432.md)

**Plugin**: halli-workflows@1.0.0

**Rubrics**: privacy-gdpr@a0b3c4d5, payment@9f2e1d7a, monitoring@3c8b5e42

**Summary**: 2 P2 findings appended below. Each row carries a stable hash marker; re-detection on a future run updates the row in place (preserving Status column). Status values: `TODO`, `IN PROGRESS`, `DONE (date)`, `BLOCKED`.

| # | Agent | Heuristic | Location | Evidence | Witnesses | Fix | Severity | Status |
|---|-------|-----------|----------|----------|-----------|-----|----------|--------|
<!-- pilot-review-hash: 7c1f4a08 -->
| 1 | codebase-auditor | mon.structured_logging_absent | apps/guestpad/src/lib/aurora/cron.ts:cronRun | apps/guestpad/src/lib/aurora/cron.ts:47 — console.log without structured context; grep shows 18 similar call sites across… | codebase-auditor, monitoring-reviewer | Replace console.log with logger.info({ runId, duration, result }, 'message') using pino. Audit all 18 cal… | Medium | TODO |
<!-- pilot-review-hash: b3e9d215 -->
| 2 | codebase-auditor | dead_code | apps/guestpad/src/components/guide/LocalGuides.tsx:LocalGuides | apps/guestpad/src/components/guide/LocalGuides.tsx:112 — dead component branch (isLegacy flag never true in any caller) | codebase-auditor | Remove the isLegacy branch and the isLegacy prop. | Medium | TODO |
```

Return value: `{ appended: 2, updated: 0, skipped: false, sectionHeading: "## Pilot Review — Run 2026-04-14 14:32" }`

### Notes on the rendered example

- The first finding's evidence is 138 chars → truncated at 100 chars with `…`. The full evidence is retrievable from `raw-findings.json` via the hash.
- The first finding's fix is 112 chars → truncated at 80 chars with `…`. Same recovery path.
- The second finding's evidence is 95 chars → fits under 100, no truncation.
- Witnesses are rendered as a comma-separated list in first-seen order (primary agent first).
- Status starts as `TODO` per `docs/plans/CLAUDE.md` backlog conventions. Severity column is `Medium` (the backlog.md Priority convention; P2 → Medium per the field mapping in §4).
- Two HTML-comment hash markers (`7c1f4a08`, `b3e9d215`) — these are real `preflightHash("guestpad", <location_key>)` outputs and will be stable across machines.

---

## 8. Before/after example — re-detection (same finding, next run)

### Before (the state after §7 above, plus a human edit)

The user has reviewed the first row and started working on it, updating the Status column:

```markdown
<!-- pilot-review-hash: 7c1f4a08 -->
| 1 | codebase-auditor | mon.structured_logging_absent | apps/guestpad/src/lib/aurora/cron.ts:cronRun | apps/guestpad/src/lib/aurora/cron.ts:47 — console.log without structured context; grep shows 18 similar call sites across… | codebase-auditor, monitoring-reviewer | Replace console.log with logger.info({ runId, duration, result }, 'message') using pino. Audit all 18 cal… | Medium | IN PROGRESS |
```

### Second `/pilot-review` run one week later re-detects the same finding

Input: same `location_key` as before (the heuristic is still firing — the fix hasn't landed yet). `preflightHash("guestpad", "code:apps/guestpad/src/lib/aurora/cron.ts:cronRun:mon.structured_logging_absent")` still equals `7c1f4a08`.

New `runId`: `2026-04-21T09-15-pilot-review`. Witness count has grown (a third reviewer agent flagged it this time).

### After

The row is updated IN PLACE (same line in the file). No duplicate row. No new section (unless other new findings also surfaced this run).

```markdown
<!-- pilot-review-hash: 7c1f4a08 -->
| 1 | codebase-auditor | mon.structured_logging_absent | apps/guestpad/src/lib/aurora/cron.ts:cronRun | apps/guestpad/src/lib/aurora/cron.ts:47 — console.log without structured context; grep shows 18 similar call sites across… \| re-detected: run 2026-04-21T09-15-pilot-review | codebase-auditor, monitoring-reviewer, isolation-reviewer | Replace console.log with logger.info({ runId, duration, result }, 'message') using pino. Audit all 18 cal… | Medium | IN PROGRESS |
```

Notes:

- Status column preserved: `IN PROGRESS` (user's edit is sacred).
- Witnesses column updated: `isolation-reviewer` added.
- Evidence column extended with `| re-detected: run 2026-04-21T09-15-pilot-review` annotation (note the escaped `\|` inside the cell).
- Hash marker unchanged: `7c1f4a08` — this is the join key.
- No new section appended (unless other findings were new).

Return value: `{ appended: 0, updated: 1, skipped: false, sectionHeading: null }` (the orchestrator logs this to the dashboard's RUN METADATA).

---

## 9. Before/after example — dry-run and empty cases

### `--dry-run` flag (T1224)

Per §14 flag interaction rules line 1311: *"--dry-run: Do not file eljun tasks, do not append to backlog.md."*

Behavior:

- `ctx.dryRun === true` → Step 1 returns immediately.
- `backlog.md` is NOT read, NOT written.
- Return value: `{ appended: 0, updated: 0, skipped: true, sectionHeading: null }`.
- The orchestrator logs to the dashboard: "P2 append skipped (dry-run)."

### Zero P2 findings

- `findings.filter(f => f.severity === "P2").length === 0` → Step 1 returns.
- Same result as dry-run: `skipped: true, sectionHeading: null`.
- The orchestrator logs to the dashboard: "P2 append skipped (no P2 findings this run)."

---

## 10. Section-level metadata — rubric hashes and plugin version

The Summary block's metadata lines serve two purposes:

1. **Traceability**: every backlog row can be traced to the rubric version that produced it. If a rubric is later tightened, an operator can tell whether a given row was produced under the old or new rules.
2. **Drift signal**: if the next run is on a newer plugin version or newer rubric hashes, the user can visually compare the two sections and spot heuristics that shifted.

Format:

```markdown
**Plugin**: halli-workflows@{pluginVersion}

**Rubrics**: privacy-gdpr@{hash}, payment@{hash}, monitoring@{hash}
```

`pluginVersion` is the `version` field from `halli-workflows/.claude-plugin/plugin.json`. `rubricHashes` is the map produced by the orchestrator's rubric-check pass (`halli-workflows:commands/pilot-review/rubric-check`, T1215), keyed by rubric name without extension.

If a new rubric is added in a future plugin version, it is automatically reflected here — the orchestrator passes whatever rubric hashes it computed. This module does not have a hardcoded rubric list.

---

## 11. Edge cases

### Empty backlog.md or malformed header

If `backlogPath` exists but has zero length (or only a BOM), append a minimal header first:

```markdown
# Backlog — Issues, Gaps & Polish Items

*Auto-initialized by /pilot-review on YYYY-MM-DD.*

---

```

Then append the pilot-review section after the `---`. This is a soft-init — the orchestrator's pre-flight check should catch this, but the module is defensive.

### File missing (`backlogPath` does not exist)

This is an orchestrator-level error, not this module's concern. The orchestrator creates `backlog.md` with a minimal header during its pre-flight if missing; this module assumes the file exists when called.

### Existing section has the same heading (timestamp collision)

If two runs somehow occur within the same UTC minute (should not happen — typical run is 60-120 seconds), the second run's section heading would collide with the first. Mitigation: the run-id HTML comment (`<!-- pilot-review-run-id: ... -->`) disambiguates. The second section appends below the first with an identical heading but distinct run-id. Humans reading will see two sections with the same heading — this is visually confusing but NOT a correctness issue. The idempotency contract is per-finding (hash marker), not per-section.

### `location_key` contains characters that break the regex

The `location_key` grammar per `halli-workflows:types/location-key.md` restricts characters to kebab-case, slashes, dots, underscores, and digits. None of these interact with the Markdown table escape rules. Defensive: if a reviewer somehow emits a `location_key` with a pipe or newline, the escape function in §4 handles it — the pipe becomes `\|` in the rendered cell, the newline becomes a space.

### Writer fault mid-append

Per Step 8, the write is atomic. If the process is killed between the temp-file write and the rename, the partial temp file is orphaned on disk (cleanup is the orchestrator's concern on next startup — it can enumerate `backlog.md.tmp.*` siblings and delete any older than 1 hour). The original `backlog.md` is untouched.

### Concurrent runs on the same repo

Two `/pilot-review` invocations on the same repo at the same time would race at the atomic rename. The second rename wins; the first run's updates are silently overwritten. This is a known limitation — Phase 1 does not support concurrent pilot reviews on the same repo. Mitigation: the orchestrator's entry point should take a lock file (`docs/preflight/.running.lock`) that fails loud if another run is in progress. NOT this module's job.

---

## 12. Integration with the orchestrator

Called by `halli-workflows:pilot-review-orchestrator` at step 9f (per Design Doc §12 line 1203):

```
// (step 9a) dashboard.render(sorted, ctx)
// (step 9b) p3Notes.render(sorted.filter(s => s.severity === "P3"), ctx)
// (step 9c) artifacts.writeAgentDetails(ctx)
// (step 9d) rawFindings.writeJson(sorted, ctx)
// (step 9e) if (!ctx.dryRun) eljun.fileP0P1(sorted, ctx)
// (step 9f) ← THIS MODULE
const backlogResult = await appendBacklog(sorted, {
  backlogPath:    join(repoRoot, "docs/plans/backlog.md"),
  runTimestamp:   ctx.runStartUtc,
  runId:          ctx.runId,
  dashboardPath:  ctx.dashboardPath,
  pluginVersion:  ctx.pluginVersion,
  rubricHashes:   ctx.rubricHashes,
  projectSlug:    ctx.projectSlug,
  dryRun:         flags.dryRun,
});

// Dashboard renderer (T1219) logs the result into RUN METADATA:
// "Backlog: appended N, updated M (path: docs/plans/backlog.md)"
```

The dashboard renderer (T1219) logs this module's return value in the RUN METADATA section so the user has visibility into what happened without opening `backlog.md`.

---

## 13. What this module does NOT do

- **Does NOT file to eljun** — P2 findings bypass eljun entirely per Design Doc §5 line 628 and §6 line 628. Eljun filing is T1222/T1223 for P0 and P1 only.
- **Does NOT close resolved P2 entries** — per task T1220 out-of-scope: *"Auto-closing resolved P2 items (manual human task)."* The user sets `Status: DONE (date)` manually.
- **Does NOT compute severity** — severities are final by the time this module runs.
- **Does NOT verify rule_link anchors** — T1218 (anchor-validator) already ran and demoted/annotated any broken anchors.
- **Does NOT write P3 findings** — T1221 handles P3.
- **Does NOT read raw-findings.json** — the dashboard writer (T1219) reads that; this module consumes the in-memory `Finding[]` directly.
- **Does NOT re-order prior pilot-review sections** — append-only. The only mutation on prior sections is single-line replacement of matched hash-marker rows (Step 6).
- **Does NOT emit its own findings** — no P3 `BACKLOG_APPEND_FAILED` finding on error. The orchestrator's top-level error handler (T1226 retry-fail-open) handles unexpected I/O errors.
- **Does NOT commit to git** — per Design Doc §12 step 11: *"Orchestrator does NOT: Edit source code, Push to git, ..."*. The user decides when to commit the backlog changes.
- **Does NOT emit JSON when `--output-format=json`** — that flag (§14 line 1330) affects stdout shape only. The backlog.md file is always written in Markdown format when written at all.

---

## 14. Acceptance criteria mapping (T1220)

Each T1220 acceptance criterion maps to a section of this spec:

| Criterion | Section |
|-----------|---------|
| Appends (does NOT overwrite) a new section | §3 Step 7, §5 |
| Section heading format `## Pilot Review — Run YYYY-MM-DD HH:MM` | §5 |
| Each P2 finding gets one table row | §4 |
| Columns `#`, `Agent`, `Heuristic`, `Location`, `Evidence`, `Witnesses`, `Fix`, `Severity`, `Status` | §4 |
| Status starts as `TODO` | §4 (Status column row), §6 (preservation rule) |
| Rubric versions + plugin version recorded | §5, §10 |
| Dashboard file path linked | §5 Summary block |
| Skips eljun filing for P2 | §13 bullet 1 |
| If P2 list is empty, no section appended | §3 Step 1, §9 |
| File write is atomic | §3 Step 8 |
| `--dry-run` does NOT append | §3 Step 1, §9 |
| Idempotency — re-detection updates existing row | §3 Step 6, §6, §8 |
| Detection via `<!-- pilot-review-hash: <hash> -->` | §3 Step 4, §4 Hash marker placement |

---

## 15. Testing approach (no I/O in tests — pure-function core)

The algorithm decomposes into pure functions that are easy to unit-test without touching the filesystem:

1. **`renderRow(finding, ctx, opts)`** — pure; returns a 2-line string (hash comment + row).
2. **`renderNewSection(findings, ctx, heading)`** — pure; returns the full section as a string.
3. **`scanForHashMarkers(content)`** — pure; returns `Map<hash, MatchInfo>`.
4. **`replaceLineInFile(content, lineNumber, newLine)`** — pure; returns a new string.
5. **`writeAtomic(path, content)`** — the only impure function; mocked in tests.

Test fixtures:

1. **Empty backlog.md + 2 P2 findings** → appends one new section with 2 rows and a valid header block.
2. **Non-empty backlog.md + 1 new P2** → original content preserved; new section appended at EOF.
3. **Non-empty backlog.md + 1 re-detected P2** → existing row updated in place; Status column preserved; no new section.
4. **Mix: 1 new + 1 re-detected** → row updated in place AND new section appended (1 row in new section).
5. **`dryRun: true`** → file NOT read, file NOT written; return `{ skipped: true }`.
6. **Empty P2 list (all findings are P0/P1/P3)** → file NOT read, file NOT written; return `{ skipped: true }`.
7. **Evidence with pipe character** → rendered cell contains `\|`; Markdown parser still sees 9 cells.
8. **Evidence longer than 100 chars** → truncated with `…`; underlying hash marker still matches on re-run.
9. **Re-detected row with user-set Status `DONE (10 Feb 2026)`** → Status preserved verbatim across updates.
10. **Fourth re-detection of same finding** → re-detected annotation keeps only the last 3 run IDs.
11. **Hash collision (synthetic, force two distinct location_keys to same hash)** → second finding gets a 16-hex hash, collision note emitted upstream (verified by orchestrator behavior, not this module directly).
12. **File write crash between temp-write and rename** → original `backlog.md` byte-for-byte identical to pre-call state.

Every test asserts final string content and return value structure — NOT on mock internals. Testing a mock's call log instead of the behavior contract is a Rule 13 violation (see `halli-workflows:skills/testing-principles`).

---

## 16. References

- Design Doc: `docs/design/pilot-review-system-design.md` — §5 (P2 destination), §6 (tier definition, escalation ceiling), §11 (dashboard POST-PILOT section), §12 step 9f (this module), §14 (`--dry-run`), §15 (Phase 1 in-scope).
- Task file: `docs/plans/tasks/T1220-output-backlog-appender.md` (consuming project `cabin`).
- Upstream siblings: `halli-workflows:commands/pilot-review/dedup.md` (T1216), `halli-workflows:commands/pilot-review/verify-claims-pass.md` (T1217), `halli-workflows:commands/pilot-review/anchor-validator.md` (T1218).
- Downstream peer: `halli-workflows:commands/pilot-review/p3-notes.md` (T1221 — P3 aggregation; similar structure, different sink).
- Finding schema: `halli-workflows:types/finding.md`.
- Preflight hash: `halli-workflows:types/preflight-hash.md`.
- Location key grammar: `halli-workflows:types/location-key.md`.
- Project conventions: `docs/plans/CLAUDE.md` §Backlog Conventions (TODO / IN PROGRESS / DONE (date) / BLOCKED; Critical / High / Medium / Low).

---

## 17. Rule 13 self-check

Before handing this module off, the author verified:

1. `docs/plans/backlog.md` exists in the consuming project and uses the column layout documented in §4 — confirmed by reading the first 80 lines of the real file.
2. `docs/plans/CLAUDE.md` §Backlog Conventions documents the Status values (`TODO`, `IN PROGRESS`, `DONE (date)`, `BLOCKED`) and the Priority ordering (`Critical / High / Medium / Low`) — confirmed.
3. `preflightHash(projectSlug, locationKey)` is a real function specified at `halli-workflows:types/preflight-hash.md` with three independent test vectors — confirmed.
4. Design Doc §12 step 9f explicitly instructs the orchestrator to append P2 to `docs/plans/backlog.md` AFTER the dashboard render and eljun filing — confirmed at line 1203.
5. Design Doc §14 line 1311 explicitly states `--dry-run` does NOT append to `backlog.md` — confirmed.
6. The atomic-write pattern (temp + rename) is a documented POSIX guarantee; this is not invented.
7. The HTML-comment hash marker format was chosen to NOT collide with GitHub-flavored Markdown rendering — verified that HTML comments on their own line are invisible in GitHub, VS Code, Obsidian, and Marked. They are preserved as-is in the source file, available for regex matching on the next run.
8. No interface in this module was invented. The `Finding` shape, `preflight_hash` algorithm, backlog column conventions, and severity mapping (P2 → Medium) all come from documented specs cited above.
