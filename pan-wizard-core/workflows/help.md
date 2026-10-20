<purpose>
Display the PAN command reference. Output ONLY the reference content. Do NOT add project-specific analysis, git status, next-step suggestions, or any commentary beyond the reference.
</purpose>

<reference>
# PAN Command Reference

**PAN** (Project Automation Navigator) — workflow automation for solo agentic development with Claude Code, Copilot CLI, Gemini CLI, Codex, and OpenCode.

---

## Two Workflows — Pick One

PAN has two distinct workflows. Pick the one that fits your situation.

### Workflow A: Phase Lifecycle (Greenfield / Milestone-Driven)

Best for: new projects, structured milestones, large multi-phase builds.

```
/pan:new-project          # 1. Research, requirements, roadmap
  /clear
/pan:plan-phase 1         # 2. Create detailed plan for phase 1
  /clear
/pan:exec-phase 1         # 3. Execute the plan
  /clear
/pan:verify-phase 1       # 4. Validate the work (optional)
  /clear
/pan:progress             # 5. See status, route to next phase
  ... repeat plan → exec → verify for each phase ...
/pan:milestone-done 1.0.0 # 6. Archive milestone when complete
```

### Workflow B: Focus Commands (Iterative / Brownfield)

Best for: existing projects, ongoing maintenance, iterative improvement, batch work sessions.

```
/pan:focus-scan            # 1. SCAN — find all work items, prioritize, score
  /clear
/pan:focus-plan            # 2. PLAN — budget items into a sized batch
  /clear
/pan:focus-exec            # 3. EXEC — implement, test, verify, commit
  /clear
/pan:focus-sync            # 4. SYNC — update docs to match changes
```

**focus-design** is a standalone command for deep feature investigation:
```
/pan:focus-design "Add webhook support"  # Research, design, spec, ADR
  /clear
/pan:focus-scan                          # Re-scan to pick up new tasks
```

**Documentation quality commands:**
```
/pan:focus-drift-walking                 # Walk project tree, detect doc-code drift
/pan:focus-doc-audit                     # Deep document audit with quality scoring
```

---

## Brownfield Quick-Start (Adding Features to an Existing Project)

Already have a codebase? Here's how to get started:

| Situation | Command |
|-----------|---------|
| Quick one-off fix or small feature | `/pan:quick "add logout button"` |
| Need to design a feature first | `/pan:focus-design "Add webhook support"` |
| Find and fix bugs, tech debt, gaps | `/pan:focus-scan` → `plan` → `exec` |
| Large feature needing multiple phases | `/pan:milestone-new` |
| Continuous automated improvement | `/pan:focus-auto` |

**Most common path — iterative improvement:**
```
/pan:focus-scan       # 1. Find work items (bugs, TODOs, gaps, features)
  /clear
/pan:focus-plan       # 2. Budget a batch (--mode features for feature work)
  /clear
/pan:focus-exec       # 3. Implement, test, commit
  /clear
/pan:focus-sync       # 4. Update docs to match
```

**Design-first path — new feature on existing codebase:**
```
/pan:focus-design "Add webhook support"   # Research → spec → ADR
  /clear
/pan:focus-scan                           # Picks up tasks from spec
  /clear
/pan:focus-plan --mode features           # Budget toward feature work
  /clear
/pan:focus-exec                           # Build it
```

**Large feature path — structured milestone on existing codebase:**
```
/pan:map-codebase          # Optional: help PAN understand your code
  /clear
/pan:milestone-new         # Create requirements + roadmap phases
  /clear
/pan:plan-phase 1 → /clear → /pan:exec-phase 1 → repeat
  ...
/pan:milestone-done 1.0.0
```

---

## Focus Commands — In Detail

The Focus workflow is a **scan → plan → exec → sync** pipeline. Each step feeds the next.

### Step 1: `/pan:focus-scan`

**What it does:** Deep-dives into your entire codebase — reads every module, greps for TODOs/FIXMEs, runs tests, checks coverage gaps, reads your roadmap — then produces a prioritized work list.

**Priority tiers:** P0 (crashes) → P1 (wrong results) → P2 (test gaps) → P3 (incomplete features) → P4 (new features) → P5 (tooling) → P6 (docs)

**Reality Score:** Every P3-P6 item gets scored: `RS = (User Value + Time Criticality + Risk Reduction) / Job Size`. Items below RS 3.0 get deferred, below 1.5 get dropped.

