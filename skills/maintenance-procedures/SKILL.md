---
name: maintenance-procedures
description: Project health check procedures — dependency auditing, external API monitoring, code health metrics, infrastructure cost optimization.
---

# Maintenance Procedures

## Audit Cadence

| Audit | Frequency | Trigger |
|-------|-----------|---------|
| Dependencies | Monthly + before major releases | Also: security advisory notification |
| External APIs | Monthly | Also: before relying on new API |
| Code Health | Per phase completion | Also: before major refactors |
| Infrastructure | Quarterly | Also: before scaling up |

## Dependency Audit Procedure

### Step 1: Vulnerability Scan
```bash
npm audit                    # Known vulnerabilities
npm audit --production       # Production deps only
```

### Step 2: Outdated Check
```bash
npm outdated                 # All outdated packages
```

### Step 3: Breaking Change Analysis
For each major version bump:
1. Read CHANGELOG or release notes
2. Check migration guide
3. Estimate effort: trivial / moderate / significant
4. Check if our usage is affected

### Severity Classification
| Severity | Criteria | Action |
|----------|----------|--------|
| Critical | Known CVE, exploitable | Fix within 24 hours |
| High | Major version behind, security implications | Fix within 1 week |
| Medium | Minor version behind, no security issues | Fix within 1 month |
| Low | Patch behind, cosmetic | Fix when convenient |

## External API Monitor Procedure

### Step 1: Inventory
Find all external API calls in codebase:
- `fetch()` calls with external URLs
- API client imports
- Environment variables referencing external services
- Cross-reference with `docs/infrastructure.md`

### Step 2: Status Check (per API)
Web search for each:
- "[API name] deprecation [current year]"
- "[API name] breaking changes"
- "[API name] migration guide"
- "[API name] status page"

### Step 3: Version Check
- What version are we using?
- What's the latest version?
- Are there breaking changes between our version and latest?

### Red Flags
- API hasn't been updated in >1 year
- Deprecation notice published
- Company behind API acquired or shutting down
- Rate limits being hit regularly

## Code Health Metrics

### What to Measure
| Metric | How | Threshold |
|--------|-----|-----------|
| TODO/FIXME count | grep -rn "TODO\|FIXME" | Track trend, don't let grow |
| Large files | wc -l, sort | >500 lines = consider splitting |
| Test coverage | Coverage report | >80% for critical paths |
| Type safety | tsc --noEmit | Zero errors |
| Bundle size | Build output | Track trend |

### Code Smells to Look For
- Functions >50 lines
- Files >500 lines
- Deeply nested callbacks (>3 levels)
- Duplicated logic (>3 occurrences)
- Hardcoded values (magic numbers, URLs)
- Commented-out code (delete it or make a TODO)

## Infrastructure Cost Review

### Procedure
1. Read `docs/infrastructure.md` for declared services
2. Check actual usage vs plan limits
3. Identify unused or underutilized services
4. Calculate potential savings
5. Check if current tier still appropriate for user count

### Common Optimizations
- Downgrade unused premium features
- Switch to annual billing for committed services (usually 15-20% savings)
- Use free tiers where usage allows
- Consolidate services (e.g., Supabase = DB + Auth + Storage)
- Review egress costs (biggest hidden expense)

## Health Report Format

```markdown
## Project Health Report — [Date]

### Summary
| Domain | Status | Items |
|--------|--------|-------|
| Dependencies | [Good/Warning/Critical] | [N] items |
| External APIs | [Good/Warning/Critical] | [N] items |
| Code Health | [Good/Warning/Critical] | [N] items |
| Infrastructure | [Good/Warning/Critical] | [N] items |

### Action Items (by priority)
1. [Critical] [item] — [action needed]
2. [High] [item] — [action needed]
...
```
