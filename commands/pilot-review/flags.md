---
name: pilot-review/flags
description: Orchestrator sub-module — parses and validates the `/pilot-review` scoping flag string from the shim into a strongly typed `Flags` object, enforces flag-interaction rules (mutual-exclusion, fail-loud on unknowns), and exposes the per-agent predicate helpers (`includesAgent`, `respectsSince`) consumed by the roster resolver and per-agent prompt builder. Pure function apart from a single Playwright-presence probe (`fs.existsSync`) when `--include-ux` is set.
---

**Module Context**: Prompt-style specification for the `parseFlags(argString: string, env: FlagEnv): Flags` pure helper consumed by the `.claude/commands/pilot-review.md` shim BEFORE it dispatches to `halli-workflows:pilot-review-orchestrator`. The orchestrator itself also consults the resulting `Flags` object at roster-resolution (§12 step 2), fan-out (§12 step 3), since-scoping (per-agent prompt assembly), and output fan-out (§12 steps 6–9). This file is NOT a slash-command; it is the authoritative specification for the flag parser a future TypeScript implementation in `halli-workflows/lib/orchestrator/flags.ts` can consume directly as its design contract.

**Scope discipline**: This module does **one thing** — turn a raw `$ARGUMENTS` string into a validated `Flags` object. It does NOT invoke agents, read rubrics, write files, or orchestrate the run. Downstream consumers (rubric-check, dedup, verify-claims, eljun-wiring, backlog-appender) receive the `Flags` object unchanged and act on their relevant fields.

## Rule 13 framing

A silently-ignored flag is a Rule 13 (intellectual honesty) violation. The user typed `--skip=freshnes` expecting the freshness-reviewer to be skipped; a lenient parser that discards the unknown flag (or treats `--skip=freshnes` as a legal skip with no matching agent) lets the run proceed in the WRONG mode while looking correct. The dashboard then reports findings under a misleading header "Freshness reviewer: ran successfully".

The parser MUST:

- **Fail loud on unknown flags** — do not tolerate typos. Print the full flag registry and exit non-zero.
- **Fail loud on unknown agent names in `--skip` / `--only`** — validated against the known roster, not just shape.
- **Fail loud on mutually-exclusive combinations** — `--skip` and `--only` together is user error, not a preference.
- **Fail loud on malformed `--concurrency=<N>`** — `N` must be a positive integer. `--concurrency=0`, `--concurrency=-3`, `--concurrency=banana` all halt.
- **Probe Playwright presence eagerly** when `--include-ux` is set — absence emits a P0 `PLAYWRIGHT_ABSENT` finding, not a silent skip (§14 flag interaction rules).

Silent fallbacks are prohibited. The parser's only output shapes are: (a) a validated `Flags` object, or (b) an error with an actionable message.

---

## Input

The parser accepts two inputs from the caller:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `argString` | `string` | yes | The raw `$ARGUMENTS` value passed to the shim. May be empty (`""`) — the parser returns the all-defaults `Flags` object in that case. Whitespace-separated tokens; no shell-quoting is honored (shim splits on whitespace before passing in). |
| `env` | `FlagEnv` | yes | Environment context the parser needs: the absolute path to the consuming repo root (`repoRoot`) so the Playwright probe has a grounded file lookup, and the canonical `knownAgents` roster (kebab-case names matching the finding schema §30) so `--skip` / `--only` values can be validated. Injected by the shim — do NOT hard-code a roster inside the parser. |

### `FlagEnv`

```ts
interface FlagEnv {
  /** Absolute path to the repo root. Used only for the Playwright probe. */
  repoRoot: string;

  /**
   * Canonical agent names recognised in this run, kebab-case, in fan-out order.
   * E.g. ["drift-gate", "codebase-auditor", "isolation-reviewer",
   *       "auth-boundary-reviewer", "privacy-gdpr-reviewer", "payment-reviewer",
   *       "freshness-reviewer", "monitoring-reviewer", "owner-ux-reviewer",
   *       "guest-ux-reviewer"].
   * The last two are UX reviewers — only considered legal when `--include-ux` is
   * set (see §Validation). A project-specific roster (e.g. aurora-hunter-web omits
   * payment-reviewer) MUST be passed in here; the parser does NOT ship a default.
   */
  knownAgents: readonly string[];

  /**
   * UX reviewer names within `knownAgents`. The parser uses this to apply the
   * "UX-reviewer requires --include-ux" validation. Pass in explicitly so the
   * parser never guesses which agents are UX.
   */
  uxAgents: readonly string[];
}
```

If `argString` or `env` is missing, the parser throws `TypeError("parseFlags: repoRoot, knownAgents, and uxAgents are required")`. Missing input is a caller bug, not a user error — this is NOT a runtime validation of user input.

---

## Output

Return a single `Flags` object:

