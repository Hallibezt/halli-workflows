---
name: verify-claims
description: Ground-truth verification — strips agent findings down to bare claims and verifies each against actual source files. Use after multi-agent research sessions to catch confirmation bias and false discoveries before acting on findings. Call as /verify-claims with raw agent output or a plain list of claims.
---

**Command Context**: Post-research verification to break the bias chain before implementing findings.

Input (agent findings, research notes, or plain claim list): $ARGUMENTS

## Why This Exists

Multi-agent research suffers from anchoring. Agent 2 reads Agent 1's framing and confirms it rather than independently checking the source. "Critical reviewers" are still part of the same reasoning chain — they build on the framing they were given. The result: agents "discover" bugs that don't exist, miss bugs that do, and confidently report stale or wrong conclusions.

This command interrupts that chain. The verifier receives **claims only** — stripped of reasoning, narrative, and context. It goes to source files. It does not know what the other agents thought.

## Orchestrator Definition

I am an orchestrator and claims extractor. My job is to strip reasoning from findings and send bare claims to a cold verifier that has never seen the analysis.

## Execution Flow

### Step 1: Extract Claims

From the input, extract only the **factual claims** — things that can be verified by reading source code.

A good claim is:
- **Specific** — names a function, file, constant, value, or behavior
- **Checkable** — can be verified by reading code
- **Atomic** — one assertion per claim
- **Stripped** — no reasoning, no "because", no recommendation

**Not a claim** (opinion): "We should apply latFactor inside geomagneticFactor()"
**Is a claim**: "geomagneticFactor() currently has no latitude parameter"

**Not a claim** (vague): "The zone table is wrong"
**Is a claim**: "The zone table maps Helsinki to Zone 4"

**Not a claim** (compound): "Helsinki is Zone 4 and Hamburg is Zone 6, both incorrect"
**Is a claim** (split): "Helsinki is mapped to Zone 4 in the zone table" + "Hamburg is mapped to Zone 6 in the zone table"

Build a numbered list before proceeding:
```
C1: geomagneticFactor() has no latitude parameter
C2: Helsinki is mapped to Zone 4 in the zone lookup table
C3: kp-oval.ts line 41 contains the formula 66 - 2*KP
C4: The engine coherence test expects Helsinki as Zone 5
C5: The zone table has no entry between KP=3 and KP=5
```

Show the extracted claims to the user before running verification — let them add or remove before proceeding.

### Step 2: Run ground-truth-verifier

```
subagent_type: ground-truth-verifier
prompt: |
  Verify these claims against the actual codebase. Go directly to source files.

  DO NOT read any prior agent analysis, research notes, or findings documents.
  Each claim is a hypothesis — treat it as unproven until you find the source.

  Claims:
  [claims list]

  Codebase root: [from CLAUDE.md working directory or git root]
```

### Step 3: Present Verdict Table

Format the results clearly:

```markdown
## Ground Truth Verification Results

| ID | Claim | Verdict | Evidence |
|----|-------|---------|----------|
| C1 | geomagneticFactor() has no lat param | ✅ VERIFIED | geomagnetic.ts:12 |
| C2 | Helsinki mapped to Zone 4 | ❌ REFUTED — FALSE DISCOVERY | coherence.test.ts:688 already Zone 5 |
| C3 | kp-oval.ts:41 has `66 - 2*KP` | ✅ VERIFIED | kp-oval.ts:41 |
| C4 | Zone table has KP 3→5 gap | ✅ VERIFIED | zone-table.ts:23-31 |
| C5 | Coherence test expects Zone 5 | ✅ VERIFIED | coherence.test.ts:688 |

### Act on These (verified findings)
- C1 — geomagneticFactor() genuinely lacks latitude awareness
- C3, C4 — kp-oval formula and zone table gap both confirmed

### Do NOT Act On These (false discoveries)
- C2 — Helsinki Zone 5 already correct in engine and tests. The "finding" was noise.

### Needs More Investigation
- (none)
```

### Step 4: Advise

Based on verdicts:
- **VERIFIED** → real finding, safe to act on
- **REFUTED (false discovery)** → code already correct, do NOT implement "fixes"
- **REFUTED (code is wrong differently)** → agent had the direction right but the details wrong — re-investigate with specific file:line context
- **UNVERIFIABLE** → needs a human to locate the relevant code before proceeding

## Completion Criteria

- [ ] Claims extracted and shown to user
- [ ] ground-truth-verifier executed with claims list only (no prior analysis)
- [ ] Verdict table presented with file:line evidence
- [ ] False discoveries explicitly flagged
- [ ] User advised on which findings are real vs noise
