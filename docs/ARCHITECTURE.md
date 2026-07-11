# PAN Wizard — Architecture Guide

A deep dive into how PAN Wizard is structured, how data flows between layers, and why key design decisions were made.

**Other docs:** [Agents](AGENTS.md) · [Hooks](HOOKS.md) · [CLI Reference](CLI-REFERENCE.md) · [Development](DEVELOPMENT.md)

---

## Table of Contents

- [System Overview](#system-overview)
- [Layer 1: Commands](#layer-1-commands)
- [Layer 2: Workflows](#layer-2-workflows)
- [Layer 3: Agents](#layer-3-agents)
- [Layer 4: Core Library](#layer-4-core-library)
- [Layer 5: Persistent State](#layer-5-persistent-state)
- [Additional Components](#additional-components)
  - [References](#references)
  - [Templates](#templates)
  - [Hooks](#hooks)
  - [Installer](#installer)
- [Data Flow](#data-flow)
- [Module Dependency Graph](#module-dependency-graph)
- [Cross-Platform Runtime Support](#cross-platform-runtime-support)
- [Key Design Decisions](#key-design-decisions)

---

## System Overview

PAN Wizard is organized as a 5-layer architecture. Each layer has a single responsibility and communicates with adjacent layers through well-defined interfaces.

```
+-------------------------------------------------------------------+
|                  USER (Claude Code / OpenCode / Gemini /           |
|                        Codex / Copilot CLI)                        |
+-------------------------------------------------------------------+
        |  /pan:command arg1 arg2
        v
+-------------------------------------------------------------------+
|  LAYER 1: COMMANDS          commands/pan/*.md                   |
|  Thin orchestrators — parse args, read state, route to workflows  |
+-------------------------------------------------------------------+
        |  references workflow
        v
+-------------------------------------------------------------------+
|  LAYER 2: WORKFLOWS    pan-wizard-core/workflows/*.md            |
|  XML-structured multi-step procedures — the core logic layer      |
+-------------------------------------------------------------------+
        |  spawns via Task tool              |  calls via bash
        v                                   v
+---------------------------+   +-------------------------------+
|  LAYER 3: AGENTS          |   |  LAYER 4: CORE LIBRARY        |
|  agents/*.md              |   |  pan-wizard-core/bin/lib/*.cjs |
|  Specialized AI roles,    |   |  Core CJS modules + CLI entry  |
|  each in fresh 200K ctx   |   |  Zero external dependencies   |
+---------------------------+   +-------------------------------+
        |                                   |
        +----------------+------------------+
                         |  reads / writes
                         v
+-------------------------------------------------------------------+
|  LAYER 5: PERSISTENT STATE              .planning/                |
|  project.md, roadmap.md, state.md, config.json, phase dirs        |
+-------------------------------------------------------------------+
```

**Key principle:** Information flows downward through layers. Commands invoke workflows. Workflows spawn agents and call the core library. Agents and the core library read/write persistent state. No layer communicates upward except by returning results.

### Opus 4.7 integration (since v2.10.0)

PAN Wizard consumes five Opus 4.7 primitives across existing layers without changing the layer contracts:

- **Prompt caching (Layer 4/3 boundary):** `buildCachedContext(cwd)` returns the stable set of .planning files each agent reads. Commands prime the cache once via `pan-tools cache prime` before Wave 1 so sub-agents spawned in the next 5 minutes hit cached reads. See ADR-0023.
- **Reasoning effort (Layer 3):** agents carry `effort:` frontmatter (`low`–`xhigh`; the adaptive-thinking-era replacement for the retired `thinking_budget`, v3.9.0). Claude Code consumes it natively; the installer strips it for non-Claude runtimes and injects an effort-scaled prose preamble. Profiles modulate the base via `resolveEffortInternal()`.
- **Whole-project ingest (Layer 1/3):** `/pan:map-codebase` Stage 0 calls `pan-tools codebase estimate-size`; on Opus 4.7 repos ≤700K tokens go single-shot, else 6-way sharded. The `pan-document_code` agent has a `<mode>` block so it knows which shape it was spawned with.
- **Cross-phase memory (Layer 5):** `.planning/memory/<agent>.md` stores append-only per-agent lessons. `/pan:retro --write-memory` populates planner/verifier memory from observed gap patterns.
- **Capability-aware routing (Layer 4):** `resolveModel(agent, {context_estimate, needs_thinking, cache_warm})` adjusts tier upward for large context or thinking-heavy work, downward for warm cache + small context.

Memory and caching are file-based, so they work on all 5 runtimes. Extended thinking and native skill shims (`.claude/skills/pan-*.md`) are Claude-only.

### Spec B v2 (v3.0-v3.4)

Spec B v2 shipped a wave of new core modules (bus, cost, preview, review-deep, knowledge, whatif, bridge) and user-facing commands (cost, preview, review-deep, knowledge, what-if, mcp-bridge). None touch the focus system (`/pan:focus-*`); they interoperate via read boundaries + optional flags. See ADR-0024.

- **`bus.cjs` (v3.0, Y-7 infrastructure):** file-backed message channels at `.planning/bus/<channel>.jsonl` for agent-to-agent coordination. Consumed by `review-deep.cjs` (audit trail) and `pan-conductor` (orchestrator trace). Three drain modes: peek / consume / archive.
- **`cost.cjs` (v3.0, Y-6):** per-call cost aggregation. Reads `.planning/metrics/tokens.jsonl` (append-only log), outputs JSON/table/chart. Auto-populated from v3.4 by the `pan-cost-logger` SubagentStop hook.
- **`preview.cjs` (v3.1, Y-1):** foresight data layer. Three modes — `buildPhasePreview` (blast radius), `buildPhaseDependencyGraph` (mermaid DAG + parallel batches), `buildMilestoneETA` (velocity + confidence + bottleneck).
- **`review-deep.cjs` (v3.2, Y-2):** merges outputs from `pan-reviewer` + `pan-hardener` + `pan-meta-reviewer` into one verdict ladder (ok / ok_with_minor / fix_before_merge / review_required / block). Publishes audit to the `review-handoff` bus channel.
- **`knowledge.cjs` (v3.2, Y-3):** three modes — `ask` (retrieval-grounded Q&A), `discuss` (multi-turn sessions at `.planning/conversations/<phase>/`), `playbook` (clusters agent memory into categorized lessons at `.planning/playbook.md`).
- **`whatif.cjs` (v3.3, Y-4):** git worktree lifecycle for counterfactual phase replay. Agent explores in isolated worktree, command writes `.planning/counterfactuals/<phase>-<slug>.md` in main tree, cleans up worktree.
- **`bridge.cjs` (v3.3, Y-5):** MCP tool discovery + per-phase recommendation. Reads `.planning/bridge/available-tools.json` (host-runtime-populated), scores tools against phase plan text by keyword frequency. Discovery-only; auto-invocation deferred.

Hierarchical orchestration (v3.4): `pan-conductor` spawns executor/reviewer/verifier sub-agents for `/pan:exec-phase <N> --hierarchical`, bounded by a safety harness (2-level nesting cap, 12-spawn cap, budget ceiling, `.planning/orchestration/abort` kill-switch). Claude + Opus 4.7 only; falls back to flat exec elsewhere.

Automatic cost instrumentation (v3.4): `hooks/pan-cost-logger.js` fires on Claude Code's `SubagentStop` event, appends to `.planning/metrics/tokens.jsonl`, flows into `/pan:cost` without caller instrumentation.

### Bot-army model (v3.11–v3.12, ADR-0032/0033/0034/0035)

PAN's agents run as a coordinated army when `/pan:army` drives a whole-project goal. The tiers reuse existing primitives — nothing here relaxes the `pan-conductor` safety harness:

- **Tier 0 — Mission Control:** `pan-conductor` in campaign mode (Opus, delegation-only). Plans the goal, delegates to squads, never codes. Inherits every harness cap (nesting depth 2, spawn/budget ceiling, abort kill-switch).
- **Tier 1 — Squads (`squads.cjs`):** four role-scoped groupings of existing agents with least-privilege tool contracts — Architecture (read-only design), Build (read/write code), Quality (read-only adversarial), Release (`pan-release`, always-ask). A drift test pins squad roster ⇄ agent files ⇄ `AGENT_BASE_EFFORT`.
- **Build isolation (`worktree.cjs`):** each Build agent gets its own `army/<task>` branch + git worktree, so parallel builders never share a tree or file. Generalized from `whatif.cjs`.
- **Human-gated ship:** `pan-release` prepares a squash-merge and surfaces an `always-ask` approval; a human merges to the protected branch. Recovery is `git revert` / previous tag — never force-push.
- **Learn step (= "Dreaming"):** `/pan:retro --write-memory` + the self-improvement loop persist patterns to agent memory between missions.
- **Scheduled campaigns (`campaign.cjs`, ADR-0034):** `/pan:army --schedule <cadence>` arms a self-resuming campaign with a per-day budget. PAN owns the schedule descriptor + due-check; an external trigger (host scheduler / `/loop` / next-open nudge) fires `/pan:army --continue` when due. It is not a daemon and never lowers the human merge gate — autonomy runs up to the merge, a human at the merge.
- **Observability HUD (`hud.cjs`, ADR-0035):** `/pan:hud` renders a single self-contained `.planning/hud.html` aggregating mission, roadmap, command stack (Mission Control → squads → agents), campaign schedule, safety harness, active worktrees, telemetry, and requirements/quality. A read-only **view** — it owns no state and writes only its own file, so it can never corrupt planning data. Army-only panels appear only when a campaign is scheduled or army worktrees exist.

### v3.5 additions

New core modules, commands, agents, hooks, and workflows layered on the existing architecture without breaking changes:

- **Circular optimization loop:** `optimize.cjs` + `pan-optimizer` agent + `/pan:learn` + `/pan:optimize` commands. The trace → learn → apply cycle makes PAN self-improving across sessions. Powered by the `pan-trace-logger.js` SubagentStop hook, which auto-creates day-scoped trace sessions with zero setup.
- **`/pan:git` family:** `git.cjs` gives phase-aware git subcommands (commit/branch/push/status/log/stash/diff/rollback/tag/sync) with the same safety guarantees as `commit.md` (deleted-file detection, sensitive-file blocking via `runCommitSafetyChecks`). Branch naming follows `pan/phase-N` convention.
- **Distill optimizer:** `distill.cjs` + `pan-distiller` agent + `distill` focus-auto category implement the SOTA agentic-refactoring pipeline (deterministic-first, LLM-on-narrow-spans, cross-session pattern memory). 5 passes: deterministic static analysis → AST-style → cross-file graph → LLM judgment on flagged spans only → cross-session memory at `.planning/memory/distill-patterns.md`. Bloat budget gate (touched_LOC / essential_LOC, default 2.0x threshold).
- **Circular loop blind-spot fixes (W1+W2+W3):** exec-phase now logs `reviewer_correction` events when verdict is NEEDS_FIXES; new `load_phase_memory` step injects `.planning/memory/*.md` rules into executor context before Wave 1; `logTraceEvent` auto-inherits phase number from session metadata.

### Self-Improvement Loop additions

A cross-project meta-learning loop. PAN drives autonomous external builds against fresh ideas in isolated folders, harvests the resulting telemetry back to source, and promotes generalizable findings into shipped artifacts that future installs read automatically. Closes the deferred MEMORY note "Cross-Session Learning (PATTERNS.md auto-capture)".

**Core modules backing the loop:**
- `pan-wizard-core/bin/lib/experiment.cjs` — scaffolds isolated experiment folders at `~/pan-experiments/<slug>/` with `.planning/idea.md` + manifest. Refuses to scaffold inside source repo (mirrors installer guard). Exports `harvestExperiment` (copy telemetry back to `<source>/experiments/<slug>/`) and `pruneExperiment` (soft-rename or hard-delete). Now also runs `initExperimentGit()` to inherit `user.email`/`user.name` from PAN source so autonomous-loop commits don't silently fail (P-EXP-001 fix).
- `pan-wizard-core/bin/lib/runner.cjs` — spawns external AI runtime via `spawnSync` (sync with native timeout). `RUNTIME_RUNNERS` adapter map: claude/codex/gemini/opencode supported; copilot is `null` (no headless mode). DEFAULT_TIMEOUT_MS bumped to 60 min after typical 3-plan phases timed out at 30 min.
- `pan-wizard-core/bin/lib/learn-lint.cjs` — `pan-tools learn lint` integrity checks for the patterns store. Catches L-001 duplicate IDs across files, L-002 dangling pattern cross-references, L-003 empty `source_experiments` while body cites a known experiment, L-004 universal-scope rule prose using PAN-internal terms, L-005 revision marker without `superseded_by` frontmatter on the base. Wired into `/check`. Exits non-zero on errors.
- `pan-wizard-core/bin/lib/learn-index.cjs` — `pan-tools learn build-index` generates `pan-wizard-core/learnings/index.json` with topic→agent-relevance map, byte/token-est sizes. `pan-tools learn topics-for --agent <role> [--token-budget N]` returns the budget-aware selected subset. Workflow files (`plan-phase.md`, `exec-phase.md`, `verify-phase.md`, `execute-plan.md`) now call `topics-for` instead of skim-the-folder, addressing the P-RES-002 distractor-density anti-pattern PAN was previously shipping.

**One new agent:** `pan-experiment-runner` — observation-only watchdog. Tools restricted to `[Read, Bash, Glob, Grep]`. Cannot edit experiment files; reports back to the orchestrating user.

**One new command:** `commands/pan/experiment.md` with subcommands new/list/manifest/run/status/stop/harvest/prune.

**One new template:** `pan-wizard-core/templates/idea.md` — structured idea-doc shape consumed by `experiment new`.

**Two-tier learnings layout** (new top-level dir under `pan-wizard-core/`):
- `learnings/universal/` — AI-derived patterns shipped to all 5 runtime installs alongside `references/`
- `learnings/internal/` — PAN-development-specific patterns; **source-only** (installer strips this)

The two-tier split prevents PAN-internal patterns ("always commit individually because of source repo's hooks") from leaking to user installs as universal advice. Negative test in `tests/scenarios/learnings-installed.test.cjs` enforces the split.

**Extended `optimize.cjs`:** `promotePattern` / `listPromotedPatterns` / `unpromotePattern` write findings into topic files under `learnings/{universal,internal}/`. Topic files use markdown with structured frontmatter (zero-deps minimal parser; not standard YAML).

**Workflow cross-references:** the long workflows now reference `learnings/universal/` after `references/guardrails.md`. Patterns auto-load as topic files appear.

**Manual promote gate:** `pan-tools learn promote --pattern <id> --scope <s> --topic <t> --summary ... --rule ...` requires explicit human input. Auto-promote (rules-based filter) is deferred to v3.8+.

The `references/<topic>.md` + workflow-cross-reference pattern (proven in v3.6.0 with `guardrails.md`) is now joined by `learnings/<scope>/<topic>.md` for the AI-derived counterpart. Together they form a complete behavioral surface: human-authored canonical rules (`references/`) + AI-derived advisory patterns (`learnings/universal/`).

### Reasoning-trace handoff (P-RES-003)

The serial pipeline (planner → researcher → executor → verifier) hands work file-mediated. Plan and summary artifacts traditionally carried only OUTPUTS, not the reasoning that produced them. Per Cognition (June 2025) "Don't build multi-agents", silent decisions in upstream artifacts force downstream agents to reconcile contradictions blindly. PAN now passes the reasoning trace explicitly:

- **`pan-wizard-core/references/handoff-decisions.md`** — schema for `## Plan Decisions` (in plan.md) and `## Implementation Decisions` (in summary.md). Three buckets: Locked / Open / Considered+rejected.
- **`agents/pan-planner.md`** — emits `## Plan Decisions` between objective and tasks.
- **`agents/pan-executor.md`** — reads Plan Decisions before coding, writes Implementation Decisions when deviating from the plan.
- **`agents/pan-verifier.md`** — Step 1b consumes the reasoning trace; Step 1c reads `codebase/CONVENTIONS.md` per P-RES-005 (repo-norm violation detection).
- **`agents/pan-plan-checker.md`** — Dimension 11 (Spec Sufficiency for Handoff, P-RES-004) + Dimension 12 (Decision Trace Completeness, P-RES-003) verify that plans carry enough decision context for downstream agents.
- **Summary templates** (`templates/summary-{minimal,standard,complex}.md`) — all three variants carry the Implementation Decisions section.

### Production-readiness gates (v3.7.10)

- **`bin/install.js verifyInstall()`** — post-install manifest walk checks every entry in `pan-file-manifest.json` exists on disk; missing files fail with exit 1. `INSTALL_WARNINGS` collector hardens `copyWithPathReplacement` (mkdir failures hard-throw; per-file failures collected as warnings rather than silently swallowed).
- **`scripts/release-check.js`** — 6-gate pre-publish validation (build → test:all → npm audit → doc-lint counts → npm pack dry-run → smoke install). Wired to `package.json prepublishOnly` so `npm publish` cannot ship a broken release.
- **`pan-tools commit --fail-on-error`** — exit non-zero on `commit_failed` (closes P-EXP-001 silent-failure surface where missing git identity in fresh experiment folders looked successful).

### v3.6.0 additions — Behavioral Guardrails Layer

A consolidated AI-behavior rules surface, adopted from Google `agents-cli` patterns. Additive only; zero breaking changes.

- **`references/guardrails.md`** — single grep-friendly file naming the top anti-patterns (silent model swaps, skipping verification, scope creep, manual focus picks, lagging docs), the **Code Preservation Principle** (surgical edits — preserve config values, comments, formatting outside the user's explicit target), and the **Stop-the-Line Rule** (regressions halt feature work).
- **`## Re-Read Checkpoints`** sections in long workflows (`exec-phase`, `plan-phase`, `verify-phase`, `execute-plan`) — explicit boundaries where the agent is directed to re-read specific sections, preventing context-compaction drift across long autonomous sessions.
- **Phase 0 Clarify gates** — MANDATORY in `new-project.md` (problem/success/scope/constraints check before scaffolding), recommended in `plan-phase.md` (phase-scope check). `--auto` mode short-circuits when a PRD is provided.
- **Agent cross-references** — `pan-reviewer` flags Code Preservation violations at high severity; `pan-planner` enforces guardrails in generated `<deviation_rules>` blocks.

The `references/` directory's role is now both **structural** (existing patterns: tdd, verification, checkpoints, model-profiles, etc.) and **behavioral** (guardrails). The `references/<topic>.md` + workflow-cross-reference pattern is the established way to add behavioral layers without bloating workflow files.

---

## Layer 1: Commands

**Location:** `commands/pan/*.md`

Commands are Markdown files that become slash commands in the user's runtime, invoked as `/pan:filename` (Claude Code, Gemini), `/pan-filename` (OpenCode, Copilot CLI), or `$pan-filename` (Codex).

Commands are thin orchestrators that:

- Parse user-provided arguments
- Read current state from `.planning/`
- Reference the appropriate workflow
- Route results back to the user

Commands never perform heavy work directly. All substantive logic lives in workflows (Layer 2) or the core library (Layer 4).

### Command Categories

| Category | Commands |
|----------|----------|
| **Getting Started** | new-project, map-codebase |
| **Phase Lifecycle** | discuss-phase, plan-phase, exec-phase, research-phase, verify-phase |
| **Phase Management** | add-phase, insert-phase, remove-phase, assumptions, phase-tests, phase-budget |
| **Session & Progress** | progress, quick, pause, resume, profile |
| **Milestone** | milestone-new, milestone-done, milestone-audit, milestone-gaps, milestone-cleanup |
| **Focus** | focus-scan, focus-plan, focus-exec, focus-auto, focus-sync, focus-design, focus-drift-walking, focus-doc-audit |
| **System** | help, health, settings, update, debug, todo-add, todo-check |
| **Deployment** | audit-deployment, retro |
| **Community** | discord, patches |
| **Spec B v2 (v3.0-v3.4)** | cost, preview, review-deep, knowledge, what-if, mcp-bridge |
| **v3.5 — Optimization & Git** | learn, optimize, git |
| **Self-Improvement Loop** | experiment |
| **Bot Army & Observability (v3.11–v3.13)** | army, hud, dashboard, hygiene, links |

### Command-Only Files (No Workflow)

Several commands are self-contained in their `.md` file and do not delegate to a separate workflow:

| Command | Reason |
|---------|--------|
| `phase-budget.md` | Calls `pan-tools.cjs context-budget` directly; no multi-step workflow |
| `discord.md` | Static information display; no system operations |
| `patches.md` | User-guided manual process; no automated workflow |
| `research-phase.md` | Self-contained research orchestrator; spawns pan-phase-researcher directly |
| `focus-scan.md` | Self-contained scan pipeline; calls `pan-tools focus scan` for data |
| `focus-plan.md` | Self-contained batch planner; calls `pan-tools focus plan` for data |
| `focus-exec.md` | Self-contained execution pipeline with staged waves and per-stage behavioral rules |
| `focus-sync.md` | Self-contained doc sync; calls `pan-tools focus sync` for data |
| `focus-auto.md` | Self-contained auto-runner; calls `pan-tools focus auto` for state management |
| `focus-design.md` | Self-contained 10-phase feature investigation pipeline |
| `focus-drift-walking.md` | Self-contained directory-walking drift detection and documentation alignment |
| `focus-doc-audit.md` | Self-contained multi-dimensional document audit with 8-dimension scoring |

---

## Layer 2: Workflows

**Location:** `pan-wizard-core/workflows/*.md`

Workflows are Markdown files with XML-structured multi-step procedures. Each workflow defines:

- What files to read for context
- What `pan-tools.cjs` commands to run for bootstrapping
- What agents to spawn (and in what order / parallelism)
- What verification steps to perform
- How to commit results

Commands reference workflows. Workflows are the procedural backbone of the system.

### Command-to-Workflow Mapping

Some workflows have different names than their corresponding commands. This is intentional — workflows use descriptive internal names while commands use user-facing names:

| Command | Workflow | Reason |
|---------|----------|--------|
| `resume.md` | `resume-project.md` | Command is user action; workflow is system operation |
| `verify-phase.md` | `verify-phase.md` | User verifies "work"; system verifies "phase" |
| `exec-phase.md` | `exec-phase.md` + `execute-plan.md` | Orchestrator + per-plan worker |
| `debug.md` | `diagnose-issues.md` | User "debugs"; system "diagnoses" |
| (no command) | `transition.md` | Internal phase-to-phase transition logic |

### Internal Workflows

These workflows have no corresponding user command — they are invoked internally by other workflows:

| Workflow | Purpose |
|----------|---------|
| `execute-plan.md` | Per-plan execution worker (spawned by `exec-phase.md` per plan) |
| `transition.md` | Phase-to-phase transition logic |

---

## Layer 3: Agents

**Location:** `agents/*.md`

Agents are Markdown files that define specialized AI roles. Each agent runs as a subagent in a fresh 200K-token context window, spawned by workflows via the `Task` tool.

| Agent | Role | Spawned By |
|-------|------|-----------|
| `pan-project-researcher` | Researches domain ecosystem | `/pan:new-project`, `/pan:milestone-new` |
| `pan-research-synthesizer` | Synthesizes parallel research outputs | `/pan:new-project` |
| `pan-roadmapper` | Creates phased roadmaps from requirements | `/pan:new-project`, `/pan:milestone-new` |
| `pan-document_code` | Analyzes existing codebase (6 focus areas) | `/pan:map-codebase` (x6 parallel) |
| `pan-phase-researcher` | Investigates how to implement a phase | `/pan:plan-phase` |
| `pan-planner` | Creates executable plan.md files | `/pan:plan-phase` |
| `pan-plan-checker` | Validates plans against goals across multiple dimensions | `/pan:plan-phase` |
| `pan-executor` | Executes plans with atomic commits | `/pan:exec-phase`, `/pan:quick` |
| `pan-verifier` | Verifies phase delivered what it promised | `/pan:exec-phase` |
| `pan-reviewer` | Read-only code review (conventions, security, quality) | `/pan:exec-phase` |
| `pan-integration-checker` | Verifies cross-phase wiring and E2E flows | `/pan:milestone-audit` |
| `pan-debugger` | Systematic bug investigation | `/pan:debug` |
| `pan-previewer` (v3.1+) | Foresight — blast radius / dependency graph / milestone ETA | `/pan:preview` |
| `pan-hardener` (v3.2+) | OWASP Top 10 + STRIDE security audit | `/pan:review-deep` |
| `pan-meta-reviewer` (v3.2+) | Reviews reviewer + hardener output; flags missed issues | `/pan:review-deep` |
| `pan-knowledge` (v3.2+) | Grounded Q&A / multi-turn discussion / playbook generation | `/pan:knowledge` |
| `pan-counterfactual` (v3.3+) | Explores alternative phase approaches in isolated worktree | `/pan:what-if` |
| `pan-conductor` (v3.4+) | Top-level hierarchical exec orchestrator with safety harness | `/pan:exec-phase --hierarchical` |
| `pan-optimizer` (v3.5+) | Reads trace events; identifies error/gap/redundancy patterns; produces ranked optimization report with auto-apply JSON block | `/pan:learn`, `/pan:optimize` |
| `pan-distiller` (v3.5+) | Read-only LLM judgment on AI code-bloat findings; receives only flagged spans (max 50 lines context); proposes minimal diff rewrite | `/pan:focus-auto --category distill` |
| `pan-experiment-runner` | Observation-only watchdog that drives an external AI session against an isolated experiment folder; reports back to the orchestrator | `/pan:experiment run` |
| `pan-release` (v3.11+) | Release squad agent: prepares the squash-merge, surfaces an always-ask approval; a human merges to the protected branch | `/pan:army` (Release squad) |

Every agent starts with zero context and receives only what it needs. This is PAN's key quality guarantee — agents never suffer from context degradation.

For deep dives on each agent's inputs, outputs, behaviors, and unique features, see [AGENTS.md](AGENTS.md).

---

## Layer 4: Core Library

**Location:** `pan-wizard-core/bin/lib/*.cjs`
**CLI entry:** `pan-wizard-core/bin/pan-tools.cjs`

The Node.js runtime layer. Zero external dependencies — only `node:` built-in modules (`fs`, `path`, `child_process`, `os`, `crypto`). Commands and workflows call `pan-tools.cjs` via bash and parse JSON output.

### CLI Interface

```
node pan-tools.cjs <command> [subcommand] [args...] [--raw] [--cwd <path>]
```

All output is JSON by default. Pass `--raw` for human-readable output. When JSON output exceeds ~50KB, it is written to a tmpfile and the path is returned with an `@file:` prefix.

### CLI Command Categories

The dispatcher in `pan-tools.cjs` routes top-level commands (plus `init` sub-cases) to the modules:

| Category | Example Commands |
|----------|-----------------|
| **State** | `state load`, `state update`, `state get`, `state json`, `state advance-plan`, `state record-metric` |
| **Phase** | `phase list`, `phase add`, `phase insert`, `phase remove`, `phase complete`, `phase next-decimal` |
| **Roadmap** | `roadmap get-phase`, `roadmap analyze`, `roadmap update-plan-progress` |
| **Config** | `config-get`, `config-set`, `config-ensure-section` |
| **Frontmatter** | `frontmatter get`, `frontmatter set`, `frontmatter merge`, `frontmatter validate` |
| **Template** | `template select`, `template fill` |
| **Scaffold** | `scaffold context`, `scaffold uat`, `scaffold verification`, `scaffold phase-dir` |
| **Verify** | `verify plan-structure`, `verify phase-completeness`, `verify references`, `verify artifacts`, `verify key-links` |
| **Validate** | `validate consistency`, `validate health` |
| **Init** | `init execute-phase`, `init plan-phase`, `init new-project`, `init quick`, `init progress` (compound commands for each major workflow) |
| **Milestone** | `milestone complete`, `requirements mark-complete` |
| **Focus** | `focus scan`, `focus plan`, `focus sync`, `focus exec`, `focus auto`, `focus design`, `focus classify-stages`, `focus reflection` |
| **Memory** (Opus 4.7, E-4) | `memory read`, `memory append`, `memory list`, `memory compact` |
| **Cache** (Opus 4.7, E-1) | `cache prime [--summary]` |
| **Codebase** (E-2 extended) | `codebase detect-languages`, `codebase analyze-imports`, `codebase best-practices`, `codebase estimate-size` |
| **Cost** (Spec B v2 Y-6, v3.0) | `cost report`, `cost append`, `cost clear` |
| **Bus** (Spec B v2 Y-7, v3.0) | `bus publish`, `bus drain`, `bus list` |
| **Preview** (Spec B v2 Y-1, v3.1) | `preview phase <N>`, `preview phases`, `preview milestone` |
| **Review-Deep** (Spec B v2 Y-2, v3.2) | `review-deep merge`, `review-deep analyze` |
| **Knowledge** (Spec B v2 Y-3, v3.2) | `knowledge ask`, `knowledge discuss`, `knowledge playbook` |
| **What-if** (Spec B v2 Y-4, v3.3) | `whatif prepare`, `whatif report`, `whatif cleanup` |
| **Bridge** (Spec B v2 Y-5, v3.3) | `bridge list`, `bridge recommend`, `bridge cache` |
| **Optimize** (v3.5) | `optimize trace init/end/current/list/log`, `optimize learn`, `optimize apply`, `optimize list`, `optimize stats`, `learn` (alias) |
| **Git** (v3.5) | `git commit`, `git branch`, `git push`, `git status`, `git log`, `git stash`, `git diff`, `git rollback`, `git tag`, `git sync` |
| **Distill** (v3.5) | `distill scan`, `distill analyze`, `distill report` |
| **Squads** (v3.11, ADR-0032) | `squad list`, `squad show <name>` |
| **Worktree** (v3.11, ADR-0033) | `worktree list`, `worktree create <task>`, `worktree remove <path>` |
| **Campaign** (v3.12, ADR-0034) | `campaign schedule`, `campaign status`, `campaign due`, `campaign record-run` |
| **HUD** (v3.12, ADR-0035) | `hud [--out <f>] [--open] [--stdout]` |
| **Standards** | `standards list`, `standards select`, `standards remove`, `standards status`, `standards recommend`, `standards phase-track`, `standards tools` |
| **Operations** | `preflight`, `dashboard`, `learnings extract`, `learnings list`, `learnings prune`, `deps validate` |
| **Utility** | `resolve-model`, `generate-slug`, `current-timestamp`, `context-budget`, `websearch`, `progress`, `todo` |

### Module Inventory

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `constants.cjs` | — | Shared path constants, file patterns, regex patterns. Foundation module. |
| `core.cjs` | — | Model profile table, `output()`/`error()` helpers, `toPosix()`, `safeReadFile()`, `loadConfig()`, `resolveModel()`, `findPhase()`, `generateSlug()`, `execGit()` |
| `utils.cjs` | — | Shared utilities: `readJsonFile()`, `planningPath()`, `listPhaseDirs()`, `filterPlanFiles()`, `filterSummaryFiles()`, `classifyPhaseStatus()`, `scanPendingTodos()` |
| `frontmatter.cjs` | — | YAML-like frontmatter CRUD: `extractFrontmatter()`, `reconstructFrontmatter()`, get/set/merge/validate |
| `config.cjs` | — | Config CRUD: create default `config.json`, get/set with dot-notation paths (e.g., `workflow.auto_advance`), standards catalog (list, select, remove, status, recommend, phase-track, tools) |
| `state.cjs` | — | state.md operations: load, get, update, patch, json output, `readStateSafe()`, frontmatter sync; writes serialize through lock.cjs (ADR-0030) |
| `lock.cjs` | — | Advisory file locking (`withFileLock`, stale-steal) + atomic temp-rename writes (`writeFileAtomic`) for .planning/ concurrency (ADR-0030) |
| `init.cjs` | — | Compound init commands: bootstrap all file paths and config for execute-phase, plan-phase, progress, phase-op, and the other major workflows |
| `phase.cjs` | — | Phase CRUD facade: list, add, insert (decimal numbering), complete, next-decimal; re-exports phase-remove.cjs |
| `phase-remove.cjs` | — | Phase removal + decimal/integer renumbering cascade, roadmap reference rewriting; extracted from phase.cjs |
| `roadmap.cjs` | — | roadmap.md parsing: get-phase, analyze, update-plan-progress |
| `verify.cjs` | — | Verification suite facade: verify-summary, validate-consistency, validate-health; re-exports the verify-* submodules below |
| `verify-drift.cjs` | — | Convention-drift detection (drift-check); extracted from verify.cjs |
| `verify-retro.cjs` | — | Milestone retrospective (retro); extracted from verify.cjs |
| `verify-deploy.cjs` | — | Deployment validation (validate deployment); extracted from verify.cjs |
| `verify-preflight.cjs` | — | Pre-execution gates (preflight, deps validate); extracted from verify.cjs |
| `milestone.cjs` | — | Milestone lifecycle: complete (archive roadmap/requirements, create milestones.md), requirements mark-complete |
| `commands.cjs` | — | Utility commands facade: history-digest, summary-extract, scaffold, progress, todo, websearch, commit, rollback-snapshot; re-exports commands-learnings.cjs |
| `commands-learnings.cjs` | — | Error patterns (PAT-NNN), session history, learnings (LEARN-NNN) lifecycle + shared phase-summary collector; extracted from commands.cjs |
| `template.cjs` | — | Template loading and fill from `pan-wizard-core/templates/` |
| `context-budget.cjs` | — | Context window utilization estimation: token counting, budget status (healthy/warning/critical), phase file scanning |
| `focus.cjs` | — | Strategic project management: work item scanning, priority classification, capacity-budgeted batch planning, doc staleness checking, execution pipeline data layer. Opus 4.7 additions: `classifyStageDependencies()`, `determineContinuation()` (reflection gate). |
| `codebase.cjs` | — | Codebase analysis: `detect-languages`, `analyze-imports`, `best-practices` scoring across 5 categories. Opus 4.7 addition: `estimateRepoTokenSize()` for single-shot mode decision. |
| `memory.cjs` | — | Cross-phase agent memory (E-4): `readMemory`, `appendMemory`, `compactMemory`, `listMemoryAgents`. Append-only files at `.planning/memory/<agent>.md`. Agent-name validated against `^[a-zA-Z0-9_-]+$` to block path traversal. |
| `bus.cjs` | — | (v3.0, Y-7) File-backed message channels at `.planning/bus/<channel>.jsonl`: `publish`, `readChannel`, `drain` (peek/consume/archive modes), `listChannels`. Agent audit trail for hierarchical exec and review-deep coordination. |
| `cost.cjs` | — | (v3.0, Y-6) Per-call cost aggregation: `appendRecord`, `readRecords`, `aggregate`, `computeCost`, `renderTable`, `renderChart`. Log at `.planning/metrics/tokens.jsonl`. Default rate table for Opus 4.7 / Sonnet 4.6 / Haiku 4.5 + tier fallbacks; override via `cost.rates` config. |
| `preview.cjs` | — | (v3.1, Y-1) Foresight data layer: `buildPhasePreview` (blast radius), `buildPhaseDependencyGraph` (mermaid DAG + Kahn parallel batches + hidden-dep detection), `buildMilestoneETA` (velocity + ETA + confidence + bottleneck). |
| `review-deep.cjs` | — | (v3.2, Y-2) Merges reviewer + hardener + meta-reviewer findings: `parseReviewFindings`, `mergeReviews` (verdict ladder), `writeDeepReview`. Publishes audit to `review-handoff` bus channel. |
| `knowledge.cjs` | — | (v3.2, Y-3) Grounded Q&A + session state + playbook: `ask` (keyword-scored retrieval over CITATION_ROOTS), `loadSession`/`appendTurn` (`.planning/conversations/<phase>/`), `buildPlaybook`/`writePlaybook` (clusters memory into categorized sections). |
| `whatif.cjs` | — | (v3.3, Y-4) Counterfactual phase replay: `scenarioSlug`, `buildCounterfactualContext`, `writeCounterfactualReport`, `createWorktree`/`cleanupWorktree` (git worktree lifecycle). Output at `.planning/counterfactuals/<phase>-<slug>.md`. |
| `bridge.cjs` | — | (v3.3, Y-5) MCP tool discovery + recommendation: `loadToolCache`/`writeToolCache`, `flattenTools`, `scoreToolForPhase`, `recommendForPhase`. Cache at `.planning/bridge/available-tools.json`. Discovery-only; auto-invocation deferred. |
| `optimize.cjs` | — | **(v3.5)** Circular optimization loop: `initTraceSession`, `logTraceEvent` (auto-inherits session phase per W3 fix), `analyzeEvents` (surfaces `reviewer_corrections` and `memory_primed_count`), `generateLocalReport`, `applyReportRecommendations` (auto-applies safe memory entries). Token telemetry falls back to wall-clock timing when `usage` block unavailable. |
| `git.cjs` | — | **(v3.5)** Phase-aware git workflow: `cmdGitCommit` (reuses `runCommitSafetyChecks`), `cmdGitBranch` (create/switch/list/delete with `pan/phase-N` naming), `cmdGitPush` (remote-validated, explicit `--force`), `cmdGitStatus`, `cmdGitLog`, `cmdGitStash` (named save/pop/list/drop), `cmdGitDiff`, `cmdGitRollback` (find pan-rollback-* tags + reset), `cmdGitTag`, `cmdGitSync` (pull + optional rebase). |
| `distill.cjs` | — | **(v3.5)** AI code-bloat 5-pass optimizer: Pass 1 deterministic (`findPhantomTryCatch`, `findUnusedImports`, `findMagicNumbers`, `findLongFunctions`, `findWideParamLists`), Pass 2 AST-style (`findSingleInstanceFactories`, `findDeepNesting`), Pass 3 cross-file (`findRepeatedBlocks`, `findUnreferencedExports`), Pass 4 LLM judgment via `pan-distiller` agent on flagged spans only, Pass 5 cross-session memory (`readPatternsMemory`, `writePatternsMemory`, `detectRegressedPatterns`). Bloat budget gate: `computeBloatBudget`. |
| `doc-lint.cjs` | — | Markdown frontmatter + structure linter (vendored from the whooo experiment). Adapter over `pan-wizard-core/bin/lib/doc-lint/{frontmatter,schema,validate,walk,reporter}.js`. Validates `commands/pan/*.md` and other PAN-shipped markdown against schemas in `pan-wizard-core/references/schemas/`. Subcommands: `doc-lint <dir>` (lint), `doc-lint schema-check` (verify schema yaml). |
| `experiment.cjs` | — | Self-improvement loop scaffolding. `newExperiment` (slug + idea path → scaffold `<root>/<slug>/.planning/`, copy idea, write manifest, optionally run installer), `listExperiments`, `getExperimentManifest`, `harvestExperiment` (extract learnings/, traces/, run-state, etc.), `pruneExperiment`. Hard `PAN_SOURCE_ROOT` guard prevents scaffolding inside the source repo. |
| `runner.cjs` | — | External agent runner. `runExperiment` spawns the runtime adapter (Claude/Codex/Gemini/OpenCode) via `spawnSync` against an experiment folder, observes via `run-state.json`, enforces timeout + circuit breaker. `RUNTIME_RUNNERS` adapter map (per-runtime headless invocation, `shell: 'win32'` for `.cmd` shims, arg quoting). The `captureMetrics: true` opt switches the claude adapter to `--output-format json` and `parseClaudeJsonEnvelope` extracts cost/turns/tokens into `runState.metrics`. Reads state.md milestone status to distinguish `success` from `incomplete`. |
| `learn-lint.cjs` | — | Learnings-store integrity linter for `pan-wizard-core/learnings/{universal,internal}/`. `lintLearnings({scope, strict})` runs L-001 (duplicate IDs across files), L-002 (dangling pattern cross-references), L-003 (empty `source_experiments` while body cites a known experiment), L-004 (universal-scope rule prose using PAN-internal terms), L-005 (revision marker `-rN` without `superseded_by` frontmatter on the base). Wired into `/check`. |
| `learn-index.cjs` | — | Learnings index + agent-relevance queries. `buildIndex()` walks both scopes and writes `pan-wizard-core/learnings/index.json` with topic→`{patterns, size_tokens_est, agent_relevance}` per topic; the curated `RELEVANCE` table assigns `high|medium|low` per `(topic, agent_role)` for `planner / executor / verifier / reviewer`. `topicsForAgent({agent, minRelevance, tokenBudget})` returns budget-aware topic selection. Workflow files (`plan-phase.md`, `exec-phase.md`, `verify-phase.md`, `execute-plan.md`) use it to load only relevant learnings instead of skim-the-folder. |
| `links.cjs` | — | **(v3.8.0)** Doc–code link graph (ADR-0027). `validateAll(cwd, opts)` runs three passes: forward links (inline `[[<id>]]` + `must_haves.key_links`) → finding codes F-001..F-004; backlink contract for docs with `require-code-mention: true` frontmatter → B-001/B-002; anchor-target existence for `// @pan: <id>` source comments → A-001/A-002/A-004. `resolveDocId` handles `ADR-NNNN` glob, relative `.md` paths, and `<doc>#section` slug match. `cmdLinksValidate` bypasses `core.output()` to preserve exit-1 on fail. Reuses `doc-lint/walk.js` and `frontmatter.cjs` — zero new dependencies. Wired into `validate health --links` for advisory pre-flight. |
| `squads.cjs` | — | **(v3.11, ADR-0032)** Bot-army squad registry + resolver: `SQUADS` (architecture/build/quality/release with tier + least-privilege access contract), `listSquads`, `getSquad`, `squadForAgent`, `validateRoster` (drift guard: every member is a real agent, every agent placed). `cmdSquadList` / `cmdSquadShow`. Registry only — modifies no agent and no execution path. |
| `worktree.cjs` | — | **(v3.11, ADR-0033)** Branch-per-agent isolation for the Build squad: `createTaskWorktree` / `removeTaskWorktree` / `listArmyWorktrees` (army/`<task>`-prefixed; removal refuses non-army branches). Generalized from `whatif.cjs`. `cmdWorktreeList` / `cmdWorktreeCreate` / `cmdWorktreeRemove`. |
| `campaign.cjs` | — | **(v3.12, ADR-0034)** Scheduled self-resuming campaigns: `parseCadence`, `writeSchedule`/`readSchedule`, `isRunDue` (enabled/paused/budget/next-due), `recordRun` (advance next-due + per-day spend), `isDreamDue`. Descriptor at `.planning/orchestration/schedule.json`. PAN owns the due-check; the host scheduler fires `/pan:army --continue`. Never relaxes the human merge gate. |
| `hud.cjs` | — | **(v3.12, ADR-0035)** Single-page HTML army + project dashboard. `collectHudData` (pure: aggregates state.md, roadmap/phases, squad registry, campaign schedule, army worktrees, cost ledger, requirements, verification, git log), `renderHud` (self-contained HTML — no server/network/external assets), `cmdHud`. A read-only **view**: owns no state, writes only `.planning/hud.html`. Army-only panels degrade gracefully when no campaign/worktrees exist. Reads `squads.cjs` + `campaign.cjs` + `worktree.cjs` + `cost.cjs`. |
| `skill-align.cjs` | — | **(v3.13, ADR-0038)** Skill-Aligned Decomposition pass. `buildSkillIndex(root)` walks commands/templates/references + learnings topics on the fly (nothing persisted); `alignTasks(root, tasks, opts)` scores draft planner tasks via `scoreRelevance` (glue-word stop-list, capped scoring head) and returns per-task top-k matches plus a deduped, token-budgeted `vocabulary` hint list with explicit `dropped` overflow. Advisory + fail-open: missing roots are skipped and reported. Used by `pan-planner`'s `skill_alignment` step. `cmdSkillsIndex` / `cmdSkillsAlign`. |
| `hygiene.cjs` | — | **(v3.13)** Project cleanup + version alignment. `scanHygiene` runs seven checks: per-runtime manifest version vs latest, untracked installs, legacy uppercase planning filenames, `.tmp` orphans, memory-log bloat, poisoned cost ledgers (via `cost.cjs isSuspectRecord`), stale trace sessions, fragment `.planning/` dirs. `cleanHygiene` applies only the safe subset (case-hop renames, orphan deletion, `compactMemory`, ledger quarantine-by-rename, trace pruning) — dry-run by default, `--apply` to execute; installer re-runs and fragment removal always stay manual. `cmdHygieneScan` / `cmdHygieneClean`. |

---

## Layer 5: Persistent State

**Location:** `.planning/` directory

Markdown and JSON files that survive context resets. This is the single source of truth for project state.

```
.planning/
  project.md            Project definition, scope, and constraints
  requirements.md       Scoped requirements with unique IDs (REQ-01, etc.)
  roadmap.md            Phase list with status, success criteria, progress
  state.md              Current execution state (frontmatter + body)
  config.json           User configuration (models, workflow toggles)
  milestones.md         Completed milestone archive
  patterns.md           Error patterns (PAT-NNN) for cross-session learning
  session-history.md    Session summaries (last 20 entries)
  research/             Domain research from /pan:new-project
    summary.md          Synthesized findings
    STACK.md            Recommended tech stack
    FEATURES.md         Feature prioritization
    ARCHITECTURE.md     Architecture patterns
    PITFALLS.md         Common pitfalls and warnings
  codebase/             Brownfield analysis from /pan:map-codebase
    STACK.md            Current tech stack
    INTEGRATIONS.md     External services and APIs
    ARCHITECTURE.md     System design and patterns
    STRUCTURE.md        Directory layout guide
    CONVENTIONS.md      Coding patterns and style
    TESTING.md          Test infrastructure and patterns
    CONCERNS.md         Tech debt and risks
    RELATIONSHIPS.md    Module and component dependency map
    BEST-PRACTICES.md   Recommended patterns for this codebase
  todos/
    pending/            Captured ideas awaiting work
    done/               Completed todos
  debug/                Active debug sessions
    resolved/           Archived debug sessions
  quick/                Quick mode task plans and summaries
  phases/
    XX-<slug>/
      context.md        Implementation preferences from discuss-phase
      research.md       Phase research (stack, features, arch, pitfalls)
      validation.md     Test coverage mapping (Nyquist layer)
      XX-YY-plan.md     Atomic execution plans
      XX-YY-summary.md  Post-execution summaries
      verification.md   Goal-backward verification results
      uat.md            User acceptance test results
```

### File Lifecycle

| File | Created By | Updated By | Read By |
|------|-----------|-----------|---------|
| `project.md` | `/pan:new-project` | — (immutable after creation) | All agents |
| `requirements.md` | `/pan:new-project` | `pan-roadmapper`, `pan-executor` (mark complete) | Planner, verifier |
| `roadmap.md` | `pan-roadmapper` | `pan-executor` (progress), phase commands | All agents |
| `state.md` | `pan-roadmapper` | `pan-executor`, pan-tools CLI | Orchestrators, agents |
| `config.json` | `/pan:new-project` | `/pan:settings` | Orchestrators (model resolution, workflow toggles) |
| `research.md` | `pan-phase-researcher` | — (immutable after creation) | `pan-planner` |
| `plan.md` | `pan-planner` | `pan-plan-checker` (via revision loop) | `pan-executor` |
| `summary.md` | `pan-executor` | — (immutable after creation) | `pan-verifier`, `pan-integration-checker` |
| `verification.md` | `pan-verifier` | Re-verification overwrites | `/pan:plan-phase --gaps` |
| `patterns.md` | `appendErrorPattern()` | `appendErrorPattern()` (auto-increment PAT-NNN) | `readErrorPatterns()`, `progress health` |
| `session-history.md` | `appendSessionSummary()` | `appendSessionSummary()` (keeps last 20) | `progress health` |

---

## Additional Components

### References

**Location:** `pan-wizard-core/references/*.md`

Context documents loaded by agents and workflows at runtime. These provide domain knowledge that agents need but that should not be baked into their system prompts.

| Reference | Purpose |
|-----------|---------|
| `checkpoints.md` | Checkpoint types and protocols for human interaction points |
| `continuation-format.md` | Standard format for presenting next steps after commands |
| `decimal-phase-calculation.md` | Algorithm for calculating next decimal phase number |
| `git-integration.md` | Git operations, commit format, branching strategies |
| `git-planning-commit.md` | How to commit `.planning/` artifacts (respects `commit_docs` config) |
| `model-profile-resolution.md` | How to resolve model profiles once at orchestration start |
| `model-profiles.md` | Model profile table (quality/balanced/budget per agent) |
| `phase-argument-parsing.md` | Normalize phase arguments across commands |
| `planning-config.md` | Configuration options for `.planning/` directory behavior |
| `questioning.md` | Project initialization philosophy: dream extraction, not requirements gathering |
| `tdd.md` | TDD patterns and red-green-refactor discipline |
| `ui-brand.md` | Visual patterns for user-facing output (stage banners, formatting) |
| `verification-patterns.md` | How to verify artifacts are real implementations, not stubs |

### Templates

**Location:** `pan-wizard-core/templates/`

Scaffold templates for all planning files. Used by the `template.cjs` module and the `scaffold` command to create properly structured files. Templates cover: project.md, roadmap.md, state.md, summaries (minimal/standard/complex), research outputs, codebase mapping, plans, verification, UAT, debug, discovery, milestones, retrospectives, and more.

### Hooks

**Location:** `hooks/` (source), `hooks/dist/` (compiled)

The shipped hooks (copied to `hooks/dist/` by `npm run build:hooks` — pure Node.js, zero deps, no bundling):

| Hook | Event Type | Function |
|------|-----------|----------|
| `pan-statusline.js` | statusLine | Writes context metrics to a bridge file for display |
| `pan-context-monitor.js` | PostToolUse | Reads bridge file, injects warnings when context is low (WARNING at ≤35%, CRITICAL at ≤25%) |
| `pan-check-update.js` | SessionStart | Background check for PAN updates with caching |
| `pan-cost-logger.js` (v3.4+) | SubagentStop | Appends subagent cost record to `.planning/metrics/tokens.jsonl` (consumed by `/pan:cost`) |
| `pan-trace-logger.js` (v3.5+) | SubagentStop | Appends decision/redundancy events to `.planning/optimization/traces/<session>/trace.jsonl` (consumed by `/pan:learn`, `/pan:optimize`); auto-creates day-scoped trace session |

The statusline hook produces metrics; the context monitor consumes them. They communicate through a bridge file (`/tmp/claude-ctx-{session_id}.json`) to avoid coupling. The two SubagentStop hooks (cost-logger and trace-logger) fire in parallel after every sub-agent completion and write to independent log files.

**Runtime support:** Claude Code and Gemini CLI register hooks in `settings.json`. Copilot CLI registers hooks in `.github/hooks/pan.json` (its `version: 1` schema with `type: "command"` entries and `sessionStart`/`postToolUse`/`subagentStop` events; since June 2026 — not `config.json`). Codex registers hooks in `.codex/hooks.json` (Claude-compatible PascalCase events, PAN entries merged non-destructively alongside any user hooks; loads once the project is trusted). The Copilot statusline registers in the documented settings read paths — `~/.copilot/settings.json` (global) or `.github/copilot/settings.json` (repo-level) — and is experimental on Copilot's side (`copilot --experimental`). OpenCode does not support hooks.

### Installer

**Location:** `bin/install.js`

Interactive CLI that copies commands, agents, hooks, and core library to the correct locations for each of the 5 supported runtimes. Handles format conversion at install time — no runtime conversion needed.

| Runtime | Target Directory (Global) | Target Directory (Local) | Format |
|---------|--------------------------|-------------------------|--------|
| Claude Code | `~/.claude/` | `.claude/` | `commands/pan/*.md`, `agents/*.md` |
| OpenCode | `~/.config/opencode/` | `.opencode/` | `commands/*.md`, `agents/*.md` |
| Gemini CLI | `~/.gemini/` | `.gemini/` | `commands/pan/*.toml`, `agents/*.md` |
| Codex | `~/.codex/` | `.codex/` | `.agents/skills/pan-*/SKILL.md` (shared tree, outside config dir), `agents/*.toml` |
| Copilot CLI | `~/.copilot/` | `.github/` | `skills/pan-*/SKILL.md`, `agents/*.agent.md` |

**Install-time conversions:**
- **Codex:** Commands converted to `SKILL.md` format with skill adapter headers
- **Copilot CLI:** Commands converted to `SKILL.md` with YAML frontmatter; agents converted to `.agent.md` with tools list; hooks registered in `.github/hooks/pan.json` (`version: 1` schema, `type: "command"` entries); tool names mapped (Claude → Copilot CLI: `Read→read`, `Bash→bash`, `Grep→search`, `WebSearch→web`, `Task→agent`, etc.)
- **OpenCode:** Slash command prefix converted from `/pan:` to `/pan-`

---

## Data Flow

### Example: `/pan:plan-phase 1`

A complete trace from user input to approved plans:

```
User                  Command                 Workflow
  |                     |                       |
  |  /pan:plan-phase 1  |                       |
  |-------------------->|                       |
  |                     |  read plan-phase.md   |
  |                     |---------------------->|
  |                     |                       |
  |                     |     pan-tools.cjs     |    Core Library
  |                     |     init plan-phase   |        |
  |                     |     "1"               |        |
  |                     |       +--------------------------->|
  |                     |       |  JSON: paths, config,  |  |
  |                     |       |  model assignments     |  |
  |                     |       |<---------------------------|
  |                     |                       |
  |                     |  spawn                |    Agents
  |                     |  pan-phase-researcher |        |
  |                     |       +--------------------------->|
  |                     |       |  write research.md     |  |
  |                     |       |<---------------------------|
  |                     |                       |
  |                     |  spawn pan-planner    |        |
  |                     |  with project.md +    |        |
  |                     |  requirements.md +    |        |
  |                     |  context.md +         |        |
  |                     |  research.md          |        |
  |                     |       +--------------------------->|
  |                     |       |  create plan.md        |  |
  |                     |       |<---------------------------|
  |                     |                       |
  |                     |  spawn                |        |
  |                     |  pan-plan-checker     |        |
  |                     |       +--------------------------->|
  |                     |       |  pass / fail           |  |
  |                     |       |<---------------------------|
  |                     |                       |
  |                     |  if fail: loop back   |
  |                     |  to planner (max 3x)  |
  |                     |                       |
  |  Plans approved     |                       |
  |<--------------------|                       |
```

**Step by step:**

1. User types `/pan:plan-phase 1`
2. Claude reads `commands/pan/plan-phase.md`
3. Command references workflow: `pan-wizard-core/workflows/plan-phase.md`
4. Workflow calls `pan-tools.cjs init plan-phase "1"` to bootstrap context
5. pan-tools returns JSON with all file paths, config, and model assignments
6. Workflow spawns `pan-phase-researcher` agent to investigate the phase's domain
7. Researchers write research.md (and optionally validation.md if Nyquist enabled)
8. Workflow spawns `pan-planner` with project.md + requirements.md + context.md + research.md
9. Planner creates plan.md files (typically 2-3 per phase)
10. Workflow spawns `pan-plan-checker` to validate plans across multiple dimensions
11. If checker finds blockers, loop back to planner with feedback (up to 3 iterations)
12. Plans approved — phase is ready for `/pan:exec-phase`

### Example: `/pan:exec-phase 1`

```
User                  Workflow                   Agents
  |                     |                          |
  |  /pan:exec-phase |                          |
  |-------------------->|                          |
  |                     |  init execute-phase "1"  |
  |                     |  → JSON: plans, waves    |
  |                     |                          |
  |                     |  Wave 1 (parallel):      |
  |                     |    pan-executor Plan-01 ----------->| commit
  |                     |    pan-executor Plan-02 ----------->| commit
  |                     |                          |
  |                     |  Wave 2 (sequential):    |
  |                     |    pan-executor Plan-03 ----------->| commit
  |                     |                          |
  |                     |  Post-execution:         |
  |                     |    pan-verifier ---------------------->|
  |                     |    → verification.md     |          |
  |                     |                          |
  |  Phase complete     |                          |
  |<--------------------|                          |
```

---

## Module Dependency Graph

```
pan-tools.cjs (CLI entry point — routes to all modules)
  │
  │  LAYER 1: Foundation (no internal deps)
  ├── constants.cjs
  │
  │  LAYER 2: Core (depends on constants + Node.js builtins)
  ├── core.cjs
  │     └── (no internal deps — uses node:fs, node:path, node:child_process)
  │
  │  LAYER 3: Utilities (depends on constants, core)
  ├── utils.cjs
  │     └── constants.cjs
  │
  │  LAYER 4: Functional modules
  ├── frontmatter.cjs
  │     ├── core.cjs
  │     └── constants.cjs
  │
  ├── config.cjs
  │     ├── core.cjs
  │     ├── constants.cjs
  │     └── utils.cjs
  │
  ├── context-budget.cjs
  │     ├── core.cjs
  │     ├── utils.cjs
  │     └── constants.cjs
  │
  ├── roadmap.cjs
  │     ├── core.cjs
  │     ├── constants.cjs
  │     └── utils.cjs
  │
  ├── state.cjs
  │     ├── core.cjs
  │     ├── frontmatter.cjs
  │     ├── constants.cjs
  │     └── utils.cjs
  │
  ├── template.cjs
  │     ├── core.cjs
  │     ├── constants.cjs
  │     ├── utils.cjs
  │     └── frontmatter.cjs
  │
  ├── verify.cjs (facade)
  │     ├── core.cjs
  │     ├── frontmatter.cjs
  │     ├── state.cjs
  │     ├── constants.cjs
  │     ├── utils.cjs
  │     └── verify-{drift,retro,deploy,preflight}.cjs (re-exported)
  │
  ├── phase.cjs (facade)
  │     ├── core.cjs
  │     ├── frontmatter.cjs
  │     ├── state.cjs
  │     ├── constants.cjs
  │     ├── utils.cjs
  │     └── phase-remove.cjs (re-exported)
  │
  ├── milestone.cjs
  │     ├── core.cjs
  │     ├── frontmatter.cjs
  │     ├── state.cjs
  │     ├── constants.cjs
  │     └── utils.cjs
  │
  │  LAYER 5: Aggregator modules (depend on multiple Layer 4 modules)
  ├── commands.cjs
  │     ├── core.cjs
  │     ├── frontmatter.cjs
  │     ├── constants.cjs
  │     ├── utils.cjs
  │     └── context-budget.cjs
  │
  ├── focus.cjs
  │     ├── core.cjs
  │     ├── constants.cjs
  │     ├── frontmatter.cjs
  │     ├── roadmap.cjs
  │     ├── commands.cjs
  │     └── utils.cjs
  │
  └── init.cjs
        ├── core.cjs
        ├── constants.cjs
        ├── roadmap.cjs
        └── utils.cjs

  │  LAYER 6: Spec B v2 modules (v3.0–v3.4) — leaf modules
  ├── bus.cjs            (depends on: core, constants, utils)
  ├── cost.cjs           (depends on: core, constants, utils)
  ├── preview.cjs        (depends on: utils, frontmatter, verify)
  ├── review-deep.cjs    (depends on: core, constants, utils)
  ├── knowledge.cjs      (depends on: core, constants, utils)
  ├── whatif.cjs         (depends on: core, constants, utils)
  ├── bridge.cjs         (depends on: core, constants, utils)
  ├── codebase.cjs       (depends on: core, constants, utils)
  ├── memory.cjs         (depends on: core, constants, utils)
  │
  │  LAYER 7: v3.5 modules — leaf modules
  ├── optimize.cjs       (depends on: core, constants)
  ├── git.cjs            (depends on: core, commands — for runCommitSafetyChecks reuse)
  ├── distill.cjs        (depends on: core)
  │
  │  LAYER 8: concurrency + bot army (ADR-0030/0032/0033/0034/0035)
  ├── lock.cjs           (depends on: Node builtins only — used by state.cjs)
  ├── squads.cjs         (depends on: core — registry, no agent/exec coupling)
  ├── worktree.cjs       (depends on: core — git worktree lifecycle)
  ├── campaign.cjs       (depends on: core, constants — schedule descriptor)
  ├── hud.cjs            (depends on: core, constants, utils, squads, campaign, worktree, cost — read-only aggregating view)
  │
  │  LAYER 9: v3.13 modules
  ├── skill-align.cjs    (depends on: core, constants, knowledge — scoreRelevance reuse, learn-index — topics)
  └── hygiene.cjs        (depends on: core, constants, utils, memory — compaction, cost — suspect-record quarantine)
```

**Key observations:**
- `constants.cjs` is the true foundation — required by every other module
- `core.cjs` has no internal dependencies (only Node.js builtins) and provides the `output()`/`error()` I/O contract
- `frontmatter.cjs` is widely depended upon (state, verify, phase, milestone, commands, template all use it)
- Layer 6 (Spec B v2) and Layer 7 (v3.5) modules are mostly leaves — they read shared infrastructure but do not have downstream consumers, so they can be added/removed without rippling through the graph
- `git.cjs` reuses `runCommitSafetyChecks` from `commands.cjs` (the only v3.5 module with a non-core internal dependency)
- No circular dependencies exist — the graph is a clean DAG
- `pan-tools.cjs` requires every module but is itself a script (no `module.exports`)

---

## Cross-Platform Runtime Support

PAN installs to 5 runtimes with format conversion at install time. The core workflow is identical across all — only the file format and invocation syntax differ.

### Command Syntax by Runtime

| Runtime | Prefix | Example |
|---------|--------|---------|
| Claude Code | `/pan:` | `/pan:new-project` |
| OpenCode | `/pan-` | `/pan-new-project` |
| Gemini CLI | `/pan:` | `/pan:new-project` |
| Codex | `$pan-` | `$pan-new-project` |
| Copilot CLI | `/pan-` | `/pan-new-project` |

### File Format by Runtime

| Component | Claude / OpenCode / Gemini | Codex | Copilot CLI |
|-----------|---------------------------|-------|-------------|
| Commands | `commands/pan/*.md` | `.agents/skills/pan-*/SKILL.md` | `skills/pan-*/SKILL.md` |
| Agents | `agents/*.md` | `agents/*.toml` | `agents/*.agent.md` |
| Hooks | `hooks/*.js` in `settings.json` | Not supported | `hooks/*.js` in `.github/hooks/pan.json` |
| Config | `settings.json` | `config.toml` | `config.json` |

### Tool Name Mapping (Copilot CLI)

Copilot CLI uses different tool names than Claude Code. The installer maps them at install time:

| Claude Code | Copilot CLI |
|------------|-------------|
| Read | read |
| Write, Edit | edit |
| Bash | bash |
| Glob | glob |
| Grep | search |
| WebSearch, WebFetch | web |
| TodoWrite | todo |
| Task (Agent) | agent |

---

## Key Design Decisions

### 1. CommonJS (.cjs), not ESM

Claude Code's `node:test` runner and the hook copy pipeline work more reliably with CommonJS. All library modules use the `.cjs` extension to make this explicit and avoid ambiguity with package.json `type` settings.

### 2. Zero Runtime Dependencies

The core library uses only `node:` built-in modules (`node:fs`, `node:path`, `node:child_process`, `node:os`, `node:crypto`). This keeps installation fast, eliminates supply chain risk, and ensures the tool works offline after install.

### 3. Markdown-as-Code

Commands, workflows, agents, and references are all Markdown files. They are not executed by a runtime — they are "executed" by being read into the AI's context window. This means:

- No parser to maintain
- Authors write in natural language with XML structure markers
- Version control diffs are human-readable
- Any text editor can modify the system's behavior

### 4. JSON CLI Bridge

Workflows call `pan-tools.cjs` via bash and parse the JSON output. This keeps the Node.js layer thin and independently testable. The CLI never maintains state between invocations — every call is stateless, reading from and writing to `.planning/` files.

### 5. Cross-Platform Path Handling

`toPosix()` in `core.cjs` normalizes all file paths to forward slashes in JSON output. File-based input (reading arguments from files rather than command-line strings) avoids `$` shell expansion issues across Windows, Linux, and macOS.

### 6. Large Output Handling

When JSON output from `pan-tools.cjs` exceeds approximately 50KB, it is written to a temporary file and the file path is returned with an `@file:` prefix. This prevents shell buffer overflow and keeps context consumption predictable.

### 7. Model Resolution via "inherit"

`resolveModel()` returns `"inherit"` for opus-tier agents instead of a literal model string like `"opus"`. This lets the runtime use whatever opus version the user has configured in their environment, rather than hard-coding a specific model identifier.

### 8. Install-Time Format Conversion

All format differences between runtimes (SKILL.md vs commands/*.md, .agent.md vs .md, tool name mappings, hook config format) are resolved at install time by the installer. The core library and agents never need to know which runtime they're running on — the format is already correct.

### 9. File-Mediated Agent Communication

Agents never communicate directly. All data flows through `.planning/` files on disk. This makes every intermediate artifact inspectable, enables parallel execution (researchers, mappers, executors), and means failed agents can be re-run without losing sibling work. See [AGENTS.md](AGENTS.md#how-agents-collaborate) for details.

### 10. Layered Architecture with Strict Boundaries

- Commands (Layer 1) never call core library directly — they go through workflows
- Workflows (Layer 2) never import agent `.md` files — they spawn agents via Task tool
- Agents (Layer 3) never import other agents — they communicate via `.planning/` files
- Core modules (Layer 4) never call `output()` from helper functions — only from `cmd*` entry points
- No upward dependencies (a core module never requires pan-tools.cjs)
