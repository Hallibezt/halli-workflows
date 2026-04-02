---
name: ai-development-guide
description: Technical decision criteria, anti-pattern detection, debugging techniques, and quality check workflow. Use when making technical decisions or performing quality assurance.
---

# AI Development Guide

## Quality Check Workflow

### Phase 1: Static Analysis
- Run linter (ESLint, Biome, etc.)
- Run formatter (Prettier, etc.)
- Auto-fix where possible

### Phase 2: Type Checking
- Run `tsc --noEmit` (TypeScript)
- Fix all type errors (no `any`, no `@ts-ignore`)

### Phase 3: Build
- Run build command
- Verify clean build with zero warnings

### Phase 4: Tests
- Run full test suite
- All tests must pass
- Check coverage meets project standards

### Phase 5: Code Quality Re-check
- Verify fixes haven't introduced new issues
- Final lint + type check pass

## Technical Decision Framework

When choosing between options:

| Factor | Weight | How to Evaluate |
|--------|--------|----------------|
| Simplicity | High | Fewer moving parts = better |
| Maintainability | High | Can future-you understand it? |
| Performance | Medium | Only optimize measured bottlenecks |
| Scalability | Medium | Consider target scale, don't over-engineer |
| Security | High | Never compromise on security |
| Cost | Medium | Total cost including maintenance |

### Decision Process
1. Identify the actual problem (not the perceived one)
2. List options (minimum 2)
3. Score against criteria
4. Consider project's ambition tier
5. Document decision (ADR if significant)

## Anti-Pattern Detection

### Code Smells
- Functions > 50 lines → extract
- Files > 500 lines → split
- Deep nesting > 3 levels → flatten
- God objects → single responsibility
- Copy-paste code > 3 times → abstract
- Magic numbers → named constants
- Commented-out code → delete it

### Architecture Smells
- Circular dependencies → reorganize
- Leaky abstractions → tighten interface
- Premature optimization → measure first
- Gold plating → YAGNI
- Big bang refactor → strangler pattern

## Debugging Techniques

### Systematic Approach
1. **Reproduce** — Can you reliably trigger the bug?
2. **Isolate** — What's the minimal reproduction case?
3. **Identify** — What changed? Git bisect if needed.
4. **Fix** — Address root cause, not symptoms.
5. **Verify** — Does fix work? No regressions?
6. **Prevent** — Add test for this case.

### Common Causes
| Symptom | Likely Cause |
|---------|-------------|
| Works locally, fails in CI | Environment difference, missing env var |
| Intermittent failure | Race condition, timing issue |
| Works for some users | Data-dependent bug, permission issue |
| Worked yesterday | Recent change (check git log) |
| Performance degraded | N+1 query, missing index, large payload |

## Security Checklist

- [ ] No secrets in code (use env vars)
- [ ] Input validated at boundaries (Zod)
- [ ] SQL injection prevented (parameterized queries / ORM)
- [ ] XSS prevented (proper escaping)
- [ ] CSRF protected (tokens / SameSite cookies)
- [ ] Auth on every protected endpoint
- [ ] Rate limiting on public endpoints
- [ ] Error messages don't expose internals
- [ ] HTTPS everywhere
- [ ] Dependencies audited (npm audit)
