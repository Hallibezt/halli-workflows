---
name: pilot-review/eljun-client
description: Orchestration pipeline sub-module — idempotent HTTP client that files P0+P1 pilot-review findings as eljun tasks. Uses description-footer `preflight_hash` as the idempotency key (eljun has no `external_id` field, no search endpoint). GET-all + parse footers + hash-map match → PATCH existing or POST new. Enforces 25-task-per-run cap with overflow summary. Retry+backoff on 429/500. Fails run on 401/403. `--dry-run` GETs only, simulates writes. Not a standalone command.
---

**Module context**: Orchestration pipeline sub-module consumed by `halli-workflows:pilot-review-orchestrator` at §12 step 9e — `fileToEljun(app, blockers, runId)` in Appendix B pseudocode (lines 1743, 1752–1782). Runs AFTER dashboard render (step 9a), AFTER verify-claims and anchor-validator passes, and BEFORE backlog append (step 9f, T1221). This module is the terminal sink for P0 and P1 severity findings. P2 goes to backlog-appender (T1221); P3 goes to p3-notes-aggregator (T1220).

**Placement rationale**: The halli-workflows plugin is pure-markdown (see `halli-workflows:types/README.md`). This file is a prompt-style specification the orchestrator's inlined TypeScript implementation follows. It is NOT registered as a standalone command in `plugin.json`. A future TypeScript module living at `halli-workflows/lib/eljun/{client.ts, footer-parser.ts, types.ts}` can consume this file directly as its design contract.

**Depends on**:

- `halli-workflows:types/finding.md` — canonical Finding schema (the filtered `severity ∈ {P0, P1}` subset is this module's input).
- `halli-workflows:types/preflight-hash.md` — deterministic idempotency key algorithm. Snapshot vectors in that file are load-bearing for unit tests.
- `halli-workflows:commands/pilot-review/dedup.md` — upstream sibling; produces the sorted, deduplicated, verified, anchor-checked findings this module consumes.
- `halli-workflows:pilot-review-orchestrator` — caller; supplies `findings`, `runId`, `projectSlug`, flags.
- Consuming project's `.env.local` — must contain `ELJUN_API_KEY`.

**Design Doc anchors**: §10 Eljun Integration Protocol (primary — lines 877–966), §7 location_key + Phase 1 dedup semantics (line 907), §14 flag interactions (`--dry-run` line 1311, `--concurrency` line 1316), §17 risks (hash collision line 1471, rate-limits line 1470), §22 Appendix B pseudocode lines 1743–1782.

> **Rule 13 note (intellectual honesty — load-bearing)**: Every endpoint, field name, HTTP verb, response envelope, and error shape in this module was verified against the live eljun API at `https://eljun.vercel.app/api/v1` on 2026-04-14 before authoring. The probe facts are captured in §3 "Verified eljun API contract" below. Do NOT edit endpoint paths or payload field names in this file without re-running the probe — eljun accepts extra fields silently (no validation error), so a typo in `prority` (missing `i`) would silently drop the priority, not throw. The probe is the only way to catch that.

---

## 1. Purpose

P0 and P1 findings are action-required and must end up on the eljun board so the team (pilot owner + agency) can triage them. Without idempotent filing, every `/pilot-review` re-run would file N duplicate tasks — fatal to adoption. Design Doc §10 "The problem": *"Eljun has no `external_id` field on tasks and no search-by-hash endpoint."*

This module is the workaround: it embeds a deterministic `preflight_hash` in each task description's HTML-comment footer, lists all tasks on re-run, parses footers, and matches by hash to decide PATCH-vs-POST. This gives idempotent filing without upstream eljun changes.

The module also:

- Caps new POSTs at **25 per run** (overflow → single parent summary task linking to the dashboard).
- Retries on 429/500 with exponential backoff.
- Fails the run loudly on 401/403 (API key mandatory — silent skip is forbidden).
- Supports `--dry-run` mode: GET-only, zero writes, dashboard reports "Would have filed: N tasks".
- Detects 8-hex hash collisions between findings and upgrades the colliding pair to 16-hex per §17.

---

## 2. Contract

### Signature (prose — the orchestrator authors the TypeScript)

```
fileToEljun(
  findings:  Finding[],       // post-pipeline, already filtered to severity ∈ {P0, P1}
  context: {
    projectSlug:      string,      // e.g. "guestpad" — matches eljun URL slug and --app flag
    apiBaseUrl:       string,      // default "https://eljun.vercel.app/api/v1" — injectable for tests
    apiKey:           string,      // from ELJUN_API_KEY env var (validated by caller, non-empty)
    runId:            string,      // "YYYY-MM-DDTHH-mm-pilot-review" — same string in footer
    dashboardPath:    string,      // relative path to docs/preflight/run-YYYY-MM-DD-HHMM.md
    pluginVersion:    string,      // from plugin.json, e.g. "1.3.0"
    rubricHashes:     Record<string, string>,  // { "privacy-gdpr": "a0b3c4d5", ... } — from rubric-check
    dryRun:           boolean,     // true → GET only, no POST/PATCH
    fetch:            typeof fetch,// injectable for tests
    now:              () => Date,  // injectable for tests (backoff delay stamping)
  },
): Promise<{
  filed:         FiledResult[],   // POST calls that succeeded (dry-run: empty)
  patched:       PatchedResult[], // PATCH calls that succeeded (dry-run: empty)
  overflow:      OverflowResult | null,  // the summary parent if >25 new; null otherwise
  dryRunPreview: DryRunPreview | null,   // populated iff dryRun === true
  manualFileRequired: ManualFileEntry[], // findings that could not be filed after retries
  collisionUpgrades:  CollisionUpgrade[],// pairs upgraded from 8 to 16 hex
}>
```

Associated result types (for the orchestrator to thread into the dashboard and notes output):

```ts
interface FiledResult {
  locationKey: string;     // finding.location_key (for tracing back to the dashboard)
  preflightHash: string;   // 8 or 16 hex
  eljunTaskId: string;     // UUID returned by eljun
  displayId: string;       // e.g. "GUE-47" — what the dashboard shows
  priority: "critical" | "high";
}

interface PatchedResult extends FiledResult {
  reopened: boolean;       // true iff the PATCH also flipped status from "closed" → "todo"
}

interface OverflowResult {
  count: number;           // how many findings were rolled into the parent
  eljunTaskId: string;
  displayId: string;
}

interface DryRunPreview {
  wouldPost: Array<{ title: string; preflightHash: string; locationKey: string }>;
  wouldPatch: Array<{ title: string; preflightHash: string; locationKey: string; eljunTaskId: string; reopen: boolean }>;
  overflowCount: number;   // number of findings that would roll into the overflow parent
}

interface ManualFileEntry {
  finding: Finding;
  preflightHash: string;
  reason: "network_error" | "persistent_429" | "persistent_500" | "malformed_response";
  attemptCount: number;
  lastErrorMessage: string;
}

interface CollisionUpgrade {
  oldHash: string;         // 8 hex, shared
  locationKeys: string[];  // ≥ 2 distinct keys that collided
  newHashes: Record<string, string>;  // locationKey → 16-hex upgrade
}
```

### Input assumptions

- `findings` is already sorted by severity-then-witness-count, already deduped, already verified and anchor-checked. This module does NOT re-sort, re-dedupe, or re-validate the canonical shape.
- All findings have `severity ∈ {"P0", "P1"}`. The orchestrator filters this upstream (§12 step 9e: `blockers = anchorChecked.filter(f => f.severity === "P0" || f.severity === "P1")`). This module defensively asserts the filter and throws a clear error if a P2/P3 slips through.
- `preflight_hash` is NOT a field on `Finding` — see `halli-workflows:types/preflight-hash.md` §"What preflight_hash is NOT". This module computes it on the fly from `(projectSlug, location_key)`.
- `apiKey` is non-empty. The orchestrator reads `ELJUN_API_KEY` from the consuming project's `.env.local` and validates it is present before calling this module. If absent, the orchestrator fails with a clear message (NOT this module's concern to print that message — this module assumes a valid key).
- `projectSlug` matches a real eljun project slug. The orchestrator does not validate this upstream; this module will surface a `404 NOT_FOUND` naturally on the first GET if the slug is wrong.

