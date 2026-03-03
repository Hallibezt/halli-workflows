---
name: documentation-criteria
description: Documentation creation criteria including PRD, ADR, Design Doc, and Work Plan requirements with templates. Use when creating or reviewing technical documents.
---

# Documentation Criteria

## Document Types

| Document | Purpose | When Required |
|----------|---------|---------------|
| **PRD** | Business requirements, user stories, success metrics | Large scale (6+ files) or Enterprise tier |
| **ADR** | Architecture decisions with alternatives and rationale | Architecture changes, new tech, data flow changes |
| **Design Doc** | Technical implementation specification | Medium+ scale (3+ files) |
| **Work Plan** | Phased implementation with tasks and testing | Medium+ scale |
| **Task File** | Individual atomic task with acceptance criteria | Every task in a work plan |

## Scale Determination

| Scale | Files | Required Docs |
|-------|-------|--------------|
| Small | 1-2 | Simplified plan only |
| Medium | 3-5 | Design Doc + Work Plan |
| Large | 6+ | PRD + Design Doc + Work Plan |

## ADR Triggers

Create an ADR if ANY of these apply:
1. Contract system changes (3+ nesting, 3+ locations)
2. Data flow changes (storage, processing order)
3. Architecture changes (layers, responsibilities)
4. External dependency changes (new libraries, APIs)
5. Complex state logic (3+ states, 5+ async processes)

## Document Quality Standards

### All Documents Must:
- [ ] Have clear purpose stated upfront
- [ ] Be internally consistent (no contradictions)
- [ ] Reference related documents
- [ ] Have acceptance criteria (Design Docs)
- [ ] Be up to date with current state

### PRD Must Additionally:
- [ ] Define target users
- [ ] Have measurable success metrics
- [ ] Clear scope boundaries (in/out)
- [ ] User stories in standard format

### Design Doc Must Additionally:
- [ ] Have testable acceptance criteria
- [ ] Include testing strategy
- [ ] Reference stack patterns from CLAUDE.md
- [ ] Not violate existing ADRs

### Work Plan Must Additionally:
- [ ] Map to roadmap phases
- [ ] Include build-testing section
- [ ] Include doc sync checklist
- [ ] Have atomic task files

## Templates

See `references/` directory for templates:
- `prd-template.md`
- `adr-template.md`
- `design-template.md`
- `plan-template.md`
- `task-template.md`