```ts
interface Flags {
  /**
   * Target app slug within the consuming monorepo (e.g. "guestpad",
   * "aurora-hunter-web"). null means "not specified" — per §14, the default is
   * "all apps in the current monorepo, sequential runs, merged dashboard", but
   * this module returns null; the orchestrator handles the iteration.
   */
  app: string | null;

  /**
   * Zero or more agent names to skip. Always an array (empty when `--skip` is
   * not passed). Order matches the order of `--skip` on the command line.
   * Mutually exclusive with `only` — if both are populated the parser throws
   * before returning.
   */
  skip: readonly string[];

  /**
   * Zero or more agent names to run EXCLUSIVELY. Always an array (empty when
   * `--only` is not passed). A non-empty `only` array means "run exactly these
   * agents; drop every other agent from the roster". Repeatable like --skip.
   */
  only: readonly string[];

  /**
   * True iff `--include-ux` was passed. UX reviewers (T1308/T1309) are kept in
   * the roster only when this is true. Absence of Playwright with this flag
   * set does NOT change this value — the orchestrator emits a PLAYWRIGHT_ABSENT
   * P0 finding using the `playwrightAvailable` field, and the run continues for
   * non-UX agents.
   */
  includeUx: boolean;

  /**
   * True iff `--dry-run` was passed. When true, the orchestrator skips eljun
   * writes and the backlog.md append (§14). Dashboard, review-notes, artifacts,
   * and raw-findings.json are still written.
   */
  dryRun: boolean;

  /**
   * Git ref for `--since=<ref>`. null when absent. When non-null, code-analysis
   * agents (codebase-auditor, isolation-reviewer, auth-boundary-reviewer,
   * privacy-gdpr-reviewer, payment-reviewer) scope their file-walk to
   * `git diff --name-only <ref>...HEAD`. drift-gate and freshness-reviewer
   * ignore this field (§14 flag interaction rules: "--since does not affect
   * drift-gate (always full-scope) or freshness-reviewer (always full-scope)").
   * Monitoring-reviewer also runs full-scope because operational gaps are not
   * bounded by a code diff.
   */
  since: string | null;

  /**
   * True iff `--force` was passed. When true, a missing required rubric
   * emits a P0 RUBRIC_MISSING finding but does NOT halt the run. It ALSO
   * suppresses eljun filing regardless of `dryRun` (per §14: a forced run is
   * an incomplete audit and must not result in action items).
   */
  force: boolean;

  /**
   * Semaphore size for the fan-out. Always >= 1. Default is 5 (§13 recommended
   * default). Validated at parse time: non-positive values throw. There is no
   * upper cap in this parser — a user asking for 50 concurrent agents gets 50,
   * and they own the API rate-limit consequences.
   */
  concurrency: number;

  /**
   * True iff `--scaffold-rubrics` was passed. When true, the orchestrator
   * invokes the separate scaffolder sub-module (authored in Phase 1.5) and
   * exits without running the review. This flag is mutually exclusive with
   * every other flag EXCEPT `--output-format` (users may still want JSON
   * status from the scaffolder) — see §Validation.
   */
  scaffoldRubrics: boolean;

  /**
   * True iff `--commit-artifacts` was passed. Inverts the default
   * `.gitignore` behaviour for `docs/preflight/run-*/artifacts/`. When true,
   * the orchestrator writes (or overwrites) a `.gitignore` in that directory
   * to un-ignore the artifacts; when false, the default `.gitignore` that
   * excludes artifacts stays in effect.
   */
  commitArtifacts: boolean;

  /**
   * Output format for the dashboard + per-run JSON fan-out. "markdown" (default)
   * or "json". "json" emits `docs/preflight/run-*/dashboard.json` and suppresses
   * the Markdown dashboard — all other artifacts (review-notes, raw-findings,
   * per-agent artifacts) are still written in their native formats.
   */
  outputFormat: "markdown" | "json";

  /**
   * Derived signal — NOT a command-line flag. True iff `env.repoRoot`
   * contains a Playwright installation detectable via the probe in §Playwright
   * probe below. Orchestrator uses this together with `includeUx` to decide
   * whether to emit a PLAYWRIGHT_ABSENT finding. Always populated (never undefined),
   * even when `includeUx=false` — consumers downstream may use it to annotate
   * "UX available but not requested" in the dashboard metadata.
   */
  playwrightAvailable: boolean;
}
```

All eleven command-line fields plus `playwrightAvailable` are always populated. There is no "some were omitted" state — the defaults are explicit, documented below, and applied at parse time.

---

## Algorithm

```
Input: { argString, env }
Output: Flags

1. Tokenize argString:
     trim, split on /\s+/, filter empty strings.
     Result: tokens: string[]

2. Initialize defaults:
     flags = {
       app:              null,
       skip:             [],
       only:             [],
       includeUx:        false,
       dryRun:           false,
       since:            null,
       force:            false,
       concurrency:      5,            // §13 recommended default
       scaffoldRubrics:  false,
       commitArtifacts:  false,
       outputFormat:     "markdown",
       playwrightAvailable: false,     // populated at step 5
     }

3. Walk tokens:
     For each token:
       a. Match against the registry (§Flag registry). Each entry specifies:
          - canonical name (e.g. "--app")
          - value shape: boolean (no "=") | string | integer | enum
          - whether repeatable (--skip and --only are; others are not)
          - which field of `flags` it populates.
       b. If token does not match any registry entry, throw with a helpful
          message:

            Unknown flag: "--foo".
            Available flags:
              --app=<slug>
              --skip=<agent>
              --only=<agent>
              --include-ux
              --dry-run
              --since=<git-ref>
              --force
              --concurrency=<N>
              --scaffold-rubrics
              --commit-artifacts
              --output-format=markdown|json

          Exit non-zero. Do NOT silently ignore.

       c. If a non-repeatable flag was already seen, throw:

            Flag --<name> passed more than once. It is not repeatable.

          (Applies to --app, --include-ux, --dry-run, --since, --force,
          --concurrency, --scaffold-rubrics, --commit-artifacts, --output-format.)

       d. Parse the token's value:
          - Booleans: presence-only (no "=<value>"). A token like
            "--dry-run=true" throws "--dry-run does not take a value".
          - Strings: require "=<value>". Empty "=<value>" (e.g. "--app=")
            throws "--app requires a non-empty value".
          - Integers (--concurrency): must match /^[1-9]\d*$/ — positive
            integer, no leading zeros, no sign. "--concurrency=0" throws
            "--concurrency must be a positive integer (got 0)".
            "--concurrency=-3", "--concurrency=3.5", "--concurrency=banana"
            all throw.
          - Enums (--output-format): value must be one of the declared literal
            set ("markdown" | "json"). Anything else throws
            "--output-format must be 'markdown' or 'json' (got 'yaml')".

       e. Assign to the correct field:
          - Booleans: set the field to true.
          - Strings: set the field to the parsed value.
          - Repeatable strings: push onto the array (preserving order).

4. Validate flag combinations (AFTER parsing, BEFORE returning):
     a. If flags.skip.length > 0 AND flags.only.length > 0:
          throw "Flags --skip and --only are mutually exclusive."
          (Message includes both lists so the user sees exactly what was
          parsed — avoids "did I typo one of them?" confusion.)

     b. If flags.scaffoldRubrics is true AND any of these is ALSO true or non-
        default: app, skip, only, includeUx, dryRun, since, force, concurrency≠5,
        commitArtifacts:
          throw "--scaffold-rubrics is mutually exclusive with every flag except
                 --output-format. Received: <list of violators>."
        Rationale: §14 documents --scaffold-rubrics as an early-exit operation.
        Combining it with --app or --dry-run is incoherent — the user wanted
        scaffolding OR a review, not both. --output-format is allowed because
        the scaffolder may emit JSON status for scripts.

     c. Validate every name in flags.skip against env.knownAgents:
          If an entry is NOT in env.knownAgents:
            throw "Unknown agent in --skip: '<name>'. Known agents:
                   <joined list from env.knownAgents>."
        Same for flags.only. Validation is case-sensitive — the canonical
        names are all kebab-case lowercase.

     d. Validate UX-reviewer references:
          If flags.includeUx is false AND flags.only intersects env.uxAgents:
            throw "--only references UX reviewers (<list>) but --include-ux
                   was not set. Add --include-ux or drop the UX reviewer(s)
                   from --only."
          If flags.skip intersects env.uxAgents:
            DO NOT throw. Skipping a UX reviewer when not in UX mode is a
            no-op and harmless. (Edge case: the shim may pass --skip=guest-ux
            reviewer defensively regardless of --include-ux; tolerate it.)

5. Playwright probe (only when includeUx):
     If flags.includeUx is true:
       flags.playwrightAvailable = detectPlaywright(env.repoRoot)
     Else:
       flags.playwrightAvailable = detectPlaywright(env.repoRoot)  // still run
     Rationale: the field is always populated so downstream code can annotate
     "UX available but not requested" in dashboard metadata. The probe is
     cheap (a couple of fs.existsSync calls, see §Playwright probe).

6. Return flags (frozen to prevent caller mutation):
     return Object.freeze(flags)
```

