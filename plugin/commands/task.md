---
name: task
description: Execute a single task with rule-guided metacognition and doc sync
---

# Task Execution with Metacognitive Analysis

Task: $ARGUMENTS

## Pre-Flight

Before starting:
1. Check CLAUDE.md Context Router — load relevant domain rules
2. Check memory files — any relevant past learnings?
3. Determine if task touches an area with specific patterns

## Mandatory Execution Process

**STEP 1: Rule Selection via rule-advisor (REQUIRED)**

Execute rule-advisor to analyze the task and select appropriate rules:
```
subagent_type: rule-advisor
description: "Rule analysis"
prompt: |
  Analyze this task and select appropriate rules.
  Task: $ARGUMENTS
  Project stack: [from CLAUDE.md]
  Domain rules: [from context router]
```

**STEP 2: Utilize rule-advisor Output**

1. **Understand Task Essence** (from `taskEssence`)
   - Focus on fundamental purpose, not surface work
   - Distinguish "quick fix" vs "proper solution"

2. **Follow Selected Rules** (from `selectedRules`)
   - Apply project-specific rules from CLAUDE.md
   - Apply stack-specific patterns

3. **Recognize Past Failures** (from `pastFailurePatterns`)
   - Check memory files for similar past issues
   - Apply countermeasures

4. **Execute First Action** (from `firstActionGuidance`)

**STEP 3: Create Task List with TodoWrite**

Register work steps. Always include:
- First: "Confirm skill constraints"
- Last: "Verify skill fidelity"
- Last+1: "Doc sync check"

**STEP 4: Execute Implementation**

Proceed with task-executor following selected rules.

**STEP 5: Quality Check**

Run quality-fixer after implementation.

**STEP 6: Doc Sync**

After task completion:
- Update task file (if one exists) — check off completed items
- Check if roadmap or backlog needs updating
- If significant change, note in CLAUDE.md Current State

## Important Notes

- Execute rule-advisor FIRST — mandatory metacognitive step
- Check CLAUDE.md context router BEFORE starting
- Update docs AFTER completing
- Follow project anti-patterns list
