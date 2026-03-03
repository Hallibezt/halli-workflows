---
name: coding-principles
description: Language-agnostic coding principles for maintainability, readability, and quality. Use when implementing features or reviewing code.
---

# Coding Principles

## Core Principles

### YAGNI (You Aren't Gonna Need It)
Don't build for hypothetical future requirements. Build what's needed now, refactor when requirements are known.

### DRY (Don't Repeat Yourself)
If the same logic appears 3+ times, extract it. But don't abstract too early — 2 occurrences might be coincidental similarity.

### KISS (Keep It Simple, Stupid)
The simplest solution that works is usually the best. Complexity is a cost.

### SRP (Single Responsibility Principle)
Each module/function/class should have ONE reason to change.

## Code Quality Rules

### Functions
- Do ONE thing
- < 50 lines (usually < 20)
- Descriptive names (verbs for functions: `fetchUser`, `validateEmail`)
- Minimal parameters (< 4, use object for more)
- Return early for error cases (guard clauses)

### Variables
- Descriptive names (nouns: `userCount`, `isActive`)
- Declare close to usage
- Prefer `const` over `let`
- Never use `var`
- No single-letter names (except loop counters)

### Error Handling
- **Always handle errors** — never empty catch blocks
- **Log with context** — include what was happening when error occurred
- **Fail fast** — validate inputs at boundaries, not deep inside
- **User-facing errors** — friendly messages, never stack traces
- **Async errors** — always await promises, catch rejections

### Comments
- Code should be self-documenting
- Comment WHY, not WHAT
- Delete commented-out code (use git history)
- TODO/FIXME with ticket reference: `// TODO(T123): fix race condition`

## File Organization

### Structure
- Group by feature, not by type (usually)
- Keep related code close together
- Index files for public API only, not for grouping

### Naming Conventions
| Type | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `UserProfile.tsx` |
| Hooks | camelCase, `use` prefix | `useAuth.ts` |
| Utilities | camelCase | `formatDate.ts` |
| Types | camelCase file, PascalCase export | `userTypes.ts` → `interface User` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| Database | snake_case | `user_profiles` |

## Anti-Patterns (NEVER DO)

- **God object** → break into focused modules
- **Deep nesting** → guard clauses, early returns
- **Magic numbers** → named constants
- **Stringly typed** → use enums or union types
- **Premature optimization** → measure first, optimize bottlenecks
- **Copy-paste inheritance** → composition over inheritance
- **Boolean blindness** → use descriptive enums/types
- **Silent failures** → throw or log, never swallow
- **Process.env.VAR!** → validated env module
- **Catch without logging** → always log with context first
