# Code-Debt Registry

> **Every deferred-work comment in this codebase MUST have an entry here.**
> Enforced by `scripts/check-code-debt.ts` (pre-commit + pre-push + CI).
> See CLAUDE.md Rule 15 for the rationale.

---

## How this works

1. **Comment in code** carries a stable identifier:
   ```typescript
   // TODO(TD-0001): Auto-redirect to /link when JWT refresh returns 401 (revoked).
   //                Today silently fails — tablet stays on cached property content.
   ```

2. **Entry in this file** (below) captures the full picture: status, severity, location, description, resolution criteria.

3. **Hooks enforce the link**:
   - Bare `TODO` / `FIXME` / `XXX` / `HACK` / `known limitation` / `not yet implemented` / `in the future` / `future work` / `will need to` / `should be <verb>` / `needs to be <verb>` / `has to be <verb>` / `@todo` / `@deprecated` without a `TD-XXXX` reference → **commit blocked**.
   - `TD-XXXX` in code that doesn't exist in this file → **commit blocked**.
   - `TD-XXXX` in code that's marked `resolved` here → **commit blocked** (remove the comment first).

## Commands

```bash
npm run debt:check      # run the scanner (same as the pre-commit hook)
npm run debt:list       # list open entries grouped by severity
npm run debt:add        # interactive: create a new TD-XXXX entry
```

Inline suppression (use sparingly — e.g., user-facing strings that contain TODO):

```typescript
const placeholder = "Add a TODO list"; // debt:ignore
// debt:ignore-next-line
const todoButtonLabel = "Mark TODO done";
```

## Entry template

Copy-paste this when adding by hand. (Or use `npm run debt:add`.)

```markdown
## TD-XXXX: <Short title — what the deferred work is>

- **Status**: open               <!-- open | in_progress | resolved | wontfix | wontfix-explained -->
- **Severity**: P2                <!-- P0 (security/business-ending) | P1 (correctness) | P2 (UX/polish) | P3 (nice-to-have) -->
- **Created**: YYYY-MM-DD
- **Location**: src/path/to/file.ts:NN   <!-- file:line of the primary code comment -->
- **Description**: One paragraph. What's the gap? What's the current behavior? Why is it deferred?
- **Resolution criteria**: How do you know it's done? (e.g., "401 from refresh endpoint triggers wipeAndRedirectToLink, verified by integration test")
- **Linked**: ADR-XXXX, design doc, eljun task, GitHub issue (any of these, optional)
- **Resolved-by**: (commit hash when status becomes 'resolved')
```

## Status values

| Status | Meaning | In-code comment? |
|---|---|---|
| `open` | Tracked, not started | YES — must reference TD-XXXX |
| `in_progress` | Someone's actively working on it | YES — must reference TD-XXXX |
| `resolved` | Done. Comment must be deleted. | NO — hook blocks if comment still present |
| `wontfix` | Decided not to fix, but no documented reason. **Bad smell** — promote to `wontfix-explained`. | NO — hook blocks |
| `wontfix-explained` | Decided not to fix, with a written reason in the Description. Comment may remain referencing this entry to explain *why* the code looks that way. | YES — allowed |

## Severity values

- **P0** — security boundary, data leak, business-ending. Block release.
- **P1** — correctness failure, broken user flow, observable bug.
- **P2** — UX gap, polish, accessibility, performance.
- **P3** — nice-to-have, cleanup, refactor opportunity.

---

# Open entries

<!-- New entries appended below this line by `npm run debt:add`. Sort newest first by default; bootstrap entries may bulk-import older ones at the bottom. -->