---

## Flag registry

Source of truth for the parser. Do NOT duplicate this table into the shim or the orchestrator — both consume the parsed `Flags` object. Changes here are contract changes — bump the plugin version.

| Token form | Shape | Repeatable | Field | Default | Notes |
|------------|-------|------------|-------|---------|-------|
| `--app=<slug>` | string | no | `app` | `null` | Must match `apps/<slug>/` in the consuming repo. Existence check is the shim's job (parser does not touch the filesystem for this field). |
| `--skip=<agent>` | string | yes | `skip` (push) | `[]` | Kebab-case agent name; validated against `env.knownAgents`. |
| `--only=<agent>` | string | yes | `only` (push) | `[]` | Kebab-case agent name; validated against `env.knownAgents`. Mutually exclusive with `--skip`. |
| `--include-ux` | boolean | no | `includeUx` | `false` | Gates Phase 2 UX reviewers. |
| `--dry-run` | boolean | no | `dryRun` | `false` | Suppresses eljun + backlog writes. |
| `--since=<git-ref>` | string | no | `since` | `null` | No value validation in the parser — git ref validity is checked by the per-agent prompt builder when it runs `git diff`. A malformed ref ultimately surfaces as a `REVIEWER_CRASHED` P3 finding, not a parser error, because the parser does not shell out. |
| `--force` | boolean | no | `force` | `false` | Allows run with missing rubrics; suppresses eljun filing. |
| `--concurrency=<N>` | integer (>=1) | no | `concurrency` | `5` | Parser rejects 0, negative, non-integer. |
| `--scaffold-rubrics` | boolean | no | `scaffoldRubrics` | `false` | Early-exit path; mutually exclusive with all flags except `--output-format`. |
| `--commit-artifacts` | boolean | no | `commitArtifacts` | `false` | Inverts default `.gitignore` behaviour for `docs/preflight/run-*/artifacts/`. |
| `--output-format=<fmt>` | enum (`markdown`\|`json`) | no | `outputFormat` | `"markdown"` | Rejects any other value. |

### Why NOT `mri` / `minimist` / `yargs`

Per T1224 implementation notes, the parser is a **manual switch**, not a library. Rationale:

- The flag set is 11 items and never grows in Phase 1. The maintenance cost of a manual parser is low.
- Library parsers (especially `minimist`) have a history of **prototype-pollution CVEs** (`--__proto__=...`) — unacceptable for a tool that runs inside a user's Claude Code session with file-write access.
- `yargs` pulls in ~50 transitive deps and adds ~300ms startup — the pilot-review run is already latency-sensitive (ten agents at 30s each).
- A hand-rolled switch gives us exact control over error messages — which are the Rule-13 defense. "Unknown option" from yargs is inferior to our tailored "Unknown flag: '--foo'. Available flags: ..." message.

If a future refactor wants a library, `mri` (<1 KB, zero deps, no proto pollution) is the only acceptable choice — but the **error messages must be re-implemented on top of it** to preserve the fail-loud contract.

---

## Playwright probe

`detectPlaywright(repoRoot: string): boolean`

The probe returns true iff ANY of these paths exist relative to `repoRoot`:

- `node_modules/@playwright/test/package.json`
- `node_modules/playwright/package.json`
- `apps/*/node_modules/@playwright/test/package.json` (monorepo-per-app installs)
- `apps/*/node_modules/playwright/package.json`

Implementation:

```ts
import { existsSync } from "node:fs";
import { globSync } from "node:fs";           // Node 22+; else use `glob` sync

function detectPlaywright(repoRoot: string): boolean {
  const candidates = [
    `${repoRoot}/node_modules/@playwright/test/package.json`,
    `${repoRoot}/node_modules/playwright/package.json`,
  ];
  for (const p of candidates) if (existsSync(p)) return true;

  // Per-app installs (turborepo / nx pattern)
  const perApp = globSync(
    `${repoRoot}/apps/*/node_modules/@playwright/test/package.json`,
  );
  if (perApp.length > 0) return true;
  const perAppAlt = globSync(
    `${repoRoot}/apps/*/node_modules/playwright/package.json`,
  );
  return perAppAlt.length > 0;
}
```

The probe is the ONLY piece of non-pure code in this module — every other branch is deterministic on its inputs. The probe is intentionally narrow: it only checks the `package.json` of the installed Playwright, NOT whether browsers are installed (`playwright install`) or whether tests exist. Those are the UX reviewers' runtime concerns — emitted as finer-grained P1 findings during fan-out. The parser's job is only to catch the coarse "Playwright is not even a dependency" state.

### PLAYWRIGHT_ABSENT finding — NOT emitted by this module

The parser **populates `flags.playwrightAvailable`** but does NOT emit a `Finding`. Emission is the orchestrator's job (§12 step 2, after this module returns and the roster resolver sees `includeUx=true && playwrightAvailable=false`). Reference shape:

```json
{
  "agent": "orchestrator",
  "severity": "P0",
  "rule_link": "docs/design/pilot-review-system-design.md#14-scoping-flags",
  "verdict": "fail",
  "evidence": "--include-ux was passed but Playwright is not installed at <repoRoot>. Checked: node_modules/@playwright/test, node_modules/playwright, apps/*/node_modules/@playwright/test, apps/*/node_modules/playwright. UX reviewers (owner-ux-reviewer, guest-ux-reviewer) cannot run without Playwright. Run continues for non-UX agents.",
  "location_key": "mon:pilot-review:playwright_absent",
  "heuristic_id": "PLAYWRIGHT_ABSENT",
  "suggested_fix": "Install Playwright: `npm install -D @playwright/test && npx playwright install`. Or drop --include-ux to run without UX reviewers.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

The `location_key` uses the `mon:` prefix (monitoring subsystem) with `gap_id = playwright_absent` because the absent-Playwright condition is an operational gap, not a code defect. This matches the location-key grammar §5 for `mon:` keys. The orchestrator-level emitter is responsible for this; the parser only hands back the boolean.

---

## Error messages

All errors from this module follow a strict shape for grep-ability in CI logs and for user parsing:

```
[pilot-review-flags] <one-line summary>
<optional: multi-line detail>
<optional: "Available flags: ..." registry listing or "Known agents: ..." roster listing>
```

Concrete examples:

```
[pilot-review-flags] Unknown flag: "--freshness".
Did you mean --skip=freshness-reviewer?
Available flags:
  --app=<slug>                   Target app slug within this monorepo
  --skip=<agent>                 Skip a specific reviewer (repeatable)
  --only=<agent>                 Run only a specific reviewer (repeatable; mutually exclusive with --skip)
  --include-ux                   Include Phase 2 UX reviewers (requires Playwright)
  --dry-run                      Do not file eljun tasks or append to backlog.md
  --since=<git-ref>              Scope code analysis to files changed since <git-ref>
  --force                        Run even with missing rubrics (suppresses eljun filing)
  --concurrency=<N>              Override default semaphore of 5
  --scaffold-rubrics             Create stub rubric files and exit
  --commit-artifacts             Commit artifacts/ alongside the dashboard
  --output-format=markdown|json  Output format for the dashboard
