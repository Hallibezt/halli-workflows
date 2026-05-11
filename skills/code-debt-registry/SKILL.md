---
name: code-debt-registry
description: Install Rule 15 (code-debt registry + pre-commit hook) into any halli-workflows project. Stops the agentic "hopeful comments" anti-pattern where TODOs / FIXMEs / known-limitation phrases accumulate in code without ever being tracked. Provides scanner template (scripts/check-code-debt.ts), registry template (docs/code-debt-registry.md), pre-commit hook, CI workflow, and the CLAUDE.md Rule 15 snippet. Use during /kickoff to bake the enforcement in from day one, or as a retrofit on existing projects.
---

# Code-Debt Registry — Rule 15

> Every TODO, FIXME, hopeful-phrase comment in code MUST have a registry entry. Enforced by pre-commit hook. Closes the agentic "I'll come back to this" anti-pattern.

## The problem this solves

AI agents (and humans) leave deferred-work comments in code as a substitute for tracking:

```typescript
// TODO: handle the offline case
// known limitation: doesn't auto-redirect on revoked JWT
// FIXME: race condition in edge case X
```

Three forces conspire to make these rot:

1. **No registry** — invisible to anyone not reading that file:line
2. **No enforcement** — nothing prevents marking the surrounding feature "done"
3. **No half-life** — comments survive refactors, become silently wrong

The triggering case for this skill was GuestPad's reset-and-unlink commit (2026-05-10): a "known limitation" was documented in the route header, never tracked anywhere, and shipped as a real bug a day later. Rule 15 makes that pattern structurally impossible.

## What you install

Six artefacts get copied / adapted into the consuming project:

1. **`scripts/check-code-debt.ts`** — the scanner (see `references/check-code-debt.ts`)
2. **`docs/code-debt-registry.md`** — the registry, starts empty (see `references/code-debt-registry-template.md`)
3. **`.githooks/pre-commit`** — runs the scanner before every commit (see `references/pre-commit`)
4. **`.github/workflows/code-debt-check.yml`** — CI gate (see `references/code-debt-check.yml`)
5. **`package.json` npm scripts** — `debt:check`, `debt:list`, `debt:add`, `debt:json`
6. **CLAUDE.md Rule 15** — the rule itself (see `references/rule-15-claude-md.md`)

The `code-debt-reviewer` agent (cross-project, lives in this plugin) automatically runs as part of `/pilot-review` once the scanner is installed — no per-project configuration needed.

## Installation (15 min for an existing project)

```bash
# From the consuming project's root:

# 1. Copy the scanner
mkdir -p scripts
cp ~/.claude/plugins/cache/halli-workflows/skills/code-debt-registry/references/check-code-debt.ts scripts/

# 2. Copy the empty registry template
mkdir -p docs
cp ~/.claude/plugins/cache/halli-workflows/skills/code-debt-registry/references/code-debt-registry-template.md docs/code-debt-registry.md

# 3. Copy the hook (and chmod +x)
mkdir -p .githooks
cp ~/.claude/plugins/cache/halli-workflows/skills/code-debt-registry/references/pre-commit .githooks/pre-commit
chmod +x .githooks/pre-commit

# 4. Copy the CI workflow
mkdir -p .github/workflows
cp ~/.claude/plugins/cache/halli-workflows/skills/code-debt-registry/references/code-debt-check.yml .github/workflows/

# 5. Add npm scripts to package.json (under "scripts" key):
#      "debt:check": "tsx scripts/check-code-debt.ts --check",
#      "debt:list":  "tsx scripts/check-code-debt.ts --list",
#      "debt:add":   "tsx scripts/check-code-debt.ts --add",
#      "debt:json":  "tsx scripts/check-code-debt.ts --json",
#    (uses tsx; if you use a different TS runner, adjust)

# 6. Append Rule 15 to CLAUDE.md (see references/rule-15-claude-md.md for the
#    exact text to paste; place after Rule 14 / Deployment Integrity Gate)

# 7. Ensure git hooks are wired
#    The hook needs `git config core.hooksPath .githooks` to be active.
#    If your project's postinstall.js doesn't already set this, run:
git config core.hooksPath .githooks
#    (or add `git config core.hooksPath .githooks` to your postinstall script
#     so every fresh clone wires it automatically)

# 8. Bootstrap-scan: find existing debt comments and register them
npm run debt:check       # will fail loudly listing every violation
# For each violation:
npm run debt:add         # interactive — generates next TD-XXXX, adds entry
# Then edit the source comment to reference the new TD-XXXX:
#   // TODO(TD-0042): the description
# Re-run until clean.
```

