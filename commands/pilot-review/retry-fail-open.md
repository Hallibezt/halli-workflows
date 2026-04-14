---
name: pilot-review/retry-fail-open
description: Orchestrator sub-module — wraps each reviewer-agent invocation with a single 5s retry and fail-open semantics. Transient errors (network/429/5xx) or malformed output (fails Zod Finding validation) trigger one retry. Persistent failure after retry, or `status: blocked` from the agent, emits one synthetic P3 `REVIEWER_CRASHED` finding and lets the rest of the run continue — NEVER halts the whole run. Per-agent wall-clock ceiling default 5 minutes, overridable via `PILOT_REVIEW_AGENT_TIMEOUT` (seconds). The same wrapper is reused for the `/verify-claims` post-pass, which emits `VERIFICATION_UNAVAILABLE` instead of `REVIEWER_CRASHED` on persistent failure.
---

**Module Context**: Orchestration sub-module of `halli-workflows:pilot-review-orchestrator`. Not a standalone command. Invoked from inside the semaphore pump (T1225) — every `runAgent(agent)` call in Design Doc §13 "Semaphore implementation" is replaced with `runAgentWithRetry(agent)` defined here. The crash-finding it produces is routed through the normal pipeline: dedup (T1216) leaves it alone (it has a unique `location_key` per crash), `/verify-claims` (T1217) exempts it (orchestrator-emitted operational finding), dashboard (T1219) renders it in "SKIPPED AGENTS", p3-notes-aggregator (T1221) sections it under "Reviewer Crashes".

**Placement rationale**: halli-workflows is a pure-markdown plugin (no TypeScript build — see `halli-workflows:types/README.md`). Each orchestration pipeline stage is a specification document the orchestrator's inlined implementation follows. This module is referenced but NOT registered as a slash-command in `plugin.json`. Per the T1226 invocation brief: **do NOT edit the orchestrator or bump plugin.json in this task** — integration is the orchestrator's responsibility in a follow-up task.

**Depends on**: `halli-workflows:types/finding.md` (canonical Finding schema — the synthetic crash finding must validate), `halli-workflows:types/location-key.md` (the `mon:` grammar for the crash key), `halli-workflows:commands/pilot-review/semaphore` (T1225 — caller; this module replaces its inner `runAgent` with the retrying variant), `halli-workflows:commands/pilot-review/p3-notes-aggregator` (T1221 — downstream consumer of `REVIEWER_CRASHED` / `VERIFICATION_UNAVAILABLE` keyed findings), and Design Doc §13 Q2 / Q3 (authoritative source of policy).

---

## 1. Purpose

A single reviewer crash MUST NOT halt a ten-agent run. The user still needs the other nine reviewers' findings; halting the whole run on one transient API hiccup is bad UX and punishes the user for our infrastructure's flakiness. Per Design Doc §13 Q2 (confirmed in ADR-0014 §Open Items Q2):

> **Fail-open with P3 `REVIEWER_CRASHED` note.** Failing the whole run on one agent crash is a bad experience — the user still wants the other 9 agents' output. Failing closed with P0 would spam the dashboard with non-actionable noise. Fail-open with a P3 note surfaces the crash visibly (the dashboard "Skipped Agents" section will show "X — crashed, see notes") without halting the run.

And the retry rule (§13 Q2, second paragraph):

> - Transient errors (network, 429, 500): retry once after 5s backoff.
> - Persistent errors (auth, malformed output after retry): emit `REVIEWER_CRASHED` P3 and continue.

The same policy applies to the `/verify-claims` post-pass (§13 Q3) with a different heuristic_id:

> If the verifier itself fails, emit a P3 `VERIFICATION_UNAVAILABLE` note and let the findings pass through without verification.

This module codifies both policies in one reusable wrapper so the retry and fail-open logic live in exactly one place.

### Rule 13 framing (intellectual honesty)

Silently swallowing a crash — catching the error and returning `[]` — would hide the degradation from the user. The user would see "9 agents ran, all clean" when in reality one agent never produced output. That is a Rule 13 violation ("making it look like it works"). Every crash MUST produce a visible, structurally-typed finding. The P3 severity makes it non-blocking; the `heuristic_id: "REVIEWER_CRASHED"` makes it categorizable; the `agent: "orchestrator"` makes the attribution honest (the orchestrator — not the crashed reviewer — is emitting this finding).

---

## 2. Contract

### Signature

```ts
export async function runAgentWithRetry(
  agent: AgentDescriptor,
  ctx: RetryContext,
): Promise<Finding[]>;
```