### Output guarantees

- **Idempotent by design**: running this module twice with the same findings produces: first run → N POSTs, second run → N PATCHes (0 POSTs). Verified by integration test #4 in §9.
- **No silent failures**: every finding that cannot be filed appears in `manualFileRequired` with reason + attempt count. The caller writes these into `review-notes.md` under a `MANUAL FILE REQUIRED` block (Design Doc §10 error table).
- **Atomic-per-finding**: POSTs and PATCHes are NOT transactional across eljun. If the process crashes mid-loop, partial state is safe because the next run's hash-map lookup will see whatever was filed and PATCH-update them rather than duplicating.
- **Dry-run purity**: `dryRun === true` implies ZERO POST and ZERO PATCH calls. Only GETs happen. Asserted by integration test #9 in §9.

### Side effects

- Network I/O to eljun (`GET`, `POST`, `PATCH`). No DELETEs — this module never closes tasks. (Closing of superseded tasks is Phase 2 / T1309 territory.)
- Stderr logs on 429/500 backoff attempts and on detected collisions. No stdout logs (the orchestrator owns stdout for the dashboard path).
- No file I/O. The caller writes `MANUAL FILE REQUIRED` blocks to `review-notes.md`; this module just returns the entries.

### Exit conditions

- **Normal**: return the result object.
- **401/403 on any call**: throw `EljunAuthError` with message `"Eljun API key missing or invalid — verify ELJUN_API_KEY in .env.local"`. The orchestrator catches this, writes a P0 banner to the dashboard, and aborts before step 9f.
- **Orchestrator called with `findings.length === 0`**: no-op. Return an empty result (`filed: [], patched: [], overflow: null, dryRunPreview: null if !dryRun else {wouldPost: [], wouldPatch: [], overflowCount: 0}, manualFileRequired: [], collisionUpgrades: []`).

---

## 3. Verified eljun API contract (live probe 2026-04-14)

> These facts were confirmed with `curl` against `https://eljun.vercel.app/api/v1` before this module was authored. See Rule 13 note in the header. If a future probe disagrees with anything below, the probe wins and this section must be updated in the same commit.

### Authentication

```
Authorization: Bearer <ELJUN_API_KEY>
```

The API key is a 64-hex string read from the consuming project's `.env.local` as `ELJUN_API_KEY`. Consult `docs/infrastructure.md` in the consuming project for the canonical storage location (at time of authoring, infrastructure.md does not yet list eljun — the orchestrator should add it on first run; tracked as a Phase 2 cleanup, not a blocker here). The fallback key embedded in `.claude/commands/eljun.md` is a dev convenience; production installations override via env.

Missing or wrong key returns:

```
HTTP 401
{ "data": null, "error": { "code": "UNAUTHORIZED", "message": "Unauthorized" } }
```

### GET — list items for a project

```
GET /api/v1/projects/{slug}/items?include_closed=true
Authorization: Bearer <key>
```

Verified response shape (shortened for clarity):

```json
{
  "data": [
    {
      "id": "54855e95-c6db-4607-83c8-1c80fe240e31",
      "project_id": "63d1250a-1b3d-4f8a-8161-f3a25e85a94d",
      "column_id": "cd9cd021-0317-48a7-be54-5705ccba5b8d",
      "parent_id": null,
      "title": "Setup on real tablet and link kiosk",
      "description": "We have a script for kiosk setup...",
      "type": "task",
      "status": "backlog",
      "priority": "medium",
      "display_number": 1,
      "position": 1000,
      "assignee_id": null,
      "due_date": null,
      "created_by": "c759dac8-3fec-4411-bcab-51ef11c2c5d6",
      "created_at": "2026-03-23T19:10:34.351299+00:00",
      "updated_at": "2026-03-23T19:10:34.351299+00:00",
      "display_id": "GUE-1",
      "assignee": null
    }
  ],
  "error": null
}
```

Key fields this module reads:

| Field | Purpose |
|-------|---------|
| `id` | UUID used in subsequent PATCH/DELETE calls |
| `description` | Parsed for the HTML-comment footer to extract `preflight_hash` |
| `status` | Determines whether a match triggers a reopen (`closed` → `todo`) or a plain description update (`todo`/`in_progress`/`backlog` → same status) |
| `display_id` | Returned to the orchestrator for dashboard output (`GUE-47`) |
| `title` | Logged on collision warnings so humans can find the offending pair |

