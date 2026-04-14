# halli-dev-workflows — What Am I?

> This file is for the workflow itself. When `/guide` is invoked, the workflow-guide agent reads this file to understand what it is and how to help.

## Identity

**halli-dev-workflows** is a personal engineering operating system — a Claude Code plugin that manages the full lifecycle of software projects, from initial brainstorming through implementation, maintenance, and retrospectives.

It was forked from [shinpr/claude-code-workflows](https://github.com/shinpr/claude-code-workflows) and heavily customized based on patterns learned from building a production monorepo (GuestPad + Aurora Hunter + Aurora API) over 3+ months.

**Built for**: Halli + Claude, working together on web apps, mobile apps, and API services.

## What Makes This Different from shinpr/claude-code-workflows

| Feature | shinpr (base) | halli-dev-workflows |
|---------|--------------|-------------------|
| Plugin structure | Split: backend + frontend | Unified with stack detection |
| Project kickoff | None | `/kickoff` — brainstorming → skeleton |
| Maintenance | None | `/maintain` — deps, APIs, code health, infra |
| Retrospectives | None | `/retro` — self-learning system |
| Workflow navigation | None | `/guide` — meta-command |
| Ambition tiers | None | MVP / Production / Enterprise |
| Stack presets | None | Next.js, Expo, Hono, Monorepo |
| Infra planning | None | Scale matrix with cost estimates |
| Competitive analysis | None | During kickoff brainstorming |
| Doc sync | Not enforced | NON-NEGOTIABLE in every agent |
| Build testing | Not included | Checklist before every merge |
| Verification loop | Implicit | Explicit: implement → review → fix |
| Memory system | None | Cross-session continuity |
| Total agents | 18 | 24 (7 new) |
| Total skills | 11 | 16 (8 new) |
| Total commands | 9 | 14 (5 new) |

## Architecture

```
User → /command → Orchestrator → Agent(s) → [Stop Points] → Complete
                                    ↑
                                  Skills (knowledge modules)
```

### Three Layers

1. **Commands** (14) — User entry points. Orchestrators that delegate to agents.
2. **Agents** (24) — Specialized workers. Each does one thing well.
3. **Skills** (16) — Reusable knowledge. Agents load skills for domain expertise.

### Types (new in v1.1)

`types/` holds canonical contract reference docs — markdown specs that every agent and
orchestrator conforms to. First content: the pilot-review system's Finding schema,
location_key grammar, and preflight_hash algorithm. See `types/README.md`.

### Core Principles

- **Orchestrator pattern**: Commands never do work directly. They coordinate agents.
- **Sub-phase decomposition**: Large phases (>15 items, >2 sprints) MUST be broken into sub-phases of 5-15 tasks. Each sub-phase goes through the full plan → build → test cycle independently. Think small independent groups that work together, not monoliths.
- **Verification loop**: Agent 1 implements → Agent 2 verifies → fix if needed.
- **Doc sync**: Every completion updates roadmap, backlog, task files.
- **Build testing**: Manual testing checklist before every merge.
- **Ambition tiers**: MVP/Production/Enterprise sets ceremony level.
- **Stack awareness**: Agents adapt to project's stack (from CLAUDE.md).
- **Self-learning**: `/retro` updates rules and memory after each phase.

## Command Reference

| Command | Purpose |
|---------|---------|
| `/kickoff` | Start new project: brainstorm → infra plan → skeleton |
| `/design` | Requirements → ADR/Design Doc → approval |
| `/plan` | Design Doc → work plan with phases and tasks |
| `/build` | Execute tasks: (executor → quality → commit) loop |
| `/implement` | Full lifecycle: design → plan → build → verify |
| `/task` | Quick single task with rule guidance |
| `/diagnose` | Problem → investigate → verify → solve |
| `/review` | Verification loop: compliance check → fix → re-check |
| `/reverse-engineer` | Generate docs from existing code |
| `/add-integration-tests` | Add tests to existing code |
| `/maintain` | Health check: deps, APIs, code, infra |
| `/retro` | Retrospective: analyze → learn → update rules |
| `/think` | Brainstorm with expert partner: `/think ux`, `/think tech`, `/think business`, `/think infra`, `/think architect` |
| `/guide` | Navigate the workflow: "what command for my task?" |

## Agent Inventory

### New Agents (7)
- **thinking-partner** — Expert brainstorming partner (UX/tech/business/infra/architect modes)
- **brainstorm-facilitator** — Interactive brainstorming with competitive analysis
- **project-bootstrapper** — CLAUDE.md + docs skeleton generator
- **infra-planner** — Scale matrix with cost estimates
- **maintenance-auditor** — 4-domain health check
- **retro-analyzer** — Retrospective + self-learning
- **workflow-guide** — Meta-agent for workflow navigation

### Core Agents (17)
- **requirement-analyzer** — Requirements + scale + ambition tier
- **prd-creator** — PRD creation (create/update/reverse-engineer)
- **technical-designer** — ADR + Design Doc (stack-aware)
- **work-planner** — Phased plans with build-testing
- **task-executor** — Implementation with doc sync
- **task-decomposer** — Plan → atomic tasks
- **code-reviewer** — Verification loop agent
- **code-verifier** — Doc-code consistency
- **document-reviewer** — Document quality review
- **design-sync** — Cross-document consistency
- **acceptance-test-generator** — Test skeletons (stack-aware)
- **quality-fixer** — Self-contained quality assurance
- **rule-advisor** — Metacognitive rule selection
- **scope-discoverer** — Codebase scope discovery
- **investigator** — Problem evidence collection
- **verifier** — ACH + Devil's Advocate verification
- **solver** — Solution derivation with rule compliance

## Skill Inventory

### New Skills (8)
- **partner-modes** — Expert partner personas (UX, tech, business, infra, architect) for /think
- **stack-presets** — Next.js, Expo, Hono, Monorepo configurations
- **infra-planning** — Service recommendations, pricing, scale matrices
- **project-bootstrap** — CLAUDE.md templates, doc templates
- **brainstorming-guide** — Competitive analysis, feature prioritization
- **maintenance-procedures** — Health check playbooks
- **mobile-patterns** — Offline-first, battery-conscious, optimistic mutations
- **api-patterns** — REST, middleware, auth, caching, envelopes

### Core Skills (8)
- **subagents-orchestration-guide** — Orchestrator coordination rules
- **ai-development-guide** — Technical decisions, debugging, quality
- **coding-principles** — YAGNI, DRY, KISS, SRP
- **testing-principles** — TDD, test pyramid, coverage
- **implementation-approach** — Strategy selection, task decomposition
- **documentation-criteria** — PRD/ADR/Design Doc/Plan templates
- **integration-e2e-testing** — Test design, ROI, review criteria
- **task-analyzer** — Metacognitive task analysis

## How to Extend

### Add a Command
1. Create `commands/new-command.md` (YAML frontmatter + orchestrator flow)
2. Add to `.claude-plugin/plugin.json` commands array
3. Update this file (SELF.md)

### Add an Agent
1. Create `agents/new-agent.md` (YAML frontmatter + responsibilities + output format)
2. Add to `.claude-plugin/plugin.json` agents array
3. Reference from commands that use it
4. Update this file

### Add a Skill
1. Create `skills/new-skill/SKILL.md` (YAML frontmatter + domain knowledge)
2. Add `references/` directory if templates needed
3. Reference from agents via `skills:` in frontmatter
4. Update this file

### Update Existing
- Edit the file directly
- Consider running `/retro` first for data-driven changes
- Test by running the affected command on a real task
