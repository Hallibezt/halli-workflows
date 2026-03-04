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
6. **Doc sync after completion** — update roadmap, backlog, task files (NON-NEGOTIABLE)

**CRITICAL**: Execute all steps, sub-agents, and stopping points defined in flows. After completion, ALWAYS update docs.

## Pre-Flight: Project Context

Before any work:
```bash
# Read project context
! cat CLAUDE.md | head -50
# Check recent work
! git log --oneline -10
# Check roadmap
! ls docs/plans/product-roadmap.md 2>/dev/null
```

Load relevant domain CLAUDE.md files per Context Router.

## Execution Decision Flow

### 1. Current Situation Assessment

Instruction Content: $ARGUMENTS

**Think deeply** Assess the current situation:

| Situation | Criteria | Next Action |
|-----------|----------|-------------|
| New Requirements | No existing work, new feature/fix request | Start with requirement-analyzer |
| Flow Continuation | Existing docs/tasks, continuation directive | Identify next step in flow |
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

### 3.5. Sub-Phase Decomposition Check

After requirements are confirmed, check if the scope exceeds sub-phase thresholds (see subagents-orchestration-guide):
- >15 backlog items, >2 sprints, >20 files, or mixed concerns → **MUST decompose**

If decomposition needed:
1. Propose sub-phases (5-15 tasks each, named, with clear boundaries)
2. **[Stop: User approves sub-phase breakdown]**
3. Design covers full phase, but plan/build cycle runs per sub-phase

### 4. Scale-Based Flow

Follow subagents-orchestration-guide for the determined scale:

#### Large Scale (6+ Files)
1. requirement-analyzer **[Stop: Confirm]**
2. Sub-phase decomposition check **[Stop: Approve breakdown, if needed]**
3. prd-creator → document-reviewer **[Stop: Approve PRD]**
4. technical-designer → document-reviewer → design-sync **[Stop: Approve Design]**
5. **For each sub-phase**:
   a. acceptance-test-generator → work-planner **[Stop: Approve Plan]**
   b. **Autonomous execution mode**
   c. Post-build verification + doc sync
   d. **[Stop: Sub-phase complete, proceed to next?]**

#### Medium Scale (3-5 Files)
1. requirement-analyzer **[Stop: Confirm]**
2. technical-designer → document-reviewer → design-sync **[Stop: Approve Design]**
3. acceptance-test-generator → work-planner **[Stop: Approve Plan]**
4. **Autonomous execution mode**

#### Small Scale (1-2 Files)
1. Simplified plan **[Stop: Approve]**
2. **Direct implementation**

### 5. Register All Flow Steps to TodoWrite (MANDATORY)

After scale determination, register all steps as TodoWrite items.

### 6. Autonomous Execution: 4-Step Cycle

For EACH task:
```
1. task-executor → Implementation
2. Escalation check → Verify task-executor status
3. quality-fixer → Quality check and fixes
4. git commit → On approved: true
```

**Rules**:
- ONE task at a time, fully complete before next
- quality-fixer MUST run after each task-executor
- Commit when quality-fixer returns `approved: true`

### 7. Post-Implementation Verification (MANDATORY)

After all tasks complete:
1. **Invoke code-reviewer** — verify Design Doc compliance
2. **Report findings to user** — show compliance score and issues
3. **Ask user**: "Should we address these issues?" → If yes, loop back to fix

This is the **verification loop** — the implementing agent is blind to its own gaps. The review agent catches them.

### 8. Doc Sync (NON-NEGOTIABLE)

After implementation is approved:
- [ ] Update `docs/plans/product-roadmap.md` — check off completed items
- [ ] Update `docs/plans/backlog.md` — mark resolved items
- [ ] Update task files — check off completed steps
- [ ] Update CLAUDE.md "Current State" if significant change
- [ ] Append build-testing.md section if this is a merge point

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
- Tasks implemented: [N]
- Quality checks: All passed
- Verification: [compliance score]%
- Docs updated: roadmap, backlog, task files
- Build testing: [appended / not needed]

Next: Run /review for deep verification, or /retro for retrospective.
```
