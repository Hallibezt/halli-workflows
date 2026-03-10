---
name: ai-development-guide
description: Technical decision criteria, anti-pattern detection, debugging techniques, hallucination prevention, and quality check workflow. Use when making technical decisions or performing quality assurance.
---

# AI Development Guide

## HALLUCINATION PREVENTION (CRITICAL — READ FIRST)

AI-generated code creates a unique class of technical debt: **code that looks correct, compiles, and passes tests — but is fundamentally wrong** because it was built on fabricated assumptions about APIs, libraries, protocols, or data formats that don't match reality.

This section defines mandatory gates, warning triggers, and verification rules to prevent this.

### The Three Deadly Sins of AI Code Generation

1. **Phantom APIs**: Generating code that calls methods, endpoints, or library functions that don't exist. The code looks plausible, type-checks, and may even pass tests — but will fail at runtime against the real system.
2. **Confidence Cascading**: When one hallucinated assumption forces compensating hallucinations downstream. E.g., inventing a response field forces inventing a type, which forces inventing a mapper, which forces inventing a test mock — creating a self-consistent fiction.
3. **Fix-Forward Spiraling**: When a build/test failure is "fixed" by adding more fictional code rather than addressing the root cause. The symptom goes away but the underlying problem deepens.

### Research-First Gates (MANDATORY)

Before writing ANY code that interacts with external systems, STOP and verify:

| Trigger | Required Action |
|---------|----------------|
| Using a third-party library API | Read the library's actual docs or source code. Do NOT rely on training data — APIs change between versions. |
| Calling an external API endpoint | Read the actual API docs, OpenAPI spec, or test against the real endpoint. Never invent request/response shapes. |
| Using a hardware protocol (OBD-II, BLE, NFC, etc.) | Read the protocol specification. Verify PID codes, command sequences, and response formats against official standards. |
| Using a database feature (RPC, extension, specific SQL) | Verify the feature exists in the project's database version. Test the SQL locally before wrapping in application code. |
| Using a framework feature (React Native, Expo, Next.js) | Check the version-specific docs. Features differ between versions. `expo-location` in SDK 52 ≠ SDK 55. |
| Using a native module or config plugin | Verify it exists on npm, check its Expo compatibility, and confirm it works with the current Expo SDK version. |

**Verification methods (in order of reliability):**
1. Read the actual source code or docs (best)
2. Search the web for current documentation
3. Check `package.json` / `requirements.txt` for installed version, then read THAT version's docs
4. Test in a REPL or sandbox
5. If none of the above are possible: **explicitly warn the user** that you are operating on training data and the code needs manual verification

### Hallucination Warning Signals

**You MUST flag these to the user when you notice them in your own output:**

| Signal | What It Means |
|--------|--------------|
| "I believe this API has..." | You're guessing. Stop and verify. |
| Generating a type/interface that "matches" an API you haven't read | You might be inventing the schema. |
| Writing a mock that returns data you haven't seen from the real API | The mock may not reflect reality. The test will pass but the integration will fail. |
| Adding a field to a database type without checking the actual migration | The field might not exist in the real schema. |
| Importing from a package path you haven't verified | The import path may not exist in the installed version. |
| Creating a "compatibility layer" or "adapter" for something that should work directly | You might be papering over a misunderstanding. |
| Using `as any`, `@ts-ignore`, or `type: ignore` to make something compile | These hide the real problem. Fix the types instead. |

**When in doubt, use this phrase to the user:**
> "I'm not 100% certain about [X]. I'm basing this on training data, not verified docs. Let me check before we proceed."

### Verified-Facts-Only Implementation Rules

1. **No invented API shapes.** Every request body, response body, and error shape MUST come from docs, OpenAPI specs, or observed real responses. If you haven't seen the real shape, say so.

2. **No speculative fields.** Don't add database columns, type fields, or API parameters "because it probably has one." If you need a field, verify it exists first.

3. **No phantom imports.** Every `import` and `from X import Y` MUST reference a package that exists in the project's dependency file at the version that actually exports that symbol.

4. **Mocks must mirror reality.** Test mocks MUST be based on real API responses, not imagined ones. If you haven't seen a real response, mark the mock as `// TODO: Replace with real response shape` and warn the user.

5. **Fix root causes, not symptoms.** When a build fails, a test fails, or a type doesn't match:
   - STOP. Read the error message carefully.
   - Identify the ROOT CAUSE (wrong assumption? missing dependency? schema mismatch?).
   - Fix the root cause, even if it means undoing work.
   - NEVER add type casts, ignore comments, empty catch blocks, or dummy values just to make it compile.

6. **Admit uncertainty explicitly.** If you're not sure whether a library method exists, an API field is present, or a protocol command works a certain way — say so BEFORE writing code. Use `[UNVERIFIED]` markers in code comments.

7. **One hallucination invalidates the chain.** If you discover one thing you assumed was wrong, re-examine everything downstream of that assumption. Don't patch — reassess.

### The "Wall-Chewing" Anti-Pattern

When you hit a wall (build error, test failure, API mismatch), you have two choices:

**WRONG: Chew through the wall**
- Add type casts to silence errors
- Create adapter functions to transform data that doesn't match
- Write custom mocks that return whatever makes tests pass
- Add `try/catch` blocks that swallow errors
- Create "compatibility" wrappers around things that should work directly
- Add `// eslint-disable` or `# type: ignore` comments

**RIGHT: Back up and find the door**
- Re-read the error message — what is it ACTUALLY telling you?
- Check if your fundamental assumption is wrong
- Read the real docs/source for the thing that's failing
- Ask the user: "I assumed X but I'm getting Y — which is correct?"
- Undo the broken approach and try a different one
- If the real API doesn't support what you need, tell the user honestly

### Slop Detection Checklist

Before any implementation is considered done, verify it contains NONE of these:

- [ ] Empty `except`/`catch` blocks
- [ ] `pass` or `...` as function body (placeholder code)
- [ ] `# TODO: implement` without a tracking ticket
- [ ] `as any` or `@ts-ignore` type overrides
- [ ] Functions that are defined but never called
- [ ] Imports that are unused
- [ ] Test mocks that don't match real API shapes
- [ ] "Compatibility" code for problems that shouldn't exist
- [ ] Fields/columns referenced in code but not in the actual schema
- [ ] Library methods called that don't exist in the installed version

---

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
