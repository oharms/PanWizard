---
name: pan:retro
group: Milestone Lifecycle
description: Milestone retrospective — analyze estimation accuracy, verification patterns, and common gaps
argument-hint: ""
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Analyze completed milestone work to identify process improvement opportunities.

Examines roadmap phases (planned vs completed, gap closures), verification results (pass rates, common gaps), and estimation accuracy. Output guides future planning improvements.

This is a reflection command — it does not modify any files.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/retro.md
</execution_context>

<context>
No arguments required. Operates on the current `.planning/` directory.

The retro command is typically run after `/pan:milestone-done` to reflect on the milestone before starting the next one.
</context>

<process>
Execute the retro workflow from @~/.claude/pan-wizard-core/workflows/retro.md end-to-end.
Present findings in a structured, actionable format.
</process>
