---
name: design
description: Execute from requirement analysis to design document creation
---

**Command Context**: Design phase — requirements to approved design documents

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

**Execution Protocol**:
1. **Read project context** — check CLAUDE.md for existing ADRs, stack, rules
2. **Delegate all work** to sub-agents
3. **Follow design flow**: requirement-analyzer → technical-designer → document-reviewer → design-sync
4. **Stop at every checkpoint** — wait for user approval
5. **Scope**: Complete when design documents receive approval

Requirements: $ARGUMENTS

## Pre-Flight: Project Context

```bash
# Read project context
! cat CLAUDE.md | head -50
# Check existing design docs
! ls docs/design/*.md docs/adr/*.md 2>/dev/null
# Check existing PRDs
! ls docs/prd/*.md 2>/dev/null
```

Load relevant domain CLAUDE.md files per Context Router.

## Workflow

```
Requirements → requirement-analyzer → [Stop: Scale + scope]
                                           ↓
                        [If Enterprise/Large] prd-creator → document-reviewer → [Stop: PRD]
                                           ↓
                                   technical-designer → document-reviewer
                                           ↓
                                      design-sync → [Stop: Design approval]
```

## Execution Steps

### Step 1: Requirement Analysis

**Invoke requirement-analyzer** with:
- Project stack from CLAUDE.md
- Ambition tier
- Existing ADRs for context
- Existing design docs for consistency

**[Stop: Confirm requirements, scale, and document needs]**

### Step 2: PRD (If Required)

For Enterprise tier or Large scale:
1. **Invoke prd-creator** — create or update PRD
2. **Invoke document-reviewer** — review PRD quality
3. **[Stop: Approve PRD]**

### Step 3: ADR (If Architecture Change)

If requirement-analyzer flags architecture changes:
1. **Invoke technical-designer** — create ADR
2. **Invoke document-reviewer** — review ADR
3. **[Stop: Approve ADR]**

### Step 4: Design Document

1. **Invoke technical-designer** — create Design Doc (stack-aware, references CLAUDE.md patterns)
2. **Invoke document-reviewer** — review Design Doc quality
3. **Invoke design-sync** — verify consistency with existing docs
4. **[Stop: Approve Design Doc]**

**Think deeper**: Present design alternatives and trade-offs. Consider:
- Consistency with existing project patterns
- Impact on isolation boundaries (if multi-tenant)
- Stack-specific considerations

## Completion

```
Design phase completed.
- Design document: docs/design/[name].md
- ADR: docs/adr/[name].md (if created)
- PRD: docs/prd/[name].md (if created)
- Approval status: User approved

Next: Run /plan to create work plan, or /implement to go end-to-end.
```

## Completion Criteria

- [ ] requirement-analyzer executed, scale determined
- [ ] Appropriate design documents created (ADR/Design Doc)
- [ ] document-reviewer verified each document
- [ ] design-sync confirmed consistency
- [ ] User approved all documents
