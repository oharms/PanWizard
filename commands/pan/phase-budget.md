---
name: pan:phase-budget
group: Phase Management
description: Estimate context utilization and quality for the current phase
allowed-tools:
  - Bash
  - Read
---
<objective>
Show how much of the AI's context window is consumed by the current project's planning files. Helps prevent context rot by making invisible token budgets visible and measurable.
</objective>

<execution_context>
Run: `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs context-budget --raw`
</execution_context>

<process>
1. Run the context-budget command to get the current budget report
2. Display the results to the user
3. If status is "critical", recommend splitting the current phase
4. If status is "warning", suggest monitoring quality during execution
5. If status is "idle", suggest running /pan:plan-phase to start work
</process>
