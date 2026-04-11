# Anti-Hallucination Research Foundations

Evidence base for the patterns in the parent SKILL.md. Read this when you need to
explain *why* a technique works or cite a source.

## Key Statistics

- **19.7%** of AI-recommended packages are fabricated (USENIX 2025, 576K samples)
- **58%** of hallucinated packages repeat consistently across queries
- **5.2%** hallucination rate for GPT-4 packages; 21.7% for open-source models
- **47-91%** of AI-generated academic references are fabricated (varies by model/task)
- **66%** functional rate for GPT-4 I2C interfaces on embedded targets (U of Washington)
- **42-68%** hallucination reduction with RAG/context grounding
- **96%** reduction achievable with layered mitigation
- **60%** reduction from "permission to say I don't know" alone (practitioner report)

## Chain-of-Verification (CoVe) Results
- Source: Meta AI
- Biography generation: factual accuracy 55.9% → 71.4% (FACTSCORE benchmark)
- Entity lists: hallucinated entities dropped 2.95 → 0.68 per response
- Cost: ~4x token usage

## Anthropic Citations API
- Source: Anthropic documentation
- Customer Endex: source hallucinations 10% → 0% with extract-then-reason approach

## Key Papers and Sources

1. **Anthropic "Reduce Hallucinations"** — seven core techniques: say "I don't know",
   direct quotes, citation verification, chain-of-thought, best-of-N, iterative
   refinement, context restriction.

2. **Anthropic "On the Biology of a Large Language Model"** — hallucinations are
   circuit misfires where "known entity" features incorrectly suppress the model's
   default refusal behavior. The refusal circuit is active by default but gets overridden.

3. **OpenAI "Why Language Models Hallucinate" (Kalai & Nachum, 2025)** — training and
   evaluation reward guessing over admitting uncertainty. Current benchmarks create
   perverse incentives. Hallucinations mathematically proven inevitable under current
   architectures (Xu et al. 2024).

4. **"We Have a Package for You" (USENIX 2025)** — definitive study on package
   hallucination. 19.7% fabrication rate, 58% repeat consistently, slopsquatting attacks.

5. **"Beyond Functional Correctness" (ACM SIGSOFT 2024-2025)** — taxonomy of code
   hallucinations: requirement conflicting, code inconsistency (25.5%), knowledge
   conflicting (nonexistent APIs, wrong signatures).

6. **Microsoft Azure Four-Layer Mitigation (2025)** — RAG layer, prompt engineering
   layer (ICE: Instructions → Constraints → Escalation), system-level defenses,
   evaluation feedback loops.

## Tools Referenced

- **Socket** — package registry scanning for suspicious/hallucinated packages
- **Context7 MCP** — real-time version-specific docs for 9000+ libraries
- **NVIDIA NeMo Guardrails** — runtime input/output rails, 92% detection rate
- **K8sGPT** — live cluster scanning for K8s hallucination verification
- **Datadog LLM Observability** — distinguishes contradictions from unsupported claims
- **promptfoo** — eval framework with hallucination test configs for CI/CD
- **WikiChat** — few-shot grounding, 97.9% factual accuracy in research applications
