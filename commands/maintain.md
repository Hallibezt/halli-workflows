---
name: maintain
description: Project health check  - dependency audit, external API monitor, code health scan, infrastructure cost review
---

**Command Context**: Ongoing project maintenance and health monitoring

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator."

**Execution Protocol**:
1. **Delegate health check** to maintenance-auditor agent
2. **Present findings** with prioritized action items
3. **Optionally create tasks** for items user wants to address
4. **Scope**: Complete when health report is delivered and action items are optionally tasked

Target scope: $ARGUMENTS

## Execution Flow

### Step 1: Scope Determination

If $ARGUMENTS specifies a scope (e.g., "dependencies only", "API check"), limit audit to that domain.
Otherwise, run all 4 audit domains.

Available audit domains:
| Domain | What It Checks |
|--------|---------------|
| **deps** | npm audit, outdated packages, CVEs, breaking changes |
| **apis** | External API deprecations, version status, breaking changes |
| **code** | Dead code, TODOs, test coverage, large files, hardcoded values |
| **infra** | Infrastructure costs vs usage, over/under-provisioning |

### Step 2: Pre-Audit Context

Before invoking the auditor, gather context:
```bash
# Check project structure
! ls package.json package-lock.json docs/infrastructure.md 2>/dev/null
```

Read CLAUDE.md for:
- Known external services and APIs
- Infrastructure configuration
- Stack information

### Step 3: Execute Health Check

**Invoke maintenance-auditor agent**:
```
subagent_type: maintenance-auditor
description: "Project health check"
prompt: |
  Run a comprehensive health check on this project.

  Domains to audit: [all or specific from step 1]
  Project root: [current directory]
  Infrastructure doc: docs/infrastructure.md (if exists)
  CLAUDE.md context: [relevant sections]

  For each domain:
  1. deps: Run npm audit, check outdated, analyze breaking changes
  2. apis: Find all external API calls, web-search each for status/deprecations
  3. code: Find TODOs/FIXMEs, check coverage, find large files, detect dead code
  4. infra: Compare infrastructure.md with actual usage

  Categorize findings by severity: Critical / High / Medium / Low
```

**Expected output**: Structured health report JSON

### Step 4: Present Report

Format the health report for the user:

```markdown
## Project Health Report

### Summary
- Critical: [count] items
- High: [count] items
- Medium: [count] items
- Low: [count] items

### Critical Items (address immediately)
1. [item] — [description] — [recommended action]

### High Priority
1. [item] — [description] — [recommended action]

### Medium Priority
...

### Low Priority
...

### Infrastructure Cost Summary
Current: $XX/month
Optimized: $XX/month (potential savings: $XX)
```

### Step 5: Action Selection

Ask user which items to address:
```
Which items would you like to address now?
- A) All critical items
- B) All critical + high items
- C) Specific items (list numbers)
- D) None — just note them for later
```

### Step 6: Task Creation (Optional)

For selected items:
1. Create task files in `docs/plans/tasks/maintenance-YYYYMMDD-NNN.md`
2. Add items to `docs/plans/backlog.md`
3. Optionally run `/implement` for the fixes

## Completion Criteria

- [ ] Health check executed across requested domains
- [ ] Report presented with severity classifications
- [ ] User has decided on action items
- [ ] Any selected items are tasked or being addressed
