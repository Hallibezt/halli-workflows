---
name: build
description: Execute decomposed tasks in autonomous execution mode with doc sync
---

**Command Context**: Implementation phase — execute tasks from work plan

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

**Execution Protocol**:
1. **Delegate all work** to sub-agents (orchestrator role only)
2. **Follow 4-step task cycle**: task-executor → escalation check → quality-fixer → commit
3. **Update task files** after each task completion
4. **Doc sync after all tasks** — roadmap, backlog, build-testing (NON-NEGOTIABLE)
5. **Post-build verification** — code-reviewer checks compliance

Work plan: $ARGUMENTS

## Pre-Execution Prerequisites

### Task File Check
```bash
# Check work plans
! ls -la docs/plans/*.md 2>/dev/null | grep -v template | tail -5
# Check task files
! ls docs/plans/tasks/*.md 2>/dev/null || echo "No task files found"
```

### Task Generation (If Needed)

| State | Criteria | Action |
|-------|----------|--------|
| Tasks exist | .md files in tasks/ | Proceed to execution |
| No tasks + plan exists | Plan but no tasks | Confirm → task-decomposer |
| Neither exists | No plan or tasks | Error: run /plan first |

If task-decomposer needed:
```
subagent_type: task-decomposer
description: "Task decomposition"
prompt: |
  Read work plan and decompose into atomic tasks.
  Input: docs/plans/[plan].md
  Output: Individual task files in docs/plans/tasks/
  Naming: TXXX-short-description.md
  Granularity: 1 task = 1 commit = independently executable
```

## Task Execution Cycle (4-Step, Per Task)

**MANDATORY**: Complete each task before starting next.

### For EACH task:

**Step 1: task-executor**
```
subagent_type: task-executor
description: "Execute task TXXX"
prompt: |
  Task file: docs/plans/tasks/[filename].md
  CLAUDE.md context: [relevant rules and patterns]
  Stack: [from CLAUDE.md]
  Complete the implementation.
```

**Step 2: Escalation Check**
- `status: escalation_needed` → STOP, escalate to user
- `status: blocked` → STOP, escalate to user
- `testsAdded` contains integration/E2E → run integration-test-reviewer
- Otherwise → proceed to quality-fixer

**Step 3: quality-fixer**
```
subagent_type: quality-fixer
description: "Quality check"
prompt: Run quality checks on the project. Fix all issues.
```

**Step 4: Commit**
- On `approved: true` → execute git commit with descriptive message
- Update task file checkboxes (mark completed steps)

## Post-Build (MANDATORY)

### Verification Loop
After ALL tasks:
1. **Invoke code-reviewer** — check Design Doc compliance
2. **Report to user** — compliance score + issues
3. **If issues**: Ask user whether to fix → loop back

### Doc Sync (NON-NEGOTIABLE)
- [ ] Update `docs/plans/product-roadmap.md` — check off completed items
- [ ] Update `docs/plans/backlog.md` — mark resolved items
- [ ] Check off task file acceptance criteria
- [ ] Update CLAUDE.md "Current State" if significant

### Build Testing Checklist
If this is a merge point:
- [ ] Append new section to `docs/plans/build-testing.md`
- [ ] Include: description, setup steps, manual testing checklist, notes section

## Stopping Conditions

Stop autonomous execution if:
1. Sub-agent returns `status: escalation_needed` or `blocked`
2. Requirement change detected in user message
3. User explicitly stops

## Completion Report

```
Build complete.
- Tasks implemented: [N] / [total]
- Quality checks: All passed
- Commits: [N]
- Verification: [compliance]%
- Doc sync: [completed / items updated]
- Build testing: [appended to build-testing.md / not merge point]
```
