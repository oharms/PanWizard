# featureAI: Cross-Project Self-Improvement Loop — Idea → External Build → Learn → Promote → Ship

> **Generated**: 2026-04-27
> **Mode**: `--full` (all phases)
> **Feature**: `/pan:experiment` family — autonomous external builds drive PAN's own evolution
> **Target version**: v3.7.0 (XL feature, ships across 3-4 waves)
> **Predecessors**: focus_auto_runner_featureai.md (autonomous loop), googlecli_adoption_featureai.md (behavioral guardrails layer), Session 33 Playwright VSCode integration patterns
> **Status**: design — awaiting acceptance

---

## Phase 0: Problem Framing & Demand

### 0.1 Problem Statement

PAN Wizard ships v3.5+ with a **self-learning system inside a project** — `pan-trace-logger` captures every agent spawn, `/pan:learn` analyzes the session via `pan-optimizer`, `/pan:optimize apply` writes back to that project's `.planning/memory/`. The loop is closed *for one project at a time*.

The PAN tool itself does not learn from this. Each PAN release ships frozen behavioral rules (`references/guardrails.md`, workflow text, agent instructions). Real-world session data — the gold mine of "what actually goes wrong when AI agents drive PAN" — stays trapped in user projects' `.planning/optimization/` directories. We dogfood PAN on PAN itself (`d:\PanWizard\.planning/`), but those learnings are **per-session memory**, not part of the shipped product. The next release of PAN does not know what the previous release's sessions discovered.

This matters NOW because:

- v3.5 just shipped the trace + learn + optimize trio. The pieces exist. What's missing is the **promote step** that lifts findings from one session's memory into shipped artifacts.
- v3.6 (just shipped) added `references/guardrails.md` — a human-authored behavioral file consumed by every workflow. This proves the *delivery channel* for shipped behavioral content. We need only build the *production channel* (AI-derived patterns that flow into shipped files).
- The MEMORY note "Cross-Session Learning (PATTERNS.md auto-capture)" was deferred for exactly this reason: needs a design spec. This is that spec.
- Real-world AI coding tooling (Cursor Background Agents, Aider's MCP integrations, Claude Code's Skills) is converging on session telemetry as a product feedback loop. PAN's existing trace infrastructure is unique among workflow tools; not closing the meta-loop wastes the lead.

**The cost of not building this:** PAN's quality plateau is gated by what its maintainers can hand-author into `references/`, `workflows/`, and agent instructions. Every session's lessons stay local. PAN's improvement velocity is bounded by maintainer attention, not by accumulated session evidence.

### 0.2 Demand Evidence

| Evidence | Source | Finding |
|----------|--------|---------|
| **User-stated explicit request** | This conversation | "design into pan a system whereby we build and then call learn and then we bring the file back to optimise PAN" |
| **MEMORY note** | `MEMORY.md` "Known Deferred Items" | "Cross-Session Learning (PATTERNS.md auto-capture): L effort, needs design spec" |
| **Existing infrastructure** | `optimize.cjs`, `pan-optimizer.md`, `pan-trace-logger.js`, `/pan:learn`, `/pan:optimize` | Trace + analyze + apply already work intra-project. Promote + ship are the missing ~30% |
| **Existing delivery channel** | `references/guardrails.md` shipped in v3.6.0 to all 5 runtimes | Proves AI-readable shipped reference docs work; same path serves AI-derived patterns |
| **Existing process automation** | `tests/scenarios/*.test.cjs` already spawn fresh installs in temp dirs via `createScenarioRunner` | Cross-process orchestration is a known-cost operation in this codebase |
| **Existing VSCode automation** | `tests/e2e/playwright.config.mjs`, `tests/e2e/vscode-helpers.mjs` (Session 33) | Precedent for driving VSCode programmatically — though the simpler `claude` CLI subprocess path covers the autonomous use case |
| **Industry convergence** | Cursor Background Agents, Aider --watch-files, Copilot Coding Agent | Autonomous external project execution is a 2026 standard; PAN's gap is closing the *learning* side, not just the execution side |

**Demand status:** STRONG — direct user request + deferred-with-design-spec marker + the prerequisite infrastructure is all in place.

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Idea-input format (`idea.md` schema) PAN can consume as a Phase-0 spec | Multi-stakeholder idea collection workflow — single user, single idea, single experiment |
| Experiment scaffolding: create isolated project folder outside source repo with `.planning/` and idea doc | Experiments inside the source repo — installer guard already prohibits self-install; same logic applies |
| External AI agent invocation via subprocess (`claude -p`, `codex`, `gemini`, `opencode`) | VSCode UI automation as the *primary* path — adds Playwright dependency to the runtime; reserve as advanced opt-in |
| Stream observation: tail external project's `state.md`, `current-agent-id.txt`, summary files; surface progress in PAN session | Bidirectional control — external agent runs autonomously; PAN observes but doesn't intervene mid-build (cleaner failure semantics) |
| Telemetry harvest: copy `.planning/optimization/`, `agent-history.json`, traces back to PAN source as `experiments/<id>/` | Cross-experiment aggregation — one experiment, one harvest; aggregation is a separate v3.8+ feature |
| `/pan:learn --experiment <id>` runs `pan-optimizer` against harvested data | Re-running pan-optimizer continuously during the experiment — single post-build analysis is sufficient |
| `pan-tools learn promote --pattern <id> --scope <universal\|internal>` writes findings to `pan-wizard-core/learnings/` | Auto-promote (no human review) — risky; manual review step is the v3.7 design; auto-promote is a v3.8 ramp |
| Two-tier output: `learnings/universal/` (shipped to all installs) vs `learnings/internal/` (PAN-source-only) | Three or more tiers — universal/internal binary is sufficient |
| Workflows reference `learnings/universal/*.md` like they reference `references/*.md` | New runtime adapter logic — `learnings/` ships via the same glob that ships `references/` |
| Budget cap + timeout + circuit breaker on external runs (inherits focus-auto pattern) | Cost-tracking integration — `cost.cjs` already records spend; cross-experiment cost analysis is v3.8 |
| Tests: scenario coverage for the experiment lifecycle (init → run → harvest → promote) | Integration test that drives a real Claude Code subprocess — too slow for CI; mocked subprocess is sufficient |

