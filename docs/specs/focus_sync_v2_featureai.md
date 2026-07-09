# Feature Specification: Enhanced Documentation Sync (focus-sync v2)

**Mode:** `--internal` | **Date:** 2026-03-04 | **Status:** Proposed

---

## Problem Statement

PAN Wizard has 14+ documentation files containing cross-referenced counts, command lists, feature descriptions, and version numbers that must stay synchronized. The current `focus sync` command only checks README.md for 3 entity count patterns (commands, agents, modules). An end-to-end audit revealed 20+ staleness issues across 8 files that focus-sync completely misses: stale test counts, old command names from the v1.0.0 rename, wrong runtime prefixes, missing command entries in tables, and placeholder URLs.

## Demand Evidence

| Evidence Type | Source | Finding |
|---|---|---|
| User-stated pain | This conversation | User explicitly requested end-to-end doc review |
| Repeated manual work | Sessions 22-26 | Every session included manual doc sync |
| Demonstrated miss | v2.3.0 focus-auto | 37->38 count stale in 3 files after adding a command |

## Scope

### In Scope
- Enhance `checkDocStaleness()` to scan all doc files
- Add old command name detection using v1.0.0 rename map
- Add command table completeness checking
- Add version cross-reference (package.json vs CHANGELOG)
- Add COMMAND_RENAME_MAP to constants.cjs

### Out of Scope
- Auto-fix (stays in command .md orchestrator)
- Content/style rewriting
- New agents or hooks

## Success Criteria

```
SC-1: focus sync detects count staleness in ALL doc files, not just README
SC-2: focus sync detects old command names from v1.0.0 rename
SC-3: focus sync reports commands missing from listing tables
SC-4: focus sync verifies package.json version matches CHANGELOG
SC-5: Zero regressions in existing test suite
```

## Current Implementation

`checkDocStaleness()` in focus.cjs (lines 397-431):
1. Counts actual commands, agents, modules from disk
2. Reads only README.md
3. Uses `checkCount()` regex: `(\d+)\s+{entity}`
4. Returns `{ stale, current, actuals }`

## Enhanced Implementation Design

### New checks added to `checkDocStaleness()`:

