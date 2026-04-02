---
name: implement
description: Orchestrate the complete implementation lifecycle from requirements to deployment
---

**Command Context**: Full-cycle implementation management (Requirements Analysis → Design → Planning → Implementation → Quality Assurance → Doc Sync)

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

**Execution Protocol**:
1. **Read project context** — check CLAUDE.md for stack, rules, and context router
2. **Delegate all work** to sub-agents (orchestrator role only, no direct implementation)
3. **Follow subagents-orchestration-guide skill flows exactly**
4. **Stop at every `[Stop: ...]` marker** — wait for user approval
5. **Enter autonomous mode** only after batch approval for implementation phase
6. **Phase-aware execution** — loop per phase, not per task list
7. **Phase gate after each phase** — light review before proceeding
8. **Backlog updates are automatic** — status transitions happen during execution, not at the end

**CRITICAL**: Execute all steps, sub-agents, and stopping points defined in flows. Backlog and doc sync happen continuously, not just at the end.

## Pre-Flight: Project Context

Before any work:
```bash
# Read project context
! cat CLAUDE.md | head -50
# Check recent work
! git log --oneline -10
# Check roadmap
! ls docs/plans/product-roadmap.md 2>/dev/null
# Check for existing phase manifest
! cat docs/plans/tasks/_phase-manifest.md 2>/dev/null
```

Load relevant domain CLAUDE.md files per Context Router.

## Execution Decision Flow

### 1. Current Situation Assessment

Instruction Content: $ARGUMENTS

**Think deeply** Assess the current situation:

| Situation | Criteria | Next Action |
|-----------|----------|-------------|
| New Requirements | No existing work, new feature/fix request | Start with requirement-analyzer |
| Flow Continuation | Existing docs/tasks, continuation directive | Read phase manifest, identify next phase |
| Quality Errors | Error detection, test failures, build errors | Execute quality-fixer |
| Ambiguous | Intent unclear | Confirm with user |

### 2. Ambition Tier Check

Check CLAUDE.md for project's ambition tier. This affects the flow:

| Tier | PRD Required | ADR Required | Design Doc | Test Coverage | Doc Ceremony |
|------|-------------|-------------|------------|---------------|-------------|
| MVP | Only if 6+ files | Only if arch change | If 3+ files | Basic units | Roadmap + backlog |
| Production | If 6+ files | If arch change | If 3+ files | Unit + integration | Full doc sync |
| Enterprise | Always for new features | If arch change | Always | Unit + integration + E2E | Full + build testing |

### 3. Requirement Analysis

**Invoke requirement-analyzer** with ambition tier context:
- Include project stack info from CLAUDE.md
- Include ambition tier for document determination
- Include relevant anti-patterns

**[Stop: Review requirements, confirm scope and scale]**

### 4. Scale-Based Flow

Follow subagents-orchestration-guide for the determined scale:

#### Large Scale (6+ Files)
1. requirement-analyzer **[Stop: Confirm]**
2. prd-creator → document-reviewer **[Stop: Approve PRD]**
3. technical-designer → document-reviewer → design-sync **[Stop: Approve Design]**
4. acceptance-test-generator → work-planner **[Stop: Approve Plan + Phase Manifest]**
5. **Phase-aware execution** (see §6 below)

#### Medium Scale (3-5 Files)
1. requirement-analyzer **[Stop: Confirm]**
2. technical-designer → document-reviewer → design-sync **[Stop: Approve Design]**
3. acceptance-test-generator → work-planner **[Stop: Approve Plan + Phase Manifest]**
4. **Phase-aware execution** (see §6 below)

#### Small Scale (1-2 Files)
1. Simplified plan **[Stop: Approve]**
2. **Direct implementation** (single phase, no manifest needed)

### 5. Register All Flow Steps to TodoWrite (MANDATORY)

After scale determination, register all steps as TodoWrite items.

### 6. Phase-Aware Execution Loop

**This is the core execution engine.** Read the phase manifest and loop per phase.

