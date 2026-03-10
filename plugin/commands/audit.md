---
name: audit
description: Deep codebase audit — hunts for AI slop, hallucinated APIs, phantom imports, dead code, schema drift, and hidden technical debt
---

**Command Context**: Proactive codebase health scan — finds what compiles but is semantically wrong

Unlike `/review` (which checks recent changes against a Design Doc), `/audit` scans the ENTIRE codebase for structural problems: phantom imports, dead code, schema drift, AI slop patterns, test mock mismatches, and env var inconsistencies.

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator."

**Scope**: $ARGUMENTS (default: entire codebase, can be narrowed to a directory or file pattern)

## Execution Flow

### Step 1: Understand the Project

```bash
# Read project conventions
! cat CLAUDE.md 2>/dev/null | head -300
# Identify stack and dependency files
! ls package.json requirements.txt pyproject.toml Cargo.toml go.mod 2>/dev/null
# Identify database migrations
! ls supabase/migrations/ prisma/migrations/ alembic/versions/ 2>/dev/null
# Check project size
! find . -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.js' -o -name '*.jsx' | wc -l
```

### Step 2: Launch codebase-auditor Agent

Invoke the `codebase-auditor` agent with the project path and scope.

The agent runs 7 audit phases:
1. **Dependency Verification** — phantom imports, unused packages, version mismatches
2. **Schema & Type Consistency** — ghost fields, orphan columns, type mismatches
3. **API Contract Verification** — request/response shape drift vs docs
4. **Dead Code Detection** — unused exports, unreachable routes, orphan files
5. **Slop Pattern Scan** — type suppressions, placeholders, empty handlers, cross-language contamination
6. **Test Quality Audit** — mock mismatches, weak assertions, false confidence
7. **Environment & Config Audit** — env var drift, hardcoded values

### Step 3: Present Findings

```markdown
## Codebase Audit Report

**Date**: YYYY-MM-DD
**Scope**: [entire codebase / specific directory]
**Overall Health**: [healthy / concerns / critical]

### Summary
[One paragraph overview]

### Critical Findings (fix now)
| # | Severity | Phase | File | Issue | Fix |
|---|----------|-------|------|-------|-----|

### High Priority (fix soon)
| # | Severity | Phase | File | Issue | Fix |
|---|----------|-------|------|-------|-----|

### Medium Priority (fix when convenient)
| # | Severity | Phase | File | Issue | Fix |
|---|----------|-------|------|-------|-----|

### Metrics
- Files scanned: X
- Issues found: X (Y critical, Z high)
- Estimated debt: X hours
```

### Step 4: Fix Loop (If User Approves)

If user says "fix these":

1. Group fixes by severity (critical first)
2. For each fix group:
   - **Invoke task-executor** — implement fixes
   - **Invoke quality-fixer** — verify no regressions
3. Re-run the specific audit phase to confirm the fix
4. Report before/after

## Completion Criteria

- [ ] All 7 audit phases executed
- [ ] Findings presented with severity and file references
- [ ] No false positives (each finding verified against real docs/code)
- [ ] If fixes requested: executed and re-validated