**Output:** the prioritized work list, returned by `pan-tools focus scan` as JSON (`/pan:focus-plan` collects the items again itself).

**Flags:**
- `--quick` — skip strategic analysis and validation phases
- `--lean` — aggressive RS filtering (drop < 1.5, defer < 3.0)
- `--focus <area>` — weight items toward a specific area
- `--refresh` — force re-read all files

### Step 2: `/pan:focus-plan`

**What it does:** Reads the scan output and selects a right-sized batch of work items that fits within a point budget. Orders items for maximum impact with minimum risk.

**Requires:** A scan from step 1 (runs one automatically if missing).

**Modes:**
| Mode | Budget | Strategy |
|------|--------|----------|
| `bugfix` | 40 pts | One pass over P0→P4 in priority order, smallest first within a priority (P5–P6 excluded; no item-type filter) |
| `balanced` | 50 pts | 60% stability / 40% features (default) |
| `features` | 50 pts | 80% features, P0 crashes still mandatory |
| `full` | 60 pts | One pass over every priority in priority order (P0 first, smallest first within a priority) |

**Point system:** XS=1, S=2, M=4, L=10, XL=20 points.

**Output:** `.planning/focus/batch-<date>.json` — the execution batch that `/pan:focus-exec` reads.

**Flags:**
- `--mode <mode>` — select execution mode (default: balanced)
- `--budget N` — override point budget (5-100)
- `--lean` — exclude items with RS < 1.5

### Step 3: `/pan:focus-exec`

**What it does:** One-command pipeline that implements every item in the batch. Runs 6 stages automatically:

1. **Session Start** — baseline tests, rollback snapshot
2. **Batch Loading** — read and validate the batch file
3. **Execution** — implement items tier by tier (MICRO → STANDARD → FULL)
4. **Verification** — full test suite, compare against baseline
5. **Doc Sync** — update README, CHANGELOG, etc.
6. **Session End** — commit, record session summary

**Execution tiers:**
| Tier | Sizes | Test cadence |
|------|-------|-------------|
| MICRO | XS, S | Specific test after each item |
| STANDARD | M | Full test suite after each item |
| FULL | L, XL | Build + full test suite after each item |

**Requires:** A batch from step 2.

**Flags:**
- `--no-commit` — skip the commit step
- `--continue` — resume a previously interrupted run
- `--dry-run` — show stages 1-2 only

### Step 4: `/pan:focus-sync`

**What it does:** Checks all documentation for staleness and fixes it. Compares actual command counts, module counts, test counts against what docs claim.

**Checks:** README, USER-GUIDE, ARCHITECTURE, CLI-REFERENCE, CHANGELOG, command files, agent files.

**Flags:**
- `--readme` — check README only
- `--docs` — verify documentation matches implementations
- `--arch` — verify architecture docs match actual structure
- `--all` — full sync + auto-fix

### Standalone: `/pan:focus-design <description>`

**What it does:** Full 10-phase feature investigation pipeline. Not part of the scan→plan→exec flow — use this when you need to design a new feature from scratch.

**10 phases:** Problem framing → Internal recon → Competitive intel → Strategic analysis → Architecture → Design synthesis → ADR → Error handling → Security → Implementation roadmap

**Modes:**
| Mode | Phases | Use when |
|------|--------|----------|
| `--full` | All 10 (default) | New user-facing features |
| `--internal` | Skip competitive | Internal tooling, refactors |
| `--outward` | Skip hardening | Market research, strategic decisions |
| `--spike` | 4 phases only | Quick proof-of-concept |

**Modifiers:** `--gate` (pause after strategy), `--audit` (verify existing impl), `--mvp` (stop at MVP tasks)

**Output:** Spec in `docs/specs/`, ADR in `docs/decisions/`

---

## All Commands

Every shipped command, by group. This list is generated from each command's own description, so it is complete.

<!-- generated:command-index:start (scripts/build-help.cjs --write) -->
### Getting Started
| Command | Description |
|---------|-------------|
| `/pan:map-codebase` | Analyze codebase with parallel mapper agents to produce .planning/codebase/ documents |
| `/pan:new-project` | Initialize a new project with deep context gathering and project.md |