```
for each phase in _phase-manifest.md:

  ┌─ PHASE START ──────────────────────────────────┐
  │                                                 │
  │  1. Update backlog: phase items → IN PROGRESS   │
  │                                                 │
  │  2. For each task in this phase:                │
  │     a. task-executor → implement                │
  │     b. escalation check                         │
  │     c. quality-fixer → quality check            │
  │     d. git commit (if approved: true)           │
  │     e. mark task file steps [x]                 │
  │                                                 │
  │  3. Phase Gate (light review)                   │
  │     → code-reviewer in phase-gate mode          │
  │     → check ONLY this phase's acceptance gate   │
  │     → from the manifest                         │
  │                                                 │
  │  4. Update backlog: phase items → IN REVIEW     │
  │                                                 │
  │  5. [Stop: Present phase gate results]          │
  │     Show:                                       │
  │     - Phase gate compliance score               │
  │     - Gaps found (if any)                       │
  │     - Edge cases the design didn't catch        │
  │     - Backlog items now IN REVIEW               │
  │                                                 │
  │  6. User confirms → mark DONE (date)            │
  │     OR flags issues → fix loop before next phase│
  │                                                 │
  └─────────────────────────────────────────────────┘
```

**Rules**:
- ONE task at a time within a phase, fully complete before next
- quality-fixer MUST run after each task-executor
- Commit when quality-fixer returns `approved: true`
- Phase gate runs AFTER all tasks in the phase pass quality checks
- NEVER proceed to the next phase without user confirmation at the stop point
- If user flags issues at the phase gate, create fix tasks and execute them before proceeding

### Phase Gate Invocation

```
subagent_type: code-reviewer
prompt: |
  MODE: phase-gate (light review — NOT full compliance audit)

  Phase: [N] — [Phase Name]
  Design Doc: [path]
  Acceptance gate criteria: [from manifest]
  Tasks completed: [list]
  Files modified: [list from task-executor outputs]

  Check ONLY:
  1. Are this phase's acceptance gate criteria met?
  2. Any obvious gaps between design doc and implementation?
  3. Edge cases the design didn't address that the implementation reveals?
  4. Any anti-pattern violations in the modified files?

  Do NOT check: doc sync, build testing, full roadmap compliance (those happen at the end).

  Return a focused report: pass/fail, gaps found, edge cases discovered.
```

### 7. Post-Implementation Verification (MANDATORY)

After ALL phases complete:
1. **Invoke code-reviewer** in full mode — verify complete Design Doc compliance
2. **Report findings to user** — show compliance score and issues
3. **Ask user**: "Should we address these issues?" → If yes, loop back to fix

This is the **full verification loop** — catches anything the phase gates missed.

### 8. Doc Sync (NON-NEGOTIABLE)

After implementation is approved:
- [ ] Update `docs/plans/product-roadmap.md` — check off completed items
- [ ] Update backlog — all items should already be `DONE (date)` from phase gates
- [ ] Verify backlog consistency — no items stuck in `IN PROGRESS` or `IN REVIEW`
- [ ] Update task files — check off completed steps
- [ ] Update CLAUDE.md "Current State" if significant change
- [ ] Append build-testing.md section if this is a merge point

### 9. Cleanup Phase Manifest

After all work is complete:
- Add completion date to `_phase-manifest.md`
- Mark all phases as complete
- This manifest becomes the historical record of this implementation

## Backlog Status Transitions

The implement command manages these transitions automatically:

```
TODO ──── phase starts ────→ IN PROGRESS
IN PROGRESS ── phase gate passes ──→ IN REVIEW
IN REVIEW ──── user confirms ────→ DONE (date)
```

**Format**: Use exactly `TODO | IN PROGRESS | IN REVIEW | DONE (date)` in backlog files.
No emoji, no strikethrough. Machine-readable.

**Where to update**: Find backlog items by cross-referencing the phase manifest's
"Backlog items" field with the project's backlog file(s). Check CLAUDE.md for
which backlog files exist (some projects have multiple — update ALL relevant ones).

## CRITICAL Sub-agent Invocation Constraints

**MANDATORY suffix for ALL sub-agent prompts**:
```
[SYSTEM CONSTRAINT]
This agent operates within implement command scope. Check CLAUDE.md for project-specific rules.
Stack: [project stack from CLAUDE.md]
Ambition: [MVP/Production/Enterprise]
```

## Completion Report

```
Implementation complete.
- Scale: [small/medium/large]
- Phases completed: [N]
- Tasks implemented: [N]
- Quality checks: All passed
- Phase gates: All passed
- Final verification: [compliance score]%
- Backlog: All items → DONE
- Docs updated: roadmap, backlog, task files

Next: Run /review for deep verification, or /retro for retrospective.
```
