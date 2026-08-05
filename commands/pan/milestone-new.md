---
name: pan:milestone-new
group: Milestone
description: Start a new milestone cycle — update project.md and route to requirements
argument-hint: "[milestone name, e.g., 'v1.1 Notifications']"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
---
<objective>
Start a new milestone: questioning → research (optional) → requirements → roadmap.

Brownfield equivalent of new-project. Project exists, project.md has history. Gathers "what's next", updates project.md, then runs requirements → roadmap cycle.

**Creates/Updates:**
- `.planning/project.md` — updated with new milestone goals
- `.planning/research/` — domain research (optional, NEW features only)
- `.planning/requirements.md` — scoped requirements for this milestone
- `.planning/roadmap.md` — phase structure (continues numbering)
- `.planning/state.md` — reset for new milestone

**After:** `/pan:design-phase [N]` → `/pan:plan-phase [N]` to design then plan the first phase.

**Design altitude (ADR-0042):** product/strategic design — demand validation, competitive intelligence, market positioning — belongs HERE at milestone creation (via the requirements/research cycle, or `/pan:focus-design` for a strategic feature), done ONCE. Per-phase architecture/ADR/threat design is `/pan:design-phase`, run per phase. Do not defer product questions to per-phase design, and do not re-open them there.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/milestone-new.md
@~/.claude/pan-wizard-core/references/questioning.md
@~/.claude/pan-wizard-core/references/ui-brand.md
@~/.claude/pan-wizard-core/templates/project.md
@~/.claude/pan-wizard-core/templates/requirements.md
</execution_context>

<context>
Milestone name: $ARGUMENTS (optional - will prompt if not provided)

Project and milestone context files are resolved inside the workflow (`init new-milestone`) and delegated via `<files_to_read>` blocks where subagents are used.
</context>

<process>
Execute the new-milestone workflow from @~/.claude/pan-wizard-core/workflows/milestone-new.md end-to-end.
Preserve all workflow gates (validation, questioning, research, requirements, roadmap approval, commits).
</process>