`?include_closed=true` is **mandatory**. Without it, closed tasks are omitted from the response and re-detection of a resolved-then-re-detected finding would file a duplicate instead of reopening.

### POST — create new item

```
POST /api/v1/projects/{slug}/items
Authorization: Bearer <key>
Content-Type: application/json

{
  "title":       "[P0][isolation-reviewer] RLS missing on `bar` table — reachable via /api/bar",
  "description": "<suggested_fix body>\n\n---\n<!-- pilot-review -->\npreflight_hash: 7f3a9e21\n...\n",
  "type":        "bug",
  "status":      "todo",
  "priority":    "critical"
}
```

Verified by probe: extra fields (e.g. a `preflight_hash` top-level key, an `external_id`, a `finding_id`) are **silently dropped**. This is why the footer-in-description workaround is necessary. Rule 13 reminder: **never** rely on eljun validating extra fields — a typo like `"prority": "critical"` would silently produce a task with `priority: "none"`. The module MUST use the verified field names below only.

Permitted request-body fields per the `/eljun` command reference (`~/.claude/commands/eljun.md`) and confirmed by probe:

| Field | Required | Values used by this module |
|-------|----------|---------------------------|
| `title` | yes | `[P{0|1}][<agent-name>] <short summary>` — see §4 below |
| `description` | yes | body + footer — see §4 and §5 |
| `type` | yes | `"bug"` — all pilot-review findings are bugs |
| `status` | yes | `"todo"` — filed work is always actionable |
| `priority` | yes | P0 → `"critical"`, P1 → `"high"` |
| `parent_id` | for overflow | UUID of the overflow parent (only on the overflow task itself, as `null` on leaf tasks) |

Fields this module does NOT send: `assignee_id`, `due_date`. Assignee routing is deferred (Phase 1 scope: all tasks unassigned; the pilot owner triages). Due-date is not applicable.

Response: same shape as GET with the new item's UUID and `display_id`. Use `data.id` as the eljun task ID for subsequent PATCH.

### PATCH — update item

```
PATCH /api/v1/projects/{slug}/items/{id}
Authorization: Bearer <key>
Content-Type: application/json

{
  "description": "<updated body + footer>",
  "status":      "todo"           // only sent when re-opening a closed task
}
```

PATCH accepts any subset of the POST fields. This module sends only `description` (always) and `status` (only when the matched task was `closed`). Title is NOT updated on PATCH — if the summary changed, the `finding_id` line in the footer tracks that without surprising a triager who sees their board title suddenly reworded.

### DELETE — soft-close

```
DELETE /api/v1/projects/{slug}/items/{id}
→ HTTP 200
→ { "data": { "closed": true }, "error": null }
```

This module does NOT use DELETE. Closed tasks remain visible to `?include_closed=true` and are reopened via PATCH when re-detected. Phase 2 (T1309) adds DELETE-on-supersede.

### Error envelope

Every error response uses:

```json
{ "data": null, "error": { "code": "<UPPER_SNAKE>", "message": "<human text>" } }
```

The module parses `error.code` for branching (e.g. `RATE_LIMITED` → backoff). If `error.code` is missing or unknown, the HTTP status code is the fallback signal.

---

## 4. Rendering: title, body, footer

### Title format

```
[P0][isolation-reviewer] RLS missing on `bar` table — reachable via /api/bar
[P1][auth-boundary-reviewer] POST /api/messages does not call auth.getUser()
```

Grammar: `"[<severity>][<agent>] <short summary>"`.

- `<severity>` is `"P0"` or `"P1"` — written as-is.
- `<agent>` is the primary agent name from `finding.agent` (post-dedup first-seen witness).
- `<short summary>` is derived from `finding.evidence`:
  - Take the portion AFTER the first `" — "` separator (the canonical evidence format is `"<file>:<line> — <what was seen>"`).
  - If no `" — "` is present, fall back to `finding.evidence` whole.
  - Truncate at 80 characters (excluding the `[Px][agent] ` prefix) to stay within eljun's board-card width. If truncated, append `"…"`.
  - Strip surrounding whitespace. Collapse internal whitespace to single spaces.
- Total title length MUST NOT exceed 120 characters. The 80-char short-summary budget plus `[P0][some-long-agent-name] ` prefix typically lands around 110.

Rule 13: do NOT paraphrase or rewrite evidence into a "nicer" title. The evidence string is what the reviewer produced; the title should be a faithful excerpt.

### Body

The body is the finding's `suggested_fix` verbatim (post-dedup, which may be a numbered merge — see `halli-workflows:commands/pilot-review/dedup.md` §"Suggested-fix merging"). No prefix, no trailing newline beyond what `suggested_fix` already contains.

### Footer

Exact byte format (Design Doc §10, `halli-workflows:types/preflight-hash.md` §"Usage in the eljun description footer"). Showing the tail of the description string with a placeholder body line followed by exactly one blank line before the `---` separator:

```
<body ends here — e.g. the last line of suggested_fix>

---
<!-- pilot-review -->
preflight_hash: 7f3a9e21
finding_id: isolation-reviewer:db:bar:rls_missing:v1
rubric_hash: a0b3c4d5 (privacy-gdpr.md@sha)
run_id: 2026-04-14T15-39-pilot-review
```

Notes on byte-exact rendering:

- Exactly one blank line between the body and the `---` separator (produced by the `""` entry in the pseudocode array joined by `\n`, which inserts a single blank line). Design Doc §10 footer example matches this spacing.
- `---` is literal three hyphens, alone on the line.
- `<!-- pilot-review -->` is literal — the grep target for future runs. Agents and humans must NOT edit this line on existing tasks; if they do, re-detection falls back to parsing `preflight_hash:` alone (see §5 parser).
- `preflight_hash:` line: literal `"preflight_hash: "` + 8-hex or 16-hex string (16-hex ONLY on collision upgrade; default is 8).
- `finding_id:` line: literal `"finding_id: "` + `<agent>:<location_key>:v1`. `:v1` is the finding-schema version (reserved for future version bumps; NEVER omit).
- `rubric_hash:` line: literal `"rubric_hash: "` + 8-hex + ` (` + `<rubric-file-basename>@sha` + `)`. The parenthesized annotation makes the provenance human-greppable (`git log` + rubric file basename → which rubric generated this finding).
  - If the finding's agent has no required rubric (e.g. `drift-gate`, `isolation-reviewer`), omit the `rubric_hash:` line entirely. Do NOT emit `rubric_hash: none` or `rubric_hash: ""` — missing line means no rubric.