- **Input**: an `AgentDescriptor` (the same shape the semaphore consumes — `{ name: string; invoke: () => Promise<unknown> }`) and a `RetryContext` (environment + config; see §3).
- **Output**: `Finding[]`. On success, the findings returned by the agent (validated, length ≥ 0). On persistent failure, an array of length 1 containing the synthetic `REVIEWER_CRASHED` finding.
- **Never throws**. The whole point is fail-open: the caller (the semaphore) does not need a surrounding try/catch for reviewer-originated failures. Crashes are converted into findings, not propagated as rejected promises. (The semaphore in T1225 still has its own outer catch as a belt-and-suspenders defense — see §9 interaction.)

### RetryContext

```ts
interface RetryContext {
  timeoutMs: number;       // per-attempt wall clock ceiling; see §4
  retryDelayMs: number;    // backoff before the single retry; default 5000
  ruleLink: string;        // rule_link to embed in the synthetic crash finding — see §5
  heuristicId: "REVIEWER_CRASHED" | "VERIFICATION_UNAVAILABLE";
                           // which operational category; distinguishes reviewer crashes from
                           // verifier failures. Only two values are permitted in Phase 1.
  validateFindings: (raw: unknown) => Finding[];
                           // Zod Finding[] validator — the orchestrator's T1200-wired schema.
                           // MUST throw on validation failure; thrown errors are treated as
                           // "malformed output" per §4 classifier.
}
```

The `validateFindings` callback is injected (not imported) so this module stays decoupled from the project-local Zod instance. Any function that returns `Finding[]` on success and throws on malformed input satisfies the contract.

### Side effects

- None on the filesystem. This module does not read, write, or delete files.
- Logs each retry attempt and each crash to `stderr` (one line per event, see §6). Stderr writes are considered observability, not state change; `--dry-run` does NOT suppress them.
- Does not mutate the `agent` or `ctx` arguments.

---

## 3. Defaults and overrides

| Parameter | Default | Override mechanism |
|-----------|---------|-------------------|
| `timeoutMs` | 300_000 (5 minutes) | Env var `PILOT_REVIEW_AGENT_TIMEOUT` in **seconds** (converted to ms by the orchestrator before passing to this module). Invalid / non-numeric values → fall back to default and log stderr warning. |
| `retryDelayMs` | 5000 | Env var `PILOT_REVIEW_RETRY_DELAY` in **seconds** (rarely needed — the 5s value is the Design Doc §13 recommendation and should not drift without cause). Same validation semantics. |
| `ruleLink` | `"docs/adr/ADR-0014-pilot-review-orchestration.md#consequences"` | Supplied by the orchestrator. The default heading exists at ADR-0014 (verified at author time). If the orchestrator overrides it for a future ADR, the new heading MUST resolve to avoid the rule-link validator (T1218) demoting the finding further. |
| `heuristicId` | `"REVIEWER_CRASHED"` (reviewer wrapper) or `"VERIFICATION_UNAVAILABLE"` (verifier wrapper) | Selected by the caller — reviewer fan-out passes the former; the verify-claims pass passes the latter. |

Rule 13 note: env var parsing is defensive — a malformed `PILOT_REVIEW_AGENT_TIMEOUT=abc` MUST NOT silently yield `NaN` ms (which would cause immediate timeout and spurious crashes). Fall back to the 5-minute default and log the misparse.

---

## 4. Behavior

```
runAgentWithRetry(agent, ctx):

  # Attempt 1
  try:
    raw = await invokeWithTimeout(agent.invoke, ctx.timeoutMs)
    findings = ctx.validateFindings(raw)
    return findings                                 # SUCCESS path — no retry

  catch err1:
    category1 = classify(err1, raw_if_present)
    log_stderr("retry-fail-open: agent=" + agent.name +
               " attempt=1 category=" + category1 +
               " error=" + sanitize(err1) +
               " retrying_after=" + ctx.retryDelayMs + "ms")

  # Single 5s backoff
  await sleep(ctx.retryDelayMs)

  # Attempt 2 — the only retry
  try:
    raw = await invokeWithTimeout(agent.invoke, ctx.timeoutMs)
    findings = ctx.validateFindings(raw)
    log_stderr("retry-fail-open: agent=" + agent.name +
               " attempt=2 result=success findings=" + findings.length)
    return findings                                 # SUCCESS after retry

  catch err2:
    category2 = classify(err2, raw_if_present)
    log_stderr("retry-fail-open: agent=" + agent.name +
               " attempt=2 category=" + category2 +
               " error=" + sanitize(err2) +
               " result=fail-open emitting=" + ctx.heuristicId)
    return [ makeCrashFinding(agent, err2, ctx) ]   # FAIL-OPEN path
```

### 4.1 Error classifier

```
classify(err, raw?):
  if err is TimeoutError:                 return "timeout"
  if err is NetworkError:                 return "network"         # DNS, socket, connection reset
  if err.http_status in {429, 500..599}:  return "transient_http"
  if err.http_status in {401, 403}:       return "auth"
  if err is ZodValidationError:           return "malformed_output"
  if err.status === "blocked":            return "agent_blocked"
  return "unknown"
```