| Check | Description | Files Scanned |
|-------|-------------|---------------|
| Multi-file counts | Existing count regex applied to all docs | README, ARCHITECTURE, DEVELOPMENT, CONTRIBUTING, USER-GUIDE, CLI-REFERENCE |
| Old name detection | Scan for COMMAND_RENAME_MAP keys | All docs/*.md |
| Command table completeness | Parse tables with `/pan:` entries | README, USER-GUIDE |
| Version consistency | Compare package.json vs CHANGELOG header | package.json, CHANGELOG.md |
| Workflow count | Count workflow .md files, check against docs | ARCHITECTURE.md |
| Test count | Match `N tests` patterns | DEVELOPMENT.md |

### New constant: COMMAND_RENAME_MAP

```js
const COMMAND_RENAME_MAP = {
  'execute-phase': 'exec-phase',
  'verify-work': 'verify-phase',
  'list-phase-assumptions': 'assumptions',
  'add-tests': 'phase-tests',
  'context-budget': 'phase-budget',
  'pause-work': 'pause',
  'resume-work': 'resume',
  'set-profile': 'profile',
  'new-milestone': 'milestone-new',
  'complete-milestone': 'milestone-done',
  'audit-milestone': 'milestone-audit',
  'plan-milestone-gaps': 'milestone-gaps',
  'cleanup': 'milestone-cleanup',
  'add-todo': 'todo-add',
  'check-todos': 'todo-check',
  'join-discord': 'discord',
  'reapply-patches': 'patches',
};
```

### Enhanced output contract (additive):

```json
{
  "actuals": {
    "commands": 38,
    "agents": 11,
    "modules": 15,
    "workflows": 30,
    "version": "2.3.0"
  },
  "stale": [
    { "file": "docs/DEVELOPMENT.md", "entity": "commands", "documented": 37, "actual": 38 }
  ],
  "current": [
    { "file": "README.md", "entity": "commands", "count": 38 }
  ],
  "old_names": [
    { "file": "docs/EXAMPLES.md", "old_name": "resume-work", "current_name": "resume" }
  ],
  "missing_commands": [
    { "file": "docs/USER-GUIDE.md", "command": "focus-auto" }
  ],
  "version_match": true,
  "stale_count": 5,
  "old_name_count": 4,
  "missing_count": 1,
  "needs_sync": true,
  "check_only": true
}
```

## Document Gap Audit (2026-03-04)

### Category A: Stale Counts

| # | File | Entity | Documented | Actual |
|---|------|--------|------------|--------|
| A1 | DEVELOPMENT.md:13 | commands | 37 | 38 |
| A2 | DEVELOPMENT.md:46 | tests | 1277 | 1314 |
| A3 | DEVELOPMENT.md:57 | tests | 1277 | 1314 |
| A4 | DEVELOPMENT.md:249 | tests (release) | 1180 | 1314 |
| A5 | CONTRIBUTING.md:65 | commands | 37 | 38 |

### Category B: Missing Entries

| # | File | Missing |
|---|------|---------|
| B1 | DEVELOPMENT.md | focus-auto not mentioned |

### Category C: Incorrect References

| # | File | Issue | Fix |
|---|------|-------|-----|
| C1 | FAQ.md:13 | Copilot CLI prefix `/pan:*` | `/pan-*` |
| C2 | FAQ.md:13 | Copilot CLI config `~/.github/` | `~/.copilot/` |
| C3 | FAQ.md:67-77 | Missing --gemini and --copilot uninstall | Add entries |
| C4 | HOOKS.md:153-160 | Copilot CLI missing from hook support table | Add row |
| C5 | EXAMPLES.md:483-486 | Old command names in Quick Reference | Update 4 names |
| C7 | FAQ.md:106 | `verify-work` (old name) | `verify-phase` |
| C8 | TROUBLESHOOTING.md:839 | `your-org/pan-wizard` placeholder | `oharms/PanWizard` |
| C9 | EXAMPLES.md:51 | discuss-phase output → "state.md" | "context.md" |
| C10 | EXAMPLES.md:73 | Wrong plan path format | Correct to phases/XX-name/ format |

### Category D: Structural Issues

| # | File | Issue |
|---|------|-------|
| D1 | DEVELOPMENT.md:104 | Test example uses `it()` not `test()` |
| D2 | COMPARISON.md:4 | "Last verified: February 2026" |
| D3 | INTERNALS.md:206-214 | Model profile table inconsistent with AGENTS.md |

## Implementation Tasks

### Task 1: Fix all known doc gaps (P0 + P1)
- Files: FAQ.md, EXAMPLES.md, TROUBLESHOOTING.md, DEVELOPMENT.md, CONTRIBUTING.md, HOOKS.md, INTERNALS.md, COMPARISON.md
- Effort: S | Priority: P0

### Task 2: Add COMMAND_RENAME_MAP to constants.cjs
- Files: pan-wizard-core/bin/lib/constants.cjs
- Effort: XS | Priority: P1

### Task 3: Enhance checkDocStaleness() in focus.cjs
- Files: pan-wizard-core/bin/lib/focus.cjs
- Effort: S-M | Priority: P1
- Depends on: Task 2

### Task 4: Add tests for enhanced sync
- Files: tests/focus.test.cjs
- Effort: S | Priority: P1
- Depends on: Task 3

### Task 5: Update focus-sync.md command file
- Files: .claude/commands/pan/focus-sync.md, commands/pan/focus-sync.md
- Effort: XS | Priority: P2
- Depends on: Task 3

## Test Plan

### Unit tests (8+)
- checkOldNames: finds old names, ignores partial matches, handles multiple
- checkCommandTableCompleteness: detects missing, handles full table
- checkVersionConsistency: match, mismatch, missing files
- Multi-file checkCount: stale in DEVELOPMENT, current in README

### Integration tests (5+)
- cmdFocusSync returns old_names field
- cmdFocusSync returns missing_commands field
- cmdFocusSync returns version_match field
- Full output shape validation
- Backward compatibility (existing stale/current fields unchanged)

### E2E tests (2+)
- Run focus sync on PAN Wizard's own codebase
- Verify all check categories present in output
