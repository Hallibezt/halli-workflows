# Agentic Workflow Token Patterns

Patterns for keeping agent workflows cost-effective without reducing capability.

## Why Agents Are Expensive

LLM APIs are stateless. Every turn resends the entire conversation. A 20K-token system
prompt across 50 turns = 1M tokens of redundant computation at full price.

Agent teams (subagents) use ~7x more tokens than standard sessions because each
maintains its own context window. Tool definitions alone consume 14K-17K tokens per
request before any user content.

## Compaction Strategy

### When to compact
- Every 10-15 turns, or when context exceeds 50% capacity
- After a phase completes (natural boundary)
- Before starting a new major subtask

### How to compact
Use `/compact` with a focus directive:
```
/compact Focus on the authentication changes and test results
/compact Keep the API design decisions, discard file read outputs
```

Targeted compaction preserves what matters and drops what doesn't. Generic
compaction loses important context.

### What to preserve vs discard
| Preserve | Discard |
|---|---|
| Architectural decisions | Raw file contents read 10+ turns ago |
| User-approved approaches | Intermediate tool outputs |
| Error patterns identified | Successful test run details |
| API contracts agreed on | Search results already acted on |
| Current phase goals | Completed phase details |

## Tool Result Clearing

The safest, lightest-touch compaction. Raw tool results from old turns add
no value — the agent already extracted what it needed.

A 50K-token DB dump at Turn 1, followed by 5 questions = that dump is paid
for 6 times = 300K tokens for a single result.

Pattern: After extracting facts from a tool result, the context should retain
only the extracted facts, not the raw output.

## Discovery-Based Tool Loading

Problem: 100 MCP servers at ~200 tokens each = 20K tokens per request.

Solution: Serve a compact menu of tool categories first (~500 tokens total),
then load full schemas only for tools the agent actually needs this turn.
Reduces overhead by up to 98%.

## Multi-Agent Delegation

This is what halli-workflows already does well. The key principle:
- Main orchestrator has small context (just coordination)
- Subagents do heavy work in their own context windows
- Only summaries return to the orchestrator

The savings: instead of a 200K-token main context doing everything,
you have a 20K-token orchestrator + N short-lived subagent contexts.

## Budget Safety

### Hard ceilings (non-negotiable for production agents)
- `max_tokens` per request
- Max turns per agent loop
- Total dollar budget per run
- Auto-termination when ceiling hit

### Loop detection
- Embedding similarity between turns (detecting repetitive output)
- Tool call pattern matching (same tool, same args, repeated)
- Output length monitoring (sudden verbosity = potential loop)

## Batch vs Interactive

| Use batch (50% off) | Use interactive |
|---|---|
| Bulk document processing | User-facing chat |
| Offline analysis | Agent tool calls that depend on previous results |
| Evaluation pipelines | Real-time decision making |
| Parallelizable subtasks | Sequential reasoning chains |
