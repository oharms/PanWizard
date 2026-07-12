<div align="center">
<img src="../assets/pan-avatar.png" alt="PanWizard" width="90" />
</div>

# PAN User Guide

A detailed reference for workflows, troubleshooting, and configuration. For quick-start setup, see the [README](../README.md).

**Other docs:** [FAQ](FAQ.md) · [Examples](EXAMPLES.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md) · [CLI Reference](CLI-REFERENCE.md) · [Agents](AGENTS.md) · [Hooks](HOOKS.md)

---

## Table of Contents

- [Getting Started](#getting-started)
- [Workflow Diagrams](#workflow-diagrams)
- [Command Reference](#command-reference)
- [Configuration Reference](#configuration-reference)
- [Usage Examples](#usage-examples)
- [Advanced Features](#advanced-features)
  - [Advanced Planning Options](#advanced-planning-options)
  - [Execution Model](#execution-model)
  - [Bot-army campaigns](#bot-army-campaigns-panarmy)
  - [Army & project dashboard](#army--project-dashboard-panhud)
  - [Git Integration](#git-integration)
  - [Requirement Tracing](#requirement-tracing)
  - [Global Defaults](#global-defaults)
  - [Web Search](#web-search)
- [Troubleshooting](#troubleshooting)
- [Multi-Runtime Reference](#multi-runtime-reference)
- [Recovery Quick Reference](#recovery-quick-reference)
- [Project File Structure](#project-file-structure)

---

## Getting Started

A step-by-step walkthrough of your first PAN project, from initialization to verification.

### Step 1: Initialize a New Project

```
/pan:new-project
```

PAN asks you questions about your project — what you're building, who it's for, and what success looks like. This is a collaborative conversation, not a form.

**What gets created:**
- `.planning/project.md` — Your project brief
- `.planning/requirements.md` — Scoped requirements with REQ-IDs
- `.planning/roadmap.md` — Phased delivery plan
- `.planning/config.json` — Project configuration
- `.planning/state.md` — Progress tracker

### Step 2: Plan a Phase

```
/pan:plan-phase 1
```

PAN researches how to implement Phase 1, creates detailed execution plans with specific tasks, and validates them through a quality checker. Each plan targets a single concern with 2-3 atomic tasks.

**What gets created:**
- `.planning/phases/01-{name}/01-01-plan.md` — First execution plan
- Additional `{phase}-{plan}-plan.md` files if the phase needs multiple plans

**Optional:** Run `/pan:discuss-phase 1` first to have PAN ask clarifying questions about your approach before planning.

### Step 3: Execute the Phase

```
/pan:exec-phase 1
```

PAN executes each plan's tasks in wave order — independent plans run in parallel, dependent plans run sequentially. Each task produces a git commit. If something breaks, PAN auto-fixes it (up to 3 attempts per task).

**What gets created:**
- Your actual project files (code, config, etc.)
- `.planning/phases/01-{name}/01-01-summary.md` — Execution report per plan
- Git commits for each completed task

### Step 4: Verify the Work

```
/pan:verify-phase 1
```

PAN performs user acceptance testing — checking that what was built matches what was planned. If issues are found, PAN creates fix plans that you can execute immediately.

**What gets created:**
- `.planning/phases/01-{name}/verification.md` — Verification results
- Fix plans (if issues found)

### Step 5: Check Progress and Continue

```
/pan:progress
```

Shows your overall project status and tells you what to do next — plan the next phase, execute remaining plans, or verify completed work.

**Typical flow from here:**
- Plan the next phase: `/pan:plan-phase 2`
- If you need to pause: `/pan:pause`
- If you're resuming later: `/pan:resume`

### Tips for Your First Project

- **Start small** — Pick a project with 3-5 phases for your first run
- **Use `/pan:discuss-phase`** before planning if you're unsure about approach
- **Check `/pan:progress`** whenever you lose track of where you are
- **Use the `balanced` profile** (default) — it balances cost and quality well
- **Run `/clear`** between major commands to keep context fresh

### Opus 4.7 features (v2.10.0+)

If you're running on Claude Opus 4.7, PAN uses these automatically:

- **Prompt caching** — project.md, requirements.md, roadmap.md, state.md, standards.md are cached across agent calls in a phase. Expect 40-60% input-token savings on multi-wave execution.
- **Extended thinking** — `pan-plan-checker`, `pan-verifier`, `pan-reviewer`, `pan-debugger`, and `pan-integration-checker` reason internally before acting. Catches logic gaps earlier.
- **Single-shot map-codebase** — repos ≤700K tokens map in a single agent instead of 6 parallel ones. No more contradictory version claims in the output.
- **Cross-phase memory** — lessons learned in phase 3 (e.g. "prefer bulk Postgres writes") surface automatically in phase 7's planner. Inspect with `pan-tools memory list`. Trim with `pan-tools memory compact <agent> <max>`.
- **Milestone retrospective with memory write** — `/pan:retro --write-memory` extracts recurring gap patterns as planner lessons. Run after every `/pan:milestone-done`.
- **Capability-aware routing** — when a task needs thinking, the fast tier auto-upgrades to mid; when cache is warm and context is small, mid auto-downgrades to fast. See `/pan:profile` for the decision tree.
- **Native skills discovery** — Claude Code sees PAN commands as first-class skills at `.claude/skills/pan-*.md` with descriptions, so it can auto-invoke them when relevant.

On Sonnet 4.6 / Haiku 4.5 / non-Claude runtimes, features degrade gracefully: thinking becomes a prose "think step-by-step" preamble, single-shot falls back to sharded, caching is a no-op. Installer warns at install time if your default model lacks Opus 4.7 features.

### Spec B v2 features (v3.0-v3.4)

Spec B v2 (v3.0-v3.4) added a wave of new commands. Each has a clear single purpose. None modify the focus system. v3.5 added three more commands (`/pan:learn`, `/pan:optimize`, `/pan:git`) and two new focus-auto categories (`security`, `distill`).

- **`/pan:cost` (v3.0)** — token usage + estimated cost across all PAN invocations. Three output formats (`json`/`table`/`chart`). Auto-populated since v3.4 by the SubagentStop hook; no manual instrumentation needed. Time-windowed with `--since YYYY-MM-DD --until YYYY-MM-DD`.
- **`/pan:preview phase <N> | phases | milestone` (v3.1)** — read-only foresight. Three modes:
  - `phase N` — blast radius (files likely touched, tests at risk, risk score 1-10, migration flags)
  - `phases` — dependency graph (mermaid DAG + parallel batches + hidden coupling)
  - `milestone` — ETA with confidence + bottleneck identification
- **`/pan:review-deep <phase>` (v3.2)** — security audit (OWASP + STRIDE via `pan-hardener`) + cross-check by `pan-meta-reviewer`. Merges reviewer + hardener + meta findings into one verdict ladder. Recommended for phases touching auth/payment/PII/migrations/public APIs. Also invokable as `/pan:exec-phase <N> --deep-review` or `/pan:focus-exec --deep-review`. Costs ~3× a normal review.
- **`/pan:knowledge {ask|discuss|playbook}` (v3.2)** — three modes in one command:
  - `ask "question"` — grounded Q&A with inline citations. Example: `/pan:knowledge ask "why does phase 4 have a race condition fix?"`
  - `discuss <phase> "topic"` — multi-turn refinement with session state persistence. Benefits from prompt caching on Claude + Opus 4.7.
  - `playbook` — aggregate all agents' memory into `.planning/playbook.md` categorized by Conventions / Gotchas / Decisions / Tool choices / Anti-patterns / Recurring gaps.
- **`/pan:what-if <phase> "scenario"` (v3.3)** — counterfactual phase replay in an isolated git worktree. Agent explores the alternative, report lands in `.planning/counterfactuals/<phase>-<slug>.md`, worktree auto-deleted. Requires git.
- **`/pan:mcp-bridge {list|recommend <phase>|cache}` (v3.3)** — discover which MCP tools are available and recommend which apply to a phase plan. Discovery-only; auto-invocation deferred.

#### Advanced features

- **`--hierarchical` flag on `/pan:exec-phase` (v3.4)** — spawn `pan-conductor` as a top-level orchestrator that decomposes the phase and spawns executor/reviewer/verifier sub-agents in waves. Bounded by a safety harness (2-level nesting, 12-spawn cap, budget ceiling, abort file). Claude + Opus 4.7 only; falls back silently to flat exec elsewhere. Use for phases with ≥4 autonomous plans where wall-clock reduction justifies the ~20-30% orchestration tax.
- **`--deep-review` flag on `/pan:exec-phase` and `/pan:focus-exec` (v3.4)** — auto-invoke `/pan:review-deep` after the normal reviewer step. Recommended for high-stakes batches.
- **Automatic cost logging (v3.4)** — `hooks/pan-cost-logger.js` registered as a SubagentStop hook. Every sub-agent completion appends a record to `.planning/metrics/tokens.jsonl`. Visible in `/pan:cost report` without any manual `cost append` calls.

All Spec B v2 commands interoperate with the focus system via read boundaries and optional flags — no focus command was modified.

---

## Workflow Diagrams

### Full Project Lifecycle

```
  ┌──────────────────────────────────────────────────┐
  │                   NEW PROJECT                    │
  │  /pan:new-project                                │
  │  Questions -> Research -> Requirements -> Roadmap│
  └─────────────────────────┬────────────────────────┘
                            │
             ┌──────────────▼─────────────┐
             │      FOR EACH PHASE:       │
             │                            │
             │  ┌────────────────────┐    │
             │  │ /pan:discuss-phase │    │  <- Lock in preferences
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ /pan:plan-phase    │    │  <- Research + Plan + Verify
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ /pan:exec-phase │    │  <- Parallel execution
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ /pan:verify-phase   │    │  <- Manual UAT
             │  └──────────┬─────────┘    │
             │             │              │
             │     Next Phase?────────────┘
             │             │ No
             └─────────────┼──────────────┘
                            │
            ┌───────────────▼──────────────┐
            │  /pan:milestone-audit        │
            │  /pan:milestone-done     │
            └───────────────┬──────────────┘
                            │
                   Another milestone?
                       │          │
                      Yes         No -> Done!
                       │
               ┌───────▼──────────────┐
               │  /pan:milestone-new  │
               └──────────────────────┘
```

### Planning Agent Coordination

```
  /pan:plan-phase N
         │
         ├── Phase Researcher
         │           │
         │     ┌──────▼──────┐
         │     │ research.md │
         │     └──────┬──────┘
         │            │
         │     ┌──────▼──────┐
         │     │   Planner   │  <- Reads project.md, requirements.md,
         │     │             │     context.md, research.md
         │     └──────┬──────┘
         │            │
         │     ┌──────▼───────────┐     ┌────────┐
         │     │   Plan Checker   │────>│ PASS?  │
         │     └──────────────────┘     └───┬────┘
         │                                  │
         │                             Yes  │  No
         │                              │   │   │
         │                              │   └───┘  (loop, up to 3x)
         │                              │
         │                        ┌─────▼──────┐
         │                        │ PLAN files │
         │                        └────────────┘
         └── Done
```

### Validation Architecture (Nyquist Layer)

When the Nyquist layer is enabled (`workflow.nyquist_validation` — **off by
default**; see below), plan-phase research maps automated test coverage to each
phase requirement before any code is written. This ensures that when Claude's
executor commits a task, a feedback mechanism already exists to verify it within seconds.

The researcher detects your existing test infrastructure, maps each requirement to
a specific test command, and identifies any test scaffolding that must be created
before implementation begins (Wave 0 tasks).

With it enabled, the plan-checker treats test coverage as an additional verification
dimension: plans whose tasks lack automated verify commands are sent back for revision.

**Output:** `{phase}-validation.md` -- the feedback contract for the phase.

**Enable:** Set `workflow.nyquist_validation: true` in `/pan:settings`. It ships
off by default; turn it on for phases where planning test coverage up front matters.

### Execution Wave Coordination

```
  /pan:exec-phase N
         │
         ├── Analyze plan dependencies
         │
         ├── Wave 1 (independent plans):
         │     ├── Executor A (fresh 200K context) -> commit
         │     └── Executor B (fresh 200K context) -> commit
         │
         ├── Wave 2 (depends on Wave 1):
         │     └── Executor C (fresh 200K context) -> commit
         │
         └── Verifier
               └── Check codebase against phase goals
                     │
                     ├── PASS -> verification.md (success)
                     └── FAIL -> Issues logged for /pan:verify-phase
```

### Brownfield Workflow (Existing Codebase)

```
  /pan:map-codebase
         │
         ├── Stack Mapper     -> codebase/STACK.md
         ├── Arch Mapper      -> codebase/ARCHITECTURE.md
         ├── Convention Mapper -> codebase/CONVENTIONS.md
         └── Concern Mapper   -> codebase/CONCERNS.md
                │
        ┌───────▼──────────┐
        │ /pan:new-project │  <- Questions focus on what you're ADDING
        └──────────────────┘
```

---

## Command Reference

### Core Workflow

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:new-project` | Full project init: questions, research, requirements, roadmap | Start of a new project |
| `/pan:new-project --auto @idea.md` | Automated init from document | Have a PRD or idea doc ready |
| `/pan:discuss-phase [N]` | Capture implementation decisions | Before planning, to shape how it gets built |
| `/pan:plan-phase [N]` | Research + plan + verify | Before executing a phase |
| `/pan:exec-phase <N>` | Execute all plans in parallel waves | After planning is complete |
| `/pan:verify-phase [N]` | Manual UAT with auto-diagnosis | After execution completes |
| `/pan:milestone-audit` | Verify milestone met its definition of done | Before completing milestone |
| `/pan:milestone-done` | Archive milestone, tag release | All phases verified |
| `/pan:milestone-new [name]` | Start next version cycle | After completing a milestone |

### Navigation

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:progress` | Show status and next steps | Anytime -- "where am I?" |
| `/pan:resume` | Restore full context from last session | Starting a new session |
| `/pan:pause` | Save context handoff | Stopping mid-phase |
| `/pan:help` | Show all commands | Quick reference |
| `/pan:update` | Update PAN with changelog preview | Check for new versions |
| `/pan:discord` | Open Discord community invite | Questions or community |

### Phase Management

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:add-phase` | Append new phase to roadmap | Scope grows after initial planning |
| `/pan:insert-phase [N]` | Insert urgent work (decimal numbering) | Urgent fix mid-milestone |
| `/pan:remove-phase [N]` | Remove future phase and renumber | Descoping a feature |
| `/pan:assumptions [N]` | Preview Claude's intended approach | Before planning, to validate direction |
| `/pan:milestone-gaps` | Create phases for audit gaps | After audit finds missing items |
| `/pan:research-phase [N]` | Deep ecosystem research only | Complex or unfamiliar domain |

### Brownfield & Utilities

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:map-codebase` | Analyze existing codebase | Before `/pan:new-project` on existing code |
| `/pan:quick` | Ad-hoc task with PAN guarantees | Bug fixes, small features, config changes |
| `/pan:debug [desc]` | Systematic debugging with persistent state | When something breaks |
| `/pan:todo-add [desc]` | Capture an idea for later | Think of something during a session |
| `/pan:todo-check` | List pending todos | Review captured ideas |
| `/pan:settings` | Configure workflow toggles and model profile | Change model, toggle agents |
| `/pan:profile <profile>` | Quick profile switch | Change cost/quality tradeoff |
| `/pan:patches` | Restore local modifications after update | After `/pan:update` if you had local edits |
| `/pan:phase-budget` | Estimate context window utilization | Monitor context health during execution |
| `/pan:health [--repair]` | Validate `.planning/` directory integrity | Diagnose and auto-repair directory issues |
| `/pan:hygiene [--apply]` | Scan for PAN version drift + stale artifacts (legacy filenames, memory bloat, poisoned ledgers, trace debris); `--apply` executes the safe fixes | Keep older projects aligned with the latest PAN |
| `/pan:phase-tests [N]` | Generate tests for a completed phase | After execution, to add test coverage |
| `/pan:milestone-cleanup` | Archive old phase directories from completed milestones | After completing a milestone |
| `/pan:retro` | Milestone retrospective — estimation accuracy, gap patterns | After `/pan:milestone-done` |
| `/pan:audit-deployment` | Audit a PAN installation for integrity | Verify install/update didn't drift |
| `/pan:links [--strict]` | Validate the doc–code link graph: inline `[[<id>]]` refs, `// @pan:` source anchors, `require-code-mention` contracts (ADR-0027, v3.8.0+) | Renamed an ADR or moved a module — catch broken refs |

### Spec B v2 (v3.0–v3.4)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:cost` | Token usage + estimated cost report (json/table/chart) | Track AI costs across phases |
| `/pan:preview <phase\|phases\|milestone>` | Read-only foresight: blast radius / dependency graph / milestone ETA | Before exec — "what will this touch?" |
| `/pan:review-deep <phase>` | Security audit (OWASP+STRIDE) + cross-checked by meta-reviewer | High-stakes phases (auth/payments/PII) |
| `/pan:knowledge {ask\|discuss\|playbook}` | Grounded Q&A, multi-turn discussion, or aggregate memory into playbook | Reflection or design discussion |
| `/pan:what-if <phase> "scenario"` | Counterfactual phase replay in isolated git worktree | Explore an alternative approach safely |
| `/pan:mcp-bridge {list\|recommend\|cache}` | Discover MCP tools and recommend per-phase relevance | Before phases that might need external integrations |

### Optimization & Git (v3.5)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:learn` | Analyze the most recent trace session, generate optimization report | After a phase or campaign — "what can PAN learn?" |
| `/pan:optimize {apply\|list\|stats\|trace}` | Apply optimizer recommendations, list reports, view stats, manage trace sessions | Persist learnings into memory for future sessions |
| `/pan:git <subcommand>` | Phase-aware git workflow with safety guardrails (commit/branch/push/status/log/stash/diff/rollback/tag/sync) | Day-to-day git ops with branch-name conventions and safety checks |

### Operations (Pre-Flight, Dashboard, Learnings, Dependencies)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `pan-tools preflight [target]` | Validate state, blockers, git, config before execution | Before starting work: "am I ready?" |
| `pan-tools dashboard` | Aggregated project overview (JSON/text; for the visual HTML version see [`/pan:hud`](#army--project-dashboard-panhud)) | Quick status check: "where am I?" |
| `pan-tools learnings extract` | Auto-extract patterns from sessions and errors | After sessions: capture what you learned |
| `pan-tools learnings list` | List all extracted learnings | Review accumulated project knowledge |
| `pan-tools learnings prune --days N` | Remove old learnings | Housekeeping: keep learnings relevant |
| `pan-tools deps validate` | Cross-reference roadmap vs disk, find orphaned requirements | Project health: "is my plan consistent?" |

**Typical workflow:**
```
pan-tools preflight              # Ready to work?
pan-tools dashboard              # Where am I?
pan-tools deps validate          # Roadmap consistent with reality?
pan-tools learnings extract      # Capture patterns from recent sessions
pan-tools learnings list --raw   # Review what's been learned
```

### Focus (Strategic Project Management)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pan:focus-scan` | Collect and classify all work items with priority and Reality Score | Strategic planning: "what needs doing?" |
| `/pan:focus-plan` | Create capacity-budgeted execution batch | Session planning: "what should I do next?" |
| `/pan:focus-exec` | Execute items from batch with tier-based cadence | Session execution: guided implementation |
| `/pan:focus-auto` | Continuous scan→plan→exec loop with 5-layer safety harness | Hands-off batch work across categories |
| `/pan:focus-sync` | Detect stale documentation counts | After changes: verify docs match code |
| `/pan:focus-design` | 10-phase strategic feature investigation | Before building a new feature |
| `/pan:focus-drift-walking` | Walk project tree, detect doc-code drift, score severity, auto-repair | Documentation hygiene: "are my docs lying?" |
| `/pan:focus-doc-audit` | Multi-dimensional document audit with 8-dimension quality scoring | Quality assurance: "how trustworthy are my docs?" |

**Focus workflow:** `focus-scan` → `focus-plan` → `focus-exec` → `focus-sync`. Scan collects work from phases, todos, and error patterns. Plan budgets items using one of 4 modes (bugfix/balanced/features/full). Exec provides the execution pipeline. Sync verifies documentation stays current. Or use `focus-auto` to run continuous scan→plan→exec cycles across the supported categories (cleanup, tests, stability, features, docs, optimize, prompts, security, distill). Use `focus-drift-walking` to detect and repair documentation-code drift across all directories. Use `focus-doc-audit` for deep quality audits with per-file scoring. The `security` category targets OWASP Top 10 + STRIDE issues; the `distill` category targets AI-generated code bloat with a 5-pass deterministic→AST→graph→LLM→memory pipeline.

### Standards Integration

PAN includes a built-in catalog of industry standards (OWASP Top 10, WCAG 2.2, NIST SSDF, STRIDE, etc.). Standards are advisory — they guide agents during planning and verification but never block execution.

**Quick start:**
```
pan-tools standards recommend          # Get recommendations based on your project type
pan-tools standards select owasp-top10 # Add a standard
pan-tools standards status             # Check compliance progress
pan-tools validate health --standards  # Include in health reports
```

**Per-phase tracking:**
```
pan-tools standards phase-track 1      # Which standards matter for phase 1?
pan-tools standards tools              # What external tools can help verify?
pan-tools standards tools owasp-top10  # Tools for a specific standard
```

**How it works:** Selected standards are stored in `.planning/standards.md` as Markdown checklists. Agents naturally read this file as context. The verifier (Step 7b) runs per-phase standards tracking, auto-ticks checklist items it can confirm, and recommends external tools when coverage is low. The plan-checker (Dimension 9) references selected standards when standards.md exists. The focus-design Phase 7 (Security) automatically cross-references selected standards.

**Available standards:** OWASP Top 10, OWASP ASVS L1, OWASP LLM Top 10, OWASP Agentic Top 10, WCAG 2.2, NIST SSDF, ISO 25010, STRIDE, CWE Top 25, SOC 2 Dev Controls, TOGAF ADM, Conventional Commits.

### Doc-Code Link Graph (v3.8.0+)

PAN treats your planning surface — ADRs, specs, learnings, references, workflows — as an explicit graph and lints its integrity. Renaming an ADR or moving a module no longer silently strands references.

**Two link types:**

- **Forward links**: inline `[[<id>]]` body-text refs and frontmatter `must_haves.key_links` entries. Recognized doc-id forms: `ADR-NNNN` (resolves via glob), `<path>.md`, `<path>` (tries `.md` then `/README.md`), and any with `#section`.
- **Backlinks**: `// @pan: <doc-id>` source-comment anchors (idiomatic per language: `//` for JS/TS/CJS, `#` for shell/Python, `<!--` for markdown/HTML). Anchors declare "this code is a load-bearing implementation of that doc."

**Backlink contract:** any doc with `require-code-mention: true` in YAML frontmatter must be anchored by at least one `@pan:` comment under source roots. The lint enforces this (`B-001` finding); without the frontmatter flag, anchors are advisory.

**Run it:**

```
/pan:links                                  # advisory — errors fail, warnings pass
/pan:links --strict                         # warnings also fail (B-002 single-source informational is exempt)
pan-tools validate health --links           # attach link-graph summary to a health report
pan-tools links validate --doc-root <path>  # narrow scope to a custom root
```

**Finding codes:** F-001/F-002 (broken inline / missing section), F-003/F-004 (key_links path / regex), B-001 (uncovered `require-code-mention`), B-002 (informational single-source), A-001/A-002/A-004 (stale anchor target / section / empty id).

The convention is opt-in per doc — only docs with `require-code-mention: true` enforce backlinks; the rest are advisory. PAN's own ADR-0021, ADR-0026, and ADR-0027 are the canary opt-ins; their primary implementation files (`codebase.cjs`, `experiment.cjs`, `runner.cjs`, `links.cjs`) carry the matching `// @pan:` anchors. See [ADR-0027](decisions/ADR-0027-doc-code-link-graph.md) for design rationale and [docs/specs/doc_code_link_graph_featureai.md](specs/doc_code_link_graph_featureai.md) for the wire-level spec.

---

## Configuration Reference

PAN stores project settings in `.planning/config.json`. Configure during `/pan:new-project` or update later with `/pan:settings`.

### Full config.json Schema

```json
{
  "mode": "interactive",
  "depth": "standard",
  "model_profile": "balanced",
  "planning": {
    "commit_docs": true,
    "search_gitignored": false
  },
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "nyquist_validation": false,
    "auto_advance": false,
    "phase_record_compact": false
  },
  "git": {
    "branching_strategy": "none",
    "phase_branch_template": "pan/phase-{phase}-{slug}",
    "milestone_branch_template": "pan/{milestone}-{slug}"
  },
  "parallelization": true,
  "brave_search": false,
  "budget": {
    "default_points": 50,
    "micro_threshold_tasks": 3,
    "micro_threshold_files": 2
  },
  "commit": {
    "safety_checks": true,
    "conventional_types": true,
    "sensitive_patterns": ["\\.env$", "\\.pem$", "\\.key$", "credentials", "secret", "password", "token"]
  },
  "execution": {
    "default_mode": "wave_order",
    "rollback_snapshots": true,
    "error_pattern_learning": true
  }
}
```

### Core Settings

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `mode` | `interactive`, `yolo` | `interactive` | `yolo` auto-approves decisions; `interactive` confirms at each step |
| `depth` | `quick`, `standard`, `comprehensive` | `standard` | Planning thoroughness: 3-5, 5-8, or 8-12 phases |
| `model_profile` | `quality`, `balanced`, `budget` | `balanced` | Model tier for each agent (see table below) |
| `parallelization` | `true`, `false` | `true` | Execute independent plans within a wave in parallel |
| `brave_search` | `true`, `false` | `false` | Enable web search in research agents (requires `BRAVE_API_KEY` env var or `~/.pan-wizard/brave_api_key`) |
| `routing.strategy` | `static`, `complexity` | `static` | How model tiers are adjusted at runtime |
| `routing.provider` | `auto`, `anthropic`, `openai`, `google` | `auto` | LLM provider for tier→model mapping |

### Planning Settings

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `planning.commit_docs` | `true`, `false` | `true` | Whether `.planning/` files are committed to git |
| `planning.search_gitignored` | `true`, `false` | `false` | Add `--no-ignore` to broad searches to include `.planning/` |

> **Note:** If `.planning/` is in `.gitignore`, `commit_docs` is automatically `false` regardless of the config value.

### Workflow Toggles

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `workflow.research` | `true`, `false` | `true` | Domain investigation before planning |
| `workflow.plan_check` | `true`, `false` | `true` | Plan verification loop (up to 3 iterations) |
| `workflow.verifier` | `true`, `false` | `true` | Post-execution verification against phase goals |
| `workflow.nyquist_validation` | `true`, `false` | `false` | Validation architecture research during plan-phase; 8th plan-check dimension. Off by default — opt-in via `pan-tools config-set workflow.nyquist_validation true`. |
| `workflow.auto_advance` | `true`, `false` | `false` | Chain discuss → plan → execute → verify → transition without prompting. **Scope:** within a phase the chain is automatic; across phase boundaries the chain follows `transition.md`'s YOLO branch — in-context continuation, no `/clear` required. Equivalent to passing `--auto` on every `/pan:` command. |
| `workflow.phase_record_compact` | `true`, `false` | `false` | When combined with the lightweight-phase bypass (1-plan trivial phases), collapses per-phase context.md + research.md + summary.md into a single `${N}-record.md`. Cuts ~4 commits per trivial phase. Substantive phases (>1 plan, non-trivial change_class) ignore this flag. |

Disable these to speed up phases in familiar domains or when conserving tokens.

### Budget Settings

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `budget.default_points` | `1`-`200` | `50` | Default budget for execution sessions |
| `budget.micro_threshold_tasks` | number | `3` | Max tasks for MICRO tier classification |
| `budget.micro_threshold_files` | number | `2` | Max files for MICRO tier classification |

### Commit Safety Settings

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `commit.safety_checks` | `true`, `false` | `true` | Enable deleted-file and sensitive-file checks before commit |
| `commit.conventional_types` | `true`, `false` | `true` | Enable `--type` flag for conventional commit prefixes |
| `commit.sensitive_patterns` | array of regex | See default | File patterns blocked from commits (`.env`, `.pem`, etc.) |

### Execution Settings

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `execution.default_mode` | `wave_order` | `wave_order` | Default execution ordering strategy |
| `execution.rollback_snapshots` | `true`, `false` | `true` | Create git rollback tags before execution |
| `execution.error_pattern_learning` | `true`, `false` | `true` | Enable cross-session error pattern tracking |

### Git Branching

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `git.branching_strategy` | `none`, `phase`, `milestone` | `none` | When and how branches are created |
| `git.phase_branch_template` | Template string | `pan/phase-{phase}-{slug}` | Branch name for phase strategy |
| `git.milestone_branch_template` | Template string | `pan/{milestone}-{slug}` | Branch name for milestone strategy |

**Branching strategies explained:**

| Strategy | Creates Branch | Scope | Best For |
|----------|---------------|-------|----------|
| `none` | Never | N/A | Solo development, simple projects |
| `phase` | At each `exec-phase` | One phase per branch | Code review per phase, granular rollback |
| `milestone` | At first `exec-phase` | All phases share one branch | Release branches, PR per version |

**Template variables:** `{phase}` = zero-padded number (e.g., "03"), `{slug}` = lowercase hyphenated name, `{milestone}` = version (e.g., "v1.0").

### Model Profiles (Per-Agent Breakdown)

PAN uses abstract tier names (`reasoning`, `mid`, `fast`) that map to provider-specific models. On Anthropic: reasoning → Opus (inherit), mid → Sonnet, fast → Haiku. On OpenAI/Google: reasoning → inherit, mid/fast → provider equivalents.

| Agent | `quality` | `balanced` | `budget` |
|-------|-----------|------------|----------|
| pan-planner | reasoning | reasoning | mid |
| pan-roadmapper | reasoning | mid | mid |
| pan-executor | reasoning | mid | mid |
| pan-phase-researcher | reasoning | mid | fast |
| pan-project-researcher | reasoning | mid | fast |
| pan-research-synthesizer | reasoning | mid | fast |
| pan-debugger | reasoning | mid | mid |
| pan-document_code | reasoning | fast | fast |
| pan-verifier | reasoning | mid | fast |
| pan-plan-checker | reasoning | mid | fast |
| pan-integration-checker | reasoning | mid | fast |
| pan-reviewer | reasoning | fast | fast |

**Profile philosophy:**
- **quality** -- Reasoning tier for all agents. Use when quota is available and the work is critical.
- **balanced** -- Reasoning only for planning, mid for execution, fast for read-only tasks. The default for good reason.
- **budget** -- Mid for code-writing agents, fast for research and verification. Use for high-volume work or less critical phases.

### Routing Strategies

The `routing.strategy` setting controls how tiers are adjusted at runtime:

- **static** (default) -- Profile assigns fixed tiers. Predictable, no surprises.
- **complexity** -- Adjusts tiers up or down based on task metadata (file count, wave count, requirements, architecture flag). Saves tokens on simple tasks, upgrades for complex ones.

### Cost Estimation

Use `/pan:profile <profile>` to see relative cost multipliers before switching. Cost tiers: reasoning = 15×, mid = 3×, fast = 1×.

### Per-Phase Model Override

Override the model tier for all agents in a specific phase by adding an HTML comment to the roadmap:

```markdown
## Phase 3: Quick UI polish
**Goal:** Style cleanup
<!-- model_tier: fast -->
```

Per-phase overrides sit between per-agent overrides (highest priority) and profile lookup (lowest priority).

---

## Usage Examples

### New Project (Full Cycle)

```bash
claude --dangerously-skip-permissions
/pan:new-project            # Answer questions, configure, approve roadmap
/clear
/pan:discuss-phase 1        # Lock in your preferences
/pan:plan-phase 1           # Research + plan + verify
/pan:exec-phase 1        # Parallel execution
/pan:verify-phase 1          # Manual UAT
/clear
/pan:discuss-phase 2        # Repeat for each phase
...
/pan:milestone-audit        # Check everything shipped
/pan:milestone-done     # Archive, tag, done
```

### New Project from Existing Document

```bash
/pan:new-project --auto @prd.md   # Auto-runs research/requirements/roadmap from your doc
/clear
/pan:discuss-phase 1               # Normal flow from here
```

### Existing Codebase

```bash
/pan:map-codebase           # Analyze what exists (parallel agents)
/pan:new-project            # Questions focus on what you're ADDING
# (normal phase workflow from here)
```

### Quick Bug Fix

```bash
/pan:quick
> "Fix the login button not responding on mobile Safari"
```

### Resuming After a Break

```bash
/pan:progress               # See where you left off and what's next
# or
/pan:resume            # Full context restoration from last session
```

### Preparing for Release

```bash
/pan:milestone-audit        # Check requirements coverage, detect stubs
/pan:milestone-gaps    # If audit found gaps, create phases to close them
/pan:milestone-done     # Archive, tag, done
```

### Speed vs Quality Presets

| Scenario | Mode | Depth | Profile | Research | Plan Check | Verifier |
|----------|------|-------|---------|----------|------------|----------|
| Prototyping | `yolo` | `quick` | `budget` | off | off | off |
| Normal dev | `interactive` | `standard` | `balanced` | on | on | on |
| Production | `interactive` | `comprehensive` | `quality` | on | on | on |

### Mid-Milestone Scope Changes

```bash
/pan:add-phase              # Append a new phase to the roadmap
# or
/pan:insert-phase 3         # Insert urgent work between phases 3 and 4
# or
/pan:remove-phase 7         # Descope phase 7 and renumber
```

---

## Advanced Features

### Self-Improvement Loop

PAN Wizard ships a **cross-project meta-learning loop** that lets PAN itself get smarter every release. Run experiments against fresh ideas in isolated folders, harvest the resulting telemetry back to the source repo, promote generalizable findings into shipped artifacts that future installs read automatically.

**The 6-step loop:**

```bash
# 1. Capture an idea (use the template at pan-wizard-core/templates/idea.md)
echo "# Idea: <title>
## Problem
...
## Success Criteria
...
## Scope
...
## Constraints
..." > my-idea.md

# 2. Scaffold an isolated experiment
pan-tools experiment new my-idea --idea my-idea.md --runtime claude --budget 60

# 3. Run the external session (autonomous; observation-only watchdog)
pan-tools experiment run my-idea

# 4. Harvest telemetry back to <source-repo>/experiments/my-idea/
pan-tools experiment harvest my-idea

# 5. Analyze with pan-optimizer
/pan:learn --experiment my-idea

# 6. Promote select findings (manual gate by design — no auto-promote yet)
pan-tools learn promote --pattern P-007 --scope universal --topic exec-patterns \
  --summary "..." --rule "..." --evidence "..." --source-experiments my-idea

# 7. Validate the patterns store (catches duplicates, dangling refs, scope leaks)
pan-tools learn lint --raw

# 8. Refresh the topic→agent index so workflows can budget-load relevant patterns
pan-tools learn build-index --raw
```

**Two-tier learnings layout:**

- `pan-wizard-core/learnings/universal/` — ships to all 5 runtimes; consumed by user-project workflows. Includes patterns like atomic-state, concurrency, idempotency, secret-handling, test-patterns.
- `pan-wizard-core/learnings/internal/` — source-only; PAN-development patterns that should NOT leak to user installs.
- `pan-wizard-core/learnings/index.json` — generated topic→agent-relevance map. Workflows query it via `pan-tools learn topics-for --agent <role> --token-budget N` to load only relevant patterns instead of skim-everything (avoids the distractor-density anti-pattern from external research).

The installer (`bin/install.js`) explicitly strips `learnings/internal/` from each install dir. A negative test in `tests/scenarios/learnings-installed.test.cjs` enforces this.

**Patterns-store maintenance commands:**

| Command | Purpose |
|---------|---------|
| `pan-tools learn promote --pattern <id> --scope <s> --topic <t>` | Append a finding to `learnings/{scope}/{topic}.md` |
| `pan-tools learn unpromote --pattern <id> --scope <s> --topic <t>` | Remove a finding |
| `pan-tools learn list-promoted` | Inventory of all patterns across both scopes |
| `pan-tools learn lint [--strict]` | Integrity checks (L-001..L-005); exits non-zero on errors |
| `pan-tools learn build-index` | Generate/refresh `learnings/index.json` |
| `pan-tools learn topics-for --agent <role>` | Budget-aware topic selection for an agent |

**Subcommands of `/pan:experiment`:**

| Subcommand | Wave | Purpose |
|------------|------|---------|
| `new <slug>` | W1 | Scaffold an experiment folder |
| `list` | W1 | Enumerate experiments |
| `manifest <slug>` | W1 | Read scaffold metadata |
| `run <slug>` | W2 | Spawn external AI session, observe |
| `status <slug>` | W2 | Read run-state.json snapshot |
| `stop <slug>` | W2 | Graceful halt of a running experiment |
| `harvest <slug>` | W3 | Copy telemetry back to source repo |
| `prune <slug>` | W3 | Soft-rename or hard-delete the experiment folder |

**Runtime support:**

The experiment runner uses `spawnSync` to invoke external AI runtimes headlessly:
- ✅ Claude Code (`claude -p <prompt>`)
- ✅ Codex CLI (`codex exec <prompt>`)
- ✅ Gemini CLI (`gemini -p <prompt>`)
- ✅ OpenCode (`opencode <prompt>`)
- ❌ GitHub Copilot CLI — no documented headless prompt mode (opt-out)

**Spec & ADR:**

- Design: `docs/specs/self_improvement_loop_featureai.md`
- Decisions: `docs/decisions/ADR-0026-self-improvement-loop.md`

### AI Agent Guardrails

PAN Wizard ships `references/guardrails.md` (v3.6.0+) — a consolidated rules doc that all PAN workflows reference. It encodes anti-patterns (silent model swaps, skipping verification, scope creep), the **Code Preservation Principle** (surgical edits only — preserve config values, comments, formatting outside the user's explicit target), and the **Stop-the-Line Rule** (regressions halt feature work, no "I'll circle back").

This doc is read by your AI coding agent (Claude, Codex, Gemini, OpenCode, Copilot) at the start of every phase. You don't need to interact with it directly, but you can review the installed copy at:

| Runtime | Path |
|---------|------|
| Claude  | `.claude/pan-wizard-core/references/guardrails.md` |
| Codex   | `.codex/pan-wizard-core/references/guardrails.md` |
| Gemini  | `.gemini/pan-wizard-core/references/guardrails.md` |
| OpenCode | `.opencode/pan-wizard-core/references/guardrails.md` |
| GitHub Copilot | `.github/pan-wizard-core/references/guardrails.md` |

The long workflows (`exec-phase`, `plan-phase`, `verify-phase`, `execute-plan`) gain `## Re-Read Checkpoints` sections that direct the agent to re-read specific sections at boundaries — preventing context-compaction drift across long sessions. `new-project.md` gates scaffolding behind a mandatory Phase 0 clarify step (problem / success / scope / constraints).

If your agent ever skips `/pan:verify-phase` "because tests passed" or silently changes a model, point it at this reference.

### Advanced Planning Options

The `/pan:plan-phase` command accepts several flags to customize planning behavior:

| Flag | Purpose |
|------|---------|
| `--prd <file>` | Use a PRD/acceptance criteria file instead of discuss-phase. Parses requirements into context.md automatically. Skips discussion entirely. |
| `--skip-research` | Skip research phase, go straight to planning (useful for familiar domains) |
| `--research` | Force re-research even if research.md already exists |
| `--gaps` | Gap closure mode: reads verification.md and creates fix plans |
| `--skip-verify` | Skip the plan verification loop |

Example:

```bash
/pan:plan-phase 3 --prd specs/auth-requirements.md
```

### Execution Model

**Wave-Based Parallelization:**

Plans within a phase are grouped by wave number (from plan.md frontmatter `wave: N`). Waves execute sequentially, but plans within a wave execute in parallel (when `parallelization: true` in config).

Wave 1 plans have no dependencies. Wave 2 plans depend on Wave 1 output. This is how PAN safely parallelizes work.

**Deviation Rules:**

During execution, the pan-executor automatically handles unexpected issues:

| Rule | Trigger | Action | Example |
|------|---------|--------|---------|
| Rule 1 | Bug in code | Auto-fix | Logic errors, null pointers, type errors |
| Rule 2 | Missing critical functionality | Auto-add | Missing validation, error handling, auth checks |
| Rule 3 | Blocking issue | Auto-fix | Missing dependency, broken imports, build errors |
| Rule 4 | Architectural change needed | STOP and ask | New DB table, schema changes, library switches |

Rules 1-3 are applied automatically (up to 3 fix attempts per task). Rule 4 creates a checkpoint requiring user decision.

**Gap Closure:**

After `/pan:verify-phase` identifies issues, it creates fix plans with `gap_closure: true`. Run `/pan:exec-phase N --gaps-only` to execute only these fix plans.

**Checkpoint Automation:**

When `workflow.auto_advance: true` in config:

| Checkpoint | Behavior |
|------------|----------|
| `checkpoint:human-verify` | Auto-approved (skips visual verification) |
| `checkpoint:decision` | Auto-selects first option |
| `checkpoint:human-action` | Still stops (auth gates cannot be automated) |

### Bot-army campaigns (`/pan:army`)

**This is PAN's headline capability — ship a whole project, not just a phase.** `/pan:army` runs PAN's agents as a coordinated army: an Opus **Mission Control** plans the mission and delegates to specialist squads, parallel builders each work an isolated git worktree, and nothing reaches your main branch without green checks and your approval (ADR-0032 squads · ADR-0033 campaign). It composes the pieces you already use: the `pan-conductor` safety harness, the focus-auto work loop, git worktrees, and the retro/learnings memory.

**Taking on an existing project.** The army never plans blind. On a brownfield repo, Phase 0 runs an onboarding gate: if existing code has no codebase map yet, it stops and routes you through `/pan:map-codebase` (the Architecture squad maps the system into `.planning/codebase/`) and `/pan:new-project` (builds `roadmap.md` / `requirements.md` *against the existing system*), then you re-run `/pan:army`. From there, the Architecture squad reads the existing contracts before Build touches anything, and every Build agent forks its `army/<task>` branch from your current `main` — so the existing code is never edited in place. For a greenfield repo, you go straight to the plan.

**The tiers.** Mission Control (the Opus conductor, in campaign mode) plans the goal and delegates — it never writes code. Work flows to four squads, each with a least-privilege tool contract:

| Squad | Role | Access |
|-------|------|--------|
| Architecture | Design the contract before code | read-only |
| Build | Turn the contract into committed code | read / write / bash |
| Quality | Adversarially break what Build makes | read-only |
| Release | Ship behind a human gate | always-ask |

Inspect the roster any time with `pan-tools squad list` and `pan-tools squad show <name>`.

**Parallel builds without collisions.** When the Build squad runs several tasks at once, each builder gets its own `army/<task>` branch in an isolated git worktree (`pan-tools worktree list` shows them), so two agents never edit the same working tree. Use `--no-build-worktrees` for small or strictly-serial projects; set `concurrency.serial_build: true` in `.planning/config.json` if your build tree corrupts under concurrent builds.

**The loop.** Each cycle runs plan → delegate → execute → review → integrate → learn. Quality must return green before integration; the Release agent (`pan-release`) then prepares the squash-merge, runs your configured `verification` command, and surfaces an `always-ask` approval — a human merges to the protected branch, not a bot. Recovery is always `git revert` or redeploying the previous tag. Between missions, `/pan:retro --write-memory` persists recurring patterns into agent memory so the next mission plans smarter.

**Running it:**

```
/pan:army "ship the v1 reporting module" --source backlog --max-cycles 5
/pan:army "harden auth across the app" --squads architecture,build,quality --clean-seal
/pan:army "<goal>" --dry-run     # show the plan + squad delegation, run nothing
/pan:army --status               # campaign progress
/pan:army --stop                 # graceful halt, state preserved
```

The same caps that bound hierarchical exec bound the campaign — delegation-depth cap, per-cycle spawn/budget ceiling, and the `.planning/orchestration/abort` kill-switch — so a long campaign never relaxes a single safety rail. Campaign mode is Claude + Opus only (like `/pan:exec-phase --hierarchical`); other runtimes fall back to the flat lifecycle.

**Running it over days (scheduled, self-resuming).** `--schedule` arms a campaign that advances the backlog on a cadence instead of in one sitting ([ADR-0034](decisions/ADR-0034-scheduled-campaigns.md)):

```
/pan:army "burn down the v1 backlog" --schedule daily --daily-budget 200
```

This writes a schedule descriptor (`.planning/orchestration/schedule.json`) — PAN does **not** run itself in the background (it's not a daemon). You wire an external trigger that polls `pan-tools campaign due` and runs `/pan:army --continue` when it reports due: a host scheduler (Claude Code routines / cron / scheduled tasks), a `/loop`, or simply the next time you open the project (a due campaign is surfaced as a nudge). Each day's run stops at `--daily-budget` and resumes the next day. Manage it with `pan-tools campaign status` (active/paused, spent today, next-due) and `campaign schedule --pause | --resume | --disable`.

**The one thing scheduling never changes:** the merge to a protected branch stays an `always-ask` human gate. A scheduled campaign runs the backlog down to staged, reviewed, green PRs unattended — and waits for you at every merge. Autonomy runs up to the irreversible step, a human at the step.

### Army & project dashboard (`/pan:hud`)

`/pan:hud` (alias `/pan:dashboard`) renders the whole picture of your project and its bot army as a **single, self-contained HTML page** — no server, no network, no external CSS or JS. It's a read-only *view*: every panel aggregates state PAN already tracks (`state.md`, the roadmap/phases on disk, the squad registry, the campaign schedule, army worktrees, the cost ledger, `requirements.md`, verification artifacts, and git history). The command writes only the rendered file, so it can never corrupt planning data.

```
/pan:hud                  # write .planning/hud.html
/pan:hud --open           # write it and launch in your default browser
/pan:hud --out status.html
/pan:hud --stdout > dashboard.html   # print HTML instead of writing a file
```

**What you see:** a mission banner (project, status, version/milestone, and metric cards for progress, current phase, requirements, and spend), the full roadmap with per-phase status, telemetry (spend, tokens, cache-hit rate, by-squad breakdown), requirements-and-quality with the latest verification artifacts, and recent commits.

**On an army project**, four extra panels appear: a command stack showing Mission Control over the four squads with per-squad agent drill-down, the campaign panel (cadence, next-due, daily-budget bar, run history), the safety harness (merge gate, abort switch, active worktrees, budget, concurrency), and the active `army/*` worktrees. These army panels self-hide on a plain (non-army) project, so you always get a complete, useful page (graceful degradation per [ADR-0035](decisions/ADR-0035-army-hud-dashboard.md)).

The file is fully self-contained — send `.planning/hud.html` to anyone and it opens with no dependencies. During a campaign, re-run after each cycle to watch squads, budget, worktrees, and committed output evolve.

**Per-phase reports (`/pan:report`).** Where `/pan:hud` renders the whole project at once, `/pan:report` (`pan-tools report phase <N> | index | all`) reuses the HUD's rendering to produce per-phase HTML reports — one page per phase, plus a project-level timeline index that links them together. Same self-contained, read-only, view-only guarantees as the dashboard.

### Git Integration

**Commit Format:**

PAN uses conventional commits with phase-plan scope:

```
{type}({phase}-{plan}): {description}
```

Types: `feat`, `fix`, `test`, `refactor`, `perf`, `chore`, `docs`

Example: `feat(03-02): add login endpoint`

**What Gets Committed:**

| Event | Commit |
|-------|--------|
| Each completed task | Individual commit |
| Plan completion | Metadata commit (`docs(XX-YY): complete plan`) |
| Project init | `docs: initialize project-name (N phases)` |
| Planning docs | Controlled by `planning.commit_docs` config |

**Branching Strategies (Detailed):**

When `git.branching_strategy: "phase"`:
- A branch is created at exec-phase start using `phase_branch_template`
- Example: `pan/phase-03-authentication`
- All plan commits go to that branch
- User merges branches after phase completion
- Template variables: `{phase}` (zero-padded), `{slug}` (hyphenated name)

When `git.branching_strategy: "milestone"`:
- First exec-phase of milestone creates milestone branch using `milestone_branch_template`
- Example: `pan/v1.0-mvp`
- All phases commit to same branch
- `milestone-done` offers merge options:

| Option | Git command | Result |
|--------|-------------|--------|
| Squash merge | `git merge --squash` | Single clean commit |
| Merge with history | `git merge --no-ff` | Preserves all commits |
| Delete without merging | `git branch -D` | Discard branch work |
| Keep branches | (none) | Manual handling |

**Planning Doc Commits:**

When `planning.commit_docs: false` or `.planning/` is gitignored, PAN automatically skips git operations for planning files. The `pan-tools commit` CLI handles this transparently.

### Requirement Tracing

PAN traces requirements from definition through implementation to verification:

```
requirements.md (checklist + traceability table)
    ↓ REQ-01, REQ-02 assigned to phases in roadmap.md
    ↓ Referenced in plan.md frontmatter: requirements: [REQ-01]
    ↓ Auto-marked complete when phase completes
    ↓ Traceability table updated: Pending → Complete
```

When a phase completes (the verify/exec-phase flow), PAN automatically marks that phase's requirement IDs as completed in both the checklist and the traceability table.

### Global Defaults

PAN supports global defaults at `~/.pan-wizard/defaults.json`. These override hardcoded defaults for all projects.

**Precedence:** project `.planning/config.json` > `~/.pan-wizard/defaults.json` > hardcoded defaults

Example `~/.pan-wizard/defaults.json`:

```json
{
  "model_profile": "budget",
  "parallelization": false,
  "workflow": {
    "research": false
  }
}
```

This sets budget profile and disables research globally. Individual projects can override these in their own config.json.

**Brave Search API key** can also be stored at `~/.pan-wizard/brave_api_key` (one line, the key only).

### Web Search

PAN research agents can search the web via Brave Search API.

**Setup:**

1. Get a free API key from [Brave Search API](https://brave.com/search/api/)
2. Set `BRAVE_API_KEY` environment variable, OR
3. Save the key to `~/.pan-wizard/brave_api_key`

When configured, research agents automatically use web search to investigate technologies, libraries, and best practices. The `brave_search` config option (default: `false`) controls whether this is enabled.

### Debug Logging

Add `--verbose` to any `pan-tools` command to see debug output on stderr:

```bash
node pan-tools.cjs state load --verbose
```

This sets `PAN_VERBOSE=1` and prints `[pan-tools]` prefixed trace messages. Useful for diagnosing command dispatch, file path resolution, or unexpected behavior.

---

## Troubleshooting

### "Project already initialized"

You ran `/pan:new-project` but `.planning/project.md` already exists. This is a safety check. If you want to start over, delete the `.planning/` directory first.

### Context Degradation During Long Sessions

Clear your context window between major commands: `/clear` in Claude Code. PAN is designed around fresh contexts -- every subagent gets a clean 200K window. If quality is dropping in the main session, clear and use `/pan:resume` or `/pan:progress` to restore state.

### Plans Seem Wrong or Misaligned

Run `/pan:discuss-phase [N]` before planning. Most plan quality issues come from Claude making assumptions that `context.md` would have prevented. You can also run `/pan:assumptions [N]` to see what Claude intends to do before committing to a plan.

### Execution Fails or Produces Stubs

Check that the plan was not too ambitious. Plans should have 2-3 tasks maximum. If tasks are too large, they exceed what a single context window can produce reliably. Re-plan with smaller scope.

### Lost Track of Where You Are

Run `/pan:progress`. It reads all state files and tells you exactly where you are and what to do next.

### Need to Change Something After Execution

Do not re-run `/pan:exec-phase`. Use `/pan:quick` for targeted fixes, or `/pan:verify-phase` to systematically identify and fix issues through UAT.

### Model Costs Too High

Switch to budget profile: `/pan:profile budget`. Consider enabling complexity routing (`routing.strategy: "complexity"` in config.json) to auto-downgrade simple tasks. Disable research and plan-check agents via `/pan:settings` if the domain is familiar. Use per-phase overrides (`<!-- model_tier: fast -->` in roadmap) for phases that don't need strong reasoning.

### Working on a Sensitive/Private Project

Set `commit_docs: false` during `/pan:new-project` or via `/pan:settings`. Add `.planning/` to your `.gitignore`. Planning artifacts stay local and never touch git.

### PAN Update Overwrote My Local Changes

Since v1.17, the installer backs up locally modified files to `pan-local-patches/`. Run `/pan:patches` to merge your changes back.

### Subagent Appears to Fail but Work Was Done

A known workaround exists for a Claude Code classification bug. PAN's orchestrators (exec-phase, quick) spot-check actual output before reporting failure. If you see a failure message but commits were made, check `git log` -- the work may have succeeded.

### Phase Execution Hangs or Takes Too Long

**Cause:** Complex plans with many dependencies, or agent model too weak for the task.
**Fix:** Check the plan complexity (number of tasks, wave count). Consider switching to `quality` profile for the executor: add `"model_overrides": {"pan-executor": "opus"}` to `.planning/config.json`. For simpler tasks, ensure you're not on `quality` profile (Opus for everything is slower).

### Plan Rejected by Checker Multiple Times

**Cause:** Plan-checker found structural issues the planner keeps reproducing.
**Fix:** Run `/pan:discuss-phase N` to capture more context, then re-plan. Or disable the checker temporarily: set `workflow.plan_check: false` in `/pan:settings`. Check plan.md manually for missing `verify` commands on tasks or empty `must_haves` sections.

### Research Phase Returns Irrelevant Results

**Cause:** Phase goal is too vague, or domain is highly specialized.
**Fix:** Run `/pan:discuss-phase N` first to sharpen requirements. Or skip research with `/pan:plan-phase N --skip-research` if you already know the domain well.

### Verification Found Issues After Execution

**Cause:** Verifier detected gaps between phase goals and actual implementation.
**Fix:** Read `.planning/phases/XX-name/verification.md` for details. Run `/pan:verify-phase N` to create interactive UAT. For automated fixes, the verifier creates gap-closure plans — run `/pan:exec-phase N --gaps-only` to execute only those fix plans.

### Git Commits Not Appearing

**Cause:** `planning.commit_docs: false` in config, or `.planning/` is in `.gitignore`.
**Fix:** Check config with `/pan:settings`. If you want planning docs committed, set `commit_docs: true` and remove `.planning/` from `.gitignore`. Code commits (task completions) are always created regardless of this setting.

### Context Monitor Warnings Not Showing

**Cause:** Hooks not installed, or bridge file stale.
**Fix:** Re-run `npx pan-wizard` to reinstall hooks. Check `~/.claude/settings.json` for hook registration. The statusline hook must be running for the context monitor to work (they communicate via `/tmp/claude-ctx-{session_id}.json`).

### Wrong Model Being Used for Agents

**Cause:** Profile override or stale config.
**Fix:** Check current profile: review `.planning/config.json` for `model_profile`, `model_overrides`, and `routing` settings. Switch profiles with `/pan:profile balanced`. Per-agent overrides in `model_overrides` take precedence over profile, per-phase overrides, and routing strategy.

### Decimal Phase Numbering Issues

**Cause:** Inserted phases (e.g., 3.1) may not sort correctly in some views.
**Fix:** PAN handles decimal phases natively. Use `/pan:insert-phase 3 "description"` to create them properly. Phase sorting uses numeric comparison, not string sorting (so 3.2 < 3.10).

---

## Recovery Quick Reference

| Problem | Solution |
|---------|----------|
| Lost context / new session | `/pan:resume` or `/pan:progress` |
| Phase went wrong | `git revert` the phase commits, then re-plan |
| Need to change scope | `/pan:add-phase`, `/pan:insert-phase`, or `/pan:remove-phase` |
| Milestone audit found gaps | `/pan:milestone-gaps` |
| Something broke | `/pan:debug "description"` |
| Quick targeted fix | `/pan:quick` |
| Plan doesn't match your vision | `/pan:discuss-phase [N]` then re-plan |
| Costs running high | `/pan:profile budget`, complexity routing, per-phase `<!-- model_tier: fast -->`, toggle agents off via `/pan:settings` |
| Update broke local changes | `/pan:patches` |

---

## Multi-Runtime Reference

PAN supports five runtimes. The core workflow is identical across all — the differences are in command syntax, file locations, and format.

### Command Syntax

| Runtime | Prefix | Example |
|---------|--------|---------|
| Claude Code | `/pan:` | `/pan:new-project` |
| OpenCode | `/pan-` | `/pan-new-project` |
| Gemini CLI | `/pan:` | `/pan:new-project` |
| Codex | `$pan-` | `$pan-new-project` |
| Copilot CLI | `/pan-` | `/pan-new-project` |

### Installation Locations

| Runtime | Global | Local |
|---------|--------|-------|
| Claude Code | `~/.claude/` | `./.claude/` |
| OpenCode | `~/.config/opencode/` | `./.opencode/` |
| Gemini CLI | `~/.gemini/` | `./.gemini/` |
| Codex | `~/.codex/` | `./.codex/` |
| Copilot CLI | `~/.copilot/` | `./.github/` |

> **Gemini CLI audience change:** from June 18, 2026, Google's Gemini CLI serves Gemini Code Assist (Standard/Enterprise) customers; individual free / AI Pro / Ultra accounts are directed to Antigravity CLI instead. PAN's `--gemini` install targets Gemini CLI and continues to work for those customers. Antigravity CLI is not yet a PAN install target, but it reads the shared `.agents/skills/` tree natively — install with `--unified-skills` (below) and PAN's command set is usable from Antigravity in the same project.

### Unified skills tree (`--unified-skills`, ADR-0028 Phase 1 — alpha)

Adding `--unified-skills` to any install compiles PAN's commands **once** into the runtime-neutral `.agents/skills/` tree (project root for local installs, `~/.agents/skills/` for global) instead of the per-runtime command formats below. The tree follows the Agent Skills standard (`SKILL.md` per skill directory), is read natively by every PAN runtime plus Antigravity CLI, and the proprietary command surface is swept so commands don't resolve twice. Agents, hooks, and settings still install per-runtime.

```bash
node bin/install.js --claude --local --unified-skills
```

Unified installs also ship a shared `pan-wizard-core` copy at `.agents/pan-wizard-core/`, which the compiled skills resolve against — so the tree's content is the same no matter which runtime installed it, and several runtimes can share one install safely. Uninstalls are ref-counted: the shared tree stays until the last runtime tracking it uninstalls. Alpha status reflects that per-runtime native discovery of `.agents/skills/` hasn't been live-verified on every runtime yet — see ADR-0028.

### File Format Differences

| Component | Claude Code | OpenCode | Gemini | Codex | Copilot CLI |
|-----------|------------|----------|--------|-------|-------------|
| Commands | `commands/pan/*.md` | `commands/*.md` | `commands/pan/*.toml` | `.agents/skills/pan-*/SKILL.md`¹ | `skills/pan-*/SKILL.md` |
| Agents | `agents/*.md` | `agents/*.md` | `agents/*.md` | `agents/*.toml` | `agents/*.agent.md` |
| Hooks | `hooks/*.js` in settings.json | Not supported | `hooks/*.js` in settings.json | `hooks/*.js`, registered in `.codex/hooks.json`² | `hooks/*.js`, registered in `.github/hooks/pan.json`² |
| Config | `settings.json` | `opencode.json` | `settings.json` | `config.json` | `.github/copilot/settings.json` (local) / `~/.copilot/settings.json` (global) |

Codex and Copilot CLI use a "skills" format rather than slash commands. Each command becomes a skill directory with a `SKILL.md` file. Copilot CLI agents use `.agent.md` extension. The content is equivalent — only the container format differs.

¹ **Codex (since June 2026):** skills install to the shared `.agents/skills/` tree at the project root (local installs) or `~/.agents/skills/` (global installs) — Codex no longer reads `$CODEX_HOME/skills`. Codex agents are standalone TOML files in `.codex/agents/` (required fields `name`/`description`/`developer_instructions`; PAN's per-agent `effort` maps to `model_reasoning_effort`). Note that project-scoped `.codex/` configuration only loads once the project is **trusted** in Codex — the installer prints a reminder.

² **Copilot CLI (since June 2026):** hook registration lives in `.github/hooks/pan.json` (Copilot CLI's `version: 1` schema with `type: "command"` entries), not in `config.json`. PAN's hooks are Node.js scripts invoked via the cross-platform `command` key, so they run on Windows and Unix alike. Reinstalling migrates any hook registrations left in `config.json` by older PAN versions.

### Feature Availability

| Feature | Claude Code | OpenCode | Gemini | Codex | Copilot CLI |
|---------|------------|----------|--------|-------|-------------|
| All commands | Yes | Yes | Yes | Yes | Yes |
| All agents | Yes | Yes | Yes | Yes | Yes |
| Hooks (statusline, context monitor, cost + trace loggers) | Yes | No | Yes | Yes | Yes |
| Model profiles | Yes | Yes | Yes | Yes | Yes |
| Wave-based parallel execution | Yes | Depends on runtime | Depends on runtime | Yes | Yes |
| Hierarchical exec + bot-army campaigns (`/pan:army`) | Yes | No (flat fallback) | No (flat fallback) | No (flat fallback) | No (flat fallback) |
| `--dangerously-skip-permissions` | Yes | N/A | N/A | N/A | N/A |

Hooks are supported by Claude Code, Gemini CLI, Codex (since June 2026, via `.codex/hooks.json` with Claude-compatible event names), and Copilot CLI. OpenCode does not currently support hooks.

**Copilot CLI interaction handling:** Copilot CLI has no structured input controls (no checkboxes, radio buttons, or multi-select). PAN Wizard's install-time converter automatically rewrites `AskUserQuestion` blocks into numbered text menus with clear selection instructions. Single-select questions show "Type a number or label to choose", multi-select shows "Type the numbers you want, separated by commas (e.g., 1,3)". This runs transparently during installation — no user configuration needed.

---

## Project File Structure

For reference, here is what PAN creates in your project:

```
.planning/
  project.md              # Project vision and context (always loaded)
  requirements.md         # Scoped v1/v2 requirements with IDs
  roadmap.md              # Phase breakdown with status tracking
  state.md                # Decisions, blockers, session memory
  config.json             # Workflow configuration
  milestones.md           # Completed milestone archive
  patterns.md             # Error patterns (PAT-NNN) for cross-session learning
  session-history.md      # Session summaries (last 20 entries)
  research/               # Domain research from /pan:new-project
  todos/
    pending/              # Captured ideas awaiting work
    done/                 # Completed todos
  debug/                  # Active debug sessions
    resolved/             # Archived debug sessions
  codebase/               # Brownfield codebase mapping (from /pan:map-codebase)
  quick/                  # Quick mode task plans and summaries
  phases/
    XX-phase-name/
      XX-YY-plan.md       # Atomic execution plans
      XX-YY-summary.md    # Execution outcomes and decisions
      context.md          # Your implementation preferences
      research.md         # Ecosystem research findings
      validation.md       # Test coverage mapping (Nyquist layer)
      verification.md     # Post-execution verification results
      uat.md              # User acceptance testing results
```

### File Details

| File | Created by | Purpose | Size guidance |
|------|-----------|---------|---------------|
| `project.md` | `/pan:new-project` | Project vision, goals, constraints. Always loaded into agent context. | Keep under 500 lines |
| `requirements.md` | `/pan:new-project` | Scoped requirements (v1/v2/out-of-scope) with unique IDs for traceability. | No limit |
| `roadmap.md` | `/pan:new-project` | Phase breakdown with status (pending/active/complete). The single source of truth for progress. | No limit |
| `state.md` | `/pan:new-project` | Decisions made, blockers, cross-session memory. Updated after each phase. | Keep under 200 lines |
| `config.json` | `/pan:new-project` | Workflow configuration (mode, depth, profile, toggles). See [Configuration Reference](#configuration-reference). | Auto-managed |
| `milestones.md` | `/pan:milestone-done` | Archive of completed milestones with dates and summaries. | Append-only |
| `patterns.md` | `appendErrorPattern()` | Error patterns (PAT-NNN) for cross-session learning. | Append-only, auto-increment |
| `session-history.md` | `appendSessionSummary()` | Session summaries with phase, test counts, decisions. | Keeps last 20 entries |
| `research/` | `/pan:new-project` | Parallel research outputs (stack, features, architecture, pitfalls) plus synthesis. | Read-only after creation |
| `codebase/` | `/pan:map-codebase` | Brownfield analysis: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md. | Read-only after creation |
| `context.md` | `/pan:discuss-phase` | Your implementation preferences for a phase. Feeds into research and planning. | Keep under 300 lines |
| `research.md` | `/pan:plan-phase` | Ecosystem research for a phase (libraries, patterns, pitfalls). | Read-only after creation |
| `plan.md` | `/pan:plan-phase` | Atomic execution plan with XML-structured tasks, verification steps. | 2-3 tasks per plan |
| `validation.md` | `/pan:plan-phase` | Test coverage mapping — which tests verify which requirements. | Auto-generated |
| `summary.md` | `/pan:exec-phase` | What was built, files changed, decisions made during execution. | Auto-generated |
| `verification.md` | `/pan:exec-phase` | Goal-backward check — did the phase deliver what it promised? | Auto-generated |
| `uat.md` | `/pan:verify-phase` | Manual user acceptance test results and any fix plans. | Auto-generated |

### Privacy

By default, `.planning/` is committed to git. To keep it private:

1. Set `planning.commit_docs: false` in config.json
2. Add `.planning/` to `.gitignore`
3. If previously tracked: `git rm -r --cached .planning/ && git commit -m "chore: stop tracking planning docs"`
