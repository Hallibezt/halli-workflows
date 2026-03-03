---
name: implementation-approach
description: Implementation strategy selection framework with meta-cognitive approach, verification levels, and integration points. Use when planning implementation strategy.
---

# Implementation Approach Guide

## Strategy Selection

| Situation | Strategy | When |
|-----------|----------|------|
| Greenfield | Build from scratch | New project, no existing code |
| Enhancement | Extend existing | Adding to working system |
| Refactor | Restructure | Improving without changing behavior |
| Migration | Strangler pattern | Replacing component gradually |
| Bug fix | Minimal change | Fix root cause, don't refactor |

## Task Decomposition

### Principles
- Each task = 1 logical commit
- Each task independently testable
- Tasks ordered by dependency
- No circular dependencies
- Clear acceptance criteria per task

### Granularity Guide
| Scope | Task Count | Granularity |
|-------|-----------|-------------|
| Small (1-2 files) | 1-2 tasks | One task per file |
| Medium (3-5 files) | 3-5 tasks | One task per logical change |
| Large (6+ files) | 5-15 tasks | One task per feature slice |

## Verification Levels

| Level | What | When |
|-------|------|------|
| Quick | Type check + lint | After each edit |
| Standard | + Unit tests | After each task |
| Full | + Integration + build | Before commit |
| Release | + E2E + manual | Before merge to main |

## The Verification Loop

```
Implement → Review → Fix → Review → Approve

Agent 1 (task-executor): Implements the task
Agent 2 (code-reviewer): Verifies compliance
User: Decides whether to fix issues
```

This loop is the most effective quality pattern we've found. The implementer has blind spots — always run review after implementation.

## Integration Points

### Database Changes
1. Write migration SQL
2. Update Prisma schema (if applicable)
3. Run migration
4. Verify data integrity
5. Update types/interfaces

### API Changes
1. Update endpoint
2. Update Zod validation schema
3. Update response types
4. Update consuming client code
5. Update API documentation

### UI Changes
1. Update component
2. Update types/props
3. Update consuming pages
4. Update i18n strings (if applicable)
5. Visual verification

## Phased Delivery

For large features, deliver in vertical slices:

```
Phase 1: Database + API (backend complete)
Phase 2: Basic UI (functional but ugly)
Phase 3: Polish (design, animations, edge cases)
Phase 4: Testing (integration + E2E)
```

Each phase is independently deployable and testable.
