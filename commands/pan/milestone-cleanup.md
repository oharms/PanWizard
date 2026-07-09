---
name: pan:milestone-cleanup
group: Milestone
description: Archive accumulated phase directories from completed milestones
---
<objective>
Archive phase directories from completed milestones into `.planning/milestones/v{X.Y}-phases/`.

Use when `.planning/phases/` has accumulated directories from past milestones.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/milestone-cleanup.md
</execution_context>

<process>
Follow the cleanup workflow at @~/.claude/pan-wizard-core/workflows/milestone-cleanup.md.
Identify completed milestones, show a dry-run summary, and archive on confirmation.
</process>
