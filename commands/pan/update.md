---
name: pan:update
group: System
description: Update PAN to latest version with changelog display
argument-hint: "[--yes]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Check for PAN updates, install if available, and display what changed.

Routes to the update workflow which handles:
- Version detection (local vs global installation)
- npm version checking
- Changelog fetching and display
- User confirmation with clean install warning
- Update execution and cache clearing
- Restart reminder
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/update.md
</execution_context>

<process>
**Follow the update workflow** from `@~/.claude/pan-wizard-core/workflows/update.md`.

Arguments: $ARGUMENTS. Pass them to the workflow: `--yes` (or `-y`) skips the confirmation question; the clean-install warning is still shown.

The workflow handles all logic including:
1. Installed version detection (local/global)
2. Latest version checking via npm
3. Version comparison
4. Changelog fetching and extraction
5. Clean install warning display
6. User confirmation (skipped with `--yes`)
7. Update execution
8. Cache clearing
9. An offer to reapply backed-up local patches (`/pan:patches`) at once
</process>
