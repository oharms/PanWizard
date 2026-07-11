# PAN Agent System

PAN uses specialized agents, each running as a subagent in a fresh 200K context window. Agents are spawned by workflow orchestrators via the `Task` tool and communicate exclusively through `.planning/` files (and, since v3.0, `.planning/bus/<channel>.jsonl` for hierarchical coordination). They never communicate directly with each other.

**Other docs:** [Architecture](ARCHITECTURE.md) · [Hooks](HOOKS.md) · [CLI Reference](CLI-REFERENCE.md) · [Development](DEVELOPMENT.md)

---

## Table of Contents

- [Agent Inventory](#agent-inventory)
- [Squad model](#squad-model-v311-adr-0032)
- [Agent Lifecycle](#agent-lifecycle)
- [Agent Architecture](#agent-architecture)
- [Agent Deep Dives](#agent-deep-dives)
  - [pan-project-researcher](#pan-project-researcher)
  - [pan-research-synthesizer](#pan-research-synthesizer)
  - [pan-roadmapper](#pan-roadmapper)
  - [pan-document_code](#pan-document_code)
  - [pan-phase-researcher](#pan-phase-researcher)
  - [pan-planner](#pan-planner)
  - [pan-plan-checker](#pan-plan-checker)
  - [pan-executor](#pan-executor)
  - [pan-verifier](#pan-verifier)
  - [pan-reviewer](#pan-reviewer)
  - [pan-integration-checker](#pan-integration-checker)
  - [pan-debugger](#pan-debugger)
- [Model Profiles](#model-profiles)
- [How Agents Collaborate](#how-agents-collaborate)
- [Parallel Execution Patterns](#parallel-execution-patterns)
- [Agent Design Principles](#agent-design-principles)
- [Customizing Agents](#customizing-agents)

---

## Agent Inventory

| Agent | Role | Spawned By | Tools | Color |
|-------|------|-----------|-------|-------|
| `pan-project-researcher` | Researches domain ecosystem before roadmap | `/pan:new-project`, `/pan:milestone-new` | Read, Write, Bash, Grep, Glob, WebSearch, WebFetch, Context7 | cyan |
| `pan-research-synthesizer` | Synthesizes parallel research into summary.md | `/pan:new-project` | Read, Write, Bash | purple |
| `pan-roadmapper` | Creates phased roadmaps from requirements | `/pan:new-project`, `/pan:milestone-new` | Read, Write, Bash, Glob, Grep | purple |
| `pan-document_code` | Analyzes existing codebase (6 focus areas) | `/pan:map-codebase` (x6 parallel) | Read, Bash, Grep, Glob, Write | cyan |
| `pan-phase-researcher` | Investigates how to implement a specific phase | `/pan:plan-phase` | Read, Write, Bash, Grep, Glob, WebSearch, WebFetch, Context7 | cyan |
| `pan-planner` | Creates executable plan.md files with task breakdown | `/pan:plan-phase` | Read, Write, Bash, Glob, Grep, WebFetch, Context7 | green |
| `pan-plan-checker` | Validates plans against phase goals across multiple dimensions | `/pan:plan-phase` | Read, Bash, Glob, Grep | green |
| `pan-executor` | Executes plans with atomic commits and deviation handling | `/pan:exec-phase`, `/pan:quick` | Read, Write, Edit, Bash, Grep, Glob | yellow |
| `pan-verifier` | Verifies phase delivered what it promised | `/pan:exec-phase` | Read, Write, Bash, Grep, Glob | green |
| `pan-reviewer` | Read-only code review (conventions, security, quality) | `/pan:exec-phase` | Read, Grep, Glob, Bash | yellow |
| `pan-integration-checker` | Verifies cross-phase wiring and E2E flows | `/pan:milestone-audit` | Read, Bash, Grep, Glob | blue |
| `pan-debugger` | Systematic bug investigation with persistent state | `/pan:debug` | Read, Write, Edit, Bash, Grep, Glob, WebSearch | orange |

### Spec B v2 agents (v3.0-v3.4)

| Agent | Purpose | Spawned by | Tools | Color |
|-------|---------|-----------|-------|-------|
| `pan-previewer` | Foresight — blast radius / dependency graph / milestone ETA in one agent (3 modes) | `/pan:preview` | Read, Bash, Glob, Grep, Write | cyan |
| `pan-hardener` | OWASP Top 10 + STRIDE security audit on files changed in a phase | `/pan:review-deep` | Read, Grep, Glob, Bash | red |
| `pan-meta-reviewer` | Reviews the reviewer + hardener output; flags missed issues, disputes overstated severities | `/pan:review-deep` | Read, Grep, Glob, Bash | magenta |
| `pan-knowledge` | Grounded Q&A / multi-turn discussion / playbook generation (3 modes) | `/pan:knowledge` | Read, Grep, Glob, Bash, Write | cyan |
| `pan-counterfactual` | Explores alternative phase approaches in isolated git worktree | `/pan:what-if` | Read, Write, Edit, Bash, Grep, Glob | purple |
| `pan-conductor` | Top-level orchestrator for hierarchical exec — decomposes a phase, spawns sub-agents in waves, enforces safety harness | `/pan:exec-phase --hierarchical` | Read, Write, Bash, Glob, Grep, Task | orange |

### Optimization agents (v3.5)

| Agent | Purpose | Spawned by | Tools | Color |
|-------|---------|-----------|-------|-------|
| `pan-optimizer` | Reads trace events; identifies error/gap/redundancy patterns; produces ranked optimization report with auto-apply JSON block + manual review suggestions | `/pan:learn`, `/pan:optimize` | Read, Glob, Grep | cyan |
| `pan-distiller` | Read-only LLM judgment on AI code-bloat findings — receives only flagged spans (max 50 lines context per finding); validates pattern, refines safety tier (safe/review/risky), proposes minimal diff rewrite | `/pan:focus-auto --category distill` | Read, Grep, Glob | cyan |

### Self-Improvement Loop agents

| Agent | Purpose | Spawned by | Tools | Color |
|-------|---------|-----------|-------|-------|
| `pan-experiment-runner` | Drives an external AI coding session against an experiment folder. Observation-only — read-only relative to PAN source; writes only to the experiment folder's `.planning/`. Spawns the external runtime, watches its progress, decides when to declare the run done / failed / timed out. | `/pan:experiment run` | Read, Bash, Glob, Grep | orange |

### Bot-army agents (v3.11, ADR-0032/0033)

| Agent | Purpose | Spawned by | Tools | Color |
|-------|---------|-----------|-------|-------|
| `pan-release` | Release squad. Ships approved, green work behind a human gate — prepares the squash-merge, runs the configured verification, surfaces an `always-ask` approval request, tags the release, and rolls back via `git revert` / previous tag. Never codes; never merges to a protected branch itself. | `/pan:army` (release phase) | Read, Grep, Glob, Bash | amber |

---

## Squad model (v3.11, ADR-0032)

For a bot-army campaign (`/pan:army`), the agents are organized into four role-scoped **squads** under the `pan-conductor` coordinator. A squad is a named grouping with a least-privilege tool contract and a model tier; resolve it at runtime with `pan-tools squad list` / `squad show <name>` rather than hardcoding rosters.

| Squad | Role | Tier | Access | Agents |
|-------|------|------|--------|--------|
| Architecture | Design before code, contract-first | reasoning | read-only | roadmapper, planner, plan-checker, project/phase researchers, research-synthesizer |
| Build | Turn design into committed code | reasoning | read / write / bash | executor (one `army/<task>` branch + worktree per agent) |
| Quality | Adversarially break what Build makes | mid | read-only | reviewer, hardener, meta-reviewer, verifier, integration-checker, debugger |
| Release | Ship safely behind a human gate | mid | always-ask | `pan-release` |

Outside the squads sit the coordinator (`pan-conductor`, Tier 0) and the worker/utility agents — `pan-document_code`, `pan-distiller` (Haiku-tier narrow jobs), plus `pan-optimizer`, `pan-experiment-runner`, `pan-knowledge`, `pan-counterfactual`, `pan-previewer` (invoked directly by their own commands, not delegated through a squad). A drift test pins squad roster ⇄ agent files ⇄ `AGENT_BASE_EFFORT`, so every shipped agent is accounted for in exactly one place.

---

## Agent Lifecycle

```
Orchestrator (command/workflow)
  │
  ├── 1. Loads context (project.md, roadmap.md, plan.md, etc.)
  ├── 2. Resolves model via pan-tools.cjs resolve-model <agent-type>
  ├── 3. Spawns agent via Task tool with:
  │      - Agent type (maps to agents/*.md)
  │      - Prompt with <files_to_read> block
  │      - Model parameter (opus/sonnet/haiku/inherit)
  │
  Agent (fresh 200K context)
  │
  ├── 4. Reads all files listed in <files_to_read>
  ├── 5. Executes its specialized task
  ├── 6. Writes output (plan.md, summary.md, verification.md, etc.)
  └── 7. Returns result to orchestrator
```

Every agent starts with zero context and receives only what it needs. This is the key to PAN's quality — agents never suffer from context degradation.

---

## Agent Architecture

Each agent `.md` file follows this structure:

```markdown
---
name: pan-planner
description: Creates executable phase plans with task breakdown...
tools: Read, Write, Bash, Glob, Grep, WebFetch, mcp__context7__*
color: green
---

<role>
What the agent does, when it's spawned, and critical behavioral constraints.
</role>

<project_context>
How to discover project context on startup — which files to read first,
how to detect project type, framework, conventions.
</project_context>

<instructions>
Step-by-step procedure with XML-structured phases.
The core logic of the agent lives here.
</instructions>

<output_format>
What files to create, their structure, and where to write them.
Frontmatter schemas, section templates, validation requirements.
</output_format>
```

The `tools` field in frontmatter controls which tools the agent can access. Read-only agents (verifier, plan-checker) don't get Write/Edit access. Research agents get WebSearch/WebFetch and Context7 for external knowledge.

---

## Agent Deep Dives

Agents are ordered by workflow stage: project init → brownfield → phase planning → execution → verification → utility.

---

### pan-project-researcher

**Purpose:** Answers "What does this domain ecosystem look like?" before roadmap creation. Investigates the technical landscape, standard stacks, architecture patterns, and common pitfalls for the project's domain.

**Spawned by:** `/pan:new-project`, `/pan:milestone-new` (Phase 6: Research)

**Tools:** Read, Write, Bash, Grep, Glob, WebSearch, WebFetch, Context7

**Inputs:**
- Project description from orchestrator prompt
- Existing codebase files (if brownfield)

**Outputs** (all written to `.planning/research/`):
| File | Contents |
|------|----------|
| `stack.md` | Recommended stack (core, database, infrastructure, supporting), alternatives considered |
| `features.md` | Table stakes, differentiators, anti-features, MVP recommendation |
| `architecture.md` | Recommended architecture, component boundaries, data flow, patterns, anti-patterns |
| `pitfalls.md` | Critical/moderate/minor pitfalls with phase-specific warnings |
| `comparison.md` | Created in comparison mode — quick comparison table with detailed analysis |
| `feasibility.md` | Created in feasibility mode — verdict (YES/NO/MAYBE) with blockers |

**Key Behaviors:**
- Opinionated recommendations: "Use X because Y" — not "Options are X, Y, Z"
- Treats Claude's training data as hypothesis (6-18 months stale) — verifies before asserting
- Reports honestly when something couldn't be found or confidence is LOW
- Three research modes: Ecosystem (default), Feasibility, Comparison

**Tool Strategy:**
1. **Context7** (first priority) — up-to-date library docs
2. **Official docs** (second) — framework/language references
3. **WebSearch** (third) — community knowledge, blog posts, recent changes

Sources are categorized by confidence: HIGH (Context7, official docs), MEDIUM (verified web), LOW (unverified web).

---

### pan-research-synthesizer

**Purpose:** Synthesizes outputs from 4 parallel researcher agents into a cohesive summary.md that informs roadmap creation. Integrates findings — doesn't just concatenate.

**Spawned by:** `/pan:new-project` (after all 4 researchers complete)

**Tools:** Read, Write, Bash

**Inputs:**
- `.planning/research/stack.md`
- `.planning/research/features.md`
- `.planning/research/architecture.md`
- `.planning/research/pitfalls.md`

**Outputs:**
- `.planning/research/summary.md` — Executive summary, key findings, roadmap implications, confidence assessment, gaps to address

**Key Behaviors:**
- Synthesizes across research files (identifies cross-cutting concerns, dependencies between findings)
- Suggests phase structure based on architecture dependencies and feature groupings
- Flags which phases need deeper phase-specific research during `plan-phase`
- Provides confidence assessment table for each research area
- Commits ALL research files (researchers write but don't commit — synthesizer bundles the commit)

---

### pan-roadmapper

**Purpose:** Transforms requirements into a phased delivery plan. Every v1 requirement maps to exactly one phase. Every phase has observable success criteria.

**Spawned by:** `/pan:new-project`, `/pan:milestone-new`

**Tools:** Read, Write, Bash, Glob, Grep

**Inputs:**
- `project.md` — Project vision and constraints
- `requirements.md` — Scoped requirements with REQ-IDs
- `.planning/research/summary.md` — Research findings and phase suggestions

**Outputs:**
| File | Contents |
|------|----------|
| `roadmap.md` | Phase checklist + detail sections with success criteria, progress table |
| `state.md` | Initialized project memory (decisions, blockers, position) |
| `requirements.md` | Updated traceability section (requirement → phase mapping) |

**Key Behaviors:**
- Derives phases from requirements (not template imposition) — "the requirements tell us what phases are needed"
- Validates 100% requirement coverage — no orphaned requirements
- Goal-backward success criteria: observable user behaviors, not implementation tasks
- Calibrates depth from `config.json`: Quick (3-5 phases), Standard (5-8), Comprehensive (8-12)
- Prefers vertical slices over horizontal layers (better parallelization during execution)
- Presents draft for user approval before writing files

**Phase Numbering:** Integers (1, 2, 3) for planned work. Decimals (2.1, 2.2) reserved for urgent insertions via `/pan:insert-phase`.

---

### pan-document_code

**Purpose:** Explores an existing codebase and writes structured analysis documents. Each instance handles one focus area. Six run in parallel to cover the full codebase.

**Spawned by:** `/pan:map-codebase` (x6 parallel instances)

**Tools:** Read, Bash, Grep, Glob, Write

**Inputs:**
- Focus area assignment from orchestrator: `tech`, `arch`, `quality`, `concerns`, `relationships`, or `practices`
- The project's source files

**Outputs** (written directly to `.planning/codebase/`):

| Focus | Documents Created |
|-------|------------------|
| `tech` | `stack.md` (languages, frameworks, versions), `integrations.md` (external services, APIs, auth) |
| `arch` | `architecture.md` (system design, patterns), `structure.md` (directory layout, "where do I put this?") |
| `quality` | `conventions.md` (coding patterns, naming, style), `testing.md` (test infrastructure, patterns, examples) |
| `concerns` | `concerns.md` (tech debt, risks, improvement opportunities) |
| `relationships` | `relationships.md` (module dependency graph, circular dependencies, coupling analysis) |
| `practices` | `best-practices.md` (scored assessment across error handling, testing, naming, security, performance) |

**Key Behaviors:**
- Prescriptive, not descriptive: "Use camelCase" not "some functions use camelCase"
- Always includes backticked file paths (`src/services/user.ts`) as evidence
- Documents current state only — never what was considered or what might change
- Never reads sensitive files (`.env`, credentials, secrets, private keys)
- Writes documents directly to disk (minimal return to orchestrator, reducing context load)

---

### pan-phase-researcher

**Purpose:** Answers "What do I need to know to PLAN this phase well?" Investigates the technical domain specific to one phase and produces research.md consumed by the planner.

**Spawned by:** `/pan:plan-phase` or `/pan:research-phase` (standalone)

**Tools:** Read, Write, Bash, Grep, Glob, WebSearch, WebFetch, Context7

**Inputs:**
- Phase goal and requirements from roadmap.md
- `context.md` (if exists) — locked user decisions constrain research scope
- Existing codebase (if brownfield)

**Outputs:**
- `.planning/phases/XX-name/{phase_num}-research.md` — Standard Stack, Architecture Patterns, Don't Hand-Roll, Common Pitfalls, Code Examples, State of the Art, Open Questions, Sources
- `.planning/phases/XX-name/{phase_num}-validation.md` (if `nyquist_validation` enabled) — test coverage mapping per requirement

**Key Behaviors:**
- Reads context.md first — locked user decisions are non-negotiable constraints on research
- Confidence levels on all findings: HIGH, MEDIUM, LOW (based on source quality)
- Treats Claude's training as hypothesis — verifies through Context7 and official docs
- Reports honestly when uncertain or when sources contradict
- Same tool strategy as project-researcher: Context7 → Official Docs → WebSearch

**Validation Architecture (Nyquist Layer):** When `nyquist_validation` is enabled, the researcher maps each requirement to specific test commands, identifies test scaffolding needed before implementation (Wave 0 tasks), and produces validation.md — the feedback contract for the phase.

---

### pan-planner

**Purpose:** Creates executable plan.md files with task breakdown, dependency analysis, and goal-backward verification. Plans are small enough for a single executor to implement in a fresh context window.

**Spawned by:** `/pan:plan-phase` (standard, gap closure, or revision mode)

**Tools:** Read, Write, Bash, Glob, Grep, WebFetch, Context7

**Inputs:**
- `project.md`, `requirements.md`, `roadmap.md`
- `context.md` (locked user decisions)
- `research.md` (phase-specific findings)
- `{padded_phase}-validation.md` (if Nyquist enabled)
- Previous verification.md (in gap closure mode)

**Outputs:**
- `.planning/phases/XX-name/{phase}-{plan}-plan.md` — One per plan (typically 2-3 plans per phase)

**Plan Structure:**
```yaml
# Frontmatter
phase: 1
plan: 1
wave: 1
depends_on: []
requirements: [REQ-01, REQ-02]
must_haves: [derived from goal-backward analysis]
```
Each plan contains 2-3 XML-structured tasks with: `<name>`, `<files>`, `<action>`, `<verify>` (automated command + success criteria), `<done>` criteria.

**Key Behaviors:**
- Goal-backward planning: "What must be TRUE for this phase to succeed?" → derive must-haves → derive tasks
- Honors locked decisions from context.md (non-negotiable)
- Optimizes for parallel execution through wave assignment and dependency graphs
- Task types: `auto` (fully automated) and `checkpoint` (pauses for user input)
- TDD support via `tdd="true"` flag (RED → GREEN → REFACTOR)
- Gap closure mode: reads verification.md, creates fix plans for identified gaps
- Revision mode: incorporates plan-checker feedback and revises (up to 3 iterations)

---

### pan-plan-checker

**Purpose:** Validates that plans WILL achieve the phase goal before execution begins. Catches structural issues that would waste executor context windows.

**Spawned by:** `/pan:plan-phase` (after planner creates plan.md, up to 3 revision loops)

**Tools:** Read, Bash, Glob, Grep (read-only — cannot modify plans)

**Inputs:**
- plan.md files created by planner
- roadmap.md (phase goals and success criteria)
- context.md (locked decisions)
- `{padded_phase}-validation.md` (if Nyquist enabled)

**Outputs:**
- Structured issues report returned to orchestrator (not a file on disk)
- Issues categorized by severity: **blocker** (must fix), **warning** (should fix), **info** (suggestion)

**Verification Dimensions** (the agent file is the canonical source — `agents/pan-plan-checker.md`):

| # | Dimension | What It Checks |
|---|-----------|---------------|
| 1 | Requirement Coverage | Every requirement has task(s) addressing it |
| 2 | Task Completeness | Every task has Files, Action, Verify, Done fields |
| 3 | Dependency Correctness | Valid DAG, no circular refs, proper wave numbering |
| 4 | Key Links Planned | Artifacts wired end-to-end (Component → API → DB → Response) |
| 5 | Scope Sanity | 2-3 tasks per plan target, max 5 before blocker |
| 6 | Verification Derivation | must_haves trace back to phase goal |
| 7 | Context Compliance | Plans honor all locked decisions from context.md |
| 8 | Test Coverage Alignment | Planned test tier matches each must-have's behavioral level |
| 9 | Nyquist Compliance | Automated verify commands present, test coverage mapped |
| 10 | Standards Awareness | Plans address selected industry standards (advisory) |
| 11 | Spec Sufficiency for Handoff | Plan complete enough that the executor cannot diverge in the implicit space (P-RES-004 — Specification Gap; arXiv:2603.24284) |
| 12 | Decision Trace Completeness | Plan's `## Plan Decisions` section is well-formed — Locked / Open / Considered+rejected buckets present, locked items unambiguous, downstream agents have enough reasoning context to act without re-deriving the upstream choices (P-RES-003 — Cognition's "Don't build multi-agents" anti-multi-agent argument: silent decisions force blind reconciliation) |

**Reasoning-trace handoff (P-RES-003):** plan-checker, planner, executor, and verifier exchange decisions explicitly via the `## Plan Decisions` section in plan.md and `## Implementation Decisions` in summary.md. Schema lives in `references/handoff-decisions.md`. Three buckets: Locked (binding, executor must obey), Open (executor's discretion), Considered+rejected (paths the planner already weighed and dismissed — saves the executor from re-arguing them).

**Key Behaviors:**
- Plans can describe intent while missing delivery — the checker catches the gap
- Context compliance is strict: locked decisions are non-negotiable, "Claude's Discretion" items are flexible, deferred ideas must be excluded
- Returns issues to planner for revision (up to 3 loops before escalating)

---

### pan-executor

**Purpose:** Executes plan.md files atomically — one task at a time, one commit per task, with automatic deviation handling and checkpoint protocols.

**Spawned by:** `/pan:exec-phase` (wave-based), `/pan:quick`

**Tools:** Read, Write, Edit, Bash, Grep, Glob

**Inputs:**
- plan.md (the plan to execute)
- `## Plan Decisions` section in plan.md — read first (P-RES-003 reasoning-trace handoff). Locked items are binding; Open items are executor's discretion; Considered+rejected items must NOT be re-argued.
- `project.md`, `roadmap.md`, `state.md` (project context)
- `CLAUDE.md` and project-specific skills/conventions

**Outputs:**
| Output | Location |
|--------|----------|
| summary.md | `.planning/phases/XX-name/{phase}-{plan}-summary.md` (carries `## Implementation Decisions` section per P-RES-003 — records every deviation from the plan and why) |
| Git commits | One per task: `{type}({phase}-{plan}): {description}` |
| state.md updates | Via pan-tools CLI (advance-plan, update-progress, record-metric) |
| roadmap.md updates | Progress table updated |

**Deviation Rules:**

| Rule | Trigger | Action | Example |
|------|---------|--------|---------|
| Rule 1 | Bug in code | Auto-fix (up to 3 attempts) | Logic errors, null pointers, type errors |
| Rule 2 | Missing critical functionality | Auto-add | Missing validation, error handling |
| Rule 3 | Blocking issue | Auto-fix | Missing dependency, broken imports |
| Rule 4 | Architectural change needed | **STOP and ask** | New DB table, schema change, library switch |

**Checkpoint Types:**
- `human-verify` — Needs visual/functional confirmation ("Does the login page look right?")
- `decision` — Needs user choice between options
- `human-action` — Unavoidable manual step (e.g., create API key, configure OAuth)

**Key Behaviors:**
- Reads project context and conventions before starting any work
- Per-task atomic commits with conventional commit format
- TDD execution when flagged: RED (write failing test) → GREEN (minimal implementation) → REFACTOR
- Self-check verification before updating state.md
- Documents all deviations in summary.md (what changed and why)
- Authentication gates recognized as normal flow, not failures

---

### pan-verifier

**Purpose:** Verifies that a phase achieved its GOAL, not just completed its TASKS. Works backwards from what the phase should deliver and checks that it actually exists, is substantive, and is wired correctly.

**Spawned by:** Verification workflow after `/pan:exec-phase`

**Tools:** Read, Write, Bash, Grep, Glob

**Inputs:**
- plan.md files (must_haves, requirements)
- roadmap.md (phase success criteria)
- summary.md files (claimed completions)
- The actual codebase

**Outputs:**
- `.planning/phases/XX-name/{phase_num}-verification.md` — Observable Truths table, Required Artifacts, Key Links, Requirements Coverage, Anti-Patterns, Human Verification items, Gaps Summary

**Three-Level Artifact Verification:**

| Level | Question | Failure Example |
|-------|----------|-----------------|
| **Exists** | Is the file/function there? | Component file missing entirely |
| **Substantive** | Is it real code, not a stub? | Empty `return <div/>`, `TODO: implement` |
| **Wired** | Is it connected and used? | Component exists but never imported/rendered |

**Stub Detection Patterns:** Empty React returns, API handlers returning empty arrays, event handlers with only `preventDefault()`, functions with only `console.log`.

**Key Behaviors:**
- Does NOT trust summary.md claims — verifies actual code
- Goal-backward: starts from what must be TRUE, not what was DONE
- Re-verification mode: if previous verification.md exists, focuses on previously failed items
- Structures gaps in YAML frontmatter for `/pan:plan-phase --gaps` to consume
- Identifies items requiring human verification (visual appearance, UX, real-time behavior, external services)
- Scans for anti-patterns: TODOs, FIXMEs, empty implementations, dead code

**Verdict Options:** VERIFIED (all checks pass), FAILED (missing/stub/unwired artifacts), UNCERTAIN (needs human judgment).

---

### pan-reviewer

**Purpose:** Performs read-only code review on files changed during phase execution. Checks convention compliance, security patterns, and code quality before verification begins.

**Spawned by:** `/pan:exec-phase` (after test generation, before verification — skippable via `--skip-review` or `--fast`)

**Tools:** Read, Grep, Glob, Bash (read-only — cannot modify files)

**Inputs:**
- Changed file list from executor summary.md files (key-files.created + key-files.modified)
- Phase context from orchestrator
- Project conventions from CLAUDE.md and `.agents/skills/`

**Outputs:**
- Structured review report returned to orchestrator (not a file on disk)
- Findings categorized by severity: **error** (must fix), **warning** (should fix), **info** (suggestion)

**Review Dimensions:**

| Category | What It Checks |
|----------|---------------|
| Convention Compliance | Function naming (`cmd*` pattern), safe file reads, `output()`/`error()` usage, `toPosix()`, CommonJS, zero deps |
| Security Patterns | No `eval`/`Function`, no shell injection, no hardcoded secrets, path traversal prevention, no absolute paths in output |
| Code Quality | Function length (<50 lines), nesting depth (<3 levels), dead imports, duplicate code, new TODO/FIXME instances |

**Verdict Options:**
- **PASS**: Zero errors, zero warnings
- **PASS_WITH_WARNINGS**: Zero errors, warnings present
- **NEEDS_FIXES**: Any errors present — orchestrator presents findings to user

**Key Behaviors:**
- Strictly read-only — inspects but never modifies code
- Only reviews files changed in the current phase (scoped via summary.md)
- Reports real issues with file paths and line numbers, not style preferences
- Skips pure documentation files (.md) unless they contain code blocks

---

### pan-integration-checker

**Purpose:** Verifies that phases work together as a system — not just individually. Checks cross-phase wiring (exports used, APIs called, data flows) and traces end-to-end user flows.

**Spawned by:** Milestone auditor (during `/pan:milestone-audit`)

**Tools:** Read, Bash, Grep, Glob (read-only)

**Inputs:**
- summary.md files from all completed phases
- The actual codebase
- requirements.md (for cross-phase requirement mapping)

**Outputs:**
- Structured report returned to milestone auditor (not a file on disk)
- Wiring status: connected exports, orphaned exports, missing connections
- Flow status: complete flows, broken flows with specific break points

**E2E Flow Verification:**
- **Auth Flow:** form → API → session/token → redirect
- **Data Display:** component → fetch → state → render
- **Form Submission:** form → handler → API → response → feedback

**Key Behaviors:**
- Existence ≠ Integration: files can exist without being connected
- Checks both directions: export exists AND import exists AND the import is actually used
- Traces full paths: Component → API → DB → Response → Display
- Identifies specific break points: "Component renders but never calls the API at line X"
- Maps requirements to cross-phase wiring paths (identifies requirements with no cross-phase touchpoints)

---

### pan-debugger

**Purpose:** Investigates bugs using systematic scientific method with persistent state that survives context resets. The user is the reporter (knows symptoms); Claude is the investigator (finds root cause).

**Spawned by:** `/pan:debug`

**Tools:** Read, Write, Edit, Bash, Grep, Glob, WebSearch

**Inputs:**
- Bug description from user
- Existing debug session file (if resuming)
- The codebase

**Outputs:**
- `.planning/debug/{slug}.md` — Persistent debug session file with structured sections

**Debug File Structure (State Machine):**
| Section | Behavior | Contents |
|---------|----------|----------|
| Current Focus | Overwritten on updates | Active hypothesis, test, expected result, next action |
| Symptoms | Immutable after gathering | Expected vs actual, errors, reproduction steps |
| Eliminated | Append-only | Disproven hypotheses with evidence and timestamp |
| Evidence | Append-only | Observations with implications |
| Resolution | Overwritten as understanding evolves | Root cause, fix, verification, files changed |

**Status Progression:** `gathering` → `investigating` → `fixing` → `verifying` → `resolved`

**Investigation Techniques:**
- Binary Search — narrow the problem space by halving
- Rubber Duck — explain the system to find assumptions
- Minimal Reproduction — strip to smallest failing case
- Working Backwards — start from error, trace to cause
- Differential Debugging — compare working vs broken state
- Git Bisect — find the commit that introduced the bug

**Key Behaviors:**
- Never asks the user to diagnose — asks about symptoms, investigates causes
- Treats own code as foreign (meta-debugging discipline)
- Actively avoids cognitive biases: confirmation, anchoring, availability, sunk cost
- Changes one variable at a time — no shotgun debugging
- When to restart: 2+ hours no progress, 3+ failed fixes, can't explain behavior
- Persistent debug file survives `/clear` — full context restoration on resume

**Modes:**
- `symptoms_prefilled` — Skip gathering, go straight to investigation
- `find_root_cause_only` — Diagnose but don't fix
- `find_and_fix` — Complete cycle (default)

---

## Model Profiles

Each agent is assigned a model tier based on the active profile in `.planning/config.json`. PAN uses abstract tiers (`reasoning`, `mid`, `fast`) that map to provider-specific models:

**Source of truth:** `MODEL_PROFILES` in `pan-wizard-core/bin/lib/core.cjs`. The table below is regenerated from that source — when in doubt, `core.cjs` wins.

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
| pan-conductor (v3.4+) | reasoning | reasoning | mid |
| pan-counterfactual (v3.3+) | reasoning | mid | mid |
| pan-hardener (v3.2+) | reasoning | mid | fast |
| pan-meta-reviewer (v3.2+) | reasoning | mid | fast |
| pan-knowledge (v3.2+) | reasoning | mid | fast |
| pan-previewer (v3.1+) | reasoning | fast | fast |
| pan-optimizer (v3.5+) | reasoning | mid | fast |
| pan-distiller (v3.5+) | reasoning | fast | fast |
| pan-experiment-runner | reasoning | fast | fast |
| pan-release (v3.11+) | reasoning | mid | fast |

**Tier mapping by provider:** Anthropic: reasoning → inherit (Opus), mid → Sonnet, fast → Haiku. OpenAI/Google: reasoning → inherit, mid/fast → provider equivalents. Legacy names (`opus`, `sonnet`, `haiku`) still work as aliases.

**Design rationale:**
- **Reasoning for planning** — Architecture decisions benefit most from stronger reasoning
- **Mid for execution** — Executors follow explicit plan instructions; the reasoning is already done
- **Fast for read-only** — Codebase mapping and budget-tier research only need structured extraction

### Reasoning effort (adaptive-thinking era, v3.9.0+)

Agents declare `effort:` in frontmatter (`low`/`medium`/`high`/`xhigh`) — the within-model reasoning-depth dial on current models, consumed natively by Claude Code. Non-Claude runtimes get an effort-scaled prose preamble injected by the installer (`stripThinkingFrontmatter`; legacy `thinking_budget` directives still translate via a budget→effort mapping). Profiles modulate the base: `budget` steps each agent down one level (floor `low`), and `.planning/config.json → effort_overrides` wins — see `resolveEffortInternal()` and `pan-tools resolve-model`.

| Agent | effort | Rationale |
|-------|--------|-----------|
| `pan-plan-checker` | xhigh | Highest — catching logic gaps before execution avoids the most rework |
| `pan-debugger` | xhigh | Hypothesis-tree generation and Bayesian prior ranking |
| `pan-conductor` (v3.4+) | xhigh | Decomposition + safety-harness enforcement decisions |
| `pan-verifier` | high | Goal-backward analysis across phase artifacts |
| `pan-integration-checker` | high | Cross-phase wiring verification |
| `pan-previewer` (v3.1+) | high | Multi-mode synthesis of structured foresight inputs |
| `pan-hardener` (v3.2+) | high | Threat-model reasoning across OWASP + STRIDE frameworks |
| `pan-counterfactual` (v3.3+) | high | Comparison reasoning in isolated worktree |
| `pan-release` (v3.11+) | high | Release-safety judgment: merge readiness, rollback targets |
| `pan-reviewer` | medium | Convention + security review on changed files |
| `pan-meta-reviewer` (v3.2+) | medium | Cross-check of reviewer + hardener output |
| `pan-knowledge` (v3.2+) | medium | Retrieval ranking + citation synthesis |

Default budget for agents without explicit fields is 2000 (defined in `THINKING_BUDGETS.default`).

### Capability-aware routing (Opus 4.7, E-7)

The tier resolved by profile can be adjusted by capability hints passed to `resolveModel(agent, {context_estimate, needs_thinking, cache_warm})`:

- `context_estimate > 700000` → force reasoning tier (only 1M-context model)
- `needs_thinking` on a fast-tier agent → upgrade fast → mid
- `cache_warm + !needs_thinking + context_estimate < 50000` on a mid-tier agent → downgrade mid → fast (cheap, cached, simple)

See `/pan:profile` for the full decision tree.

---

## Cross-Phase Agent Memory (Opus 4.7, E-4)

Since v2.10.0, each agent has an append-only memory log at `.planning/memory/<agent>.md` managed by the `memory.cjs` core module. Agents can write lessons learned in one phase that become visible to all future invocations of the same agent.

**Files:** one per agent, stable frontmatter (`agent`, `created`) + `## Entries` section with dated bullets.

**CLI:**
- `pan-tools memory read <agent>` — list entries
- `pan-tools memory append <agent> <text>` — append a lesson (auto-dated)
- `pan-tools memory list` — all agents that have memory + entry counts
- `pan-tools memory compact <agent> [max]` — trim to last N (default 500)

**Auto-population:** `/pan:retro --write-memory` extracts top-N gap patterns as lessons for `pan-planner`, and writes a verifier lesson when first-try rate drops below 60% over ≥3 runs.

**Safety:** agent names validated against `^[a-zA-Z0-9_-]+$` to block path traversal. Compaction is bounded by `DEFAULT_MAX_ENTRIES=500`.

---

## Hierarchical Orchestration (v3.4+)

Since v3.4.0, `/pan:exec-phase <N> --hierarchical` spawns `pan-conductor` as a top-level orchestrator that decomposes the phase and spawns sub-agents (executors, reviewers, verifiers) in waves. **This is opt-in behind a flag, not the default.** Flat exec remains the standard path.

**Safety harness (hard caps, enforced before every spawn):**

| Cap | Value | Behavior at limit |
|-----|-------|-------------------|
| Nesting depth | 2 levels (conductor → sub-agent) | Sub-agents may NOT spawn further agents |
| Spawns per phase | 12 total | Continue without further spawning; document skipped work |
| Points budget | From focus-auto config or default 40 | Stop when remaining < next spawn's estimate |
| Abort file | `.planning/orchestration/abort` | Immediate stop, no graceful rollback |

**Audit trail:** every spawn and completion is logged to `.planning/orchestration/trace.json` (authoritative) and published to the `orchestrator` bus channel (`.planning/bus/orchestrator.jsonl`) for observability.

**Runtime gating:** Claude Code + Opus 4.7 only. Other runtimes fall back to flat exec with a warning. Details in [ADR-0024](decisions/ADR-0024-spec-b-v2-completion.md).

**When to use:**
- Phases with ≥4 autonomous plans that genuinely parallelize
- Phases large enough that orchestration overhead is amortized (≥20 total tasks)
- Accept ~20-30% higher total cost vs flat exec in exchange for wall-clock reduction

**When to skip:**
- Single-plan phases (pointless orchestration tax)
- Phases with many checkpoints
- First-time runs in a new codebase (flat exec telemetry more informative)

See [commands/pan/exec-phase.md](../commands/pan/exec-phase.md) for the flag documentation, and [agents/pan-conductor.md](../agents/pan-conductor.md) for the agent's full contract including decomposition strategy.

### Campaign mode (the army coordinator, v3.11, ADR-0033)

When invoked by `/pan:army`, `pan-conductor` runs as **Mission Control** for a whole-project campaign rather than a single phase — same safety harness, wider scope. In this mode it delegates to **squads, not bare agents**, resolving the roster at runtime via `pan-tools squad list` / `squad show <name>`. Each mission is routed to the squad that owns its lifecycle role: Architecture (design, read-only), Build (code, read/write/bash), Quality (adversarial, read-only), Release (`pan-release`, always-ask).

- **Build parallelizes by worktree** — each concurrent `pan-executor` gets its own `army/<task>` branch and isolated worktree (`pan-tools worktree create "<task>"`) so builders never share a tree or file.
- **Integration is human-gated** — the conductor never merges to a protected branch; the Release squad prepares the merge and surfaces an `always-ask` approval. Recovery is `git revert` / previous tag, never force-push.
- **The loop carries learnings** — after each mission, squad summaries return to the conductor and `/pan:retro --write-memory` persists recurring patterns to agent memory (the "Dreaming" step).

Every Tier-0 safety cap (nesting depth 2, spawn/budget ceiling, `.planning/orchestration/abort` kill-switch) still applies, unchanged. See [agents/pan-conductor.md](../agents/pan-conductor.md) `<campaign_mode>` and [ADR-0033](decisions/ADR-0033-army-campaign.md).

---

### Per-agent profile override

Override specific agents without changing the profile:
```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "pan-executor": "opus"
  }
}
```

---

## How Agents Collaborate

Agents never communicate directly. The orchestrator mediates all data flow through `.planning/` files:

```
                 Writes research.md
Researcher ──────────────────────────┐
                                     │
                 Reads research.md   ▼
Planner    ──────────────────────── .planning/
                                     │
                 Reads plan.md       │
Executor   ──────────────────────────┤
                                     │
                 Reads codebase      │
Verifier   ──────────────────────────┘
                 Writes verification.md
```

### Full Workflow Sequence

```
/pan:new-project
  │
  ├── pan-project-researcher (x4 parallel: stack, features, arch, pitfalls)
  ├── pan-research-synthesizer (after researchers complete)
  └── pan-roadmapper (after synthesis)

/pan:map-codebase (brownfield only)
  │
  └── pan-document_code (x6 parallel: tech, arch, quality, concerns, relationships, practices)

/pan:plan-phase N
  │
  ├── pan-phase-researcher (produces research.md)
  ├── pan-planner (after research)
  └── pan-plan-checker (after planner, up to 3 revision loops)

/pan:exec-phase N
  │
  ├── pan-executor (per plan, wave-based parallelism)
  ├── /pan:phase-tests (auto test generation, skippable)
  ├── pan-reviewer (code review, skippable)
  └── pan-verifier (after all executors complete, with test gate)

/pan:milestone-audit
  │
  └── pan-integration-checker (cross-phase verification)

/pan:debug
  │
  └── pan-debugger (standalone, persistent state)
```

This file-mediated communication means:
- Agents can run in parallel (researchers, codebase mappers, executors in the same wave)
- Failed agents can be re-run without losing other agents' work
- Every intermediate artifact is inspectable on disk
- The orchestrator's context window stays light — heavy work happens in agent contexts

---

## Parallel Execution Patterns

### Research Phase
```
/pan:plan-phase N
  └── pan-phase-researcher
       │
       └── Writes research.md
```

### Codebase Mapping (6 parallel)
```
/pan:map-codebase
  ├── pan-document_code (tech)           → stack.md, integrations.md
  ├── pan-document_code (arch)           → architecture.md, structure.md
  ├── pan-document_code (quality)        → conventions.md, testing.md
  ├── pan-document_code (concerns)       → concerns.md
  ├── pan-document_code (relationships)  → relationships.md
  └── pan-document_code (practices)      → best-practices.md
```

### Plan Execution (wave-based)
```
/pan:exec-phase N
  Wave 1 (independent plans):
    ├── pan-executor (Plan 01) → commit
    └── pan-executor (Plan 02) → commit
  Wave 2 (depends on Wave 1):
    └── pan-executor (Plan 03) → commit
  Post-execution:
    └── pan-verifier → verification.md
```

---

## Agent Design Principles

Four principles are shared across all agents:

### 1. Goal-Backward Thinking
Start from what must be TRUE when the work is done, then work backwards to what must be built. This prevents the common failure of completing tasks without achieving goals.

Used by: `pan-planner` (must_haves derivation), `pan-verifier` (Observable Truths), `pan-plan-checker` (verification derivation), `pan-roadmapper` (success criteria).

### 2. Professional Skepticism
Verify actual state — don't trust claims. The verifier checks real code, not summary.md. The plan-checker validates plans deliver goals, not just describe them. Researchers treat training data as hypothesis.

Used by: `pan-verifier` ("DO NOT trust summary.md"), `pan-phase-researcher` (confidence levels), `pan-plan-checker` (multi-dimension validation).

### 3. Structured Returns
Every agent returns data in machine-parseable formats (YAML frontmatter, structured markdown sections, JSON). This enables orchestrators to route results programmatically and enables downstream agents to parse inputs reliably.

Used by: All agents — plan.md frontmatter, verification.md gap YAML, plan-checker issue reports, debug session state machine.

### 4. File-Mediated Communication
Agents never call each other. All data flows through `.planning/` files on disk. This makes every intermediate artifact inspectable, enables parallel execution, and means failed agents can be re-run without losing sibling work.

Used by: All agents — researchers write research.md, planner reads it; executor writes code, verifier checks it.

---

## Customizing Agents

Agent files are installed alongside commands. Location depends on runtime and install scope:

| Runtime | Global | Local |
|---------|--------|-------|
| Claude Code | `~/.claude/agents/*.md` | `.claude/agents/*.md` |
| OpenCode | `~/.config/opencode/agents/*.md` | `.opencode/agents/*.md` |
| Gemini CLI | `~/.gemini/agents/*.md` | `.gemini/agents/*.md` |
| Codex | `~/.codex/agents/*.toml` | `.codex/agents/*.toml` |
| Copilot CLI | `~/.copilot/agents/*.agent.md` | `.github/agents/*.agent.md` |

> **Note:** Copilot CLI uses the `.agent.md` extension; Codex uses standalone `.toml` agent files (markdown in `.codex/agents/` is not recognized). Claude, OpenCode, and Gemini use `.md`.

### Common Customizations

- Add domain-specific constraints to `<instructions>` (e.g., "Always use TypeScript strict mode")
- Modify output format requirements in `<output_format>` (e.g., custom plan.md sections)
- Add project-specific patterns to `<project_context>` (e.g., "This project uses a monorepo with pnpm workspaces")

### Preserving Customizations

After a PAN update (`npx pan-wizard@latest`), local modifications may be overwritten. The installer backs up modified files to `pan-local-patches/` before overwriting. Run `/pan:patches` to restore your changes.
