---
name: diagnose
description: Investigate problem, verify findings, and derive solutions with project-aware context
---

**Command Context**: Diagnosis flow to identify root cause and present solutions

Target problem: $ARGUMENTS

**Role**: Orchestrator

## Pre-Flight: Project Context

Before investigation:
1. Check CLAUDE.md for known anti-patterns that might be the cause
2. Check memory files for similar past issues
3. Load relevant domain rules via Context Router

## Step 0: Problem Structuring

### 0.1 Problem Type Determination

| Type | Criteria |
|------|----------|
| Change Failure | Something changed before the problem appeared |
| New Discovery | No relation to recent changes |

If uncertain, ask the user.

### 0.2 Information for Change Failures

If unclear, **ask with AskUserQuestion**:
- What was changed (cause)
- What broke (effect)
- Relationship between both

### 0.3 Problem Essence (rule-advisor)

```
subagent_type: rule-advisor
prompt: |
  Identify essence and rules for: [problem]
  Project stack: [from CLAUDE.md]
  Known anti-patterns: [from CLAUDE.md]
```

### 0.4 Anti-Pattern Pre-Check

Before deep investigation, quick-check against CLAUDE.md anti-patterns:
- Does the problem match a known anti-pattern?
- If yes, flag this as a likely cause early

## Diagnosis Flow

```
Problem → investigator → verifier → solver ─┐
                 ↑                            │
                 └── confidence < high ───────┘
                      (max 2 iterations)

confidence=high reached → Report
```

**Context Separation**: Pass only structured JSON between steps.

## Execution Steps

Register in TodoWrite and execute:

### Step 1: Investigation

```
subagent_type: investigator
prompt: |
  Comprehensively collect information about: [problem]

  Project context:
  - Stack: [from CLAUDE.md]
  - Known anti-patterns: [relevant ones]
  - Memory notes: [any relevant past issues]
```

### Step 2: Quality Check

Verify investigation output contains:
- [ ] comparisonAnalysis
- [ ] causalChain for each hypothesis
- [ ] causeCategory for each hypothesis
- [ ] Investigation of CLAUDE.md anti-patterns as potential causes

If insufficient → re-run investigator.

### Step 3: Verification

```
subagent_type: verifier
prompt: |
  Verify investigation results: [JSON output]

  Also check: Does the conclusion violate any project rules from CLAUDE.md?
```

### Step 4: Solution Derivation

```
subagent_type: solver
prompt: |
  Derive solutions for: [verified causes]
  Confidence: [high/medium/low]

  Constraints: Solutions must not violate CLAUDE.md rules.
  Stack: [from CLAUDE.md]
```

### Step 5: Final Report

```markdown
## Diagnosis Result

### Identified Causes
[cause list]

### Anti-Pattern Match
[did this match a known anti-pattern? → add to CLAUDE.md if new]

### Verification Process
- Investigation scope: [scope]
- Additional iterations: [0/1/2]
- Alternative hypotheses: [count]

### Recommended Solution
[solution]
Rationale: [why]

### Implementation Steps
1. [step]
2. [step]

### Alternatives
[other options]

### Residual Risks
[risks]

### Memory Update
[should we add this to memory for future reference?]
```

## Completion Criteria

- [ ] Problem type determined, context loaded
- [ ] Anti-patterns checked as potential causes
- [ ] investigator executed with evidence matrix
- [ ] verifier confirmed findings
- [ ] solver provided solutions compatible with project rules
- [ ] confidence=high achieved (or user approved after 2 iterations)
- [ ] Report presented with memory update suggestion