```

```
[pilot-review-flags] Flags --skip and --only are mutually exclusive.
--skip = [freshness-reviewer, codebase-auditor]
--only = [isolation-reviewer]
Use either --skip (to exclude specific reviewers from the default roster) or
--only (to run exactly the named reviewers), not both.
```

```
[pilot-review-flags] --concurrency must be a positive integer (got "0").
```

```
[pilot-review-flags] Unknown agent in --skip: "freshness".
Known agents: drift-gate, codebase-auditor, isolation-reviewer,
auth-boundary-reviewer, privacy-gdpr-reviewer, payment-reviewer,
freshness-reviewer, monitoring-reviewer, owner-ux-reviewer, guest-ux-reviewer.
```

Message tone: plain imperative, no hedging, always ends with an actionable next step when one exists (the "Did you mean" nudge, the "Use either ... or ..." disambiguation). The "Did you mean" suggestion uses Levenshtein distance ≤ 2 against `env.knownAgents` and the flag registry; if no near-match exists, omit the suggestion line rather than print a nonsense guess.

---

## Examples

### Example 1 — No flags

Input:

```ts
parseFlags("", { repoRoot: "/home/halli/cabin", knownAgents, uxAgents })
```

Output (abbreviated — Playwright probe ran and cabin has it installed):

```json
{
  "app": null,
  "skip": [],
  "only": [],
  "includeUx": false,
  "dryRun": false,
  "since": null,
  "force": false,
  "concurrency": 5,
  "scaffoldRubrics": false,
  "commitArtifacts": false,
  "outputFormat": "markdown",
  "playwrightAvailable": true
}
```

Shim proceeds with all-apps default (per §14). `playwrightAvailable=true` is recorded for the dashboard metadata even though `includeUx=false`.

### Example 2 — Single app, dry run, skip two reviewers

Input: `--app=guestpad --dry-run --skip=freshness-reviewer --skip=codebase-auditor`

Output:

```json
{
  "app": "guestpad",
  "skip": ["freshness-reviewer", "codebase-auditor"],
  "only": [],
  "includeUx": false,
  "dryRun": true,
  "since": null,
  "force": false,
  "concurrency": 5,
  "scaffoldRubrics": false,
  "commitArtifacts": false,
  "outputFormat": "markdown",
  "playwrightAvailable": true
}
```

Repeatable `--skip` accumulates in the order passed. Orchestrator drops both from the roster; the dashboard's SKIPPED AGENTS section lists them with reason "user-requested via --skip". No eljun writes because `dryRun=true`.

### Example 3 — Only one reviewer

Input: `--app=guestpad --only=isolation-reviewer`

Output:

```json
{
  "app": "guestpad",
  "skip": [],
  "only": ["isolation-reviewer"],
  "includeUx": false,
  "dryRun": false,
  "since": null,
  "force": false,
  "concurrency": 5,
  "scaffoldRubrics": false,
  "commitArtifacts": false,
  "outputFormat": "markdown",
  "playwrightAvailable": true
}
```

Orchestrator runs exactly one agent; the dashboard's SKIPPED AGENTS section lists the other seven as "not requested via --only".

### Example 4 — Mutually exclusive --only and --skip → error

Input: `--only=isolation-reviewer --skip=freshness-reviewer`

Output: parser throws with exit code 1 and the message:

```
[pilot-review-flags] Flags --skip and --only are mutually exclusive.
--skip = [freshness-reviewer]
--only = [isolation-reviewer]
Use either --skip (to exclude specific reviewers from the default roster) or
--only (to run exactly the named reviewers), not both.
```

The shim catches the throw and forwards the message to the user via stderr. Exit code 1. No orchestrator invocation.

### Example 5 — Unknown flag → error with registry dump

Input: `--app=guestpad --foo=bar`

Output: parser throws with exit code 1 and the registry-dumping message from §Error messages. Exit code 1. No orchestrator invocation.

### Example 6 — `--include-ux` in repo without Playwright

Input: `--app=guestpad --include-ux`, env.repoRoot points to a repo where Playwright is not installed.

Output:

```json
{
  "app": "guestpad",
  "skip": [],
  "only": [],
  "includeUx": true,
  "dryRun": false,
  "since": null,
  "force": false,
  "concurrency": 5,
  "scaffoldRubrics": false,
  "commitArtifacts": false,
  "outputFormat": "markdown",
  "playwrightAvailable": false
}
```

Parser does NOT throw — the probe result is a flag field, not an error. The orchestrator sees `includeUx=true && playwrightAvailable=false` and emits the PLAYWRIGHT_ABSENT P0 finding (shape shown in §Playwright probe). The run continues for the eight non-UX reviewers. Dashboard shows the P0 under BLOCKERS.

### Example 7 — `--dry-run --force` combination (valid)

Input: `--app=guestpad --dry-run --force`

Output:

```json
{
  "app": "guestpad",
  "skip": [],
  "only": [],
  "includeUx": false,
  "dryRun": true,
  "since": null,
  "force": true,
  "concurrency": 5,
  "scaffoldRubrics": false,
  "commitArtifacts": false,
  "outputFormat": "markdown",
  "playwrightAvailable": true
}
```

Per §14 this is a legal combination: "Run with missing rubrics, preview only." Orchestrator runs agents whose rubrics are present, emits P0 RUBRIC_MISSING for absent rubrics, writes the dashboard, makes zero eljun writes. `force=true` implies no eljun writes regardless of `dryRun`; `dryRun=true` reinforces the same. Together they are idempotent — either alone would suppress eljun.

### Example 8 — `--scaffold-rubrics` alone

Input: `--scaffold-rubrics`

Output:

```json
{
  "app": null,
  "skip": [],
  "only": [],
  "includeUx": false,
  "dryRun": false,
  "since": null,
  "force": false,
  "concurrency": 5,
  "scaffoldRubrics": true,
  "commitArtifacts": false,
  "outputFormat": "markdown",
  "playwrightAvailable": true
}
```

Orchestrator detects `scaffoldRubrics=true`, invokes the scaffolder sub-module (Phase 1.5), exits without running the review. Every other field is default.

### Example 9 — `--scaffold-rubrics` with incompatible combination → error

Input: `--scaffold-rubrics --app=guestpad`

Output: parser throws with exit code 1:

```
[pilot-review-flags] --scaffold-rubrics is mutually exclusive with every flag
except --output-format. Received: app=guestpad.
Run `/pilot-review --scaffold-rubrics` alone to scaffold stubs, or drop
--scaffold-rubrics to run a review against --app=guestpad.
```

Exception (allowed): `--scaffold-rubrics --output-format=json` is legal — the scaffolder emits JSON status.

### Example 10 — Invalid `--concurrency`

Input: `--app=guestpad --concurrency=0`

Output: throws `[pilot-review-flags] --concurrency must be a positive integer (got "0").`

Input: `--app=guestpad --concurrency=-3`

Output: throws `[pilot-review-flags] --concurrency must be a positive integer (got "-3").`

Input: `--app=guestpad --concurrency=3.5`

Output: throws `[pilot-review-flags] --concurrency must be a positive integer (got "3.5").`

Input: `--app=guestpad --concurrency=banana`

Output: throws `[pilot-review-flags] --concurrency must be a positive integer (got "banana").`

### Example 11 — `--since` propagation

Input: `--app=guestpad --since=origin/main`

Output: `since: "origin/main"`; all else default.

The parser does NOT validate that `origin/main` is a valid git ref — that's `git diff`'s job at per-agent prompt-assembly time. If `origin/main` is unknown, the per-agent code-walk fails with a `REVIEWER_CRASHED` P3 (§13 Q2); the parser has no opinion.

Orchestrator consults `flags.since` when building code-analysis agent prompts, resolves the diff with `git diff --name-only origin/main...HEAD`, filters each agent's file walk to that set. drift-gate, freshness-reviewer, and monitoring-reviewer ignore `flags.since` — confirmed in the §14 flag interaction rules.

### Example 12 — `--only=guest-ux-reviewer` without `--include-ux` → error

Input: `--app=guestpad --only=guest-ux-reviewer`

Output: throws `[pilot-review-flags] --only references UX reviewers (guest-ux-reviewer) but --include-ux was not set. Add --include-ux or drop the UX reviewer(s) from --only.`

### Example 13 — `--only=drift-gate --include-ux` (UX flag present, non-UX only)

Input: `--app=guestpad --only=drift-gate --include-ux`

Output:

```json
{
  "app": "guestpad",
  "skip": [],
  "only": ["drift-gate"],
  "includeUx": true,
  ...
}
```

Legal. `--include-ux` is a gate for UX reviewers to ENTER the roster; it does not mandate they be in `--only`. The orchestrator respects `--only`, runs drift-gate alone, reports UX reviewers as "not requested via --only" in SKIPPED AGENTS.

---

## Per-agent predicate helpers

The parser exports three small predicate helpers that consumers use instead of re-implementing the roster-filter logic. These are pure functions over a `Flags` object and a canonical `knownAgents` roster:

```ts
/**
 * True iff an agent should run given the flag-filtered roster.
 *   - If flags.only is non-empty, only those names run.
 *   - Else if the agent is in flags.skip, it does not run.
 *   - Else if the agent is a UX reviewer and !flags.includeUx, it does not run.
 *   - Else, it runs.
 * Does NOT consider rubric-missing state — that is rubric-check's job.
 */
export function includesAgent(
  agentName: string,
  flags: Flags,
  uxAgents: readonly string[],
): boolean;

/**
 * True iff the agent should scope its file-walk to the --since diff.
 *   - Returns false when flags.since is null.
 *   - Returns false for agents that explicitly ignore --since:
 *     drift-gate, freshness-reviewer, monitoring-reviewer.
 *   - Returns true otherwise (when a since ref exists and the agent is
 *     a code-analysis agent).
 */
export function respectsSince(agentName: string, flags: Flags): boolean;

/**
 * True iff eljun writes should be performed.
 *   - Returns false if flags.dryRun is true (§14: --dry-run suppresses eljun).
 *   - Returns false if flags.force is true (§14: forced runs are incomplete
 *     audits and MUST NOT file eljun tasks).
 *   - Returns true otherwise.
 *
 * Consumed by eljun-wiring module at §12 step 7 before any POST/PATCH call.
 */
