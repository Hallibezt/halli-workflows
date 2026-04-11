# Token Efficiency Research Foundations

Evidence base for the patterns in the parent SKILL.md.

## Key Statistics

### Pricing
- Anthropic: uniform 5:1 output-to-input ratio ($3/$15M for Sonnet 4.6, $1/$5M Haiku 4.5, $5/$25M Opus 4.6)
- OpenAI: 4:1 on GPT-4o ($2.50/$10M), 8:1 on GPT-5.2 ($1.75/$14M)
- Google: Gemini 2.5 Pro at 8:1 ($1.25/$10M)
- Long-context: 2x rates above 200K tokens (Anthropic Sonnet 4.5, Google Pro models)
- Prompt cache reads: 0.1x (90% discount), writes: 1.25x (5-min TTL) or 2x (1-hour TTL)
- Batch APIs: flat 50% discount across all three providers

### Efficiency Impact
- **LLMLingua**: up to 20x compression with minimal quality loss (EMNLP 2023)
- **LLMLingua-2**: 2-5x compression, 3-6x faster than original (ACL 2024)
- **Manual prompt cleanup**: 22% average compression across 135 prompts
- **Structured outputs**: 42% output token reduction (OpenAI function calling vs natural language JSON)
- **YAML vs JSON**: 30% fewer tokens for equivalent data
- **TOON format**: 30-60% reduction vs JSON, 86.6% vs 83.2% extraction accuracy
- **Output length constraints**: 40-50% output token reduction
- **RouteLLM**: 95% of GPT-4 quality using only 26% GPT-4 calls (ICLR 2025)
- **Chain of Draft**: matches CoT accuracy at 7.6% token cost (Zoom research)

### Context Quality
- "Lost in the Middle" (Liu et al., TACL 2024): U-shaped attention, middle content ignored
- Context length degrades performance 13.9-85% even with perfect retrieval (arXiv 2025)
- One irrelevant sentence drops multi-step accuracy to zero (Shi et al., ICML 2023)
- Optimal RAG: ~16,000 well-chosen tokens outperform full-context stuffing (Nvidia OP-RAG)
- CLAUDE.md consensus: under 300 lines, aggressive practitioners under 60

### Agentic Costs
- Claude Code tool definitions: 14,000-17,600 tokens per request before user content
- Bash tool alone: 1,558 tokens (git commit formatting instructions)
- 100 MCP servers: ~20,000 tokens per query just for descriptions
- Agent teams: ~7x more tokens than standard sessions
- Claude Code average: $6/developer/day, 90% under $12/day
- Documented runaway incidents: $47K (LangChain infinite loop), $1,410 (47K API calls in 6h)

### CoT Overhead
- Wharton study: 35-600% longer with corresponding token increases
- Reasoning models (o3-mini, o4-mini): CoT adds only 2.9-3.1% improvement, 20-80% overhead
- Meta-analysis of 100+ papers: CoT benefits primarily math/logic, near-zero elsewhere
- Direct answering without CoT: almost identical accuracy on MMLU unless symbolic operations

### Model Quality Gaps (Shrinking)
- Sonnet 4.6 vs Opus 4.6: 1.2-point SWE-bench gap (79.6% vs 80.8%) — smallest ever
- Gemini 3 Flash outperforms Gemini 3 Pro on SWE-bench (78% vs 76.2%)
- GPQA Diamond: 17-point gap between Sonnet and Opus (frontier premium is real here)
- Fine-tuned BERT still outperforms zero-shot GPT-4/Opus on classification
- LLM inference prices declining 5-10x per year on the Pareto frontier (NeurIPS 2025)

## Key Papers

1. **"Lost in the Middle"** (Liu et al., TACL 2024) — U-shaped attention, middle context ignored
2. **LLMLingua** (EMNLP 2023) — perplexity-based prompt compression, 20x ratio
3. **RouteLLM** (LMSYS, ICLR 2025) — model routing via preference data, 85% savings
4. **Shi et al.** (ICML 2023) — irrelevant context harms accuracy on math problems
5. **OckBench** (NeurIPS 2025) — first accuracy+efficiency benchmark, 5x token variance
6. **Chain of Draft** (Zoom) — CoT accuracy at 7.6% cost
7. **Gist Tokens** (Mu et al., NeurIPS 2023) — 26x compression via learned token compression