### 0.4 Success Criteria (Measurable)

```
SC-1:  /pan:experiment new <slug> --idea <file> creates an isolated experiment folder OUTSIDE the source repo with .planning/ and idea.md
SC-2:  /pan:experiment run <id> spawns an external AI agent (Claude/Codex/Gemini/OpenCode) pointed at the experiment folder
SC-3:  Experiment runner streams progress back to PAN session (state.md changes, summary.md appearances)
SC-4:  Loop stops on ANY of: build success (final summary written), budget exhausted, timeout, circuit breaker (3 consecutive task failures)
SC-5:  /pan:experiment harvest <id> copies .planning/optimization/ + agent-history.json + state.md from experiment folder back to d:\PanWizard\experiments\<id>\
SC-6:  /pan:learn --experiment <id> runs pan-optimizer over harvested data, writes report to experiments/<id>/learnings/report-*.md
SC-7:  pan-tools learn promote --pattern <id> --scope universal extracts a finding to pan-wizard-core/learnings/universal/<topic>.md
SC-8:  pan-tools learn promote --pattern <id> --scope internal extracts a finding to pan-wizard-core/learnings/internal/<topic>.md (NOT shipped to user installs)
SC-9:  Workflows reference learnings/universal/*.md the same way they reference references/*.md (already proven in v3.6.0)
SC-10: Installer ships pan-wizard-core/learnings/universal/ to all 5 runtimes; learnings/internal/ stays in source only
SC-11: Tests: 30+ new tests across experiment.test.cjs, learn-promote.test.cjs, scenarios/learnings-installed.test.cjs
SC-12: Zero regressions in existing 2588 tests
SC-13: A complete loop (idea.md → experiment run → harvest → learn → promote → re-install verifies pattern shipped) executes end-to-end in < 10 minutes for a trivial idea
SC-14: Spec works regardless of which runtime drives the external project (Claude/Codex/Gemini/OpenCode); GitHub Copilot CLI is opt-in (no headless mode)
```

### 0.5 User Stories

```
As a PAN maintainer with an idea for a small CLI tool,
I want to /pan:experiment new my-idea --idea my-idea.md, run it externally,
have it produce a real working project AND telemetry on every PAN-driven decision,
and then /pan:learn promote the most-cited findings into PAN's shipped behavioral docs,
so that the next PAN release literally got smarter from this build,
instead of having to manually transcribe lessons from .planning/optimization/ into references/guardrails.md.

As a PAN maintainer reviewing a fresh experiment harvest,
I want a clear universal-vs-internal scope decision per finding,
so that PAN-specific quirks (e.g., "always commit individually" because of the source repo's hooks)
don't pollute generalizable patterns shipped to user installs,
instead of relying on judgment under deadline.

As a PAN maintainer running 5 experiments overnight on different ideas,
I want each experiment isolated in its own folder, with its own budget cap,
and a single command (/pan:experiment harvest --all) to bring telemetry back the next morning,
so that overnight automation is trustworthy,
instead of waking up to a runaway external process or merged-state corruption.

As a PAN user (downstream consumer),
I want PAN's shipped behavioral docs to evolve based on actual usage signals,
so that recurring AI failure modes get codified as guardrails before they bite me,
instead of running into the same shortcut shortcut my teammates already encountered last quarter.
```

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Pieces (already shipped)

The 70% that exists:

| Capability | Module / file | Notes |
|------------|---------------|-------|
| Per-session trace logging | `hooks/pan-trace-logger.js` (5th hook, SubagentStop) | Auto-creates day-scoped sessions, logs `decision:agent_completion` events |
| Trace storage | `pan-wizard-core/bin/lib/optimize.cjs` `getOptimizeDir()` | `.planning/optimization/traces/sess_<id>/` |
| Pattern analysis | `pan-wizard-core/bin/lib/optimize.cjs` `analyzeEvents()` | Frequency maps, agent stats, error rates, redundancy detection |
| Report generation | `pan-wizard-core/bin/lib/optimize.cjs` `generateLocalReport()` + `pan-optimizer` agent | Structured findings with `## Auto-Apply Actions` JSON block |
| Apply reports | `pan-wizard-core/bin/lib/optimize.cjs` `applyReportRecommendations()` | Writes to `.planning/memory/`, project config |
| `/pan:learn` command | `commands/pan/learn.md` + `pan-wizard-core/workflows/learn.md` | Invokes pan-optimizer, shows score |
| `/pan:optimize` command | `commands/pan/optimize.md` + `optimize.cjs` cmd functions | trace init/end/status/list, learn, apply, list, stats |
| Behavioral content delivery | `pan-wizard-core/references/*.md` (14 files), workflow cross-references | Proven channel for AI-readable shipped content (v3.6.0) |
| External-process orchestration | `tests/helpers.cjs` `createScenarioRunner()` | Spawns fresh installer in temp dir, returns runner with `run()` + `cleanup()` |
| VSCode-specific automation | `tests/e2e/vscode-helpers.mjs` (Session 33) | Playwright + @vscode/test-electron — exists but unnecessary for autonomous CLI runs |
| Budget + circuit-breaker pattern | `pan-wizard-core/bin/lib/focus.cjs` (focus-auto) | Triple safety: per-cycle budget + cumulative cap + max cycles + zero-progress halt |

### 1.2 Missing Pieces (the 30% to build)

| Gap | Module / artifact | Effort |
|-----|------------------|--------|
| Experiment lifecycle data | `pan-wizard-core/bin/lib/experiment.cjs` (28th core module) | M (4 pts) |
| Experiment commands | `commands/pan/experiment.md` (52nd command) | S (2 pts) |
| External agent runner | `pan-wizard-core/bin/lib/runner.cjs` (29th core module) — subprocess invocation, output streaming | M (4 pts) |
| Idea-doc schema | `pan-wizard-core/templates/idea.md` (27th template) | XS (1 pt) |
| Harvest logic | `experiment.cjs` `harvestExperiment()` | S (2 pts) |
| `pan-experiment-runner` agent | `agents/pan-experiment-runner.md` (21st agent) — drives the external instance | M (4 pts) |
| Promote logic | `pan-wizard-core/bin/lib/optimize.cjs` `promotePattern()` | M (4 pts) |
| Two-tier learnings dir | `pan-wizard-core/learnings/universal/` and `pan-wizard-core/learnings/internal/` | XS (1 pt) |
| Installer ships `learnings/universal/` only | `bin/install.js` (verify glob; likely already covers any new top-level dir under pan-wizard-core/) | XS (1 pt) |
| Workflow re-references | exec-phase, plan-phase, focus-exec workflows reference `learnings/universal/` | S (2 pts) |
| Tests | `experiment.test.cjs`, `runner.test.cjs`, `learn-promote.test.cjs`, `scenarios/learnings-installed.test.cjs` | M-L (10-15 pts) |
| Documentation | USER-GUIDE, ARCHITECTURE updates + ADR-0026 | S (2 pts) |

