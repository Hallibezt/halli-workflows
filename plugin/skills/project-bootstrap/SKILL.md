---
name: project-bootstrap
description: Templates and patterns for project skeleton generation — CLAUDE.md structure, doc templates, directory conventions. Used by project-bootstrapper agent during /kickoff.
---

# Project Bootstrap Guide

## CLAUDE.md Structure

The CLAUDE.md is the **engineering bible** — the single source of truth for how the project works. It must be:
- **Concise** — not overloaded. Domain details go in subdirectory CLAUDE.md files.
- **Actionable** — rules with rationale, not just descriptions
- **Maintained** — Current State section updated as work progresses

### Sections (in order)

1. **Session Start** — What to do every session (read this, check roadmap, check git log)
2. **Context Router** — Table mapping work domains to CLAUDE.md files
3. **Project Overview** — What this project is, who it's for, tech stack
4. **Current State** — What's done, what's in progress, what's next
5. **Critical Rules** — Numbered, NON-NEGOTIABLE rules with rationale
6. **Anti-Patterns** — Things to NEVER do with explanation of why
7. **Coding Standards** — TypeScript, file naming, database conventions
8. **Git & Build Rules** — Branch naming, commit style, build cost optimization
9. **Locked Decisions** — ADR reference table
10. **Key Documents** — Table of all important docs with paths

### Key Principles

- **Keep CLAUDE.md under 300 lines** — Use Context Router to offload domain details
- **Rules say WHY** — Not just "don't do X" but "don't do X because Y happens"
- **Anti-patterns are specific** — Include the wrong code AND the right code
- **Update Current State** — After every significant change

## Doc Sync Rules (NON-NEGOTIABLE)

These rules must be baked into EVERY CLAUDE.md:

> When ANY work completes, update ALL of these:
> - `docs/plans/product-roadmap.md` — check off completed items
> - `docs/plans/backlog.md` — mark resolved items as DONE (date)
> - `docs/plans/tasks/TXXX-*.md` — check off completed steps
> - CLAUDE.md — update Current State if significant change
>
> **Rule: Never close a session with unmarked completed work.**

## Pre-Merge Testing Rule

> Before pushing to main:
> 1. Append new section to `docs/plans/build-testing.md`
> 2. Include: description, setup steps, manual testing checklist, notes
> 3. Commit the updated testing doc as part of the branch

## Reference Templates

See the `references/` directory for fill-in-the-blank templates:
- `claude-md-template.md` — CLAUDE.md skeleton
- `roadmap-template.md` — Product roadmap
- `backlog-template.md` — Backlog
- `build-testing-template.md` — Build testing checklist
- `infrastructure-template.md` — Infrastructure doc
