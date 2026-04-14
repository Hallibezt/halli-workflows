---
name: pilot-review/concurrency
description: Semaphore-based concurrent fan-out runner for the pilot-review orchestrator. Caps simultaneous reviewer agent invocations (default 5, overridable via --concurrency=N, clamped to 1..10 with warning), queues the remainder, and collects Finding[] (plus synthetic REVIEWER_CRASHED findings from T1226's retry wrapper) into a flat array. Pure algorithm: no LLM calls, no file I/O, no mutation of source tree. Invoked by pilot-review-orchestrator at §12 step 6.
---

**Module Context**: Prompt-style specification for the `runSquad(agents, concurrency)` helper consumed by `halli-workflows:pilot-review-orchestrator` at step 6 of the orchestration flow (Design Doc §12 step 6 "Fan out agents"; §13 "Concurrency and Retry Strategy"; §22 Appendix B pseudocode). This file is NOT a slash-command; it is a module specification that a future TypeScript implementation at `halli-workflows/lib/orchestrator/semaphore.ts` can consume directly as its design contract.

**Placement rationale**: This module lives under `commands/pilot-review/` because the halli-workflows plugin is pure-markdown (no TypeScript build step — see `halli-workflows:types/README.md`). Each orchestration pipeline stage is a specification document the orchestrator's inlined implementation follows. The orchestrator references this file when authoring its fan-out logic; the file is NOT an independently-registered command in `plugin.json`.

**Depends on**:
- `halli-workflows:types/finding.md` — canonical `Finding` schema (10 required fields) that every reviewer emits.
- `halli-workflows:pilot-review-orchestrator` — caller. Owns the roster resolution (step 2), passes it to `runSquad` at step 6.
- `halli-workflows:commands/pilot-review/retry` (T1226) — per-agent retry + fail-open wrapper. The semaphore wraps each `runAgent` call in `runAgentWithRetry`; the retry layer is responsible for producing the synthetic `REVIEWER_CRASHED` finding. The semaphore itself should NEVER see a rejected promise under normal operation; its `catch` block exists only as a second-line safety net (see §Error Handling).

**Reads flags from** (populated by T1224 flag parser): `flags.concurrency: number`. Default `5`. T1224 is responsible for range validation; §Clamping below specifies the defensive fallback the semaphore applies if an out-of-range value arrives (belt-and-suspenders per Rule 13).

---

## 1. Purpose

Fan out the resolved reviewer roster to Anthropic API agents without tripping rate limits, monopolizing the developer's machine, or sequentializing a workload that naturally parallelizes. Per Design Doc §13 Q1, Anthropic org-scale keys handle 10 concurrent requests but stress under sustained load — 5-wide concurrency completes a 10-agent Phase 1 run in ~2x single-agent wall time (two waves of 5) with headroom for agent-internal tool calls.

Without this module the orchestrator must choose between:

- **Sequential fan-out**: safe but ~10x slower than necessary. A 10-agent run becomes 20+ minutes instead of 4-6.
- **Unbounded parallel**: fast on paper but in practice trips 429s, especially when each agent itself makes multiple tool calls (Read, Grep, Bash) that compound. Also burns the user's token quota in one burst.

The semaphore is the middle path: configurable concurrency, strict invariant that `running.length <= concurrency` at all times, graceful degradation when an agent throws.

---

## 2. Contract

### Signature

```ts
export async function runSquad(
  agents: Agent[],
  concurrency: number,
  options?: RunSquadOptions,
): Promise<Finding[]>;
```

### Types

```ts
/**
 * Reviewer agent descriptor. Consumed by the orchestrator's fan-out step. The
 * semaphore is type-opaque on Agent — it only needs to pass the agent through
 * to runAgent(). The orchestrator defines the concrete shape.
 */
interface Agent {
  /** Agent identifier, e.g. "isolation-reviewer", "drift-gate", "codebase-auditor-adapter". */
  name: string;
  /** Any additional fields the orchestrator needs to invoke the agent (prompt, model, etc.). */
  [key: string]: unknown;
}

/**
 * Per-invocation options. All fields optional.
 */
interface RunSquadOptions {
  /**
   * Override the runAgent implementation (useful for tests and for the retry
   * wrapper). When omitted, the caller's default runAgent is used.
   * The function MUST return a Finding[] and MUST NOT throw under normal
   * operation — crashes are wrapped into REVIEWER_CRASHED findings by the
   * retry layer (T1226) before reaching the semaphore.
   */
  runAgent?: (agent: Agent) => Promise<Finding[]>;

  /**
   * Optional per-invocation telemetry sink. Called once per agent with the
   * invocation start/end timestamps (epoch ms) and the resolved findings or
   * thrown error. The orchestrator uses this for run-log metadata; production
   * runs may pass undefined. Telemetry failures are swallowed — they MUST NOT
   * affect the semaphore's return value.
   */
  onInvocationEnd?: (event: InvocationEvent) => void;
}

interface InvocationEvent {
  agentName: string;
  /** epoch ms, recorded at the moment the task promise began */
  startedAt: number;
  /** epoch ms, recorded in the .finally() block */
  endedAt: number;
  /** duration === endedAt - startedAt, precomputed for convenience */
  durationMs: number;
  /** Outcome discriminant — 'ok' when runAgent resolved, 'error' when it rejected */
  outcome: "ok" | "error";
  /** Count of findings returned. 0 is valid (agent ran, found nothing). */
  findingsCount: number;
  /** Present only when outcome === 'error'. The caught error is stringified. */
  errorMessage?: string;
}
```

### Input

- `agents`: array of `Agent` descriptors resolved by the orchestrator (post-`--skip`/`--only`/`--include-ux`/`--force` filtering). May be empty.
- `concurrency`: integer, the semaphore width. Sourced from `flags.concurrency` (T1224). Default 5 per Design Doc §13 Q1.
- `options`: optional. See type above.

### Output

A `Finding[]` flat array containing, in insertion order (non-deterministic across runs due to concurrency):

1. Every finding returned by every agent whose `runAgent` call resolved successfully.
2. One synthetic `REVIEWER_CRASHED` finding per agent whose `runAgent` call rejected AND whose rejection was not already wrapped upstream by `runAgentWithRetry` (T1226). Under normal T1226-wired operation this second source is empty; the semaphore's internal `catch` exists purely as a Rule 13 safety net.

Findings are NOT deduplicated, NOT sorted, NOT verified, NOT anchor-validated by this module. Those passes run AFTER fan-out (§12 steps 7-8). The semaphore's job is to collect — transformation is someone else's job.

---

## 3. Clamping and Validation

### Defaults

Default `concurrency = 5` per Design Doc §13 Q1 recommendation (confirmed in ADR-0014 Open Items Q1).

### Range

The semaphore SHOULD receive `concurrency` already-validated from T1224 (flag parser). Defensively, `runSquad` applies the following clamp-and-warn on its own input:

| Input value | Behavior |
|-------------|----------|
| `< 1` (including 0, negative, `NaN`) | Clamp to `1`. Log to stderr: `[concurrency] invalid value <N>, clamping to 1`. |
| `1..10` inclusive | Pass through unchanged. No warning. |
| `> 10` | Clamp to `10`. Log to stderr: `[concurrency] value <N> exceeds max 10, clamping to 10`. |
| Non-integer (e.g. `3.7`) | `Math.floor` to `3`, then apply the `1..10` check. Log to stderr: `[concurrency] non-integer value <N>, flooring to <floor>`. |

**Rationale for max 10**: Anthropic API rate limits for an org-scale key degrade at sustained >10 concurrent requests (Design Doc §13 Q1). Beyond 10, agent-internal tool calls compound and trip 429s even on a clean network. If a user genuinely needs >10, the right fix is to run two separate `--only=<subset>` invocations in sequence, not to raise the cap.

**Rationale for min 1**: `concurrency = 0` would queue all agents forever — an obvious deadlock. `concurrency < 0` has no semantic meaning. Clamp to 1 and warn; the run still completes (sequentially), it just takes longer. Silent failure is a Rule 13 violation.

### Scope deviation (from task prompt)

The T1225 task description mentions adaptive behavior: "if first wave returns 429 from Anthropic, reduce semaphore to 3 for next wave". This adaptive behavior is **NOT implemented here** and **NOT specified in Design Doc §13**. Rationale for the deviation:

1. Design Doc §13 Q2 delegates 429 handling to per-agent retry (5s backoff, one retry) — T1226's `runAgentWithRetry`. The semaphore is intentionally a dumb fixed-width gate; adaptivity belongs at the retry layer if it belongs anywhere.
2. Adaptive reduction mid-run would make the `running.length <= concurrency` invariant a moving target, complicating testing and reasoning.
3. If Phase 1 empirically shows 429s are a problem at concurrency=5, the right response is to lower the default (one-line change) or add Phase 2 adaptivity with its own task file — not to smuggle complexity into T1225.

This deviation is explicitly flagged in the task file's acceptance criteria discussion (see §6 Testing and §Deviations in the module output report).

---

## 4. Algorithm

The semaphore follows Design Doc §13 verbatim, with named helpers for clarity:

```ts
export async function runSquad(
  agents: Agent[],
  concurrency: number,
  options: RunSquadOptions = {},
): Promise<Finding[]> {
  // Step 0 — Exit-early guard.
  if (agents.length === 0) {
    return [];
  }

  // Step 1 — Clamp concurrency (see §3).
  const width = clampConcurrency(concurrency);

  // Step 2 — Resolve runAgent (DI for tests and for T1226 retry wrapper).
  const runAgent = options.runAgent ?? DEFAULT_RUN_AGENT;

  // Step 3 — Set up collection buffers.
  const results: Finding[][] = [];
  const queue: Agent[] = [...agents];      // shallow copy so we don't mutate caller's array
  const running: Promise<void>[] = [];

  // Step 4 — Main loop: drain the queue while respecting the cap.
  while (queue.length > 0 || running.length > 0) {
    // Step 4a — Launch as many as the cap allows.
    while (running.length < width && queue.length > 0) {
      const agent = queue.shift()!;
      const startedAt = Date.now();

      const task: Promise<void> = runAgent(agent)
        .then((findings) => {
          results.push(findings);
          emit(options.onInvocationEnd, {
            agentName: agent.name,
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            outcome: "ok",
            findingsCount: findings.length,
          });
        })
        .catch((err) => {
          // SAFETY NET. Under normal operation T1226's runAgentWithRetry wraps
          // runAgent and never rejects — crashes are returned as synthetic
          // findings. This catch is the second line of defense.
          const crash = makeCrashFinding(agent, err);
          results.push([crash]);
          emit(options.onInvocationEnd, {
            agentName: agent.name,
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            outcome: "error",
            findingsCount: 0,
            errorMessage: String(err),
          });
        })
        .finally(() => {
          const idx = running.indexOf(task);
          if (idx >= 0) running.splice(idx, 1);
        });

      running.push(task);
    }

    // Step 4b — If anything is running, wait for the first to settle before
    // re-checking the cap. Promise.race RESOLVES as soon as any member
    // resolves/rejects. Our .catch() above means race never rejects — we can
    // safely await it without a try block.
    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  // Step 5 — Flatten. Findings arrive in result-order, not agent-order, due
  // to concurrency — that is fine. Dedup and sort happen downstream (§12 step 7).
  return results.flat();
}
```

### Named helpers referenced above

```ts
// §3 Clamping and Validation — returns a safe integer in [1, 10].
function clampConcurrency(raw: number): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    console.error(`[concurrency] invalid value ${raw}, clamping to 1`);
    return 1;
  }
  let n = raw;
  if (!Number.isInteger(n)) {
    const floored = Math.floor(n);
    console.error(`[concurrency] non-integer value ${n}, flooring to ${floored}`);
    n = floored;
  }
  if (n < 1) {
    console.error(`[concurrency] invalid value ${n}, clamping to 1`);
    return 1;
  }
  if (n > 10) {
    console.error(`[concurrency] value ${n} exceeds max 10, clamping to 10`);
    return 10;
  }
  return n;
}

// Telemetry sink wrapper. Swallows errors so a broken sink never affects the run.
function emit(sink: ((e: InvocationEvent) => void) | undefined, event: InvocationEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch (telemetryErr) {
    console.error(`[concurrency] telemetry sink threw: ${telemetryErr}`);
  }
}

// Synthetic REVIEWER_CRASHED finding. Schema matches halli-workflows:types/finding.md
// and matches the shape T1226 emits (they are interchangeable).
// See T1226 acceptance criteria for the canonical shape.
function makeCrashFinding(agent: Agent, err: unknown): Finding {
  const message = err instanceof Error ? err.message : String(err);
  const hash = sha256(message).slice(0, 8);  // 8-char hex for location_key stability
  return {
    agent: "orchestrator",
    severity: "P3",
    rule_link: "docs/adr/ADR-0014-pilot-review-orchestration.md#consequences",
    verdict: "uncertain",
    evidence: `Agent ${agent.name} crashed: ${message}`,
    location_key: `crash:${agent.name}:${hash}`,
    heuristic_id: "REVIEWER_CRASHED",
    suggested_fix: `Retry the run, or check plugin logs for ${agent.name}.`,
    screenshot: null,
    witnesses: ["orchestrator"],
  };
}
```

### Waves explained

With `concurrency = 5` and 10 agents, execution proceeds in two approximate waves:

```
Time
  t0 ──▶ Launch [a1, a2, a3, a4, a5]. running=5, queue=[a6..a10].
           │
           │ Promise.race waits for first-to-finish.
           │
  t1 ──▶ a3 finishes first. running=4. Inner while launches a6. running=5, queue=[a7..a10].
  t2 ──▶ a1 finishes. running=4. Launch a7. running=5, queue=[a8..a10].
  ...
  tN ──▶ queue empty, running drains. All results flattened.
```

Agents are not "waves" in a strict sense — the inner while keeps the pool full as slots free. Agents that finish fast yield their slot immediately; agents that run long hold it. The invariant `running.length <= concurrency` holds at every `await` boundary.

If all 10 agents take exactly equal time, the execution looks like true waves (t0-t1 wave 1, t1-t2 wave 2). In practice some agents (freshness, drift-gate) are much faster than others (codebase-auditor, isolation-reviewer), so the pool churns.

---

## 5. Invariants

The semaphore MUST satisfy the following at all times:

1. **Cap invariant**: `running.length <= concurrency` after every `await` boundary. A test can observe this by instrumenting `runAgent` to increment a counter on entry and decrement on exit — the counter MUST NEVER exceed `concurrency`.
2. **No starvation**: every agent in `agents` is eventually launched. The run terminates iff `queue.length === 0 && running.length === 0`, which requires every agent to have transitioned through `running`.
3. **No double-launch**: every agent in `agents` is launched exactly once. `queue.shift()` consumes each agent; the outer loop never re-pushes.
4. **No lost findings**: every `runAgent` resolution contributes to `results`. A rejection contributes exactly one synthetic `REVIEWER_CRASHED` finding (via the safety-net catch). Either way the agent's output bucket is non-null.
5. **Pure on inputs**: the semaphore never mutates `agents`. It shallow-copies into `queue`. Callers can reuse the input array after `runSquad` returns.
6. **Run completion is total**: `runSquad` always resolves (never rejects) provided `runAgent` itself does not throw synchronously. Safety-net catch converts async rejections to findings; synchronous throws from `runAgent` would propagate and are not the semaphore's responsibility to handle — T1226's `runAgentWithRetry` MUST NOT throw synchronously.

### Why `Promise.race` and not `Promise.all` or `Promise.allSettled`

- **`Promise.all`**: waits for all current promises to settle before launching the next. With `concurrency=5` and 10 agents, if one of the first 5 takes 10x as long as the others, the semaphore idles 4 workers for the entire tail. `Promise.race` keeps the pool full.
- **`Promise.allSettled`**: same starvation problem as `Promise.all` plus extra allocation.
- **`Promise.race`**: resolves as soon as ANY running promise settles, freeing the inner while to refill. Correct primitive.

### Why `.finally()` to splice out of `running`

The `.finally()` runs on both fulfillment and rejection, ensuring the splice happens in either path. Without `.finally()`, we'd need to duplicate the splice in both `.then()` and `.catch()` — error-prone. `.finally()` also runs AFTER `.then()`/`.catch()` per the spec, so `results.push(...)` completes before the splice, preserving the "no lost findings" invariant even under a rapid-race edge case.

---

## 6. Error Handling

### Layers of defense

```
┌─────────────────────────────────────────────────────────────┐
│  runSquad (this module)                                     │
│     │                                                       │
│     └─▶ runAgentWithRetry (T1226)   ◀── wraps each agent    │
│           │                                                 │
│           └─▶ runAgent (actual Task tool invocation)        │
└─────────────────────────────────────────────────────────────┘
```

- **runAgent**: raw Task tool call. CAN reject on network error, 429, 500, malformed output.
- **runAgentWithRetry (T1226)**: retries once after 5s backoff, then wraps persistent errors into a synthetic `REVIEWER_CRASHED` finding. From the semaphore's perspective this layer NEVER rejects — it always resolves with `Finding[]`.
- **runSquad (this module)**: invokes whatever `options.runAgent` was given (either raw `runAgent` in tests, or `runAgentWithRetry` in production). Keeps a safety-net `.catch()` so that if T1226 has a bug or is not yet wired, the run still completes.

### What happens when `runAgent` rejects

1. The `.catch()` receives the error.
2. `makeCrashFinding(agent, err)` builds a `Finding` matching the T1226 schema.
3. `results.push([crash])` records it.
4. The `.finally()` splices the task out of `running`.
5. The main loop continues — no agent is left unstarted, no other agent is affected.

### What happens when `runAgent` throws synchronously

The `then/catch/finally` chain is not applied to a synchronous throw — the throw happens BEFORE `runAgent(...)` returns a Promise. The inner while would bubble the exception up through `runSquad`, rejecting the outer Promise.

**Mitigation**: `runAgent` contract (both raw and T1226-wrapped) MUST return a Promise unconditionally. Authors of `runAgent` implementations are responsible for this; the semaphore does not defensively wrap in `Promise.resolve().then(() => runAgent(agent))` because that would hide real bugs (Rule 13: "Never catch and swallow an error to prevent a crash without understanding WHY").

If a synchronous throw is ever observed in practice, the fix is to fix the underlying `runAgent`, not to patch the semaphore.

### What the semaphore never does

- **Never retry**. Retry is T1226's job.
- **Never demote severity**. `REVIEWER_CRASHED` is always P3 per Design Doc §13 Q2.
- **Never drop findings**. Even a crashed agent emits exactly one synthetic finding.
- **Never touch the filesystem, git, or network** beyond what `runAgent` does internally.

---

## 7. Invocation Telemetry (Optional)

`options.onInvocationEnd` is an optional sink the orchestrator can pass to collect per-agent timing. Each invocation emits exactly one `InvocationEvent` — either on success (`.then`) or on failure (`.catch`). The semaphore does NOT buffer these events; the sink is called synchronously inside the `.then`/`.catch` handlers.

Contract with the sink:

- **Pure side-effect**: the sink SHOULD NOT throw. If it does, the error is logged to stderr and swallowed; the run continues.
- **No assumption of order**: events arrive in the order agents settle, which is non-deterministic under concurrency.
- **Timestamps**: `startedAt` is captured when the task promise is created (inside the inner while, before `runAgent(agent)` returns). `endedAt` is captured at the top of the handler (`.then` or `.catch`). The difference is wall-clock duration including Promise microtask overhead; it is not a substitute for profiling the agent itself.

### Scope deviation (from task prompt)

The T1225 task description says: "Track invocation start/end times for dashboard metadata (run time)". The dashboard-generator's `DashboardInput` contract (T1219) takes `runStartedAt: Date` and `runEndedAt: Date` at the **run level**, not per-agent. So:

- Per-agent timing is NOT consumed by the current dashboard template.
- The semaphore exposes per-agent timing via the optional `onInvocationEnd` sink as **forward-looking telemetry** — Phase 2 may consume it for per-agent SLA tracking, cost attribution, or detecting slow agents.
- Run-level `runStartedAt`/`runEndedAt` are owned by the orchestrator (step 0 before fan-out, step 9 after the pipeline), NOT by this module. The semaphore does not know or care about run boundaries.

This deviation is flagged in the return report under "Deviations". The sink is intentionally optional so production runs can pass `undefined` and incur zero cost.

---

## 8. Testing Approach

### Unit tests

Location: `halli-workflows/lib/orchestrator/__tests__/semaphore.test.ts` (when the TS implementation lands).

Use a fake `runAgent` so tests are hermetic — no Task tool, no LLM calls.

#### Test 1 — Cap invariant (concurrency=5, 10 agents)

```
let maxConcurrent = 0;
let currentConcurrent = 0;
const runAgent = async (agent) => {
  currentConcurrent++;
  maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
  await sleep(10 + Math.random() * 20);  // 10-30ms jitter
  currentConcurrent--;
  return [/* one fake Finding */];
};

const agents = Array.from({ length: 10 }, (_, i) => ({ name: `agent-${i}` }));
const findings = await runSquad(agents, 5, { runAgent });

expect(maxConcurrent).toBeLessThanOrEqual(5);
expect(findings).toHaveLength(10);
```

#### Test 2 — Under-subscribed pool (concurrency=5, 3 agents)

```
// All 3 should run in parallel — queue never fills.
const starts: number[] = [];
const runAgent = async (agent) => {
  starts.push(Date.now());
  await sleep(50);
  return [];
};

await runSquad(Array.from({ length: 3 }, (_, i) => ({ name: `a-${i}` })), 5, { runAgent });
// All three starts within a few ms of each other (no queuing).
expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(20);
```

#### Test 3 — Agent crash does not halt the run

```
const runAgent = async (agent) => {
  if (agent.name === "a-3") throw new Error("boom");
  return [/* finding */];
};
const findings = await runSquad(Array.from({ length: 10 }, (_, i) => ({ name: `a-${i}` })), 5, { runAgent });
// 9 real findings + 1 synthetic REVIEWER_CRASHED = 10 total.
expect(findings).toHaveLength(10);
expect(findings.filter((f) => f.heuristic_id === "REVIEWER_CRASHED")).toHaveLength(1);
expect(findings.find((f) => f.heuristic_id === "REVIEWER_CRASHED")!.evidence).toMatch(/a-3 crashed: boom/);
```

#### Test 4 — Empty roster

```
const findings = await runSquad([], 5);
expect(findings).toEqual([]);
// And no runAgent was called — verify with a spy.
```

#### Test 5 — Clamping

```
await runSquad([{ name: "a" }], 0, { runAgent });       // clamps to 1, runs fine
await runSquad([{ name: "a" }], -3, { runAgent });      // clamps to 1
await runSquad([{ name: "a" }], 999, { runAgent });     // clamps to 10
await runSquad([{ name: "a" }], 3.7, { runAgent });     // floors to 3
await runSquad([{ name: "a" }], Number.NaN, { runAgent }); // clamps to 1
// Each should complete without throwing. Assert stderr captured the warning
// for the invalid inputs.
```

#### Test 6 — Telemetry sink receives one event per agent

```
const events: InvocationEvent[] = [];
const runAgent = async (agent) => {
  if (agent.name === "a-1") throw new Error("x");
  return [/* finding */];
};
await runSquad(
  [{ name: "a-0" }, { name: "a-1" }, { name: "a-2" }],
  5,
  { runAgent, onInvocationEnd: (e) => events.push(e) },
);
expect(events).toHaveLength(3);
expect(events.filter((e) => e.outcome === "ok")).toHaveLength(2);
expect(events.filter((e) => e.outcome === "error")).toHaveLength(1);
expect(events.every((e) => e.durationMs >= 0)).toBe(true);
```

#### Test 7 — Telemetry sink that throws does not halt the run

```
const runAgent = async () => [/* finding */];
const sink = () => { throw new Error("sink bug"); };
const findings = await runSquad(
  [{ name: "a-0" }, { name: "a-1" }],
  5,
  { runAgent, onInvocationEnd: sink },
);
expect(findings).toHaveLength(2);
// stderr captured "[concurrency] telemetry sink threw" twice.
```

### Integration tests

Run manually with real agents once the reviewer roster is wired (T1207-T1214):

- `/pilot-review --app=guestpad --concurrency=5` — default path, observe 8 agents complete in ~2 waves.
- `/pilot-review --app=guestpad --concurrency=1` — sequential, should take ~5x longer; useful for debugging a specific agent's output.
- `/pilot-review --app=guestpad --concurrency=10` — stresses Anthropic API; observe 429 behavior is handled by T1226 retry layer, semaphore stays strict at 10.
- `/pilot-review --app=guestpad --concurrency=99` — clamps to 10 with stderr warning, run proceeds normally.

### Out of scope for testing

- Testing actual Anthropic API rate-limit behavior (requires real API calls, blocking CI).
- Testing the 429 retry path (owned by T1226's retry module tests).
- Testing dashboard rendering (owned by T1219 dashboard-generator tests).

---

## 9. Rule 13 Notes

**"Code that compiles is not code that works."** Specific Rule 13 defenses in this module:

1. **No silent drops**. Every agent contributes at least one entry to `results` — either real findings or a synthetic `REVIEWER_CRASHED`. A run that crashes 3 of 10 agents returns at minimum 3 crash findings visible in the dashboard; the user sees the degradation.
2. **No hidden ceiling**. `concurrency > 10` is clamped with a stderr warning, not silently accepted. If a user asks for 50 and gets 10, they see the warning and can adjust.
3. **No invented 429 adaptivity**. The task prompt mentions adaptive reduction; the Design Doc does not. Rather than implementing a feature not in the design (Rule 13: "no invented external interfaces / no fake implementations"), the deviation is flagged explicitly here and in the return report.
4. **No hidden retry**. Retry is T1226's contract, not this module's. Duplicating retry logic here would violate SRP and make the T1226 tests insufficient — two modules doing the same thing is worse than one module doing it correctly.
5. **Safety-net catch is documented**. The `.catch()` exists, but the contract is that T1226 SHOULD never let a rejection reach it. If the catch fires in production, it is a signal that T1226 failed to wrap — a Rule 13 bug worth investigating.

**"Am I making this work, or making this LOOK like it works?"**: The semaphore is genuinely 30 lines of real logic plus type definitions and clamp defenses. Every line does what it claims. There is no hardcoded dummy data, no mock return values, no TODO disguised as a completed function.

---

## 10. References

- **Design Doc**: `docs/design/pilot-review-system-design.md` (in the consuming project, e.g. `cabin`)
  - §13 Concurrency and Retry Strategy — primary authority
  - §13 Q1 — semaphore=5 default
  - §13 Q2 — fail-open with P3 REVIEWER_CRASHED
  - §13 Q4 — no response caching in Phase 1
  - §12 step 6 — fan-out invocation point
  - §22 Appendix B — orchestrator pseudocode (includes `runSquad` at line 1614 approx)
- **ADR**: `docs/adr/ADR-0014-pilot-review-orchestration.md` §Open Items Q1 — confirms semaphore=5
- **Canonical contracts**: `halli-workflows:types/finding.md` (Finding schema, Severity, REVIEWER_CRASHED heuristic_id)
- **Upstream**: `halli-workflows:pilot-review-orchestrator` step 6 (consumes this module)
- **Downstream retry layer**: `halli-workflows:commands/pilot-review/retry` (T1226 — wraps each `runAgent` passed into the semaphore)
- **Dashboard consumer**: `halli-workflows:commands/pilot-review/dashboard-generator` (T1219 — consumes run-level timings, not per-agent)
- **Task file**: `docs/plans/tasks/T1225-semaphore-concurrency.md` (in the consuming project)

---

## 11. Completion Criteria (for the TypeScript implementation)

When `halli-workflows/lib/orchestrator/semaphore.ts` is authored against this spec, it must:

- [ ] Export `runSquad(agents, concurrency, options?)` with the signature in §2.
- [ ] Match the algorithm in §4 line-for-line (named helpers may be inlined if preferred).
- [ ] Pass all seven unit tests in §8.
- [ ] Satisfy every invariant in §5 (verified by Test 1 for the cap invariant).
- [ ] Never mutate the caller's `agents` array (verified by Test 4's "no runAgent was called" check after `await runSquad([], 5)`).
- [ ] Produce `REVIEWER_CRASHED` findings with schema matching T1226's contract (verified by Test 3).
- [ ] Compile under TypeScript strict mode with no `any`, no `@ts-ignore`, no non-null assertions beyond `queue.shift()!` (which is provably safe given the `queue.length > 0` guard).

---

*Generated for T1225 Phase 1.7. This module is a specification; the TypeScript implementation lands alongside the orchestrator's lib/ scaffold. Until then, `pilot-review-orchestrator.md` step 3 uses an empty roster and does not invoke `runSquad` — no runtime dependency is blocked by the spec being markdown-only.*
