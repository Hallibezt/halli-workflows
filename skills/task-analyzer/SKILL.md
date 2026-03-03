---
name: task-analyzer
description: Performs metacognitive task analysis and skill selection. Use when determining task complexity, selecting appropriate skills, or estimating work scale.
---

# Task Analyzer

## Task Classification

### By Type
| Type | Characteristics | Typical Skills Needed |
|------|----------------|----------------------|
| **Feature** | New functionality | coding-principles, testing-principles, stack-presets |
| **Bug Fix** | Incorrect behavior | ai-development-guide, coding-principles |
| **Refactor** | Same behavior, better code | coding-principles, implementation-approach |
| **Performance** | Speed/efficiency improvement | ai-development-guide |
| **Security** | Vulnerability fix | ai-development-guide, coding-principles |
| **Infrastructure** | Tooling, CI/CD, deps | infra-planning, maintenance-procedures |
| **Documentation** | Docs update | documentation-criteria |

### By Complexity
| Complexity | Indicators | Approach |
|-----------|-----------|----------|
| **Trivial** | 1 file, obvious fix | Direct implementation |
| **Simple** | 1-2 files, clear requirements | /task command |
| **Moderate** | 3-5 files, design needed | /design + /implement |
| **Complex** | 6+ files, architecture impact | Full /implement cycle |
| **Epic** | Multiple phases, weeks of work | /kickoff or phased /plan |

## Skill Selection Matrix

| Task Essence | Primary Skills | Secondary Skills |
|-------------|---------------|-----------------|
| Writing new code | coding-principles | stack-presets, testing-principles |
| Debugging | ai-development-guide | coding-principles |
| Designing architecture | implementation-approach | documentation-criteria |
| Writing tests | testing-principles | integration-e2e-testing |
| Mobile development | mobile-patterns | coding-principles |
| API development | api-patterns | coding-principles |
| Infrastructure work | infra-planning | maintenance-procedures |
| Brainstorming | brainstorming-guide | stack-presets |

## First Action Guidance

| Task Type | First Action | Why |
|-----------|-------------|-----|
| Bug fix | Reproduce the bug | Can't fix what you can't see |
| New feature | Read CLAUDE.md context | Understand existing patterns |
| Refactor | Write tests first | Safety net before changing |
| Performance | Measure baseline | Can't improve what you don't measure |
| Security | Audit current state | Understand attack surface |

## Warning Patterns

Common mistakes to watch for:
1. **Fixing symptoms, not causes** — trace to root cause
2. **Over-engineering simple tasks** — KISS
3. **Skipping tests** — you'll pay later
4. **Ignoring CLAUDE.md rules** — they exist for a reason
5. **Not checking anti-patterns** — learn from past mistakes
6. **Forgetting doc sync** — docs go stale fast
