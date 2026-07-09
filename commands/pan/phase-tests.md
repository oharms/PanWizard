---
name: pan:phase-tests
group: Phase Management
description: Generate tests for a completed phase based on UAT criteria and implementation
argument-hint: "<phase> [additional instructions]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
argument-instructions: "Parse <phase> as a phase number (integer, decimal like 1.1, or letter-suffix like 1a) followed by optional free-text instructions. Examples: /pan:phase-tests 12 — /pan:phase-tests 12 focus on edge cases in the pricing module"
---
<objective>
Generate unit and E2E tests for a completed phase, using its summary.md, context.md, and verification.md as specifications.

Analyzes implementation files, classifies them into TDD (unit), E2E (browser), or Skip categories, presents a test plan for user approval, then generates tests following RED-GREEN conventions.

Output: Test files committed with message `test(phase-{N}): add unit and E2E tests from add-tests command`
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/phase-tests.md
</execution_context>

<context>
Phase: $ARGUMENTS

@.planning/state.md
@.planning/roadmap.md
</context>

<process>
Execute the add-tests workflow from @~/.claude/pan-wizard-core/workflows/phase-tests.md end-to-end.
Preserve all workflow gates (classification approval, test plan approval, RED-GREEN verification, gap reporting).
</process>
