# pan-tools.cjs CLI Reference

Complete reference for `pan-tools.cjs`, the central CLI dispatcher behind PAN Wizard workflows. The dispatcher routes top-level commands and nested subcommands to core modules. Every shipped command and agent ultimately invokes pan-tools for state management, verification, scaffolding, context gathering, prompt-cache priming, cross-phase memory, Opus 4.7 capability routing, the Spec B v2 feature set (cost dashboard, bus infrastructure, foresight previews, deep-review merge, knowledge retrieval, counterfactual worktree, MCP bridge), the optimization additions (circular optimization loop, `/pan:git` family, `distill` AI code-bloat optimizer), and the self-improvement loop (`experiment`, `runner`) plus vendored markdown linter (`doc-lint`).

```
node pan-tools.cjs <command> [args] [--raw] [--verbose] [--cwd <path>]
```

---

## Table of Contents

- [Global Behavior](#global-behavior)
- [Command Index](#command-index)
- [1. State Commands](#1-state-commands)
- [2. State Progression](#2-state-progression)
- [3. Phase Operations](#3-phase-operations)
- [4. Phase Listing](#4-phase-listing)
- [5. Roadmap Operations](#5-roadmap-operations)
- [6. Requirements Operations](#6-requirements-operations)
- [7. Milestone Operations](#7-milestone-operations)
- [8. Validation](#8-validation)
- [9. Verification Suite](#9-verification-suite)
- [10. Progress & Context](#10-progress--context)
- [11. Todos](#11-todos)
- [12. Scaffolding](#12-scaffolding)
- [13. Frontmatter CRUD](#13-frontmatter-crud)
- [14. Template Operations](#14-template-operations)
- [15. Config Operations](#15-config-operations)
- [16. Utility Commands](#16-utility-commands)
- [17. Compound Init Commands](#17-compound-init-commands)
- [18. Focus Commands](#18-focus-commands)
- [19. Standards Commands](#19-standards-commands)
- [20. Operations Commands](#20-operations-commands)
- [20.1 Opus 4.7 Commands](#201-opus-47-commands-v2100)
- [21. Codebase Commands](#21-codebase-commands)
- [22. Spec B v2 Commands](#22-spec-b-v2-commands-v30-v34)
- [23. Self-Improvement Loop Commands](#23-self-improvement-loop-commands)
- [24. Doc-Lint Commands](#24-doc-lint-commands)

---

## Global Behavior

### Output Format

**All output is JSON** unless `--raw` is passed. When `--raw` is used, commands emit a single plain-text value suitable for shell variable capture (e.g., a directory path, a count, or `true`/`false`).

### Debug Logging

Pass `--verbose` to any command to enable debug trace output on stderr. Sets `PAN_VERBOSE=1`. Useful for diagnosing dispatch, path resolution, or unexpected behavior.

### Large Output (`@file:` Protocol)

When JSON output exceeds ~50 KB, the tool writes it to a temporary file and prints `@file:/tmp/pan-XXXXX.json` instead. Callers must detect the `@file:` prefix and read the file. This prevents context window pollution when AI agents consume the output.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | Error (message written to stderr via `error()`) |

### `--cwd <path>`

Override the working directory. Accepts `--cwd /path` or `--cwd=/path`. Useful when subagents run outside the project root.

### Error Shape

All errors return JSON: `{ "error": "<description>" }`. Error messages follow the pattern `"<thing> not found"` with actionable hints where appropriate.

### Module Architecture

The dispatcher (`pan-tools.cjs`) routes commands to the core modules:

| Module | Purpose |
|--------|---------|
| `state.cjs` | state.md read/write/parse |
| `commands.cjs` | Utility commands (slug, timestamp, commit, batch-commit, estimate-cost, rollback, progress, etc.) |
| `phase.cjs` | Phase directory and plan operations |
| `init.cjs` | Compound workflow context gathering |
| `verify.cjs` | Verification, validation, and retrospective (Opus 4.7: `retro --write-memory`); facade over the verify-* submodules |
| `verify-drift.cjs` | Convention-drift detection (`drift-check`); extracted from verify.cjs, re-exported through it |
| `verify-retro.cjs` | Milestone retrospective (`retro`); extracted from verify.cjs, re-exported through it |
| `verify-deploy.cjs` | Deployment validation (`validate deployment`); extracted from verify.cjs, re-exported through it |
| `verify-preflight.cjs` | Pre-execution gates (`preflight`, `deps validate`); extracted from verify.cjs, re-exported through it |
| `commands-learnings.cjs` | Error patterns, session history, learnings lifecycle; extracted from commands.cjs, re-exported through it |
| `phase-remove.cjs` | Phase removal + renumbering cascade (`phase remove`); extracted from phase.cjs, re-exported through it |
| `roadmap.cjs` | roadmap.md parsing and updates |
| `frontmatter.cjs` | YAML frontmatter CRUD |
| `config.cjs` | config.json management |
| `template.cjs` | Template selection and filling |
| `milestone.cjs` | Milestone archival and requirements |
| `context-budget.cjs` | Context window utilization (Opus 4.7: cache metrics surfaced in health output) |
| `focus.cjs` | Focus workflow scan/plan/sync/exec/auto/design + Opus 4.7: `focus classify-stages`, `focus reflection` |
| `codebase.cjs` | Codebase analysis: detect-languages, analyze-imports, best-practices + Opus 4.7: `codebase estimate-size` |
| `memory.cjs` | **(v2.10.0, E-4)** Cross-phase agent memory: `memory read`, `memory append`, `memory list`, `memory compact` |
| `core.cjs` (CLI surface) | **(v2.10.0, E-1)** Prompt cache: `cache prime [--summary]` (wraps `buildCachedContext`) |
| `cost.cjs` | **(v3.0, Y-6)** Cost dashboard: `cost report`, `cost append`, `cost clear`, plus `models check` rate-table staleness (v3.9). Log at `.planning/metrics/tokens.jsonl`. |
| `bus.cjs` | **(v3.0, Y-7)** Agent message channels: `bus publish`, `bus drain`, `bus list`. Channels at `.planning/bus/<channel>.jsonl`. |
| `preview.cjs` | **(v3.1, Y-1)** Foresight: `preview phase <N>`, `preview phases`, `preview milestone`. |
| `review-deep.cjs` | **(v3.2, Y-2)** Deep review merge: `review-deep merge`, `review-deep analyze`. |
| `knowledge.cjs` | **(v3.2, Y-3)** Grounded Q&A: `knowledge ask`, `knowledge discuss`, `knowledge playbook`. |
| `whatif.cjs` | **(v3.3, Y-4)** Counterfactual worktree: `whatif prepare`, `whatif report`, `whatif cleanup`. |
| `bridge.cjs` | **(v3.3, Y-5)** MCP discovery: `bridge list`, `bridge recommend`, `bridge cache`. |
| `optimize.cjs` | **(v3.5)** Circular optimization loop: `optimize trace init/end/current/list/log`, `optimize learn`, `optimize apply`, `optimize list`, `optimize stats`. Logs at `.planning/optimization/traces/<session>/trace.jsonl`. |
| `git.cjs` | **(v3.5)** Phase-aware git workflow: `git commit/branch/push/status/log/stash/diff/rollback/tag/sync`. Reuses `runCommitSafetyChecks` for commit hardening. |
| `distill.cjs` | **(v3.5)** AI code-bloat optimizer (5-pass pipeline): `distill scan/analyze/report`. Cross-session memory at `.planning/memory/distill-patterns.md`. |
| `doc-lint.cjs` | Markdown frontmatter + structure linter: `doc-lint <dir>`, `doc-lint schema-check`. |
| `experiment.cjs` | Self-improvement loop scaffolding: `experiment new/list/manifest/harvest/prune`. |
| `runner.cjs` | External agent runner: `experiment run/status/stop`. Spawns Claude/Codex/Gemini/OpenCode via `spawnSync`. |
| `learn-lint.cjs` | Learnings-store integrity linter: `learn lint`. Checks L-001..L-005 (duplicate IDs, dangling cross-refs, empty source_experiments, PAN-internal terms in universal-scope rules, revision marker without `superseded_by`). |
| `learn-index.cjs` | Learnings index + queries: `learn build-index` (writes `pan-wizard-core/learnings/index.json` with topic→agent-relevance map), `learn topics-for --agent <role>` (budget-aware topic selection per agent role). Replaces "skim universal/" with targeted load. |
| `squads.cjs` | **(v3.11, ADR-0032)** Bot-army squad registry: `squad list`, `squad show <name>`. Four role-scoped squads (architecture/build/quality/release) with model tier + least-privilege access contract. Registry only — drives `/pan:army` and `pan-conductor` campaign mode. |
| `worktree.cjs` | **(v3.11, ADR-0033)** Branch-per-agent isolation: `worktree list`, `worktree create <task>` (`--base`), `worktree remove <path>` (`--branch`, `--force`). `army/<task>` branches + isolated git worktrees so parallel builders never collide. |
| `campaign.cjs` | **(v3.12, ADR-0034)** Scheduled self-resuming campaigns: `campaign schedule` (arm: `--cadence`/`--daily-budget`/`--goal`/`--pause`/`--resume`/`--disable`), `campaign status`, `campaign due` (host-scheduler gate), `campaign record-run`. Descriptor at `.planning/orchestration/schedule.json`; PAN owns the due-check, the host fires `/pan:army --continue`. Merge gate unaffected. |
| `hud.cjs` | **(v3.12, ADR-0035)** Single-page HTML dashboard: `hud` (`--out`/`--open`/`--stdout`). Aggregates project + army state (mission, command stack, campaign, safety harness, worktrees, roadmap, telemetry, requirements/quality, activity) into one self-contained file (default `.planning/hud.html`). Read-only view — no new state; army panels self-hide on plain projects. |
| `skill-align.cjs` | **(v3.13, ADR-0038)** Skill-Aligned Decomposition pass: `skills index` (on-the-fly index of commands/templates/references/learnings), `skills align --draft-file <p>` (score draft planner tasks against the skill surface, return budget-bounded vocabulary hints). Advisory, fail-open; used by `pan-planner` before grouping tasks into plans. |
| `hygiene.cjs` | **(v3.13)** Project cleanup + version alignment: `hygiene scan` (version drift per runtime manifest, legacy uppercase filenames, .tmp orphans, memory bloat, poisoned ledgers, stale traces, fragment planning dirs), `hygiene clean [--apply]` (dry-run by default; safe fixes only — renames, compaction, quarantine-by-rename, trace pruning; installer re-runs and fragment removal stay manual). |

---

## Command Index

Quick reference of all CLI commands grouped by category.

| # | Command | Category | Module |
|---|---------|----------|--------|
| 1 | `state load` | State | state.cjs |
| 2 | `state json` | State | state.cjs |
| 3 | `state update` | State | state.cjs |
| 4 | `state get` | State | state.cjs |
| 5 | `state patch` | State | state.cjs |
| 6 | `state-snapshot` | State | state.cjs |
| 7 | `state advance-plan` | State Progression | state.cjs |
| 8 | `state record-metric` | State Progression | state.cjs |
| 9 | `state update-progress` | State Progression | state.cjs |
| 10 | `state add-decision` | State Progression | state.cjs |
| 11 | `state add-blocker` | State Progression | state.cjs |
| 12 | `state resolve-blocker` | State Progression | state.cjs |
| 13 | `state record-session` | State Progression | state.cjs |
| 14 | `phase next-decimal` | Phase Ops | phase.cjs |
| 15 | `phase add` | Phase Ops | phase.cjs |
| 16 | `phase insert` | Phase Ops | phase.cjs |
| 17 | `phase remove` | Phase Ops | phase.cjs |
| 18 | `phase complete` | Phase Ops | phase.cjs |
| 19 | `phases list` | Phase Listing | phase.cjs |
| 20 | `phase-plan-index` | Phase Listing | phase.cjs |
| 21 | `find-phase` | Phase Listing | phase.cjs |
| 22 | `roadmap get-phase` | Roadmap | roadmap.cjs |
| 23 | `roadmap analyze` | Roadmap | roadmap.cjs |
| 24 | `roadmap update-plan-progress` | Roadmap | roadmap.cjs |
| 25 | `requirements mark-complete` | Requirements | milestone.cjs |
| 26 | `milestone complete` | Milestone | milestone.cjs |
| 27 | `validate consistency` | Validation | verify.cjs |
| 28 | `validate health` | Validation | verify.cjs |
| 29 | `validate deployment` | Validation | verify.cjs |
| 30 | `verify-summary` | Verification | verify.cjs |
| 31 | `verify plan-structure` | Verification | verify.cjs |
| 32 | `verify phase-completeness` | Verification | verify.cjs |
| 33 | `verify references` | Verification | verify.cjs |
| 34 | `verify commits` | Verification | verify.cjs |
| 35 | `verify artifacts` | Verification | verify.cjs |
| 36 | `verify key-links` | Verification | verify.cjs |
| 37 | `progress` | Progress | commands.cjs |
| 38 | `context-budget` | Progress | context-budget.cjs |
| 39 | `todo complete` | Todos | commands.cjs |
| 40 | `list-todos` | Todos | commands.cjs |
| 41 | `scaffold context` | Scaffolding | commands.cjs |
| 42 | `scaffold uat` | Scaffolding | commands.cjs |
| 43 | `scaffold verification` | Scaffolding | commands.cjs |
| 44 | `scaffold phase-dir` | Scaffolding | commands.cjs |
| 45 | `frontmatter get` | Frontmatter | frontmatter.cjs |
| 46 | `frontmatter set` | Frontmatter | frontmatter.cjs |
| 47 | `frontmatter merge` | Frontmatter | frontmatter.cjs |
| 48 | `frontmatter validate` | Frontmatter | frontmatter.cjs |
| 49 | `template select` | Template | template.cjs |
| 50 | `template fill summary` | Template | template.cjs |
| 51 | `template fill plan` | Template | template.cjs |
| 52 | `template fill verification` | Template | template.cjs |
| 53 | `config-ensure-section` | Config | config.cjs |
| 54 | `config-get` | Config | config.cjs |
| 55 | `config-set` | Config | config.cjs |
| 56 | `resolve-model` | Utility | commands.cjs |
| 57 | `commit` | Utility | commands.cjs |
| 58 | `generate-slug` | Utility | commands.cjs |
| 59 | `current-timestamp` | Utility | commands.cjs |
| 60 | `verify-path-exists` | Utility | commands.cjs |
| 61 | `history-digest` | Utility | commands.cjs |
| 62 | `summary-extract` | Utility | commands.cjs |
| 63 | `websearch` | Utility | commands.cjs |
| 64 | `rollback-snapshot` | Utility | commands.cjs |
| 65 | `batch-commit` | Utility | commands.cjs |
| 66 | `estimate-cost` | Utility | commands.cjs |
| 67 | `init execute-phase` | Init | init.cjs |
| 68 | `init plan-phase` | Init | init.cjs |
| 69 | `init new-project` | Init | init.cjs |
| 70 | `init new-milestone` | Init | init.cjs |
| 71 | `init quick` | Init | init.cjs |
| 72 | `init resume` | Init | init.cjs |
| 73 | `init verify-work` | Init | init.cjs |
| 74 | `init phase-op` | Init | init.cjs |
| 75 | `init todos` | Init | init.cjs |
| 76 | `init milestone-op` | Init | init.cjs |
| 77 | `init map-codebase` | Init | init.cjs |
| 78 | `init progress` | Init | init.cjs |
| 79 | `focus scan` | Focus | focus.cjs |
| 80 | `focus plan` | Focus | focus.cjs |
| 81 | `focus sync` | Focus | focus.cjs |
| 82 | `focus exec` | Focus | focus.cjs |
| 83 | `focus auto` | Focus | focus.cjs |
| 84 | `focus design` | Focus | focus.cjs |
| 85 | `standards list` | Standards | config.cjs |
| 86 | `standards select` | Standards | config.cjs |
| 87 | `standards remove` | Standards | config.cjs |
| 88 | `standards status` | Standards | config.cjs |
| 89 | `standards recommend` | Standards | config.cjs |
| 90 | `standards phase-track` | Standards | config.cjs |
| 91 | `standards tools` | Standards | config.cjs |
| 92 | `preflight` | Operations | verify.cjs |
| 93 | `dashboard` | Operations | state.cjs |
| 94 | `learnings extract` | Operations | commands.cjs |
| 95 | `learnings list` | Operations | commands.cjs |
| 96 | `learnings prune` | Operations | commands.cjs |
| 97 | `deps validate` | Operations | verify.cjs |
| 98 | `drift-check` | Operations | verify.cjs |
| 99 | `retro` | Operations | verify.cjs |
| 100 | `codebase detect-languages` | Codebase | codebase.cjs |
| 101 | `codebase analyze-imports` | Codebase | codebase.cjs |
| 102 | `codebase best-practices` | Codebase | codebase.cjs |
| 103 | `codebase estimate-size` | Opus 4.7 (E-2) | codebase.cjs |
| 104 | `memory read` | Opus 4.7 (E-4) | memory.cjs |
| 105 | `memory append` | Opus 4.7 (E-4) | memory.cjs |
| 106 | `memory list` | Opus 4.7 (E-4) | memory.cjs |
| 107 | `memory compact` | Opus 4.7 (E-4) | memory.cjs |
| 108 | `cache prime` | Opus 4.7 (E-1) | core.cjs |
| 109 | `focus classify-stages` | Opus 4.7 (E-6) | focus.cjs |
| 110 | `focus reflection` | Opus 4.7 (E-10) | focus.cjs |
| 111 | `cost report` | Spec B v2 Y-6 (v3.0) | cost.cjs |
| 112 | `cost append` | Spec B v2 Y-6 (v3.0) | cost.cjs |
| 113 | `cost clear` | Spec B v2 Y-6 (v3.0) | cost.cjs |
| 114 | `bus publish` | Spec B v2 Y-7 (v3.0) | bus.cjs |
| 115 | `bus drain` | Spec B v2 Y-7 (v3.0) | bus.cjs |
| 116 | `bus list` | Spec B v2 Y-7 (v3.0) | bus.cjs |
| 117 | `preview phase` | Spec B v2 Y-1 (v3.1) | preview.cjs |
| 118 | `preview phases` | Spec B v2 Y-1 (v3.1) | preview.cjs |
| 119 | `preview milestone` | Spec B v2 Y-1 (v3.1) | preview.cjs |
| 120 | `review-deep merge` | Spec B v2 Y-2 (v3.2) | review-deep.cjs |
| 121 | `review-deep analyze` | Spec B v2 Y-2 (v3.2) | review-deep.cjs |
| 122 | `knowledge ask` | Spec B v2 Y-3 (v3.2) | knowledge.cjs |
| 123 | `knowledge discuss` | Spec B v2 Y-3 (v3.2) | knowledge.cjs |
| 124 | `knowledge playbook` | Spec B v2 Y-3 (v3.2) | knowledge.cjs |
| 125 | `whatif prepare` | Spec B v2 Y-4 (v3.3) | whatif.cjs |
| 126 | `whatif report` | Spec B v2 Y-4 (v3.3) | whatif.cjs |
| 127 | `whatif cleanup` | Spec B v2 Y-4 (v3.3) | whatif.cjs |
| 128 | `bridge list` | Spec B v2 Y-5 (v3.3) | bridge.cjs |
| 129 | `bridge recommend` | Spec B v2 Y-5 (v3.3) | bridge.cjs |
| 130 | `bridge cache` | Spec B v2 Y-5 (v3.3) | bridge.cjs |
| 131 | `optimize trace init` | Optimization (v3.5) | optimize.cjs |
| 132 | `optimize trace end` | Optimization (v3.5) | optimize.cjs |
| 133 | `optimize trace current` | Optimization (v3.5) | optimize.cjs |
| 134 | `optimize trace list` | Optimization (v3.5) | optimize.cjs |
| 135 | `optimize trace log` | Optimization (v3.5) | optimize.cjs |
| 136 | `optimize learn` | Optimization (v3.5) | optimize.cjs |
| 137 | `optimize apply` | Optimization (v3.5) | optimize.cjs |
| 138 | `optimize list` | Optimization (v3.5) | optimize.cjs |
| 139 | `optimize stats` | Optimization (v3.5) | optimize.cjs |
| 140 | `learn` (alias) | Optimization (v3.5) | optimize.cjs |
| 141 | `git commit` | Git (v3.5) | git.cjs |
| 142 | `git branch` | Git (v3.5) | git.cjs |
| 143 | `git push` | Git (v3.5) | git.cjs |
| 144 | `git status` | Git (v3.5) | git.cjs |
| 145 | `git log` | Git (v3.5) | git.cjs |
| 146 | `git stash` | Git (v3.5) | git.cjs |
| 147 | `git diff` | Git (v3.5) | git.cjs |
| 148 | `git rollback` | Git (v3.5) | git.cjs |
| 149 | `git tag` | Git (v3.5) | git.cjs |
| 150 | `git sync` | Git (v3.5) | git.cjs |
| 151 | `distill scan` | Distill (v3.5) | distill.cjs |
| 152 | `distill analyze` | Distill (v3.5) | distill.cjs |
| 153 | `distill report` | Distill (v3.5) | distill.cjs |
| 154 | `experiment new` | Self-Improvement Loop (v3.7.0) | experiment.cjs |
| 155 | `experiment list` | Self-Improvement Loop (v3.7.0) | experiment.cjs |
| 156 | `experiment manifest` | Self-Improvement Loop (v3.7.0) | experiment.cjs |
| 157 | `experiment run` | Self-Improvement Loop (v3.7.0) | runner.cjs |
| 158 | `experiment status` | Self-Improvement Loop (v3.7.0) | runner.cjs |
| 159 | `experiment stop` | Self-Improvement Loop (v3.7.0) | runner.cjs |
| 160 | `experiment harvest` | Self-Improvement Loop (v3.7.0) | experiment.cjs |
| 161 | `experiment prune` | Self-Improvement Loop (v3.7.0) | experiment.cjs |
| 162 | `doc-lint <dir>` | Doc-Lint (v3.7.1) | doc-lint.cjs |
| 163 | `doc-lint schema-check` | Doc-Lint (v3.7.1) | doc-lint.cjs |
| 164 | `learn promote` | Learnings | optimize.cjs |
| 165 | `learn unpromote` | Learnings | optimize.cjs |
| 166 | `learn list-promoted` | Learnings | optimize.cjs |
| 167 | `learn lint` | Learnings | learn-lint.cjs |
| 168 | `learn build-index` | Learnings | learn-index.cjs |
| 169 | `learn topics-for` | Learnings | learn-index.cjs |
| 170 | `links validate` | Doc-Code Link Graph (v3.8.0) | links.cjs |
| 171 | `squad list` | Bot Army | squads.cjs |
| 172 | `squad show` | Bot Army | squads.cjs |
| 173 | `worktree list` | Bot Army | worktree.cjs |
| 174 | `worktree create` | Bot Army | worktree.cjs |
| 175 | `worktree remove` | Bot Army | worktree.cjs |
| 176 | `campaign schedule` | Bot Army | campaign.cjs |
| 177 | `campaign status` | Bot Army | campaign.cjs |
| 178 | `campaign due` | Bot Army | campaign.cjs |
| 179 | `campaign record-run` | Bot Army | campaign.cjs |
| 180 | `hud` | Observability | hud.cjs |
| 181 | `models check` | Cost | cost.cjs |
| 182 | `skills index` | Planning (SAD) | skill-align.cjs |
| 183 | `skills align` | Planning (SAD) | skill-align.cjs |
| 184 | `hygiene scan` | System | hygiene.cjs |
| 185 | `hygiene clean` | System | hygiene.cjs |

---

## 1. State Commands

Commands for reading and writing state.md — the central project state file.

### `state load`

Load project config and planning state. This is the most commonly called command — nearly every workflow starts here.

```
pan-tools state load [--raw]
```

**JSON output:**
```json
{
  "config": { "model_profile": "balanced", "commit_docs": true, ... },
  "state_raw": "<full state.md content>",
  "state_exists": true,
  "roadmap_exists": true,
  "config_exists": true
}
```

**`--raw` output:** Key=value lines: `model_profile=balanced`, `commit_docs=true`, etc.

**Error:** `{ "error": "state.md not found" }` if `.planning/state.md` doesn't exist.

**Implementation:** `state.cjs → cmdStateLoad()` — Uses `readStateSafe()` for race-condition-safe file access.

---

### `state json`

Output state.md frontmatter as JSON. Returns the YAML frontmatter block parsed into a JSON object. If no frontmatter exists, it is built from the markdown body.

```
pan-tools state json [--raw]
```

**JSON output:**
```json
{
  "pan_state_version": "1.0",
  "milestone": "v1.0",
  "current_phase": "05",
  "current_plan": "2",
  "status": "executing",
  "last_updated": "2026-02-27T12:00:00.000Z",
  "progress": {
    "total_phases": 12,
    "completed_phases": 4,
    "total_plans": 30,
    "completed_plans": 18,
    "percent": 60
  }
}
```

**Implementation:** `state.cjs → cmdStateJson()` — Parses YAML frontmatter first, falls back to markdown body parsing.

---

### `state update <field> <value>`

Update a single `**Field:** value` line in state.md.

```
pan-tools state update "Current Phase" "06"
```

**JSON output:**
```json
{ "updated": true }
```

If the field is not found:
```json
{ "updated": false, "reason": "Field \"Current Phase\" not found in state.md" }
```

**Note:** Field names are case-sensitive and match the bold markdown format (e.g., `"Current Phase"`, `"Status"`).

---

### `state get [section]`

Get full state.md content, or a specific field/section.

```
pan-tools state get                    # Full content
pan-tools state get "Status"           # Extract **Status:** value
pan-tools state get "Session"          # Extract ## Session section
```

**JSON output (full):**
```json
{ "content": "<full state.md content>" }
```

**JSON output (field):**
```json
{ "Status": "Executing plan 3 of 5" }
```

**`--raw` output:** The matched value or section text.

---

### `state patch --field val ...`

Batch update multiple `**Field:** value` lines in a single operation.

```
pan-tools state patch --Status "Ready to execute" --"Current Plan" "3"
```

**JSON output:**
```json
{ "updated": ["Status", "Current Plan"], "failed": [] }
```

**Note:** Flag names are converted to field names by stripping the leading `--`. Use quotes for multi-word field names.

---

### `state-snapshot`

Structured parse of state.md into a comprehensive JSON object. Unlike `state json` (which returns frontmatter), this parses the full markdown body including decisions, blockers, and session info.

```
pan-tools state-snapshot [--raw]
```

**JSON output:**
```json
{
  "current_phase": "05",
  "current_phase_name": "Setup",
  "total_phases": 12,
  "current_plan": "2",
  "total_plans_in_phase": 4,
  "status": "Executing",
  "progress_percent": 60,
  "last_activity": "2026-02-27",
  "last_activity_desc": "Completed plan 1 of phase 5",
  "decisions": [{ "phase": "04", "summary": "...", "rationale": "..." }],
  "blockers": ["Waiting on API key"],
  "paused_at": null,
  "session": {
    "last_date": "2026-02-27T12:00:00.000Z",
    "stopped_at": "Finished task 3",
    "resume_file": "None"
  }
}
```

**Difference from `state json`:** `state json` returns YAML frontmatter fields. `state-snapshot` parses the full markdown body into a structured object with decisions, blockers, and session data extracted from markdown sections.

---

## 2. State Progression

Commands for advancing workflow state — plan counters, metrics, decisions, blockers, and session continuity.

### `state advance-plan`

Increment the current plan counter. If the last plan is reached, set status to "ready for verification".

```
pan-tools state advance-plan [--raw]
```

**JSON output (advanced):**
```json
{ "advanced": true, "previous_plan": 2, "current_plan": 3, "total_plans": 5 }
```

**JSON output (last plan):**
```json
{ "advanced": false, "reason": "last_plan", "current_plan": 5, "total_plans": 5, "status": "ready_for_verification" }
```

**`--raw` output:** `true` or `false`.

---

### `state record-metric --phase N --plan M --duration Xmin [--tasks N] [--files N]`

Record execution metrics in the Performance Metrics table in state.md.

```
pan-tools state record-metric --phase 5 --plan 1 --duration 12min --tasks 4 --files 6
```

**Flags (all required unless noted):**
- `--phase N` — Phase number
- `--plan M` — Plan number
- `--duration Xmin` — Duration string (e.g., `12min`, `2h`)
- `--tasks N` — Task count (optional)
- `--files N` — Files modified count (optional)

**JSON output:**
```json
{ "recorded": true, "phase": "5", "plan": "1", "duration": "12min" }
```

---

### `state update-progress`

Recalculate and update the progress bar in state.md based on SUMMARY/PLAN counts across all phases.

```
pan-tools state update-progress [--raw]
```

**JSON output:**
```json
{
  "updated": true,
  "percent": 60,
  "completed": 18,
  "total": 30,
  "bar": "[██████░░░░] 60%"
}
```

**`--raw` output:** The progress bar string.

---

### `state add-decision --summary "..." [--phase N] [--rationale "..."] [--summary-file path] [--rationale-file path]`

Add a decision entry to the Decisions section in state.md.

```
pan-tools state add-decision --summary "Use PostgreSQL" --phase 5 --rationale "Better JSON support"
pan-tools state add-decision --summary-file /tmp/decision.txt --phase 5
```

**Flags:**
- `--summary "..."` — Decision summary text (or use `--summary-file`)
- `--phase N` — Phase number (optional)
- `--rationale "..."` — Rationale text (or use `--rationale-file`)
- `--summary-file path` — Read summary from file (avoids shell escaping issues with `$` signs)
- `--rationale-file path` — Read rationale from file

**JSON output:**
```json
{ "added": true, "decision": "- [Phase 5]: Use PostgreSQL — Better JSON support" }
```

**Note:** Use `--summary-file` and `--rationale-file` for text containing shell-sensitive characters like `$`.

---

### `state add-blocker --text "..." [--text-file path]`

Add a blocker to the Blockers section in state.md.

```
pan-tools state add-blocker --text "Waiting on API credentials"
pan-tools state add-blocker --text-file /tmp/blocker.txt
```

**JSON output:**
```json
{ "added": true, "blocker": "Waiting on API credentials" }
```

---

### `state resolve-blocker --text "..."`

Remove a blocker from the Blockers section by matching text (case-insensitive substring match).

```
pan-tools state resolve-blocker --text "API credentials"
```

**JSON output:**
```json
{ "resolved": true, "blocker": "API credentials" }
```

If no match: `{ "resolved": false, "reason": "No blocker matching \"API credentials\" found" }`.

---

### `state record-session --stopped-at "..." [--resume-file path]`

Update session continuity fields in state.md (Last session, Stopped At, Resume File).

```
pan-tools state record-session --stopped-at "Finished plan 3, starting plan 4"
pan-tools state record-session --stopped-at "Mid-task" --resume-file .planning/phases/05-setup/05-02-plan.md
```

**Flags:**
- `--stopped-at "..."` — Description of where work stopped
- `--resume-file path` — File to resume from (default: `None`)

**JSON output:**
```json
{ "recorded": true, "updated": ["Last session", "Stopped At", "Resume File"] }
```

---

## 3. Phase Operations

Commands for managing phase lifecycle — adding, inserting, removing, and completing phases.

### `phase next-decimal <phase>`

Calculate the next available decimal phase number for inserting a sub-phase.

```
pan-tools phase next-decimal 5 [--raw]
```

**JSON output:**
```json
{
  "found": true,
  "base_phase": "05",
  "next": "05.1",
  "existing": []
}
```

If decimals exist: `{ ..., "next": "05.3", "existing": ["05.1", "05.2"] }`.

**`--raw` output:** The next decimal (e.g., `05.1`).

---

### `phase add <description>`

Append a new phase to roadmap.md and create the corresponding directory on disk.

```
pan-tools phase add "API Integration Layer" [--raw]
```

**JSON output:**
```json
{
  "phase_number": 13,
  "padded": "13",
  "name": "API Integration Layer",
  "slug": "api-integration-layer",
  "directory": ".planning/phases/13-api-integration-layer"
}
```

**`--raw` output:** The padded phase number.

**Side effects:** Creates `.planning/phases/NN-slug/` directory and appends a new section to roadmap.md.

---

### `phase insert <after> <description>`

Insert a decimal phase after an existing phase. Creates the directory and updates roadmap.md.

```
pan-tools phase insert 5 "Emergency Hotfix" [--raw]
```

**JSON output:**
```json
{
  "phase_number": "05.1",
  "after_phase": "5",
  "name": "Emergency Hotfix",
  "slug": "emergency-hotfix",
  "directory": ".planning/phases/05.1-emergency-hotfix"
}
```

**`--raw` output:** The decimal phase number (e.g., `05.1`).

---

### `phase remove <phase> [--force]`

Remove a phase, delete its directory, and renumber all subsequent phases. Also updates roadmap.md and state.md.

```
pan-tools phase remove 7 [--raw]
pan-tools phase remove 5.2 --force    # Force removal even if summaries exist
```

**Arguments:**
- `<phase>` — Phase number to remove
- `--force` — Allow removal of phases with executed plans (summary.md files)

**JSON output:**
```json
{
  "removed": "7",
  "directory_deleted": "07-feature-name",
  "renamed_directories": [
    { "from": "08-next-feature", "to": "07-next-feature" }
  ],
  "renamed_files": [
    { "from": "08-01-plan.md", "to": "07-01-plan.md" }
  ],
  "roadmap_updated": true,
  "state_updated": true
}
```

**Warning:** Without `--force`, removal is blocked if the phase has any summary.md files (indicating completed work).

---

### `phase complete <phase>`

Mark a phase as done. Updates roadmap.md checkboxes and progress table, advances state.md to the next phase, and updates requirements.md traceability.

```
pan-tools phase complete 5 [--raw]
```

**JSON output:**
```json
{
  "completed_phase": "5",
  "phase_name": "setup",
  "plans_executed": "3/3",
  "next_phase": "06",
  "next_phase_name": "api-layer",
  "is_last_phase": false,
  "date": "2026-02-27",
  "roadmap_updated": true,
  "state_updated": true
}
```

**Side effects:** Checks off the phase checkbox in roadmap.md, updates the progress table row, advances `Current Phase` in state.md, and marks completed requirements in requirements.md.

---

## 4. Phase Listing

Commands for discovering phase directories and their contents.

### `phases list [--type plan|summary] [--phase N] [--include-archived]`

List phase directories or files within phases.

```
pan-tools phases list [--raw]
pan-tools phases list --type plan --phase 5 [--raw]
pan-tools phases list --include-archived [--raw]
```

**Flags:**
- `--type plan|summary` — List files of a specific type instead of directories
- `--phase N` — Filter to a specific phase
- `--include-archived` — Include phases from archived milestones

**JSON output (directories):**
```json
{ "directories": ["05-setup", "06-api-layer", "07-auth"], "count": 3 }
```

**JSON output (files):**
```json
{ "files": ["05-01-plan.md", "05-02-plan.md"], "count": 2, "phase_dir": "setup" }
```

**`--raw` output:** Newline-separated list.

---

### `phase-plan-index <phase>`

Index all plans within a phase, grouped by wave, with completion status. Used by the execute-phase workflow to determine which plans to run and in what order.

```
pan-tools phase-plan-index 5 [--raw]
```

**JSON output:**
```json
{
  "phase": "05",
  "plans": [
    {
      "id": "05-01",
      "wave": 1,
      "autonomous": true,
      "objective": "Set up database schema",
      "files_modified": ["src/db/schema.ts"],
      "task_count": 3,
      "has_summary": true
    }
  ],
  "waves": { "1": ["05-01", "05-02"], "2": ["05-03"] },
  "incomplete": ["05-03"],
  "has_checkpoints": false
}
```

**Note:** Plans within the same wave can execute in parallel (via parallel agents). Plans in wave 2 depend on wave 1 completion.

---

### `find-phase <phase>`

Find a phase directory by number. Searches current phases, then archived milestone phases.

```
pan-tools find-phase 5 [--raw]
pan-tools find-phase 12A.1 [--raw]
```

**JSON output:**
```json
{
  "found": true,
  "directory": ".planning/phases/05-setup",
  "phase_number": "05",
  "phase_name": "setup",
  "plans": ["05-01-plan.md", "05-02-plan.md"],
  "summaries": ["05-01-summary.md"]
}
```

**`--raw` output:** The directory path (e.g., `.planning/phases/05-setup`) or empty string if not found.

---

## 5. Roadmap Operations

Commands for reading and updating roadmap.md — the project phase plan.

### `roadmap get-phase <phase>`

Extract a phase section from roadmap.md.

```
pan-tools roadmap get-phase 5 [--raw]
```

**JSON output:**
```json
{
  "found": true,
  "phase_number": "5",
  "phase_name": "Database Setup",
  "goal": "Establish schema and migrations",
  "success_criteria": ["All tables created", "Seed data loaded"],
  "section": "### Phase 5: Database Setup\n\n**Goal:** ..."
}
```

**`--raw` output:** The full markdown section text.

---

### `roadmap analyze`

Full roadmap parse with on-disk status for every phase. This is the most comprehensive view of project progress.

```
pan-tools roadmap analyze [--raw]
```

**JSON output:**
```json
{
  "milestones": [{ "heading": "v1.0 Core Platform", "version": "v1.0" }],
  "phases": [
    {
      "number": "5",
      "name": "Database Setup",
      "goal": "Establish schema",
      "depends_on": "Phase 4",
      "plan_count": 3,
      "summary_count": 3,
      "has_context": true,
      "has_research": false,
      "disk_status": "complete",
      "roadmap_complete": true
    }
  ],
  "phase_count": 12,
  "completed_phases": 4,
  "total_plans": 30,
  "total_summaries": 18,
  "progress_percent": 60,
  "current_phase": "5",
  "next_phase": "6",
  "missing_phase_details": null
}
```

**Disk status values:** `no_directory`, `empty`, `discussed`, `researched`, `planned`, `partial`, `complete`.

---

### `roadmap update-plan-progress <phase>`

Update the progress table row in roadmap.md for a specific phase, based on actual PLAN/SUMMARY counts on disk.

```
pan-tools roadmap update-plan-progress 5 [--raw]
```

**JSON output:**
```json
{
  "updated": true,
  "phase": "5",
  "plan_count": 3,
  "summary_count": 3,
  "status": "Complete",
  "complete": true
}
```

**`--raw` output:** `3/3 Complete`.

---

## 6. Requirements Operations

### `requirements mark-complete <ids>`

Mark requirement IDs as complete in requirements.md (updates checkboxes and traceability table).

```
pan-tools requirements mark-complete REQ-01,REQ-02
pan-tools requirements mark-complete REQ-01 REQ-02
pan-tools requirements mark-complete "[REQ-01, REQ-02]"
```

**Accepts:** Comma-separated, space-separated, or bracket-wrapped formats.

**JSON output:**
```json
{
  "updated": true,
  "marked_complete": ["REQ-01", "REQ-02"],
  "not_found": [],
  "total": 2
}
```

**`--raw` output:** `2/2 requirements marked complete`.

---

## 7. Milestone Operations

### `milestone complete <version> [--name <name>] [--archive-phases]`

Archive a milestone: gathers stats, archives roadmap.md and requirements.md, creates/appends milestones.md, and updates state.md for the next milestone.

```
pan-tools milestone complete v1.0 --name "Core Platform" --archive-phases
```

**Arguments:**
- `<version>` — Milestone version (e.g., `v1.0`)
- `--name <name>` — Human-readable milestone name (multi-word supported)
- `--archive-phases` — Move phase directories to `milestones/vX.Y-phases/`

**JSON output:**
```json
{
  "version": "v1.0",
  "name": "Core Platform",
  "date": "2026-02-27",
  "phases": 12,
  "plans": 30,
  "tasks": 85,
  "accomplishments": ["Built auth module", "Created API layer"],
  "archived": {
    "roadmap": true,
    "requirements": true,
    "audit": false,
    "phases": true
  },
  "milestones_updated": true,
  "state_updated": true
}
```

**Side effects:** Creates `milestones/` directory, archives roadmap.md and requirements.md with version prefix, optionally moves phase dirs, resets state.md for next milestone.

---

## 8. Validation

Commands for checking project health and consistency.

### `validate consistency`

Check phase numbering, disk/roadmap synchronization, plan numbering gaps, and orphaned summaries.

```
pan-tools validate consistency [--raw]
```

**JSON output:**
```json
{
  "passed": true,
  "errors": [],
  "warnings": [
    "Gap in phase numbering: 5 -> 7",
    "Phase 3 in roadmap.md but no directory on disk"
  ],
  "warning_count": 2
}
```

**`--raw` output:** `passed` or `failed`.

---

### `validate health [--repair] [--standards] [--full] [--drift] [--links]`

Comprehensive `.planning/` integrity check. Validates project.md, roadmap.md, state.md, config.json, phase directory naming, and orphaned plans. With `--standards`, also checks standards compliance. With `--drift`, runs convention drift analysis. With `--links`, attaches a doc-code link-graph summary (ADR-0027).

```
pan-tools validate health [--raw]
pan-tools validate health --repair
pan-tools validate health --standards
pan-tools validate health --full
pan-tools validate health --drift
pan-tools validate health --links
```

**Flags:**
- `--repair` — Attempt automatic repairs (create default config.json, regenerate state.md)
- `--standards` — Include standards compliance check (reads standards.md, reports per-standard coverage)
- `--full` — Run tests and build checks (slower, includes test_status and build_status)
- `--drift` — Run convention drift analysis (includes drift_status with score and violations)
- `--links` *(v3.8.0+)* — Attach `link_graph` summary (ADR-0027). Errors degrade health to a `LINKS_ERR` warning (advisory, non-blocking). Run `pan-tools links validate` standalone for the full finding list.

**JSON output:**
```json
{
  "status": "degraded",
  "errors": [
    { "code": "E004", "message": "state.md not found", "fix": "Run /pan:health --repair", "repairable": true }
  ],
  "warnings": [
    { "code": "W003", "message": "config.json not found", "fix": "Run /pan:health --repair", "repairable": true }
  ],
  "info": [
    { "code": "I001", "message": "05-setup/05-03-plan.md has no summary.md", "fix": "May be in progress", "repairable": false }
  ],
  "repairable_count": 2,
  "repairs_performed": [
    { "action": "createConfig", "success": true, "path": "config.json" }
  ]
}
```

**Status values:** `healthy`, `degraded`, `broken`.

**Error/warning codes:**

| Code | Severity | Description | Repairable |
|------|----------|-------------|------------|
| E001 | error | `.planning/` directory not found | No |
| E002 | error | `project.md` not found | No |
| E003 | error | `roadmap.md` not found | No |
| E004 | error | `state.md` not found | Yes |
| E005 | error | `config.json` JSON parse error | Yes |
| W001 | warning | `project.md` missing required section | No |
| W002 | warning | `state.md` references non-existent phase | No |
| W003 | warning | `config.json` not found | Yes |
| W004 | warning | `config.json` invalid `model_profile` value | No |
| W005 | warning | Phase directory naming doesn't match `NN-name` format | No |
| W006 | warning | Phase in ROADMAP but no directory on disk | No |
| W007 | warning | Phase on disk but not in ROADMAP | No |
| I001 | info | Plan without SUMMARY (may be in progress) | No |

### `validate deployment`

Validates PAN installations in the current directory. Detects all installed runtimes (by checking for `pan-file-manifest.json`), then for each runtime validates: manifest file hashes match on-disk files, settings integrity, and hook path resolution.

```
pan-tools validate deployment [--raw]
```

**JSON output:**
```json
{
  "status": "clean",
  "runtimes": [
    {
      "runtime": "claude",
      "status": "clean",
      "version": "2.9.0",
      "total_files": 142,
      "missing": [],
      "modified": [],
      "settings_ok": true,
      "settings_issues": []
    }
  ]
}
```

**Status values:** `clean` (all files match), `modified` (hash mismatch), `broken` (files missing).

---

## 9. Verification Suite

Commands for verifying plan structure, phase completeness, file references, git commits, and build artifacts. Used by the pan-verifier and pan-plan-checker agents.

### `verify-summary <path> [--check-count N]`

Verify a summary.md file: checks existence, spot-checks referenced files, validates commit hashes, and looks for self-check section status.

```
pan-tools verify-summary .planning/phases/05-setup/05-01-summary.md [--raw]
pan-tools verify-summary path/to/summary.md --check-count 5
```

**Arguments:**
- `<path>` — Relative path to the summary.md file
- `--check-count N` — Number of referenced files to spot-check (default: 2)

**JSON output:**
```json
{
  "passed": true,
  "checks": {
    "summary_exists": true,
    "files_created": { "checked": 2, "found": 2, "missing": [] },
    "commits_exist": true,
    "self_check": "passed"
  },
  "errors": []
}
```

**`--raw` output:** `passed` or `failed`.

---

### `verify plan-structure <file>`

Check a plan.md file for required frontmatter fields and valid `<task>` element structure.

```
pan-tools verify plan-structure .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["Task 'setup' missing <verify>"],
  "task_count": 3,
  "tasks": [
    { "name": "setup", "hasFiles": true, "hasAction": true, "hasVerify": false, "hasDone": true }
  ],
  "frontmatter_fields": ["phase", "plan", "type", "wave", "depends_on", "files_modified", "autonomous", "must_haves"]
}
```

**Required frontmatter:** `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous`, `must_haves`.

**`--raw` output:** `valid` or `invalid`.

---

### `verify phase-completeness <phase>`

Check that all plans in a phase have corresponding summaries.

```
pan-tools verify phase-completeness 5 [--raw]
```

**JSON output:**
```json
{
  "complete": true,
  "phase": "05",
  "plan_count": 3,
  "summary_count": 3,
  "incomplete_plans": [],
  "orphan_summaries": [],
  "errors": [],
  "warnings": []
}
```

**`--raw` output:** `complete` or `incomplete`.

---

### `verify references <file>`

Check that `@`-references and backtick file paths in a document resolve to existing files.

```
pan-tools verify references .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "valid": true,
  "found": 5,
  "missing": [],
  "total": 5
}
```

**`--raw` output:** `valid` or `invalid`.

---

### `verify commits <hash1> [hash2] ...`

Batch verify that commit hashes exist in the git history.

```
pan-tools verify commits abc1234 def5678 ghi9012 [--raw]
```

**JSON output:**
```json
{
  "all_valid": true,
  "valid": ["abc1234", "def5678", "ghi9012"],
  "invalid": [],
  "total": 3
}
```

**`--raw` output:** `valid` or `invalid`.

---

### `verify artifacts <plan-file>`

Check that `must_haves.artifacts` from a plan.md frontmatter exist on disk and meet specified criteria (min_lines, contains, exports).

```
pan-tools verify artifacts .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "all_passed": true,
  "passed": 2,
  "total": 2,
  "artifacts": [
    { "path": "src/db/schema.ts", "exists": true, "issues": [], "passed": true }
  ]
}
```

**`--raw` output:** `valid` or `invalid`.

---

### `verify key-links <plan-file>`

Check that `must_haves.key_links` from a plan.md frontmatter are satisfied (source references target, or pattern matches).

```
pan-tools verify key-links .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "all_verified": true,
  "verified": 2,
  "total": 2,
  "links": [
    { "from": "src/index.ts", "to": "src/db/schema.ts", "via": "import", "verified": true, "detail": "Pattern found in source" }
  ]
}
```

**`--raw` output:** `valid` or `invalid`.

---

## 10. Progress & Context

Commands for viewing project progress and estimating context window utilization.

### `progress [json|table|bar|health]`

Render milestone progress in various formats.

```
pan-tools progress              # JSON (default)
pan-tools progress json [--raw]
pan-tools progress table [--raw]
pan-tools progress bar [--raw]
pan-tools progress health [--raw]
```

**Subcommands:**

| Format | Description | Typical Use |
|--------|-------------|-------------|
| `json` | Structured data with per-phase breakdown | Machine consumption |
| `table` | Markdown table with progress bar header | Human review, status reports |
| `bar` | Single-line progress bar | Quick status check |
| `health` | Composite A-D health grade from 3 signals | Project health assessment |

**JSON output (json format):**
```json
{
  "milestone_version": "v1.0",
  "milestone_name": "Core Platform",
  "phases": [
    { "number": "05", "name": "setup", "plans": 3, "summaries": 3, "status": "Complete" }
  ],
  "total_plans": 30,
  "total_summaries": 18,
  "percent": 60
}
```

**Table format** produces a Markdown table with progress bar header.

**Bar format** produces a single-line progress bar: `[████████████░░░░░░░░] 18/30 plans (60%)`.

**Health format** produces a composite project health score:

```json
{
  "grade": "B",
  "composite": 72,
  "progress": { "score": 60, "completed": 18, "total": 30 },
  "context": { "score": 100, "utilization": 0.05, "tokens": 10500 },
  "staleness": { "score": 55, "stalePlans": 3, "totalPhases": 8 },
  "patterns_count": 5,
  "session_count": 12
}
```

**Grade mapping:** A (>=80), B (>=60), C (>=40), D (<40).

**Enhanced fields:** `patterns_count` (error patterns from `patterns.md`), `session_count` (session entries from `session-history.md`).

**`--raw` output (table/bar/health):** The rendered string.

---

### `context-budget`

Estimate context window utilization for the current phase. Measures how much of the 200K token context window would be consumed by loading project files, roadmap, state, and plans for the active phase.

```
pan-tools context-budget [--raw]
```

**JSON output:**
```json
{
  "status": "healthy",
  "currentPhase": "01",
  "contextWindow": 200000,
  "budgetUtilization": 0.05,
  "plans": 2,
  "incompletePlans": 1,
  "tokens": {
    "project": 250,
    "roadmap": 150,
    "state": 100,
    "plans": 500,
    "total": 1000
  },
  "recommendation": "Context budget is healthy. Proceed with execution.",
  "modelProfile": "balanced"
}
```

**Status thresholds:**

| Status | Utilization | Meaning |
|--------|------------|---------|
| `healthy` | < 60% | Proceed normally |
| `warning` | 60-80% | Consider splitting the phase |
| `critical` | > 80% | Phase too large, split recommended |
| `idle` | N/A | No current phase set |

**`--raw` output:** Human-readable text with budget breakdown.

---

## 11. Todos

### `todo complete <filename>`

Move a todo file from `.planning/todos/pending/` to `.planning/todos/completed/`, adding a completion timestamp.

```
pan-tools todo complete improve-error-handling.md [--raw]
```

**JSON output:**
```json
{ "completed": true, "file": "improve-error-handling.md", "date": "2026-02-27" }
```

**`--raw` output:** `completed`.

---

### `list-todos [area]`

Count and enumerate pending todo files from `.planning/todos/pending/`.

```
pan-tools list-todos [--raw]
pan-tools list-todos refactoring [--raw]
```

**Arguments:**
- `[area]` — Optional area filter (matches the `area:` frontmatter field in todo files)

**JSON output:**
```json
{
  "count": 3,
  "todos": [
    {
      "file": "improve-error-handling.md",
      "created": "2026-02-20",
      "title": "Improve error handling in parser",
      "area": "refactoring",
      "path": ".planning/todos/pending/improve-error-handling.md"
    }
  ]
}
```

**`--raw` output:** The count as a string.

---

## 12. Scaffolding

Commands for creating template files in phase directories. All scaffold commands use the same module entry point with type dispatch.

### `scaffold context --phase <N>`

Create a context.md template file in a phase directory.

```
pan-tools scaffold context --phase 5 [--raw]
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-context.md" }
```

---

### `scaffold uat --phase <N>`

Create a uat.md template file in a phase directory.

```
pan-tools scaffold uat --phase 5 [--raw]
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-uat.md" }
```

---

### `scaffold verification --phase <N>`

Create a verification.md template file in a phase directory.

```
pan-tools scaffold verification --phase 5 [--raw]
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-verification.md" }
```

---

### `scaffold phase-dir --phase <N> --name <name>`

Create a new phase directory under `.planning/phases/`.

```
pan-tools scaffold phase-dir --phase 5 --name "Database Setup" [--raw]
```

**Flags:**
- `--phase <N>` — Phase number
- `--name <name>` — Phase name (used to generate slug for directory)

**JSON output:**
```json
{
  "created": true,
  "directory": ".planning/phases/05-database-setup",
  "path": "/absolute/path/.planning/phases/05-database-setup"
}
```

**`--raw` output:** The absolute path.

---

## 13. Frontmatter CRUD

Commands for reading and writing YAML frontmatter in markdown files. Frontmatter is the YAML block between `---` delimiters at the top of PAN's plan.md, summary.md, and verification.md files.

### `frontmatter get <file> [--field <key>]`

Extract YAML frontmatter from a file as JSON.

```
pan-tools frontmatter get .planning/phases/05-setup/05-01-plan.md [--raw]
pan-tools frontmatter get path/to/plan.md --field wave [--raw]
```

**JSON output (all fields):**
```json
{
  "phase": "05-setup",
  "plan": "01",
  "type": "execute",
  "wave": "1",
  "depends_on": [],
  "files_modified": ["src/db/schema.ts"],
  "autonomous": "true"
}
```

**JSON output (single field):**
```json
{ "wave": "1" }
```

---

### `frontmatter set <file> --field <key> --value <jsonVal>`

Update a single frontmatter field. The value is JSON-parsed (so `"true"` becomes boolean `true`, `"[1,2]"` becomes an array).

```
pan-tools frontmatter set path/to/plan.md --field wave --value 2 [--raw]
pan-tools frontmatter set path/to/plan.md --field autonomous --value false [--raw]
```

**JSON output:**
```json
{ "updated": true, "field": "wave", "value": 2 }
```

**`--raw` output:** `true`.

---

### `frontmatter merge <file> --data '{json}'`

Merge a JSON object into the file's frontmatter (shallow merge — existing keys are overwritten, new keys are added).

```
pan-tools frontmatter merge path/to/plan.md --data '{"wave": 2, "autonomous": false}' [--raw]
```

**JSON output:**
```json
{ "merged": true, "fields": ["wave", "autonomous"] }
```

**`--raw` output:** `true`.

---

### `frontmatter validate <file> --schema plan|summary|verification`

Validate that a file's frontmatter contains all required fields for the given schema.

```
pan-tools frontmatter validate path/to/plan.md --schema plan [--raw]
```

**Schemas and required fields:**

| Schema | Required Fields |
|--------|----------------|
| `plan` | `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous`, `must_haves` |
| `summary` | `phase`, `plan`, `subsystem`, `tags`, `duration`, `completed` |
| `verification` | `phase`, `verified`, `status`, `score` |

**JSON output:**
```json
{
  "valid": true,
  "missing": [],
  "present": ["phase", "plan", "type", "wave", "depends_on", "files_modified", "autonomous", "must_haves"],
  "schema": "plan"
}
```

**`--raw` output:** `valid` or `invalid`.

---

## 14. Template Operations

Commands for selecting and filling plan/summary/verification templates.

### `template select <plan-path>`

Select the optimal SUMMARY template based on a plan's complexity (task count, file count, decisions presence). Used internally by workflows to choose between simple and detailed summary templates.

```
pan-tools template select .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "template": ".planning/references/summary-template.md",
  "type": "standard",
  "task_count": 3,
  "file_count": 5,
  "has_decisions": true
}
```

**`--raw` output:** The template file path.

---

### `template fill summary --phase N [--plan M] [--name "..."] [--fields '{json}']`

Create a pre-filled summary.md file in the phase directory.

```
pan-tools template fill summary --phase 5 --plan 1 --name "Database Setup"
pan-tools template fill summary --phase 5 --fields '{"subsystem": "database"}'
```

**Flags:**
- `--phase N` — Phase number (required)
- `--plan M` — Plan number (default: `01`)
- `--name "..."` — Phase name override
- `--fields '{json}'` — Additional frontmatter fields to merge

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-01-summary.md", "template": "summary" }
```

---

### `template fill plan --phase N [--plan M] [--type execute|tdd] [--wave N] [--fields '{json}']`

Create a pre-filled plan.md file in the phase directory.

```
pan-tools template fill plan --phase 5 --plan 2 --type tdd --wave 1
```

**Flags:**
- `--phase N` — Phase number (required)
- `--plan M` — Plan number (default: `01`)
- `--type execute|tdd` — Plan type (default: `execute`)
- `--wave N` — Wave number (default: `1`)
- `--fields '{json}'` — Additional frontmatter fields to merge

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-02-plan.md", "template": "plan" }
```

---

### `template fill verification --phase N [--fields '{json}']`

Create a pre-filled verification.md file in the phase directory.

```
pan-tools template fill verification --phase 5
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-verification.md", "template": "verification" }
```

---

## 15. Config Operations

Commands for managing `.planning/config.json` — the per-project configuration file.

### `config-ensure-section`

Initialize `.planning/config.json` with defaults. Does nothing if the file already exists. Merges user-level defaults from `~/.pan-wizard/defaults.json` if available. Auto-detects Brave Search API key availability.

```
pan-tools config-ensure-section [--raw]
```

**JSON output (created):**
```json
{ "created": true, "path": ".planning/config.json" }
```

**JSON output (exists):**
```json
{ "created": false, "reason": "already_exists" }
```

**`--raw` output:** `created` or `exists`.

**Default config values:**

| Key | Default | Description |
|-----|---------|-------------|
| `model_profile` | `"balanced"` | Agent model selection: `quality`, `balanced`, `budget` |
| `commit_docs` | `true` | Auto-commit planning docs after state changes |
| `parallelization` | `true` | Enable parallel wave execution |
| `branching_strategy` | `"none"` | Git branching: `none`, `phase`, `plan` |
| `workflow.research` | `true` | Enable research phase before planning |
| `workflow.plan_check` | `true` | Enable plan-checker agent verification loop |
| `brave_search` | auto-detected | Brave Search API availability |

---

### `config-get <key.path>`

Read a value from `.planning/config.json`. Supports dot-notation for nested keys.

```
pan-tools config-get model_profile [--raw]
pan-tools config-get workflow.research [--raw]
```

**JSON output:** The value at the key path (could be string, boolean, number, object, or array).

**`--raw` output:** The value as a string.

---

### `config-set <key.path> <value>`

Write a value to `.planning/config.json`. Supports dot-notation for nested keys. Automatically parses `true`/`false` as booleans and numeric strings as numbers.

```
pan-tools config-set model_profile quality [--raw]
pan-tools config-set workflow.research false [--raw]
pan-tools config-set parallelization true [--raw]
```

**JSON output:**
```json
{ "updated": true, "key": "workflow.research", "value": false }
```

**`--raw` output:** `key=value` string.

---

## 16. Utility Commands

Standalone utility commands used across workflows.

### `resolve-model <agent-type>`

Get the model name for an agent based on the current model profile in config. The model profile (`quality`/`balanced`/`budget`) determines which model tier each agent type uses.

```
pan-tools resolve-model pan-executor [--raw]
```

**Valid agent types:** `pan-planner`, `pan-roadmapper`, `pan-executor`, `pan-phase-researcher`, `pan-project-researcher`, `pan-research-synthesizer`, `pan-debugger`, `pan-document_code`, `pan-verifier`, `pan-reviewer`, `pan-plan-checker`, `pan-integration-checker`

**JSON output:**
```json
{ "model": "sonnet", "profile": "balanced", "strategy": "static", "effort": "high" }
```

For unknown agents: `{ "model": "sonnet", "profile": "balanced", "strategy": "static", "effort": "medium", "unknown_agent": true }`

**`--raw` output:** Model name string (e.g., `sonnet`, `haiku`, `inherit`). `inherit` means "use the parent model (opus)".

**Effort (2026-06):** alongside the tier, every agent resolves to a reasoning-effort level (`low`/`medium`/`high`/`xhigh`) — the primary within-model cost/intelligence dial on current models (it replaced fixed thinking budgets). Base levels per agent mirror the `effort:` frontmatter shipped in `agents/*.md`; the `budget` profile steps effort down one level (floor `low`); `quality`/`balanced` keep the base. Override per agent via `.planning/config.json` → `"effort_overrides": { "pan-planner": "xhigh" }`.

**Model profile matrix:**

| Agent | Quality | Balanced | Budget |
|-------|---------|----------|--------|
| planner | inherit | inherit | sonnet |
| roadmapper, executor, debugger | inherit | sonnet | sonnet |
| researchers, synthesizer, verifier, plan-checker, integration-checker | inherit | sonnet | haiku |
| document_code (mapper), reviewer | inherit | haiku | haiku |

Quality is `inherit` for **every** agent (all reasoning-tier). `inherit` → the host's selected top model, `sonnet` → mid tier, `haiku` → fast tier. Derived from `MODEL_PROFILES` in `core.cjs` — that table is the source of truth.

---

### `commit <message> [--files f1 f2] [--amend] [--type TYPE] [--force]`

Commit planning docs to git. Respects `commit_docs` config setting and `.gitignore`. Includes safety checks for deleted and sensitive files.

```
pan-tools commit "Phase 5 planning complete" [--raw]
pan-tools commit "Update plans" --files .planning/phases/05-setup/05-01-plan.md
pan-tools commit "" --amend
pan-tools commit "add-feature" --type feat
pan-tools commit "bugfix" --type fix --force
```

**Arguments:**
- `<message>` — Commit message (required unless `--amend`)
- `--files f1 f2 ...` — Specific files to stage (default: `.planning/`)
- `--amend` — Amend the previous commit instead of creating a new one
- `--type TYPE` — Conventional commit type prefix. Valid: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`. Prepends `type: ` to message.
- `--force` — Skip deleted-file safety check

**Safety checks** (enabled by default via `config.commit.safety_checks`):
- **Deleted files:** Blocks commit if deleted files in staging (use `--force` to override)
- **Sensitive files:** Blocks commit if `.env`, `.pem`, `.key`, `credentials`, `secret`, `password`, or `token` files detected in staging (configurable via `config.commit.sensitive_patterns`)

**JSON output:**
```json
{
  "committed": true,
  "hash": "abc1234",
  "reason": "committed",
  "type": "feat",
  "safety_checks": { "deleted_files": [], "sensitive_files_blocked": [] }
}
```

**Block reasons:** `deleted_files_detected`, `sensitive_file_detected`.

**Skip reasons:** `skipped_commit_docs_false`, `skipped_gitignored`, `nothing_to_commit`.

**`--raw` output:** The short hash, `skipped`, `blocked`, or `nothing`.

---

### `rollback-snapshot <phase>`

Create a git tag snapshot before execution for easy rollback. Tag format: `pan-rollback-{phase}-{timestamp}`.

```
pan-tools rollback-snapshot 5 [--raw]
pan-tools rollback-snapshot 5.1
```

**JSON output:**
```json
{ "tag": "pan-rollback-05-20260301T120000", "hash": "abc1234", "phase": "5" }
```

**Not a git repo:** Returns `{ "tag": null, "warning": "Not a git repository or no commits" }`.

**`--raw` output:** The tag name.

---

### `batch-commit <items-json>`

Stage and commit multiple planning file groups in a single operation. Respects `commit_docs` config — returns `{ committed: false, reason: "skipped_commit_docs_false" }` when disabled.

**Module:** `commands.cjs`

```
pan-tools batch-commit '[{"files":["f1.md"],"message":"docs: update"}]' [--raw]
```

**JSON output:**
```json
{ "committed": true, "count": 1 }
```

**Not a git repo:** Returns `{ "committed": false, "reason": "not_a_git_repo" }`.

---

### `estimate-cost`

Estimate relative cost multipliers for each model profile. Shows total and average cost across all agents.

**Module:** `commands.cjs`

```
pan-tools estimate-cost [--raw]
```

**JSON output (numbers shown are illustrative — actual counts depend on registered agents):**
```json
{
  "estimates": [
    { "profile": "quality", "total": <N>, "average": 15.0, "agentCount": <N> },
    { "profile": "balanced", "total": <N>, "average": 3.7, "agentCount": <N> },
    { "profile": "budget", "total": <N>, "average": 1.6, "agentCount": <N> }
  ]
}
```

**`--raw` output:** One line per profile: `quality: ~15.0x baseline (<N> agents)`.

---

### `generate-slug <text>`

Convert arbitrary text to a URL-safe slug.

```
pan-tools generate-slug "Database Migration Layer" [--raw]
```

**JSON output:**
```json
{ "slug": "database-migration-layer" }
```

**`--raw` output:** The slug string.

**Rules:** Lowercase, spaces/underscores become hyphens, non-alphanumeric characters removed, consecutive hyphens collapsed.

---

### `current-timestamp [format]`

Get the current timestamp.

```
pan-tools current-timestamp            # full (default)
pan-tools current-timestamp date       # YYYY-MM-DD
pan-tools current-timestamp filename   # YYYY-MM-DDTHH-MM-SS (no colons)
```

**Formats:**

| Format | Output | Example |
|--------|--------|---------|
| `full` | ISO 8601 | `2026-02-27T12:00:00.000Z` |
| `date` | Date only | `2026-02-27` |
| `filename` | Filesystem-safe | `2026-02-27T12-00-00` |

**JSON output:**
```json
{ "timestamp": "2026-02-27T12:00:00.000Z" }
```

**`--raw` output:** The timestamp string.

---

### `verify-path-exists <path>`

Check whether a file or directory exists.

```
pan-tools verify-path-exists src/index.ts [--raw]
```

**JSON output:**
```json
{ "exists": true, "type": "file" }
```

Type is `file`, `directory`, or `other`. If not found: `{ "exists": false, "type": null }`.

**`--raw` output:** `true` or `false`.

---

### `history-digest`

Aggregate data from all summary.md files across current and archived phases. Extracts dependency graphs, decisions, patterns, and tech stack.

```
pan-tools history-digest [--raw]
```

**JSON output:**
```json
{
  "phases": {
    "05": {
      "name": "Setup",
      "provides": ["auth-module", "db-schema"],
      "affects": ["api-routes"],
      "patterns": ["repository-pattern"]
    }
  },
  "decisions": [
    { "phase": "05", "decision": "Use PostgreSQL for primary storage" }
  ],
  "tech_stack": ["typescript", "express", "postgresql"]
}
```

**Note:** Uses the `@file:` protocol if the digest exceeds 50 KB.

---

### `summary-extract <path> [--fields f1,f2]`

Extract structured data from a summary.md file's frontmatter.

```
pan-tools summary-extract .planning/phases/05-setup/05-01-summary.md
pan-tools summary-extract path/to/summary.md --fields key_files,decisions
```

**Arguments:**
- `<path>` — Relative path to summary.md
- `--fields f1,f2,...` — Comma-separated list of fields to extract (optional; returns all if omitted)

**Available fields:** `one_liner`, `key_files`, `tech_added`, `patterns`, `decisions`, `requirements_completed`

**JSON output:**
```json
{
  "path": ".planning/phases/05-setup/05-01-summary.md",
  "one_liner": "Built authentication module with JWT support",
  "key_files": ["src/auth/index.ts", "src/auth/jwt.ts"],
  "tech_added": ["jsonwebtoken"],
  "patterns": ["middleware-chain"],
  "decisions": [{ "summary": "Use JWT", "rationale": "Stateless auth for API" }],
  "requirements_completed": ["REQ-03"]
}
```

---

### `websearch <query> [--limit N] [--freshness day|week|month]`

Search the web via the Brave Search API. Requires `BRAVE_API_KEY` environment variable. This is the only async command in pan-tools.

```
pan-tools websearch "Node.js stream backpressure" --limit 5 --freshness week
```

**Arguments:**
- `<query>` — Search query string
- `--limit N` — Max results (default: 10)
- `--freshness day|week|month` — Recency filter

**JSON output:**
```json
{
  "available": true,
  "query": "Node.js stream backpressure",
  "count": 5,
  "results": [
    {
      "title": "Understanding Node.js Streams",
      "url": "https://example.com/...",
      "description": "A deep dive into...",
      "age": "2 days ago"
    }
  ]
}
```

If `BRAVE_API_KEY` is not set: `{ "available": false, "reason": "BRAVE_API_KEY not set" }`.

---

## 17. Compound Init Commands

These commands gather all context needed for a specific workflow in a single call, avoiding multiple round trips. Each init command resolves models, checks file existence, reads state, and returns a comprehensive JSON object that the workflow's command `.md` file consumes.

All init commands support `--raw` (returns key=value pairs) and `--cwd <path>`.

### `init execute-phase <phase> [--dry-run] [--budget N]`

All context for the execute-phase workflow. Includes tier classification, budget tracking, and execution mode.

```
pan-tools init execute-phase 5 [--raw]
pan-tools init execute-phase 5 --dry-run
pan-tools init execute-phase 5 --budget 30
pan-tools init execute-phase 5 --dry-run --budget 25
```

**Arguments:**
- `--dry-run` — Preview execution plan without spawning agents. Sets `dry_run: true` in output.
- `--budget N` — Override budget points (default: 50, min: 1, max: 200). Plans exceeding budget set `budget_exceeded: true`.

**Key output fields:**
- `executor_model`, `verifier_model` — Resolved model names
- `commit_docs`, `parallelization`, `branching_strategy` — Config flags
- `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug` — Phase info
- `plans`, `summaries`, `incomplete_plans`, `plan_count`, `incomplete_count` — Plan inventory
- `branch_name` — Pre-computed branch name (if branching enabled)
- `milestone_version`, `milestone_name`, `milestone_slug` — Milestone info
- `state_exists`, `roadmap_exists`, `config_exists` — File existence checks
- `phase_req_ids` — Requirement IDs extracted from roadmap.md
- `plans_by_tier` — Tier breakdown: `{ micro: N, standard: N, full: N }`
- `total_budget_points` — Budget limit for this execution
- `estimated_points` — Total effort points (XS=1, S=2, M=4, L=10, XL=20)
- `budget_exceeded` — `true` if estimated > budget
- `execution_mode` — Execution ordering strategy (default: `wave_order`)
- `dry_run` — Whether this is a preview-only run
- `rollback_tag` — Git rollback tag (null in dry-run mode)

---

### `init plan-phase <phase>`

All context for the plan-phase workflow.

```
pan-tools init plan-phase 5 [--raw]
```

**Key output fields:**
- `researcher_model`, `planner_model`, `checker_model` — Resolved model names
- `research_enabled`, `plan_checker_enabled`, `commit_docs` — Workflow flags
- Phase info, existing artifacts (`has_research`, `has_context`, `has_plans`)
- `context_path`, `research_path`, `verification_path`, `uat_path` — Existing file paths
- `phase_req_ids` — Requirement IDs extracted from roadmap.md

---

### `init new-project`

All context for the new-project workflow. Includes brownfield detection.

```
pan-tools init new-project [--raw]
```

**Key output fields:**
- `researcher_model`, `synthesizer_model`, `roadmapper_model` — Model names
- `project_exists`, `has_codebase_map`, `planning_exists` — Existing state
- `has_existing_code`, `has_package_file`, `is_brownfield`, `needs_codebase_map` — Brownfield detection
- `has_git`, `brave_search_available` — Environment detection

---

### `init new-milestone`

All context for the new-milestone workflow.

```
pan-tools init new-milestone [--raw]
```

**Key output fields:**
- `researcher_model`, `synthesizer_model`, `roadmapper_model` — Model names
- `current_milestone`, `current_milestone_name` — Current milestone info
- File existence checks for project.md, roadmap.md, state.md

---

### `init quick <description>`

All context for the quick task workflow.

```
pan-tools init quick "Fix login button alignment" [--raw]
```

**Key output fields:**
- `planner_model`, `executor_model`, `checker_model`, `verifier_model` — Model names
- `next_num`, `slug`, `description` — Quick task identifiers
- `date`, `timestamp` — Current date/time
- `quick_dir`, `task_dir` — Computed paths

---

### `init resume`

All context for the resume-project workflow.

```
pan-tools init resume [--raw]
```

**Key output fields:**
- `state_exists`, `roadmap_exists`, `project_exists`, `planning_exists` — File existence
- `has_interrupted_agent`, `interrupted_agent_id` — Agent state recovery
- `commit_docs` — Config

---

### `init verify-work <phase>`

All context for the verify-work workflow.

```
pan-tools init verify-work 5 [--raw]
```

**Key output fields:**
- `planner_model`, `checker_model` — Model names
- Phase info, `has_verification` — Existing artifacts

---

### `init phase-op <phase>`

Generic phase operation context. Falls back to roadmap.md if no directory exists.

```
pan-tools init phase-op 5 [--raw]
```

**Key output fields:**
- `commit_docs`, `brave_search` — Config flags
- Phase info, existing artifacts (`has_research`, `has_context`, `has_plans`, `has_verification`)
- `context_path`, `research_path`, `verification_path`, `uat_path` — File paths (if found)

---

### `init todos [area]`

All context for todo workflows.

```
pan-tools init todos [--raw]
pan-tools init todos refactoring [--raw]
```

**Key output fields:**
- `todo_count`, `todos[]` — Todo inventory
- `area_filter` — Applied area filter
- `pending_dir`, `completed_dir` — Directory paths
- `pending_dir_exists`, `todos_dir_exists` — Directory existence

---

### `init milestone-op`

All context for milestone operations.

```
pan-tools init milestone-op [--raw]
```

**Key output fields:**
- `milestone_version`, `milestone_name`, `milestone_slug` — Current milestone
- `phase_count`, `completed_phases`, `all_phases_complete` — Phase progress
- `archived_milestones[]`, `archive_count` — Archive info

---

### `init map-codebase`

All context for the map-codebase workflow.

```
pan-tools init map-codebase [--raw]
```

**Key output fields:**
- `mapper_model` — Resolved model name
- `search_gitignored`, `parallelization` — Config flags
- `existing_maps[]`, `has_maps` — Existing codebase maps

---

### `init progress`

All context for the progress workflow.

```
pan-tools init progress [--raw]
```

**Key output fields:**
- `executor_model`, `planner_model` — Model names
- `milestone_version`, `milestone_name` — Milestone info
- `phases[]`, `phase_count`, `completed_count`, `in_progress_count` — Phase overview
- `current_phase`, `next_phase`, `paused_at`, `has_work_in_progress` — Current state

---

## 18. Focus Commands

Strategic project management: work item scanning, capacity budgeting, documentation sync, and execution pipelines.

**Module:** `focus.cjs`

### `focus scan`

Collect, classify, and sort all work items from phases, todos, and error patterns.

```
pan-tools focus scan [--lean] [--raw]
```

**Sources scanned:**
- Phase plans (roadmap.md + phase directory plan.md frontmatter)
- Pending todos (`.planning/todos/pending/`)
- Error patterns (`.planning/patterns.md`)

**Key output fields:**
- `items[]` — Sorted work items with `id`, `title`, `source`, `priority`, `effort`, `points`, `realityScore`
- `sources` — Count per source type: `{phases, todos, patterns}`
- `total` — Total item count
- `priorities` — Count per priority level: `{P0: N, P1: N, ...}`

**Flags:**
- `--lean` — Filter items with Reality Score < 1.5 (only affects P3-P6 items)

### `focus plan`

Create a capacity-budgeted execution batch from scanned items.

```
pan-tools focus plan [--budget N] [--mode MODE] [--priority P0-P6] [--lean] [--raw]
```

**Modes:**
| Mode | Budget | Algorithm |
|------|--------|-----------|
| `bugfix` | 40 pts | P0 mandatory → P1 → P2-P4 smallest-first, no features |
| `balanced` | 50 pts | Stability (60%) + Feature (40%) split |
| `features` | 50 pts | P0 mandatory, then 80% features, 20% stability |
| `full` | 60 pts | All priorities equally, impact-first |

**Key output fields:**
- `mode`, `budget`, `allocated` — Budget allocation
- `items_selected`, `items_remaining` — Batch sizing
- `batch[]` — Selected items with `tier` and `track` fields
- `batch_file` — Path to saved batch JSON

**Writes:** `.planning/focus/batch-YYYY-MM-DD.json`

### `focus sync`

Check documentation staleness by comparing actual file counts against documented counts.

```
pan-tools focus sync [--check-only] [--raw]
```

**Key output fields:**
- `actuals` — `{commands, agents, modules}` actual counts
- `stale[]` — Stale entries with `{file, entity, documented, actual}`
- `current[]` — Current entries
- `stale_count`, `needs_sync` — Summary

### `focus exec`

Load the latest batch and classify items by execution tier.

```
pan-tools focus exec [--dry-run] [--raw]
```

**Key output fields:**
- `dry_run` — Whether this is a preview
- `mode`, `budget`, `allocated` — From batch
- `total_items` — Items in batch
- `tiers` — `{micro, standard, full}` counts
- `items[]` — Full batch items
- `batch_file` — Path to batch file

**Reads:** Latest `.planning/focus/batch-*.json`

### `squad list | show <name>` (v3.11, ADR-0032)

Bot-army squad registry. `squad list` shows the four squads (architecture / build / quality / release) with their model tier, tool-access contract, and member count; `squad show <name>` shows one squad's full roster. Read by `pan-conductor` campaign mode and `/pan:army` to resolve the roster at runtime instead of hardcoding it.

**Module:** `squads.cjs`

### `worktree list | create <task> | remove <path>` (v3.11, ADR-0033)

Branch-per-agent git worktrees for the Build squad — each builder gets its own `army/<task>` branch + isolated tree so concurrent agents never collide. `create` accepts `--base <ref>`; `remove` accepts `--branch <name>` `--force` and refuses to delete non-`army/` branches.

**Module:** `worktree.cjs`

### `campaign schedule | status | due | record-run` (v3.12, ADR-0034)

Scheduled, self-resuming bot-army campaigns. PAN is not a daemon: this module owns the schedule **descriptor** and the decision of whether a run is **due** — an external trigger (host scheduler, cron, `/loop`, or a human) polls `campaign due` and fires `/pan:army --continue`. The always-ask human merge gate is never affected by scheduling. Descriptor lives at `.planning/orchestration/schedule.json`.

**Module:** `campaign.cjs`

- `campaign schedule` — arm or update the schedule. Flags: `--cadence <hourly|daily|weekly|Nh|Nd>` (default `daily`), `--daily-budget <points>` (default 300), `--goal <text>`, `--source <name>` (default `backlog`), `--pause`, `--resume`, `--disable`. Returns the written descriptor.
- `campaign status` — full descriptor plus computed `spent_today`, `due`, and `reason`. Also the default when `campaign` is run with no subcommand.
- `campaign due` — host-scheduler gate: returns `{due, reason, next_due}`. `reason` is one of `no_schedule`, `disabled`, `paused`, `budget_exhausted_today`, `due`, `not_yet`.
- `campaign record-run` — record a completed run and advance `next_due`. Flags: `--items <N>`, `--points <N>`.

### `hud [--out <file>] [--open] [--stdout]` (v3.12, ADR-0035)

Generates a single self-contained HTML dashboard of the project + bot army (default `.planning/hud.html`). Aggregates existing state — `state.md`, roadmap/phases, the squad registry, the campaign schedule, army worktrees, the cost ledger, `requirements.md`, verification artifacts, and git history — into up to ten panels. It is a read-only **view**: it writes only its own rendered file and creates no new state. Army-only panels (command stack, campaign, safety harness, worktrees) self-hide on plain (non-army) projects. `--out` overrides the path, `--open` launches the default browser, `--stdout` prints HTML instead of writing. The file is dependency-free (inlined CSS, no `<script>`, no network) and identical across all five runtimes. Distinct from the JSON `pan-tools dashboard` command (`state.cjs`), which prints a compact project overview rather than HTML.

**Module:** `hud.cjs`

### `focus auto`

Auto-runner state management: initialize, status, update, stop.

```
pan-tools focus auto [--source scan|backlog] [--category CAT] [--mode MODE] [--budget N] [--max-cycles N]
                     [--total-budget N] [--parallel-research] [--parallel-verify] [--clean-seal]
                     [--status] [--stop] [--update] [--continue] [--dry-run] [--raw]
```

**Categories:** cleanup (P3-P5), tests (P2-P5), stability (P0-P2), features (P3-P5), docs (P5-P6), optimize (P1-P4), prompts (P0-P6)

**Work source (ADR-0031):** `--source scan` (default) selects work by category code-scan; `--source backlog` ranks actionable `roadmap.md`/`requirements.md` items by value/effort. `--parallel-research`/`--parallel-verify` fan those stages out via the Workflow tool (implement/exec stays serial); `--clean-seal` runs one clean build + full verification after the last item. All default off.

**Operations:**
- Default: Initialize new auto-run with category defaults
- `--status`: Show current run state with computed budget/cycles remaining
- `--update`: Record cycle results (pass `--items-completed`, `--points-used`, `--tests-before`, `--tests-after`)
- `--stop`: Gracefully stop an active run
- `--continue`: Resume a stopped/initialized run
- `--dry-run`: Show what would be initialized without writing

**Stop conditions (auto-detected on --update):**
- `regression` — tests decreased between cycles
- `budget_cap` — cumulative points exceeded `--total-budget`
- `max_cycles` — iteration limit reached
- `zero_completed` — no items completed in a cycle
- `diminishing_returns` — optimize only: cycle efficiency < 30% of previous cycle

**State file:** `.planning/focus/auto-run.json`

---

### `focus design`

Workflow-only command that routes to the 10-phase investigation pipeline.

```
pan-tools focus design [--raw]
```

**Output:** JSON message directing to `/pan:focus-design` workflow.

**Modes:** `--full` (default), `--internal`, `--outward`, `--spike`
**Modifiers:** `--gate`, `--audit`, `--mvp`

---

## 19. Standards Commands

Industry standards selection and advisory compliance. Select standards from a built-in catalog, get project-type recommendations, and track compliance via checklists.

**Module:** `config.cjs`

### `standards list [--category <cat>]`

List all available standards from the built-in catalog.

```
pan-tools standards list [--raw]
pan-tools standards list --category security
```

**Flags:**
- `--category` — Filter by category (security, accessibility, quality, architecture, process)

**JSON output:**
```json
{
  "standards": [
    { "id": "owasp-top10", "name": "OWASP Top 10 (2025)", "category": "security", "level": "foundational", "description": "..." }
  ],
  "count": 12
}
```

### `standards select <id>`

Add a standard to the project. Creates/updates `.planning/standards.md`.

```
pan-tools standards select owasp-top10
pan-tools standards select wcag-22
```

**JSON output:**
```json
{
  "added": "owasp-top10",
  "project_standards": ["owasp-top10"],
  "standards_file": ".planning/standards.md"
}
```

**Errors:** Unknown standard ID, duplicate selection.

### `standards remove <id>`

Remove a standard from the project. Deletes standards.md when last standard removed.

```
pan-tools standards remove owasp-top10
```

**JSON output:**
```json
{
  "removed": "owasp-top10",
  "project_standards": ["stride"],
  "standards_file": ".planning/standards.md"
}
```

### `standards status`

Report compliance status for all selected standards. Counts checked vs unchecked items.

```
pan-tools standards status [--raw]
```

**JSON output:**
```json
{
  "project_standards": ["owasp-top10", "stride"],
  "checks": [
    { "standard_id": "owasp-top10", "standard_name": "OWASP Top 10 (2025)", "category": "security", "status": "partial", "checklist_items": 10, "verified_items": 3, "coverage": "30%" }
  ],
  "overall_status": "partial"
}
```

**Status values:** `none` (no standards), `configured` (0% verified), `partial` (some verified), `complete` (all verified).

### `standards recommend`

Recommend standards based on project.md content analysis. Detects project types (web, api, ai, agent, enterprise, cli) via keyword matching.

```
pan-tools standards recommend [--raw]
```

**JSON output:**
```json
{
  "project_types": ["web", "api"],
  "recommendations": [
    { "id": "owasp-top10", "name": "OWASP Top 10 (2025)", "category": "security", "description": "..." }
  ]
}
```

**Requires:** `.planning/project.md` must exist.

### `standards phase-track`

Show which standards are relevant to a specific phase and their compliance state. Analyzes plan.md content for keywords that map to standards.

```
pan-tools standards phase-track <phase-number> [--raw]
```

**JSON output:**
```json
{
  "phase": "1",
  "phase_name": "auth-setup",
  "relevant_standards": ["owasp-top10", "owasp-asvs-l1"],
  "compliance": [
    { "standard_id": "owasp-top10", "standard_name": "OWASP Top 10 (2025)", "selected": true, "status": "configured", "checklist_items": 10, "verified_items": 0, "coverage": "0%" },
    { "standard_id": "owasp-asvs-l1", "standard_name": "OWASP ASVS L1", "selected": false, "status": "not_selected", "action": "Consider selecting with: pan-tools standards select owasp-asvs-l1" }
  ]
}
```

**Keyword detection:** Maps phase plan content keywords (auth, login, security, accessibility, llm, agent, etc.) to relevant standard IDs.

### `standards tools`

List external scanning tools recommended for selected or specified standards.

```
pan-tools standards tools [standard-id] [--raw]
```

Without arguments, uses the project's selected standards. With a standard ID, shows tools for that specific standard.

**JSON output:**
```json
{
  "standards_queried": ["owasp-top10"],
  "recommendations": [
    { "standard_id": "owasp-top10", "standard_name": "OWASP Top 10 (2025)", "tools": [
      { "name": "OWASP ZAP", "url": "https://www.zaproxy.org/", "description": "Dynamic application security scanner" },
      { "name": "Semgrep", "url": "https://semgrep.dev/", "description": "Static analysis with OWASP rule packs" }
    ]}
  ],
  "unique_tools": [
    { "name": "OWASP ZAP", "url": "https://www.zaproxy.org/", "description": "Dynamic application security scanner", "standards": ["owasp-top10"] }
  ]
}
```

---

## 20. Operations Commands

Pre-flight checks, project dashboard, session learnings, and dependency validation. Based on competitive analysis of 6 AI coding tools (ADR-0013).

### `preflight [target]`

Run pre-flight validation checks before execution. Validates state, blockers, git status, config, and error patterns.

**Module:** `verify.cjs`

```
pan-tools preflight [target] [--raw]
```

**Arguments:**
- `target` (optional) — `batch` to check for active batch file, or a phase number (e.g., `01`) to check phase directory exists

**Checks performed:**
| Check | What it validates |
|-------|-------------------|
| `planning_dir` | `.planning/` directory exists |
| `state_readable` | `state.md` can be parsed |
| `no_blockers` | No unresolved blockers in state.md |
| `git_clean` | Git working tree is clean |
| `error_patterns` | Reports count of known error patterns |
| `config_exists` | `config.json` exists |
| `batch_exists` / `target_phase` | Target-specific check (if target provided) |

**JSON output:**
```json
{
  "ready": true,
  "checks": [
    { "name": "state_readable", "passed": true, "detail": "..." }
  ],
  "blockers": [],
  "passed": 6,
  "total": 6
}
```

### `dashboard`

Aggregated project overview showing phase progress, blockers, and next action.

> **Not the HTML dashboard.** `pan-tools dashboard` emits a compact **JSON** project overview (this command, `state.cjs`). For the single-page **HTML** army dashboard, see the `hud` command (`hud.cjs`). The slash command `/pan:dashboard` is a discoverability **alias for `/pan:hud`** (the HTML view) — not for this JSON command.

**Module:** `state.cjs`

```
pan-tools dashboard [--raw]
```

**JSON output:**
```json
{
  "project": "Project Name",
  "version": "1.0.0",
  "current_phase": { "number": "03", "name": "core", "status": "Executing" },
  "blockers": 0,
  "phase_progress": { "total": 5, "with_plans": 3, "with_summaries": 2 },
  "milestone": { "version": "1.0.0", "name": "Initial Release" },
  "next_phase": { "number": "04", "name": "testing" },
  "last_activity": "2026-03-03"
}
```

### `learnings extract`

Auto-extract learnings from session history, error patterns, and phase summaries.

**Module:** `commands.cjs`

```
pan-tools learnings extract [--raw]
```

**Sources:**
- Error patterns (`.planning/patterns.md`) → error-resolution learnings
- Phase summaries (key-files frontmatter) → file co-change patterns (requires 2+ co-occurrences)
- Patterns established (summary frontmatter) → pattern learnings

**Writes:** `.planning/learnings.md`

**Deduplication:** Skips learnings whose detail string already exists in the file.

**JSON output:**
```json
{
  "extracted": 3,
  "total": 15,
  "by_type": { "error-resolution": 1, "co-change": 1, "pattern": 1 }
}
```

### `learnings list`

List all extracted learnings with type breakdown.

**Module:** `commands.cjs`

```
pan-tools learnings list [--raw]
```

**JSON output:**
```json
{
  "learnings": [
    { "id": "LEARN-001", "type": "error-resolution", "title": "Import fix", "detail": "old -> new", "files": [], "date": "2026-03-01" }
  ],
  "count": 1,
  "by_type": { "error-resolution": 1 }
}
```

### `learnings prune`

Remove learnings by age or specific ID.

**Module:** `commands.cjs`

```
pan-tools learnings prune --days N [--raw]
pan-tools learnings prune --id LEARN-NNN [--raw]
```

**Flags:**
- `--days N` — Remove entries with dates older than N days
- `--id LEARN-NNN` — Remove a specific entry by ID

**JSON output:**
```json
{
  "pruned": 2,
  "remaining": 13
}
```

### `links validate` (v3.8.0+)

Validate the doc–code link graph (ADR-0027). Walks `docs/`, `pan-wizard-core/`, `commands/`, `agents/` for inline `[[<id>]]` refs and `// @pan: <id>` source-comment anchors. Reports broken refs, stale anchors, and uncovered backlink contracts.

**Module:** `links.cjs`

```
pan-tools links validate [--strict] [--doc-root <p>] [--source-root <p>] [--raw]
```

**Flags:**
- `--strict` — fail on real warnings, not only errors. (B-002 single-source informational warning is exempt.)
- `--doc-root <path>` — override default doc roots; repeatable.
- `--source-root <path>` — override default source roots; repeatable.

**Exit codes:**
- `0` — pass
- `1` — fail (errors present, or non-B-002 warnings under `--strict`)

**JSON output:** `{ ok, summary: { total_findings, errors, warnings, status, doc_files_scanned, source_files_scanned, anchors_found, forward_links_found, backlink_contracts_checked }, findings: [{ code, severity, source, source_line, target, detail }] }`

**Finding codes:** F-001/F-002 (broken inline / section refs, error), F-003/F-004 (key_links path / regex, warning), B-001 (uncovered `require-code-mention`, error), B-002 (single-source informational, warning), A-001/A-002/A-004 (stale anchor target / section / empty id).

See ADR-0027 and `docs/specs/doc_code_link_graph_featureai.md` for the wire-level spec.

### `deps validate`

Cross-reference roadmap phases vs disk directories and detect orphaned requirements.

**Module:** `verify.cjs`

```
pan-tools deps validate [--raw]
```

**Checks performed:**
1. Parse roadmap.md for phase headers
2. Scan `.planning/phases/` directories
3. Cross-reference: roadmap phases not on disk = `missing_phases`, disk dirs not in roadmap = `orphaned_dirs`
4. Parse requirements.md for REQ-NN IDs
5. Scan phase summaries for REQ-NN references
6. Unreferenced uncompleted requirements = `orphaned_reqs`

**JSON output:**
```json
{
  "valid": true,
  "issues": [],
  "roadmap_phases": 5,
  "disk_phases": 5,
  "requirements_total": 10,
  "requirements_completed": 8,
  "orphaned_reqs": ["REQ-09"],
  "missing_phases": [],
  "orphaned_dirs": []
}
```

### `drift-check`

Check changed files against project conventions and produce a quantitative drift score.

**Module:** `verify.cjs`

```
pan-tools drift-check [--since <ref>] [--threshold <0.0-1.0>] [--files <path,...>] [--verbose] [--raw]
```

**Arguments:**
- `--since <ref>` — Git ref to diff against (default: HEAD)
- `--threshold <n>` — Pass/fail threshold (default: 0.5)
- `--files <paths>` — Comma-separated specific files to check (bypasses git diff)
- `--verbose` — Include `per_file` breakdown grouping violations by file

**Convention sources:** `.planning/codebase/CONVENTIONS.md` + `CLAUDE.md` + 5 built-in PAN rules.

**JSON output:**
```json
{
  "drift_score": 0.35,
  "verdict": "low",
  "passed": true,
  "threshold": 0.5,
  "violations": [
    {"file": "lib/verify.cjs", "line": 45, "rule": "no-console-log", "message": "Use output() instead of console.log", "severity": "error"}
  ],
  "violation_count": 3,
  "files_checked": 8,
  "conventions_loaded": 12,
  "summary": "drift: 0.35 (low) — 3 violations in 8 files"
}
```

**Verdicts:** clean (0-0.2), low (0.2-0.5), medium (0.5-0.8), high (0.8-1.0).

---

### `retro`

Milestone retrospective — analyze estimation accuracy, verification patterns, and common gap types. **(v2.10.0: adds `--write-memory`.)**

**Module:** `verify.cjs`

```
pan-tools retro [--write-memory] [--max N] [--raw]
```

**Flags:**
- `--write-memory` — append top-N gap patterns as lessons to `pan-planner` memory; write a verifier lesson when first-try rate < 60% over ≥3 runs.
- `--max N` — cap lessons written to memory (default 3, range 1–10).

**JSON output:**
```json
{
  "phases_planned": 8,
  "phases_completed": 6,
  "phases_decimal": 2,
  "estimation_accuracy_pct": 75,
  "verifications_total": 6,
  "verifications_passed_first_try": 4,
  "verifications_gaps_found": 2,
  "verifications_human_needed": 0,
  "first_try_rate_pct": 67,
  "common_gap_patterns": [
    {"pattern": "missing wiring between", "count": 3},
    {"pattern": "stub detected in", "count": 2}
  ],
  "memory": { "wrote": { "pan-planner": 2, "pan-verifier": 0 }, "max": 3 }
}
```

The `memory` field is omitted unless `--write-memory` is set.

**Error:** `{"error": "roadmap.md not found"}` if no `.planning/roadmap.md` exists.

---

## 20.1 Opus 4.7 Commands (v2.10.0)

Commands added for Spec A (Opus 4.7 existing enhancements). All degrade gracefully on smaller models / non-Claude runtimes.

### `memory read <agent>`

Read the append-only memory log for an agent. Returns parsed entries as JSON.

**Module:** `memory.cjs`

```
pan-tools memory read <agent> [--raw]
```

**JSON output when agent exists:**
```json
{
  "agent": "pan-planner",
  "exists": true,
  "entries": [
    "2026-04-18: Prefer bulk Postgres writes",
    "2026-04-18: Recurring plan gap (3x): missing wiring between API and UI"
  ]
}
```

Returns `{agent, exists: false, entries: []}` when no memory file exists.

### `memory append <agent> <entry>`

Append a lesson to an agent's memory. Creates file + directory if missing. Entries are auto-prefixed with today's date if not already prefixed.

```
pan-tools memory append <agent> <entry text can have spaces>
```

Agent name must match `^[a-zA-Z0-9_-]+$` (blocks path traversal). Newlines in the entry are collapsed to spaces.

### `memory list`

List all agents that have memory files plus their entry counts.

```
pan-tools memory list [--raw]
```

**JSON output:**
```json
{ "agents": [ {"agent": "pan-planner", "entries": 12}, {"agent": "pan-verifier", "entries": 4} ] }
```

### `memory compact <agent> [max]`

Trim an agent's memory file to the last `max` entries (default 500).

```
pan-tools memory compact <agent> 50
```

**JSON output:**
```json
{ "compacted": true, "kept": 50, "removed": 42 }
```

---

### `cache prime [--summary]`

Build an ordered, cache-eligible context block list from stable `.planning/` files (project.md, requirements.md, roadmap.md, state.md, standards.md). Commands call this once per invocation to prime the prompt cache; sub-agents spawned within 5 minutes hit cached reads.

**Module:** `core.cjs` (wrapper in dispatcher)

```
pan-tools cache prime [--summary] [--raw]
```

**Flags:**
- `--summary` — omit full block content; return only `{path, bytes, cache}` metadata. Useful when the caller only needs the cache key / size estimate.

**JSON output (full):**
```json
{
  "blocks": [
    { "path": ".planning/project.md", "content": "...", "cache": true },
    { "path": ".planning/requirements.md", "content": "...", "cache": true }
  ],
  "total_bytes": 42301,
  "sha": "0632f5e0399f582d"
}
```

The `sha` is a stable 16-char prefix over file path + content, used for cache hit debugging.

---

### `codebase estimate-size [--threshold N] [--no-docs]`

Estimate total token size of a repository for single-shot vs sharded `/pan:map-codebase` mode selection.

**Module:** `codebase.cjs`

```
pan-tools codebase estimate-size [--threshold 700000] [--no-docs] [--raw]
```

**Flags:**
- `--threshold N` — custom single-shot ceiling in tokens (default 700000).
- `--no-docs` — skip `docs/*.md` top-level files in the estimate.

**JSON output:**
```json
{
  "total_bytes": 1872704,
  "total_tokens": 468176,
  "threshold": 700000,
  "mode": "single-shot",
  "file_count": 111,
  "languages": { "javascript": 1170060, "python": 18398, "docs": 684246 }
}
```

`mode` is `single-shot` when `total_tokens ≤ threshold`, else `sharded`.

---

### `focus classify-stages [--stdin]`

Classify a focus-exec batch into parallel-tool-use waves + a `parallelism_hint` string. Used by `/pan:focus-exec` Stage 3.0 to decide whether to emit Reads/Greps in parallel.

**Module:** `focus.cjs`

```
pan-tools focus classify-stages [--stdin] [--raw]
```

**Flags:**
- `--stdin` — read items JSON from stdin instead of the latest batch file.

**JSON output:**
```json
{
  "waves": [
    [ {"id": "A", "tier": "MICRO"}, {"id": "B", "tier": "MICRO"} ],
    [ {"id": "C", "tier": "STANDARD"} ]
  ],
  "parallelism_hint": "emit-micro-in-parallel"
}
```

Hint values: `emit-micro-in-parallel`, `emit-standard-in-parallel`, `sequential`.

---

### `focus reflection`

Emit a reflection prompt (for thinking-capable models) between focus-auto cycles. Reads `{run, cycle, batch, tier}` from stdin.

**Module:** `focus.cjs`

```
echo '{"run": {...}, "cycle": {...}, "batch": [...], "tier": "reasoning"}' \
  | pan-tools focus reflection [--raw]
```

**JSON output:**
```json
{ "reflect": true, "prompt": "Reflect before cycle 2 of 5 ...", "reason": "ok" }
```

Returns `{reflect: false}` when the current tier doesn't support thinking, when `run.reflection_enabled: false`, or when the next batch is empty.

---

## 21. Codebase Commands

For `codebase estimate-size`, see Section 20.1 (Opus 4.7 Commands) — it's the mode-selection entry point for `/pan:map-codebase` Stage 0.

### `codebase detect-languages`

Detect programming languages used in a codebase via extension mapping and manifest scanning.

**Module:** `codebase.cjs`

```
pan-tools codebase detect-languages [--raw]
```

**JSON output:**
```json
{
  "primary": "javascript",
  "secondary": ["python"],
  "files_by_language": {"javascript": ["src/index.js", "src/utils.js"], "python": ["scripts/deploy.py"]},
  "file_count": 3
}
```

### `codebase analyze-imports`

Build a dependency graph from import analysis with circular dependency detection.

**Module:** `codebase.cjs`

```
pan-tools codebase analyze-imports [--raw]
```

**JSON output:**
```json
{
  "language": "javascript",
  "modules": 12,
  "imports": 18,
  "circular_deps": [],
  "entry_points": ["src/index.js"],
  "orphan_modules": ["src/unused.js"],
  "dependency_graph": "graph LR\n    N0[index] --> N1[utils]"
}
```

### `codebase best-practices`

Detect best practices across 5 categories: Error Handling, Testing, Naming Conventions, Security, Performance.

**Module:** `codebase.cjs`

```
pan-tools codebase best-practices [--raw]
```

**JSON output:**
```json
{
  "categories": [
    {"name": "Error Handling", "score": 7, "detected_patterns": ["try-catch ratio: 35%"], "recommendations": []},
    {"name": "Testing", "score": 8, "detected_patterns": ["12 test files found", "Test config present"], "recommendations": []}
  ],
  "score": 6.4,
  "recommendations": ["Add .env to .gitignore"]
}
```

---

## 22. Spec B v2 Commands (v3.0-v3.4)

Commands added across the five Spec B v2 waves. See [ADR-0024](decisions/ADR-0024-spec-b-v2-completion.md) for the design rationale. All modules are runtime-agnostic; agent quality varies by model capability.

### `cost report [--format json|table|chart]` (v3.0, Y-6)

Aggregate per-call cost across all PAN invocations in the project.

**Module:** `cost.cjs`

```
pan-tools cost report [--format json|table|chart] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
```

Reads `.planning/metrics/tokens.jsonl` (append-only log — populated automatically since v3.4 by the `pan-cost-logger` SubagentStop hook, and manually via `cost append`). Aggregates by agent / command / tier / day, computes cache hit rate, and surfaces an overall USD estimate with the default rate table or `cost.rates` overrides.

Three formats:
- `json` (default) — machine-readable, full payload
- `table` — aligned columns with section-by-section breakdown
- `chart` — ASCII bar chart of per-day cost

### `cost append --model X --input-tokens N --output-tokens N ...` (v3.0, Y-6)

Manually append a cost record. Used by explicit callers; the hook path handles automatic capture.

```
pan-tools cost append \
  [--agent <name>] [--command <name>] [--model <id>] [--tier reasoning|mid|fast] \
  [--input-tokens N] [--output-tokens N] \
  [--cache-read-tokens N] [--cache-write-tokens N] \
  [--phase <num>] [--session <id>]
```

Missing fields default to `null` or `0`. Cost is auto-computed when `model` or `tier` resolves to a known rate.

### `cost clear` (v3.0, Y-6)

Delete the cost log. Useful at the start of a billing cycle.

### `models check` (v3.9)

Report whether the built-in model rate table is stale.

**Module:** `cost.cjs`

```
pan-tools models check [--raw]
```

Returns `{rates_verified_at, age_days, stale_after_days, stale, models, tiers}`. The rate table carries the date it was last verified against published provider pricing; `stale` flips to `true` once that date is older than the threshold (roughly half a year). When stale, re-verify provider pricing, update `DEFAULT_RATES`, and bump `RATES_VERIFIED_AT` in `cost.cjs`. `--raw` prints a one-line human summary instead of JSON.

### `bus publish <channel> <payload> [--source <name>]` (v3.0, Y-7)

Append a message to a file-backed channel at `.planning/bus/<channel>.jsonl`.

**Module:** `bus.cjs`

Channel and source names validated against `^[a-zA-Z0-9_-]+$` (path-traversal safe). Payload is any JSON-serializable value; if not valid JSON, stored as a raw string.

### `bus drain <channel> [--mode peek|consume|archive] [--limit N] [--offset N]` (v3.0, Y-7)

Read messages from a channel.

- `peek` (default) — non-destructive read
- `consume` — read + truncate file to zero bytes
- `archive` — read + rename file to `<channel>-<timestamp>.archive.jsonl`

### `bus list` (v3.0, Y-7)

List all channels with message counts + byte sizes + active/archive flag.

### `preview phase <N>` (v3.1, Y-1)

Blast-radius analysis for a single phase.

**Module:** `preview.cjs`

```
pan-tools preview phase <N> [--raw]
```

Returns `{phase, status, plans, files_mentioned, test_files_mentioned, risk_signals, risk_score, goal}`. Risk keywords checked: drop / delete / migrate / rename / breaking / auth. Score 1-10.

### `preview phases` (v3.1, Y-1)

Cross-phase dependency graph with mermaid source + Kahn-style parallel batches + hidden-coupling detection.

### `preview milestone` (v3.1, Y-1)

Milestone completion ETA with velocity + confidence + bottleneck identification.

### `review-deep merge <phase> --reviewer-file X --hardener-file Y [--meta-file Z]` (v3.2, Y-2)

Merge reviewer + hardener + meta-reviewer findings into a consolidated `.planning/reviews/<phase>/deep-review.md` with verdict ladder (ok < ok_with_minor < fix_before_merge < review_required < block).

**Module:** `review-deep.cjs`

Publishes an audit entry to the `review-handoff` bus channel via `bus.cjs`.

### `review-deep analyze <phase> ...` (v3.2, Y-2)

Same merge logic as above but returns the payload without writing a file. Useful for piping.

### `knowledge ask <question> [--max-sources N]` (v3.2, Y-3)

Retrieve candidate source files for a natural-language question, scored by keyword frequency across `CITATION_ROOTS` (`.planning/` + `docs/` + top-level `README/CHANGELOG/CLAUDE.md`).

**Module:** `knowledge.cjs`

```
pan-tools knowledge ask "why does phase 4 have a race condition fix?"
```

Returns `{question, sources: [{file, score, bytes}], total_candidates, returned}`. Always includes `project.md` + `requirements.md` even when they score zero.

### `knowledge discuss <phase> --subcmd read|append ...` (v3.2, Y-3)

Multi-turn session state at `.planning/conversations/<phase>/session.json`.

- `--subcmd read` — load current session (empty if new)
- `--subcmd append --role user|agent --content "..." [--cites a,b]` — append a turn

### `knowledge playbook [--preview]` (v3.2, Y-3)

Cluster all agents' memory (`.planning/memory/*.md`) into a categorized `.planning/playbook.md` with sections: Conventions / Gotchas / Decisions / Tool choices / Anti-patterns / Recurring gaps / General.

`--preview` returns the structured payload without writing the file.

### `whatif prepare <phase> <scenario>` (v3.3, Y-4)

Creates an isolated git worktree for counterfactual phase replay. Returns `{phase, scenario, slug, worktree: {worktree_path, branch, base}}`.

**Module:** `whatif.cjs`

Requires git repo. Worktree default location: sibling of main repo, branch prefixed `pan-whatif/`.

### `whatif report <phase> <scenario> --comparison <json>` (v3.3, Y-4)

Write the counterfactual comparison report to `.planning/counterfactuals/<phase>-<slug>.md` in the main tree (not the worktree — the worktree is disposable).

Comparison JSON shape: `{summary, differences[], recommendations[], risks[], verdict}`.

### `whatif cleanup --worktree <path> --branch <name> [--force]` (v3.3, Y-4)

Remove the worktree + delete its branch. Best-effort; warnings surfaced but non-blocking.

### `bridge list` (v3.3, Y-5)

Flatten cached MCP tools from `.planning/bridge/available-tools.json` into a single list with server attribution + tool count.

**Module:** `bridge.cjs`

### `bridge recommend <phase> [--max N] [--min-score N]` (v3.3, Y-5)

Score cached MCP tools against phase plan text by keyword frequency, return top N ranked.

### `bridge cache [--servers <json>] [--runtime <name>]` (v3.3, Y-5)

Inspect or seed the MCP tool cache. Normally the host runtime writes this file; this CLI exists for test fixtures and external-script integration.

---

## 23. Self-Improvement Loop Commands

The autonomous external-build loop: scaffold an experiment folder, drive an external runtime against an idea.md, observe and harvest learnings. See ADR-0026 for design.

**Modules:** `experiment.cjs` (lifecycle), `runner.cjs` (execution).

### `experiment new <slug> --idea <path> [--root <dir>] [--runtime <name>] [--budget N] [--skip-installer]` (v3.7.0)

Scaffold a new experiment folder at `<root>/<slug>/`. Copies `<idea>` to `<root>/<slug>/.planning/idea.md`, writes the `experiment.json` manifest, and (unless `--skip-installer`) runs the PAN installer for the chosen runtime inside the experiment dir. Default root: `~/pan-experiments/`. Default runtime: `claude`. Hard `PAN_SOURCE_ROOT` guard refuses to scaffold inside the source repo.

### `experiment list [--root <dir>]` (v3.7.0)

Enumerate experiments under root with `{slug, runtime, status, created_at, path}` per entry.

### `experiment manifest <slug> [--root <dir>]` (v3.7.0)

Print the experiment's `experiment.json` manifest.

### `experiment run <slug> [--root <dir>] [--prompt <text>] [--timeout-ms N] [--capture-metrics]` (v3.7.0+)

Spawn the runtime adapter against the experiment via `spawnSync`, observe via `run-state.json`, return final status. Adapters live in `runner.cjs#RUNTIME_RUNNERS` — claude/codex/gemini/opencode supported, copilot is null. Default prompt: `/pan:new-project --auto @.planning/idea.md`. Default timeout: 30 min.

**Incomplete-run detection:** When `exit_code: 0` but `state.md` shows `status != completed`, the runner returns `stop_reason: "incomplete"` (not `success`). Distinguishes real milestone-done from premature exits.

**`--capture-metrics`:** Switches the claude adapter to `claude --output-format json`, parses the trailing usage envelope from stdout, and persists `{total_cost_usd, num_turns, session_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, billing_pool}` under `runState.metrics`. Other runtimes ignore the flag.

**Billing note (Claude runtime):** since June 15, 2026, headless `claude -p` / Agent SDK usage draws from a separate monthly **Agent SDK credit pool** on Claude subscriptions — it does not count against interactive session limits, and vice versa. Experiment runs are therefore tagged `billing_pool: "agent_sdk"` in `runState.metrics` so downstream analysis (`/pan:learn`, billing reconciliation) can separate experiment spend from interactive spend. Codex/Gemini/OpenCode runs bill per their own provider's CLI policy and carry `billing_pool: null`.

### `experiment status <slug> [--root <dir>]` (v3.7.0)

Read snapshot from `<expPath>/.planning/run-state.json`: status, started_at, ended_at, exit_code, stop_reason, elapsed_ms, events, metrics.

### `experiment stop <slug> [--root <dir>]` (v3.7.0)

Send SIGTERM to the running spawn (best-effort; falls back to recording manual stop in run-state.json if the pid is gone).

### `experiment harvest <slug> [--root <dir>] [--out <dir>]` (v3.7.0)

Copy `learnings/`, `traces/`, `run-state.json`, `agent-history.json`, `experiment.json`, and the rendered `commands/pan/`, `agents/`, references back into the harvest output dir. Non-destructive — leaves the experiment folder intact for re-runs.

### `experiment prune <slug> [--root <dir>] [--keep-harvest]` (v3.7.0)

Delete the experiment folder. With `--keep-harvest`, leave any harvested artifacts in place at the harvest output path.

### `learn promote --pattern <id> --scope <s> --topic <t> [--summary] [--evidence] [--rule] [--applies-in] [--source-experiments csv]`

Append a promoted pattern into `pan-wizard-core/learnings/{scope}/{topic}.md`. Scope is `universal` (ships to installs) or `internal` (source-only, stripped at install). Refuses duplicate IDs within the same topic file. When `--scope universal` is used, classifies the rule via `classifyPatternKind()` and attaches a `warning` to the result if the rule looks prompt-fragment-shaped (per P-RES-007). Returns `{promoted_to, pattern_id, scope, topic, promoted_at, warning?}`.

### `learn unpromote --pattern <id> --scope <s> --topic <t>`

Remove a previously promoted pattern from a topic file. Used to undo a bad promote.

### `learn list-promoted`

Walk both scopes; return inventory `{universal: [...], internal: [...], total}` with id/topic/source_experiments per pattern.

### `learn lint [--scope universal|internal] [--strict]`

Validate the learnings store integrity. Checks: L-001 duplicate IDs across files, L-002 dangling pattern cross-references, L-003 empty `source_experiments` while body cites a known experiment name, L-004 universal-scope rule prose using PAN-internal terms, L-005 revision marker (`-rN`) without `superseded_by` frontmatter on the base. Exits non-zero on errors; warnings are advisory unless `--strict`. Wired into `/check`. Module: `learn-lint.cjs`.

### `learn build-index`

Generate `pan-wizard-core/learnings/index.json` with topic→agent-relevance map, byte/token-est sizes, and pattern lists. Curated `RELEVANCE` table assigns `high|medium|low` per `(topic, agent_role)` for `planner / executor / verifier / reviewer`. Read by `topics-for`. Module: `learn-index.cjs`.

### `learn topics-for --agent <role> [--min-relevance high|medium|low] [--token-budget N]`

Query the index for topics relevant to an agent role within a token budget. Returns `{selected: [...], dropped: [...], total_tokens}`. Used by workflow files (`plan-phase.md`, `exec-phase.md`, `verify-phase.md`, `execute-plan.md`) to load only relevant patterns instead of skim-the-folder — addresses the P-RES-002 distractor-density anti-pattern. Default budget 5000 tokens, default min-relevance medium.

---

## 24. Doc-Lint Commands

Markdown frontmatter + structure linter, vendored from the whooo experiment. Validates PAN-shipped markdown against schemas in `pan-wizard-core/references/schemas/`.

**Module:** `doc-lint.cjs` (adapter) + `pan-wizard-core/bin/lib/doc-lint/{frontmatter,schema,validate,walk,reporter}.js`.

### `doc-lint <dir> [--schema <name>] [--format human|json]` (v3.7.1)

Walk `<dir>` for `.md` files, validate each against the named schema (default: `pan-command` for files under `commands/pan/`). Reports violations: missing required frontmatter fields, schema-type mismatches, structural issues. JSON output suitable for CI gates; human output for terminal review.

### `doc-lint schema-check [--schemas-dir <path>]` (v3.7.1)

Verify the YAML schemas themselves are syntactically valid before they're used to lint anything. Schemas live at `pan-wizard-core/references/schemas/*.schema.yml`.

---

## 25. Skill-Aligned Decomposition Commands

SAD pass (ADR-0038, spec `docs/specs/skill-aligned-decomposition.md`): the planner drafts its task list, retrieves the skills (commands, templates, references, learnings topics) that loosely match each task, and realigns wording/granularity to what actually exists — SkillWeaver's decompose→retrieve→realign loop, keyword-scored, zero dependencies.

**Module:** `skill-align.cjs`

### `skills index [--source-root <path>]` (v3.13, ADR-0038)

Build (on the fly — nothing persisted) and print the skill index: `commands/pan/*.md`, `pan-wizard-core/templates/**` (recursive), `pan-wizard-core/references/*.md`, plus learnings topics via `learn-index.cjs`. Returns `{entries, total, by_kind, skipped_roots}`. Missing roots are skipped and reported, never thrown — partial installs and non-Claude runtime layouts degrade gracefully. Default root is the install root (resolved relative to the module); `--source-root` exists for tests.

```
pan-tools skills index --raw
```

### `skills align (--draft "<text>" | --draft-file <path>) [--top <k>] [--min-score <n>] [--token-budget <n>] [--source-root <path>]` (v3.13, ADR-0038)

Score each draft task (bullets/numbered/checkbox lines all accepted) against the skill index using `scoreRelevance`, after stripping planning glue words from the cue. Returns per-task top-k matches (names only), `coverage`, and a deduplicated `vocabulary` hint list ranked by aggregate score and greedy-packed into the token budget (default 1500) — overflow lands in `dropped`, never silently truncated. Errors as `{error}` JSON on empty drafts or more than 50 tasks.

```
pan-tools skills align --draft-file /tmp/draft-tasks.md --raw
```

Advisory and fail-open by design: no orchestrator step or checker dimension depends on it, and `pan-planner`'s `skill_alignment` step skips on any error.

---

## 26. Hygiene Commands

Project cleanup + version alignment (see `docs/FIELD-HARVEST-2026-07.md` follow-ups). Keeps a PAN-managed project aligned with the latest PAN version and free of accumulated history debris.

**Module:** `hygiene.cjs`

### `hygiene scan [--trace-age-days N]` (v3.13)

Read-only findings report. Checks: per-runtime `pan-file-manifest.json` version vs the latest seen (including the executing core's own version); untracked installs (`pan-wizard-core` without a manifest); legacy uppercase planning filenames (pre-v2.2); orphaned atomic-write `.tmp` files older than 1h; per-agent memory logs past the compaction cap; cost ledgers ≥50% suspect records (v3.12.4 `isSuspectRecord`, min 20 records); trace sessions older than retention (default 30d, newest 5 always kept); fragment `.planning/` dirs with no workflow spine (phase, focus, and orchestration layouts all count as spines). Returns `{findings, installs, latest_version, summary}` — each finding has `check`, `severity` (`critical|warn|info`), `path`, `detail`, `fixable`.

```
pan-tools hygiene scan --raw
```

### `hygiene clean [--apply] [--trace-age-days N]` (v3.13)

Dry-run by default (lists what would change); `--apply` executes the safe subset: two-step case-hop renames of legacy filenames, `.tmp` orphan deletion, memory-log compaction (`compactMemory`), poisoned-ledger **quarantine-by-rename** (`tokens.jsonl.quarantined-<date>` — content never deleted), and stale-trace pruning. Version drift (remediation = re-run the installer) and fragment dirs (manual review) are never auto-fixed. Returns `{dry_run, applied, skipped, summary}`.

```
pan-tools hygiene clean --apply --raw
```

Wrapped by the `/pan:hygiene` command: scan → present by severity → confirm → clean → re-scan.
