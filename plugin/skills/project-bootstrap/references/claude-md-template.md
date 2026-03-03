# {{PROJECT_NAME}} — Engineering Bible

> Supreme rules + context routing. Domain-specific patterns live in directory-level CLAUDE.md files.

## Session Start

1. **Read this file** — always loaded, contains rules that must never be violated
2. **Read `docs/plans/product-roadmap.md`** — find the first unchecked item
3. **Check `git log --oneline -20`** — see what was done recently
4. **Follow the Context Router below** — read domain-specific context for your task

## Context Router (MANDATORY)

| Working on... | Read before starting |
|---------------|---------------------|
| {{DOMAIN_1}} | `{{CLAUDE_MD_PATH_1}}` |
| {{DOMAIN_2}} | `{{CLAUDE_MD_PATH_2}}` |
| Planning / roadmap | `docs/plans/CLAUDE.md` |

## Project Overview

{{PROJECT_DESCRIPTION}}

- **Target users**: {{TARGET_USERS}}
- **Revenue model**: {{REVENUE_MODEL}}
- **Stack**: {{STACK_DESCRIPTION}}
- **Ambition**: {{AMBITION_TIER}} (MVP / Production / Enterprise)

### Current State

**Working**: (updated as work progresses)

**Completed**: (phases/features marked done)

**Next up**: (what to work on next)

---

## Critical Rules

### Rule 1: {{RULE_1_TITLE}}
{{RULE_1_DESCRIPTION}}

### Rule 2: {{RULE_2_TITLE}}
{{RULE_2_DESCRIPTION}}

---

## Anti-Patterns (NEVER DO THESE)

- **{{ANTI_PATTERN_1}}** -> {{WHY_AND_WHAT_INSTEAD}}
- **{{ANTI_PATTERN_2}}** -> {{WHY_AND_WHAT_INSTEAD}}

---

## Coding Standards

### TypeScript
- Strict mode, no `any`, no `@ts-ignore`
- Zod for runtime validation at API boundaries
- Prefer `interface` over `type` for object shapes

### File Naming
- Components: PascalCase (`Button.tsx`)
- Utilities/hooks: camelCase (`useAuth.ts`)
- Pages/routes: lowercase with hyphens

### Database
- Table/column names: `snake_case`
- TypeScript models: `camelCase`
- Always `created_at` and `updated_at` timestamps

### Git
- Branch: `feature/TXXX-short-description`
- Commits: concise, imperative mood
- One logical change per commit
- Never commit secrets

---

## Keeping Docs In Sync (NON-NEGOTIABLE)

When ANY work completes, update ALL of these:
- **`docs/plans/product-roadmap.md`** — check off completed items
- **`docs/plans/backlog.md`** — mark resolved items as `DONE (date)`
- **`docs/plans/tasks/TXXX-*.md`** — check off completed steps
- **This file (`CLAUDE.md`)** — update "Current State" if significant

**Rule: Never close a session with unmarked completed work.**

---

## Key Documents

| Document | Path |
|----------|------|
| Master Roadmap | `docs/plans/product-roadmap.md` |
| Backlog | `docs/plans/backlog.md` |
| Build Testing | `docs/plans/build-testing.md` |
| Infrastructure | `docs/infrastructure.md` |
| PRD | `docs/prd/{{PROJECT_NAME}}-prd.md` |