- `run_id:` line: literal `"run_id: "` + the orchestrator's run timestamp string (ISO-8601-ish without colons: `2026-04-14T15-39-pilot-review`).
- NO trailing blank line after `run_id:`. Eljun preserves trailing whitespace in `description` on PATCH, so adding one would cause `description` bytes to drift on every re-render.

### `renderTask(finding, hash, runId, ctx)` — pseudocode

```ts
function renderTask(finding: Finding, hash: string, runId: string, ctx: Context): EljunPostBody {
  return {
    title: renderTitle(finding),
    description: renderDescription(finding, hash, runId, ctx),
    type: "bug",
    status: "todo",
    priority: finding.severity === "P0" ? "critical" : "high",
  };
}

function renderTitle(finding: Finding): string {
  const severity = finding.severity; // "P0" | "P1"
  const agent = finding.agent;
  const afterDash = finding.evidence.split(" — ")[1] ?? finding.evidence;
  const normalized = afterDash.trim().replace(/\s+/g, " ");
  const maxShort = 80;
  const short = normalized.length > maxShort ? normalized.slice(0, maxShort - 1) + "…" : normalized;
  return `[${severity}][${agent}] ${short}`;
}

function renderDescription(finding: Finding, hash: string, runId: string, ctx: Context): string {
  const body = finding.suggested_fix;
  const rubricLine = rubricFooterLine(finding, ctx.rubricHashes); // "" if no rubric for this agent
  return [
    body,
    "",
    "---",
    "<!-- pilot-review -->",
    `preflight_hash: ${hash}`,
    `finding_id: ${finding.agent}:${finding.location_key}:v1`,
    ...(rubricLine ? [rubricLine] : []),
    `run_id: ${runId}`,
  ].join("\n");
}

function rubricFooterLine(finding: Finding, hashes: Record<string, string>): string {
  // Map finding.agent → rubric basename. See rubric-check.md §Rubric registry for authoritative mapping.
  const agentToRubric: Record<string, string> = {
    "privacy-gdpr-reviewer": "privacy-gdpr",
    "payment-reviewer": "payment",
    "monitoring-reviewer": "monitoring",
    "guest-ux-reviewer": "guest-tablet",
    "owner-ux-reviewer": "owner-dashboard",
  };
  const rubricKey = agentToRubric[finding.agent];
  if (!rubricKey) return "";
  const hash = hashes[rubricKey];
  if (!hash) return ""; // Defensive: if rubric-check didn't hash it, omit rather than fabricate.
  return `rubric_hash: ${hash} (${rubricKey}.md@sha)`;
}
```

### Overflow parent rendering

When `findings.length > 25`, the first 25 are filed per the normal POST/PATCH flow and the remaining are rolled into a single parent task.

```ts
function renderOverflowParent(overflow: Finding[], runId: string, dashboardPath: string): EljunPostBody {
  const count = overflow.length;
  const title = `[pilot-review] ${count} additional blockers — see ${dashboardPath}`;
  const bulletList = overflow.map(f => `- [${f.severity}] ${f.agent}: ${f.location_key}`).join("\n");
  const description = [
    `${count} pilot-review blockers exceeded the per-run cap of 25 and are summarized here.`,
    `See the dashboard for full detail: ${dashboardPath}`,
    "",
    "Overflow findings:",
    bulletList,
    "",
    "---",
    "<!-- pilot-review-overflow -->",
    `run_id: ${runId}`,
    `overflow_count: ${count}`,
  ].join("\n");
  // Overflow parent is always P0-priority on eljun (whatever severity the overflow
  // findings had, they still need eyes — the parent's criticality reflects the
  // criticality of triaging the overflow, not any single finding's severity).
  return { title, description, type: "bug", status: "todo", priority: "critical" };
}
```

Overflow parent is itself idempotent across runs: its HTML comment is `<!-- pilot-review-overflow -->` (distinct from `<!-- pilot-review -->` leaf-task marker). The parser in §5 ignores overflow parents when building the `preflight_hash` map (they do not have a `preflight_hash:` line — they have `overflow_count:` instead). Re-running with an overflow condition updates the parent's description in-place (match by title prefix `[pilot-review]` + same run-date portion — see §6 step 5).

Overflow parent's own idempotency match rule (Phase 1, pragmatic): if the most recent run of the day produced an overflow parent (recognize by `<!-- pilot-review-overflow -->` marker and same `YYYY-MM-DD` in title), PATCH that one rather than creating a new one. Across different run-days, a new overflow parent is fine — an old overflow parent being still open signals the backlog hasn't been triaged and that signal is valuable.

---

## 5. Footer parser — `parseFooter(description: string) → Footer | null`

### Shape

```ts
interface Footer {
  preflightHash: string;          // 8 or 16 hex
  findingId: string;              // "<agent>:<location_key>:v<N>"
  rubricHash: string | null;      // 8 hex, null if line absent
  rubricBasename: string | null;  // e.g. "privacy-gdpr", null if line absent
  runId: string;                  // ISO-ish timestamp string
}
```

### Algorithm

Parse the description string end-to-start (footers are at the bottom):

```ts
function parseFooter(description: string | null): Footer | null {
  if (!description) return null;
  const lines = description.split("\n");
  // Find the most recent `<!-- pilot-review -->` marker line (last occurrence — defensive if
  // a human accidentally doubled the footer via manual edit, the tail wins).
  let markerIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "<!-- pilot-review -->") { markerIdx = i; break; }
  }
  if (markerIdx === -1) return null;

  // The footer block is markerIdx..end-of-description. Scan forward, matching lines.
  let preflightHash: string | null = null;
  let findingId: string | null = null;
  let rubricHash: string | null = null;
  let rubricBasename: string | null = null;
  let runId: string | null = null;

  for (let i = markerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;

    if ((m = line.match(/^preflight_hash:\s+([0-9a-f]{8,16})\s*$/))) {
      preflightHash = m[1];
    } else if ((m = line.match(/^finding_id:\s+(.+)$/))) {
      findingId = m[1].trim();
    } else if ((m = line.match(/^rubric_hash:\s+([0-9a-f]{8})(?:\s+\(([^)]+)\.md@sha\))?\s*$/))) {
      rubricHash = m[1];
      rubricBasename = m[2] ?? null;
    } else if ((m = line.match(/^run_id:\s+(.+)$/))) {
      runId = m[1].trim();
    }
    // Unknown lines inside the footer block are ignored (forward-compatible with future fields).
  }

  if (!preflightHash || !findingId || !runId) return null; // malformed footer
  return { preflightHash, findingId, rubricHash, rubricBasename, runId };
}
```