export function shouldFileEljun(flags: Flags): boolean;
```

The UX roster (`uxAgents`) and the "ignores --since" list are hardcoded in the helpers because they are stable properties of each agent's DNA, not flag-derived. `drift-gate` is always full-scope; `freshness-reviewer` always queries the live npm/GHSA registries; `monitoring-reviewer` always scans the whole ops posture. Adding a new agent that respects `--since` only requires updating the hardcoded "ignores" list (inversion).

---

## Rule 13 / Intellectual Honesty Guardrails

This module is a nearly pure function. The Rule 13 failure modes we must actively avoid:

- **No silent coercion.** `--concurrency=3.5` must NOT be rounded to 3. The user's intent was unclear; ask them to clarify.
- **No unknown-flag absorption.** `--skip=frshness-reviewer` (typo) must NOT fall through to "freshness-reviewer" via fuzzy match. The "Did you mean" suggestion is a hint in the error message, not an implicit remap.
- **No default "all agents" when `--only` is empty AND invalid.** If `--only=zzz` fails validation, the run halts — we don't silently drop the invalid entry and proceed with "all agents" (which would look like `--only` worked).
- **No Playwright presence inference.** The probe checks for specific `package.json` files. A positive probe does NOT mean Playwright is healthy, browsers are installed, or the installation is current — only that a `@playwright/test` install exists. Do NOT add heuristics like "assume Playwright works if `playwright-report/` exists" — that creates a false positive.
- **No test weakening.** See §Testing: tests assert exact error messages and exact flag field values. Do NOT relax a test that fails because you changed the message wording — either update the test with the new canonical message, or revert the wording change.
- **No "helpful" post-hoc edits to `flags`.** Once the parser returns, the object is frozen. Downstream modules that need derived fields MUST compute them from `flags` on their own, not mutate `flags.skip` to append "derived-agent".

---

## Consumption points

### Consumed by: `.claude/commands/pilot-review.md` (the shim)

The shim imports and invokes the parser at Step 1 (see `cabin/.claude/commands/pilot-review.md` §Step 1 "Parse flags and validate"). Replace the existing prose description with:

```ts
import { parseFlags } from "halli-workflows/lib/orchestrator/flags";

