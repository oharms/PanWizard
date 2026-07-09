<purpose>
Display the complete PAN command reference. Output ONLY the reference content. Do NOT add project-specific analysis, git status, next-step suggestions, or any commentary beyond the reference.
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

**Output:** `.planning/superplan_<date>.md` — the prioritized work list that `/pan:focus-plan` reads.

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
| `bugfix` | 40 pts | P0→P1→smallest-first, no features |
| `balanced` | 50 pts | 60% stability / 40% features (default) |
| `features` | 50 pts | 80% features, P0 crashes still mandatory |
| `full` | 60 pts | All priorities equally weighted |

**Point system:** XS=1, S=2, M=4, L=10, XL=20 points.

**Output:** `.planning/focus/batch-<date>.json` — the execution batch that `/pan:focus-exec` reads.

**Flags:**
- `--mode <mode>` — select execution mode (default: balanced)
- `--budget N` — override point budget (5-100)
- `--dry-run` — show what would be selected without writing
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
- `--commands` — verify command files match implementations
- `--agents` — verify agent files
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

## All Commands (42)

### Getting Started
| Command | Description |
|---------|-------------|
| `/pan:new-project` | Initialize new project — research, requirements, roadmap |
| `/pan:map-codebase` | Analyze existing codebase with parallel agents |

### Phase Lifecycle
| Command | Description |
|---------|-------------|
| `/pan:discuss-phase <N>` | Shape implementation through targeted questions |
| `/pan:plan-phase <N>` | Research + plan a phase with verification |
| `/pan:exec-phase <N>` | Execute plans with wave-based parallelization |
| `/pan:research-phase <N>` | Deep ecosystem research for specialized domains |
| `/pan:verify-phase <N>` | Validate built features through UAT |

### Phase Management
| Command | Description |
|---------|-------------|
| `/pan:add-phase <desc>` | Append new phase to roadmap |
| `/pan:insert-phase <N> <desc>` | Insert urgent work between phases |
| `/pan:remove-phase <N>` | Remove phase and renumber |
| `/pan:assumptions <N>` | Surface approach assumptions before planning |
| `/pan:phase-tests <N>` | Generate tests for completed phase |
| `/pan:phase-budget` | Estimate context utilization for current phase |

### Session & Progress
| Command | Description |
|---------|-------------|
| `/pan:progress` | Check status and route to next action |
| `/pan:quick <desc>` | Fast-path execution (skip optional agents) |
| `/pan:pause` | Save context for later resumption |
| `/pan:resume` | Restore previous session context |
| `/pan:profile <name>` | Switch model profile (quality/balanced/budget) |

### Milestone
| Command | Description |
|---------|-------------|
| `/pan:milestone-new` | Start a new milestone cycle |
| `/pan:milestone-done <v>` | Archive completed milestone |
| `/pan:milestone-audit` | Audit completion against intent |
| `/pan:milestone-gaps` | Create phases to close audit gaps |
| `/pan:milestone-cleanup` | Archive accumulated phase directories |
| `/pan:retro` | Milestone retrospective — estimation & verification analysis |

### Focus (Strategic Project Management)
| Command | Description |
|---------|-------------|
| `/pan:focus-scan` | Step 1: Find and prioritize all work items |
| `/pan:focus-plan` | Step 2: Budget items into an execution batch |
| `/pan:focus-exec` | Step 3: Implement, test, verify, commit |
| `/pan:focus-sync` | Step 4: Synchronize documentation after changes |
| `/pan:focus-auto` | Continuous scan→plan→exec loop with safety harness |
| `/pan:focus-design <desc>` | Standalone: Deep feature investigation and spec |
| `/pan:focus-drift-walking` | Walk project tree, detect doc-code drift, auto-repair |
| `/pan:focus-doc-audit` | Deep document audit with quality scoring |

### System
| Command | Description |
|---------|-------------|
| `/pan:help` | Show this reference |
| `/pan:health` | Diagnose planning directory integrity |
| `/pan:settings` | Configure workflow toggles |
| `/pan:update` | Update PAN to latest version |
| `/pan:debug` | Systematic debugging with persistent state |
| `/pan:todo-add` | Capture idea as todo |
| `/pan:todo-check` | List and select pending todos |
| `/pan:audit-deployment <dir>` | Audit a PAN installation for integrity and health |

### Community
| Command | Description |
|---------|-------------|
| `/pan:discord` | Join the PAN Discord community |
| `/pan:patches` | Reapply local modifications after update |

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

**`/pan:map-codebase`** — Analyze existing codebase before `/pan:new-project`. Creates `.planning/codebase/` with 7 documents (stack, architecture, structure, conventions, testing, integrations, concerns).

**`/pan:discuss-phase <N>`** — Capture your vision for a phase before planning. Creates context.md.

**`/pan:research-phase <N>`** — Deep ecosystem research for specialized domains (3D, ML, audio, etc.). Creates research.md.

**`/pan:assumptions <N>`** — See Claude's intended approach before it starts. Conversational only, no files created.

**`/pan:plan-phase <N>`** — Create execution plan. Generates `XX-YY-plan.md` with concrete tasks. Pass `--prd path/to/requirements.md` to skip discuss-phase.

**`/pan:exec-phase <N>`** — Execute all plans in a phase. Groups by wave, runs waves sequentially, plans within each wave in parallel.

**`/pan:verify-phase <N>`** — Conversational UAT. Presents tests one at a time, diagnoses failures, creates fix plans.

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

**`/pan:profile <name>`** — Quick profile switch: `quality` (Opus everywhere), `balanced` (Opus plan + Sonnet exec, default), `budget` (Sonnet + Haiku).

**Planning config** (`.planning/config.json`):
- `commit_docs: true` — commit planning artifacts to git (set `false` + add `.planning/` to `.gitignore` for private planning)
- `search_gitignored: false` — add `--no-ignore` to ripgrep when `.planning/` is gitignored

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
├── superplan_*.md        # Focus scan output
├── todos/
│   ├── pending/          # Todos waiting
│   └── done/             # Completed todos
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
