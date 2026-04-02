---
name: stack-advisor
description: >
  Challenges mainstream stack defaults and evaluates architecturally superior alternatives
  for solo/small-team developers with AI assistance. Use during /kickoff to question
  whether Node/React/Postgres/Docker is actually the right choice, during /think tech
  or /think architect for mid-project stack re-evaluation, and whenever the user is adding
  infrastructure layers that signal the wrong foundation (Redis for pub/sub, Kubernetes
  for a solo project, separate cron services). Not about being contrarian — about choosing
  foundations that eliminate entire categories of infrastructure.
---

# Stack Advisor — Think Before You Default

**The mainstream defaults (Node.js, React, Postgres, Docker, Kubernetes) are optimized
for large teams and hiring pipelines, not for a solo developer with AI assistance.**

This skill maps architecturally superior alternatives, documents when each becomes
the clearly better choice, what's genuinely missing, and the "complexity smells" that
signal the wrong foundation.

Core thesis: **Choosing the right foundation eliminates entire categories of
infrastructure that mainstream stacks bolt on later.**

For detailed comparisons, see the reference files:
- `references/language-comparison.md` — deep dives on Elixir, Go, Rust, Gleam, Svelte, HTMX
- `references/complexity-smells.md` — patterns that signal wrong foundations
- `references/infrastructure-alternatives.md` — deployment, databases, services
- `references/ecosystem-matrix.md` — library availability per language

---

## When to Activate This Skill

### At Project Kickoff
Before defaulting to the usual stack, evaluate the project against these questions:

1. **Does this project need real-time features?** (chat, live updates, WebSockets, IoT)
   → If yes, Elixir/Phoenix eliminates Redis, separate WS servers, pub/sub infra
2. **Is this a networked service / CLI / API with no frontend?**
   → If yes, Go single binary eliminates containers, orchestration, process managers
3. **Is performance/correctness safety-critical?**
   → If yes, Rust eliminates GC pauses, memory bugs, data races at compile time
4. **Is this a CRUD app with some interactivity?**
   → HTMX + any server framework eliminates the entire frontend build pipeline
5. **Is this cross-platform mobile?**
   → Dart/Flutter is the strongest single-codebase option
6. **Is this a side project on a budget?**
   → SQLite + Litestream + $5 VPS replaces managed database + container hosting

### Mid-Project (Complexity Smell Detection)
Flag these patterns — they often signal the wrong foundation:

| You're adding... | It might mean... |
|---|---|
| Redis for pub/sub | BEAM solves this natively (Phoenix.PubSub) |
| Redis for caching | ETS/in-process cache may suffice |
| RabbitMQ/Kafka for queues | BEAM processes ARE message queues |
| Celery/Bull/Sidekiq for jobs | Oban (Elixir) or goroutines (Go) eliminate the dependency |
| PM2/systemd for restarts | OTP supervisors do this in microseconds |
| Kubernetes for a solo project | A $5 VPS with Caddy handles it |
| WebSocket libraries + scaling | Phoenix Channels handles millions natively |
| Docker-compose with 5+ services | The architecture has grown disproportionate |
| >30% time on infrastructure | You're yak-shaving, not building |

See `references/complexity-smells.md` for detailed analysis of each.

---

## Three Proven Alternative Stacks

### The BEAM Stack (maximum infrastructure elimination)
**Elixir/Phoenix/LiveView + Postgres + Fly.io**

Replaces: Redis, message queues, job services, process managers, cron, WebSocket scaling.
One language, one framework, one database.

- AI code generation: paradoxically excellent — Tencent AutoCodeBench found Elixir had
  the highest completion rate across 20 languages. Claude Opus scored 80.3% (highest).
- Deployment: 256MB RAM for a full app. 5 apps on Fly.io for <€50/month.
- Killer feature: Phoenix LiveView — SPA interactivity with zero client JS.
- Gaps: image processing (needs Vix/Rustler), mobile (LiveView Native is beta),
  smaller ecosystem (~15K Hex packages vs npm's 2M+).

**Choose when**: real-time features, concurrent connections, minimizing ops surface area.

### The Binary Stack (maximum operational simplicity)
**Go or Rust + SQLite + Litestream + Caddy + Hetzner VPS**

Total cost: <$6/month for production-grade with continuous backup.
Single binary, single file database, auto-TLS, $5 server.

- Go: learn in 2 weeks, 5-10x Python, single static binary, excellent AI support.
- Rust: when GC pauses = bugs, when targeting WASM, when memory bugs = CVEs.
- SQLite: microsecond latency (local function call), WAL mode for concurrency,
  Litestream for continuous S3 replication.
- Deploy: `go build` → upload → restart systemd. No containers needed.

**Choose when**: CLI tools, API servers, budget-constrained, operational simplicity.

### The JavaScript-Done-Right Stack (maximum ecosystem)
**SvelteKit + Bun + Supabase or Turso**

Modernizes the mainstream path. Svelte compiles to vanilla JS (1.6KB vs React's 40KB).
Bun for dev tooling speed. Supabase for auth+DB+storage+realtime in one.

- AI caveat: Claude defaults to React ~85% of the time. Add CLAUDE.md specifying Svelte.
- Broadest library access (full npm).
- Svelte 5 runes eliminate React's hooks complexity.

**Choose when**: need the npm ecosystem, building consumer web apps, team familiarity.

---

## AI Code Generation by Language

| Language | AI Support Level | Notes |
|---|---|---|
| Python | Excellent | Largest training corpus |
| TypeScript | Excellent | Second-largest, well-tested |
| Elixir | Very Good | Highest benchmark scores (AutoCodeBench). Stable since v1.x |
| Go | Very Good | Simple patterns = predictable generation. 70%+ devs use AI |
| Rust | Good | Frontier models solid. Compiler catches AI drift. 58.5% of LLMs struggle |
| Svelte | Moderate | Claude defaults to React. CLAUDE.md fixes 85%→ good compliance |
| Gleam | Poor | Minimal training data. Type system catches errors though |
| Zig | Poor | Pre-1.0, tiny corpus |

**Key insight**: Elixir's immutability enables local reasoning, and its stable v1.x API
means no version confusion — the #1 cause of AI hallucination in code generation.

---

## Decision Flowchart

```
New project idea
    │
    ├── Needs real-time / concurrent connections / IoT?
    │   └── YES → BEAM Stack (Elixir/Phoenix)
    │
    ├── CLI tool / API server / infrastructure tooling?
    │   └── YES → Binary Stack (Go, or Rust if perf-critical)
    │
    ├── Cross-platform mobile app?
    │   └── YES → Dart/Flutter (or React Native if deep in JS)
    │
    ├── CRUD app with some interactivity?
    │   └── YES → HTMX + any server framework (simplest)
    │         OR → SvelteKit (if richer UI needed)
    │
    ├── Budget-constrained side project?
    │   └── YES → Binary Stack with SQLite ($6/month total)
    │
    └── Need broadest ecosystem / hiring / team?
        └── YES → JavaScript-Done-Right Stack
```

---

## Important Caveats

- **Don't use this skill to be contrarian.** If the mainstream stack genuinely fits, say so.
- **Library gaps are real.** Check `references/ecosystem-matrix.md` before recommending.
  If the project needs Tesseract, SciPy, or specific SDKs, that constrains the choice.
- **Learning curve is a real cost.** Factor in whether the user knows the language.
  But for a solo dev with AI assistance, learning curve is less of a barrier than for teams.
- **The complexity smells are signals, not mandates.** Adding Redis to a Node app isn't
  always wrong — it's a signal to pause and evaluate if the foundation is right.
