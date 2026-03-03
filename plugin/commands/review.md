---
name: review
description: Verification loop — Design Doc compliance validation with doc sync and anti-pattern checks
---

**Command Context**: Post-implementation quality assurance — the VERIFICATION LOOP

This is where Agent 2 checks Agent 1's work. The implementing agent is blind to its own gaps. This review catches them.

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator."

**Execution Protocol**:
1. Compliance validation → code-reviewer
2. Anti-pattern check → verify against CLAUDE.md anti-patterns
3. Doc sync compliance → were docs updated?
4. Fix implementation → task-executor (if user approves)
5. Quality checks → quality-fixer
6. Re-validation → code-reviewer

Design Doc (uses most recent if omitted): $ARGUMENTS

## Execution Flow

### Step 1: Prerequisite Check

```bash
# Identify Design Doc
! ls docs/design/*.md 2>/dev/null | grep -v template | tail -1
# Check recent changes
! git diff --name-only HEAD~5..HEAD 2>/dev/null
# Read CLAUDE.md for anti-patterns
! cat CLAUDE.md 2>/dev/null | head -200
```

### Step 2: Execute code-reviewer

Validate:
- Design Doc acceptance criteria fulfillment
- Code quality against project rules
- Implementation completeness
- **Anti-pattern check**: Compare against CLAUDE.md anti-patterns list
- **Doc sync check**: Were roadmap/backlog/task files updated?
- **Build testing**: Was build-testing.md updated (if merge point)?

### Step 3: Verdict

**Compliance thresholds by ambition tier**:
| Tier | Pass Threshold | Notes |
|------|---------------|-------|
| MVP | 70%+ | Core functionality works |
| Production | 85%+ | Solid, well-tested |
| Enterprise | 95%+ | Comprehensive, documented |

**Critical items always required regardless of tier**:
- Security (no data leaks, proper auth)
- Isolation boundaries (if multi-tenant)
- Error handling (no silent failures)

### Step 4: Report to User

```markdown
## Verification Report

### Compliance: [X]%
Tier threshold: [threshold]% → [PASS/FAIL]

### Issues Found
#### Critical (must fix)
- [issue] — [file:line] — [what's wrong]

#### High (should fix)
- [issue] — [file:line]

#### Medium (nice to fix)
- [issue] — [file:line]

### Anti-Pattern Violations
- [pattern violated] — [where]

### Doc Sync Status
- Roadmap: [updated / not updated]
- Backlog: [updated / not updated]
- Task files: [updated / not updated]
- Build testing: [updated / not needed]
```

### Step 5: Fix Loop (If User Approves)

If user says "fix these":

1. **Invoke rule-advisor** — understand fix essence
2. **Create task file**: `docs/plans/tasks/review-fixes-YYYYMMDD.md`
3. **Invoke task-executor** — implement fixes (max 5 files per pass)
4. **Invoke quality-fixer** — verify fixes
5. **Re-invoke code-reviewer** — measure improvement

Report improvement:
```
Initial compliance: [X]%
Final compliance: [Y]%
Improvement: [Y-X]%
Remaining: [items requiring manual intervention]
```

## Completion Criteria

- [ ] code-reviewer executed with compliance score
- [ ] Anti-patterns checked against CLAUDE.md
- [ ] Doc sync compliance verified
- [ ] Report presented to user
- [ ] If fixes requested: executed and re-validated
