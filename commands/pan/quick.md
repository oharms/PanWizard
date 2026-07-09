---
name: pan:quick
group: Session & Progress
description: Execute a quick task with PAN guarantees (atomic commits, state tracking) but skip optional agents
argument-hint: "[--full]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
---
<objective>
Execute small, ad-hoc tasks with PAN guarantees (atomic commits, state.md tracking).

Quick mode is the same system with a shorter path:
- Spawns pan-planner (quick mode) + pan-executor(s)
- Quick tasks live in `.planning/quick/` separate from planned phases
- Updates state.md "Quick Tasks Completed" table (NOT roadmap.md)

**Default:** Skips research, plan-checker, verifier. Use when you know exactly what to do.

**`--full` flag:** Enables plan-checking (max 2 iterations) and post-execution verification. Use when you want quality guarantees without full milestone ceremony.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/quick.md
</execution_context>

<context>
$ARGUMENTS

Context files are resolved inside the workflow (`init quick`) and delegated via `<files_to_read>` blocks.
</context>

<process>
Execute the quick workflow from @~/.claude/pan-wizard-core/workflows/quick.md end-to-end.
Preserve all workflow gates (validation, task description, planning, execution, state updates, commits).

**Scope Containment:**
Implement only what was asked. Do not refactor surrounding code, add unrelated improvements, or create abstractions for one-time fixes.

**State Intent Before Implementing:**
Before coding, state: "I will modify [files], adding [what], to achieve [goal]."

**Pre-Commit Verification Checklist — apply before the final commit:**
1. Every modified file was read before editing
2. `git diff --stat` contains only files related to the task
3. Tests pass (run the project's test suite)
4. Commit message accurately describes the verified change
5. No secrets or credentials staged

If any check fails: fix and re-verify before committing.
</process>
