# preflight_hash — Deterministic Idempotency Key

> `preflight_hash` is the 8-hex-char SHA-256 truncation embedded in each eljun task
> description footer. It is the primary match key for Phase 1 dedup (`rubric_hash` is
> logged but not part of the match key in Phase 1). Derived from
> `docs/design/pilot-review-system-design.md` §7 and §10.

## Algorithm

```
preflight_hash = sha256(project_slug + ":" + location_key).slice(0, 8)
```

Inputs:

- `project_slug` — the eljun project slug (e.g. `"guestpad"`, `"aurora-hunter"`,
  `"aurora-hunter-web"`). Lowercase kebab-case. Matches the `--app=` flag value and the
  eljun URL slug.
- `location_key` — the canonical location key of the finding (see
  `halli-workflows:types/location-key.md`).

Output: a lowercase 8-character hex string (`[0-9a-f]{8}`).

## Signature

```ts
export function preflightHash(projectSlug: string, locationKey: string): string;
```

No other parameters. `heuristic_id` is already embedded in `location_key` for `code`,
`db`, and `ux` types, and the advisory/gap ID plays the same disambiguating role for
`dep`, `mon`, and `rubric-gap` — so **per-project scoping via `project_slug` alone** is
sufficient for collision safety. Design §7 line 700:
> "removes the double-hashing of `heuristic_id` that was present in the original
> formulation (the heuristic ID is already embedded in `location_key` for code/db/ux
> finding types)."

## Determinism guarantees

- Same `(projectSlug, locationKey)` input → same 8-hex output, across:
  - Node.js versions (tested ≥ 18)
  - Platforms (Linux, macOS, Windows)
  - Re-runs in the same session
- The function is pure. No I/O, no clock, no random, no environment variable reads.
- UTF-8 byte encoding of the joined string is canonical (Node's `crypto` module does
  this natively when the input is a plain string).

## Reference implementation (Node.js)

```ts
import { createHash } from "node:crypto";

export function preflightHash(projectSlug: string, locationKey: string): string {
  if (!projectSlug) throw new Error("preflightHash: projectSlug required");
  if (!locationKey) throw new Error("preflightHash: locationKey required");
  const input = `${projectSlug}:${locationKey}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}
```

That's the entire implementation. Eight lines including input validation.

## Snapshot test vectors

These are real SHA-256 outputs. The orchestrator's unit tests should assert these
exact values. They were generated with three independent implementations (Node.js
`crypto`, Linux `sha256sum`, Python `hashlib`) — all three agree.

| project_slug | location_key | preflight_hash |
|---|---|---|
| `guestpad` | `db:bar:rls_missing` | `43840829` |
| `guestpad` | `code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.getUser_missing` | `a0179503` |
| `guestpad` | `rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing` | `5e6d7e7b` |
| `aurora-hunter-web` | `dep:axios:GHSA-xxxx-yyyy-zzzz` | `7bfa1f23` |
| `guestpad` | `mon:aurora-api:sentry_absent` | `f55a0450` |
| `guestpad` | `ux:find-wifi-password:step-2-tap-connect:touch-target-too-small` | `edecd6f0` |

### Verifying the snapshot by hand

```bash
echo -n 'guestpad:db:bar:rls_missing' | sha256sum | cut -c1-8
# 43840829
```

```bash
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('guestpad:db:bar:rls_missing').digest('hex').slice(0,8))"
# 43840829
```

```bash
python3 -c "import hashlib; print(hashlib.sha256(b'guestpad:db:bar:rls_missing').hexdigest()[:8])"
# 43840829
```

## Collision analysis (design §17 line 1471)

8-hex-char SHA-256 = 2^32 ≈ 4.29 billion distinct values.

Birthday-bound collision probability at `n` tasks within one project:
`P ≈ n^2 / (2 × 2^32)`.

| Open tasks in one project | P(any collision) |
|---|---|
| 100 | 1.16 × 10^-6 |
| 500 | 2.91 × 10^-5 |
| 1,000 | 1.16 × 10^-4 |
| 5,000 | 2.91 × 10^-3 |
| 10,000 | 1.16 × 10^-2 |

The per-project scoping (`project_slug + ":"`) keeps collisions per-project rather
than cross-project. GuestPad, Aurora Hunter, and Aurora Hunter Web cannot collide with
each other even when they share the eljun host.

**On observed collision**: the orchestrator logs a warning to `docs/preflight/run-*.md`
notes section and upgrades the colliding pair to 16-hex hashes. Not automatic yet
(Phase 1 expects no collisions at current scale); manual handling if it ever occurs.

## Usage in the eljun description footer

The hash appears in the footer of every eljun task filed by the pilot-review system:

```
(suggested_fix text as the body)

