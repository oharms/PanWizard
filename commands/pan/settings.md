---
name: pan:settings
group: System
description: Configure PAN workflow toggles and model profile
argument-hint: "[--profile <quality|balanced|budget>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---
<routes>
These flags select another mode of this command. Each was a separate command, and its old name still runs this one as an alias. When one is present, follow the named workflow instead of the steps below, with the rest of the arguments as its `$ARGUMENTS`, and stop when it ends.

- `--profile <quality|balanced|budget>` — switch the model profile only: @~/.claude/pan-wizard-core/workflows/profile.md (formerly `profile`)
</routes>

<objective>
Interactive configuration of PAN workflow agents and model profile via multi-question prompt.

Routes to the settings workflow which handles:
- Config existence ensuring
- Current settings reading and parsing
- Interactive multi-question prompt (model profile, research, plan_check, verifier, auto_advance, nyquist_validation, branching strategy, routing strategy)
- Config merging and writing
- Confirmation display with quick command references
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/settings.md
</execution_context>

<process>
**Follow the settings workflow** from `@~/.claude/pan-wizard-core/workflows/settings.md`.

The workflow handles all logic including:
1. Config file creation with defaults if missing
2. Current config reading
3. Interactive settings presentation with pre-selection
4. Answer parsing and config merging
5. File writing
6. Confirmation display
</process>