**Total estimated effort:** ~30-40 pts. XL feature; ships across 3-4 sessions/waves.

### 1.3 Architectural Constraints

| Constraint | Source | Impact |
|------------|--------|--------|
| Source repo never receives a PAN install | CLAUDE.md "Self-Protection Gate" | Experiments MUST live outside `d:\PanWizard\` |
| Manifest tracks every shipped file | Existing v3.5+ behavior | New `learnings/universal/*.md` files appear in manifest checksum |
| 5-runtime parity is mandatory | CLAUDE.md "5 Target Runtimes" | Shipped learnings install identically to all 5 runtime dirs |
| Zero runtime deps | Existing project rule | Subprocess invocation uses `child_process.spawn` (Node built-in) — no new packages |
| Behavioral content is markdown + frontmatter | `references/`, `workflows/`, `agents/` patterns | `learnings/universal/*.md` follows the same shape |

### 1.4 Cross-Runtime Compatibility

| Runtime | External invocation | Headless support | Notes |
|---------|---------------------|-------------------|-------|
| Claude Code | `claude -p "<prompt>"` or via Skills/MCP | ✅ headless via `-p` flag | Primary target |
| Codex CLI | `codex exec "<prompt>"` (or similar) | ✅ | Verify exact flag in Codex docs at implementation time |
| Gemini CLI | `gemini -p "<prompt>"` | ✅ | Verify flag |
| OpenCode | `opencode "<prompt>"` | ✅ | Verify flag |
| GitHub Copilot CLI | (no general-purpose subprocess prompt mode known) | ❌ | Opt-out for now; document limitation |

The runner module abstracts these via a per-runtime adapter pattern (similar to existing installer adapters). Configuration: `pan-tools experiment run <id> --runtime claude` (defaults to the runtime PAN was installed for).

---

## Phase 2: Source Pattern Analysis

### 2.1 Patterns Adopted

**From `focus.cjs` (focus-auto runner — Session 26):**
- Triple safety net: per-cycle budget + cumulative budget + max cycles + zero-progress circuit breaker
- Run state in `.planning/focus/auto-run.json` — cross-session resumability via `--continue`
- `determineStopReason()` enumerated stop reasons returned in JSON

The experiment runner inherits all of these. State file: `.planning/experiments/<id>/run-state.json`.

**From `optimize.cjs` (circular optimization loop — Session 31):**
- Trace session lifecycle (`initTraceSession`, `logTraceEvent`, `endTraceSession`)
- Local analysis (`analyzeEvents`) producing structured findings
- Auto-apply JSON block at the end of optimizer reports
- `applyReportRecommendations()` for surgical writes

The promote step extends the apply pattern: instead of writing to `.planning/memory/` (intra-project), it writes to `pan-wizard-core/learnings/{universal,internal}/<topic>.md` (source repo, shippable on next release).

**From `tests/helpers.cjs` (`createScenarioRunner` — Session 18):**
- `child_process.execSync` invocation pattern
- Temp dir lifecycle (`mkdtempSync` + `rmSync` cleanup)
- Per-runtime adapter via `RUNTIME_DIR` map

The runner module generalizes this from "install + run command" to "scaffold + drive autonomous build."

**From v3.6.0 (`references/guardrails.md` shipped to 5 runtimes):**
- Single-file behavioral content shipped via `references/` directory
- Workflows reference by relative path
- All 5 runtimes get the file through existing installer glob

The `learnings/universal/` directory mirrors this pattern exactly — same delivery channel, AI-derived rather than human-authored content.

### 2.2 Patterns Explicitly NOT Adopted

- **Auto-promote without human review.** Risky in v3.7. The promote step is gated on a human pressing the trigger (`pan-tools learn promote --pattern <id>`). Auto-promote ramps in v3.8+ once we have N=10+ successful manual promotes to learn the filter.
- **VSCode UI automation as primary path.** Playwright + @vscode/test-electron infrastructure exists (Session 33), but using it for autonomous external runs adds: (a) GUI dependency, (b) headless display setup, (c) cross-platform display drivers. CLI subprocess is sufficient for the autonomous case. VSCode UI automation stays for testing purposes.
- **Bidirectional control mid-run.** External agent runs autonomously; PAN observes via file-tail, doesn't inject prompts. Cleaner failure semantics — if the external agent gets stuck, the timeout/circuit-breaker fires; PAN doesn't try to "save" it. Rationale: every intervention path is a new bug surface.
- **Multi-experiment aggregation.** v3.7 ships single-experiment promote. Aggregation across N experiments is v3.8 — needs more design (which findings are universal vs idiosyncratic to N specific experiments?).

---

## Phase 3: Design

### 3.1 Architecture Overview

```
                         PAN source repo (d:\PanWizard\)
                         ──────────────────────────────────
       1. /pan:experiment new my-idea
            ↓
       2. Creates  D:\pan-experiments\my-idea\
                       ├── .planning/
                       │     ├── state.md
                       │     ├── idea.md         ← from --idea <file>
                       │     └── ...
                       └── (PAN install for chosen runtime)

       3. /pan:experiment run my-idea --runtime claude
            ↓
       runner.cjs spawns:  claude -p "/pan:new-project --auto @idea.md"
            ↓
       External Claude Code session runs autonomously inside the experiment folder.
       Builds the idea using the same PAN workflows we just shipped (with guardrails!)

       4. Trace logger inside experiment captures every agent spawn.
          PAN session tails experiment's state.md / agent-history.json / summaries.

       5. /pan:experiment harvest my-idea
            ↓
       Copies experiment's .planning/optimization/, agent-history.json,
       state.md, summary files BACK to source repo:
          d:\PanWizard\experiments\my-idea\
                                  ├── traces/
                                  ├── reports/
                                  └── snapshot/

       6. /pan:learn --experiment my-idea
            ↓
       pan-optimizer (existing agent) reads experiments/my-idea/, generates:
          experiments/my-idea/learnings/report-<timestamp>.md
       with ## Findings + ## Auto-Apply Actions JSON

       7. pan-tools learn promote --pattern <id> --scope universal
            ↓
       Extracts the finding into:
          pan-wizard-core/learnings/universal/<topic>.md

       8. /pan:check  →  npm test  →  git commit  →  v3.7.x release
            ↓
       Next user install gets the finding shipped under
          .claude/pan-wizard-core/learnings/universal/<topic>.md
       Workflows already reference learnings/universal/ — auto-loaded.
```

### 3.2 Module Plan

#### `pan-wizard-core/bin/lib/experiment.cjs` (new — 28th module)

```js
// Pure-ish functions. Side effects only at write boundaries.

const PAN_EXPERIMENTS_ROOT_DEFAULT = path.join(os.homedir(), 'pan-experiments');
// Configurable via .planning/config.json `experiments_root`

function newExperiment(slug, opts) {
  // opts: { ideaPath, runtime, root, budget }
  // 1. Validate slug (lowercase, hyphens, max 40 chars)
  // 2. Compute path: <root>/<slug>
  // 3. Refuse if path exists (no clobber)
  // 4. Refuse if path is inside source repo (PAN_SOURCE_ROOT guard)
  // 5. mkdir, copy idea.md to <path>/.planning/idea.md (or write template)
  // 6. Run installer: node <source>/bin/install.js --<runtime> --local at <path>
  // 7. Write <path>/.planning/experiments/<id>/manifest.json with metadata
  // 8. Return { experiment_id, path, runtime, idea_path, created_at }
}

function listExperiments(opts) {
  // List all experiments under root, with status, runtime, created_at
}

function getExperimentManifest(slug, opts) {
  // Read <root>/<slug>/.planning/experiments/<slug>/manifest.json
}

function harvestExperiment(slug, opts) {
  // 1. Locate experiment path
  // 2. Source: <experiment>/.planning/optimization/, agent-history.json, state.md, phases/
  // 3. Destination: d:\PanWizard\experiments\<slug>\
  // 4. Copy with directory structure preserved
  // 5. Write harvest manifest with timestamp + size + checksum
  // 6. Return { harvested_files, total_bytes, harvest_path }
}

function pruneExperiment(slug, opts) {
  // After harvest + promote, optionally delete the experiment folder
  // Soft delete: rename to <slug>-archived-<timestamp>
}

module.exports = {
  newExperiment, listExperiments, getExperimentManifest,
  harvestExperiment, pruneExperiment,
  PAN_EXPERIMENTS_ROOT_DEFAULT,
};
```

#### `pan-wizard-core/bin/lib/runner.cjs` (new — 29th module)

```js
// External agent subprocess orchestration.
// Per-runtime adapter pattern.

const RUNTIME_RUNNERS = {
  claude:   { bin: 'claude',   args: (prompt) => ['-p', prompt] },
  codex:    { bin: 'codex',    args: (prompt) => ['exec', prompt] },
  gemini:   { bin: 'gemini',   args: (prompt) => ['-p', prompt] },
  opencode: { bin: 'opencode', args: (prompt) => [prompt] },
  copilot:  null, // unsupported (no headless prompt mode)
};

function runExperiment(slug, opts) {
  // opts: { runtime, prompt, timeout, budget, onProgress }
  // 1. Validate runtime support
  // 2. Build command args
  // 3. spawn child_process.spawn() in experiment dir
  // 4. Stream stdout/stderr via opts.onProgress callback (line-buffered)
  // 5. Watch experiment's .planning/state.md / agent-history.json for status
  // 6. Enforce timeout
  // 7. Enforce circuit breaker (3 consecutive task failures)
  // 8. Persist run-state.json after every status change
  // 9. Return { exit_code, status, elapsed_ms, summaries_count, stop_reason }
}

function tailExperimentState(slug, opts) {
  // File-watcher loop on state.md, agent-history.json
  // Emits `state_change`, `agent_spawned`, `agent_completed`, `summary_written` events
  // Used by runExperiment internally; also exposed for monitoring without re-running
}

function stopExperiment(slug) {
  // Read PID from run-state.json, send SIGTERM, fall back to SIGKILL
}

module.exports = { runExperiment, tailExperimentState, stopExperiment, RUNTIME_RUNNERS };
```

#### `pan-wizard-core/bin/lib/optimize.cjs` (extend existing — add `promotePattern`)

```js
// New export, alongside existing analyzeEvents, generateLocalReport, etc.

function promotePattern(reportPath, patternId, opts) {
  // opts: { scope: 'universal'|'internal', topic: string, sourceRoot: string }
  // 1. Read report file, extract the named pattern from ## Findings
  // 2. Validate pattern has: id, summary, evidence (>= 1 trace event), proposed_rule
  // 3. Compute output path:
  //    universal → <sourceRoot>/pan-wizard-core/learnings/universal/<topic>.md
  //    internal  → <sourceRoot>/pan-wizard-core/learnings/internal/<topic>.md
  // 4. Append (or create) the topic file with the new pattern
  // 5. Front-matter: pattern_ids list, last_updated, source_experiments list
  // 6. Return { promoted_to: path, pattern_id, scope, topic }
}

function listPromotedPatterns(sourceRoot) {
  // Walk learnings/{universal,internal}/, return inventory
}

function unpromotePattern(topicFile, patternId) {
  // Remove a pattern from a topic file (for rollback)
}
```

### 3.3 Command Surface

#### `commands/pan/experiment.md` (new — 52nd command)

```
/pan:experiment new <slug> --idea <path> [--runtime <r>] [--root <path>] [--budget <pts>]
/pan:experiment list [--status <pending|running|done|failed>]
/pan:experiment run <slug> [--runtime <r>] [--timeout <sec>] [--no-stream]
/pan:experiment status <slug>
/pan:experiment stop <slug>
/pan:experiment harvest <slug> [--prune]
/pan:experiment harvest --all
/pan:experiment archive <slug>
/pan:experiment delete <slug> --confirm
```

CLI subcommands (`pan-tools experiment <sub>`):
- `experiment new <slug> --idea <path>`
- `experiment list`
- `experiment manifest <slug>`
- `experiment run <slug>` (or via `runner.cjs` directly)
- `experiment harvest <slug>`
- `experiment prune <slug>`

#### Extended `/pan:learn` and `/pan:optimize`

```
/pan:learn --experiment <slug>           # NEW: run pan-optimizer over harvested experiment
pan-tools learn promote --pattern <id> --scope universal --topic <name>
pan-tools learn unpromote --pattern <id> --topic <name>
pan-tools learn list-promoted
```

### 3.4 New Agent: `pan-experiment-runner`

```yaml
---
name: pan-experiment-runner
description: Drives an external AI coding session against an experiment folder. Tails state, observes summaries, decides when the build is "done enough." Read-only relative to PAN source; writes only to <experiment-folder>/.planning/.
tools: Read, Bash, Glob, Grep
color: orange
thinking: enabled
thinking_budget: 6000
---

<role>
You are the experiment runner. You drive an AUTONOMOUS external Claude Code (or other CLI) instance against an isolated experiment folder. Your job: observe, not intervene.

You are NOT the agent doing the build. You are the watchdog. The external instance does the actual work.

**You may NOT:**
- Edit files in the experiment folder
- Inject prompts into the external instance
- Modify the source repo

**You MAY:**
- Read the experiment's .planning/ state
- Tail the experiment's agent-history.json
- Decide when to declare success / failure / timeout based on stop conditions
- Update PAN's .planning/experiments/<slug>/run-state.json
- Surface progress to the orchestrating user
</role>

<stop_conditions>
1. **success**: experiment's state.md status = "done" AND the milestone summary file exists
2. **budget_exhausted**: external instance's cumulative trace event count > opts.budget * SPEND_RATIO
3. **timeout**: elapsed wall-clock > opts.timeout
4. **circuit_breaker**: 3 consecutive agent failures in agent-history.json
5. **manual_stop**: PAN session writes <experiment>/.planning/STOP signal file
</stop_conditions>

<observations_to_log>
Every state transition writes a trace event in PAN's experiment record:
- agent_spawned (with task description)
- agent_completed (with status, elapsed)
- summary_written (with phase, plan)
- state_change (with old → new status)
- stop_condition_hit (with reason)
</observations_to_log>
```

### 3.5 Idea Document Schema

`pan-wizard-core/templates/idea.md`:

```markdown
---
title: <one-line idea title>
created: <ISO-8601>
created_by: <user>
runtime_preference: claude   # claude|codex|gemini|opencode
budget: 80                    # XS-XL points
priority: medium             # low|medium|high
---

# Idea: <title>

## Problem
What user pain does this address?

## Success Criteria
What does "this works" look like? Be concrete.

## Scope
| In Scope | Out of Scope |
|----------|--------------|
| ... | ... |

## Constraints
- Tech stack
- Dependencies
- Deadlines
- Runtime support requirements

## Reference Material (optional)
- @path/to/related-doc.md
- https://link/to/inspiration

## Notes (optional)
Free-form context the external agent should know.
```

### 3.6 Two-Tier Learnings Layout

```
pan-wizard-core/
├── references/         # human-authored, shipped to all installs (existing — guardrails, tdd, etc.)
├── learnings/          # NEW
│   ├── universal/      # AI-derived, shipped to all installs (consumed by user-project workflows)
│   │   ├── exec-patterns.md
│   │   ├── plan-patterns.md
│   │   ├── verification-patterns.md
│   │   └── debugging-patterns.md
│   └── internal/       # AI-derived, source-only (consumed when working on PAN itself)
│       ├── pan-dev-patterns.md
│       └── installer-patterns.md
└── ...
```

Each topic file structure:

```markdown
---
topic: exec-patterns
last_updated: 2026-04-30
patterns:
  - id: P-001
    summary: Always run npm test:all before phase complete
    promoted_at: 2026-04-30
    source_experiments: [my-idea-1, my-idea-2]
  - id: P-002
    summary: When verification fails on missing artifact, scaffold first then fix
    promoted_at: 2026-05-02
    source_experiments: [my-idea-3]
---

# Exec Patterns (AI-derived)

This file is auto-maintained by `pan-tools learn promote`. Each pattern was
extracted from one or more experiment runs (see source_experiments). Patterns
are advisory — the orchestrator should weight them against current context.

## P-001 — Always run `npm test:all` before phase complete

**Evidence:** 14 trace events across experiments my-idea-1, my-idea-2 where
`/pan:verify-phase` passed but a downstream scenario test caught a regression.

**Rule:** Before marking a phase complete, run the full test suite, not just
the phase's own tests. If `test:all` script exists, prefer it over `test`.

**Applies in:** exec-phase, focus-exec, milestone-done

## P-002 — ...
```

### 3.7 Installer Changes

`bin/install.js` glob already covers any new top-level dir under `pan-wizard-core/`. Verify:

```js
// Around bin/install.js line ~XXX (verify exact location at impl)
const corePaths = [
  'pan-wizard-core/bin',
  'pan-wizard-core/workflows',
  'pan-wizard-core/templates',
  'pan-wizard-core/references',
  'pan-wizard-core/learnings/universal',  // NEW — explicitly include
  // 'pan-wizard-core/learnings/internal' INTENTIONALLY OMITTED
];
```

Adding `learnings/universal` explicitly (instead of relying on glob) makes the universal-vs-internal split discoverable in install.js. Tests assert `learnings/internal/` is NOT in any install dir.

### 3.8 Workflow Cross-References

Following the v3.6.0 pattern, 4 workflows gain a reference to `learnings/universal/`:

```markdown
<required_reading>
@~/.claude/pan-wizard-core/references/guardrails.md
@~/.claude/pan-wizard-core/learnings/universal/   <!-- NEW: directory glob loads all topic files -->
</required_reading>
```

Workflows updated:
- `exec-phase.md`
- `plan-phase.md`
- `verify-phase.md`
- `execute-plan.md`

### 3.9 End-to-End Flow Walkthrough

User runs:

```bash
# 1. Capture an idea
echo "# Idea: Build a tiny markdown linter CLI" > my-idea.md
# (fill in problem, success, scope, constraints)

# 2. Scaffold experiment
pan-tools experiment new md-lint --idea my-idea.md --runtime claude --budget 60
# → creates D:/pan-experiments/md-lint/, installs PAN for claude, copies idea.md

# 3. Run the experiment (autonomous external Claude Code)
pan-tools experiment run md-lint
# → spawns: claude -p "/pan:new-project --auto @.planning/idea.md"
#   inside D:/pan-experiments/md-lint/
# → tails its state.md; PAN session prints periodic progress

# 4. After ~10-30 min, experiment completes (or hits a stop condition)
pan-tools experiment harvest md-lint
# → copies optimization/, agent-history, state, summaries to
#   d:/PanWizard/experiments/md-lint/

# 5. Run pan-optimizer over harvested data
/pan:learn --experiment md-lint
# → produces d:/PanWizard/experiments/md-lint/learnings/report-<ts>.md

# 6. Review report. Promote select findings:
pan-tools learn promote --pattern P-007 --scope universal --topic exec-patterns
# → appends pattern to pan-wizard-core/learnings/universal/exec-patterns.md

pan-tools learn promote --pattern P-013 --scope internal --topic pan-dev-patterns
# → appends to pan-wizard-core/learnings/internal/pan-dev-patterns.md

# 7. Verify shipping behavior
npm run test:all   # asserts learnings/universal/ ships, internal/ does not
node bin/install.js --claude --local  # in d:/pantesting, verify universal/ present, internal/ absent

# 8. Ship as v3.7.x
# CHANGELOG entry. ADR entry. Commit. Tag.
```

### 3.10 Implementation Plan (4 Waves Across v3.7.0 → v3.7.3)

| Wave | Version | Items | Pts | Days |
|------|---------|-------|-----|------|
| W1: Experiment scaffolding + idea schema | v3.7.0 | experiment.cjs (new + list + manifest), idea.md template, experiment.md command (subset), tests | 12 | 1 |
| W2: External runner + observation | v3.7.1 | runner.cjs, pan-experiment-runner agent, run/status/stop subcommands, file-tail, run-state.json | 10 | 1 |
| W3: Harvest + extended /pan:learn | v3.7.2 | experiment.harvestExperiment(), `/pan:learn --experiment`, harvest/prune subcommands, scenario tests | 8 | 1 |
| W4: Promote + ship | v3.7.3 | optimize.promotePattern(), learn promote/unpromote/list-promoted, learnings/{universal,internal}/ tier, installer + workflow refs, ADR-0026 | 10 | 1 |

**Total: ~40 pts, 4 sessions, ships across 4 patch versions OR consolidated as v3.7.0 if shipped as a single wave.**

Recommendation: ship as **v3.7.0 single wave** (40 pts is doable in one focused session with the spec already written). Each wave above can also be a separate session if the user prefers staged rollout.

### 3.11 Test Plan

Target: 30+ new tests.

#### Unit tests

- `tests/experiment.test.cjs` (8-10 tests): newExperiment validation, root path, slug rules, manifest, list, prune
- `tests/runner.test.cjs` (6-8 tests): runtime adapter selection, mocked subprocess spawn, timeout enforcement, circuit breaker, run-state persistence
- `tests/learn-promote.test.cjs` (6-8 tests): promotePattern shape, scope routing, topic file append, unpromote round-trip, list-promoted

#### Scenario tests

- `tests/scenarios/learnings-installed.test.cjs` (10 tests): `learnings/universal/*.md` present in all 5 runtime installs, `learnings/internal/` ABSENT in all 5 runtime installs (negative assertion), idea.md template ships, experiment.md command ships
- `tests/scenarios/experiment-lifecycle.test.cjs` (5 tests): mocked end-to-end — new → manifest → harvest → promote — without spawning a real external process

#### Integration tests (optional, opt-in via env flag)

- `tests/integration/real-experiment.test.cjs` — gated by `PAN_REAL_EXPERIMENT=1`, runs an actual `claude -p` against a trivial idea. Skipped in CI by default; available for manual smoke before each release.

### 3.12 Documentation

- `docs/USER-GUIDE.md` — new "Self-Improvement Loop" section under Advanced Features, walking through the end-to-end flow
- `docs/ARCHITECTURE.md` — new "v3.7.0 additions — Self-Improvement Loop" section listing the 2 new modules + new agent + 2 new top-level dirs
- `docs/decisions/ADR-0026-self-improvement-loop.md` — records: (a) external-process model (subprocess vs VSCode), (b) two-tier learnings split (universal vs internal), (c) manual promote (defer auto-promote to v3.8), (d) experiment root outside source repo
- `CHANGELOG.md` — v3.7.0 entry

---

## Phase 4: Specification — Ready-to-Implement

### Files to Create

1. `pan-wizard-core/bin/lib/experiment.cjs` (new — 28th core module, ~400 LOC)
2. `pan-wizard-core/bin/lib/runner.cjs` (new — 29th core module, ~300 LOC)
3. `pan-wizard-core/templates/idea.md` (new — 27th template)
4. `pan-wizard-core/learnings/universal/.gitkeep` (placeholder — first promote creates topic files)
5. `pan-wizard-core/learnings/internal/.gitkeep` (placeholder)
6. `pan-wizard-core/learnings/README.md` (explains universal vs internal split)
7. `commands/pan/experiment.md` (new — 52nd command, full subcommand surface)
8. `agents/pan-experiment-runner.md` (new — 21st agent)
9. `tests/experiment.test.cjs`
10. `tests/runner.test.cjs`
11. `tests/learn-promote.test.cjs`
12. `tests/scenarios/learnings-installed.test.cjs`
13. `tests/scenarios/experiment-lifecycle.test.cjs`
14. `docs/decisions/ADR-0026-self-improvement-loop.md`

### Files to Modify

1. `pan-wizard-core/bin/lib/optimize.cjs` — add `promotePattern`, `listPromotedPatterns`, `unpromotePattern` exports
2. `pan-wizard-core/bin/pan-tools.cjs` — register `experiment` and `learn promote/unpromote/list-promoted` subcommand routes
3. `commands/pan/learn.md` — extend `--experiment <slug>` flag + promote subcommand surface
4. `pan-wizard-core/workflows/learn.md` — add experiment-aware path
5. `pan-wizard-core/workflows/exec-phase.md` — reference `learnings/universal/`
6. `pan-wizard-core/workflows/plan-phase.md` — reference `learnings/universal/`
7. `pan-wizard-core/workflows/verify-phase.md` — reference `learnings/universal/`
8. `pan-wizard-core/workflows/execute-plan.md` — reference `learnings/universal/`
9. `bin/install.js` — explicit `learnings/universal` in shipped paths; tests assert `learnings/internal` is NOT shipped
10. `bin/install-lib.cjs` — verify glob handles new dir; add helper if needed
11. `package.json` — bump to 3.7.0
12. `CHANGELOG.md` — v3.7.0 entry
13. `docs/USER-GUIDE.md` — new section
14. `docs/ARCHITECTURE.md` — new section
15. `MEMORY.md` — refresh counts (29 modules, 21 agents, 52 commands, ~2620 tests)

### Step Order (recommended for single-session ship)

1. Write `experiment.cjs` + `runner.cjs` skeletons with all exports stubbed
2. Write all 5 test files (TDD-first; tests fail)
3. Implement experiment.cjs functions (newExperiment → list → manifest → harvest → prune)
4. Implement runner.cjs (RUNTIME_RUNNERS map, runExperiment with mocked subprocess for tests)
5. Implement promotePattern in optimize.cjs
6. Wire pan-tools.cjs dispatcher
7. Run unit tests — green
8. Create commands/pan/experiment.md, agents/pan-experiment-runner.md
9. Add workflow cross-references
10. Add `learnings/universal/`, `learnings/internal/` dirs with .gitkeep + README
11. Update bin/install.js for two-tier delivery
12. Run scenario tests — green (verifies shipping behavior)
13. Manual install verification in d:\pantesting (5 runtimes)
14. Manual smoke test: spawn a real `claude -p` against a trivial idea (opt-in integration)
15. Update CHANGELOG, USER-GUIDE, ARCHITECTURE, MEMORY
16. Write ADR-0026
17. Bump version to 3.7.0
18. Commit + tag

### Test Coverage Summary

| File | Test count | Type |
|------|------------|------|
| experiment.test.cjs | 10 | Unit |
| runner.test.cjs | 8 | Unit |
| learn-promote.test.cjs | 8 | Unit |
| scenarios/learnings-installed.test.cjs | 10 | Scenario |
| scenarios/experiment-lifecycle.test.cjs | 5 | Scenario |
| **Total new** | **~41** | — |

### Runtime Matrix

| Runtime | Experiment runner support | Receives `learnings/universal/` | Receives `learnings/internal/` |
|---------|---------------------------|--------------------------------|--------------------------------|
| Claude  | ✅ via `claude -p` | ✅ | ❌ (intentional — source-only) |
| Codex   | ✅ via `codex exec` | ✅ | ❌ |
| Gemini  | ✅ via `gemini -p` | ✅ | ❌ |
| OpenCode | ✅ via `opencode` | ✅ | ❌ |
| GitHub Copilot | ❌ runner unsupported (no headless mode) | ✅ | ❌ |

GitHub Copilot users can still consume promoted learnings; they just can't drive an experiment runner. Documented limitation.

---

## Phase 5: Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Spawned external agent runs unbounded, consumes cost | High | Medium | Triple safety: timeout (default 30 min) + budget cap (default 80 pts) + circuit breaker (3 consecutive failures). Test coverage for each. |
| Experiment folder pollutes user disk | Low | Medium | Default root `~/pan-experiments/`; configurable. Document `pan-tools experiment delete` for cleanup. |
| Promote step writes garbage into shipped learnings | High | Medium | **Manual review gate** — promote requires explicit `--pattern <id>`; no auto-promote in v3.7. Tests verify file shape; ADR-0026 records the manual-only design. |
| Universal vs internal split is wrong (PAN-internal pattern shipped as universal) | Medium | High | Filter heuristic in promote: detect references to `pan-wizard-core/`, `bin/install.js`, `commands/pan/*` paths → suggest `--scope internal`. Human can override. |
| External agent doesn't return useful telemetry (e.g., gemini -p doesn't trigger PAN trace logger) | Medium | Medium | The trace logger fires on Claude Code SubagentStop; non-Claude runtimes log differently. Start with Claude as the primary; document fallback as "no auto-trace, manual harvest" for v3.7. |
| `claude -p` flag may not exist or differ across versions | Medium | Medium | Implement adapter map. Test against current Claude Code version at impl time. Document required Claude Code version in `references/`. |
| Cross-platform subprocess differences (Windows vs Unix) | Medium | Low | Use Node's `child_process.spawn` with `shell: false`. Existing scenario tests already cover Windows; new tests use same pattern. |
| Harvest copies sensitive data | Medium | Low | Document: idea.md is the only "sensitive" file; harvest excludes it by default; `--include-idea` opt-in flag for full archive. |
| `learnings/internal/` accidentally ships | High | Low | Negative test in `scenarios/learnings-installed.test.cjs`: assert NOT in any install dir. Installer test runs in CI on every change. |
| Cumulative learnings grow unbounded | Low | Medium | Each topic file has a soft size cap (10KB recommendation); patterns can be retired via `unpromote`. v3.8+ add an automatic age-based prune. |
| pan-experiment-runner agent intervenes in external instance | High | Low | Agent definition explicitly forbids editing experiment files. Agent tools list excludes Edit/Write. Tests assert no writes outside `<experiment>/.planning/`. |
| Test count grows fast — CI time increases | Low | High | New tests are mostly unit (fast). Integration test gated by env flag (excluded from CI). Mocked subprocess in scenario tests stays under 10s. |
| Spec/impl mismatch on runtime headless flags | Medium | Medium | Implementation phase verifies each runtime's actual headless invocation. Adapter map updates accordingly. ADR-0026 records what was verified vs assumed. |

### Backward Compatibility

- All proposals are additive. No breaking changes to existing commands, workflows, agents, tests.
- `learnings/` is a new top-level directory under `pan-wizard-core/`. Existing v3.6.x installs upgrading to v3.7.0 receive the new dir + universal contents via standard `pan update` flow.
- Workflows reference `learnings/universal/` AFTER existing `references/` references. If the dir is missing (manual install corruption), workflows degrade gracefully — the `@~/.claude/.../learnings/universal/` glob just resolves to no files.
- `optimize.cjs` extensions (`promotePattern`, etc.) are new exports. Existing `analyzeEvents`, `generateLocalReport`, etc. unchanged.

### What's Explicitly NOT in v3.7.0

- **Auto-promote** without human review — defer to v3.8+ once 10+ manual promotes inform the filter
- **Cross-experiment aggregation** — defer to v3.8+ (different design problem)
- **VSCode UI automation as runner path** — keep CLI subprocess; VSCode automation stays for tests
- **Bidirectional control mid-run** — observation-only by design
- **GitHub Copilot CLI runner** — no headless prompt mode known; document limitation
- **Experiment-driven evaluation** (LLM-as-judge over the experiment's outputs) — separate eval feature, see googlecli_adoption_featureai.md notes
- **Sandboxed/containerized experiments** — process isolation via separate folder is sufficient for v3.7; container isolation if needed later

---

## Appendix A: Open Questions (resolve before W4)

1. **Should `learnings/universal/` topic files be human-editable, or AI-only?** Recommendation: AI-only via `promote/unpromote`. Human edits create drift between topic frontmatter `pattern_ids` and body content. For human-authored content, use `references/`.

2. **Should the experiment runner use a single per-runtime adapter, or call the user's installed `claude` PATH?** Recommendation: PATH lookup (`which claude`). Document as a prerequisite in USER-GUIDE.

3. **Should `harvest --all` interleave reports or keep per-experiment dirs?** Recommendation: per-experiment dirs (cleaner traceability). `learn promote --aggregate` is a v3.8 feature for cross-experiment patterns.

4. **Should `learnings/universal/exec-patterns.md` REPLACE or AUGMENT `references/guardrails.md`?** Recommendation: augment. Guardrails are human-authored canonical rules; learnings are AI-derived advisory patterns. Workflows reference both.

5. **Should runtime adapters for codex/gemini/opencode ship in v3.7.0 or claude-only?** Recommendation: claude-only in W2 (v3.7.1); add other adapters in v3.7.4 follow-up. Faster initial ship; same surface.

6. **Should we add a `pan-tools experiment replay <slug>` to re-run from a specific phase?** Recommendation: defer to v3.8. Replay needs idempotency design that v3.7 doesn't need.

---

## Appendix B: Mapping to Existing PAN Surface

| New element | Closest existing analog | Drift risk |
|-------------|-------------------------|------------|
| `experiment.cjs` | `focus.cjs` (auto-runner) | Low — same lifecycle pattern |
| `runner.cjs` | `tests/helpers.cjs createScenarioRunner()` | Low — generalizes existing pattern |
| `pan-experiment-runner` agent | `pan-optimizer` agent | Low — same observation-only stance |
| `learnings/universal/` | `references/` | None — same delivery channel |
| `learnings/internal/` | `pan-wizard-core/.dev-only/` (doesn't exist) | New concept; needs negative test |
| `idea.md` template | `requirements.md`, `project_spec_*.md` (existing patterns) | Low — same shape |
| `pan-tools experiment new/run/harvest` | `pan-tools focus auto/scan/plan/exec` | Low — same subcommand pattern |
| `pan-tools learn promote` | `pan-tools optimize apply` | Medium — new write-target (source repo, not project) |

---

## Appendix C: Timeline & Dependencies

```
v3.6.0 ✓ shipped 2026-04-27 (behavioral guardrails layer)
   │
   ├─ unblocks: shipping behavioral content via references/ pattern (proven)
   │
v3.7.0 (this spec) — Self-Improvement Loop
   │
   ├─ W1: experiment scaffolding (12 pts)
   ├─ W2: runner + observation (10 pts)
   ├─ W3: harvest + extended /pan:learn (8 pts)
   ├─ W4: promote + ship (10 pts)
   │
   └─ unblocks:
       ├─ v3.8.0: auto-promote (rules-based filter, AI-confidence threshold)
       ├─ v3.8.0: cross-experiment aggregation
       ├─ v3.9.0: container-isolated experiments (if needed for security)
       └─ v3.9.0: experiment-replay-from-phase (idempotency design)
```

---

## Verification Checklist (pre-merge for v3.7.0)

- [ ] `pan-wizard-core/bin/lib/experiment.cjs` exists, exports newExperiment / listExperiments / harvestExperiment / pruneExperiment
- [ ] `pan-wizard-core/bin/lib/runner.cjs` exists, exports runExperiment / tailExperimentState / stopExperiment / RUNTIME_RUNNERS
- [ ] `pan-wizard-core/bin/lib/optimize.cjs` exports promotePattern / listPromotedPatterns / unpromotePattern (added)
- [ ] `commands/pan/experiment.md` registered, runs all 8 subcommands
- [ ] `agents/pan-experiment-runner.md` exists, has correct tool list (Read/Bash/Glob/Grep — NO Edit/Write)
- [ ] `pan-wizard-core/templates/idea.md` exists with required frontmatter fields
- [ ] `pan-wizard-core/learnings/universal/` exists; ships to all 5 runtime installs
- [ ] `pan-wizard-core/learnings/internal/` exists; does NOT ship to any install (negative test passes)
- [ ] 4 long workflows reference `learnings/universal/`
- [ ] `bin/install.js` explicit two-tier handling verified by tests
- [ ] `npm test` passes, 41 new tests added
- [ ] `npm run test:scenarios` passes, including learnings shipping tests
- [ ] Manual install in d:\pantesting for 2+ runtimes confirms learnings/universal/ shipped, learnings/internal/ absent
- [ ] Manual smoke: real `claude -p` experiment runs end-to-end on a trivial idea, harvest + promote complete the loop
- [ ] CHANGELOG.md, USER-GUIDE.md, ARCHITECTURE.md updated
- [ ] ADR-0026 committed
- [ ] MEMORY.md refreshed (29 modules, 21 agents, 52 commands, ~2620 tests)
- [ ] `package.json` version is 3.7.0
- [ ] All v3.6.0 behavioral guardrails still in effect (regression check)

---

**End of spec. Awaiting acceptance to begin v3.7.0 W1.**
