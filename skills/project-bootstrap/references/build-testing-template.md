# Build Testing Checklist — {{PROJECT_NAME}}

> Updated BEFORE every merge to main. Each build gets a section.
> Tester checks off items, writes notes for failures.

---

## Build 1

**Date**: YYYY-MM-DD
**Branch**: feature/TXXX-description
**Tested**: [ ] Not yet / [x] Tested on YYYY-MM-DD

### What Changed (non-technical)
[What the user will notice]

### Setup Steps
- [ ] Run migration: `psql "$DATABASE_URL" -f migrations/NNN_name.sql`
- [ ] Add env var: `NEW_VAR=value`

### Manual Testing Checklist

**Happy path:**
- [ ] [Test case 1]
- [ ] [Test case 2]

**Edge cases:**
- [ ] [Edge case 1]

### Notes
[Space for tester to write issues found]

---
