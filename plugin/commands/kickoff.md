---
name: kickoff
description: Start a new project  - interactive brainstorming, competitive analysis, infrastructure planning, and project skeleton generation
---

**Command Context**: New project initialization — from idea to ready-to-code skeleton

## Orchestrator Definition

**Core Identity**: "I am not a worker. I am an orchestrator." (see subagents-orchestration-guide skill)

**Execution Protocol**:
1. **Gather basics directly** (Steps 1-4 are orchestrator-driven, not delegated)
2. **Delegate deep work** to sub-agents (brainstorming, infra planning, skeleton creation)
3. **Stop at every checkpoint** — user approves before proceeding
4. **Output**: A fully scaffolded project with CLAUDE.md, docs, and initial PRD

Target: $ARGUMENTS

## Step 1: Project Basics (Orchestrator-Driven)

Ask the user directly using AskUserQuestion:

### 1.1 The Idea
- What's the project? (1-2 sentences)
- Who are the target users?
- What problem does it solve?

### 1.2 Platform Selection
| Option | Description |
|--------|-------------|
| Web | Browser-based application (Next.js, SPA, etc.) |
| Mobile | iOS/Android app (React Native / Expo) |
| API | Backend service consumed by other apps |
| Web + Mobile | Both platforms sharing backend |
| Web + Mobile + API | Full ecosystem with public API |

### 1.3 Ambition Tier

| Tier | Description | Doc Ceremony | Testing Rigor | Infra Level |
|------|-------------|-------------|---------------|-------------|
| **MVP** | Launch fast, iterate. Prove the concept. | Minimal: CLAUDE.md + backlog | Basic: unit tests, manual QA | Free tiers, single region |
| **Production** | Solid, scalable from day 1. Real users. | Standard: PRD + Design Doc + roadmap | Full: unit + integration + E2E | Paid services, monitoring |
| **Enterprise** | Full feature set, multi-tenant, billing. | Maximum: PRD + ADR + Design Doc + work plan | Comprehensive: security + load + a11y | Multi-region, CDN, caching |

### 1.4 Target Scale

| Scale | Users | Implications |
|-------|-------|-------------|
| Hobby | <100 | Free tiers, single instance, no CDN |
| Startup | 100-1K | Basic paid services, monitoring |
| Growth | 1K-100K | Proper infrastructure, caching, CDN |
| Scale | 100K-1M+ | Enterprise services, multi-region, load balancing |

**[Stop: Confirm basics before deep work]**

## Step 2: Stack Selection

Based on platform choice, present stack presets from stack-presets skill:

### Presets Available
- **Web (Next.js)**: Next.js + Supabase + Vercel + Tailwind + Prisma (migrations) + Zod + Vitest
- **Mobile (Expo)**: Expo + React Native + Supabase + Zustand + React Query + RevenueCat
- **API (Hono)**: Hono + Railway/Fly.io + API key auth + rate limiting + Vitest
- **Monorepo**: Turborepo + npm workspaces + shared packages
- **Custom**: User specifies

Present relevant presets based on platform selection. User can pick a preset or customize.

**[Stop: Confirm stack before brainstorming]**

## Step 3: Brainstorming Session

**Invoke brainstorm-facilitator agent**:
```
subagent_type: brainstorm-facilitator
description: "Project brainstorming"
prompt: |
  Run an interactive brainstorming session for this project.

  Project: [user's idea]
  Target Users: [from step 1]
  Platform: [from step 1]
  Ambition: [MVP/Production/Enterprise]
  Scale: [from step 1]

  Execute:
  1. Competitive analysis (web search for similar products)
  2. Feature brainstorming with user (organized by priority)
  3. Business model exploration
  4. Technical risk identification
  5. Initial user stories

  Be conversational. Suggest features, let the user react, iterate.
```

**Expected output**: Structured brainstorm document with features, competitive analysis, business model, risks.

**[Stop: User approves brainstorm output before infrastructure planning]**

## Step 4: Infrastructure Planning

**Invoke infra-planner agent**:
```
subagent_type: infra-planner
description: "Infrastructure planning"
prompt: |
  Generate infrastructure recommendations for this project.

  Stack: [from step 2]
  Scale target: [from step 1]
  Ambition: [MVP/Production/Enterprise]
  Features requiring infra: [from brainstorm output]

  Generate:
  1. Scale matrix (current tier + growth path)
  2. Service recommendations with monthly costs
  3. Environment variables needed
  4. Migration path between tiers
```

**Expected output**: Infrastructure document with scale matrix and costs.

**[Stop: User approves infrastructure plan]**

## Step 5: Project Skeleton Generation

**Invoke project-bootstrapper agent**:
```
subagent_type: project-bootstrapper
description: "Project skeleton creation"
prompt: |
  Create project skeleton from these inputs.

  Project: [idea from step 1]
  Stack: [from step 2]
  Brainstorm: [approved output from step 3]
  Infrastructure: [approved output from step 4]
  Ambition: [MVP/Production/Enterprise]

  Create:
  1. CLAUDE.md (engineering bible with context router)
  2. docs/plans/product-roadmap.md (phases from features)
  3. docs/plans/backlog.md (initial items)
  4. docs/plans/build-testing.md (empty template)
  5. docs/infrastructure.md (from infra plan)
  6. docs/prd/[project]-prd.md (from brainstorm)
  7. Domain-specific CLAUDE.md files (based on stack)
  8. .env.example (from infrastructure env vars)
```

**Expected output**: List of created files.

**[Stop: User reviews skeleton, approves or requests changes]**

## Step 6: Completion

After approval:
```
Project kickoff complete.

Created files:
- CLAUDE.md (engineering bible)
- docs/plans/product-roadmap.md
- docs/plans/backlog.md
- docs/plans/build-testing.md
- docs/infrastructure.md
- docs/prd/[project]-prd.md
- [domain CLAUDE.md files]

Next steps:
1. Review and customize CLAUDE.md
2. Run /design to create technical design for Phase 1
3. Run /plan to create work plan
4. Run /build to implement

Or run /implement to go end-to-end on Phase 1.
```

## Completion Criteria

- [ ] Project basics gathered (idea, platform, ambition, scale)
- [ ] Stack selected (preset or custom)
- [ ] Brainstorming session completed and approved
- [ ] Infrastructure plan generated and approved
- [ ] Project skeleton created and approved
- [ ] User knows next steps
