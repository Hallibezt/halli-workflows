---
name: guide
description: Workflow navigator  - ask about commands, get recommendations for your task, learn how to extend the workflow
---

**Command Context**: Meta-command for understanding and navigating the halli-dev-workflows system

## Orchestrator Definition

This is a special command — it does NOT follow the standard orchestrator pattern. Instead, it invokes a single agent (workflow-guide) that reads the workflow's self-description and answers the user's question.

## Execution Flow

### Step 1: Invoke Workflow Guide

**Invoke workflow-guide agent**:
```
subagent_type: workflow-guide
description: "Workflow navigation help"
prompt: |
  The user is asking about the halli-dev-workflows system.

  User's question: $ARGUMENTS

  Read SELF.md to understand the full workflow system, then answer the user's question.

  Types of questions you handle:
  1. "What command should I use for X?" → Recommend with rationale
  2. "How does /command work?" → Explain flow, agents, stop points
  3. "What's the difference between X and Y?" → Compare
  4. "How do I add a new skill/agent/command?" → Step-by-step guide
  5. "The workflow isn't handling X well" → Suggest improvements
  6. "Show me everything" → Overview of all commands
  7. "How does the verification loop work?" → Explain pattern

  Be helpful, specific, and give concrete examples.
```

### Command Quick Reference (for direct questions)

If the user asks "what commands are available?", respond directly:

| Command | When to Use | What It Does |
|---------|------------|-------------|
| `/kickoff` | Starting a brand new project | Brainstorming → competitive analysis → infra planning → project skeleton |
| `/design` | Have requirements, need architecture | Requirement analysis → ADR/Design Doc → review → consistency check |
| `/plan` | Have design doc, need implementation plan | Test skeletons → work plan with phases → task decomposition |
| `/build` | Have plan, ready to code | Task loop: executor → quality-fixer → commit, for each task |
| `/implement` | Full end-to-end feature | Combines design → plan → build in one flow |
| `/task` | Quick, small-scope task (1-2 files) | Rule advisor → direct implementation |
| `/diagnose` | Something is broken | Investigator → verifier → solver with confidence loop |
| `/review` | Code done, need verification | Compliance check against design doc + optional auto-fix |
| `/reverse-engineer` | Document existing code | Discover scope → generate PRD/Design Docs from code |
| `/add-integration-tests` | Need tests for existing code | Generate test skeletons → implement → review |
| `/maintain` | Regular health check | Deps + APIs + code health + infra cost review |
| `/retro` | Phase complete, want to reflect | Analyze velocity + patterns → update rules + memory |
| `/guide` | Not sure what to do | This command — navigate the workflow |

### Decision Helper

If the user describes a situation, use this decision tree:

```
Is it a new project entirely?
  YES → /kickoff
  NO ↓

Is something broken?
  YES → /diagnose
  NO ↓

Do you have existing code to document?
  YES → /reverse-engineer
  NO ↓

Do you have a design doc?
  NO → /design
  YES ↓

Do you have a work plan?
  NO → /plan
  YES ↓

Is it a small task (1-2 files)?
  YES → /task
  NO ↓

Do you want full end-to-end?
  YES → /implement
  NO → /build

After implementation:
  Quality check → /review
  Health check → /maintain
  Reflection → /retro
```

## Completion Criteria

- [ ] User's question answered clearly
- [ ] If command recommended, specific invocation shown
- [ ] If workflow extension asked, step-by-step provided
