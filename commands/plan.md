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
```

- Check for design documents, notify user if none exist
- Present options if multiple exist (can be specified with $ARGUMENTS)

### Step 2: Test Skeleton Generation

- Confirm with user whether to generate test skeletons
- If yes: **Invoke acceptance-test-generator** with the design doc
- Pass generation results to work-planner

### Step 3: Work Plan Creation

**Invoke work-planner** with:
- Design document
- Test skeleton paths (if generated)
- Ambition tier (from CLAUDE.md)
- Product roadmap context (existing phases, what's done)

**Work plan MUST include**:
1. **Phase mapping** — which roadmap phase this plan covers
2. **Task breakdown** — individual tasks with acceptance criteria
3. **Build testing section** — what to test before merge, following build-testing-template
4. **Dependencies** — what blocks what
5. **Doc sync checklist** — which docs to update when done

**Task files**: `docs/plans/tasks/TXXX-short-description.md` where XXX is sequential.

**[Stop: User reviews and approves plan]**

### Step 4: Roadmap Update

After plan approval:
- Update `docs/plans/product-roadmap.md` with the new phase (if not already there)
- Mark phase as "In Progress"

## Completion

```
Planning phase completed.
- Work plan: docs/plans/[plan-name].md
- Tasks: [N] task files in docs/plans/tasks/
- Phase: [phase name] marked In Progress
- Status: Approved

Next: Run /build to execute tasks, or /implement to continue full lifecycle.
```

## Completion Criteria

- [ ] Design document identified and read
- [ ] Test skeletons generated (if requested)
- [ ] Work plan created with phases, tasks, build-testing section
- [ ] Task files created in docs/plans/tasks/
- [ ] User approved plan
- [ ] Roadmap updated
