---
name: pilot-review/eljun-wiring
description: Orchestration pipeline sub-module — specifies how the pilot-review orchestrator wires the T1222 eljun client into its flow. Covers P0/P1 routing, project-slug auto-detection (`--app` flag with CWD fallback), dashboard placeholder-then-substitution, overflow handling, dry-run semantics, and error handoff. Pure wiring contract — does NOT re-specify the HTTP client (T1222) or the dashboard renderer (T1219). Not a standalone command.
---

**Module context**: Orchestration pipeline sub-module consumed by `halli-workflows:pilot-review-orchestrator` at §12 step 9e — the routing layer that decides WHICH findings go to eljun (P0 + P1), WHEN the call happens in the pipeline (between anchor-validator and dashboard-generator's post-fill pass), and HOW results thread back into the dashboard. The actual HTTP traffic, retry policy, idempotency hash-parsing, and overflow-parent composition live in `halli-workflows:commands/pilot-review/eljun-client.md` (T1222). This module is the caller; T1222 is the callee.

**Placement rationale**: The halli-workflows plugin is pure-markdown (see `halli-workflows:types/README.md`). This file is a prompt-style specification the orchestrator's inlined TypeScript implementation follows. It is NOT registered as a standalone command in `plugin.json`. It is also NOT the orchestrator itself — T1223's acceptance criteria explicitly forbids editing the main orchestrator prompt (`pilot-review-orchestrator.md`); this file is the spec that a future orchestrator edit will consume.

**Depends on**:

- `halli-workflows:commands/pilot-review/eljun-client.md` (T1222) — the `fileToEljun(findings, context)` HTTP client this wiring invokes. All retry/backoff/hash-parsing/overflow-body composition lives there.
- `halli-workflows:commands/pilot-review/dashboard-generator.md` (T1219) — consumer of the `eljunLinks` map this module threads through. The dashboard is rendered with `[pending]` placeholders first, then this wiring substitutes `display_id` links after filing completes.
- `halli-workflows:commands/pilot-review/anchor-validator.md` (T1218) — upstream gate. This wiring runs AFTER anchor validation so findings with broken `rule_link` anchors are already demoted before the P0/P1 filter.
- `halli-workflows:commands/pilot-review/backlog-appender.md` (T1221) — sibling sink for P2 findings. This wiring routes P0+P1 only; P2 flows through `backlog-appender` in step 9f.
- `halli-workflows:commands/pilot-review/p3-notes-aggregator.md` (T1220) — sibling sink for P3 findings.
- `halli-workflows:types/finding.md` — canonical Finding schema (severity, location_key, agent, evidence, suggested_fix).
- Consuming project's `.env.local` — must contain `ELJUN_API_KEY`. Orchestrator reads this before calling the wiring.

**Design Doc anchors**: §10 Eljun Integration Protocol (lines 877–966), §11 Dashboard Format (lines 969–1035 — the `**eljun**: [GUE-0147](...)` cell this wiring populates), §12 Orchestration Flow step 9e (line 1202), §14 flag interactions (`--dry-run` line 1311, `--force` line 1318, `--app` line 1294).

> **Rule 13 note (intellectual honesty)**: This wiring is the single coupling point where severity routing is decided. A bug here (e.g. routing P2 to eljun, or skipping P0 because a flag was misread) would leak non-blocking noise to the eljun board or hide a blocker. Every branch in §3 "Routing matrix" MUST be asserted by an end-to-end test in §8. No branch is "obvious" — severities are external inputs from reviewer agents, flags are external inputs from the user, and either can be wrong.

---

## 1. Purpose

Per Design Doc §12 step 9e: *"If not --dry-run: file P0 + P1 to eljun (dedup via description footer, cap 25)."* The orchestration flow calls this wiring AFTER dashboard render (9a) so the triage view is already on disk when filing starts, and BEFORE backlog append (9f) so the eljun display_ids are available to later stages if they need to cross-link.

This module specifies:

1. **Routing** — which findings reach eljun and which are siphoned to backlog or review-notes.
2. **Project-slug resolution** — how the orchestrator figures out which eljun project to file into, from `--app` flag or CWD detection.
3. **Dry-run semantics** — what happens when `--dry-run` is set (GET-only via client, dashboard substitution placeholder).
4. **Force-flag interaction** — `--force` means rubrics are missing; the run is an incomplete audit and MUST NOT file eljun tasks per §14.
5. **Dashboard handoff** — how the `eljunLinks` map flows from T1222 back into the dashboard rendered in T1219.
6. **Error escalation** — how client-level exceptions (`EljunAuthError`, `EljunProjectNotFoundError`) halt the run vs soft failures that accumulate in `manualFileRequired`.
7. **Overflow metadata** — how the overflow-parent `display_id` surfaces in the dashboard's RUN METADATA section.
8. **Metadata footer provenance** — confirmation that T1222 emits the `preflight_hash`, `finding_id`, optional `rubric_hash`, and `run_id` fields this wiring's caller relies on (audit-only; not re-specified here).

This module does NOT:

- Implement the eljun HTTP client (T1222's job).
- Render the dashboard (T1219's job).
- Compose the overflow parent's body (T1222's job, per `renderOverflowParent` in eljun-client.md §4).
- Write `MANUAL FILE REQUIRED` blocks (T1221's job — this wiring returns the list, T1221 writes it).

---

## 2. Contract

### Signature (prose — the orchestrator authors the TypeScript)

```
wireEljunRouting(
  findings:    Finding[],     // post-pipeline: deduped, verified, anchor-checked, sorted
  context: {
    projectSlug:     string,      // resolved via §4 algorithm (--app flag OR auto-detected from CWD)
    apiBaseUrl:      string,      // default "https://eljun.vercel.app/api/v1"
    apiKey:          string,      // from ELJUN_API_KEY env var, non-empty (caller validates)
    runId:           string,      // "YYYY-MM-DDTHH-mm-pilot-review"
    dashboardPath:   string,      // relative "docs/preflight/run-YYYY-MM-DD-HHMM.md"
    reviewNotesPath: string,      // relative "docs/preflight/run-*/review-notes.md"
    pluginVersion:   string,      // from halli-workflows plugin.json
    rubricHashes:    Record<string, string>,  // from rubric-check (T1215)
    flags: {
      dryRun:        boolean,     // --dry-run
      force:         boolean,     // --force (rubric files missing)
      app:           string|null, // --app=<slug> or null (auto-detect)
    },
    fetch:           typeof fetch,// injectable for tests (threaded to T1222)
    now:             () => Date,  // injectable for tests (threaded to T1222)
  },
): Promise<{
  filed:           FiledResult[],       // from T1222 (empty on dry-run and on force)
  patched:         PatchedResult[],     // from T1222 (empty on dry-run and on force)
  overflow:        OverflowResult|null, // from T1222 (null on dry-run and on force)
  dryRunPreview:   DryRunPreview|null,  // from T1222, populated iff dryRun===true
  manualFileRequired: ManualFileEntry[],// from T1222 (empty on dry-run and on force)
  collisionUpgrades:  CollisionUpgrade[],// from T1222 (empty on dry-run and on force)
  eljunLinks:      Record<string, string>, // locationKey → "https://eljun.vercel.app/projects/<slug>/items/<display_id>"
  skippedReason:   "dry-run"|"force"|"no-p0-p1"|null, // null iff eljun client was actually called
}>
```

The `eljunLinks` field is the load-bearing output consumed by the dashboard renderer (T1219). It is a flat map because `Finding` has a single stable key (`location_key`) and the dashboard walks findings in sorted order when rendering.

### Input assumptions

- `findings` is sorted by severity-then-witness-count, already deduped, verified, and anchor-checked. The wiring does NOT re-sort or re-validate.
- Severity is one of `"P0" | "P1" | "P2" | "P3"`.
- `findings` may be empty (no issues detected) — the wiring returns `{skippedReason: "no-p0-p1", ...}` without calling the client.
- `context.projectSlug` has already been resolved by the orchestrator per §4. The wiring does NOT perform re-resolution.
- `context.flags.dryRun` and `context.flags.force` are booleans, not strings. Flag parsing happens at the orchestrator boundary.
- `context.apiKey` is non-empty when `!dryRun && !force` — the caller is responsible for validating this and failing loud with a clear message if absent (per `eljun-client.md` §2 "Input assumptions"). Under `dryRun` or `force`, an absent key is fine because the client is not invoked.

### Output guarantees

- **No dual-routing**: a finding is routed to AT MOST one destination in one run. P0 and P1 go to eljun (if not `dryRun && !force`). P2 goes to the backlog-appender. P3 goes to the p3-notes-aggregator. A finding is never copied into two destinations.
- **Empty-filter idempotence**: if the `findings.filter(severity in {P0,P1}).length === 0`, the wiring skips the eljun client entirely (no GET, no POST, no PATCH). This matches `eljun-client.md` §2 "Exit conditions" empty-findings branch.
- **Flag interactions are exhaustive**: every (dryRun, force, findings-nonempty) combination has a defined outcome — see §3.
- **Dashboard links are populated iff tasks were filed**: on dry-run the map is populated with the client-reported `wouldPost`/`wouldPatch` preview info (dashboard shows `(dry-run — no tasks filed)` next to each P0/P1 per §11 of the Design Doc); on `force` the map is empty; on a real run the map has one entry per `filed` and `patched` entry.

### Side effects

- Invokes `fileToEljun` from T1222 exactly zero or one time. Zero on dry-run-with-empty-findings, on `--force`, or on zero-P0-P1. One otherwise.
- Threads the T1222 result back to the orchestrator's dashboard pass and review-notes-writer.
- No file I/O of its own. The orchestrator uses this module's return value to write files via T1219 (dashboard), T1221 (review-notes).

### Exit conditions

- **Normal**: return the result object.
- **`EljunAuthError` from T1222**: rethrow. The orchestrator catches this at §12 step 9e, writes a `P0` banner to the dashboard, and aborts step 9f (backlog append) and beyond. The dashboard is NOT rolled back — the user must see the triage with the banner.
- **`EljunProjectNotFoundError` from T1222**: rethrow, same abort semantics. The project slug was wrong — either a typo in `--app` or a broken auto-detect.
- **Any other error during the eljun call**: never occurs. T1222 converts all transient failures to `manualFileRequired` entries and all auth failures to the thrown errors above. If a new error type appears, the wiring treats it as auth-equivalent (fail the run) rather than silently continuing — Rule 13: unknown failure modes are fatal, not ignored.

---

## 3. Routing matrix (the heart of this module)

| Finding severity | Destination | Flag that disables | Notes |
|------------------|-------------|--------------------|-------|
| `P0` | eljun via T1222 → `priority: "critical", type: "bug", status: "todo"` | `--dry-run`, `--force` | Blocker — pilot is halted until resolved. |
| `P1` | eljun via T1222 → `priority: "high", type: "bug", status: "todo"` | `--dry-run`, `--force` | Must-fix-before-pilot. See §10 note on `status:` authority. |
| `P2` | backlog-appender (T1221) — NOT this wiring's concern | `--dry-run` | Appended to `docs/plans/backlog.md` under a run-dated section. |
| `P3` | p3-notes-aggregator (T1220) — NOT this wiring's concern | — | All P3 findings written to `review-notes.md`. Even `--dry-run` preserves this (cost of writing the notes is negligible and the user benefits from the triage info). |

### Flag interaction: the (dryRun, force) truth table

| `dryRun` | `force` | Action |
|----------|---------|--------|
| `false` | `false` | Call `fileToEljun(blockers, ctx)`. Populate `eljunLinks`. Normal flow. |
| `true`  | `false` | Call `fileToEljun(blockers, ctx)` with `ctx.dryRun=true`. Client GETs-only and returns `dryRunPreview`. Dashboard shows `(dry-run — no tasks filed)` placeholders. |
| `false` | `true`  | DO NOT call the client. Set `skippedReason: "force"`. Rationale: `--force` means rubrics are missing and the audit is incomplete per Design Doc §14: *"Does NOT file eljun tasks on a forced run (treated as incomplete audit)."* Filing an incomplete audit would spam the board with findings the reviewer could not fully assess. |
| `true`  | `true`  | DO NOT call the client. Set `skippedReason: "force"`. Same rationale — `--force` dominates. The `--dry-run + --force` combination is explicitly valid per §14: *"`--force` with `--dry-run` is valid (run with missing rubrics, preview only)."* The preview just skips the eljun preview since nothing would be filed anyway. |

The `skippedReason` field lets the dashboard emit the correct placeholder per case:

- `null` → normal display_id links (`[GUE-0147](...)`).
- `"dry-run"` → `(dry-run — no tasks filed)` per Design Doc §11 template.
- `"force"` → `(force run — eljun filing skipped; audit incomplete)` per §14 rationale.
- `"no-p0-p1"` → `(no P0/P1 findings — eljun not called)` — a clean-run signal.

### P0/P1 filter (the orchestrator code this wiring specifies)

```ts
// At step 9e of the orchestration flow:
const blockers = findings.filter(f => f.severity === "P0" || f.severity === "P1");

if (context.flags.force) {
  return { ...emptyClientResult(), eljunLinks: {}, skippedReason: "force" };
}
if (blockers.length === 0) {
  return { ...emptyClientResult(), eljunLinks: {}, skippedReason: "no-p0-p1" };
}

const clientResult = await fileToEljun(blockers, {
  projectSlug: context.projectSlug,
  apiBaseUrl: context.apiBaseUrl,
  apiKey: context.apiKey,
  runId: context.runId,
  dashboardPath: context.dashboardPath,
  pluginVersion: context.pluginVersion,
  rubricHashes: context.rubricHashes,
  dryRun: context.flags.dryRun,
  fetch: context.fetch,
  now: context.now,
});

const eljunLinks = buildEljunLinks(clientResult, context.projectSlug);
return {
  ...clientResult,
  eljunLinks,
  skippedReason: context.flags.dryRun ? "dry-run" : null,
};
```

`emptyClientResult()` returns `{ filed: [], patched: [], overflow: null, dryRunPreview: null, manualFileRequired: [], collisionUpgrades: [] }`. The orchestrator still writes the dashboard (all cells render `skippedReason`-appropriate placeholders), still writes review-notes, still runs backlog-appender for P2 — only the eljun step is skipped.

### `buildEljunLinks` — post-client substitution

```ts
function buildEljunLinks(
  result: Awaited<ReturnType<typeof fileToEljun>>,
  projectSlug: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  const base = `https://eljun.vercel.app/projects/${projectSlug}/items`;
  for (const f of result.filed) {
    map[f.locationKey] = `[${f.displayId}](${base}/${f.displayId})`;
  }
  for (const p of result.patched) {
    map[p.locationKey] = `[${p.displayId}](${base}/${p.displayId})`;
  }
  // Findings that ended up in manualFileRequired or in the overflow bucket do NOT get a link —
  // the dashboard renderer (T1219) emits the correct placeholder from its own eljunLinks-missing fallback:
  //   - manualFileRequired → "(manual — see review-notes.md)"
  //   - overflow → "(not filed — eljun cap reached — see overflow parent <displayId>)"
  // The orchestrator passes result.overflow.displayId to the dashboard separately (see §5 below) for the cap-reached message.
  return map;
}
```

Display-id link format matches the `**eljun**: [GUE-0147](https://eljun.vercel.app/projects/guestpad/items/GUE-0147)` pattern in Design Doc §11 dashboard template. The URL path uses the display_id (e.g. `GUE-0147`), NOT the UUID — this is what a human browsing eljun clicks on and what the dashboard renderer emits verbatim.

---

## 4. Project-slug auto-detection algorithm

`projectSlug` identifies the eljun project (and the monorepo app when running from inside a monorepo root). The orchestrator resolves it once, at startup, via the following algorithm.

### Precedence (highest wins)

1. **Explicit `--app=<slug>` flag** — if present, use the flag value verbatim. Validate against the known-slug table in §4.2. A typo'd slug fails loud at the T1222 GET (404) rather than here — but if the slug is not even in the known table, this wiring throws a clear error naming the candidate slugs.

2. **CWD-based auto-detection** — if `--app` is absent, inspect the current repo and apply the mapping in §4.3. If the detection yields a single unambiguous slug, use it. If it yields multiple candidates (e.g. `cabin` has 3 apps in `apps/`), fail loud: the user must pass `--app=<slug>` to disambiguate.

3. **Git remote fallback** (last resort) — if CWD detection is ambiguous or fails entirely, read `git remote get-url origin` and try to match the repo name against the known-slug table. This handles the edge case of running `/pilot-review` from a worktree with an unusual directory name (e.g. `cabin-T-your-thing` from the worktree-add script). This is a soft fallback; if it fails, the orchestrator still falls through to the ambiguity error.

### 4.1. Detection-source ordering visualized

```
START
  ├── --app=<slug> present?      → yes → validate against known-slug table → use
  │                                      ↓ no (slug unknown)
  │                                      FAIL LOUD: "Unknown --app=<x>. Known slugs: guestpad, aurora-hunter, aurora-hunter-web, bilahandbokin."
  └── no                         → CWD inspection
          ├── single app found?  → yes → use
          ├── multiple found?    → FAIL LOUD: "Found multiple candidate apps under apps/: guestpad, aurora-hunter, aurora-hunter-web. Pass --app=<slug> to disambiguate."
          └── none found         → git remote fallback
                  ├── remote URL matches a known slug? → yes → use (emit a stderr info: "Auto-detected project slug from git remote: <slug>")
                  └── no                                → FAIL LOUD: "Could not auto-detect project slug. Pass --app=<slug> explicitly. Known slugs: ..."
```

### 4.2. Known-slug table (canonical — grows as projects adopt)

| eljun slug | Repo | App subpath (in monorepos) | Notes |
|------------|------|----------------------------|-------|
| `guestpad` | `cabin` | `apps/guestpad` | GuestPad SaaS product. |
| `aurora-hunter` | `cabin` | `apps/aurora-hunter` | Aurora Hunter mobile app (Expo). |
| `aurora-hunter-web` | `cabin` | `apps/aurora-hunter-web` | Aurora Hunter marketing/companion site. |
| `bilahandbokin` | `bilahandbokin` | (repo root) | Cross-repo use — future adoption. |
| `skyretreaticeland-booking` | `sky-booking` | (repo root) | Cross-repo use — future adoption. |
| `skyretreaticeland-website` | `skyretreaticeland` | (repo root) | Cross-repo use — future adoption. |

**How this table is maintained**: when a new project adopts `/pilot-review`, its slug is added here AND to `~/.claude/commands/eljun.md` §Context Detection in the same PR. The two lists are kept in sync manually — this is a Phase 1 pragmatic choice; Phase 2 could read the list from the eljun `GET /projects` endpoint at orchestrator startup.

### 4.3. CWD-based auto-detection

Algorithm:

```ts
function detectFromCwd(cwd: string, knownSlugs: string[]): string[] {
  // Case A: CWD is a repo root that exactly matches a known slug (cross-repo case).
  const repoRoot = findRepoRoot(cwd);   // walks up until a `.git` is found
  const repoName = basename(repoRoot);
  if (knownSlugs.includes(repoName)) {
    return [repoName];
  }

  // Case B: CWD is the `cabin` monorepo root. Enumerate apps/*.
  if (repoName === "cabin") {
    const appsDir = join(repoRoot, "apps");
    if (existsSync(appsDir)) {
      const entries = readdirSync(appsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(n => knownSlugs.includes(n));
      return entries;  // e.g. ["aurora-api", "aurora-hunter", "aurora-hunter-web", "guestpad"]
      //                      NOTE: aurora-api is NOT a known slug (no eljun project), so it is filtered out above.
      //                      Current cabin enumeration (2026-04-14): ["aurora-hunter", "aurora-hunter-web", "guestpad"] — 3 candidates.
      //                      The caller sees 3 candidates → fails loud asking for --app disambiguation.
    }
  }

  // Case C: CWD is a monorepo subpath like cabin/apps/guestpad → resolve from path.
  //   This is a convenience for running the command from inside an app dir rather than from the repo root.
  const relative = relative(repoRoot, cwd);    // e.g. "apps/guestpad/src"
  const parts = relative.split(sep);
  if (parts[0] === "apps" && parts[1] && knownSlugs.includes(parts[1])) {
    return [parts[1]];
  }

  return [];  // no detection
}
```

Notes on the algorithm:

- **Case A handles cross-repo adoption**: running from `/home/halli/bilahandbokin` or `/home/halli/sky-booking` resolves directly to the repo's slug.
- **Case B is the cabin-monorepo ambiguity**: the cabin repo has multiple apps each with their own eljun slug, and the orchestrator cannot guess which one the user meant. Failing loud is correct — auto-picking one would silently file findings against the wrong project.
- **Case C handles the "pilot-review-from-inside-an-app" convenience**: `cd apps/guestpad && /pilot-review` resolves to `guestpad` without needing the flag. This path-based detection is deliberately strict (only the `apps/<slug>` shape, not deeper) to avoid matching coincidental directory names.
- **Worktree paths** (`../cabin-T-your-thing`) are handled by the git remote fallback in §4.1 step 3. The worktree's `.git` is a gitdir pointer, but `findRepoRoot` still terminates at the worktree directory; `basename` returns something like `cabin-T-your-thing` which is NOT in the known-slug table, so the main detection fails and the fallback kicks in. This is correct behavior — we don't want to match `cabin-T-your-thing` as if it were a cabin repo (it IS, but the user didn't say which app).

### 4.4. Example error messages (Rule 13 — fail loud with actionable messages)

```
# --app with unknown slug:
ERROR: Unknown --app=foobar. This eljun slug is not in the known-slug table.
       Known slugs: guestpad, aurora-hunter, aurora-hunter-web, bilahandbokin, skyretreaticeland-booking, skyretreaticeland-website.
       If foobar is a new project, add it to ~/.claude/commands/eljun.md §Context Detection
       AND halli-workflows:commands/pilot-review/eljun-wiring.md §4.2 in the same change.

# Ambiguity in cabin monorepo:
ERROR: Running from /home/halli/cabin (monorepo root). Found 3 candidate apps:
       - guestpad
       - aurora-hunter
       - aurora-hunter-web
       Pass --app=<slug> to disambiguate, or run from inside the app directory (cd apps/guestpad).

# No detection possible:
ERROR: Could not auto-detect eljun project slug from CWD (/home/halli/some-other-repo) or
       git remote (https://github.com/halli/unrelated-project.git).
       Pass --app=<slug> explicitly. Known slugs: guestpad, aurora-hunter, aurora-hunter-web, ...
```

---

## 5. Pipeline placement (Design Doc §12 step 9e)

The wiring runs in the orchestrator at this exact sequence:

```
step 8e  anchor-validator (T1218) — findings' rule_link anchors checked, demotions applied
         ↓
step 9a  dashboard-generator (T1219) — writes docs/preflight/run-*.md with [pending] eljun placeholders
         ↓
step 9b  p3-notes-aggregator (T1220) — writes review-notes.md (P3 dump)
         ↓
step 9c  raw-findings.json writer (scaffolded) — unaggregated debug output
         ↓
step 9d  per-agent artifact writer (scaffolded)
         ↓
step 9e  THIS MODULE (eljun-wiring) → eljun-client (T1222) — routes P0+P1
         ↓
step 9f  backlog-appender (T1221) — appends P2 to backlog.md (SKIPPED on --dry-run per §14)
         ↓
step 9g  dashboard post-fill pass — substitutes [pending] with eljunLinks values (see §6 below)
```

Two placement-order clarifications worth calling out:

- **Step 9a precedes 9e** — the dashboard is written with placeholders BEFORE the eljun client is called. Rationale: if eljun is unreachable (network outage, auth failure), the user still has the triage view on disk. The dashboard is the primary output; eljun links are a sidecar.
- **Step 9g is a fill-pass, not a re-render** — the dashboard is not fully re-rendered after eljun filing. Only the `[pending]` tokens are substituted with real links (or with `skippedReason` placeholders). See §6 for the substitution protocol.

### 5.1. Why not render the dashboard AFTER eljun filing?

Considered and rejected. The eljun client can take 30–120 seconds on a large run (25 POSTs + overflow + retries). If the run crashes mid-filing, we want the dashboard already on disk with whatever links were successfully filed. Rendering once up-front with placeholders, then doing a cheap string-substitution pass after filing, gives us both properties:

1. The dashboard exists on disk from step 9a onward, even if the process is killed mid-filing.
2. The substitution pass in 9g is a single file read + regex replace + write — fast, atomic, idempotent.

This choice is called out in the task file's Implementation Notes: *"Implementation-friendly approach: render dashboard with placeholder `[pending]` tokens, then substitute after filing completes."*

---

## 6. Dashboard placeholder substitution (step 9g)

The T1219 dashboard renderer consumes an `eljunLinks: Record<string, string>` map. The values are the **rendered** display_id+URL strings (not the raw IDs), so the dashboard can concatenate them verbatim into the template.

### 6.1. Placeholder format

When T1219 is invoked in step 9a with an EMPTY `eljunLinks` map (because filing hasn't happened yet), it emits `[pending]` in each eljun cell:

```markdown
### 1. [P0] [isolation + auth — 2 witnesses] RLS missing on `bar` table
- **Location**: `db:bar:rls_missing`
- **Evidence**: ...
- **Fix**: ...
- **eljun**: [pending]
- **Artifact**: artifacts/isolation/bar-rls.md
```

### 6.2. Substitution pass (step 9g)

After this wiring module returns, the orchestrator does:

```ts
const dashboardContent = readFileSync(context.dashboardPath, "utf-8");
let updated = dashboardContent;

for (const finding of findings.filter(f => f.severity === "P0" || f.severity === "P1")) {
  const link = wiringResult.eljunLinks[finding.location_key];
  const placeholder = renderPlaceholder(wiringResult.skippedReason, link, wiringResult, finding);
  // Replace the FIRST [pending] that appears immediately after this finding's location_key line.
  updated = replaceFirstPendingForLocationKey(updated, finding.location_key, placeholder);
}

writeFileSync(context.dashboardPath, updated, "utf-8");
```

`renderPlaceholder` chooses the correct string:

| `skippedReason` | `eljunLinks[location_key]` present? | Rendered value |
|-----------------|-------------------------------------|----------------|
| `null` (normal run) | yes | `eljunLinks[location_key]` (e.g. `[GUE-0147](https://eljun.vercel.app/projects/guestpad/items/GUE-0147)`) |
| `null` (normal run) | no, but in `manualFileRequired` | `(manual — see review-notes.md)` |
| `null` (normal run) | no, cap hit | `(not filed — eljun cap reached — see overflow parent [GUE-9999](...))` (the overflow parent's display_id comes from `wiringResult.overflow.displayId`) |
| `"dry-run"` | no (dry-run doesn't file) | `(dry-run — no tasks filed)` |
| `"force"` | no | `(force run — eljun filing skipped; audit incomplete)` |
| `"no-p0-p1"` | no | (unreachable — no P0/P1 findings means no dashboard rows in BLOCKERS/MUST-FIX sections) |

### 6.3. `replaceFirstPendingForLocationKey` — narrow substitution

The orchestrator must substitute the `[pending]` token that belongs to the **specific finding**, not the first `[pending]` in the file. Rationale: multiple findings may share the same eljun-cell line if a naive global replace is used, which would paste the same link N times.

Implementation sketch:

```ts
function replaceFirstPendingForLocationKey(
  content: string,
  locationKey: string,
  replacement: string,
): string {
  // Find the line with `**Location**: \`<locationKey>\`` (the canonical format in Design Doc §11).
  const locationLine = "**Location**: `" + locationKey + "`";
  const locationIdx = content.indexOf(locationLine);
  if (locationIdx === -1) return content; // not found — defensive, log and continue

  // Find the next `**eljun**: [pending]` after this location line.
  const searchStart = locationIdx + locationLine.length;
  const pendingIdx = content.indexOf("**eljun**: [pending]", searchStart);
  if (pendingIdx === -1) return content; // also defensive

  return (
    content.slice(0, pendingIdx) +
    "**eljun**: " + replacement +
    content.slice(pendingIdx + "**eljun**: [pending]".length)
  );
}
```

Defensive behavior: if the location line is not found or no `[pending]` follows it, the function silently returns unchanged and the orchestrator logs a stderr warning. This handles edge cases (human edited the dashboard between 9a and 9g, or T1219 emitted a different format) without crashing the run.

### 6.4. RUN METADATA section updates

The Design Doc §11 dashboard template has a RUN METADATA section near the bottom. This wiring contributes two lines:

```markdown
## RUN METADATA

- **Run ID**: 2026-04-14T15-39-pilot-review
- **Eljun filed**: 3 new, 2 reopened, 1 refreshed
- **Eljun overflow**: 5 findings rolled into parent [GUE-9999](...)   ← this line
- **Eljun collisions**: 1 hash collision upgraded to 16-hex (affected: iso.rls.missing.db:foo, iso.rls.missing.db:bar)   ← this line if collisionUpgrades nonempty
- **Manual-file required**: 2 findings (see review-notes.md "MANUAL FILE REQUIRED" block)
- **Drift-check exit code**: 0
- **Plugin version**: halli-workflows@1.3.0
```

These lines are populated from the wiring's return value:

- `overflow.count` and `overflow.displayId` → the overflow line.
- `collisionUpgrades.length` and the first 3 `locationKeys` → the collisions line (truncated with `...` if more).
- `manualFileRequired.length` → the manual-file line.

On `--dry-run`, the overflow/collisions/manual-file lines are replaced with:

```markdown
- **Eljun**: (dry-run — no tasks filed, no overflow computed, no collisions detected in dry-run mode)
```

On `--force`:

```markdown
- **Eljun**: (force run — eljun filing skipped; audit is incomplete due to missing rubrics)
```

---

## 7. Metadata footer handoff (audit trail)

T1222 is responsible for writing the description footer on every eljun task. This wiring does NOT re-specify that format — the footer is defined in `eljun-client.md` §4. This section exists so a reader of this wiring can trace what ends up in eljun without reading T1222.

Each filed or patched task has a description ending with:

```
<body from finding.suggested_fix>

---
<!-- pilot-review -->
preflight_hash: 7f3a9e21
finding_id: isolation-reviewer:db:bar:rls_missing:v1
rubric_hash: a0b3c4d5 (privacy-gdpr.md@sha)     ← omitted if the agent has no required rubric
run_id: 2026-04-14T15-39-pilot-review
```

**What this wiring contributes to the footer**:

- `runId` (passed through `context.runId` → `client.context.runId`).
- `pluginVersion` (passed through, used by T1222 for the overflow parent's footer).
- `rubricHashes` (passed through — T1222 looks up the per-agent rubric hash from this map).

**What this wiring does NOT contribute**:

- `preflight_hash` — computed by T1222 from `(projectSlug, location_key)`.
- `finding_id` — computed by T1222 from `finding.agent + location_key`.

The wiring just forwards the context; the field-level authoring lives in T1222.

---

## 8. Testing contract

Every test below MUST be implemented in the TypeScript port. Mock level: inject `fileToEljun` as a function parameter (the wiring's only dependency) so the tests drive the wiring's routing decisions without also testing T1222's HTTP behavior. T1222's own tests (in `eljun-client.md` §9) cover the client independently.

| # | Case | Expected |
|---|------|----------|
| 1 | P0/P1 filter: input 2×P0, 3×P1, 5×P2, 10×P3 | `fileToEljun` called with 5 findings (2 P0 + 3 P1), `eljunLinks` has ≤5 entries |
| 2 | Empty input | `fileToEljun` NOT called; `skippedReason: "no-p0-p1"`; `eljunLinks` is `{}` |
| 3 | Only P2/P3 (no blockers) | `fileToEljun` NOT called; `skippedReason: "no-p0-p1"` |
| 4 | `--dry-run=true, --force=false` with 3 P0 findings | `fileToEljun` called with `dryRun: true`; `filed/patched` empty; `dryRunPreview` non-null; `skippedReason: "dry-run"` |
| 5 | `--force=true, --dry-run=false` with 3 P0 findings | `fileToEljun` NOT called; `skippedReason: "force"`; `eljunLinks` is `{}` |
| 6 | `--force=true, --dry-run=true` with 3 P0 findings | `fileToEljun` NOT called; `skippedReason: "force"` (force dominates per §3 truth table) |
| 7 | Mock `fileToEljun` returns 3 filed + 2 patched | `eljunLinks` has 5 entries; each value is `[<displayId>](https://eljun.vercel.app/projects/<slug>/items/<displayId>)` |
| 8 | Mock returns 1 entry in `manualFileRequired` | That finding's locationKey is NOT in `eljunLinks`; the dashboard renderer renders `(manual — see review-notes.md)` for that cell (assertion in T1219's tests, not here) |
| 9 | Mock returns overflow with 5 findings rolled in | `eljunLinks` omits those 5 findings' locationKeys; `overflow.count === 5` returned verbatim; caller renders cap-reached placeholder |
| 10 | Mock throws `EljunAuthError` | Wiring rethrows verbatim; orchestrator's catch handler writes a P0 banner to the dashboard |
| 11 | Mock throws `EljunProjectNotFoundError` | Same as #10 — rethrows for orchestrator-level handling |
| 12 | Routing assertion: a P2 finding in the input is NOT forwarded to `fileToEljun` | Assertion: the array passed to the mock contains only P0+P1 |
| 13 | Routing assertion: a P3 finding in the input is NOT forwarded to `fileToEljun` | Same as #12 |
| 14 | Dashboard-link format: displayId `GUE-147` with slug `guestpad` | Emitted link is `[GUE-147](https://eljun.vercel.app/projects/guestpad/items/GUE-147)` |
| 15 | Dashboard-link format: displayId `AHW-42` with slug `aurora-hunter-web` | Emitted link is `[AHW-42](https://eljun.vercel.app/projects/aurora-hunter-web/items/AHW-42)` |
| 16 | Project-slug resolution: `--app=guestpad` | Returns `guestpad`, no CWD inspection |
| 17 | Project-slug resolution: `--app=unknown` | Throws `Unknown --app=unknown...` with the known-slug list |
| 18 | Project-slug resolution: CWD is `/home/halli/bilahandbokin` (cross-repo Case A) | Returns `bilahandbokin` |
| 19 | Project-slug resolution: CWD is `/home/halli/cabin` with 3 apps present | Throws `Found 3 candidate apps... Pass --app=<slug>` |
| 20 | Project-slug resolution: CWD is `/home/halli/cabin/apps/guestpad` (Case C) | Returns `guestpad` |
| 21 | Project-slug resolution: CWD is `/home/halli/cabin/apps/guestpad/src/lib` (Case C, deep) | Returns `guestpad` |
| 22 | Project-slug resolution: CWD is worktree `/home/halli/cabin-T-something` with no known slug | Falls through to git remote; if `origin` matches `cabin` repo → fails loud with ambiguity error (since `cabin` still has multiple apps); user must pass `--app` |
| 23 | End-to-end: 3 P0 + 5 P1 findings, mocked eljun client | 8 findings passed to client; `eljunLinks` has 8 entries; dashboard has 8 links after substitution |
| 24 | End-to-end: 30 P0+P1 findings (over cap), mocked client returns overflow | First 25 in `eljunLinks`; remaining 5 not in `eljunLinks`; `overflow` is surfaced in return value |
| 25 | Substitution: multiple findings share no prefix but each has unique `location_key` | `replaceFirstPendingForLocationKey` correctly narrows to the right `[pending]` for each |

**Mocking strategy reminder**: this wiring's unit tests inject a mock `fileToEljun` — T1222's behavior is not exercised here. The tests in `eljun-client.md` §9 cover T1222 independently. An integration test at the orchestrator level (not in this module) exercises the full `wireEljunRouting → fileToEljun → eljun HTTP` stack with real or staging eljun.

---

## 9. Rule 13 / Intellectual Honesty guardrails

- **No invented routing.** The routing table in §3 is copied from Design Doc §6 severity destinations and `halli-workflows:types/finding.md` §Severity. If the Design Doc or Finding schema changes, this file MUST change in the same commit (and an entry goes into `docs/plans/backlog.md` if the change slipped through).
- **No silent slug fallback.** If slug auto-detection fails, we fail LOUD with a full message listing known slugs. A silent default would cause findings to be filed against the wrong project silently — a Rule 0 (isolation) adjacent bug that would be invisible until a human noticed `AHW-47` cross-filed into `guestpad`.
- **No flag blending.** `--force` strictly disables eljun filing regardless of `--dry-run`. We do NOT attempt to "helpfully" skip the rubric check when `--dry-run` is set — the combination is explicitly valid per §14 and the user gets the preview of "what would be filed" as a dry-run, but the `--force` signal wins when deciding whether to actually file. This prevents a "I forgot to remove --force" user error from leaking incomplete-audit findings to eljun.
- **No swallowed `EljunAuthError`.** Auth errors rethrow. The orchestrator catches and writes a P0 banner. We do NOT convert auth errors to a soft "failed to file" state — an auth issue means the user's `.env.local` is wrong and EVERY subsequent `/pilot-review` run would fail the same way. Loud failure forces the fix.
- **No dashboard-post-filing re-render.** The dashboard is written once in 9a with placeholders. Post-filing we do a narrow string substitution (§6.3). A full re-render would give T1219 two authorship entry points — a source of drift. This is enforced by the substitution-only contract.
- **No slug-type narrowing via `as`.** The slug is a string, validated against a known list. We do NOT use TypeScript literal-type narrowing like `as "guestpad" | "aurora-hunter" | ...` because the list grows per project-adoption. Validation happens at runtime, per Rule 13 "no type casts to silence errors you don't understand."
- **No test that tests the mock.** Integration of this wiring with T1222 is tested in the orchestrator E2E suite. This module's unit tests inject a mock `fileToEljun` and assert what WE pass to it — not what the client does internally (that's T1222's test job).

---

## 10. Deviations from the task file

Two deviations from T1223's task description, both deliberate and documented here:

### 10.1. P1 `status` field

The T1223 task description says P1 → `status: backlog`. This contradicts:

- Design Doc §6 line 615: *"eljun auto-filed with `priority: high, type: bug, status: todo`."*
- `halli-workflows:types/finding.md` §Severity line 48: *"eljun auto-filed, `priority: high, type: bug, status: todo`."*
- `eljun-client.md` §3 line 219 and `renderTask` in §4 line 339: always `status: "todo"`.

The Design Doc and Finding schema are the authoritative sources (as per the doc-drift rule in CLAUDE.md — anything upstream of a task file takes precedence). This wiring uses `status: "todo"` for P1 and leaves the field-writing to T1222, which implements it correctly. An issue should be raised on the task file to reconcile its text with the Design Doc.

### 10.2. Overflow parent task composition

T1223's task description mentions the wiring "calls `fileToEljun` for first 25 and separately creates ONE summary task covering the rest." Per `eljun-client.md` §4 `renderOverflowParent` and §6 step 7, the overflow parent is composed INSIDE T1222, not inside this wiring. This wiring just passes all findings to T1222 and trusts T1222's cap-and-overflow logic.

This is a stronger contract: by pushing overflow composition into T1222, we get one place where the overflow-parent format is defined, one idempotency rule (§4 "same-day overflow parent is PATCHed rather than duplicated"), and one set of tests. The wiring's role is to surface `overflow.displayId` in the dashboard RUN METADATA and the cap-reached placeholder — not to compose the parent.

---

## 11. Consumption point

Invoked by `halli-workflows:pilot-review-orchestrator` at step 9e of the orchestration flow. Replacing the scaffold-stage placeholder:

```ts
// scaffold (T1201): eljun routing — deferred to T1222/T1223
```

with:

```ts
import { wireEljunRouting } from "halli-workflows/lib/orchestrator/eljun-routing";

// ... after dashboard write (9a), p3-notes (9b), raw-findings (9c), artifacts (9d):
const wiringResult = await wireEljunRouting(findings, {
  projectSlug,   // resolved at orchestrator startup per §4
  apiBaseUrl: env.ELJUN_API_URL ?? "https://eljun.vercel.app/api/v1",
  apiKey: env.ELJUN_API_KEY,  // validated non-empty unless dryRun || force
  runId,
  dashboardPath,
  reviewNotesPath,
  pluginVersion,
  rubricHashes,
  flags: { dryRun: flags.dryRun, force: flags.force, app: flags.app ?? null },
  fetch: globalThis.fetch,
  now: () => new Date(),
});

// Step 9g — dashboard post-fill pass
await substituteEljunLinksInDashboard(dashboardPath, findings, wiringResult);

// Step 9f — backlog append for P2 (SKIPPED on --dry-run, not on --force)
await appendBacklog(findings, { ...backlogCtx, dryRun: flags.dryRun });

// Step 9b's review-notes addendum — manual-file-required and collision upgrades
await appendEljunNotes(reviewNotesPath, wiringResult);
```

The orchestrator is responsible for:

- Resolving `projectSlug` via §4's precedence algorithm at startup, BEFORE reaching step 9e. Fail-loud errors from §4 are thrown at startup, not at step 9e.
- Reading and validating `ELJUN_API_KEY` from `.env.local` (unless `flags.dryRun || flags.force`).
- Catching `EljunAuthError` / `EljunProjectNotFoundError` from this wiring and writing the dashboard P0 banner + aborting step 9f and beyond.
- Threading `wiringResult` into the dashboard substitution pass (§6) and the review-notes addendum.

---

## 12. Phase boundary reminder (for future implementers)

- **Phase 1 (this module)**: P0 and P1 go to eljun via T1222 hash-based idempotency. P2/P3 unchanged. `rubric_hash` in footer is AUDIT-ONLY.
- **Phase 2 (deferred)**: rubric-hash-aware superseding (see Design Doc §15 Phase 2 scope). When T1222 is extended to close superseded tasks on rubric change, this wiring's contract is unchanged — T1222 handles the close/reopen sequencing internally and this wiring just threads `patched[]` with a new `supersededBy` field. The wiring's routing matrix does NOT change in Phase 2.
- **Phase 3 (upstream eljun `external_id`)**: when eljun adds an `external_id` column, T1222 retires the footer-hack and this wiring is unaffected. The `fileToEljun` signature does not change.

---

## References

- Design Doc §10 Eljun Integration Protocol — `docs/design/pilot-review-system-design.md` lines 877–966
- Design Doc §11 Dashboard Format — lines 969–1035 (template showing `**eljun**: [GUE-0147](...)` cell)
- Design Doc §12 Orchestration Flow step 9e — line 1202
- Design Doc §14 Scoping Flags — `--dry-run` line 1311, `--force` line 1318, `--app` line 1294
- Design Doc §6 Severity Taxonomy — lines 593–645 (P0/P1/P2/P3 destinations)
- ADR-0014 pilot-review orchestration — `docs/adr/ADR-0014-pilot-review-orchestration.md`
- Canonical schema: `halli-workflows:types/finding.md`
- Upstream: `halli-workflows:commands/pilot-review/anchor-validator.md` (T1218), `halli-workflows:commands/pilot-review/dashboard-generator.md` (T1219)
- Downstream: `halli-workflows:commands/pilot-review/eljun-client.md` (T1222 — the callee), `halli-workflows:commands/pilot-review/backlog-appender.md` (T1221, sibling sink), `halli-workflows:commands/pilot-review/p3-notes-aggregator.md` (T1220, sibling sink)
- `/eljun` command reference: `~/.claude/commands/eljun.md` (known-slug table cross-reference)
