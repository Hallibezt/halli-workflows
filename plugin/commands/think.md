---
name: think
description: Brainstorm with an expert partner — UX, tech, business, infra, or architect. Dialogue-oriented problem solving for mid-project decisions. Usage - /think ux, /think tech, /think business, /think infra, /think architect
---

**Command Context**: Mid-project brainstorming with an expert thinking partner

## What This Is

This is NOT a document-production workflow. This is a **conversation** with a knowledgeable partner who:
- Knows your project (reads CLAUDE.md and relevant docs)
- Has opinions and shares them
- Researches to back up their positions
- Challenges your assumptions
- Drives toward clear decisions

## Partner Modes

| Mode | Invoke | Expert In |
|------|--------|-----------|
| UX | `/think ux` | Simplifying flows, user journeys, information architecture, screen overlap, cognitive load |
| Tech | `/think tech` | Architecture tradeoffs, library choices, technical debt, stack decisions |
| Business | `/think business` | Monetization, pricing, market fit, competitive positioning, growth |
| Infra | `/think infra` | Hosting costs, scaling, service selection, monitoring, security |
| Architect | `/think architect` | System boundaries, data flow, API design, separation of concerns |

## Execution

**Step 1**: Determine partner mode from $ARGUMENTS (ux/tech/business/infra/architect).
If no mode specified, ask the user which partner they need.

**Step 2**: Invoke the thinking-partner agent:

```
subagent_type: thinking-partner
description: "[Mode] brainstorming partner"
prompt: |
  Mode: [selected mode]
  Project: [from CLAUDE.md]

  The user wants to brainstorm about: $ARGUMENTS (everything after the mode keyword)

  Load the project context from CLAUDE.md, understand the current state,
  and engage in dialogue as the [mode] partner.

  If the user provided a specific topic beyond the mode, start there.
  If not, ask what they want to discuss.

  Remember: you are a PEER, not an assistant. Have opinions. Push back.
  Drive toward decisions, not endless discussion.
```

**Step 3**: The session IS the output. No documents required.

If decisions are reached that should be captured:
- Offer to update the backlog
- Offer to feed into /design for formal documentation
- Offer to create a brief decision record

## Examples

```
/think ux          → "The app feels too complicated, too many places to see history"
/think tech        → "Should we use Zustand or Redux for this new feature?"
/think business    → "How should we price the premium tier?"
/think infra       → "Our Supabase bill is getting high, what are our options?"
/think architect   → "The service layer is getting tangled, help me untangle it"
/think ux the service book overlaps with the history tab
```

## What This Does NOT Do

- Produce PRDs, design docs, or ADRs (use /design for that)
- Write code (use /task or /build for that)
- Create work plans (use /plan for that)
- Run builds or tests (use /build for that)

This command exists because sometimes you need to THINK before you DO.