### Phase Lifecycle
| Command | Description |
|---------|-------------|
| `/pan:design-phase` | Design a roadmap phase before planning — architecture, ADR, threat-lite, machine-checkable criteria — verified by an independent checker |
| `/pan:discuss-phase` | Gather phase context through adaptive questioning before planning |
| `/pan:exec-phase` | Execute all plans in a phase with wave-based parallelization |
| `/pan:plan-phase` | Create detailed phase plan (plan.md) with verification loop |
| `/pan:research-phase` | Research how to implement a phase (standalone - usually use /pan:plan-phase instead) |
| `/pan:verify-phase` | Re-run goal-backward verification of a phase with a test-suite gate and list its gaps, or walk its UAT with --uat |

### Phase Management
| Command | Description |
|---------|-------------|
| `/pan:add-phase` | Add phase to end of current milestone in roadmap |
| `/pan:assumptions` | Surface Claude's assumptions about a phase approach before planning |
| `/pan:insert-phase` | Insert urgent work as decimal phase (e.g., 72.1) between existing phases |
| `/pan:phase-budget` | Estimate context utilization and quality for the current phase |
| `/pan:phase-tests` | Generate tests for a completed phase from its summaries, context decisions, verification report and implementation |
| `/pan:remove-phase` | Remove a future phase from roadmap and renumber subsequent phases |

### Session & Progress
| Command | Description |
|---------|-------------|
| `/pan:pause` | Create context handoff when pausing work mid-phase |
| `/pan:profile` | Switch model profile for PAN agents (quality/balanced/budget) |
| `/pan:progress` | Check project progress, show context, and route to next action (execute or plan) |
| `/pan:quick` | Execute a quick task with PAN guarantees (atomic commits, state tracking) but skip optional agents |
| `/pan:resume` | Resume work from previous session with full context restoration |

### Milestone
| Command | Description |
|---------|-------------|
| `/pan:milestone-audit` | Audit milestone completion against original intent before archiving |
| `/pan:milestone-cleanup` | Archive accumulated phase directories from completed milestones |
| `/pan:milestone-done` | Archive completed milestone and prepare for next version |
| `/pan:milestone-gaps` | Create phases to close all gaps identified by milestone audit |
| `/pan:milestone-new` | Start a new milestone cycle — update project.md and route to requirements |

### Milestone Lifecycle
| Command | Description |
|---------|-------------|
| `/pan:retro` | Milestone retrospective — analyze estimation accuracy, verification patterns, and common gaps |

### Focus
| Command | Description |
|---------|-------------|
| `/pan:focus-auto` | Continuous scan-plan-exec loop with purpose-driven categories and a layered safety harness |
| `/pan:focus-design` | Strategic 10-phase feature investigation, design, and specification pipeline |
| `/pan:focus-doc-audit` | Multi-dimensional document audit — accuracy, freshness, links, cross-consistency, and structural quality |
| `/pan:focus-drift-walking` | Deep documentation-code drift detection, CLAUDE.md alignment, and auto-repair across all project directories |
| `/pan:focus-exec` | Automated batch execution pipeline with 6 stages, behavioral rules, 3 execution tiers |
| `/pan:focus-plan` | Create capacity-budgeted work batch with spec coverage verification and 4 execution modes |
| `/pan:focus-scan` | Deep-dive strategic work scan with prioritized items and Reality Score filtering |
| `/pan:focus-sync` | Synchronize documentation after changes — check staleness and update counts |

### Foresight
| Command | Description |
|---------|-------------|
| `/pan:preview` | Preview what will happen — phase blast radius, phase dependency graph, or milestone ETA |
| `/pan:what-if` | Explore a phase's alternative approach in an isolated git worktree. Replays the scenario, compares to the original plan, writes a report. |

### Review
| Command | Description |
|---------|-------------|
| `/pan:review-deep` | Security audit + cross-reviewer check. OWASP/STRIDE pass by pan-hardener, then pan-meta-reviewer catches what the first pass missed. Writes consolidated deep-review.md. |

### Validation
| Command | Description |
|---------|-------------|
| `/pan:links` | Validate the doc-code link graph — inline wiki-style refs, source-comment anchors, and require-code-mention contracts (ADR-0027, v3.8.0+) |

### Observability
| Command | Description |
|---------|-------------|
| `/pan:cost` | Show token usage and estimated cost across PAN commands and agents |
| `/pan:dashboard` | Alias for /pan:hud — generate the single-page HTML dashboard of the bot army and project |
| `/pan:hud` | Generate a single-page, self-contained HTML dashboard of the bot army and the project's current state |
| `/pan:report` | Generate a self-contained HTML report for one phase, or a project-level timeline index linking every phase report |