### Parser defensive behaviors

- **Missing `<!-- pilot-review -->` marker**: returns `null`. The module treats tasks without the marker as "not ours" and will NOT file a PATCH against them — it will POST a new task. This handles the case where a human files an eljun task manually that happens to share a hash — we never mutate human-authored tasks.
- **Truncated footer (missing `preflight_hash:` or `run_id:`)**: returns `null`. Logged as `eljun-client: malformed footer on task <display_id> — ignoring for dedup` (stderr warning, not a fatal error).
- **Footer with extra unknown fields** (e.g. a future `supersedes_hash: ...` line from Phase 2): ignored by Phase 1 parser, does NOT break detection. Forward-compat guarantee.
- **Multiple `<!-- pilot-review -->` markers in one description** (shouldn't happen, but if a human accidentally pasted an old footer): parse the LAST one. Rationale: the last footer reflects the most recent run that authored the task.
- **Markdown escape artifacts** (e.g. `&lt;!-- pilot-review --&gt;` if eljun's UI escaped a paste): NOT handled by the parser. eljun's probe confirms descriptions round-trip byte-identical through POST/GET, so this case does not occur in practice. If a future eljun UI change starts HTML-escaping, add a de-escape step before `.split("\n")`.
- **Case sensitivity**: field names are lowercase (`preflight_hash:`). Hex values are lowercase. The parser is case-sensitive — this prevents silent matches against a hypothetical future `Preflight_Hash:` formatting drift.

---

## 6. Dedup flow (pseudocode — the heart of this module)

```ts
async function fileToEljun(findings: Finding[], context: Context): Promise<Result> {
  // -- Step 0: defensive assertions (Rule 13: fail loud on broken invariants)
  for (const f of findings) {
    if (f.severity !== "P0" && f.severity !== "P1") {
      throw new Error(`eljun-client: expected P0/P1 only, got ${f.severity} on ${f.location_key}`);
    }
  }
  if (findings.length === 0) {
    return emptyResult(context.dryRun);
  }

  // -- Step 1: compute hashes + detect same-run collisions
  const findingWithHash = findings.map(f => ({
    f,
    hash: preflightHash(context.projectSlug, f.location_key),  // from types/preflight-hash
  }));
  const collisions = detectCollisions(findingWithHash);
  if (collisions.length > 0) {
    // Upgrade colliding pairs to 16-hex in place.
    for (const collision of collisions) {
      for (const { f } of collision.members) {
        const upgraded = preflightHash16(context.projectSlug, f.location_key);
        const entry = findingWithHash.find(e => e.f === f)!;
        entry.hash = upgraded;
      }
      console.warn(
        `eljun-client: hash collision on ${collision.sharedHash} — ` +
        `upgraded to 16-hex for [${collision.members.map(m => m.f.location_key).join(", ")}]`
      );
    }
  }

  // -- Step 2: GET all existing tasks (open + closed)
  const existing = await eljunGetAll(context);  // handles pagination if eljun ever adds it

  // -- Step 3: parse footers, build hash → existing_task index
  const existingByHash = new Map<string, EljunTask>();
  for (const task of existing) {
    const footer = parseFooter(task.description);
    if (footer === null) continue; // not one of ours, or malformed — skip
    // If two existing tasks have the same preflight_hash (human duplicated via copy-paste,
    // or old orchestrator bug), prefer the open one. If both open, prefer the most recently
    // updated. Defensive — should not occur under normal operation.
    const prior = existingByHash.get(footer.preflightHash);
    if (!prior) {
      existingByHash.set(footer.preflightHash, task);
    } else if (prior.status === "closed" && task.status !== "closed") {
      existingByHash.set(footer.preflightHash, task);
    } else if (
      prior.status !== "closed" && task.status !== "closed" &&
      new Date(task.updated_at) > new Date(prior.updated_at)
    ) {
      existingByHash.set(footer.preflightHash, task);
    }
  }

  // -- Step 4: decide POST vs PATCH for each finding
  const toPost: Array<{ f: Finding; hash: string }> = [];
  const toPatch: Array<{ f: Finding; hash: string; existing: EljunTask }> = [];
  for (const { f, hash } of findingWithHash) {
    const existing = existingByHash.get(hash);
    if (existing) {
      toPatch.push({ f, hash, existing });
    } else {
      toPost.push({ f, hash });
    }
  }

  // -- Step 5: enforce 25-new-post cap; overflow into parent
  const cap = 25;
  let overflow: Array<{ f: Finding; hash: string }> = [];
  if (toPost.length > cap) {
    overflow = toPost.slice(cap);
    toPost.length = cap;
  }

  // -- Step 6: execute (or simulate) PATCHes and POSTs
  const filed: FiledResult[] = [];
  const patched: PatchedResult[] = [];
  const manualFileRequired: ManualFileEntry[] = [];

  // PATCHes are safer than POSTs to sequence first — if a network issue forces abort
  // mid-run, we prefer updating existing (already-visible) tasks over creating new
  // ones that would need PATCHes on the next re-run.
  for (const { f, hash, existing } of toPatch) {
    try {
      const body = {
        description: renderDescription(f, hash, context.runId, context),
        ...(existing.status === "closed" ? { status: "todo" as const } : {}),
      };
      if (context.dryRun) {
        // Dry-run: record the intent, do not call.
      } else {
        const resp = await eljunPatchWithRetry(existing.id, body, context);
        patched.push({
          locationKey: f.location_key,
          preflightHash: hash,
          eljunTaskId: resp.id,
          displayId: resp.display_id,
          priority: f.severity === "P0" ? "critical" : "high",
          reopened: existing.status === "closed",
        });
      }
    } catch (e) {
      if (e instanceof EljunAuthError) throw e; // Fail-loud: propagate 401/403
      manualFileRequired.push({
        finding: f,
        preflightHash: hash,
        reason: classifyError(e),
        attemptCount: e.attemptCount ?? 1,
        lastErrorMessage: e.message,
      });
    }
  }

  for (const { f, hash } of toPost) {
    try {
      const body = renderTask(f, hash, context.runId, context);
      if (context.dryRun) {
        // Dry-run: record the intent.
      } else {
        const resp = await eljunPostWithRetry(context.projectSlug, body, context);
        filed.push({
          locationKey: f.location_key,
          preflightHash: hash,
          eljunTaskId: resp.id,
          displayId: resp.display_id,
          priority: body.priority,
        });
      }
    } catch (e) {
      if (e instanceof EljunAuthError) throw e;
      manualFileRequired.push({
        finding: f,
        preflightHash: hash,
        reason: classifyError(e),
        attemptCount: e.attemptCount ?? 1,
        lastErrorMessage: e.message,
      });
    }
  }

  // -- Step 7: handle overflow parent
  let overflowResult: OverflowResult | null = null;
  if (overflow.length > 0) {
    // Look for an existing same-day overflow parent and PATCH it if found (§4 overflow
    // idempotency rule). Otherwise POST a new one.
    const todayISO = context.runId.slice(0, 10); // "2026-04-14"
    const existingOverflow = existing.find(
      t => t.title.startsWith("[pilot-review]") &&
           t.title.includes(todayISO) &&
           /overflow_count:/.test(t.description ?? "")
    );
    if (!context.dryRun) {
      if (existingOverflow) {
        const resp = await eljunPatchWithRetry(
          existingOverflow.id,
          {
            description: renderOverflowParent(overflow.map(x => x.f), context.runId, context.dashboardPath).description,
            ...(existingOverflow.status === "closed" ? { status: "todo" as const } : {}),
          },
          context,
        );
        overflowResult = { count: overflow.length, eljunTaskId: resp.id, displayId: resp.display_id };
      } else {
        const resp = await eljunPostWithRetry(
          context.projectSlug,
          renderOverflowParent(overflow.map(x => x.f), context.runId, context.dashboardPath),
          context,
        );
        overflowResult = { count: overflow.length, eljunTaskId: resp.id, displayId: resp.display_id };
      }
    }
  }

  // -- Step 8: assemble dryRunPreview if applicable
  const dryRunPreview: DryRunPreview | null = context.dryRun
    ? {
        wouldPost: toPost.map(({ f, hash }) => ({
          title: renderTitle(f), preflightHash: hash, locationKey: f.location_key,
        })),
        wouldPatch: toPatch.map(({ f, hash, existing }) => ({
          title: renderTitle(f),
          preflightHash: hash,
          locationKey: f.location_key,
          eljunTaskId: existing.id,
          reopen: existing.status === "closed",
        })),
        overflowCount: overflow.length,
      }
    : null;

  return { filed, patched, overflow: overflowResult, dryRunPreview, manualFileRequired, collisionUpgrades: collisions };
}
```

Sequencing rationale: PATCH before POST. If a crash occurs, existing tasks get updated first (safer — they already exist, their state is reconciling toward truth). New tasks posted second would re-run as PATCHes on the next invocation, which is idempotent by design.

---

## 7. Retry + backoff policy

| HTTP status | `error.code` | Action |
|-------------|--------------|--------|
| 200/201 | n/a | Return response. |
| 400 | `VALIDATION_ERROR` or similar | Log + surface as `malformed_response` in `manualFileRequired`. Do NOT retry — retrying will fail identically. |
| 401 | `UNAUTHORIZED` | Throw `EljunAuthError`. Fail the entire run loudly. No retry. |
| 403 | `FORBIDDEN` | Same as 401. |
| 404 | `NOT_FOUND` | On GET: project slug is wrong. Throw `EljunProjectNotFoundError` — run fails. On PATCH: task was hard-deleted between GET and PATCH. Log warning, skip this PATCH, surface to `manualFileRequired` with reason `malformed_response` (rare race condition). |
| 429 | `RATE_LIMITED` | Exponential backoff: 5s, 10s, 20s. Retry up to 3 times. If all 3 fail, push into `manualFileRequired` with reason `persistent_429`. |
| 500/502/503/504 | `INTERNAL_ERROR` | Exponential backoff: 30s, 60s, 120s. Retry up to 3 times. If all 3 fail, push into `manualFileRequired` with reason `persistent_500`. |
| Network error (timeout, DNS, connection refused) | — | Backoff 5s, 10s, 20s. Retry up to 3 times. If all 3 fail, push into `manualFileRequired` with reason `network_error`. |
| Malformed JSON response | — | Treat as `malformed_response`. No retry (retrying will likely yield identical malformed bytes). |

Backoff delays are computed from the moment of receiving the failed response. Implementation hint: use `setTimeout(resolve, delayMs)` in a wrapped async helper; the `context.now` injection lets tests use a fake clock to avoid 2-minute unit-test sleeps.

```ts
async function withRetry<T>(
  fn: () => Promise<T>,
  policy: { statusCode: number; delays: number[] },
  ctx: Context,
): Promise<T> {
  let attempt = 0;
  let lastErr: Error;
  for (const delay of [0, ...policy.delays]) {
    if (delay > 0) await sleep(delay, ctx);
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      attempt++;
      if (!shouldRetry(e, policy.statusCode)) throw e;
    }
  }
  (lastErr as any).attemptCount = attempt;
  throw lastErr;
}
```

**Manual-file-required handoff**: the caller (orchestrator) writes the `manualFileRequired` list into `review-notes.md` under a `## MANUAL FILE REQUIRED` section. Each entry includes the full `Finding` JSON so a human can paste it into eljun by hand. Design Doc §10 error table: *"On persistent failure, log to review-notes.md with a MANUAL FILE REQUIRED block. Do not block the dashboard output."*

**No infinite loop safeguards needed** beyond the fixed 3-retry ceiling — eljun does not stream, does not long-poll, and the cap-of-25 ensures bounded loop iterations.

---

## 8. `--dry-run` contract

When `context.dryRun === true`:

- GET calls are still made (necessary to build the hash-map and produce a realistic preview).
- POST and PATCH calls are NEVER made. Zero writes. Asserted by integration test #9.
- The returned `dryRunPreview` field is non-null with the full list of `wouldPost` and `wouldPatch` intents.
- The orchestrator inserts a dashboard section:

```markdown
## Eljun filing (dry-run)

Would have filed:
- 3 new tasks (see "Would POST" below)
- 1 existing task reopened
- 2 existing tasks updated (description refresh + run_id bump)
- 0 overflow

### Would POST

- [P0][isolation-reviewer] RLS missing on `bar` — `hash: 7f3a9e21`
- [P1][auth-boundary-reviewer] POST /api/messages missing auth.getUser() — `hash: 4c9f22ab`
- ...

### Would PATCH

- GUE-23: reopen (was closed) + refresh — `hash: 001f2a5b`
- GUE-41: refresh description only — `hash: 98e7c4d9`
- GUE-55: refresh description only — `hash: abc12345`
```

Dry-run returns `filed: []` and `patched: []` (empty) in the result object; the caller only reads `dryRunPreview` in dry-run mode.

---

## 9. Testing contract

Every test below MUST be implemented in the TypeScript port. Mock level: the `fetch` injection point in `context.fetch` is the sole boundary. No deeper mocking of HTTP — the tests feed the injected fetch with canned responses that match the verified shapes in §3. This keeps tests honest (Rule 13: no mocking the thing you're testing).

| # | Case | Expected |
|---|------|----------|
| 1 | `parseFooter` on a valid §4-format description | Returns `{preflightHash, findingId, rubricHash, rubricBasename, runId}` populated from the lines |
| 2 | `parseFooter` on a description with no `<!-- pilot-review -->` marker | Returns `null` |
| 3 | `parseFooter` on a description with marker but no `preflight_hash:` | Returns `null` |
| 4 | `parseFooter` on a description with `preflight_hash: 1234567890abcdef` (16 hex) | Returns `{preflightHash: "1234567890abcdef", ...}` |
| 5 | `parseFooter` on a description with extra future field `supersedes_hash: xyz` | Ignores it, returns the standard 5 fields (forward compat) |
| 6 | `parseFooter` on a description with `<!-- pilot-review -->` appearing twice | Uses the LAST occurrence |
| 7 | `parseFooter` on `null` or `""` | Returns `null` |
| 8 | `renderDescription` output matches §4 format byte-for-byte | Assert exact string equality against the example |
| 9 | `renderTitle` truncates at 80 chars of short summary and appends `…` | Assert exact output on a long-evidence finding |
| 10 | `renderTitle` uses the portion after `" — "` when present, else the full evidence | Two assertions, two findings |
| 11 | `rubricFooterLine` returns `""` for an agent with no rubric (e.g. `isolation-reviewer`) | `renderDescription` emits no `rubric_hash:` line for those agents |
| 12 | Happy path: 3 P0 findings, zero existing tasks | 3 POSTs, 0 PATCHes, `filed.length === 3` |
| 13 | Idempotent re-run: 3 P0 findings, eljun already has 3 tasks with matching footers | 0 POSTs, 3 PATCHes (description refresh, same status), `patched.every(p => !p.reopened)` |
| 14 | Reopen: finding matches a closed task by hash | 1 PATCH with `status: "todo"`, `patched[0].reopened === true` |
| 15 | Mixed: 5 findings, 2 have existing matching tasks (1 open, 1 closed), 3 are new | 3 POSTs, 2 PATCHes (1 reopen, 1 refresh) |
| 16 | Overflow: 30 findings input, 0 existing | 25 POSTs + 1 overflow-parent POST; `overflow.count === 5`; remaining 5 findings listed in parent description |
| 17 | Overflow re-run: same 30 findings on next run, same-day overflow parent exists | 25 PATCHes + 1 overflow-parent PATCH (no new POST); `overflow.count === 5` |
| 18 | Collision: 2 findings in same run hash to same 8-hex | Both upgraded to 16-hex before filing; `collisionUpgrades.length === 1`, `members.length === 2`; distinct 16-hex per location_key |
| 19 | Dry-run: 3 findings, 0 existing | 0 POSTs, 0 PATCHes; `dryRunPreview.wouldPost.length === 3`, `filed.length === 0` |
| 20 | Dry-run: 3 findings, 2 existing matches | 0 writes; `dryRunPreview.wouldPatch.length === 2` |
| 21 | 401 on GET | Throws `EljunAuthError` with message mentioning `ELJUN_API_KEY`. Caller aborts run |
| 22 | 403 on POST | Same: `EljunAuthError`, run aborts |
| 23 | 429 on POST, 3 retries succeed on 3rd | `filed` includes the finding; no `manualFileRequired` entry |
| 24 | 429 on POST, all retries fail | 0 `filed`; `manualFileRequired` has 1 entry with `reason: "persistent_429"`, `attemptCount: 4` (1 initial + 3 retries) |
| 25 | 500 on POST, exponential backoff 30s/60s/120s verified via injected clock | Fake-time advances by 30+60+120 seconds before the 3rd retry |
| 26 | Network timeout on PATCH | `manualFileRequired` entry with `reason: "network_error"` |
| 27 | 404 on GET (wrong project slug) | Throws `EljunProjectNotFoundError`; run aborts |
| 28 | 404 on PATCH (task was hard-deleted between GET and PATCH) | Logged warning; `manualFileRequired` entry; other PATCHes continue |
| 29 | Finding with P2 severity reaches this module (should not happen — defensive) | Throws loud error naming the location_key; orchestrator bug signal |
| 30 | Empty findings input | Returns empty result; NO GET call made (no point) |
| 31 | Assert `context.fetch` is called with `Authorization: Bearer <apiKey>` header on every request | Spy the injected fetch |
| 32 | Assert `?include_closed=true` is present on the GET URL | Inspect the URL string |
| 33 | Assert POST body is exactly the §3 verified field set (no extras) | JSON-compare against the fixture |
| 34 | Assert PATCH body contains only `description` (when not reopening) or `description + status` (when reopening) — no other fields | JSON-compare |
| 35 | Deterministic hashing: two runs with same `(projectSlug, location_key)` produce identical `preflight_hash` values | Snapshot-test against `halli-workflows:types/preflight-hash.md` §"Snapshot test vectors" |
| 36 | Run against a live eljun staging instance: first run posts N tasks, second run posts 0 tasks | Integration test — requires `ELJUN_API_KEY` env. Skip-by-default; enable via `E2E=1` |
| 37 | Run against live eljun: close one filed task manually between runs, second run reopens it | Integration, `E2E=1` |
| 38 | Manual-file-required list is well-formed when appended to `review-notes.md` | Orchestrator integration test (not this module's unit test scope) |

**Mocking strategy reminder** (Rule 13 + testing-principles skill): the tests MUST feed real HTTP shapes to the injected fetch. Do NOT replace `eljunGetAll` or `eljunPostWithRetry` with mocks — that would test the mocks, not the module. The boundary is `context.fetch`.

---

## 10. Rule 13 / Intellectual Honesty guardrails

This module is the single point where the pilot-review system writes to an external system. The Rule 13 failure modes we must actively avoid:

- **No invented endpoints.** Every URL in this file (`/api/v1/projects/{slug}/items`, `?include_closed=true`, `/items/{id}`) was verified by curl on 2026-04-14. Do NOT invent search-by-hash, bulk-close, or any other endpoint — eljun does not have them.
- **No invented fields.** eljun silently drops extras. A typo in a field name would cause silent data loss. Field names are verified in §3.
- **No silent error swallowing.** Every failure mode has a defined destination: either a thrown error that fails the run, or a `manualFileRequired` entry that surfaces to the user. There is NO catch-and-continue branch that drops a finding without a record.
- **No weakened tests.** Tests #8, #33, #34 assert exact byte-level output and exact request shapes. Do not relax these to accommodate a hypothetical "simpler" payload — the exactness is the defense against silent drift.
- **No test that tests a mock.** All tests go through `context.fetch`. If a future refactor introduces a higher-level mock, it MUST be flagged as a test-coverage regression.
- **No dry-run write leaks.** Test #19 and #20 assert zero writes in dry-run. A regression that introduces a single POST would be a silent billing + board-pollution incident.
- **No unverified science or copy-paste from memory.** The retry backoff schedule (5/10/20 for 429, 30/60/120 for 500) is from Design Doc §10 error table — cited verbatim. If this schedule is revised, update the Design Doc in the SAME commit and link the two.
- **No "failed to implement" return values.** The module either succeeds (partial success is still success with `manualFileRequired` surfaced) or throws. No `return null` from a failed POST — the caller relies on the contract.
- **Collision upgrade is NOT silent.** Every upgrade emits a stderr warning AND appears in `collisionUpgrades` so the orchestrator writes it into `run-*.md` notes (§17 risks table action: "log warning and upgrade colliding pair to 16 chars").

---

## 11. Consumption point

Invoked by `halli-workflows:pilot-review-orchestrator` at step 9e of the orchestration flow (Design Doc §12, Appendix B line 1743). Replace the scaffold-stage no-op:

```ts
// scaffold (T1201): blockers filed to eljun — deferred
```

with:

```ts
import { fileToEljun } from "halli-workflows/lib/eljun/client";
import { preflightHash } from "halli-workflows/lib/types/preflight-hash";

// ... after dashboard write, before backlog append:
const blockers = anchorChecked.filter(f => f.severity === "P0" || f.severity === "P1");
const eljunResult = await fileToEljun(blockers, {
  projectSlug: flags.app,
  apiBaseUrl: env.ELJUN_API_URL ?? "https://eljun.vercel.app/api/v1",
  apiKey: env.ELJUN_API_KEY,  // validated non-empty at orchestrator entry
  runId,
  dashboardPath,
  pluginVersion,
  rubricHashes,
  dryRun: flags.dryRun,
  fetch: globalThis.fetch,
  now: () => new Date(),
});

// Write overflow + collision notes + manual-file block into review-notes.md.
appendEljunNotes(reviewNotesPath, eljunResult);

// Append eljun display_ids into the dashboard's P0/P1 sections.
updateDashboardWithEljunIds(dashboardPath, eljunResult);
```

The orchestrator is responsible for:

- Reading `ELJUN_API_KEY` from the consuming project's `.env.local` and failing loud if absent.
- Catching `EljunAuthError` and `EljunProjectNotFoundError`, writing a P0 banner to the dashboard, and aborting step 9f (backlog append) — because an auth failure suggests misconfiguration that should block further writes.
- Writing the `manualFileRequired` list into `review-notes.md`.
- Writing the `collisionUpgrades` list into `run-*.md` notes.
- Threading the returned `filed[].displayId` and `patched[].displayId` into the dashboard so human readers see `GUE-47` next to each blocker.

---

## 12. Phase Boundary Reminder (for future implementers)

- **Phase 1 (this module)**: match by `preflight_hash` only. PATCH updates description + reopens if closed. No DELETE, no supersede chain.
- **Phase 2 (T1309, deferred — DO NOT IMPLEMENT HERE)**: rubric-hash-aware superseding. When `rubric_hash` in the footer differs from the current run's rubric hash for the same `preflight_hash`, Phase 2 closes the old task via DELETE with a supersede note, then POSTs a new task. The `rubric_hash:` footer line is written today (Phase 1) for audit, but is NOT read by the Phase 1 match key. Phase 2 will add:
  - `supersedes_hash: <old-preflight>` line on the new task's footer.
  - `DELETE` with a supersede-note body on the old task.
  - One more pass through `existingByHash` looking for rubric-hash drift.
- **Phase 3 (eljun `external_id` column, upstream enhancement)**: retires the entire footer-hack. When eljun adds `external_id`, this module changes to set `external_id = preflightHash(...)` in the POST body and uses `GET /items?external_id=<hash>` for lookup. The footer stays (audit trail) but is no longer the match mechanism. That migration is out of scope for Phase 1 and Phase 2.

---

## References

- Design Doc §10 Eljun Integration Protocol — `docs/design/pilot-review-system-design.md` lines 877–966
- Design Doc §7 location_key + Phase 1 dedup semantics — line 907
- Design Doc §14 flag interactions (`--dry-run`) — line 1311
- Design Doc §17 risks (hash collision, rate limits) — lines 1470–1471
- Design Doc §22 Appendix B pseudocode — lines 1743–1782
- ADR-0014 pilot-review orchestration — `docs/adr/ADR-0014-pilot-review-orchestration.md`
- Canonical schema: `halli-workflows:types/finding.md`
- Idempotency key: `halli-workflows:types/preflight-hash.md` (snapshot vectors are load-bearing)
- Upstream sibling: `halli-workflows:commands/pilot-review/dedup.md` (T1216) — produces this module's input
- Downstream sibling: `halli-workflows:commands/pilot-review/backlog-appender.md` (T1221) — sibling sink for P2 findings
- `/eljun` command reference: `~/.claude/commands/eljun.md` (human-facing eljun usage, shares API contract)