---
<!-- pilot-review -->
preflight_hash: 7f3a9e21
finding_id: isolation-reviewer:db:bar:rls_missing:v1
rubric_hash: a0b3c4d5 (privacy-gdpr.md@sha)
run_id: 2026-04-14T15-39-pilot-review
```

The orchestrator:
1. On filing a new finding, computes `preflightHash(projectSlug, finding.location_key)`
   and writes the result as the `preflight_hash:` line.
2. On subsequent runs, GETs `/projects/{slug}/items?include_closed=true`, parses each
   task's footer for `preflight_hash: <hex>`, and builds a map `hash → existing_task`.
3. For each new finding, computes its hash and:
   - If present in map: PATCH the existing task (update evidence, suggested_fix, run_id,
     rubric_hash), reopen if closed.
   - If absent: POST a new task.

This gives idempotent filing without eljun needing an `external_id` column.

## Why 8 characters (not 16, not the full 64)?

- **Human-readable**: fits in a footer line without visual noise.
- **Copy-paste-friendly**: short enough to quote in commit messages and discussions.
- **Collision-safe for the target scale**: up to ~1,000 open tasks per project, the
  birthday probability is ~10^-4 — acceptable for a dev-tools system that escalates on
  detected collision.
- **Compatible with git short-hashes**: developers are used to 7-12 char hex IDs.

If the system ever scales past ~10,000 open tasks in a single project, the orchestrator
will upgrade to 16 chars (full SHA-256 truncation, no algorithm change — just a longer
slice).

## What preflight_hash is NOT

- **Not cryptographically meaningful.** 32 bits of SHA-256 is not a security property.
  Do not rely on `preflight_hash` for authentication or authorization.
- **Not a finding identifier on its own.** The human-readable `finding_id` field
  (agent + location_key + version) is still recorded for tracing.
- **Not rubric-aware in Phase 1.** Rubric edits do not change `preflight_hash`.
  `rubric_hash` is logged in the footer for Phase 2 — see design §15.
- **Not part of the Finding JSON shape.** `preflight_hash` is orchestrator-side metadata
  that lives in the eljun footer; it is never in the `Finding` object that a reviewer emits.

## Testing this helper

Required unit tests for the orchestrator's implementation:

- `preflightHash("guestpad", "db:bar:rls_missing") === "43840829"` (snapshot)
- `preflightHash("guestpad", "db:bar:rls_missing") === preflightHash("guestpad", "db:bar:rls_missing")` (determinism on re-call)
- `preflightHash("guestpad", "db:bar:rls_missing") !== preflightHash("aurora-hunter", "db:bar:rls_missing")` (project scoping separates)
- `preflightHash("", "db:bar:rls_missing")` → throws
- `preflightHash("guestpad", "")` → throws
- Output matches regex `/^[0-9a-f]{8}$/` for all valid inputs.

A seventh test recommended by Rule 13 (intellectual honesty): verify against an
independent implementation (openssl, python, etc.) for at least one vector so we catch
UTF-8/byte-encoding drift if Node's crypto ever changes behavior.
