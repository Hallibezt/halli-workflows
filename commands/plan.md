---
name: plan
description: Create work plan from design document with phased roadmap approach
---

**Command Context**: Planning phase — design doc to executable work plan with phases

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

**Execution Protocol**:
1. **Delegate all work** to sub-agents (NEVER create plans yourself)
2. **Plans map to roadmap phases** — each plan becomes a phase in product-roadmap.md
3. **Include build-testing section** in every plan
4. **Stop and obtain approval** before completion
5. **Scope**: Complete when work plan receives approval

## Execution Process

### Step 1: Design Document Selection

```bash
# Check for design documents
! ls -la docs/design/*.md 2>/dev/null | head -10
# Check product roadmap for context
! cat docs/plans/product-roadmap.md 2>/dev/null | head -30
# Check for existing sub-phase breakdown
! grep -i "sub-phase\|subphase\|phase.*[A-E]" docs/design/*.md 2>/dev/null | head -10
```

- Check for design documents, notify user if none exist
- Present options if multiple exist (can be specified with $ARGUMENTS)

### Step 2: Sub-Phase Check

**MANDATORY**: Before planning, check if the phase needs sub-phase decomposition (see subagents-orchestration-guide).

If the design doc already defines sub-phases:
- Plan **one sub-phase at a time** — start with the first incomplete sub-phase
- Each `/plan` invocation covers ONE sub-phase

If sub-phases are NOT yet defined but thresholds are exceeded (>15 items, >2 sprints, >20 files):
- **Stop and propose sub-phases** before planning
- **[Stop: User approves sub-phase breakdown]**
- Then plan the first sub-phase

If the phase is small enough (<=15 items, <=2 sprints):
- Plan the whole phase as one unit (no decomposition needed)

### Step 3: Test Skeleton Generation

- Confirm with user whether to generate test skeletons
- If yes: **Invoke acceptance-test-generator** with the design doc (scoped to current sub-phase)
- Pass generation results to work-planner

### Step 4: Work Plan Creation

**Invoke work-planner** with:
- Design document (or sub-phase section of design document)
- **Sub-phase scope** — which sub-phase this plan covers (e.g., "Phase 1A — Skeleton + Auth")
- Test skeleton paths (if generated)
- Ambition tier (from CLAUDE.md)
- Product roadmap context (existing phases, what's done)

**Work plan MUST include**:
1. **Sub-phase identification** — which sub-phase this plan covers (or "full phase" if no decomposition)
2. **Task breakdown** — individual tasks with acceptance criteria (5-15 tasks per sub-phase)
3. **Build testing section** — what to test before merge, following build-testing-template
4. **Dependencies** — what blocks what
5. **Definition of Done** — what "this sub-phase is complete" looks like (testable criteria)
6. **Doc sync checklist** — which docs to update when done

**Work plan file**: `docs/plans/phase-1a-skeleton-auth.md` (named by sub-phase, not generic).
**Task files**: `docs/plans/tasks/TXXX-short-description.md` where XXX is sequential.

**[Stop: User reviews and approves plan]**

### Step 5: Roadmap Update

After plan approval:
- Update `docs/plans/product-roadmap.md` with the sub-phase (if not already there)
- Mark sub-phase as "In Progress"

## Completion

```
Planning phase completed.
- Sub-phase: [name] (or "full phase" if no decomposition)
- Work plan: docs/plans/[sub-phase-name].md
- Tasks: [N] task files in docs/plans/tasks/
- Sub-phase: [name] marked In Progress
- Status: Approved

Next: Run /build to execute tasks.
After build completes: Run /plan again for the next sub-phase.
```

## Completion Criteria

- [ ] Design document identified and read
- [ ] Sub-phase decomposition checked (mandatory)
- [ ] Test skeletons generated (if requested)
- [ ] Work plan created for ONE sub-phase with tasks, build-testing section, definition of done
- [ ] Task files created in docs/plans/tasks/
- [ ] User approved plan
- [ ] Roadmap updated