All categories trigger exactly ONE retry. Per §13 the retry policy is simple: "retry once after 5s backoff." There is no category-specific decision — malformed output gets the same single retry as network flakes (the retry prompt may be enriched per §4.2, but the retry count is still 1).

Rationale for one-size-fits-all: the Design Doc intentionally keeps retry logic minimal in Phase 1 to avoid the sunk-cost-of-complexity trap. Exponential backoff, category-specific retry counts, and circuit breakers are explicitly Out of Scope (§10). We can revisit if observed crash rates warrant it.

### 4.2 Malformed-output retry nudge (optional — recommended)

When `classify(err1) === "malformed_output"`, the retry attempt MAY include a short reminder prepended to the agent's prompt, per the T1226 task brief:

> Malformed agent output (fails Zod Finding validation) → retry once with prompt reminder

The reminder is a single additional line appended to the agent invocation's system prompt:

```
NOTE: Your previous response did not match the canonical Finding schema
at halli-workflows:types/finding.md. Return ONLY a JSON array of Finding
objects with exactly the 10 required fields. Do not include prose,
markdown, or extra fields.
```

This nudge is best-effort — it does NOT count as a second retry. If the agent's second attempt is also malformed, the fail-open path triggers immediately. The orchestrator decides whether to inject the nudge (it has visibility into `agent.invoke`'s prompt assembly); this module returns `category1` so the orchestrator can condition on it.

### 4.3 `agent_blocked` handling

An agent may return `status: "blocked"` as its own fail-safe (the orchestrator-side task skill uses this to signal "I refuse to proceed"). Per the T1226 brief:

> Agent reports `status: blocked` → treat as crash (P3 note) — do NOT halt run

The classifier returns `"agent_blocked"` and the wrapper proceeds identically to any other error: one retry, then fail-open with a `REVIEWER_CRASHED` finding. The error message in the finding's `evidence` field names the block reason (the agent's returned `blockReason` string) so the reader can investigate.

Rationale: treating `blocked` as crash-equivalent prevents the worst-case outcome where one agent voluntarily refusing to run silently drops its coverage from the report. The user sees a visible P3 in the dashboard and decides whether to re-run.

### 4.4 `invokeWithTimeout` helper

