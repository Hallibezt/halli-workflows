---
name: brainstorming-guide
description: Structured brainstorming methodology for new projects — competitive analysis, feature prioritization, business model exploration, user story generation.
---

# Brainstorming Guide

## Session Structure

A good brainstorming session follows this arc:
1. **Understand** — What's the idea? Who's it for? What problem?
2. **Research** — What exists? What's the competition? What are the gaps?
3. **Ideate** — What features? What's unique? What's the MVP?
4. **Validate** — Is it feasible? What's risky? What needs proving?
5. **Structure** — Organize into phases, prioritize, estimate

## Competitive Analysis Framework

### What to Search For
- "[idea] app" / "[idea] software" / "[idea] platform"
- "[target market] [problem] solution"
- "best [category] apps [year]"
- Product Hunt, G2, App Store for similar products

### How to Evaluate Competitors
| Dimension | Questions |
|-----------|----------|
| Features | What do they do? What's missing? |
| Pricing | Free? Subscription? How much? |
| UX | Reviews? Complaints? What's frustrating? |
| Market | Who are their users? How big? |
| Tech | What stack? Any technical advantages? |
| Gaps | What do users want that doesn't exist? |

## Feature Prioritization (MoSCoW)

| Priority | Definition | Guideline |
|----------|-----------|-----------|
| **Must Have** | Product doesn't work without it | Launch blockers |
| **Should Have** | Significant value, but workarounds exist | Phase 2 features |
| **Could Have** | Nice to have, improves experience | Phase 3 if time |
| **Won't Have (Yet)** | Valuable but not now | Future roadmap |

### Prioritization Questions
- "If this feature didn't exist, would anyone still use the app?" → Must Have
- "Would removing this make users noticeably unhappier?" → Should Have
- "Is this a differentiator vs competitors?" → Could Have or Must Have
- "Does this require infrastructure we don't have yet?" → Won't Have (Yet)

## Business Model Canvas (Solo Dev Edition)

1. **Value Proposition** — What unique value do you deliver?
2. **Customer Segments** — Who pays? Who uses?
3. **Revenue Streams** — How does money come in?
4. **Cost Structure** — What does it cost to run?
5. **Key Activities** — What must you do well?
6. **Growth Strategy** — How do users find you?

### Revenue Model Options
| Model | Best For | Examples |
|-------|----------|---------|
| Subscription | Ongoing value, SaaS | $X/month plans |
| Freemium | Network effects, conversion funnel | Free + Premium |
| One-time | Tools, utilities | Buy once |
| Commission | Marketplace, booking | % per transaction |
| Ads | High traffic, free users | Ad-supported free tier |

## User Story Format

```
As a [user type],
I want [feature/capability],
so that [benefit/outcome].
```

### Good User Story Checklist
- [ ] Independent (doesn't depend on another story)
- [ ] Negotiable (not a rigid spec)
- [ ] Valuable (delivers user value)
- [ ] Estimable (can roughly size it)
- [ ] Small (fits in a phase)
- [ ] Testable (clear acceptance criteria)

## Risk Assessment

| Risk Type | Questions to Ask |
|-----------|-----------------|
| Technical | Can we actually build this? Any hard problems? |
| Market | Do people actually want this? Competition risk? |
| Regulatory | Privacy laws? App store rules? Licenses? |
| Financial | Can we afford the infrastructure? Break-even? |
| Dependency | External APIs? Third-party services? |

## Brainstorming Anti-Patterns

- **Building for everyone** → Pick a specific user, solve their problem well
- **Feature bloat** → MVP means Minimum VIABLE. What's the smallest useful thing?
- **Technology-first** → Start from the user problem, not the tech stack
- **Ignoring competition** → Know what exists. Don't build what's already solved.
- **No revenue model** → How does this become sustainable? Ask early.
