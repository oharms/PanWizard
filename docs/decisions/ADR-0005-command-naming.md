# ADR-0005: Command Naming Restructure

## Status
Proposed

## Context

PAN Wizard has grown to 32 user-facing commands under the `/pan:` namespace. The naming was organic — each command was named when it was created, without a systematic framework. This has produced:

1. **Inconsistent patterns:** 22 verb-first (`add-phase`), 8 noun-only (`progress`), 2 adjective-noun (`context-budget`). No single convention dominates.
2. **Overly long names:** `list-phase-assumptions` (28 chars with prefix), `complete-milestone` (23 chars), `reapply-patches` (21 chars). Mean invocation: 20.3 characters.
3. **Flat help output:** All 32 commands listed alphabetically with no grouping. Users must scan the entire list to find what they need.
4. **Implicit grouping not surfaced:** Phase commands (11), milestone commands (5), session commands (4) form natural groups but aren't presented that way.

Industry precedent is strong: Docker restructured at ~20 commands (2017), gh CLI launched with noun-verb grouping, kubectl uses verb-resource with help categories. The inflection point where flat naming breaks down is well-documented at 20-25 commands.

## Decision

### 1. Rename 18 of 32 commands for consistency and brevity

Key renames:
- `execute-phase` → `exec-phase` (universally understood abbreviation)
- `verify-work` → `verify-phase` (consistent with other phase commands)
- `list-phase-assumptions` → `assumptions` (saves 12 chars; context obvious)
- `pause-work` → `pause`, `resume-work` → `resume` (unambiguous without suffix)
- Milestone commands → `milestone-*` prefix (`milestone-new`, `milestone-done`, `milestone-audit`, `milestone-gaps`, `milestone-cleanup`)
- `add-todo` → `todo-add`, `check-todos` → `todo-check` (consistent pair)
- `join-discord` → `discord`, `reapply-patches` → `patches` (shorter)

### 2. Keep 14 commands unchanged

Commands with clear, short, consistent names: `new-project`, `map-codebase`, `discuss-phase`, `plan-phase`, `research-phase`, `add-phase`, `insert-phase`, `remove-phase`, `progress`, `quick`, `settings`, `help`, `health`, `update`, `debug`.

### 3. Create alias .md files for all renamed commands

Each old name gets an alias .md file that loads the new command via `@execution_context`. Old invocations continue to work identically. Aliases marked for removal after 2 minor versions.

### 4. Add `group` frontmatter field to all 32 commands

7 groups: Getting Started, Phase Lifecycle, Phase Management, Session & Progress, Milestone, System, and a fallback "Other" for commands missing the field.

### 5. Redesign help output to show groups

`/pan:help` displays commands organized by group with descriptions, not a flat alphabetical list.

## Consequences

### Positive
- Mean invocation length drops 25% (20.3 → 15.3 chars)
- Grouped help makes discovery of related commands immediate
- Milestone lifecycle visible: `milestone-new` → `milestone-audit` → `milestone-gaps` → `milestone-done` → `milestone-cleanup`
- Predictable patterns help AI agents infer command names
- Clear framework for naming future commands

### Negative
- 18 alias files to maintain during deprecation period
- Users who've memorized old names see deprecation notes (mitigated: old names keep working)
- `cleanup` → `milestone-cleanup` is longer (but grouped and discoverable)
- `settings` → unchanged, breaking the milestone-* pattern for project config

### Neutral
- No core library changes (purely orchestration-layer)
- No JSON output schema changes
- No state.md or roadmap.md format changes
- Installer needs converter updates for Codex/Copilot skill filenames

## Options Considered

1. **Full noun-verb restructuring (Docker-style)** — Rename ALL commands to `noun-verb` pattern (`phase-plan`, `phase-exec`, `project-init`). Rejected because: PAN has 11 phase commands, too many for one noun group; verb-first reads more naturally as imperative in slash commands; would rename 28 of 32 commands for marginal benefit over selective rename.

2. **Selective rename (chosen)** — Rename 18 commands for consistency and brevity, keep 14 that already have good names. Creates aliases for backward compat. Best balance of improvement vs disruption.

3. **No rename, only grouped help** — Add `group` frontmatter and redesign help output without renaming. Rejected because: long names (`list-phase-assumptions`) and inconsistent patterns remain; misses the opportunity to shorten frequent commands.

4. **Dual namespace (Cursor-style)** — Add `@` prefix for context commands alongside `/` for action commands. Rejected because: PAN operates via slash commands only across 5 runtimes; introducing a second prefix adds complexity without clear benefit.

## Links
- Spec: `docs/specs/command_naming_optimization_featureai.md`
- Related: All 32 command .md files in `commands/pan/`
- Precedent: Docker CLI restructuring (2017), gh CLI design
