---
name: anti-hallucination
description: >
  Layered mitigation patterns for preventing AI hallucinations in technical workflows.
  Provides risk-calibrated techniques, domain-specific defenses, and CLAUDE.md context
  blocks. Use during /kickoff to bake anti-hallucination rules into new projects, during
  /audit to check existing codebases for hallucination-prone patterns, and during /review
  to flag risky AI-generated code. Covers all domains: web, embedded, RF, DevOps, scientific.
---

# Anti-Hallucination Patterns for Technical Workflows

Hallucinations are mathematically inevitable in current LLMs (Xu et al. 2024). But layered
mitigation reduces them by up to 96%. This skill provides the patterns — agents choose
which layers to apply based on context.

For full research backing, see `references/research-foundations.md`.

---

## Core Principle

> Treat every AI output as an unverified pull request from a confident junior engineer
> who has read a lot but built little. Review the diff. Run the tests. Check the specs.
> Merge only what you've verified.

---

## The Mitigation Layers

### Layer 1: Always-On (zero cost — bake into every CLAUDE.md)

These go in every project's persistent context. Non-negotiable.

- **Explicit "I don't know" permission** — highest single impact, costs nothing.
  LLMs default to confident responses even when unsure. Giving explicit permission
  to express uncertainty reduces hallucination by ~60%.
- **FACT / INFERENCE / SPECULATION labels** — force categorization of claims.
  Use structural labels, not numeric confidence (LLM self-reported confidence is poorly calibrated).
- **Domain constraints** — restrict to provided sources for factual work.
  "Using ONLY the information in [doc], answer. If not in the doc, say so."
- **Verify every dependency** — never install an AI-suggested package without
  checking it exists in the actual registry. 19.7% of AI-recommended packages are fabricated.
- **Temperature 0 for factual work** — every major AI lab recommends this.

### Layer 2: Medium-Stakes (use for production code, unfamiliar APIs)

- **Context grounding (RAG / paste the docs)** — inject relevant API docs, datasheets,
  or spec sections into context before asking. Cuts hallucination 42-68%.
- **Best-of-N verification** — run the same prompt 2-3 times, compare outputs.
  Different API names or spec values on different runs = neither trusted.
- **Extract-then-reason** — for long documents, extract exact quotes before reasoning.
  Anthropic's Citations API reduced source hallucination from 10% to 0% with this.

### Layer 3: High-Stakes Only (architecture decisions, security, safety-critical)

- **Chain-of-Verification (CoVe)** — draft answer → fact-check questions → independent
  answers → verified final. ~4x tokens. Improved factual accuracy from 55.9% to 71.4%.
- **Cross-model verification** — second model/session critiques the first. Use for
  critical algorithms, irreversible infrastructure changes.

### Red Lines — Never Skip

- Never install a package without registry verification
- Never apply AI-generated K8s/Helm without `--dry-run=server`
- Never trust AI-generated hardware specs without datasheet cross-reference
- Never cite an AI-provided reference without DOI/database lookup
- Never ship code you can't explain

---

## Domain-Specific Defenses

### Web / Full-Stack (Node, React, Next.js, etc.)
- Validate every import against npm/PyPI/crates.io
- Feed library docs into context — dramatically reduces API hallucination
- Well-established libraries have far better coverage than niche/new ones
- Strongly typed (TypeScript strict) catches more than loosely typed
- Cross-version contamination is common (Supabase v1 patterns in v2 code)

### Embedded / Firmware (Rust, C, MCU)
- Always RAG with the actual MCU datasheet sections
- Two variants of the same chip family have different register maps
- Hardware-in-the-loop testing is essential for timing-sensitive code
- GPT-4 produces functional I2C interfaces only 66% of the time
- Encode domain rules: "ISRs must not contain blocking calls"

### RF / Radio Engineering
- Every numerical spec (frequencies, impedances, power, antenna dimensions)
  must be verified against manufacturer data
- Never trust AI-calculated impedance matching without independent verification

### Kubernetes / DevOps
- `kubectl apply --dry-run=server` before any AI-generated manifest
- Pin API versions explicitly: "Use apps/v1 for Deployments"
- K8sGPT scans live clusters to verify AI-suggested changes

### Scientific / Research
- 47-91% of AI-generated references are fabricated
- Never ask AI for citations — find them yourself
- Validate formulas against known test cases with known answers

---

## CLAUDE.md Anti-Hallucination Block

When generating CLAUDE.md for a new project, include this adapted block:

```markdown
## AI Hallucination Prevention

### Rules
- If not confident in any technical detail, say so explicitly.
  Say "I'm not certain — please verify" rather than guessing.
  Never fabricate API names, library functions, package names, or specs.
- Before suggesting any external dependency, state its exact name and source.
  Verify it exists before installing.
- When referencing library APIs, state which version you are targeting.
  If unsure of the exact signature, say so.
- Separate FACT (from provided data) from INFERENCE (logical conclusion)
  from SPECULATION (educated guess). Label accordingly for non-trivial claims.
- [DOMAIN-SPECIFIC RULE — see domain section]
```

**Domain-specific rule to inject:**

| Domain | Add this rule |
|--------|--------------|
| Any code | "Before recommending a package, confirm it exists on [registry]. If unsure, say so." |
| Embedded / firmware | "All register addresses, pin assignments, and timing values must reference the specific MCU datasheet." |
| Kubernetes / Helm | "Always use correct API version for target cluster. Flag manifests for --dry-run=server." |
| RF engineering | "All frequency, impedance, power, and antenna values verified against manufacturer data." |
| Scientific | "Do not generate citations. Flag all formulas for independent verification." |

---

## Risk Profile Quick Reference

| Risk Level | What to Apply |
|------------|--------------|
| Low (hobby/learning) | Layer 1 always-on + package verification |
| Medium (internal tool, team project) | Layer 1 + context grounding + best-of-N for production code |
| High (production / hardware / safety) | All layers + CoVe for architecture + cross-model for irreversible changes |

---

## Hallucination Detection Signals

Watch for these patterns — they indicate likely hallucination:

- **Confident specificity on obscure topics** — exact version numbers, niche API params
- **Parameters that "sound right"** — `includeSoftDeleted`, `retryWithBackoff` that don't exist
- **Cross-library blending** — React Query's `staleTime` mixed with SWR's `revalidateOnFocus`
- **Plausible but non-existent packages** — 58% of fabricated packages repeat consistently
- **Register addresses and pin assignments** — especially between chip family variants
- **Invented kubectl flags or YAML fields** — syntax looks valid, semantics are wrong
- **Citations with real-sounding DOIs** — 47% fabrication rate in some studies
