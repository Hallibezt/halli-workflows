---
name: workflow-edit
description: Briefing for editing the halli-workflows plugin itself. Use when the user wants to improve, add, or fix anything in the workflow — new commands, agents, skills, or rules. Tells Claude exactly where to edit, how to commit, and how to sync the cache.
---

**Command Context**: You are about to edit the halli-workflows plugin itself, not a project that uses it.

User intent: $ARGUMENTS

## Architecture Briefing

There are two locations — always work in the source repo, never the cache directly:

| Location | Purpose |
|---|---|
| `/home/halli/halli-workflows/` | **Source repo — the truth. Edit here.** |
| `~/.claude/plugins/cache/halli-workflows/halli-workflows/1.0.0/` | Cache — what Claude Code actually runs. Synced FROM source. |

The cache is what Claude loads at runtime. But the source repo is what gets committed, pushed, and shared. Any edit made only in the cache is lost when the plugin is reinstalled or updated.

## Plugin Structure

```
/home/halli/halli-workflows/
├── agents/          ← Specialized subagents (one .md per agent)
├── commands/        ← User-callable commands like /review, /think (one .md per command)
├── skills/          ← Domain knowledge modules loaded by agents
├── .claude-plugin/
│   └── plugin.json  ← Manifest — register new agents/commands here
└── sync-cache.sh    ← Sync script: source → cache
```

**Adding a new agent**: create `agents/name.md`, register in `plugin.json` agents array.
**Adding a new command**: create `commands/name.md`, register in `plugin.json` commands array.
**Editing an existing agent/command**: edit the file directly in source repo.

## Workflow for Making Changes

### Step 1: Edit in source repo
Make all changes in `/home/halli/halli-workflows/`.

If adding a new agent or command, also update `.claude-plugin/plugin.json`.

### Step 2: Verify
```bash
cd /home/halli/halli-workflows && git diff --stat
```

### Step 3: Commit and push
```bash
cd /home/halli/halli-workflows
git add -A
git commit -m "description of change"
git push
```

### Step 4: Sync cache on this machine
```bash
bash /home/halli/halli-workflows/sync-cache.sh
```

### Step 5: Tell the user
After syncing, tell the user:
> "Changes committed and cache synced. **To pick up the changes, start a new Claude Code session** (the current session loaded the old plugin at startup)."
>
> **On other machines or terminals**: run these two commands:
> ```bash
> cd ~/halli-workflows && git pull
> bash ~/halli-workflows/sync-cache.sh
> ```
> Then open a new Claude Code session.

## Agent File Format

```markdown
---
name: agent-name
description: One-liner — what it does and when to use it
tools: Read, Grep, Glob, LS, TodoWrite
skills: skill-name-1, skill-name-2
---

[Body: responsibilities, input/output format, execution steps, prohibited actions]
```

## Command File Format

```markdown
---
name: command-name
description: When to trigger and what it does
---

**Command Context**: [when this is used]

## Orchestrator Definition
[core identity, execution protocol]

## Execution Flow
[numbered steps, which agents to invoke, stop points]

## Completion Criteria
- [ ] checkboxes
```

## Completion Criteria

- [ ] Changes made in source repo (not cache)
- [ ] plugin.json updated if new agent/command added
- [ ] Committed and pushed
- [ ] Cache synced via sync-cache.sh
- [ ] User told to start a new session + how to update other machines
