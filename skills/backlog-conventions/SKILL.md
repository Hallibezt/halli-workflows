---
name: backlog-conventions
description: Canonical shape, status values, and length limits for backlog.md entries. Use when creating or updating backlog items, when /implement / /build / /maintain / /kickoff touch backlog.md, when pilot-review writes P2 findings, or when triaging an existing backlog.
---

# Backlog Conventions

> Every project the halli-workflows plugin manages writes its active TODO
> list into `docs/plans/backlog.md`. Multiple agents read and write that
> file: `/implement` flips items TODO → IN PROGRESS → DONE, `/maintain`
> appends new items, `/pilot-review` writes P2 findings into it, and the
> work-planner agent creates initial TODO entries from a work plan.
> Without a canonical shape, the file rots: design docs get embedded as
> backlog entries, DONE items pile up alongside active ones, every
> contributor improvises a different layout, and the agents can no longer
> reliably parse "the next item to work on."
>
> This file is the canonical shape. Every backlog write from a halli-workflows
> agent or command MUST conform.

## Status values (CANONICAL — no synonyms)

Exactly one of:

| Value | Meaning |
|---|---|
| `TODO` | Not started |
| `IN PROGRESS` | Currently being worked on (set by `/implement` when a phase starts) |
| `IN REVIEW` | Implemented, waiting for manual verify (set by `/implement` when phase gate passes) |
| `DONE (YYYY-MM-DD)` | User confirmed it works, with ISO date |
| `BLOCKED (reason)` | Can't progress; reason inline |
| `WONTFIX (reason)` | Decided not to do; reason inline |
| `DEPRECATED (reason)` | Was a problem; no longer relevant; reason inline |

**Forbidden**: emoji statuses (🚧 ✅ ❌), strikethrough (`~~done~~`), free-text statuses
("almost done", "kind of fixed"), `PARTIAL` (split into separate items instead),
`DEFERRED` (use `BLOCKED` with the unblocker as the reason).

## Item shape (CANONICAL — one of two)

### Shape A — table row in a clustered table

For groups of related items (security findings, DB integrity issues, pilot-review batch):

```markdown
### Security (CRITICAL)

| ID  | Area      | Issue                                    | Severity | Status        |
|-----|-----------|------------------------------------------|----------|---------------|
| I42 | API auth  | /api/foo missing rate limit              | High     | TODO          |
| I43 | RLS       | Owner moderation policy join broken      | Medium   | DONE (2026-03-12) |
```

Required column order: `ID | Area | Issue | Severity | Status`. Optional trailing
column `Notes` for inline detail (commit SHA, blocking ticket, etc.).

**Machine-generated variant**: `/pilot-review`'s `backlog-appender` writes wider
tables (`# | Agent | Heuristic | Location | Evidence | Witnesses | Fix | Severity | Status`)
because the extra columns carry idempotency-critical metadata (hash markers,
witness counts). That variant is allowed — every other section follows the
5-column canonical form.

### Shape B — single bullet with inline status tag

For one-off items:

```markdown
- **[TODO P2]** Tablet command broadcast — unauthenticated sends possible. Affects:
  `src/lib/realtime/tablet-cmd.ts`. Owner: -.
```

Format: `- **[STATUS PRIORITY]** Title — body (≤ 3 lines including title).`

Priority is the severity tag (see below). Body must include enough context for the
next session to act on the item: which file(s), what change, what blocks it.

## Length limit (HARD)

**If an item needs >3 lines of context, it is a DESIGN DOC, not a backlog item.**

Lift the content to `docs/design/<name>.md` and leave a one-line pointer in the backlog:

```markdown
- **[TODO P3]** Rotating Screensaver product line — design at
  `docs/design/rotating-screensaver.md`. Status: scoping.
```

Forbidden in backlog items:
- Embedded code blocks longer than 3 lines
- Mockups / ASCII diagrams
- Data-model sketches
- Multi-paragraph rationale
- Phase breakdowns
- Open-questions lists

If you find yourself writing these, you're writing a design doc. Extract it.

## Severity tags

Optional in tables (use the `Severity` column instead). Required in shape-B bullets.

| Tag | Meaning |
|---|---|
| `P0` | Production-broken / security / data-loss |
| `P1` | Blocks a current sprint or shipped feature |
| `P2` | Quality / hygiene / known limitation |
| `P3` | Polish / nice-to-have / speculative |

## File layout

```
docs/plans/backlog.md           — active items (TODO, IN PROGRESS, IN REVIEW, BLOCKED)
docs/plans/backlog-archive.md   — append-only DONE / WONTFIX / DEPRECATED history
```

When a table-row item is marked `DONE`, you MAY move it to the archive (recommended
when the parent cluster has >10 DONE rows — keeps the active backlog scannable).
Recent DONE items (≤30 days) stay in the active backlog for visibility.

Single-bullet items: leave them in place when marked DONE; let the next maintain
pass sweep them to the archive.

## Section structure

`docs/plans/backlog.md` organizes by THEME, not by status or phase:

```markdown
# <Project> Backlog — Issues, Gaps & Polish Items

> One-sentence purpose. Last triaged: YYYY-MM-DD.

## 🚦 Current focus — <what's actively being worked on>

Two-paragraph max. Points to the work plan / branch / commits.

## <Theme 1>

(Tables or bullets. Themes correspond to subsystems: Security, Database,
API, UX, Tablet Hardware, etc.)

## <Theme 2>

...
```

No "Phase X" sections in backlog.md — phases belong in roadmap / work plans.
The backlog is the cross-cutting "what's broken, what's missing, what's polish."

## What halli-workflows agents assume

When reading `backlog.md`, agents assume:
- Every item is either shape A or shape B
- Status is exactly one of the seven canonical values
- Item body is parseable in ≤3 lines (longer items have a design-doc pointer)
- Severity is one of `P0..P3` or in a `Severity` column
- `/pilot-review` writes P2 findings as shape-B bullets at the bottom of the
  most-relevant theme section

If an agent encounters an item that doesn't conform, it should flag it (don't
silently re-write).

## Triage cycle (every 60 days or before any major release)

A backlog rots without periodic triage. Run a triage pass:

1. Walk every active section
2. For each item, ask:
   - Is the problem still real? (grep the codebase — the fix may have shipped)
   - Is the severity still right?
   - Is the status accurate?
3. For DONE items >30 days old: move to `backlog-archive.md`
4. For items that don't fit shape A or B: reshape or extract to design doc
5. Update the "Last triaged: YYYY-MM-DD" header

## Where this rule is enforced

| Touchpoint | Action |
|---|---|
| `/kickoff` (`project-bootstrapper` agent) | Creates `backlog.md` skeleton with this shape baked in |
| `/implement` (orchestrator) | Reads backlog to find items linked from phase manifests; flips status |
| `/build` (orchestrator) | Updates backlog.md status as tasks complete |
| `/maintain` (orchestrator) | Appends new items in shape A/B; never reshapes existing |
| `/pilot-review` (orchestrator) | Writes P2 findings as shape-B bullets |
| `work-planner` agent | Creates initial TODO entries for new work plans |
| `monitoring-reviewer` agent | References backlog when checking alert-noise items |

Each touchpoint should reference this skill (`halli-workflows:backlog-conventions`)
rather than duplicating the rule.
