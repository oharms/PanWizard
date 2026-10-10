---
name: pan:retro
group: Milestone Lifecycle
description: Milestone retrospective — analyze estimation accuracy, verification patterns, and common gaps
argument-hint: "[--write-memory] [--max N]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Analyze completed milestone work to identify process improvement opportunities.

Examines roadmap phases (planned vs completed, gap closures), verification results (pass rates, common gaps), and estimation accuracy. Output guides future planning improvements.

This is a reflection command — **read-only by default**: with no flags it does not modify any files. Passing `--write-memory` is the one exception: it appends recurring-pattern entries to the agent logs in `.planning/memory/`, which `/pan:knowledge` reads. PAN's workflows do not load those logs into agents, so a pattern meant to change the next plan goes into that plan's brief or the project's instructions.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/retro.md
</execution_context>

<context>
No arguments required. Operates on the current `.planning/` directory.

Flags: $ARGUMENTS

**Flags:**
- `--write-memory` — after analysis, append recurring-pattern entries to the agent logs in `.planning/memory/` (stored for `/pan:knowledge`, not loaded into agents). `--max N` caps the planner lessons (default 3). Without `--write-memory` the command is strictly read-only.

The retro command is typically run after `/pan:milestone-done` to reflect on the milestone before starting the next one.
</context>

<process>
Execute the retro workflow from @~/.claude/pan-wizard-core/workflows/retro.md end-to-end.
Present findings in a structured, actionable format.
</process>
