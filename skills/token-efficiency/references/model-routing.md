# Model Routing Guide

Right-size the model to the task. The quality gap between tiers is shrinking fast.

## Decision Matrix

| Task | Recommended | Why | Cost vs Opus |
|---|---|---|---|
| **Scientific reasoning** (GPQA-class) | Opus | 17-point gap on GPQA Diamond | 1x |
| **Novel multi-step logic** | Opus | Frontier premium real for novel problems | 1x |
| **Architecture decisions** | Opus or Sonnet | Sonnet is 98% of Opus on SWE-bench | 0.2x |
| **Code generation** (daily dev) | Sonnet | Sweet spot: 79.6% SWE-bench | 0.2x |
| **Code review** | Sonnet | Needs nuance but not frontier reasoning | 0.2x |
| **Classification** | Haiku | Comparable quality, 17x cheaper | 0.04x |
| **Data extraction** | Haiku | Structured task, no reasoning needed | 0.04x |
| **Formatting / transformation** | Haiku | Deterministic task | 0.04x |
| **Simple Q&A** | Haiku | Frontier adds no value | 0.04x |
| **Sentiment analysis** | Haiku | Fine-tuned BERT often beats GPT-4 here | 0.04x |
| **Batch processing** | Any + Batch API | Flat 50% discount | 0.5x base |

## The Cascade Pattern

Try the cheapest model first, escalate only on low confidence:

```
Haiku → confidence check → Sonnet → confidence check → Opus
```

Saves 50-70% vs using a single model tier. Amazon Bedrock showed 60% savings
with their Anthropic family router.

## When NOT to Downgrade

- The task involves novel reasoning (not pattern matching)
- Errors are expensive to fix (security, data integrity)
- The output will be consumed by another agent that needs high fidelity
- You're debugging something subtle (pay for the best eyes)

## RouteLLM Research

LMSYS/ICLR 2025: Matrix factorization router achieved 95% of GPT-4 performance
using only 26% GPT-4 calls. With data augmentation, only 14% needed GPT-4.
Routers generalize to new model pairs without retraining.

## Price Trend

LLM inference prices are declining 5-10x per year on the Pareto frontier
(NeurIPS 2025). Today's optimization will need recalibration in 6 months.
The durable investment is measurement infrastructure.
