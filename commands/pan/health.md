---
name: pan:health
group: System
description: Diagnose planning directory health and optionally repair issues
argument-hint: "[--repair] [--standards] [--full] [--drift] [--links]"
allowed-tools:
  - Read
  - Bash
  - Write
  - AskUserQuestion
---
<objective>
Validate `.planning/` directory integrity and report actionable issues. Checks for missing files, invalid configurations, inconsistent state, and orphaned plans.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/health.md
</execution_context>

<process>
Execute the health workflow from @~/.claude/pan-wizard-core/workflows/health.md end-to-end.
Pass the arguments to the workflow, which forwards `--repair`, `--standards`, `--full`, `--drift` and `--links` to `validate health`.
</process>
