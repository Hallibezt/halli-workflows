<!--
  RULE 15 — paste this section into the consuming project's root CLAUDE.md
  immediately AFTER Rule 14 (Deployment Integrity Gate) and BEFORE the
  Anti-Patterns section. Also append the matching anti-pattern bullet at
  the bottom (see end of this file).
-->

### Rule 15: Code-Debt Registry (NON-NEGOTIABLE)

> **No "hopeful comments" without tracking.**
> AI agents (and humans) write `// TODO`, `// known limitation`, `// not yet implemented` as a *substitute* for tracking. Three forces conspire to make these comments rot: no registry (invisible to anyone not reading that line), no enforcement (nothing prevents marking the surrounding feature "done"), no half-life (comments survive refactors and become silently wrong). This rule closes that loop forever.

**The contract**: every deferred-work comment in source code (`.ts`, `.tsx`, `.js`, `.jsx`, `.sql`) MUST have a corresponding entry in `docs/code-debt-registry.md` referenced by a `TD-XXXX` identifier in the comment.

**Comment format**:

```typescript
// TODO(TD-0001): Auto-redirect to /link when JWT refresh returns 401 (revoked).
//                Today silently fails — tablet stays on cached property content.
```

**Registry entry shape** (full template in `docs/code-debt-registry.md`):

```markdown
## TD-0001: <short title>
- **Status**: open
- **Severity**: P1
- **Created**: YYYY-MM-DD
- **Location**: src/path/to/file.ts:NN
- **Description**: <what's the gap, current behavior, why deferred>
- **Resolution criteria**: <how do you know it's done>
- **Linked**: <ADR-XXXX, design doc, issue, optional>
```

**The scanner blocks commit when any of these are present in source code**:

| Category | Patterns |
|---|---|
| Classic markers | `TODO`, `FIXME`, `XXX`, `HACK`, `BUG:` (uppercase + colon/paren required) |
| JSDoc | `@todo`, `@deprecated` |
| Hopeful phrases | `known limitation`, `known issue`, `not yet implemented`, `not implemented`, `in the future`, `future work`, `will need to` |
| Deferred-verb phrases | `should be (refactored|removed|cleaned|moved|implemented|added|handled|fixed|done|wired|migrated|dropped|deleted|reviewed)`, `needs to be <same set>`, `has to be <same set>` |

Each match on a line MUST have a `TD-XXXX` reference on the same line. The `TD-XXXX` MUST exist in `docs/code-debt-registry.md` with status `open`, `in_progress`, or `wontfix-explained`.

**The gate runs automatically in three places**:
- **Pre-commit hook** (`.githooks/pre-commit`) — blocks `git commit` if violations exist
- **Pre-push hook** (`.githooks/pre-push`) — blocks `git push` as defense in depth
- **GitHub Actions** (`.github/workflows/code-debt-check.yml`) — runs on every PR + push to main + daily cron; opens an Issue for P0/P1 debt unresolved >30 days
- **Manual**: `npm run debt:check` (same as the hook)

**Commands**:
- `npm run debt:check` — run the scanner
- `npm run debt:list` — show open entries grouped by severity
- `npm run debt:add` — interactive prompt to create a TD-XXXX entry

**Inline suppression** (use sparingly — e.g., user-facing strings containing "TODO"):
```typescript
const placeholder = "Add a TODO list"; // debt:ignore
// debt:ignore-next-line
const label = "Mark TODO done";
```

**Bypass** (emergency only, document in commit message): `git commit --no-verify`. Using this without justification is a Rule 13 violation (intellectual honesty — "making it work" by hiding the debt).

**Marking a task or roadmap item `[x]` while `npm run debt:check` is red is a Rule 13 violation.** Same standard as Rule 14 — surface the debt, register it, then proceed.

**Status semantics** (full table in `docs/code-debt-registry.md`):
- `open` / `in_progress` — comment must be present in code referencing TD-XXXX
- `resolved` — comment MUST be removed (hook blocks if still present)
- `wontfix-explained` — comment may remain (it documents *why* the code looks unusual); description field MUST contain the reasoning
- `wontfix` — bad smell; hook blocks until promoted to `wontfix-explained` or work is actually done

**The self-check before any commit**:
1. Did I write any new TODO/FIXME or hopeful phrase? → registered with TD-XXXX?
2. Did I delete a code comment that pointed to a TD-XXXX? → marked the registry entry as `resolved`?
3. Does `npm run debt:check` exit 0? → if not, do not mark `[x]` on anything related.

---

<!-- ALSO add this to the Anti-Patterns section of CLAUDE.md: -->

- **Hopeful comments without tracking** -> Every `TODO`/`FIXME`/`known limitation`/`not yet implemented`/`will need to`/etc. MUST have a `TD-XXXX` reference + registry entry. See Rule 15. The pre-commit hook blocks bare debt comments.
