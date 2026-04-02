---
name: token-efficiency
description: >
  Token cost optimization patterns for LLM workflows — same power, less cost.
  Covers output discipline, context pruning, model routing, prompt caching,
  agentic compaction, and CLAUDE.md structure. Use during /kickoff to embed
  efficiency rules, when the user asks about token usage or costs, or when
  building agentic workflows. Not about reducing capability — about precision.
---

# Token Efficiency for Technical Workflows

The core insight: **token efficiency and output quality are not in tension.**
The same practices that cut costs (precise context, right-sized models, structured outputs)
consistently improve results. Waste is not just expensive — it degrades quality.

For full research backing, see `references/research-foundations.md`.

---

## The Cost Model

Know these numbers — they drive all optimization decisions:

- **Output tokens cost 4-8x more than input tokens** (Anthropic: 5:1 ratio across all models)
- **Agentic workflows compound quadratically** — stateless APIs resend full history every turn
- **Long context pricing doubles above 200K tokens** on some models
- **Prompt cache reads cost 0.1x** (90% discount) — the single biggest savings lever
- **Batch API gives a flat 50%** discount for async work

---

## Three Layers of Optimization

### Layer 1: Always-On (zero cost — bake into every CLAUDE.md)

These rules go in every project's context file. They save tokens AND improve quality.

**Output discipline:**
- Be concise. Answer the question asked — no unsolicited alternatives or caveats
- Never repeat back the user's request before answering
- For code: generate only what was asked. No unrequested boilerplate or comments
- When asked for an edit, make the edit only. Do not rewrite surrounding code

**Context discipline:**
- Do not re-summarize previous turns
- If given a large file, work on the relevant section only
- If information is missing, ask for it specifically — do not guess and hedge

**Format discipline:**
- Respond in the format that minimizes tokens while preserving meaning
- Code → code block only, no wrapping prose unless critical
- Data extraction → structured output (JSON/YAML), not prose
- Yes/no questions → answer first, explain only if needed

**Reasoning discipline:**
- Do NOT think step-by-step for simple tasks. CoT adds 35-600% overhead with
  near-zero benefit on non-reasoning tasks (Wharton study)
- Reserve chain-of-thought for math, multi-step logic, or debugging
- If the answer fits in one sentence, give one sentence

### Layer 2: Medium-Stakes (when building APIs, products, or regular workflows)

- **Prompt caching** — 50-90% savings on input tokens. Place static content first
  (tools → system → docs → examples → history → current message). Any prefix change
  invalidates everything after it. See `references/caching-architecture.md`
- **Model routing** — Claude Sonnet delivers 98% of Opus performance at 20% cost.
  Use Haiku for classification, extraction, formatting, simple Q&A. Reserve Opus for
  scientific reasoning, complex multi-step logic, and novel problem-solving.
  See `references/model-routing.md`
- **Structured output modes** — Native JSON schema constraints achieve 42% output
  token reduction vs "please format as JSON" in natural language
- **Context pruning** — Remove irrelevant content actively. One irrelevant sentence
  can drop multi-step problem accuracy to zero (Shi et al., ICML 2023)

### Layer 3: Agentic Workflows (where costs explode)

Agent loops compound every inefficiency. Claude Code's tool definitions alone consume
14,000-17,600 tokens per request before any user content.

- **Conversation compaction** — Summarize history every N turns or at 50% context.
  Keep architectural decisions, discard intermediate tool outputs. Use `/compact`
  with a focus: `/compact Focus on the API changes`
- **Tool result clearing** — Strip raw tool returns from old messages. A 50K-token
  DB dump paid for 10 turns = 500K tokens of waste
- **Discovery-based tool loading** — Serve a compact tool menu, load full schemas
  on-demand. Reduces tool overhead by up to 98% in MCP-heavy setups
- **Multi-agent delegation** — Delegate verbose subtasks to subagents so only
  summaries return to the main conversation (this is what halli-workflows already does)
- **Hard budget ceilings** — Never run agent loops without max_tokens and auto-termination

See `references/agentic-patterns.md` for detailed patterns.

---

## CLAUDE.md Token Efficiency Block

When generating CLAUDE.md for a new project, include this block:

```markdown
## Token Efficiency

### Output rules
- Be concise. Answer what was asked — no unsolicited alternatives or caveats.
- For code: generate only what was asked. No unrequested boilerplate or comments.
- When asked for an edit, make the edit only. Do not rewrite surrounding code.
- Respond in the format that minimizes tokens: code → code block, data → JSON/YAML,
  yes/no → answer first.

### Reasoning rules
- Do NOT use chain-of-thought for simple tasks. Just answer.
- Reserve step-by-step reasoning for math, multi-step logic, or debugging.

### Context rules
- Do not re-summarize previous turns.
- If given a large file, work on the relevant section only.
- If information is missing, ask specifically — do not guess.
```

---

## Anti-Patterns (Never Do These)

| Anti-Pattern | Cost | Fix |
|---|---|---|
| No `max_tokens` on agent loops | $47K incidents documented | Hard ceiling + auto-termination |
| Frontier model for classification | 130x overspend | Use Haiku/mini |
| Full history every turn, no compaction | Quadratic growth | Compact every N turns |
| CoT for simple tasks | 35-600% overhead | Just answer |
| "Please could you kindly..." | ~22% wasted | Direct instructions |
| MCP tool schemas you don't need | 55K tokens/request | Discovery-based loading |
| "As I mentioned earlier..." | Pure waste | Never re-summarize |
| Full DB dumps in tool results | 500K+ tokens over 10 turns | Extract facts, clear raw results |

---

## Quick Reference: Model Selection

| Task Type | Model | Why |
|---|---|---|
| Scientific reasoning, GPQA-class | Opus | 17-point gap on GPQA Diamond |
| Complex multi-step logic, architecture | Opus / Sonnet | Sonnet is 98% of Opus, 20% cost |
| Code generation, daily development | Sonnet | Sweet spot: quality vs cost |
| Classification, extraction, formatting | Haiku | 17x cheaper, comparable quality |
| Simple Q&A, sentiment analysis | Haiku | Frontier models add no value here |
| Batch processing, offline analysis | Any + Batch API | Flat 50% discount |

---

## Measurement

You can't optimize what you don't measure. Key metrics:
- **Cost per task** (not per API call)
- **Input vs output tokens** (separate — output costs 5x more)
- **Cache hit rate** (target: >80% for stable prefixes)
- **p95/p99 outliers** (bloat lives in the tail)
