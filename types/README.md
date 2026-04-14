# halli-workflows:types — Canonical Contracts

Reference documents for the Phase 1 pilot-review system. These files define the shared
contract that every reviewer agent and the orchestrator must conform to.

## Plugin format note

halli-workflows ships as a pure-markdown Claude Code plugin. There is no TypeScript build
step, no compiler, and no runtime module loader inside the plugin itself. These files are
therefore authored as **reference markdown** rather than `.ts` source.

- **Reviewer agents** (`halli-workflows:isolation-reviewer`, etc.) reference these files
  from their prompts so that their emitted JSON findings conform to the shape documented here.
- **The orchestrator** (`.claude/commands/pilot-review.md` in the consuming project, e.g. `cabin`)
  will implement the Finding schema, the `locationKey.*` helpers, and `preflightHash()` in
  real TypeScript as part of its own source. These markdown files are the specification it
  implements against.
- Any change to these files is a contract change. Bump the plugin version
  (`.claude-plugin/plugin.json`) and re-sync the cache.

## Files

| File | Purpose |
|------|---------|
| [`finding.md`](./finding.md) | Canonical `Finding` shape, `Severity`, `Verdict` enums, field-by-field semantics, validation rules, worked examples, Zod validator specification |
| [`location-key.md`](./location-key.md) | Grammar and helpers for the 6 `location_key` formats: `code`, `db`, `dep`, `ux`, `mon`, `rubric-gap` |
| [`preflight-hash.md`](./preflight-hash.md) | `preflightHash(projectSlug, locationKey)` algorithm — deterministic SHA-256 truncation to 8 hex chars; reference implementation and snapshot test vectors |

## Design-doc anchors

These contracts are derived from — and must stay consistent with:

- [`docs/design/pilot-review-system-design.md`](../../cabin/docs/design/pilot-review-system-design.md) in the consuming project
  - §5 Finding Schema — shape, field semantics, examples
  - §6 Severity Taxonomy — P0/P1/P2/P3 definitions and escalation
  - §7 `location_key` Strategy — format per finding type, stability rules
  - §10 Eljun Integration Protocol — preflight_hash, description-footer format
- [`docs/adr/ADR-0014-pilot-review-orchestration.md`](../../cabin/docs/adr/ADR-0014-pilot-review-orchestration.md) — orchestration decision record

## How agents use these

Reviewer agent prompts declare (in the prose of their body):

> Emit findings as JSON objects matching `halli-workflows:types/finding.md`.
> Use the `location_key` grammar from `halli-workflows:types/location-key.md`.
> Do NOT compute `preflight_hash` yourself — the orchestrator computes it during dedup.

Agents should NOT embed their own copy of the schema; they reference this directory.
When a contract changes (e.g. a new field is added), every reviewer picks it up on the
next session after the plugin cache is re-synced.

## Plugin version policy

- **MINOR bump** (e.g. 1.0.0 → 1.1.0) when fields are **added** (additive — reviewers
  emitting the old shape still validate).
- **MAJOR bump** (e.g. 1.1.0 → 2.0.0) when fields are **renamed or removed** or when
  enum values change in a breaking way.
- Version 1.1.0 publishes this `types/` directory for the first time. See
  `.claude-plugin/plugin.json`.

## Change log

| Plugin version | Change |
|----------------|--------|
| 1.1.0 | Initial publication of `Finding`, `location_key`, and `preflight_hash` contracts (task T1200). |