const flags = parseFlags(argString, {
  repoRoot: detectedRepoRoot,
  knownAgents: [
    "drift-gate", "codebase-auditor", "isolation-reviewer",
    "auth-boundary-reviewer", "privacy-gdpr-reviewer", "payment-reviewer",
    "freshness-reviewer", "monitoring-reviewer",
    "owner-ux-reviewer", "guest-ux-reviewer",
  ],
  uxAgents: ["owner-ux-reviewer", "guest-ux-reviewer"],
});
```

The shim passes the frozen `flags` object into the orchestrator via the prompt. The shim does NOT re-validate anything — that is the parser's job.

### Consumed by: `halli-workflows:pilot-review-orchestrator`

Step 2 — Roster resolution:

```ts
const activeAgents = knownAgents.filter(
  (name) => includesAgent(name, flags, uxAgents),
);
```

Step 3 — Fan-out:

```ts
const rawFindings = await runSquad(activeAgents, flags.concurrency);
```

Per-agent prompt assembly (inside `runSquad` or prior to it):

```ts
const since = respectsSince(agent.name, flags) ? flags.since : null;
// inject `since` into the agent's file-walk if non-null
```

Step 7 — eljun filing (T1222/T1223):

```ts
if (shouldFileEljun(flags)) { ... }
```

Step 8 — PLAYWRIGHT_ABSENT emission:

```ts
if (flags.includeUx && !flags.playwrightAvailable) {
  findings.push(makePlaywrightAbsentFinding(flags));
}
```

---

## Testing Contract

The implementer MUST write unit tests covering these cases. Tests are pure function tests apart from the Playwright probe, which uses a temp-dir fixture. See `halli-workflows:skills/testing-principles` for structure.

| # | Case | Expected |
|---|------|----------|
| 1 | `parseFlags("", defaultEnv)` | all-defaults Flags object; `playwrightAvailable` reflects the fixture |
| 2 | `parseFlags("--app=guestpad", defaultEnv)` | `flags.app == "guestpad"`; all other fields default |
| 3 | `parseFlags("--app=", defaultEnv)` | throws with message `--app requires a non-empty value` |
| 4 | `parseFlags("--app", defaultEnv)` (no value) | throws with message `--app requires a non-empty value` |
| 5 | `parseFlags("--skip=freshness-reviewer --skip=codebase-auditor", defaultEnv)` | `flags.skip == ["freshness-reviewer", "codebase-auditor"]`; order preserved |
| 6 | `parseFlags("--only=isolation-reviewer", defaultEnv)` | `flags.only == ["isolation-reviewer"]`; `flags.skip == []` |
| 7 | `parseFlags("--skip=x --only=y", defaultEnv)` | throws with mutually-exclusive message; both lists shown in the error |
| 8 | `parseFlags("--dry-run", defaultEnv)` | `flags.dryRun === true`; all other booleans default |
| 9 | `parseFlags("--dry-run=true", defaultEnv)` | throws with `--dry-run does not take a value` |
| 10 | `parseFlags("--force --dry-run", defaultEnv)` | both booleans true; no error (valid combo per §14) |
| 11 | `parseFlags("--concurrency=3", defaultEnv)` | `flags.concurrency === 3` |
| 12 | `parseFlags("--concurrency=0", defaultEnv)` | throws with positive-integer message, value `0` included in message |
| 13 | `parseFlags("--concurrency=-3", defaultEnv)` | throws, value `-3` included |
| 14 | `parseFlags("--concurrency=3.5", defaultEnv)` | throws, value `3.5` included |
| 15 | `parseFlags("--concurrency=banana", defaultEnv)` | throws, value `banana` included |
| 16 | `parseFlags("--since=origin/main", defaultEnv)` | `flags.since === "origin/main"`; no validation of ref |
| 17 | `parseFlags("--include-ux", envWithPlaywright)` | `includeUx=true`, `playwrightAvailable=true` |
| 18 | `parseFlags("--include-ux", envWithoutPlaywright)` | `includeUx=true`, `playwrightAvailable=false`; NO throw (orchestrator emits finding) |
| 19 | `parseFlags("", envWithPlaywright)` | `includeUx=false`, `playwrightAvailable=true` (field still populated even when flag absent) |
| 20 | `parseFlags("--only=guest-ux-reviewer", envWithoutIncludeUx)` | throws with UX-without-include-ux message |
| 21 | `parseFlags("--only=guest-ux-reviewer --include-ux", anyEnv)` | legal; `only=["guest-ux-reviewer"]`, `includeUx=true` |
| 22 | `parseFlags("--skip=guest-ux-reviewer", anyEnv)` | legal — skipping a UX reviewer without `--include-ux` is a harmless no-op |
| 23 | `parseFlags("--foo=bar", defaultEnv)` | throws with registry-dump message; exit code 1 semantics |
| 24 | `parseFlags("--skip=frshness", defaultEnv)` | throws with `Unknown agent in --skip: "frshness"`; "Did you mean freshness-reviewer?" suggestion appears if Levenshtein ≤ 2 |
| 25 | `parseFlags("--scaffold-rubrics", defaultEnv)` | `scaffoldRubrics=true`; all other fields default |
| 26 | `parseFlags("--scaffold-rubrics --app=guestpad", defaultEnv)` | throws with mutually-exclusive-with-everything-except-output-format message |
| 27 | `parseFlags("--scaffold-rubrics --output-format=json", defaultEnv)` | legal; `scaffoldRubrics=true`, `outputFormat="json"` |
| 28 | `parseFlags("--commit-artifacts", defaultEnv)` | `commitArtifacts=true` |
| 29 | `parseFlags("--output-format=json", defaultEnv)` | `outputFormat=="json"` |
| 30 | `parseFlags("--output-format=yaml", defaultEnv)` | throws with enum-rejection message |
| 31 | `parseFlags("--output-format=", defaultEnv)` | throws with empty-value message |
| 32 | `parseFlags("--app=guestpad --app=aurora-hunter", defaultEnv)` | throws with repeatability message (`--app` is not repeatable) |
| 33 | `parseFlags("--dry-run --dry-run", defaultEnv)` | throws with repeatability message |
| 34 | Returned `flags` is frozen | `Object.isFrozen(flags) === true`; mutation throws in strict mode |
| 35 | `parseFlags("  --app=guestpad   --dry-run  ", defaultEnv)` | tokenizer handles extra whitespace; output is correct |
| 36 | `includesAgent("isolation-reviewer", {only: ["isolation-reviewer"], ...}, uxAgents)` | true |
| 37 | `includesAgent("freshness-reviewer", {only: ["isolation-reviewer"], ...}, uxAgents)` | false |
| 38 | `includesAgent("owner-ux-reviewer", {includeUx: false, ...}, uxAgents)` | false |
| 39 | `includesAgent("owner-ux-reviewer", {includeUx: true, skip: [], only: [], ...}, uxAgents)` | true |
| 40 | `respectsSince("drift-gate", {since: "origin/main", ...})` | false (drift-gate ignores since) |
| 41 | `respectsSince("freshness-reviewer", {since: "origin/main", ...})` | false |
| 42 | `respectsSince("monitoring-reviewer", {since: "origin/main", ...})` | false |
| 43 | `respectsSince("isolation-reviewer", {since: "origin/main", ...})` | true |
| 44 | `respectsSince("isolation-reviewer", {since: null, ...})` | false (no ref → full scope) |
| 45 | `shouldFileEljun({dryRun: true, force: false, ...})` | false |
| 46 | `shouldFileEljun({dryRun: false, force: true, ...})` | false |
| 47 | `shouldFileEljun({dryRun: false, force: false, ...})` | true |
| 48 | Two runs with identical `argString` and `env` | byte-identical `flags` objects (tests JSON.stringify equality) |

### Integration tests (cross-module)

These verify the parser's contract is honored end-to-end. The shim fixture runs against a temp cabin-style repo.

1. `/pilot-review --app=guestpad --skip=freshness-reviewer --dry-run` runs with freshness-reviewer omitted and performs zero eljun writes (tested by counting `GET`/`POST` calls to the eljun MCP in a mock).
2. `/pilot-review --only=isolation-reviewer` — dashboard SKIPPED AGENTS section lists the other seven agents with reason "not requested via --only".
3. `/pilot-review --scaffold-rubrics` in a directory without rubrics — creates 3 review-rubric + 2 ux-rubric stubs and exits; no dashboard written; no orchestrator fan-out.
4. `/pilot-review --include-ux` in a cabin-like repo without Playwright — dashboard shows P0 PLAYWRIGHT_ABSENT finding under BLOCKERS, run continues for the 8 non-UX agents.
5. `/pilot-review --since=origin/main` — drift-gate still full-scopes (recorded by inspecting the agent's prompt capture), code-analysis agents scope their walk.

---

## Out of scope (explicit list)

- **Flag persistence / config files.** Phase 1 does NOT read a `.claude/pilot-review.config.json` or similar. Every invocation re-parses from scratch. Phase 2 may introduce config files — but the parser would remain the authoritative parser; config values would simply pre-populate `argString` before the parse call.
- **Per-agent concurrency caps beyond `--concurrency`.** §13 sets one global semaphore (5 by default). Per-agent overrides (e.g. "freshness-reviewer runs alone because it's CPU-bound") are a Phase 2 enhancement.
- **Multi-app runs in one invocation.** §14: "/pilot-review runs from the target repo root — it does NOT orchestrate across multiple repos in one run." The parser ships one `app` field; iterating across `apps/*` when `--app` is null is the orchestrator's job, not the parser's.
- **Git ref validation.** `--since=<ref>` is accepted as an opaque string. The per-agent prompt builder runs `git diff --name-only <ref>...HEAD` at fan-out time; a bad ref fails there and surfaces as a `REVIEWER_CRASHED` P3.
- **Slug → directory mapping.** `--app=guestpad` is accepted as a literal string. Mapping to `apps/guestpad/` is the shim's job (cabin's shim does it in Step 2). The parser does not assume any directory structure.
- **Playwright browser-install check.** The probe checks only for an installed `@playwright/test` or `playwright` package. Whether `npx playwright install` has been run is the UX reviewers' runtime concern.
- **Environment-variable flag injection.** Flags come only from `$ARGUMENTS`. Reading `PILOT_REVIEW_CONCURRENCY` from `process.env` would be a hidden input path and a Rule 13 hazard. Users wanting defaults should alias the command.
- **Flag aliases.** `--skip=freshness` is NOT aliased to `--skip=freshness-reviewer`. The canonical kebab-case agent name is the only accepted form. An alias map would be a user-experience convenience that invites Rule 13 drift (what does `freshness` mean? the reviewer? the rubric? the check type?).
- **Case-insensitive matching.** `--SKIP=freshness-reviewer` is rejected as an unknown flag. The flag registry is case-sensitive. `--skip=Freshness-Reviewer` is rejected as an unknown agent. The pilot-review contract is lowercase-kebab-case throughout.

---

## Edge cases and invariants

1. **Empty `argString`.** `parseFlags("", env)` returns the all-defaults Flags object with `playwrightAvailable` populated from the probe. No tokens → no validation loop → no errors possible (except a broken probe, which propagates).
2. **Whitespace-only `argString`.** Treated the same as empty. `parseFlags("   \t\n  ", env)` === `parseFlags("", env)`.
3. **Duplicate repeatable values.** `--skip=freshness-reviewer --skip=freshness-reviewer` is legal; the array contains the name twice. The orchestrator's roster-filter uses set semantics (`indexOf !== -1`), so duplicates are harmless but visible in `flags.skip` for audit. Do NOT dedupe in the parser — that would mask genuine user error.
4. **`--skip` with the entire roster.** `--skip=drift-gate --skip=codebase-auditor ... --skip=monitoring-reviewer` (all eight non-UX agents). Parser accepts; orchestrator's roster filter produces an empty `activeAgents`; dashboard is an empty run with all SKIPPED AGENTS reported. The parser does NOT emit "why bother?" warnings — empty runs are legal.
5. **`--only` with one agent that is later rubric-missing.** Parser accepts `--only=privacy-gdpr-reviewer`; rubric-check (T1215) detects missing rubric, emits P0 RUBRIC_MISSING, orchestrator halts (or continues under `--force`). Parser does NOT care about rubric presence.
6. **Token order does not matter for non-repeatable flags.** `--dry-run --app=guestpad` is equivalent to `--app=guestpad --dry-run`. Assertion: `parseFlags(a, env)` === `parseFlags(permute(a), env)` for any permutation of tokens that keeps repeatable-flag relative order stable.
7. **Token order DOES matter for repeatable flags.** `flags.skip` preserves the order the user typed. This is an audit feature — if an agent is listed last in `--skip`, the dashboard can surface "added to skip late" in debug output. Downstream consumers use set semantics, so ordering is invisible at the roster-filter layer; but the raw order is retained for transparency.
8. **`--force` without `--dry-run`.** Legal (no combination check). Per §14, `--force` alone suppresses eljun filing regardless. Example: the user is running a first-time review, knows the payment rubric is missing, passes `--force` to see the rest. The dashboard is actionable; eljun stays untouched.
9. **`--commit-artifacts` without `--app`.** Legal. Artifacts for whichever app gets reviewed (or all apps if the orchestrator iterates) are committable.
10. **Re-entrance.** The parser is stateless. Calling it concurrently on two input strings produces two independent Flags objects; no shared mutable state.
11. **Probe determinism on the same filesystem.** `detectPlaywright` over the same `repoRoot` with the same filesystem state produces the same result. It does NOT cache — callers invoke once per `parseFlags` call, which is once per pilot-review run.
12. **UTF-8 in `argString`.** Tokens are ASCII-only in practice (kebab-case + paths). Non-ASCII characters in a token (e.g. a path with a smart quote) are not specially handled — the unknown-flag validator sees them as unrecognized tokens and throws. This is correct behavior.
13. **Windows line endings in `argString`.** Tokenizer splits on `/\s+/` which includes `\r\n`. No special handling needed.

---

## References

- Design Doc: `docs/design/pilot-review-system-design.md`
  - §3 System Architecture (agent roster for the `knownAgents` / `uxAgents` defaults)
  - §11 Dashboard Format (SKIPPED AGENTS section, FLAGS metadata row)
  - §12 Orchestration Flow step 2 (where flag-filtered roster is computed — lines 1173-1183)
  - §13 Concurrency and Retry Strategy (default `concurrency=5`, line 1239)
  - §14 Scoping Flags (AUTHORITATIVE — flag registry + interaction rules — lines 1288-1364)
  - §15 Phase 1 vs Phase 2 Boundary (UX reviewers gated by `--include-ux`)
  - §22 Appendix B (Orchestrator Pseudocode referencing flag consumption — line 860 `--force`, line 852 `--scaffold-rubrics`, line 1710 scaffold command)
- Canonical contracts:
  - `halli-workflows:types/finding.md` — §agent enum (the roster), §heuristic_id rules (PLAYWRIGHT_ABSENT is a valid uppercase reserved form)
  - `halli-workflows:types/location-key.md` §5 `mon:` grammar (for PLAYWRIGHT_ABSENT location_key)
- Sibling orchestrator modules:
  - `halli-workflows:commands/pilot-review-orchestrator` — consumes `Flags` at steps 2, 3, 7, 8
  - `halli-workflows:commands/pilot-review/rubric-check` — consumes `flags.force` at the halt decision
  - `halli-workflows:commands/pilot-review/eljun-wiring` — consumes `flags.dryRun` and `flags.force` via `shouldFileEljun`
  - `halli-workflows:commands/pilot-review/backlog-appender` — consumes `flags.dryRun`
- Shim: `cabin/.claude/commands/pilot-review.md` §Step 1 (the current prose replaced by `parseFlags` invocation)
- Rule 13 framing: root CLAUDE.md §Rule 13 (intellectual honesty — silent flag absorption would violate this)
- Testing guidance: `halli-workflows:skills/testing-principles` (Arrange-Act-Assert, naming convention "should ... when ...")

## Phase boundary reminder (for future implementers)

- **Phase 1 (this module)**: 11 flags, manual switch parser, Levenshtein suggestion, Playwright probe. Fail-loud on every unknown or invalid input. No config-file input.
- **Phase 2 (deferred — DO NOT IMPLEMENT HERE)**: config-file pre-population (`.claude/pilot-review.config.json` merged into `argString` defaults), per-agent concurrency overrides, optional flag aliases via an explicit allow-list. The parser's signature remains the same — Phase 2 changes the `argString` that reaches the parser, not the parser itself.
