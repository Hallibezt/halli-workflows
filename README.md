# halli-dev-workflows

Personal engineering operating system for Claude Code — full project lifecycle from brainstorming to maintenance.

**13 commands | 23 agents | 15 skills** — tailored for solo/small-team development of web apps, mobile apps, and API services.

## What Is This?

A Claude Code plugin that gives you a structured workflow for building software projects. Instead of ad-hoc conversations, you get:

- **`/kickoff`** — Start a new project with interactive brainstorming, competitive analysis, infrastructure planning, and automatic project skeleton generation
- **`/implement`** — Full end-to-end feature development with automatic doc sync and verification
- **`/maintain`** — Regular health checks (dependencies, external APIs, code health, infra costs)
- **`/retro`** — Retrospectives that make the workflow smarter over time
- **`/guide`** — Not sure which command to use? Just ask.

## Quick Start

### Installation

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/halli-dev-workflows.git ~/.claude/plugins/marketplaces/halli-dev-workflows

# Or if you want it elsewhere
git clone https://github.com/YOUR_USERNAME/halli-dev-workflows.git ~/halli-workflows
```

### Enable in Claude Code

Add to your `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "halli-workflows@halli-dev-workflows": true
  }
}
```

Or enable via Claude Code settings UI.

### Verify Installation

Start Claude Code in any project and type:
```
/guide what commands are available?
```

You should see the full command list.

## Commands

### Project Lifecycle

| Command | When | What It Does |
|---------|------|-------------|
| `/kickoff` | New project | Brainstorm → competitive analysis → infra plan → project skeleton |
| `/design` | Have requirements | Requirements → ADR/Design Doc → review → approval |
| `/plan` | Have design doc | Design → work plan with tasks and testing checklist |
| `/build` | Have plan | Execute tasks: (implement → quality check → commit) loop |
| `/implement` | End-to-end | Combines design → plan → build in one flow |
| `/task` | Small job | Quick implementation with rule guidance (1-2 files) |

### Quality & Verification

| Command | When | What It Does |
|---------|------|-------------|
| `/review` | After implementation | Verification loop: compliance check → fix → re-check |
| `/diagnose` | Something broke | Investigate → verify → solve with confidence scoring |
| `/add-integration-tests` | Need tests | Generate test skeletons → implement → review |

### Maintenance & Growth

| Command | When | What It Does |
|---------|------|-------------|
| `/maintain` | Monthly or pre-release | Dependency audit + API monitor + code health + infra review |
| `/retro` | After phase completes | Analyze velocity/patterns → update workflow rules |
| `/guide` | Anytime | Ask about the workflow itself |

### Documentation

| Command | When | What It Does |
|---------|------|-------------|
| `/reverse-engineer` | Existing undocumented code | Generate PRD + Design Docs from code |

## How It Works

### The Orchestrator Pattern

Every command is an **orchestrator** — it delegates work to specialized agents and passes structured data between them. Commands never do implementation work directly.

```
/implement
  → requirement-analyzer (what's the scope?)
  → technical-designer (how to build it?)
  → document-reviewer (is the design good?)
  → work-planner (what are the tasks?)
  → [for each task]:
      → task-executor (implement)
      → quality-fixer (check quality)
      → git commit
  → code-reviewer (verification loop)
  → doc sync (update roadmap, backlog, task files)
```

### The Verification Loop

The most important pattern: **Agent 1 implements, Agent 2 verifies.**

After implementation, the code-reviewer checks everything. It catches what the implementer missed. You decide whether to fix the issues. This typically runs 1-2 times before everything is clean.

### Ambition Tiers

During `/kickoff`, you choose your project's ambition:

| Tier | Docs | Testing | Infrastructure |
|------|------|---------|---------------|
| **MVP** | Minimal | Basic units | Free tiers |
| **Production** | Standard | Unit + integration | Paid services |
| **Enterprise** | Maximum | Full coverage + E2E | Multi-region |

This affects how much ceremony each command requires.

### Stack Presets

Built-in configurations for common stacks:
- **Web**: Next.js + Supabase + Vercel + Tailwind
- **Mobile**: Expo + React Native + Supabase + RevenueCat
- **API**: Hono + Railway + API key auth
- **Monorepo**: Turborepo + npm workspaces

### Doc Sync (NON-NEGOTIABLE)

Every command enforces documentation updates:
- Product roadmap: check off completed items
- Backlog: mark resolved items
- Task files: check off steps
- Build testing: append checklist before merge

## Typical Workflow

### Starting a New Project

```
/kickoff
  → Answer questions about your idea
  → Review competitive analysis
  → Choose stack and scale
  → Get project skeleton (CLAUDE.md, docs, PRD)

/design Phase 1 features
  → Get technical design approved

/plan
  → Get work plan with tasks approved

/build
  → Watch tasks get implemented one by one

/review
  → Verification loop catches issues

/retro
  → Learn from the phase, update rules
```

### Maintaining an Existing Project

```
/maintain
  → Get health report
  → Fix critical items

/retro
  → After major phase, reflect and improve
```

### Diagnosing a Problem

```
/diagnose the login page returns 500 after the last deploy
  → Investigation with evidence
  → Verification of findings
  → Solution options with tradeoffs
```

## Extending the Workflow

### Add a New Command
1. Create `commands/your-command.md` with YAML frontmatter
2. Define the orchestrator flow (which agents, what order)
3. Add to `.claude-plugin/plugin.json`

### Add a New Agent
1. Create `agents/your-agent.md` with responsibilities and output format
2. Add to `.claude-plugin/plugin.json`
3. Reference from commands that use it

### Add a New Skill
1. Create `skills/your-skill/SKILL.md` with domain knowledge
2. Reference from agents via `skills:` in their frontmatter

See `SELF.md` for full extension guide.

## Origin

Forked from [shinpr/claude-code-workflows](https://github.com/shinpr/claude-code-workflows) (v0.10.1) and customized with:
- 4 new commands (/kickoff, /maintain, /retro, /guide)
- 6 new agents (brainstorm, bootstrap, infra, maintenance, retro, guide)
- 7 new skills (stack presets, infra planning, mobile patterns, API patterns, etc.)
- Ambition tiers, stack awareness, doc sync enforcement, verification loops, and self-learning

## License

MIT