```
async function invokeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`agent invocation exceeded ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([fn(), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

The timer is always cleared in `finally` to prevent unref'd-timer leaks that would keep the Node process alive past the orchestrator's exit (noticeable pain in test runs that accumulate thousands of invocations).

---

## 5. Synthetic crash finding

The finding emitted on fail-open MUST satisfy the canonical `Finding` schema (`halli-workflows:types/finding.md`). Shape:

```json
{
  "agent": "orchestrator",
  "severity": "P3",
  "rule_link": "docs/adr/ADR-0014-pilot-review-orchestration.md#consequences",
  "verdict": "uncertain",
  "evidence": "Agent <agent-name> crashed after 2 attempts (category: <category>): <error-excerpt>",
  "location_key": "mon:<agent-name>:REVIEWER_CRASHED",
  "heuristic_id": "REVIEWER_CRASHED",
  "suggested_fix": "Retry the run, or check plugin logs for <agent-name>. If the failure reproduces, open a bug.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

### Field-by-field justification

| Field | Value | Why |
|-------|-------|-----|
| `agent` | `"orchestrator"` | The orchestrator is emitting this finding, not the crashed reviewer. The crashed agent name appears in `location_key` and `evidence` — attributing a finding to an agent that never successfully emitted anything would be Rule 13 dishonesty. |
| `severity` | `"P3"` | Per §13 Q2: fail-open with P3. P3 = "notes", routed to `review-notes.md`, NOT filed to eljun and NOT appended to backlog. |
| `rule_link` | `"docs/adr/ADR-0014-pilot-review-orchestration.md#consequences"` | ADR-0014 exists and has a `## Consequences` heading — verified at author time. Rule 13: a plausible-looking rule_link that 404s is worse than a real one. |
| `verdict` | `"uncertain"` | The orchestrator cannot make a judgment call about the code on behalf of a crashed agent. `uncertain` is the canonical verdict when the observer cannot decide. |
| `evidence` | `"Agent <agent-name> crashed after 2 attempts (category: <category>): <error-excerpt>"` | Evidence field minimum length is 10 chars (types/finding.md §validation rule 6); this template is always ≥ 10. The error excerpt is sanitized per §7 — truncated to 500 chars, secrets scrubbed. |
| `location_key` | `"mon:<agent-name>:REVIEWER_CRASHED"` | `mon:` grammar (types/location-key.md §mon): `mon:{service}:{gap_id}`. Agent name is the "service" (kebab-case, matches agent-name regex), `REVIEWER_CRASHED` is the "gap_id". This is the canonical grammar for operational/monitoring gaps and is what p3-notes-aggregator's drift-check section matcher (`/^mon:drift-gate:/`) mirrors. Uniqueness: each agent crashes at most once per run, so `mon:<agent>:REVIEWER_CRASHED` is already unique across the run without needing a hash suffix. |
| `heuristic_id` | `"REVIEWER_CRASHED"` | Uppercase literal. Matches the section matcher in p3-notes-aggregator (`heuristic_id === "REVIEWER_CRASHED"`) and is listed in the "meta heuristics never promoted" allow-list there. |
| `suggested_fix` | `"Retry the run, or check plugin logs for <agent-name>. ..."` | Actionable but low-effort — the user can re-run `/pilot-review` to see if the crash was transient. |
| `screenshot` | `null` | No artifact — this is an operational signal, not a UX finding. |
| `witnesses` | `["orchestrator"]` | The orchestrator is the sole witness (by construction: the reviewer itself never produced output). Matches the pattern in types/finding.md §"Rubric-missing fail-loud" example. |

### When `heuristicId === "VERIFICATION_UNAVAILABLE"`

The same template is used with three substitutions, matching the spec already documented in `verify-claims-pass.md` §"Verifier failure":

| Field | Value on verifier failure |
|-------|---------------------------|
| `location_key` | `"orchestrator:verify-claims-pass:verifier-unavailable"` (this is a legacy key already in use by verify-claims-pass.md; this wrapper uses that exact key for consistency with the existing module rather than building a new `mon:`-prefixed one) |
| `heuristic_id` | `"VERIFICATION_UNAVAILABLE"` |
| `evidence` | `"halli-workflows:ground-truth-verifier invocation failed: <error summary>. Findings passed through without verification this run."` |
| `suggested_fix` | `"Re-run /pilot-review when the issue is resolved. Check the Anthropic API status and retry."` |

Rule 13 note on the `location_key`: the verify-claims-pass module already specifies this literal string, and changing it here would create drift between two spec files for the same finding. The `mon:` grammar in `types/location-key.md` would arguably be cleaner (`mon:verify-claims:verifier-unavailable`), but touching that key is scope creep for T1226 and risks breaking the p3-notes-aggregator's existing routing table. Deferred: align both specs to the `mon:` grammar in a dedicated follow-up task (see §10 Out of Scope).

### Finding reference implementation

```ts
function makeCrashFinding(
  agent: AgentDescriptor,
  err: Error,
  ctx: RetryContext,
): Finding {
  const excerpt = sanitizeError(err).slice(0, 500)
  const category = classify(err)
  const name = agent.name

  if (ctx.heuristicId === "REVIEWER_CRASHED") {
    return {
      agent: "orchestrator",
      severity: "P3",
      rule_link: ctx.ruleLink,
      verdict: "uncertain",
      evidence: `Agent ${name} crashed after 2 attempts (category: ${category}): ${excerpt}`,
      location_key: `mon:${name}:REVIEWER_CRASHED`,
      heuristic_id: "REVIEWER_CRASHED",
      suggested_fix: `Retry the run, or check plugin logs for ${name}. If the failure reproduces, open a bug.`,
      screenshot: null,
      witnesses: ["orchestrator"],
    }
  }

  // VERIFICATION_UNAVAILABLE branch
  return {
    agent: "orchestrator",
    severity: "P3",
    rule_link: ctx.ruleLink,
    verdict: "uncertain",
    evidence: `halli-workflows:ground-truth-verifier invocation failed: ${excerpt}. Findings passed through without verification this run.`,
    location_key: "orchestrator:verify-claims-pass:verifier-unavailable",
    heuristic_id: "VERIFICATION_UNAVAILABLE",
    suggested_fix: "Re-run /pilot-review when the issue is resolved. Check the Anthropic API status and retry.",
    screenshot: null,
    witnesses: ["orchestrator"],
  }
}
```

Before returning, run the synthetic finding through `ctx.validateFindings([synthetic])`. If the Zod schema rejects the synthetic crash finding, the orchestrator has a contract bug — fail LOUD with an explicit error ("synthetic crash finding failed self-validation; this is an orchestrator bug, not a reviewer bug") rather than quietly returning an invalid finding that the aggregation pipeline will then reject at a later step and potentially drop. This self-check is defense-in-depth: it catches "I updated the Finding schema and forgot to update makeCrashFinding" regressions at their source.

---

## 6. Logging

One line per retry or crash event. Keys are space-separated so logs parse with standard shell tools (`awk '$2 == "agent=foo"'`). No JSON — keeps logs grep-friendly for terminal use.

```
retry-fail-open: agent=<name> attempt=<n> category=<c> error=<excerpt> retrying_after=<ms>ms
retry-fail-open: agent=<name> attempt=<n> result=success findings=<count>
retry-fail-open: agent=<name> attempt=<n> category=<c> error=<excerpt> result=fail-open emitting=<heuristic_id>
```

The `error` field is the sanitized excerpt (see §7) — single-line, quote-escaped, ≤ 200 chars in log output (shorter than the 500-char limit in the finding's evidence field, because log scannability matters more than log completeness).

---

## 7. Error sanitization

Before embedding error text in a finding's `evidence` field or a log line, sanitize:

1. Truncate to 500 chars (evidence) or 200 chars (log). Rationale: a full stack trace can be kilobytes and pollute both the dashboard and terminal output.
2. Collapse whitespace — all runs of whitespace (including newlines) collapse to single spaces. Markdown renders multi-line strings oddly in table cells and the dashboard uses findings in `## MUST-FIX (P1)` list items.
3. Scrub strings that look like secrets: any substring matching `/(api[_-]?key|bearer|token|secret|password)\s*[:=]\s*\S+/i` → replace with `<redacted>`. This is a defensive last-line scrub; the orchestrator's outer layer should already be scrubbing Authorization headers, but the reviewer's error text could contain leaked keys from, e.g., a bad 429 response body that echoed the request header. Rule 13: silent secret leakage in a markdown dashboard is a Rule 13 violation; a visible `<redacted>` is not.
4. Strip absolute paths that could leak user home directory. Any substring matching `/\/home\/[a-zA-Z0-9_-]+\//` → replace with `~/`. This is consistent with `halli-workflows:types/location-key.md` §stability-rule-4 (paths must be repo-relative).

Reference implementation:

```ts
function sanitizeError(err: Error): string {
  const raw = err.message ?? String(err)
  const collapsed = raw.replace(/\s+/g, " ").trim()
  const secretScrubbed = collapsed.replace(
    /(api[_-]?key|bearer|token|secret|password)\s*[:=]\s*\S+/gi,
    "$1=<redacted>",
  )
  const pathScrubbed = secretScrubbed.replace(/\/home\/[a-zA-Z0-9_-]+\//g, "~/")
  return pathScrubbed
}
```

---

## 8. Interaction with the semaphore (T1225)

The semaphore in Design Doc §13 already has a catch block:

```ts
const task = runAgent(agent)
  .then(findings => { results.push(findings); })
  .catch(err => {
    results.push([makeCrashFinding(agent, err)]);
  })
```

When `runAgent(agent)` is replaced with `runAgentWithRetry(agent, ctx)`:

1. `runAgentWithRetry` catches its own errors internally and returns a crash finding — it NEVER throws on reviewer-originated failures.
2. The semaphore's outer `.catch` block is therefore almost never reached for reviewer failures. It remains as a safety net for programmer errors (e.g. a typo in `runAgentWithRetry` itself that causes a ReferenceError) — those should still crash-and-file rather than taking down the run. The outer catch's `makeCrashFinding` fallback is kept.
3. This is belt-and-suspenders per Rule 13: one layer (the retry wrapper) is the primary; the other (the semaphore catch) is the last resort. Neither is redundant.

Wiring pseudocode at the orchestrator seam (T1225's integration point):

```ts
// Before (pure T1225):
const task = runAgent(agent)
  .then(findings => { results.push(findings); })
  .catch(err => { results.push([makeCrashFinding(agent, err)]); })

// After (T1225 + T1226):
const ctx: RetryContext = {
  timeoutMs: parseTimeoutMs(process.env.PILOT_REVIEW_AGENT_TIMEOUT),
  retryDelayMs: parseRetryDelayMs(process.env.PILOT_REVIEW_RETRY_DELAY),
  ruleLink: "docs/adr/ADR-0014-pilot-review-orchestration.md#consequences",
  heuristicId: "REVIEWER_CRASHED",
  validateFindings: validateFindingArray, // Zod-wrapped, throws on bad
}
const task = runAgentWithRetry(agent, ctx)
  .then(findings => { results.push(findings); })
  .catch(err => {
    // Only reached on programmer error inside runAgentWithRetry itself.
    // Emit a fallback crash finding so the run still completes.
    results.push([makeCrashFinding(agent, err, ctx)])
  })
```

The `heuristicId` is the only difference between the reviewer-wrapper and the verifier-wrapper. The verifier-pass invokes `runAgentWithRetry` with `heuristicId: "VERIFICATION_UNAVAILABLE"` per §5.

---

## 9. Downstream expectations

The synthetic finding flows through the same pipeline as every other finding:

| Stage | Behavior on REVIEWER_CRASHED / VERIFICATION_UNAVAILABLE |
|-------|----------------------------------------------------------|
| `dedup-pass` (T1216) | `location_key` is unique per agent per run → no merge. Passes through unchanged. |
| `verify-claims-pass` (T1217) | `agent === "orchestrator"` → EXEMPT per existing exemption list (orchestrator-emitted findings). No re-verification. |
| `rule-link-validator-pass` (T1218) | `rule_link` MUST resolve. ADR-0014 `#consequences` exists at author time; if future edits rename that heading, the finding is demoted one tier (irrelevant — already P3). |
| `dashboard-generator` (T1219) | Renders under `## REVIEW NOTES (P3)` with a truncated evidence string. The `## SKIPPED AGENTS` section ALSO renders a per-agent line ("<agent-name> — crashed, see notes") driven by a parallel channel the orchestrator maintains alongside the finding (see §9.1). |
| `p3-notes-aggregator` (T1221) | Section-matcher routes to "Reviewer Crashes" (`heuristic_id === "REVIEWER_CRASHED"`) or "Verifier Unavailable" (`heuristic_id === "VERIFICATION_UNAVAILABLE"`). Full evidence rendered with no truncation. |
| `eljun-client` (T1222) | P3 → NOT filed. Rule 13: we do NOT auto-file reviewer crashes to eljun because the action is "re-run the command", not "human investigates a code issue". |
| `backlog-appender` (T1223) | P3 → NOT appended. Same rationale as eljun. |

### 9.1 Dashboard "SKIPPED AGENTS" channel

The dashboard (T1219) reads `skippedAgents: string[]` as a first-class input alongside `findings`. The orchestrator maintains this list across TWO conditions:

1. **Rubric-missing**: rubric-check (T1215) already populates it.
2. **Crashed-reviewer**: THIS module's callers append the crashed `agent.name` to the list BEFORE handing it to the dashboard generator.

Both conditions render in the same section. The dashboard does NOT derive this list from findings (that would re-couple the crash detection logic to the specific `heuristic_id` string, and future operational heuristics would silently lose their SKIPPED AGENTS representation).

Integration seam (orchestrator responsibility):

```ts
const squadFindings = await runSquad(roster, flags.concurrency || 5)

// Derive skipped-agent list from crash findings:
const crashedAgents = squadFindings
  .filter(f => f.heuristic_id === "REVIEWER_CRASHED")
  .map(f => extractAgentNameFromCrashFinding(f)) // parse location_key mon:<name>:REVIEWER_CRASHED

skippedAgents = [...skippedAgents_from_rubric_check, ...crashedAgents]
```

`extractAgentNameFromCrashFinding` is trivial:

```ts
function extractAgentNameFromCrashFinding(f: Finding): string {
  // location_key = "mon:<agent-name>:REVIEWER_CRASHED"
  const parts = f.location_key.split(":")
  if (parts.length !== 3 || parts[0] !== "mon" || parts[2] !== "REVIEWER_CRASHED") {
    throw new Error(`malformed REVIEWER_CRASHED location_key: ${f.location_key}`)
  }
  return parts[1]
}
```

Fail-loud on malformed key per Rule 13 — an orchestrator that silently accepts a broken crash finding hides bugs.

---

## 10. Scope discipline

### In scope

- Single-retry wrapper with 5s backoff.
- Classification of errors into retry-vs-fail-open outcome (but note: all classifications trigger one retry in Phase 1).
- Synthetic `REVIEWER_CRASHED` / `VERIFICATION_UNAVAILABLE` finding emission conforming to the canonical schema.
- Timeout enforcement via `Promise.race` + `setTimeout`.
- Env-var overrides for timeout and backoff with defensive parsing.
- Error sanitization (truncation, whitespace collapse, secret scrubbing, absolute-path scrubbing).
- Stderr logging for observability.
- Self-validation of the synthetic finding against the Zod schema.

### Out of scope

- Exponential backoff beyond one retry — Phase 2 optimization. Added only if observed crash rates warrant.
- Category-specific retry counts (e.g. retry malformed 3x, retry 429 1x). Complexity trap. Phase 2 if needed.
- Cross-run learning ("agent X has been flaky 5 runs in a row, auto-skip this run"). Out of scope — introduces state that confuses the user about what was reviewed.
- Automatic plugin version downgrade on persistent crash. Out of scope — catastrophic failure mode.
- Email / Slack / push notifications. The crash already surfaces in the dashboard and review-notes.md; notification delivery is a separate concern.
- Reconciliation of the `VERIFICATION_UNAVAILABLE` location_key with the `mon:` grammar. The existing verify-claims-pass spec uses a legacy non-`mon:` key; migrating both to `mon:verify-claims:verifier-unavailable` is a small follow-up task but NOT T1226's mandate.
- Crash metrics persistence (how often did agent X crash this month?) — would require a write to `docs/preflight/metrics/...` which is outside the orchestration-output scope.

---

## 11. Testing approach

Unit tests against this specification use a stubbed `AgentDescriptor` whose `invoke` callback is a programmable mock (resolves, rejects, delays). No real API calls. The Zod validator is the real T1200 schema.

### 11.1 Required test cases

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `invoke` resolves with valid `Finding[]` on first call | returns findings array, **NO retry**, **NO crash**, stderr silent |
| 2 | `invoke` rejects with `NetworkError` on first call, resolves with valid findings on retry | returns findings array, one stderr "retrying" log, one "success" log, **NO crash** |
| 3 | `invoke` rejects with `NetworkError` on both calls | returns `[REVIEWER_CRASHED finding]`, two stderr logs (retry + fail-open), finding has `category: "network"` substring in evidence |
| 4 | `invoke` resolves with malformed JSON on both calls (Zod throws both times) | returns `[REVIEWER_CRASHED finding]`, `heuristic_id === "REVIEWER_CRASHED"`, finding has `category: "malformed_output"` in evidence |
| 5 | `invoke` never resolves (hangs) with `timeoutMs=100` | returns `[REVIEWER_CRASHED finding]` after ~200ms + 5000ms retry delay + 100ms retry timeout = ~5.3s total, `category: "timeout"` |
| 6 | `invoke` returns `{ status: "blocked", blockReason: "rubric path unreadable" }` twice | returns `[REVIEWER_CRASHED finding]`, evidence contains the block reason, `category: "agent_blocked"` |
| 7 | `invoke` rejects with HTTP 429 on first call, succeeds on retry | returns findings, `category: "transient_http"` in first stderr log |
| 8 | `invoke` rejects with HTTP 401 on both calls (auth error) | returns `[REVIEWER_CRASHED finding]`, `category: "auth"` in evidence — auth errors STILL get a retry even though unlikely to recover, per §4 one-size-fits-all policy |
| 9 | `ctx.heuristicId === "VERIFICATION_UNAVAILABLE"`, both calls fail | returns `[VERIFICATION_UNAVAILABLE finding]`, `location_key === "orchestrator:verify-claims-pass:verifier-unavailable"`, `heuristic_id === "VERIFICATION_UNAVAILABLE"` |
| 10 | Error message contains `api_key=sk-ant-abc123` | finding's `evidence` has that substring replaced with `api_key=<redacted>` |
| 11 | Error message contains absolute path `/home/halli/cabin/some/file.ts` | finding's `evidence` has `~/cabin/some/file.ts` |
| 12 | Error stack trace is 3000 chars | finding's `evidence` truncated to 500 chars; original preserved in log at 200 chars |
| 13 | Agent crashes 2x, orchestrator's T1225 semaphore outer catch is NOT reached (asserts that `runAgentWithRetry` handled it internally) | test spy on outer catch shows 0 invocations; findings array contains the P3 crash finding |
| 14 | Synthetic crash finding fails Zod self-validation (simulated: mutate schema to require an extra field) | throws with message starting "synthetic crash finding failed self-validation" — this is the Rule 13 fail-loud self-check |
| 15 | `PILOT_REVIEW_AGENT_TIMEOUT=abc` (non-numeric env var) | falls back to 300_000 ms default, one-time stderr warning emitted |
| 16 | `PILOT_REVIEW_AGENT_TIMEOUT=120` (valid override — 2 minutes) | `timeoutMs === 120_000` in the ctx passed to `invokeWithTimeout` |
| 17 | Concurrent crashes of 3 agents out of 10 (via semaphore) | final findings array contains exactly 3 `REVIEWER_CRASHED` findings, each with a distinct `location_key` matching `mon:<name>:REVIEWER_CRASHED`; other 7 agents' findings present |

### 11.2 Negative tests (things that MUST throw — loudly)

- `ctx.heuristicId === "SOMETHING_ELSE"` (not in the union): TypeScript prevents this at compile time. Runtime narrow guard throws for defensive belts-and-suspenders: `throw new Error("unsupported heuristicId: " + ctx.heuristicId)`.
- `ctx.validateFindings` is not a function: throw at the top of `runAgentWithRetry` (fail-fast, not fail-open — this is a programmer error, not a reviewer error).
- `agent.name` is not kebab-case: the synthetic finding's `location_key` would violate the agent-name regex. Emit a validation error rather than silently producing an invalid key.

### 11.3 Integration tests (one per crash source)

1. **Force reviewer to throw**: inject a `throw new Error("synthetic")` into one agent's prompt-assembly path. Observe:
   - Other 9 agents complete.
   - Dashboard's `## SKIPPED AGENTS` section includes the injected agent.
   - `review-notes.md` "Reviewer Crashes" section shows one entry for that agent with category `unknown`.
   - No eljun task created for the crash.
2. **Force verifier to crash**: set `GROUND_TRUTH_VERIFIER_DISABLED=1` (or equivalent flag) so the verifier invocation fails. Observe:
   - `verify-claims-pass` emits `VERIFICATION_UNAVAILABLE`.
   - Non-exempt findings carry `verify_status: not-verified-this-run` annotation.
   - Dashboard renders the annotation.
   - `review-notes.md` "Verifier Unavailable" section populated.
3. **Force timeout on one agent**: override `PILOT_REVIEW_AGENT_TIMEOUT=1` (1 second) with a deliberately slow agent. Observe same fail-open behavior; category in evidence = `timeout`.

### 11.4 Rule 13 test — the mock-vs-behavior trap

Every unit test asserts against the OUTPUT (`Finding[]` returned, stderr log contents, Zod-validated shape), NOT against the mock's internal call count. Asserting "the mock was called 2 times" is a Rule 13 violation per `halli-workflows:skills/testing-principles`: it tests the mock, not the wrapper's contract. Tests MAY use call-count as a secondary check (e.g. "exactly one retry happened") but MUST always also assert on the returned findings.

---

## 12. References

- Design Doc: `docs/design/pilot-review-system-design.md`
  - §13 "Concurrency and Retry Strategy" (lines ~1233–1284) — authoritative source of retry policy, fail-open decision, and 5-second-backoff rule.
  - §13 Q2 "Retry strategy" (lines ~1241–1247) — `REVIEWER_CRASHED` decision.
  - §13 Q3 (lines ~1249–1251) — `VERIFICATION_UNAVAILABLE` parallel decision.
  - §6 "Escalation rules" — P3 tier destination.
  - §12 step 6 — orchestration flow integration point.
- ADR: `docs/adr/ADR-0014-pilot-review-orchestration.md` §Consequences — referenced by `rule_link` on the synthetic finding.
- Schema: `halli-workflows:types/finding.md` — the synthetic finding must validate against this.
- Grammar: `halli-workflows:types/location-key.md` §mon — the canonical grammar for the crash `location_key`.
- Caller: `halli-workflows:commands/pilot-review/semaphore` (T1225) — the outer loop that invokes `runAgentWithRetry` inside the concurrency pump.
- Downstream: `halli-workflows:commands/pilot-review/p3-notes-aggregator` (T1221) — routes `REVIEWER_CRASHED` / `VERIFICATION_UNAVAILABLE` to dedicated sections.
- Parallel: `halli-workflows:commands/pilot-review/verify-claims-pass` (T1217) — consumer of the `VERIFICATION_UNAVAILABLE` heuristic path.
- Task spec: `docs/plans/tasks/T1226-retry-fail-open.md`.

---

## 13. Rule 13 self-check (author pre-handoff)

Before handing this spec off, the author verified:

1. **ADR-0014 heading exists.** `grep -n "^## Consequences" docs/adr/ADR-0014-pilot-review-orchestration.md` → line 83. The `rule_link` `docs/adr/ADR-0014-pilot-review-orchestration.md#consequences` resolves.
2. **Design Doc §13 anchors exist.** `## 13. Concurrency and Retry Strategy` at line 1233, `### Q2. Retry strategy` / Q3 at lines 1241/1249. Policy quotes are verbatim from those lines.
3. **Canonical Finding schema fields match.** All 10 fields in `makeCrashFinding` are present: `agent`, `severity`, `rule_link`, `verdict`, `evidence`, `location_key`, `heuristic_id`, `suggested_fix`, `screenshot`, `witnesses`. `.strict()` compatibility confirmed (no extra fields invented).
4. **Agent-name kebab-case constraint.** The `location_key` `mon:<agent>:REVIEWER_CRASHED` uses `<agent>` verbatim; the agent-name regex `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` (from types/finding.md §Zod schema) is satisfied for all known reviewer names in Design Doc §3.
5. **p3-notes-aggregator routing matches.** p3-notes-aggregator §5 section matcher `heuristic_id === "REVIEWER_CRASHED"` (line 264) and `heuristic_id === "VERIFICATION_UNAVAILABLE"` (line 265) route this module's output to the correct sections.
6. **No invented env vars.** `PILOT_REVIEW_AGENT_TIMEOUT` and `PILOT_REVIEW_RETRY_DELAY` are new, introduced by this spec and documented here — they do NOT exist yet in any other file, so there is no risk of silent override by an existing config.
7. **No invented heuristic_ids.** `REVIEWER_CRASHED` is already in the p3-notes-aggregator allow-list (line 391) as a non-promotable operational heuristic. `VERIFICATION_UNAVAILABLE` likewise. No new IDs introduced.
8. **No TypeScript compile attempted.** The halli-workflows plugin is pure markdown — no lib/ directory exists, no `tsc` runs. The pseudocode blocks are specifications the orchestrator inlines when it wires this module. If a future project materializes a `halli-workflows/lib/orchestrator/retry.ts`, this spec is the source of truth for its contract.