## Pre-commit hook integration

If your project doesn't have `.githooks/` yet, the standard pattern is to set `core.hooksPath` in a postinstall script so `npm install` activates the hooks automatically. Example `scripts/postinstall.js`:

```javascript
#!/usr/bin/env node
const { execSync } = require("child_process");
try {
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
  console.log("[postinstall] git core.hooksPath set to .githooks");
} catch {
  console.log("[postinstall] git config skipped (not a git repo)");
}
```

And in `package.json`:
```json
"scripts": {
  "postinstall": "node ./scripts/postinstall.js"
}
```

If your project already has `pre-push` (e.g., for the Rule 14 drift gate), extend it to also run `npm run debt:check` — see `references/pre-commit` for the pattern.

## Patterns the scanner catches

| Category | Patterns |
|---|---|
| Classic markers | `TODO[:(]`, `FIXME[:(]`, `XXX:`, `HACK[:(]`, `BUG:` (uppercase + colon/paren required) |
| JSDoc | `@todo`, `@deprecated` |
| Hopeful phrases | `known limitation`, `known issue`, `not yet implemented`, `not implemented`, `in the future` (excludes "is/are in the future" state-describing), `future work`, `will need to` |
| Deferred verbs | `should be <action-verb>`, `needs to be <action-verb>`, `has to be <action-verb>` |

Each match on a line MUST have a `TD-XXXX` reference, and that TD-XXXX MUST exist in `docs/code-debt-registry.md` with status `open`, `in_progress`, or `wontfix-explained`.

## Inline suppression

For genuine false positives (user-facing strings containing TODO, etc.):

```typescript
const placeholder = "Add a TODO list"; // debt:ignore
// debt:ignore-next-line
const buttonLabel = "Mark TODO done";
```

Use sparingly. Prefer registering with `wontfix-explained` status when the pattern is intentional and should stay.

## Bypass policy

`git commit --no-verify` bypasses all hooks (including this one). It is reserved for genuine emergencies and MUST be documented in the commit message. Using `--no-verify` to ship unregistered debt is a Rule 13 violation (intellectual honesty — "making it work" by hiding the gate).

## Status semantics

| Status | Meaning | Comment present in code? |
|---|---|---|
| `open` | Tracked, not started | YES — comment references TD-XXXX |
| `in_progress` | Active work | YES |
| `resolved` | Done — comment MUST be removed | NO — hook blocks if present |
| `wontfix-explained` | Decided not to fix, written reason in Description | YES (allowed — documents *why* code looks unusual) |
| `wontfix` | Decided not to fix, no reason | NO — bad smell, hook blocks until promoted to `wontfix-explained` |

## Severity scale

- **P0** — security boundary, data leak, business-ending. Block release.
- **P1** — correctness failure, broken user flow, observable bug.
- **P2** — UX gap, polish, accessibility, performance.
- **P3** — nice-to-have, cleanup, refactor opportunity.

## Pilot-review integration

The `code-debt-reviewer` agent (in this plugin) runs automatically as part of `/pilot-review` once the scanner is installed. It:

- Shell-outs to `npm run debt:json`
- Maps each violation to a canonical Finding
- Tags severity P1 for unregistered / resolved-but-present / wontfix-but-present, P2 for orphan-tdid
- Files P0/P1 findings to eljun, P2 to backlog, P3 to review-notes (standard orchestrator routing)

No per-project configuration needed beyond installing the scanner.

## When NOT to use Rule 15

- Trivial throwaway scripts (one-off data migrations, debug snippets).
- Code generated by external tools that you don't edit (`src/generated/`). Add to `EXCLUDED_PATHS` in the scanner.
- Documentation files (`.md`). The scanner ignores these by default — markdown discusses future work legitimately.

## Reference files

- `references/check-code-debt.ts` — the scanner (copy verbatim, no edits needed for most projects)
- `references/code-debt-registry-template.md` — empty registry skeleton with the format spec
- `references/pre-commit` — the hook (copy verbatim, chmod +x after copy)
- `references/code-debt-check.yml` — CI workflow (uses your project's Node + npm setup; mirror your existing drift-check.yml secrets if you have one)
- `references/rule-15-claude-md.md` — the CLAUDE.md Rule 15 snippet (copy into root CLAUDE.md after Rule 14)
