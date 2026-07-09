---
name: pan:milestone-gaps
group: Milestone
description: Create phases to close all gaps identified by milestone audit
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<objective>
Create all phases necessary to close gaps identified by `/pan:milestone-audit`.

Reads milestone-audit.md, groups gaps into logical phases, creates phase entries in roadmap.md, and offers to plan each phase.

One command creates all fix phases — no manual `/pan:add-phase` per gap.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/milestone-gaps.md
</execution_context>

<context>
**Audit results:**
Glob: .planning/v*-milestone-audit.md (use most recent)

Original intent and current planning state are loaded on demand inside the workflow.
</context>

<process>
Execute the plan-milestone-gaps workflow from @~/.claude/pan-wizard-core/workflows/milestone-gaps.md end-to-end.
Preserve all workflow gates (audit loading, prioritization, phase grouping, user confirmation, roadmap updates).
</process>