### Knowledge
| Command | Description |
|---------|-------------|
| `/pan:knowledge` | Grounded Q&A, multi-turn design discussion, and playbook generation. Three modes in one command. |

### Self-Improvement
| Command | Description |
|---------|-------------|
| `/pan:experiment` | Manage external experiments — scaffold, run, harvest, promote findings back to PAN |
| `/pan:learn` | Analyze trace sessions or harvested experiments via pan-optimizer; generate ranked optimization reports |
| `/pan:optimize` | Manage the circular optimization loop — record a report's suggestions, undo them, view stats, list reports, manage trace sessions |

### Git Workflow
| Command | Description |
|---------|-------------|
| `/pan:git` | Safe, phase-aware git workflow commands — commit, branch, push, status, log, stash, diff, rollback, tag, sync |

### Army
| Command | Description |
|---------|-------------|
| `/pan:army` | Bot-army campaign — Mission Control (the reasoning-tier conductor) delegates a whole-project goal to squads (architecture / build / quality / release), each squad working branch-per-agent worktrees under a hard safety harness, gated by CI + a human merge, looping plan→delegate→execute→review→integrate→learn until the goal ships or a stop condition fires. |

### External tools
| Command | Description |
|---------|-------------|
| `/pan:mcp-bridge` | Discover available MCP tools and recommend which ones apply to a phase. Discovery-only; auto-invocation deferred. |

### System
| Command | Description |
|---------|-------------|
| `/pan:audit-deployment` | Audit a PAN Wizard deployment — verify installation integrity, project health, and draft enhancement specs |
| `/pan:debug` | Systematic debugging with persistent state across context resets |
| `/pan:health` | Diagnose planning directory health and optionally repair issues |
| `/pan:help` | Show available PAN commands and usage guide |
| `/pan:hygiene` | Scan the project for PAN version drift and stale artifacts (legacy filenames, memory bloat and stale entries, poisoned ledgers, trace debris, oversized planning files) and apply safe cleanups |
| `/pan:patches` | Reapply local modifications after a PAN update |
| `/pan:settings` | Configure PAN workflow toggles and model profile |
| `/pan:todo-add` | Capture idea or task as todo from current conversation context |
| `/pan:todo-check` | List pending todos and select one to work on |
| `/pan:update` | Update PAN to latest version with changelog display |

### Community
| Command | Description |
|---------|-------------|
| `/pan:discord` | Join the PAN Discord community |
<!-- generated:command-index:end -->

---

## Common Patterns

**New project from scratch:**
```
/pan:new-project → /clear → /pan:plan-phase 1 → /clear → /pan:exec-phase 1 → repeat
```

**Existing project, iterative work:**
```
/pan:focus-scan → /clear → /pan:focus-plan → /clear → /pan:focus-exec → /clear → /pan:focus-sync
```

**Design a feature, then build it:**
```
/pan:focus-design "feature" → /clear → /pan:focus-scan → /clear → /pan:focus-plan → /clear → /pan:focus-exec
```

**Resume after a break:**
```
/pan:progress       # See where you left off
/pan:resume         # Full context restoration
```

**Quick ad-hoc task:**
```
/pan:quick "fix the login button"
```

**Insert urgent work mid-milestone:**
```
/pan:insert-phase 5 "Critical security fix" → /pan:plan-phase 5.1 → /pan:exec-phase 5.1
```

**Complete a milestone:**
```
/pan:milestone-audit → /pan:milestone-gaps → ... fix gaps ... → /pan:milestone-done 1.0.0
```

**Debug an issue (survives /clear):**
```
/pan:debug "form submission fails" → ... investigate ... → /clear → /pan:debug
```

---

## Phase Lifecycle — Detail

**`/pan:new-project`** — One command: deep questioning → optional domain research (4 parallel agents) → requirements → roadmap. Creates `.planning/` with project.md, roadmap.md, state.md, config.json, requirements.md.

**`/pan:map-codebase`** — Analyze existing codebase before `/pan:new-project`. Creates `.planning/codebase/` with its codebase documents (stack, architecture, structure, conventions, testing, integrations, concerns, relationships, best-practices).

