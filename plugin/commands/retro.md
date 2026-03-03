---
name: retro
description: Phase/project retrospective — analyze what worked, what didn't, update workflow rules and memory
---

**Command Context**: Post-phase or post-project retrospective with self-learning

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator."

**Execution Protocol**:
1. **Determine scope** — which phase or timeframe to analyze
2. **Delegate analysis** to retro-analyzer agent
3. **Present findings** and improvement suggestions
4. **Apply approved changes** to memory and rules
5. **Scope**: Complete when retro report is delivered and approved changes are applied

Target: $ARGUMENTS

## Execution Flow

### Step 1: Scope Determination

If $ARGUMENTS specifies a phase or timeframe, use that.
Otherwise, ask:
```
What should this retro cover?
- A) Last completed phase (check product-roadmap.md)
- B) Specific timeframe (e.g., "last 2 weeks")
- C) Entire project so far
- D) Specific topic (e.g., "our testing approach")
```

### Step 2: Execute Retrospective Analysis

**Invoke retro-analyzer agent**:
```
subagent_type: retro-analyzer
description: "Retrospective analysis"
prompt: |
  Analyze the following scope for retrospective insights.

  Scope: [from step 1]
  Project root: [current directory]

  Analyze:
  1. Git log for the period (commits, files changed, authors)
  2. Task files: planned vs completed, rework count
  3. Build-testing.md: issues found, fix turnaround
  4. Backlog: items added vs resolved
  5. Pain points (from notes, test failures, rework patterns)
  6. Workflow effectiveness (commands used, verification catches)
  7. Doc sync compliance (were docs updated consistently?)

  Output structured retro report.
```

**Expected output**: Structured retro report JSON

### Step 3: Present Retro Report

```markdown
## Retrospective: [Scope]

### What Went Well (Keep Doing)
- [pattern/practice that worked]

### What Was Painful (Stop/Change)
- [pain point with evidence]

### What Was Missing (Start Doing)
- [gap identified]

### Velocity
- Planned tasks: [N]
- Completed: [N] ([%])
- Reworked: [N] (items that needed fixing after "done")
- Average task completion time: [estimate]

### Verification Loop Effectiveness
- Issues caught by review agent: [N]
- Issues caught by testing: [N]
- Issues caught in manual testing: [N]
- Issues that shipped broken: [N]

### Doc Sync Compliance
- Roadmap updates: [on-time / behind / missing]
- Backlog updates: [on-time / behind / missing]
- Build testing checklists: [complete / partial / missing]
```

**[Stop: User reviews retro report]**

### Step 4: Self-Learning Suggestions

Based on the retro, suggest improvements:

```markdown
## Suggested Improvements

### Memory Updates
- [ ] Add to memory: "[pattern/learning]"
- [ ] Update memory: "[outdated info] → [new info]"

### New Anti-Patterns
- [ ] Add anti-pattern: "[what not to do] — because [evidence from retro]"

### Rule Changes
- [ ] Update rule: "[rule] — [proposed change]"
- [ ] Add rule: "[new rule] — [rationale from evidence]"

### Workflow Tweaks
- [ ] "[suggested workflow change]"
```

Ask user to approve each suggestion individually.

### Step 5: Apply Changes

For each approved suggestion:
- **Memory updates**: Write/edit files in `.claude/memory/` or project memory
- **Anti-patterns**: Update CLAUDE.md anti-patterns section
- **Rules**: Update CLAUDE.md rules section
- **Workflow tweaks**: Note in SELF.md or create a task for workflow changes

### Step 6: Completion

```
Retrospective complete.
- Report: [summary]
- Changes applied: [N] memory updates, [N] rule changes
- The workflow has learned from this phase.

Ready for the next phase. Run /plan or /implement to continue.
```

## Completion Criteria

- [ ] Retro scope determined
- [ ] Analysis executed with evidence from git, tasks, tests, docs
- [ ] Report presented to user
- [ ] Improvement suggestions reviewed
- [ ] Approved changes applied to memory/rules
