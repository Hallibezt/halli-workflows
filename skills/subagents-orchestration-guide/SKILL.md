---
name: subagents-orchestration-guide
description: Guides subagent coordination through implementation workflows. Defines scale determination, document requirements, stop points, autonomous execution mode, and the verification loop pattern.
---

# Subagents Orchestration Guide

## Role: The Orchestrator

**The orchestrator coordinates subagents like a conductor — directing the musicians without playing the instruments.**

All investigation, analysis, and implementation work flows through specialized subagents.

### First Action Rule

**Every new task begins with requirement-analyzer.**

### Automatic Responses

| Trigger | Action |
|---------|--------|
| New task | Invoke **requirement-analyzer** |
| Flow in progress | Check scale table for next subagent |
| Phase completion | Delegate to next subagent |
| Stop point reached | Wait for user approval |
| Quality error | Invoke **quality-fixer** |

## Available Subagents (23 Total)

### New Agents (halli-dev-workflows additions)
1. **brainstorm-facilitator**: Interactive project brainstorming with competitive analysis
2. **project-bootstrapper**: Project skeleton creation (CLAUDE.md, docs, PRD)
3. **infra-planner**: Infrastructure recommendations with scale matrix
4. **maintenance-auditor**: Project health check (deps, APIs, code, infra)
5. **retro-analyzer**: Retrospective analysis and self-learning
6. **workflow-guide**: Meta-agent for workflow navigation

### Implementation Agents
7. **task-executor**: Individual task implementation with stack awareness
8. **quality-fixer**: Self-contained quality assurance until all checks pass
9. **task-decomposer**: Work plan decomposition into atomic tasks
10. **integration-test-reviewer**: Test quality review

### Document Creation Agents
11. **requirement-analyzer**: Requirement analysis with ambition tier awareness
12. **prd-creator**: Product Requirements Document creation
13. **technical-designer**: ADR/Design Doc creation (stack-aware)
14. **work-planner**: Work plan with phases, build-testing, doc sync
15. **document-reviewer**: Document quality and rule compliance
16. **design-sync**: Cross-document consistency verification
17. **acceptance-test-generator**: Test skeleton generation (stack-aware)

### Diagnosis Agents
18. **investigator**: Evidence collection with anti-pattern awareness
19. **verifier**: ACH + Devil's Advocate verification
20. **solver**: Solution derivation with project rule compliance

### Support Agents
21. **rule-advisor**: Metacognitive rule selection from CLAUDE.md + skills
22. **code-reviewer**: Design Doc compliance + verification loop
23. **code-verifier**: Document-code consistency matching
24. **scope-discoverer**: Codebase scope discovery for reverse engineering

## Sub-Phase Decomposition (MANDATORY CHECK)

**Large phases MUST be broken into sub-phases.** A monolithic phase with 15+ tasks or 3+ sprints is too big to plan, build, and test in one pass. This is the #1 cause of stalled work and context overflow.

### When to Decompose

| Indicator | Threshold | Action |
|-----------|-----------|--------|
| Backlog items | >15 items in phase | MUST decompose |
| Sprint count | >2 sprints | MUST decompose |
| File count | >20 files touched | MUST decompose |
| Design doc size | >1500 lines | SHOULD decompose |
| Mixed concerns | Auth + UI + API + infra in one phase | MUST decompose |

### Sub-Phase Rules

1. **Each sub-phase is 5-15 tasks**, completable in 1-2 sprints
2. **Each sub-phase goes through the full cycle**: plan → build → test → manual test → approve
3. **Each sub-phase produces independently testable functionality** — you can run the app and see something work
4. **Sub-phases are named**: Phase 1A, 1B, 1C (or descriptive: "Phase 1A — Skeleton + Auth")
5. **Design docs cover the full phase** but are structured with clear sub-phase sections
6. **Work plans are created per sub-phase**, not per phase — plan 1A, build 1A, then plan 1B
7. **Dependencies flow forward** — sub-phase B can depend on A, but not vice versa

### Decomposition Pattern

Group by **dependency layers**, not by feature:

```
Sub-phase A: Foundation (scaffold, config, auth, DB schema)
    ↓ A must work before B starts
Sub-phase B: Core data (CRUD for primary entities)
    ↓ B must work before C starts
Sub-phase C: Core features (the main value prop)
    ↓ C must work before D starts
Sub-phase D: Enhancement (secondary features, polish)
    ↓ D must work before E starts
Sub-phase E: Launch prep (monitoring, CI, store submission)
```

Each sub-phase delivers a working increment. After A, you have auth. After B, you can add data. After C, the app is usable. After D, it's polished. After E, it ships.

### Orchestrator Responsibility

The orchestrator (not the user) checks phase size during `/design` and `/plan`. If thresholds are exceeded:
1. **Stop and propose sub-phases** with names and scope
2. **Get user approval** on the breakdown
3. **Proceed with first sub-phase only**

## Scale Determination and Document Requirements

| Scale | Files | PRD | ADR | Design Doc | Work Plan |
|-------|-------|-----|-----|-----------|-----------|
| Small | 1-2 | Update if exists | Not needed | Not needed | Simplified |
| Medium | 3-5 | Update if exists | Conditional* | **Required** | **Required** |
| Large | 6+ | **Required** | Conditional* | **Required** | **Required** |

*Conditional: When architecture changes, new tech, or data flow changes.

### Ambition Tier Adjustments

| | MVP | Production | Enterprise |
|-|-----|-----------|-----------|
| PRD threshold | 6+ files | 6+ files | Always (new features) |
| Design Doc threshold | 5+ files | 3+ files | Always |
| Test coverage | Unit basics | Unit + integration | Unit + int + E2E |
| Doc ceremony | Roadmap + backlog | Full doc sync | Full + build testing |

## Explicit Stop Points

| Phase | Stop Point | User Action |
|-------|-----------|-------------|
| Requirements | After requirement-analyzer | Confirm requirements |
| PRD | After document-reviewer | Approve PRD |
| ADR | After document-reviewer (if ADR) | Approve ADR |
| Design | After design-sync | Approve Design Doc |
| Work Plan | After work-planner | Batch approval for implementation |

**After batch approval**: Autonomous execution proceeds without stops until completion or escalation.

## Autonomous Execution Mode

### Pre-Execution Check
- Commit capability available?
- Quality check tools available?
- Test runner available?

### 4-Step Task Cycle

```
For EACH task:
  1. task-executor → Implementation
  2. Escalation check → status ok? integration tests?
  3. quality-fixer → Quality check and fixes
  4. git commit → On approved: true
```

**Rules**:
- ONE task at a time
- quality-fixer MUST run after each task-executor
- Commit on quality-fixer `approved: true`
- Update task file checkboxes after each task

### Stopping Conditions
1. Sub-agent returns `escalation_needed` or `blocked`
2. Requirement change detected
3. User explicitly stops

## The Verification Loop (CRITICAL PATTERN)

After autonomous execution completes:

```
Implementation complete → code-reviewer checks compliance
                              ↓
                        Report to user
                              ↓
                   User: "Fix these" or "Looks good"
                              ↓
               [If fix] → task-executor → quality-fixer → code-reviewer
```

The implementing agent is blind to its own gaps. The review agent catches them. This loop typically runs 1-2 times before everything is clean.

## Doc Sync (NON-NEGOTIABLE)

After ANY work completes, the orchestrator MUST ensure:
- [ ] `docs/plans/product-roadmap.md` updated
- [ ] `docs/plans/backlog.md` updated
- [ ] Task files checked off
- [ ] CLAUDE.md Current State updated (if significant)
- [ ] `docs/plans/build-testing.md` appended (if merge point)

## Requirement Change Detection

During flow execution, if user mentions:
- New features/behaviors
- New constraints/conditions
- Technical requirement changes

→ **Stop flow** → Restart from requirement-analyzer with integrated requirements.

## Information Passing Between Agents

- Convert output to input format for next agent
- Always pass deliverables from previous step
- Use structured JSON for agent communication
- Orchestrator composes commit messages from task-executor's `changeSummary`