**`/pan:discuss-phase <N>`** — Capture your vision for a phase before planning. Creates context.md.

**`/pan:research-phase <N>`** — Deep ecosystem research for specialized domains (3D, ML, audio, etc.). Creates research.md.

**`/pan:assumptions <N>`** — See Claude's intended approach before it starts. Conversational only, no files created.

**`/pan:plan-phase <N>`** — Create execution plan. Generates `XX-YY-plan.md` with concrete tasks. Pass `--prd path/to/requirements.md` to skip discuss-phase.

**`/pan:exec-phase <N>`** — Execute all plans in a phase. Groups by wave, runs waves sequentially, plans within each wave in parallel.

**`/pan:verify-phase <N>`** — Re-run goal-backward verification behind a test-suite gate. Writes the phase's verification report (passed, gaps_found or human_needed); fix gaps with `/pan:plan-phase <N> --gaps`.

**`/pan:quick <desc>`** — Small tasks with PAN guarantees but shorter path. Skips researcher, checker, verifier. Lives in `.planning/quick/`.

---

## Milestone Management — Detail

**`/pan:milestone-new`** — Start new milestone. Mirrors `/pan:new-project` flow for brownfield projects.

**`/pan:milestone-done <version>`** — Archive completed milestone. Creates milestones.md entry, git tag, archives to `milestones/` directory.

**`/pan:milestone-audit`** — Reads verification.md files, checks requirements coverage, spawns integration checker. Creates milestone-audit.md.

**`/pan:milestone-gaps`** — Reads audit, groups gaps into phases, adds to roadmap.md.

**`/pan:milestone-cleanup`** — Moves completed phase directories to `milestones/v{X.Y}-phases/`.

**`/pan:retro`** — Milestone retrospective. Analyzes estimation accuracy, verification patterns, and common gap types. Run after `/pan:milestone-done` to reflect before the next milestone.

---

## Session & Debugging — Detail

**`/pan:progress`** — Visual progress bar, completion %, recent work summary, next action routing. Detects 100% milestone completion.

**`/pan:resume`** — Reads state.md, shows current position, offers next actions.

**`/pan:pause`** — Creates `.continue-here` file, updates state.md session continuity.

**`/pan:debug [description]`** — Scientific method debugging with persistent state in `.planning/debug/`. Survives `/clear` — run `/pan:debug` with no args to resume.

**`/pan:todo-add [desc]`** — Capture from conversation or explicit description. Creates structured todo in `.planning/todos/pending/`.

**`/pan:todo-check [area]`** — List pending todos, select one, route to action (work now, add to phase, brainstorm).

---

## Configuration

**`/pan:settings`** — Toggle researcher, plan checker, verifier agents. Select model profile.

**`/pan:profile <name>`** — Quick profile switch: `quality` and `balanced` (reasoning tier for every agent; `balanced` is the default), `budget` (mid tier for writing, fast tier for research/verification).

**Planning config** (`.planning/config.json`):
- `commit_docs: true` — commit planning artifacts to git (set `false` + add `.planning/` to `.gitignore` for private planning)
- `search_gitignored: false` — reserved: read by `loadConfig` and reported by `init map-codebase`, but no workflow or agent acts on it (to search a gitignored `.planning/`, add `--no-ignore` to `rg` yourself)

---

## Files & Structure

```
.planning/
├── project.md            # Project vision
├── roadmap.md            # Current phase breakdown
├── state.md              # Project memory & context
├── requirements.md       # Scoped requirements with REQ-IDs
├── config.json           # Workflow & gate configuration
├── focus/                # Focus batch files
│   └── batch-YYYY-MM-DD.json
├── todos/
│   ├── pending/          # Todos waiting
│   └── completed/        # Completed todos
├── debug/                # Active debug sessions
│   └── resolved/         # Archived resolved issues
├── milestones/           # Archived milestones
├── codebase/             # Codebase map (brownfield)
└── phases/               # Phase plans and summaries
    └── NN-phase-name/
        ├── NN-YY-plan.md
        └── NN-YY-summary.md
```

---

## Staying Updated

```bash
npx pan-wizard@latest
```

Run `/pan:update` for version comparison and changelog preview before updating.

## Getting Help

- `/pan:progress` — see where you're at
- `.planning/state.md` — current project context
- `.planning/roadmap.md` — phase status
- `/pan:discord` — community support
</reference>
