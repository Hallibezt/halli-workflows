---
name: add-integration-tests
description: Add integration/E2E tests to existing codebase using Design Doc
---

**Command Context**: Test addition workflow for existing implementations

Design Doc path: $ARGUMENTS

## Execution Flow

### Step 1: Validate Design Doc
```bash
! ls $ARGUMENTS 2>/dev/null || ls docs/design/*.md 2>/dev/null | grep -v template | tail -1
```

Check CLAUDE.md for:
- Test framework (Vitest, Jest, Playwright, Detox, etc.)
- Test file naming conventions
- Coverage requirements by ambition tier

### Step 2: Generate Test Skeletons

```
subagent_type: acceptance-test-generator
prompt: |
  Generate test skeletons from Design Doc.
  Design Doc: [path]
  Test framework: [from CLAUDE.md]
  Stack: [from CLAUDE.md]
```

### Step 3: Create Task File

Create `docs/plans/tasks/integration-tests-YYYYMMDD.md` with test implementation tasks.

### Step 4: Implement Tests

```
subagent_type: task-executor
prompt: |
  Implement tests following the task file.
  Task: docs/plans/tasks/integration-tests-YYYYMMDD.md
  Test framework: [from CLAUDE.md]
  Follow TDD: Red-Green-Refactor
```

### Step 5: Review Tests

```
subagent_type: integration-test-reviewer
prompt: Review test quality and skeleton compliance.
```

- `needs_revision` → back to step 4
- `approved` → proceed

### Step 6: Quality Check

```
subagent_type: quality-fixer
prompt: Run all tests, verify coverage, fix issues.
```

### Step 7: Commit

Commit test files with appropriate message.

## Completion Criteria

- [ ] Test skeletons generated from Design Doc ACs
- [ ] Tests implemented following TDD
- [ ] Tests reviewed and approved
- [ ] All tests passing
- [ ] Coverage meets project requirements
