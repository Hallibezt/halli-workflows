---
name: reverse-engineer
description: Generate PRD and Design Docs from existing codebase
---

**Command Context**: Reverse engineering — create documentation from existing code

Target: $ARGUMENTS

**TodoWrite**: Register phases first, then steps within each phase.

## Step 0: Initial Configuration

### 0.1 Scope Confirmation

Use AskUserQuestion:
1. **Target path**: Which directory/module to document
2. **Depth**: PRD only, or PRD + Design Docs
3. **Human review**: Yes (recommended) / No (autonomous)

### 0.2 Output Configuration

- PRD output: `docs/prd/`
- Design Doc output: `docs/design/`
- Verify directories exist, create if needed

## Phase 1: PRD Generation

### Step 1: Scope Discovery
```
subagent_type: scope-discoverer
prompt: |
  Discover PRD targets in codebase.
  scope_type: prd
  target_path: [user's target]
```

**Quality Gate**: At least one unit discovered → proceed

### Steps 2-5: Per-Unit Loop

For each unit: Generation → Verification → Review → Revision

**Step 2**: prd-creator (reverse-engineer mode)
**Step 3**: code-verifier (consistency check)
**Step 4**: document-reviewer (quality review)
**Step 5**: Revision if needed (max 2 cycles)

## Phase 2: Design Doc Generation (If Requested)

### Step 6: Scope Discovery
```
subagent_type: scope-discoverer
prompt: |
  Discover Design Doc targets within PRD scope.
  scope_type: design-doc
  existing_prd: [approved PRD path]
```

### Steps 7-10: Per-Component Loop

**Step 7**: technical-designer (from code)
**Step 8**: code-verifier (consistency)
**Step 9**: document-reviewer (quality)
**Step 10**: Revision if needed (max 2 cycles)

## Phase 3: CLAUDE.md Generation (Bonus)

After PRD and Design Docs, offer to generate:
- Domain CLAUDE.md files for documented areas
- Context Router entries for root CLAUDE.md

## Final Report

```markdown
## Reverse Engineering Complete

### Generated Documents
| Type | Name | Consistency | Review Status |
|------|------|------------|---------------|
| PRD | [name] | [score]% | [status] |
| Design Doc | [name] | [score]% | [status] |

### Action Items
- [critical discrepancies]
- [undocumented features]

### Next Steps
- [ ] Review and refine generated documents
- [ ] Run /plan to create work plan from design docs
```

## Error Handling

| Error | Action |
|-------|--------|
| Nothing discovered | Ask user for structure hints |
| Generation fails | Log, continue with others, report |
| consistencyScore < 50 | Mandatory human review |
| 2 revisions rejected | Stop loop, flag for human |
