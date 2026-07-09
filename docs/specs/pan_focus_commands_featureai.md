# Feature Specification: PAN Focus Commands

**Feature:** Ship strategic project management as first-class PAN commands — scan, design, plan-work, exec-work, sync-docs
**Generated:** 2026-03-01
**Status:** Proposed
**ADR:** ADR-0006

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard's shipped workflow is phase-scoped: plan phase 1, execute phase 1, plan phase 2, execute phase 2. But real development doesn't flow linearly. Between milestones, developers need to step back and ask strategic questions: "What should I work on next?", "What's the highest-impact thing I can do in 30 minutes?", "Is this feature worth building at all?", "Which of these 15 TODOs actually matters?". Today, PAN has no shipped answer — these capabilities exist only as custom `.claude/commands/` skills (superplan, execplan, featureAI, session-start/end, sync) that are invisible to users who install PAN via `npx pan-wizard`. The cost of NOT doing this: PAN users are limited to sequential phase execution with no strategic layer, while competitors like Taskmaster AI offer task-level prioritization, and Claude Code's plan mode provides lightweight planning — leaving PAN's most powerful capabilities locked behind custom skill files that don't ship.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Internal usage | This project | superplan invoked 15 times, execplan ~16 sessions, featureAI 4 specs — these are the most-used custom skills |
| Competitor feature | Taskmaster AI (17k+ GitHub stars) | Ships task breakdown, prioritization (high/medium/low), dependency tracking, `next` command — same problem space |
| Competitor feature | Claude Code plan mode (2026) | Plan files saved to project, task lists with DAG dependencies, plansDirectory config — strategic planning built into the tool |
| Competitor feature | Cline plan/act modes | Separate models for planning vs execution — acknowledges planning is a distinct workflow |
| User pain | This conversation | User asked "what the equiv of superplan then" — realizing the gap between custom skills and shipped product |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| 5 new shipped commands in `commands/pan/` group "Focus" | Separate `pan-focus` CLI tool (must integrate into PAN, not fork) |
| New `focus.cjs` core module for scan/design/plan/exec logic | Separate superplan file format — integrate into existing roadmap.md/plan.md |
| Full 10-phase featureAI investigation pipeline as focus-design | PanMonty status tracker (redundant with state.md) |
| Full 7-phase superplan pipeline as focus-scan (P0-P6, Reality Score, validation) | Memory bank files (.claude/memory/) — keep as dev-only |
| Full 6-stage execplan pipeline as focus-exec (all 9 rules, 4 modes, 3 tiers) | Separate task.json format (Taskmaster-style — PAN uses plan.md frontmatter) |
| Priority (P0-P6) and effort (XS-XL) fields in plan.md frontmatter | — |
| Codebase TODO/FIXME scanning, Reality Score formula, capacity budgeting | — |
| Doc sync automation (focus-sync), all 4 execution modes | — |
| Integration with existing phase workflow | — |

### 0.4 Success Criteria

```
SC-1: User can run `/pan:focus-scan` to get a prioritized list of work items from codebase + planning files
SC-2: User can run `/pan:focus-design <topic>` to produce a spec + ADR before building
SC-3: User can run `/pan:focus-plan` to create a capacity-budgeted batch of work items
SC-4: User can run `/pan:focus-exec` to execute a planned batch with tier-based shortcuts
SC-5: User can run `/pan:focus-sync` to synchronize docs after changes
SC-6: All 5 commands work across Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI
SC-7: No regression in existing 802+ tests
SC-8: New commands integrate with existing phase commands (not a parallel system)
SC-9: Focus commands respect existing config.json settings
```

### 0.5 User Stories

```
As a developer using PAN Wizard (on any runtime — Claude Code, OpenCode, Gemini CLI, Codex, or Copilot CLI),
I want to scan my project for the most important work,
so that I can focus on high-impact items, instead of manually reading roadmap.md and grepping for TODOs.

As a developer starting a new feature, I want to design it with competitive research and architecture review,
so that I build the right thing the right way, instead of coding first and regretting the design later.

As a developer with limited time, I want to plan a work batch that fits my session budget,
so that I complete meaningful work in each sitting, instead of starting things I can't finish.

As a developer finishing a batch, I want docs auto-synced after my changes,
so that README/CHANGELOG/docs stay accurate, instead of forgetting to update them.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:progress` | Partial | focus-scan is a superset — progress shows status, scan adds prioritized action items. Keep both: progress for quick status, scan for strategic planning. |
| `/pan:plan-phase` | Partial | focus-plan creates cross-cutting work batches that may span phases. plan-phase creates single-phase plans. Complementary. |
| `/pan:exec-phase` | Partial | focus-exec runs batched items with tier shortcuts. exec-phase runs full wave-based phase execution. focus-exec can delegate to exec-phase for L/XL items. |
| `/pan:discuss-phase` | Partial | focus-design is feature-level (competitive research, ADR, spec). discuss-phase is phase-level (vision capture). Different scope. |
| `/pan:health` | None | Health checks .planning/ structure. Scan checks work items. |
| `pan-project-researcher` | Partial | focus-design uses competitive research. Agent does domain research. Different inputs. |

**No full overlap found.** All Focus commands fill genuine gaps.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 32 | 37 | +5 |
| New concepts introduced | 0 | 3 (priority tiers, effort sizing, capacity budgets) |
| Score | -- | -- | +1 (adds complexity) |

**Justification:** The +5 commands are grouped under "Focus" — a single new group name. The 3 concepts (priority, effort, budget) are optional metadata on existing plan.md files, not new file types. Users can ignore Focus commands entirely and use the existing phase workflow. Focus is additive, not disruptive.

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Phase lifecycle (plan/execute/verify) | Shipped | phase.cjs, init.cjs | Foundation — Focus extends, doesn't replace |
| State management (state.md) | Shipped | state.cjs | Focus reads/writes state.md for tracking |
| Plan tier classification (MICRO/STANDARD/FULL) | Shipped | phase.cjs:classifyPlanTier() | Core of focus-exec tier shortcuts |
| Effort-to-points conversion | Shipped | init.cjs:effortToPoints() | Capacity budgeting already has point system |
| Budget tracking (--budget, --dry-run) | Shipped | init.cjs execute-phase | Foundation for focus-plan budgeting |
| Error pattern learning | Shipped | commands.cjs:readErrorPatterns/appendErrorPattern | Focus-scan surfaces patterns |
| Session history | Shipped | commands.cjs:appendSessionSummary | Focus-exec records sessions |
| Rollback snapshots | Shipped | commands.cjs:cmdRollbackSnapshot | Focus-exec uses git tags |
| Commit safety (--type, --force) | Shipped | commands.cjs:cmdCommit | Focus-sync commits cleanly |
| Test skip detection | Shipped | commands.cjs:shouldSkipTests | Focus-exec MICRO tier skips |
| Health composite score | Shipped | commands.cjs:renderHealthReport | Focus-scan includes health |
| Todo scanning | Shipped | core.cjs:scanPendingTodos | Focus-scan includes todos |
| Frontmatter extraction | Shipped | frontmatter.cjs | Focus reads priority/effort from plan.md |
| Config sections (budget, commit, execution) | Shipped | core.cjs:loadConfig | Focus commands respect config |

### 1.2 Convention Enforcement Checklist

- [x] Functions named `cmd<Module><Action>(cwd, raw, ...args)` — new module: `cmdFocusScan`, `cmdFocusPlan`, etc.
- [x] File reads use `safeReadFile()` pattern
- [x] File writes wrapped in try-catch
- [x] JSON output via `output(data, raw, humanLabel)`
- [x] Errors via `error(message)`
- [x] Paths via `toPosix()`
- [x] Module exports at bottom
- [x] Subcommands via `switch` in `pan-tools.cjs`
- [x] CommonJS only (`.cjs`)
- [x] Zero runtime dependencies

### 1.3 Dependency & Integration Map

```
[Focus Commands]
    ├── depends on: core.cjs (output, error, safeReadFile, scanPendingTodos)
    ├── depends on: phase.cjs (classifyPlanTier, findPhaseInternal)
    ├── depends on: init.cjs (effortToPoints)
    ├── depends on: frontmatter.cjs (extractFrontmatter)
    ├── depends on: state.cjs (readStateSafe)
    ├── depends on: commands.cjs (readErrorPatterns, renderHealthReport)
    ├── depends on: roadmap.cjs (parseRoadmap)
    ├── depends on: constants.cjs (all path constants)
    ├── depends on: utils.cjs (planningPath, classifyPhaseStatus)
    ├── extends: progress (scan is superset)
    ├── extends: exec-phase (exec adds tier shortcuts + budgeting)
    ├── conflicts with: nothing
    └── enables: future execution modes, pattern auto-remediation
```

**require() chain (no cycles):**
```
pan-tools.cjs → focus.cjs → core.cjs → constants.cjs
                           → phase.cjs → utils.cjs
                           → init.cjs
                           → frontmatter.cjs
                           → state.cjs
                           → commands.cjs
                           → roadmap.cjs
```

---

## Phase 2: Competitive Intelligence

### 2.1 Tool Research

**Taskmaster AI (claude-task-master)**
- **UX:** CLI (`task-master init/list/next/expand/update`) + MCP server for IDE integration
- **Behavior:** PRD → tasks.json with dependencies, priority (high/medium/low), test strategies. `next` command factors priority + dependency count. `expand` breaks tasks into subtasks.
- **Ergonomics:** Simple three-tier priority. JSON task storage. Clean `next` routing.
- **Pitfalls:** No verification step. No rollback. No cross-session learning. Tasks are flat JSON — no phase hierarchy.
- **Evolution:** Started as Cursor-specific, expanded to multi-IDE via MCP.

**Claude Code Plan Mode**
- **UX:** Shift+Tab×2 toggles plan mode. Task lists via Ctrl+T. Plans saved to `plansDirectory`.
- **Behavior:** Read-only analysis → structured task list with DAG dependencies → switch to auto-accept → execute. Plans persist across context compaction.
- **Ergonomics:** Seamless plan→execute transition. Tasks survive /clear. Stop hooks for auto-testing.
- **Pitfalls:** No priority framework. No capacity budgeting. No competitive research. Plan files are informal markdown.
- **Evolution:** Added plansDirectory config, task DAG support, stop hooks in 2026.

**Cline Plan/Act Modes**
- **UX:** Toggle between Plan (restricted tools, strategic thinking) and Act (full tools, execution).
- **Behavior:** Separate model configs per mode — reasoning model for planning, fast model for execution.
- **Ergonomics:** Clean separation of concerns. Different models optimize cost.
- **Pitfalls:** No persistence across sessions. No task tracking. Manual mode switching.

**Aider**
- **UX:** CLI chat with `/run`, `/architect`, `/ask` modes.
- **Behavior:** Architect mode uses reasoning model for design, then coder model implements. Git auto-commit after each change.
- **Ergonomics:** Excellent git integration. Auto-commit is loved/hated.
- **Pitfalls:** No project-level planning. No task management. File-level, not feature-level.

**Windsurf/Cursor**
- **UX:** IDE-integrated AI with multi-file editing.
- **Behavior:** Cascade flows (Windsurf) / Composer (Cursor) for multi-step operations.
- **Ergonomics:** Great for implementation. Poor for strategic planning.
- **Pitfalls:** IDE-locked. No CLI workflow. No cross-session persistence.

**GitHub Copilot Workspace**
- **UX:** Issue → plan → implement → PR. Web-based.
- **Behavior:** Structured plan-execute-verify. Task decomposition from issues.
- **Ergonomics:** End-to-end from issue to PR. Clear verification.
- **Pitfalls:** GitHub-locked. Web-only. No local/CLI workflow. Slow iteration.

### 2.2 Competitive Matrix

| Aspect | PAN (Current) | PAN+Focus | Taskmaster AI | Claude Code | Cline | Aider |
|--------|--------------|-----------|---------------|-------------|-------|-------|
| **Planning depth** | Phase-level | Phase + cross-cutting strategy | Task-level (flat) | Informal markdown | Mode toggle | File-level |
| **Prioritization** | None | P0-P6 + effort sizing | High/Med/Low | None | None | None |
| **Capacity budgeting** | Partial (--budget) | Full (points + modes) | None | None | None | None |
| **Execution automation** | Wave-based phases | Tier-based shortcuts + batches | Manual per-task | Auto-accept mode | Act mode | Auto-commit |
| **Session persistence** | state.md + pause/resume | + session history + patterns | tasks.json | Plan files | None | Git only |
| **Verification** | UAT (verify-phase) | + scan verification | Test strategy field | Stop hooks | None | None |
| **Feature design** | discuss-phase | + competitive research + ADR | None | Plan mode (informal) | Plan mode | Architect mode |
| **Cross-platform** | 5 runtimes | 5 runtimes | MCP + CLI | Claude only | VS Code | CLI |
| **Doc sync** | Manual | Automated focus-sync | None | None | None | None |

### 2.3 Key Insight

**No tool combines all three layers:** (1) strategic prioritization, (2) capacity-budgeted execution, (3) cross-session learning. Taskmaster has (1) without (2,3). Claude Code has lightweight (2) without (1,3). PAN+Focus would be the first to ship all three as an integrated system.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop from the custom skills? | PanMonty status tracker (redundant with state.md), separate memory bank files (.claude/memory/), PAN-Wizard-specific references (test counts, module names) |
| **REDUCE** | What should be reduced? | Installation friction (ship as commands, not custom skills). Project-specific hardcoding (generalize for any project). |
| **RAISE** | What should be enhanced? | Integration with existing phase workflow. Config respect. Cross-session pattern learning. Full pipeline rigor (ALL phases preserved, no shortcuts). |
| **CREATE** | What should we create that nobody has? | Unified scan→design→plan→exec→sync pipeline as shipped commands. Full 10-phase investigation pipeline (no competitor has this depth). Full 7-phase strategic scanning with Reality Score market-fit filtering. Full 6-stage execution with 9 mandatory behavioral rules and 4 execution modes. |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                  ↑                ↑
            Taskmaster AI     PAN Focus
            (early product)   (targeting)
```

Strategic planning for AI coding is moving from Genesis (every team builds custom) to Custom-Built (Taskmaster, Claude Code plan mode). PAN Focus targets the Product stage — integrated, consistent, cross-platform.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Focus commands create rich, structured context for AI agents via prioritized work items, design specs, and pattern learning | 5 |
| **Cross-Platform** | Works across 5 runtimes — Taskmaster is MCP-dependent, Claude Code is Claude-only | 5 |
| **Developer Experience** | Unified pipeline: scan→design→plan→exec→sync — no other tool has this end-to-end | 4 |
| **Zero Dependencies** | Maintains zero-runtime-deps — Taskmaster requires API keys and network | 5 |
| **State Persistence** | Builds on state.md + patterns.md + session-history.md across sessions | 4 |
| **Verification Quality** | Tier-based verification with rollback snapshots — more rigorous than any competitor | 4 |
| **Total** | | **27/30** |

### 3.4 Strategic Recommendation

**Build.** Ship 5 Focus commands that bring the FULL superplan/execplan/featureAI/sync pipelines into PAN as first-class shipped commands. No shortcuts, no streamlining — the complete 10-phase featureAI investigation, complete 7-phase superplan scanning with Reality Score formula, complete 6-stage execplan with all 9 behavioral rules and 4 execution modes. The unique angle is **uncompromised pipeline depth with cross-session learning** — no competitor comes close to this rigor. Taskmaster has flat task prioritization without execution automation. Claude Code plan mode has informal markdown without verification. Cline separates plan/act without persistence. PAN Focus ships the entire proven methodology (16 sessions, 802+ tests) as commands any user can invoke. We explicitly do NOT copy Taskmaster's flat task JSON model (PAN's phase hierarchy is better) or Claude Code's informal plan files (PAN's structured plan.md frontmatter is better).

---

## Phase 3.5: Architecture & Implementation Assessment

### 3.5.1 Feature Type Classification

| Component | Type | Template |
|-----------|------|----------|
| `focus.cjs` | New Core Module | New lib module with cmd* functions |
| `pan-tools.cjs` changes | Core Enhancement | New `focus` top-level command with subcommands |
| 5 command .md files | New Workflows | New `.md` in `commands/pan/` |
| frontmatter.cjs extension | Core Enhancement | Add `priority` and `effort` field validation |
| help.md update | Core Enhancement | Add "Focus" group |
| Installer update | Installer | Register Focus group in help |

### 3.5.2 Layer Violation Check

- [x] Command .md files invoke pan-tools CLI, not lib modules directly
- [x] focus.cjs returns data objects, does not import agent .md files
- [x] output() only called from cmd* entry points
- [x] No upward dependencies (focus.cjs → core.cjs, never core.cjs → focus.cjs)

### 3.5.3 Output Contract Design

**focus scan:**
```json
{
  "health": { "grade": "B", "composite": 72 },
  "items": [
    {
      "id": "P0-1",
      "title": "Fix crash in state cmd",
      "priority": "P0",
      "effort": "S",
      "points": 2,
      "source": "codebase-todo",
      "file": ".planning/phases/01-setup/01-01-plan.md",
      "line": 42
    }
  ],
  "summary": {
    "total": 15,
    "by_priority": { "P0": 1, "P1": 2, "P2": 3, "P3": 5, "P4": 4 },
    "total_points": 48,
    "patterns_count": 3,
    "todos_count": 5
  }
}
```

**focus plan:**
```json
{
  "batch": [
    { "id": "P0-1", "title": "...", "priority": "P0", "effort": "S", "points": 2, "tier": "micro" }
  ],
  "budget": { "allocated": 42, "limit": 50, "remaining": 8 },
  "batch_file": ".planning/focus/batch-2026-03-01.md"
}
```

**focus exec:**
```json
{
  "results": [
    { "id": "P0-1", "title": "...", "status": "completed", "tests_before": 802, "tests_after": 805 }
  ],
  "summary": {
    "completed": 8,
    "failed": 1,
    "skipped": 0,
    "points_used": 38,
    "tests_before": 802,
    "tests_after": 825
  },
  "rollback_tag": "pan-focus-20260301T143022"
}
```

**focus design:**
```json
{
  "spec_file": "docs/specs/dark_mode_featureai.md",
  "adr_file": "docs/decisions/ADR-0007-dark-mode.md",
  "mode": "full",
  "phases_run": [0, 1, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 10],
  "phases_skipped": [],
  "tasks": [
    { "title": "Add theme context provider", "effort": "M", "priority": "P3", "files": ["src/theme.ts"] }
  ],
  "feature_ladder": {
    "v0": "Basic toggle, 2 themes",
    "v1": "System preference detection, transition animations",
    "v2": "Custom theme builder"
  },
  "strategic_summary": {
    "moat_score": "22/30",
    "cognitive_load": "+1",
    "recommendation": "Build"
  }
}
```

**focus sync:**
```json
{
  "updated": ["README.md", "CHANGELOG.md", "docs/USER-GUIDE.md"],
  "skipped": ["docs/ARCHITECTURE.md"],
  "changes_summary": "Updated command count 32→37, added Focus group to help"
}
```

### 3.5.4 State Transition Modeling

| Current State | Action | New State | Error If Invalid |
|--------------|--------|-----------|-----------------|
| No .planning/ | focus-scan | Error | `{"error": ".planning/ not found", "hint": "Run /pan:new-project"}` |
| Has roadmap.md + phases | focus-scan | Returns prioritized items | — |
| Items scanned | focus-plan | Creates batch file in .planning/focus/ | — |
| Batch planned | focus-exec | Executes batch, updates state.md | — |
| No batch file | focus-exec | Error | `{"error": "No batch found", "hint": "Run /pan:focus-plan first"}` |
| Changes made | focus-sync | Updates docs, returns list | — |
| No changes | focus-sync | Returns empty list | — |
| Any state | focus-design | Creates spec + ADR | — |

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes existing command JSON output? | No |
| Changes file formats? | Yes — adds optional `priority:` and `effort:` to plan.md frontmatter (backward-compatible, both optional) |
| Changes directory structure? | Yes — adds `.planning/focus/` for batch files |
| Changes installer output? | Yes — 5 new command .md files installed, help.md updated with Focus group |

**Migration:** All changes are additive. Existing plan.md files without priority/effort fields work unchanged — defaults apply (priority: P3, effort: M).

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| focus-scan output feeds focus-plan | Yes | Scan produces items, plan budgets them |
| focus-plan output feeds focus-exec | Yes | Plan creates batch file, exec reads it |
| focus-exec delegates to exec-phase | Yes | For L/XL items, exec can invoke exec-phase workflow |
| focus-design feeds plan-phase | Yes | Design outputs tasks compatible with plan.md format |
| focus-sync called from agents | Yes | Agent can invoke `pan-tools focus sync` |
| All work in --raw mode | Yes | Raw mode shows human-readable summary |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| focus-scan: read ROADMAP + phases + todos + patterns | ~50ms | 10-20 file reads |
| focus-scan: grep codebase for TODO/FIXME | ~200ms | ripgrep or manual fs scan |
| focus-plan: read scan results + compute budget | ~20ms | Arithmetic only |
| focus-exec: per-item execution | Variable | Delegates to AI agent |
| focus-sync: read changed files + update docs | ~50ms | 5-10 file reads/writes |
| **Total (scan + plan)** | **< 300ms** | Within budget |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| Windows | toPosix() on all paths in JSON output. CRLF in markdown files handled by safeReadFile. |
| Mac/Linux | Case-sensitive filenames for batch files. |
| All runtimes | Command .md files use runtime-agnostic pan-tools CLI invocations. |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

#### PAN Focus — Strategic Project Management

Focus commands help you decide **what** to work on, not just **how**. While PAN's phase commands (`plan-phase`, `exec-phase`) handle the mechanics of building, Focus commands handle the strategy of choosing.

**The Focus Pipeline:**

```
/pan:focus-scan     →  "What needs doing?" (prioritized work items)
/pan:focus-design   →  "How should we build it?" (spec + ADR)
/pan:focus-plan     →  "What fits in this session?" (capacity-budgeted batch)
/pan:focus-exec     →  "Build it with tier-based shortcuts" (MICRO/STANDARD/FULL)
/pan:focus-sync     →  "Update the docs" (auto-sync README, CHANGELOG, etc.)
```

**Example 1: Quick morning session**
```
/pan:focus-scan                     # See what's most important
/pan:focus-plan --budget 20         # Plan 20 points of work (XS + S items)
/pan:focus-exec                     # Execute with MICRO tier shortcuts
/pan:focus-sync                     # Update docs
```

**Example 2: Feature design before building**
```
/pan:focus-design "dark mode"       # Research, design, produce spec + ADR
/pan:focus-plan                     # Plan the v0 (MVP) tasks from the spec
/pan:focus-exec                     # Build it
```

**Example 3: Stability sprint**
```
/pan:focus-scan --priority P0-P2    # Show only crash/correctness/coverage items
/pan:focus-plan --budget 40         # Fill session with fixes
/pan:focus-exec                     # Execute with full test verification
```

**How Focus works with existing commands:**

Focus commands are additive. You can still use `/pan:plan-phase` and `/pan:exec-phase` for phase-by-phase work. Focus adds the strategic layer on top:

- `focus-scan` is the full superplan pipeline (7 phases: orientation, priority classification, strategic context, Reality Score, item collection, effort estimation, plan assembly + validation) shipped as a command
- `focus-plan` creates a capacity-budgeted work batch with 4 execution modes (bugfix/balanced/features/full)
- `focus-exec` is the full execplan pipeline (6 stages: session start, plan loading + budgeting, tier-based execution with 9 mandatory rules, verification, doc sync, session end)
- `focus-design` is the full featureAI investigation pipeline (10 phases: problem validation, internal recon, competitive intelligence, strategic analysis, architecture assessment, design synthesis, ADR, error handling, security, implementation roadmap + test plan)
- `focus-sync` automates the doc update step that's easy to forget

**What Focus does NOT do:**
- It does not replace phase planning — phases remain the organizational unit
- It does not require priority/effort fields — they're optional with sensible defaults
- It does not create a separate task system — it reads existing plan.md, TODO, and codebase TODOs

### 4.2 Reference-Level Explanation

#### 4.2.1 Command Interface

**focus scan** — Full 7-phase strategic work scan with prioritization and Reality Score
```
pan-tools focus scan [--priority P0-P6] [--effort XS-XL] [--source todos|plans|codebase] [--focus <area>] [--quick] [--refresh] [--lean]
Output: { health, items[], summary, reality_scores[], scan_file }
```

**focus plan** — Create a capacity-budgeted work batch
```
pan-tools focus plan [--budget N] [--mode bugfix|balanced|features|full] [--priority P0-P6] [--lean]
Output: { batch[], budget, batch_file }
```

**focus exec** — Full 6-stage execution pipeline with 9 mandatory rules, 4 modes, 3 tiers
```
pan-tools focus exec [--budget N] [--mode bugfix|balanced|features|full] [--priority P0-P6] [--dry-run] [--no-commit] [--continue]
Output: { results[], summary, rollback_tag, verification_report }
```

**focus design** — Strategic feature investigation, design & specification (4 modes)
```
pan-tools focus design <topic> [--full|--internal|--outward|--spike] [--gate] [--audit] [--mvp]
Output: { spec_file, adr_file, tasks[], feature_ladder, mode, phases_run }
```

**focus sync** — Synchronize documentation after changes
```
pan-tools focus sync [--check-only]
Output: { updated[], skipped[], changes_summary }
```

#### 4.2.2 State Changes & Filesystem Scope

```
Reads from:
  .planning/roadmap.md, state.md, config.json
  .planning/phases/*/  (plan.md frontmatter for priority/effort)
  .planning/todos/pending/
  .planning/patterns.md
  .planning/focus/ (batch files)
  Source files (for TODO/FIXME grep)

Writes to:
  .planning/focus/batch-YYYY-MM-DD.md (focus-plan output)
  .planning/state.md (session recording)
  .planning/patterns.md (error pattern learning)
  docs/specs/*.md (focus-design output)
  docs/decisions/*.md (focus-design ADR output)

Side effects:
  git tag (rollback snapshots in focus-exec)
```

#### 4.2.3 Error Handling

| Condition | JSON Output | Error Style |
|-----------|-------------|-------------|
| No .planning/ directory | `{"error": ".planning/ not found", "hint": "Run /pan:new-project to initialize"}` | safeReadFile returns null |
| No roadmap.md | `{"error": "roadmap.md not found", "hint": "Run /pan:new-project to create roadmap"}` | safeReadFile returns null |
| No batch file for exec | `{"error": "No batch found", "hint": "Run /pan:focus-plan first"}` | Check .planning/focus/ |
| Budget exceeded | `{"error": "Budget N exceeded by M points"}` | Arithmetic check |
| Invalid priority | `{"error": "Invalid priority 'P7' — valid: P0-P6"}` | Arg validation |
| Write failure | `{"error": "Failed to write batch file: <reason>"}` | try-catch on writeFileSync |

### 4.3 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy |
|----------|-------------|-----------|---------------------|
| P0-P6 priority framework | SuperPlan custom skill | 7 tiers is granular enough without being overwhelming | Taskmaster's high/med/low (too coarse — P0 crash vs P1 wrong results matter) |
| Points-based capacity budgeting | ExecPlan custom skill | XS=1 through XL=20 maps to real session capacity | Claude Code task lists (no budgeting at all) |
| Tier-based execution shortcuts | PanMonty custom skill | MICRO/STANDARD/FULL saves time on small items | Aider auto-commit (too aggressive, no verification) |
| Full 10-phase investigation pipeline | FeatureAI custom skill | Ship the complete pipeline — demand validation, competitive intelligence, strategic analysis, architecture assessment, design synthesis, ADR, error handling, security, implementation roadmap, test plan, output | Taskmaster's no-design approach (ships tasks without investigation) |
| Batch files in .planning/focus/ | Original | Keeps focus artifacts alongside phase artifacts | Taskmaster's tasks.json (separate system from phases) |
| Optional priority/effort fields | Original | Zero migration cost — existing plan.md files work unchanged | Mandatory fields (would break all existing projects) |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| 5 new commands | Grouped under Focus | Extend existing commands (add --scan to progress, --budget to exec-phase) | Overloading existing commands hides the strategic layer | 5 more commands to learn |
| New focus.cjs module | Dedicated module | Add to commands.cjs | commands.cjs is already 1100+ lines | Another module to maintain |
| .planning/focus/ directory | Dedicated directory | Write batch info to state.md | Batch files are temporary and shouldn't clutter state.md | Yet another directory |
| Codebase TODO scanning | Built into focus-scan | Extend list-todos command | list-todos scans .planning/todos/ only — codebase scanning is fundamentally different | Adds ~200ms to scan time |

### 4.5 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | focus-scan (read-only prioritized items), focus-plan (budget allocation), focus-sync (doc check). Core module + 3 commands. | Users can see prioritized work and plan sessions. | L (new module + 3 commands + tests) |
| **v1 (Complete)** | Add focus-exec (full 6-stage execution pipeline with 9 rules, 4 modes, 3 tiers) + focus-design (full 10-phase investigation pipeline with Blue Ocean, Wardley, security, test plan). All 5 commands. | Full strategic pipeline shipped — no shortcuts. | L (2 more commands + agents + tests) |
| **v2 (Enhanced)** | Execution modes (bugfix/balanced/features). Pattern auto-remediation. Cross-session analytics. | Power-user optimization. | M-L |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | `/pan:help` shows Focus group. `/pan:progress` suggests `focus-scan` when health drops below B. |
| What's the learning curve? | Zero config. Run `/pan:focus-scan` and the output explains what to do next. |
| Does it require changing existing workflows? | No. Focus is additive. Existing phase workflow unchanged. |
| What's the "aha moment"? | First time focus-scan surfaces a P0 crash bug the user didn't know about, and focus-plan slots it into a 20-minute fix batch. |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0006-focus-commands.md` (created as separate artifact).

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection | Recovery | User Sees |
|-------------|----------|-----------|----------|-----------|
| No .planning/ directory | User error | Check dir existence | JSON error + hint | "Run /pan:new-project" |
| Empty roadmap.md | Edge case | Parse returns 0 phases | Return empty items list | "No phases found" in scan |
| Malformed plan.md frontmatter | Data corruption | extractFrontmatter returns {} | Use defaults (P3, M) | Degraded but functional |
| Batch file corrupted | Data corruption | JSON.parse fails | JSON error + hint to re-plan | "Batch file corrupted, run focus-plan" |
| Git tag creation fails | Environment | execFileSync throws | Log warning, continue | "rollback_warning" field in output |
| Disk full on batch write | Environment | writeFileSync throws | JSON error | "Failed to write batch file: ENOSPC" |
| No TODO/FIXME in codebase | Normal | grep returns empty | Include 0 codebase items | Scan works, just no codebase items |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| `--raw` flag | Human-readable scan/plan output | Debugging |
| `--cwd <path>` | Override project directory | Testing |
| `--dry-run` on focus-exec | Show what would execute | Preview |
| `--check-only` on focus-sync | Show what would update | Preview |
| JSON `error` + `hint` fields | Machine-readable with recovery guidance | Any failure |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| .planning/ directory | Read/Write | System-generated, user-editable |
| Source code files | Read only (TODO scan) | User-controlled |
| docs/ directory | Write (focus-design, focus-sync) | System-generated |
| Git tags | Write (rollback snapshots) | System-managed |
| plan.md frontmatter | Read | User-editable (could contain malicious values) |

### 7.2 Path Safety

- All file reads within project root: `path.resolve(cwd, relativePath)` verified to start with `path.resolve(cwd)`
- TODO scanning uses `readdirSync` with depth limit (no symlink following)
- Batch file paths generated by system, not user input
- Design topic string sanitized for filesystem use (slug generation matches existing pattern)

### 7.3 Output Sanitization

- [x] No absolute paths in JSON output (toPosix relative paths)
- [x] No environment variables exposed
- [x] No stack traces in errors
- [x] No function names/line numbers in user errors

### 7.4 Content Validation

- plan.md frontmatter: priority validated against P0-P6 enum, effort against XS-XL enum
- Batch files: JSON.parse in try-catch, validate expected structure
- config.json: loadConfig already validates with defaults

### 7.5 Privilege Scope

```
Reads from: .planning/, source files (TODO scan), docs/
Writes to: .planning/focus/, .planning/state.md, .planning/patterns.md, docs/specs/, docs/decisions/
Executes shell: git tag (for rollback snapshots) via existing execGit helper
Reads outside project: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definitions (DRAFTS)

The command `.md` files ARE the AI interface — they must contain the complete pipeline definitions so any AI agent can execute them correctly. No shortcuts, no summaries. The full pipeline is the command.

---

#### /pan:focus-scan — Full 7-Phase Strategic Work Scan

```markdown
---
name: focus-scan
group: Focus
---

# /pan:focus-scan — Deep-Dive Strategic Work Scan

Survey the project for prioritized work items with evidence-based scoring. $ARGUMENTS

**Goal:** Produce a comprehensive, evidence-based prioritized work list by deep-diving into ALL project files, code, and test results. Every item must link to source files and be actionable.

---

## MANDATORY: Execute ALL Phases Automatically

When `/pan:focus-scan` is invoked, execute ALL phases without stopping. Do NOT ask questions between phases. Do NOT skip phases. The output is a prioritized work list with Reality Score filtering.

**Flags:**
- `--focus <area>` — Weight items toward a specific area (e.g., `--focus commands`, `--focus hooks`, `--focus tests`)
- `--quick` — Skip Phase 2 (strategic context) and Phase 6 (validation protocol)
- `--refresh` — Force re-read all files even if recently cached
- `--lean` — Apply aggressive Reality Score filtering: DROP items with RS < 1.5, DEFER items with RS < 3.0

---

## Phase 0: Orientation & Baseline Snapshot

### 0.1 Read Current State
Read these files to establish baseline:

**Core Status:**
- `package.json` — Version, description, entry points
- `README.md` — Public documentation

**Project Structure:**
- All core modules in the project's source directories
- All command definitions
- All agent definitions
- All workflow definitions
- All hook source files

**Planning State:**
- `.planning/state.md` — Current state
- `.planning/roadmap.md` — Phase progress
- `.planning/config.json` — Project configuration
- `.planning/patterns.md` — Known error patterns (if exists)

### 0.2 Scan for Real Issues
Run targeted code searches to find actual problems:

```
Search for: "TODO", "FIXME", "HACK", "STUB", "stub"
In: source directories, hooks, tests
```

Cross-reference found issues with documented items — flag any UNDOCUMENTED issues as new findings.

### 0.3 Check Test Results
```bash
npm test 2>&1
```
Record: total tests, passing, failing, suites.

### 0.4 Baseline Snapshot Table

```markdown
| Metric | Value | Notes |
|--------|-------|-------|
| Version | X.Y.Z | |
| Tests | N/N | M suites |
| Build | OK/FAIL | |
| Commands | N | |
| Phases | N total, M incomplete | |
| TODOs Found | N | |
| Error Patterns | N | |
```

---

## Phase 1: Priority Classification

### Priority Framework (STRICT ORDER)

| Priority | Focus | Criteria |
|----------|-------|----------|
| **P0: CRASH/ERROR** | Runtime errors, uncaught exceptions | Any command that throws or produces wrong output |
| **P1: WRONG RESULTS** | Silent data corruption, incorrect output | Commands that succeed but produce bad data |
| **P2: TEST GAPS** | Missing test coverage | Features without tests or low assertion density |
| **P3: INCOMPLETE FEATURES** | Partially implemented commands or workflows | Commands that exist but lack full functionality |
| **P4: NEW FEATURES** | Net-new functionality from roadmap | Features not yet started |
| **P5: TOOLING** | Developer experience improvements | Hooks, CLI UX, error messages |
| **P6: DOCUMENTATION** | Docs sync, reference updates | Documentation-only changes |

### Classification Rules
- **Crashes before correctness** — A thrown error is always higher priority than wrong output
- **Correctness before coverage** — Wrong results are worse than missing tests
- **Quick wins first within each tier** — S-effort items before L-effort items

---

## Phase 2: Strategic Context (skip with --quick)

### 2.1 Read Strategy Documents
- `README.md` — What's the public-facing story?
- User guide / docs — What's documented for users?
- `CHANGELOG.md` — What's the recent trajectory?

### 2.2 Strategic Alignment Check
For each P4+ item, note whether it:
- Is on the critical path to the next milestone
- Enables other high-value work (dependency unblocking)
- Has been deferred multiple times

---

## Phase 2.5: Feature Reality Check (Market-Fit Scoring)

Every feature-tier item (P3-P6) must pass a reality check.

### Reality Score (RS)

```
RS = (User Value + Time Criticality + Risk Reduction) / Job Size
```

#### User Value (UV): 1-5
| Score | Meaning |
|-------|---------|
| 5 | Core workflow feature — every user needs this |
| 4 | Common usage — most projects need it |
| 3 | Significant audience — power users need it |
| 2 | Niche audience — specific use case |
| 1 | Academic / completion-only |

#### Time Criticality (TC): 1-5
| Score | Meaning |
|-------|---------|
| 5 | Blocks users from adopting the tool |
| 4 | Competitive table-stakes — other tools have it |
| 3 | Unlocks a significant new use case |
| 2 | Nice to have, users can work around |
| 1 | No urgency |

#### Risk Reduction (RR): 1-5
| Score | Meaning |
|-------|---------|
| 5 | Removes a crash or correctness bug |
| 4 | Unblocks 3+ downstream features |
| 3 | Unblocks 1-2 features |
| 2 | Incremental improvement |
| 1 | Polish / docs |

#### Job Size (JS)
| Effort | JS Value |
|--------|----------|
| XS | 1 |
| S | 2 |
| M | 3 |
| L | 5 |
| XL | 8 |

```
RS >= 3.0  →  DO       — Include in next sessions
RS 1.5-2.9 →  DEFER    — Include as deferred
RS < 1.5   →  BACKLOG  — Move to backlog appendix
```

---

## Phase 3: Item Collection & Deduplication

### 3.1 Collect ALL Items
Gather items from:

1. **Test failures** — each failure = 1 item
2. **TODO/FIXME scan** — each finding = 1 item
3. **Missing test coverage** — each uncovered module = 1 item
4. **Incomplete commands** — each gap = 1 item
5. **Missing features** — from roadmap/README promises
6. **Documentation gaps** — each stale/missing doc = 1 item
7. **Error pattern prevention** — from patterns.md

### 3.2 Deduplicate
- Same file + same issue = same item
- Same feature described differently = same item

---

## Phase 4: Effort Estimation

| Size | Time | Lines Changed | Files |
|------|------|---------------|-------|
| XS | < 15 min | < 20 | 1 |
| S | 15-60 min | 20-100 | 1-2 |
| M | 1-4 hours | 100-500 | 2-5 |
| L | 4-8 hours | 500-2000 | 5-10 |
| XL | 8+ hours | 2000+ | 10+ |

---

## Phase 5: Scan Assembly

### 5.1 Output
Return JSON via `pan-tools focus scan` with all items, or write to `.planning/focus/scan-<YYYY-MM-DD>.md` for persistence.

### 5.2 Document Structure

The scan output includes:
- Status Snapshot table
- Items grouped by priority tier (P0-P6)
- Each item: ID, title, symptom, root cause, fix guidance, files, effort
- Summary statistics (items by priority × effort)
- Recommended execution order (quick wins → core fixes → feature work)
- Feature Reality Check table (RS scores for P3-P6 items)
- Deferred items with rationale

---

## Phase 6: Validation Protocol (skip with --quick)

### 6.1 Cross-Check Completeness
Verify the scan covers:
- [ ] All failing tests (if any)
- [ ] All TODO/FIXME items from code scan
- [ ] All modules without test coverage
- [ ] All commands listed in README but not implemented
- [ ] All error patterns that need prevention

### 6.2 Sanity Check
- No item should appear twice
- Every P0-P2 item should have a specific file path
- Deferred items should have clear "revisit when" criteria

---

## NEVER DO

- Skip reading source files — the scan must be evidence-based
- List items without file paths (for code items)
- Create items with vague descriptions
- Include items that are already complete
- Include P3-P6 feature items without an RS score

## ALWAYS DO

- Deep-dive into actual code (grep for TODOs, read modules)
- Cross-reference tests against implementations
- Link every item to its source file
- Provide specific fix guidance
- Score every P3-P6 item with the RS formula
- Sort the Feature Reality Check table by RS descending
```

---

#### /pan:focus-plan — Capacity-Budgeted Work Batch

```markdown
---
name: focus-plan
group: Focus
---

# /pan:focus-plan — Capacity-Budgeted Work Batch Planner

Create a capacity-budgeted work batch from focus-scan results. $ARGUMENTS

**Goal:** Select a right-sized batch of work items that fits within the session's point budget, ordered for maximum impact with minimum risk.

---

## MANDATORY: Run focus-scan first

If no recent scan exists (`.planning/focus/scan-*.md`), run `/pan:focus-scan` automatically before proceeding.

**Flags:**
- `--budget N` — Override capacity budget in points (default: 50, min: 5, max: 100)
- `--mode MODE` — Execution mode. Default: `balanced`
  - `bugfix` — P0→P1→smallest-first, no feature work (40 pts)
  - `balanced` — **Default.** Mix of stability fixes + feature development, 60/40 split (50 pts)
  - `features` — Feature-focused: 80% budget on P3-P5, P0 crashes still mandatory (50 pts)
  - `full` — Full-spectrum: enhanced budget, all priorities equally weighted (60 pts)
- `--priority P0-P6` — Only pick items from these priority tiers
- `--lean` — Apply RS filtering: exclude items with RS < 1.5

---

## Capacity Budget System

| Size | Points | Per Session | Meaning |
|------|--------|-------------|---------|
| **XS** | 1 | Up to 40 | Config tweak, typo fix |
| **S** | 2 | Up to 20 | Single-file bug fix, add tests |
| **M** | 4 | Up to 10 | Multi-file feature, new test suite |
| **L** | 10 | Up to 4 | Multi-module change, new command |
| **XL** | 20 | Up to 2 | New subsystem, major refactor |

---

## Execution Modes

### `bugfix` — Stability-First
- **Budget:** 40 pts
- **Algorithm:** P0 mandatory → P1 → P2-P4 smallest-first
- **Feature allocation:** None

### `balanced` — Mix of Fixes + Features (DEFAULT)
- **Budget:** 50 pts
- **Stability pass (60%):** 30 pts for P0-P2
- **Feature pass (40%):** 20 pts for P3-P6

### `features` — Feature-Focused Sprint
- **Budget:** 50 pts
- **Mandatory pass:** All P0 items
- **Feature pass (80%):** 40 pts for P3-P5
- **Stability pass (20%):** 10 pts for P1-P2 quick wins

### `full` — Full-Spectrum Marathon
- **Budget:** 60 pts
- **All priorities weighted equally, largest-impact-first**

---

## Output

Produce a batch file at `.planning/focus/batch-<YYYY-MM-DD>.md`:

```markdown
## Focus Batch — <date>
**Mode:** balanced | **Budget:** 50 pts | **Allocated:** N pts

| # | ID | Title | Priority | Size | Pts | Tier | Track |
|---|----|-------|----------|------|-----|------|-------|
| 1 | P0-1 | Fix crash in state cmd | P0 | S | 2 | MICRO | Stability |
| 2 | P2-3 | Add tests for milestone | P2 | M | 4 | STANDARD | Stability |
| 3 | P3-1 | Add --json flag to phase | P3 | M | 4 | STANDARD | Feature |

Execution Order: MICRO first, then STANDARD, then FULL
```

Ready for `/pan:focus-exec`.
```

---

#### /pan:focus-exec — Full 6-Stage Execution Pipeline

```markdown
---
name: focus-exec
group: Focus
---

# /pan:focus-exec — Automated Batch Execution Pipeline

Execute items from the current focus batch with capacity-based sizing, full session lifecycle, and verification. $ARGUMENTS

**Goal:** One-command pipeline that starts a session, loads the planned batch, implements items with tier-based execution protocols, verifies the work, syncs documentation, and closes the session cleanly.

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────┐
│  /pan:focus-exec                                            │
│                                                             │
│  Stage 1: SESSION START                                     │
│    └─ Check project status, record baseline                 │
│                                                             │
│  Stage 2: BATCH LOADING + VALIDATION                        │
│    └─ Read batch file, validate items, confirm budget       │
│                                                             │
│  Stage 3: EXECUTION (tier-based)                            │
│    └─ Implement items with read→understand→code             │
│    └─ Build + test cadence per tier                         │
│                                                             │
│  Stage 4: VERIFICATION                                      │
│    └─ Verify all implemented items actually work            │
│    └─ Full test suite must pass                             │
│                                                             │
│  Stage 5: DOCUMENTATION SYNC                                │
│    └─ Update docs, README, CHANGELOG                        │
│                                                             │
│  Stage 6: SESSION END                                       │
│    └─ Commit, record session, generate summary              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## MANDATORY: Execute ALL Stages Sequentially

When `/pan:focus-exec` is invoked, run ALL 6 stages in order. Do NOT skip stages. Do NOT stop between stages unless a critical failure occurs (tests regress).

**Flags:**
- `--budget N` — Override capacity budget in points (default: 50, min: 5, max: 100)
- `--mode MODE` — Execution mode (bugfix/balanced/features/full)
- `--priority P0-P6` — Only pick items from these priority tiers
- `--dry-run` — Run Stages 1-2 only (show what WOULD be executed)
- `--no-commit` — Skip the commit step in Stage 6
- `--continue` — Resume a previously interrupted execution

---

## Capacity Budget System

| Size | Points | Per Session | Meaning |
|------|--------|-------------|---------|
| **XS** | 1 | Up to 40 | Config tweak, typo fix |
| **S** | 2 | Up to 20 | Single-file bug fix, add tests |
| **M** | 4 | Up to 10 | Multi-file feature, new test suite |
| **L** | 10 | Up to 4 | Multi-module change, new command |
| **XL** | 20 | Up to 2 | New subsystem, major refactor |

---

## AI Behavioral Rules (ALL 9 MANDATORY)

### Rule 1: Read Before You Write (MANDATORY)
Before changing ANY file, read it first. Understand context, callers, and invariants.

### Rule 2: Understand the Root Cause (MANDATORY)
Do NOT apply surface-level patches. Trace the code path, identify the actual defect.

### Rule 3: One Change, One Test (MANDATORY)
Every code change must be tested before moving to the next item.

Test cadence by tier:
- **MICRO (XS/S):** Run specific test after implementing. Batch up to 3 independent items before smoke.
- **STANDARD (M):** Full test suite after EACH item.
- **FULL (L/XL):** Build hooks + full test suite after EACH item.

### Rule 4: Don't Invent — Follow the Plan (MANDATORY)
Implement exactly what the batch says. No scope creep.

### Rule 5: Cross-Platform Awareness (MANDATORY)
- Use `toPosix()` for all paths in JSON output
- Use file-based input for shell-sensitive content (`$` signs)
- All modules must be CommonJS (`.cjs` with `require()`)

### Rule 6: Revert Fast, Don't Dig Deep (MANDATORY)
If a fix doesn't work within 5 minutes, revert and move on. Failed items carry forward.

### Rule 7: Verify Understanding Before Committing (MANDATORY)
For M/L/XL items, state your understanding before writing code:
```
Item P2-3 — Add tests for milestone module
Understanding: milestone.cjs has 3 exported functions. Need to test
completeMilestone, archiveMilestoneFiles, and getMilestoneInfo edge cases.
Files: milestone.cjs, tests/milestone.test.cjs
Confidence: HIGH
```

### Rule 8: Preserve Existing Test Expectations (MANDATORY)
Never change an existing test's expected output to match broken code.

### Rule 9: Commit Messages Must Be Accurate (MANDATORY)
List ONLY items that are actually VERIFIED (passed tests). Include actual test counts.

---

## Stage 1: Session Start

1. **Check Project Status** — git status, recent commits
2. **Test Baseline** — run test suite, record current counts
3. **Create rollback snapshot** — git tag for safety
4. **Report** — Output session start summary

**Record baseline:**
```
baseline_version: <from package.json>
baseline_tests: <N/N passing>
baseline_build: <pass/fail>
baseline_commit: <current HEAD>
```

**Failure Gate:** If tests fail, STOP. Fix tests before proceeding.

---

## Stage 2: Batch Loading + Validation

### 2.1 Find Active Batch
Search for: `.planning/focus/batch-*.md`
Pick the newest. If none exists, tell user to run `/pan:focus-plan` first.

### 2.2 Read and Validate the Batch
Extract all items: ID, Title, Priority, Effort, Points, Tier, Files.
Verify total points within budget.

### 2.3 Show Batch Table
Display the execution batch to user, then continue automatically.

---

## Stage 3: Execution

### 3.0 Pre-Execution Setup
1. Cache project facts — do NOT re-read later
2. Create/update progress tracker with the batch table

### 3.1 Process Items by Tier

#### MICRO Items (XS/S)
```
1. READ target file(s)
2. IMPLEMENT the fix
3. TEST — run specific test file
4. CONFIRM — pass → ✅ DONE | fail → one fix attempt → REVERT → ❌ FAILED
```

#### STANDARD Items (M)
```
1. STATE UNDERSTANDING (Rule 7)
2. READ target files + test files
3. IMPLEMENT across necessary files
4. TEST — full test suite
5. CONFIRM — pass → ✅ DONE | regresses → REVERT → ❌ FAILED
```

#### FULL Items (L/XL)
```
1. STATE UNDERSTANDING (detailed)
2. READ WIDELY — target files, callers, tests, related code
3. DESIGN — outline approach before coding
4. IMPLEMENT in logical chunks
5. BUILD — build hooks if hooks changed
6. TEST — full test suite
7. CONFIRM — all pass → ✅ DONE | fail → investigate (15 min max) → REVERT → ❌ FAILED
```

### 3.2 Failure Handling
- Build breaks: fix typo or revert (5 min limit)
- Test regression: identify cause, one fix attempt, else revert
- **Never let a failed item block other items**

### 3.3 Progress Tracking
Update progress tracker after each item with status and budget tracking.

---

## Stage 4: Verification

### 4.1 Full Suite Verification
Run full test suite. All tests must pass. Compare against Stage 1 baseline.

### 4.2 Build Verification (if applicable)
Build hooks or compile step if applicable. All must pass.

### 4.3 Verification Report
```markdown
## Verification Report

### Item Results
| # | ID | Title | Tests | Verdict |
|---|----|-------|-------|---------|
| 1 | P0-1 | Fix crash | ✅ | VERIFIED |
| 2 | P2-3 | Add tests | ✅ | VERIFIED |

### Regression Check
| Test Suite | Before | After | Delta |
|------------|--------|-------|-------|
| Tests | N/N | M/M | +K |
| Build | pass | pass | — |
```

---

## Stage 5: Documentation Sync

### 5.1 Update Docs
- Update README.md if public API changed
- Update CHANGELOG.md with new entries
- Update command/workflow files if behavior changed

### 5.2 Update Scan
Edit the active scan file:
- Mark completed items with ✅
- Mark failed items with ❌ and reason

---

## Stage 6: Session End

### 6.1 Commit Changes
Unless `--no-commit`:
1. Stage modified files (specific paths, not `git add -A`)
2. Create commit with accurate message listing verified items
3. Verify commit succeeded

### 6.2 Record Session
- Record session summary (items completed, tests before/after, budget used)
- Append error patterns if any failures occurred

### 6.3 Final Report

```markdown
## /pan:focus-exec Complete

| Stage | Status |
|-------|--------|
| 1. Session Start | ✅ Baseline: N/N tests |
| 2. Batch Loading | ✅ Mode: balanced, N items |
| 3. Execution | ✅ N/M items completed |
| 4. Verification | ✅ All verified |
| 5. Doc Sync | ✅ Updated N docs |
| 6. Session End | ✅ Committed |

### Results
- **Budget:** X/50 points used
- **Items completed:** N (X pts)
- **Items failed:** K (Y pts returned)
- **Tests:** Before N → After M (+K new)

### Resume
Run `/pan:focus-exec --continue` for remaining items.
Run `/pan:focus-scan` to regenerate the scan.
```

---

## NEVER DO

- Skip reading files before editing them (Rule 1)
- Apply symptom patches instead of root cause fixes (Rule 2)
- Batch implement without testing between items (Rule 3)
- Expand scope beyond the batch item (Rule 4)
- Ignore cross-platform path issues (Rule 5)
- Spend more than 5 minutes debugging a single failure (Rule 6)
- Start coding without stating understanding for M+ items (Rule 7)
- Change test expectations to match broken code (Rule 8)
- Claim items are fixed without running tests (Rule 9)

## ALWAYS DO

- Read before write, understand before implement
- Test after every item
- Stay within budget and plan scope
- Use toPosix() for paths, file-based input for shell-sensitive content
- Revert fast when stuck
- Record baseline test counts BEFORE making changes
- Save progress after each item
- Record session at end
- Report results with before/after comparison and budget usage
```

---

#### /pan:focus-design — Full 10-Phase Strategic Feature Investigation

```markdown
---
name: focus-design
group: Focus
---

# /pan:focus-design — Strategic Feature Investigation, Design & Specification

Research, design, and specify a new feature with strategic analysis. $ARGUMENTS

**Goal:** Produce a best-of-breed feature specification that (a) validates the problem with evidence, (b) maps the competitive landscape, (c) identifies strategic differentiation, (d) designs an architecturally sound implementation, (e) plans for error handling, security, and testability from day one, (f) defines an incremental delivery ladder, and (g) outputs a ready-to-implement spec with ADR, test plan, and implementation tasks.

**Methodology:** Synthesizes Spec-Driven Development, Blue Ocean Strategy, Wardley Mapping, STRIDE-lite threat modeling, Architecture Decision Records, and PAN's workflow methodology into a single investigative pipeline.

---

## MANDATORY: Complete All Phases For Selected Mode

When `/pan:focus-design` is invoked, execute ALL phases for the selected mode automatically. Do NOT stop to ask questions between phases. Do NOT skip phases beyond what the mode specifies. Complete the FULL investigation and produce all output artifacts. The only permitted pause is the Strategy Gate in Phase 3 (if the user passed `--gate`).

**Modes (mutually exclusive — pick one, default `--full`):**

### `--full` — Complete 10-Phase Investigation (DEFAULT)
Run ALL 10 phases. Nothing skipped. This is the gold standard.
```
Phases: 0 → 1 → 2 → 2.5(if --audit) → 3 → 3.5 → 4 → 5 → 6 → 7 → 8 → 9 → 10
Use case: New features, public-facing commands, anything that ships to users
```

### `--internal` — Internal Development Focus
Skip competitive research (Phase 2) and reality check (Phase 2.5). Focus on architecture, implementation, hardening, and testing. For internal tooling where there are no competitors to analyze.
```
Phases: 0 → 1 → 3 → 3.5 → 4 → 5 → 6 → 7 → 8 → 9 → 10
Skips: Phase 2 (Competitive Intelligence), Phase 2.5 (Reality Check)
Use case: Internal APIs, dev tooling, refactoring, infrastructure work
```

### `--outward` — Strategic & Market Analysis Focus
Emphasize competitive intelligence and strategic positioning. Skip error handling and security hardening (Phases 6, 7) and produce a lighter implementation roadmap. For market research, strategic decisions, and feature evaluation.
```
Phases: 0 → 1 → 2 → 2.5(if --audit) → 3 → 3.5 → 4 → 5 → 8(tasks only) → 10
Skips: Phase 6 (Error Handling), Phase 7 (Security), Phase 9 (Test Plan)
Lighter: Phase 8 (tasks list only — no dependency graph, no risk register)
Use case: Evaluating whether to build, competitive positioning, strategic ADRs
```

### `--spike` — Fast Proof-of-Concept
Minimal 4-phase pass: validate the problem, scan the codebase, synthesize a design, output implementation tasks. No competitive research, no strategic analysis, no hardening.
```
Phases: 0(lite) → 1(lite) → 4 → 8
Lite Phase 0: Problem statement + scope only (skip demand evidence, user stories, cannibalization)
Lite Phase 1: Codebase search + conventions only (skip architecture scan, dependency map)
Skips: Phases 2, 2.5, 3, 3.5, 5, 6, 7, 9, 10(spec saved, no ADR)
Use case: Quick prototyping, time-boxed exploration, "should we even try this?"
```

**Modifiers (layer on top of any mode):**
- `--gate` — Pause after Phase 3 (Strategy) for user review before proceeding to design
- `--audit` — Add Phase 2.5 reality check of existing implementation (not available with `--spike`)
- `--mvp` — Stop after generating the v0 (MVP) task list — skip v1/v2 layers

**Mode + Phase Matrix:**

| Phase | `--full` | `--internal` | `--outward` | `--spike` |
|-------|----------|-------------|-------------|-----------|
| 0: Problem Framing | Full | Full | Full | Lite (statement + scope only) |
| 1: Internal Recon | Full | Full | Full | Lite (codebase + conventions only) |
| 2: Competitive Intel | Full | **SKIP** | Full | **SKIP** |
| 2.5: Reality Check | With --audit | **SKIP** | With --audit | **SKIP** |
| 3: Strategic Analysis | Full | Full | Full | **SKIP** |
| 3.5: Architecture | Full | Full | Full | **SKIP** |
| 4: Design Synthesis | Full | Full | Full | Full |
| 5: ADR | Full | Full | Full | **SKIP** |
| 6: Error Handling | Full | Full | **SKIP** | **SKIP** |
| 7: Security | Full | Full | **SKIP** | **SKIP** |
| 8: Implementation | Full | Full | Tasks only | Full |
| 9: Test Plan | Full | Full | **SKIP** | **SKIP** |
| 10: Output Artifacts | Full | Full | Spec + ADR | Spec only |

---

## Phase 0: Problem Framing & Demand Validation

> *Before designing anything, prove the problem exists and users care.*

### 0.1 Problem Statement
Write a crisp, one-paragraph problem statement answering:
- What user pain or limitation does this address?
- Why does it matter NOW for the target users (developers using AI coding assistants)?
- What is the cost of NOT doing this?

### 0.2 Demand Evidence (MANDATORY)
Gather at least 2 evidence signals that real users want this:

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| GitHub issue / feature request | repo issues | [link or "none found"] |
| Discord / community request | community channels | [quote or "none found"] |
| Competitor feature parity | [tool name] ships this | [description] |
| Personal pain (user-stated) | This conversation | [user's words] |

**If zero evidence found:** Flag this as speculative. The strategic recommendation in Phase 3.4 must justify building without demand evidence.

### 0.3 Scope Definition
| In Scope | Out of Scope (and why) |
|----------|------------------------|
| ... | ... |

### 0.4 Success Criteria (Measurable)
Define 3-5 concrete, testable success criteria:
```
SC-1: [User can do X with a single command]
SC-2: [Feature works across all supported runtimes]
SC-3: [No regression in existing tests]
SC-4: [Feature works identically on Windows, Mac, and Linux]
SC-5: [Error messages guide user to fix within 1 attempt]
```

### 0.5 User Stories (3 minimum)
```
As a [developer using PAN Wizard on any runtime], I want [feature],
so that [benefit], instead of [current workaround].
```

### 0.6 Cannibalization Check
Check ALL existing commands and agents for overlap:

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| [closest match 1] | None / Partial / Full | [migration path if partial/full] |
| [closest match 2] | None / Partial / Full | [migration path if partial/full] |
| [closest match 3] | None / Partial / Full | [migration path if partial/full] |

**If Full overlap found:** STOP — enhance the existing command instead of creating a new one.

### 0.7 Cognitive Load Assessment
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | N | ? | +N |
| New concepts introduced | 0 | ? | +N |
| Score | — | — | simplifies (-1) / neutral (0) / adds complexity (+1) / significant (+2) |

**If score = +2:** Must provide explicit justification in Phase 3.4.

---

## Phase 1: Internal Reconnaissance

**Understand what the project already has before looking outward.**

### 1.1 Architecture Scan
Read and extract relevant context from:
- `README.md` — Public documentation and architecture
- User guide — User workflows
- Architecture docs — System design
- Project conventions — Known patterns and stability work

Create an **existing capabilities inventory:**
```
| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| ... | ... | ... | ... |
```

### 1.2 Codebase Search
| Search Target | Where to Look | What to Extract |
|---------------|---------------|-----------------|
| CLI dispatcher | Main entry point | Command routing, arg parsing |
| Core modules | Library modules | Existing patterns, helpers |
| Command definitions | Command files | Orchestration patterns |
| Agent definitions | Agent files | Agent tool access, prompts |
| Hook source | Hook files | Build hooks, event handling |
| Test patterns | Test files + helpers | Testing patterns and helpers |
| Installer | Install script | Installation flow, file structure |

### 1.3 Convention Enforcement Checklist
Verify the feature design will conform to ALL project conventions. Mark each as confirmed:
- [ ] Function naming convention followed
- [ ] File reads use safe read pattern (try-catch, return null)
- [ ] File writes wrapped in try-catch
- [ ] JSON output via standard output function — never console.log
- [ ] Errors via standard error function — never console.error or throw to user
- [ ] Paths in output pass through path normalization — never raw path.join in output
- [ ] Module exports at bottom
- [ ] Subcommands dispatched via standard routing pattern
- [ ] Module format matches project (CommonJS/ESM)
- [ ] Zero runtime dependencies maintained

### 1.4 Dependency & Integration Map
```
[This Feature]
    ├── depends on: [existing module A]
    ├── depends on: [existing module B]
    ├── extends: [existing command C]
    ├── conflicts with: [nothing / feature D because...]
    └── enables: [future feature E]
```

**require()/import chain:** Draw the module dependency path. Verify no circular dependencies.

---

## Phase 2: Competitive Intelligence

**Research how the best AI workflow tools solve this problem.**

### 2.1 Deep-Dive Research (6 Tools)
For EACH tool, use web search for their current approach:

| Tool | Focus Areas |
|------|-------------|
| **Aider** | Session management, context handling, git integration |
| **Cursor** | Agent mode, composer, multi-file editing, context |
| **Continue.dev** | IDE integration, context providers, slash commands |
| **Cline** | Autonomous coding, approval workflows, tool use |
| **Windsurf** | Cascade flows, context awareness, multi-step tasks |
| **GitHub Copilot Workspace** | Task decomposition, plan-execute-verify patterns |

For each, extract: **UX** (how invoked), **Behavior** (guarantees), **Ergonomics** (love/hate), **Pitfalls** (known limits), **Evolution** (what they got wrong first).

### 2.2 Prior Art & Community Research
Search for: blog posts from AI tooling creators, Reddit/HN discussions, open issues in competing tools.

### 2.3 Competitive Matrix
```
| Aspect | PAN (Current) | Aider | Cursor | Continue | Cline | Windsurf | Copilot WS | Best |
|--------|--------------|-------|--------|----------|-------|----------|------------|------|
| UX | ... | ... | ... | ... | ... | ... | ... | ... |
| Context | ... | ... | ... | ... | ... | ... | ... | ... |
| Reliability | ... | ... | ... | ... | ... | ... | ... | ... |
```

---

## Phase 2.5: Reality Check (OPTIONAL — only with `--audit` flag)

If any related implementation already exists, verify it's real:
- [ ] File existence check (not just claimed in docs)
- [ ] Code substance check (not stubs or TODOs)
- [ ] Actually run it and verify output
- [ ] Test validity check (tests assert real behavior, not just existence)
- [ ] Truth table: `| Item | Claimed | Real | Verdict |`

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework
| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | (e.g., complex config, IDE lock-in) |
| **REDUCE** | What should be reduced? | (e.g., boilerplate, setup time) |
| **RAISE** | What should be raised? | (e.g., context quality, verification) |
| **CREATE** | What should we create? | (e.g., context rot prevention, state persistence) |

### 3.2 Wardley Evolution Assessment
```
Genesis ──── Custom-Built ──── Product ──── Commodity
```
- Where is this feature in the INDUSTRY?
- Where should we position it?
- What evolution in 2-3 years? (plan for it now)

### 3.3 Strategic Moat Analysis
| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Improve context quality for AI assistants? | |
| **Cross-Platform** | Works across all supported runtimes? | |
| **Developer Experience** | Meaningfully better than alternatives? | |
| **Zero Dependencies** | Maintains zero-runtime-deps promise? | |
| **State Persistence** | Improves cross-session continuity? | |
| **Verification Quality** | Strengthens verify-before-ship guarantee? | |

### 3.4 Strategic Recommendation
Based on 3.1-3.3 AND Phase 0 demand evidence, write a 1-paragraph recommendation:
- Should we build this? (Yes / No / Modified)
- What's our unique angle?
- What should we explicitly NOT copy?
- What's the strategic timing?

**If `--gate` flag: STOP HERE and present Phases 0-3 for user approval.**

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

**Design with the project's architecture, not against it.**

### 3.5.1 Feature Type Classification
| Type | Description | Template |
|------|-------------|----------|
| **New Command** | New CLI subcommand | Add to dispatcher + lib module |
| **New Agent** | Specialized subagent | New agent file, register in settings |
| **New Hook** | Build/event hook | New hook source, build with bundler |
| **Core Enhancement** | Modify existing module | Edit lib module, update tests |
| **Workflow** | New command orchestrator | New command file |
| **Installer** | Change to install script | Modify installer, test with e2e |

### 3.5.2 Layer Violation Check
Verify:
- [ ] Command files do NOT call core modules directly — they invoke CLI
- [ ] Core modules return data — they do NOT import or depend on agent files
- [ ] New module does NOT call output() from a helper function — only from cmd* entry points
- [ ] No upward dependencies (lib module must not require dispatcher)

### 3.5.3 Output Contract Design (Contract-First)
Define the JSON schema BEFORE implementation:
```json
{
  "field1": "type — description",
  "field2": "type — description",
  "error": "string — only present on failure"
}
```

**Contract rules:**
- [ ] Field names use project convention (camelCase)
- [ ] No field name collisions with existing command output
- [ ] Error shape consistent with all other commands
- [ ] Paths in output normalized — relative to project root, never absolute
- [ ] Output size < 10KB typical, < 50KB max

### 3.5.4 State Transition Modeling
**Required if the feature mutates state or planning files.**

| Current State | Action | New State | Error If Invalid |
|--------------|--------|-----------|-----------------|
| [state A] | [this command] | [state B] | [error message] |

### 3.5.5 Breaking Change Assessment
| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | Yes/No |
| Changes file formats? | Yes/No |
| Changes directory structure? | Yes/No |
| Changes installer output? | Yes/No |

**If ANY answer is Yes:** Define a migration strategy.

### 3.5.6 Composability Analysis
| Interaction | Works? | How |
|-------------|--------|-----|
| Output feeds another command's input | Yes/No | [which command] |
| Callable from an agent | Yes/No | [how] |
| Usable in a hook pipeline | Yes/No | [how] |
| Works in --raw mode for humans | Yes/No | [raw output format] |

### 3.5.7 Performance Budget
| Operation | Cost | Notes |
|-----------|------|-------|
| File reads (N × ~5ms) | ~Xms | [list files] |
| Markdown parsing | ~Xms | [if applicable] |
| Computation | ~Xms | [describe] |
| File writes (N × ~5ms) | ~Xms | [list files] |
| **Total** | **< 500ms** | Justify if exceeding |

### 3.5.8 Cross-Platform Considerations
| Platform | Consideration |
|----------|---------------|
| Windows | Path separators, shell escaping, CRLF, 260-char path limit |
| Mac/Linux | POSIX paths, case-sensitive filesystem |
| All | path.join() everywhere, no hardcoded separators |
| All AI tools | All supported runtime compatibility |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation (User-Facing)
Write as if teaching this feature to a user who has never seen it:
- Introduce the feature by name
- Show 2-3 practical examples with real-world scenarios
- Explain how it interacts with existing commands they already know
- Show the error messages they'd see if they misuse it
- Explain what it does NOT do (prevent confusion)

### 4.2 Reference-Level Explanation (Technical)

#### 4.2.1 Command Interface
```
Command: pan-tools <command> [subcommand] [args]
Arguments: [list with types]
Output: JSON schema (from 3.5.3)
Exit codes: 0 = success, 1 = error
```

#### 4.2.2 State Changes & Filesystem Scope
```
Reads from: [list — must be within project root]
Writes to: [list — must be within .planning/ or project root]
State mutations: [state changes]
Side effects: [git operations, directory creation, etc.]
```

#### 4.2.3 Error Handling
Every error condition must specify:
| Condition | JSON Output | Error Style |
|-----------|-------------|-------------|
| [missing file] | {"error": "X not found"} | safe read returns null |
| [bad args] | {"error": "X required"} | arg validation before fs ops |

### 4.3 Design Decisions
| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|

### 4.4 Drawbacks & Alternatives
| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|

### 4.5 Feature Ladder (Incremental Delivery)
| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | [smallest useful slice] | [what user can do] | XS-S |
| **v1 (Complete)** | [full feature as designed] | [full value] | S-M |
| **v2 (Enhanced)** | [future extensions] | [additional value] | M-L |

### 4.6 Adoption Analysis
| Question | Answer |
|----------|--------|
| How does the user discover this feature? | |
| What's the learning curve? | |
| Does it require changing existing workflows? | |
| What's the "aha moment"? | |

---

## Phase 5: Architecture Decision Record

Create a formal ADR:

```markdown
# ADR-NNNN: [Feature Name]

## Status
Proposed

## Context
[Problem context — what forces are at play?]

## Decision
[What was decided and why]

## Consequences
### Positive
- [Benefit 1]
### Negative
- [Cost 1]
### Neutral
- [Side effect]

## Options Considered
1. [Option A] — [summary]
2. [Option B — chosen] — [summary]

## Links
- Related to: [commands, modules, issues]
```

---

## Phase 6: Error Handling & Diagnostics Design

> *Make the feature diagnosable from day one.*

### 6.1 Failure Mode Analysis
| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| Missing required file | User error | safe read returns null | JSON error | Actionable error |
| Invalid arguments | User error | Arg count/type check | JSON error + hint | Usage guidance |
| Disk full/locked | Environment | try-catch on write | Graceful JSON error | No crash |
| Race condition | Concurrency | safe read pattern | Return null → error JSON | No crash |
| Malformed file content | Data corruption | try-catch on parse | JSON error, skip bad data | Degraded but functional |

### 6.2 Diagnostic Support
| Diagnostic | How | When |
|------------|-----|------|
| `--raw` flag | Human-readable output instead of JSON | Debugging |
| `--cwd <path>` | Override working directory | Testing |
| stderr via error() | Error details to stderr | Failures |
| JSON `error` field | Machine-readable error | Always on failure |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface Inventory
| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| [file/data this feature touches] | Read / Write / Execute | User-controlled / System-generated |

| Input Vector | Source | Validation Required |
|-------------|--------|-------------------|
| CLI arguments | User-typed | Type check, length limit, no shell metacharacters |
| File contents (*.md, *.json) | Disk (user-writable) | Structure validation, size limit |
| Environment variables | OS | Only read known vars, never expose in output |
| Path arguments | User-typed | Full path safety protocol (below) |

### 7.2 Path Safety Protocol (MANDATORY for any path input)
1. Resolve to absolute: `path.resolve(cwd, userPath)`
2. Verify within project: resolved path starts with `path.resolve(cwd)`
3. Reject `..` segments before resolution
4. Reject null bytes (`\0`)
5. On Windows: reject alternate data streams (`:` after drive letter position 2)

### 7.3 Output Sanitization
- [ ] No absolute filesystem paths in output (use normalized relative paths)
- [ ] No environment variable values in output
- [ ] No stack traces in error messages
- [ ] No internal function names or line numbers in user-facing errors

### 7.4 Content Validation
Every file read must validate structure before processing:
- JSON files: `JSON.parse()` inside try-catch, validate expected keys
- Markdown files: Check for expected frontmatter or section headers
- Never pass raw file content to `eval()`, `Function()`, or template strings

### 7.5 Privilege Scope Declaration
```
Reads from: [explicit directory list — must be within project root]
Writes to: [explicit directory list — must be within .planning/ or project root]
Executes shell: [Yes/No — if yes, what commands and why]
Reads outside project: [Yes/No — if yes, justify]
```

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definition (DRAFT NOW — not deferred)
Draft the command file content. The command file IS the interface for AI tools.

### 8.2 Implementation Tasks (Ordered)
Break into small, independently testable units:

```
### Task 1: [Core module changes]
Files: [paths]
Test: [test command]
Estimate: XS/S/M/L
Priority: P[0-6]

### Task 2: [CLI dispatcher routing]
...
```

### 8.3 Dependency Graph
```
Task 1 → Task 2 → Task 3 → ...
```

### 8.4 Risk Register
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|

### 8.5 Cognitive Complexity Budget
- Max lines per function: 50
- Max nesting depth: 3 levels
- Max parameters: 4 (use options object if more needed)

---

## Phase 9: Test Plan

### 9.1 Test Pyramid (enforced counts)
| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Unit** | Test individual functions, mock fs | 5+ | Logic bugs, edge cases |
| **Integration** | CLI with real filesystem | 5+ | Wiring bugs, arg parsing, JSON output |
| **E2E** | Multi-command workflow sequences | 2+ | State transitions, cross-command interaction |

### 9.2 Assertion Density Requirements
Every test must assert AT MINIMUM:
- **Success tests:** (a) correct JSON shape, (b) correct values for ≥ 2 fields, (c) no `error` field
- **Error tests:** (a) `error` field with actionable message, (b) no data corruption, (c) clean exit

### 9.3 Boundary Value Analysis
Test these boundary conditions:
- [ ] Empty project (no phases, no roadmap, no state)
- [ ] Minimal vs maximal project size
- [ ] Edge case names (hyphens, underscores, numbers)
- [ ] Missing file between check and read (race condition)
- [ ] Windows path length near 260-char limit
- [ ] File locked by another process
- [ ] Malformed/corrupted input files

### 9.4 Regression Verification
- [ ] Full suite passes unchanged
- [ ] Related modules explicitly re-tested
- [ ] No existing test expectations changed

### 9.5 Performance Validation
- [ ] Command completes in < 500ms for typical usage
- [ ] No regression in full test suite runtime
- [ ] Output < 10KB for typical usage

---

## Phase 10: Output Artifacts

### 10.1 Save Specification Document
Write complete spec to: `docs/specs/<feature_name>_featureai.md`

### 10.2 Save ADR
Write ADR to: `docs/decisions/ADR-NNNN-<feature_name>.md`

### 10.3 Report Summary
Output a complete summary with: problem & evidence, strategic assessment (Blue Ocean, Wardley, Moat Score, Cognitive Load, Recommendation), design summary, feature ladder, implementation tasks, security assessment, adoption analysis, and next steps.

---

## NEVER DO

- Design without proving the problem exists (Phase 0 demand evidence is mandatory)
- Skip competitive research — must be best-of-breed
- Copy a tool's design without understanding WHY they made that choice
- Add runtime dependencies (zero-dep constraint is absolute)
- Add a feature without error handling design (Phase 6)
- Skip cross-platform considerations (Windows, Mac, AND Linux)
- Produce a spec without measurable success criteria
- Produce a spec without a test plan with enforced assertion density
- Trust existing implementation claims without `--audit` verification
- Design in isolation — always map dependencies and integration points
- Use `eval()`, `Function()`, string interpolation in shell commands, or unvalidated paths
- Violate layer boundaries (commands → agents → lib → dispatcher)
- Expose absolute paths, stack traces, or env vars in output
- Change existing command output schemas without a migration strategy
- Defer the command file definition to "documentation" — draft it during design
- Create functions exceeding 50 lines or 3 nesting levels
- Add a command scoring +2 on cognitive load without explicit justification
- Ship a feature with no demand evidence and no strategic justification

## ALWAYS DO

- Start from the USER's problem, not the technology
- Gather demand evidence before committing to design
- Check all existing commands + agents for overlap before proposing new ones
- Research at least 6 competitor tools before designing
- Apply Blue Ocean thinking — find where to CREATE, not just copy
- Define the JSON output contract BEFORE implementation design (contract-first)
- Write the guide-level explanation BEFORE the reference-level
- Draft the command file as part of the spec (it IS the AI interface)
- Plan for failure (error messages, graceful degradation, clear JSON errors)
- Follow the error message style guide (actionable hints, no stack traces)
- Apply the path safety protocol for any user-supplied path input
- Validate file content structure before processing (never trust disk contents)
- Follow existing patterns for output, errors, file reading
- Maintain zero runtime dependencies
- Enforce the test pyramid (unit ≥ 5, integration ≥ 5, e2e ≥ 2)
- Verify dependency chain has no cycles
- Stay within cognitive complexity budget (50 lines, 3 nesting, 4 params)
- Define a feature ladder (v0 MVP → v1 complete → v2 enhanced)
- Model adoption friction (discovery, learning curve, aha moment)
- Produce a complete spec with ADR, ready for implementation
```

---

#### /pan:focus-sync — Documentation Synchronization

```markdown
---
name: focus-sync
group: Focus
---

# /pan:focus-sync — Documentation Synchronization

Synchronize project documentation after code changes. $ARGUMENTS

**Goal:** Detect and fix documentation drift — stale counts, outdated command references, missing CHANGELOG entries, inconsistent descriptions across README, user guide, architecture docs, and command files.

---

## MANDATORY: Execute ALL Checks

When `/pan:focus-sync` is invoked, run ALL sync operations. Report what changed.

**Flags:**
- `--check-only` — Report what would change without modifying files
- `--readme` — Update README.md only
- `--commands` — Verify command files match implementations
- `--agents` — Verify agent files are consistent
- `--all` — Full sync of everything (default)

---

## Sync Operations

### 1. README Sync
1. Read `README.md`
2. Cross-reference with `package.json` for version, description
3. Verify command count matches actual command files
4. Verify agent count matches actual agent files
5. Verify module count matches actual core modules
6. Update any stale counts or descriptions

### 2. User Guide Sync
1. Read user guide docs
2. Verify all documented commands exist
3. Verify command descriptions match implementations
4. Update examples if behavior changed

### 3. Command File Sync
1. List all command files
2. Cross-reference with dispatcher routing
3. Verify each command routes correctly
4. Report orphaned commands or missing routes

### 4. Agent Sync
1. List all agent files
2. Cross-reference with agent references in workflows
3. Verify agent names match between definitions and references

### 5. CHANGELOG Sync
1. Read recent git commits since last CHANGELOG entry
2. Group by type (feat/fix/docs/refactor)
3. Add missing entries

### 6. Architecture Sync
1. Cross-reference architecture docs with actual module structure
2. Flag stale diagrams or outdated module descriptions

---

## Source of Truth Hierarchy

```
package.json              ← Version, description, entry points
  ↓
README.md                 ← Public documentation
  ↓
docs/USER-GUIDE.md        ← Detailed user guide
  ↓
CHANGELOG.md              ← Version history
```

---

## Output

```json
{
  "updated": ["README.md", "CHANGELOG.md"],
  "skipped": ["docs/ARCHITECTURE.md"],
  "changes_summary": "Updated command count 32→37, added Focus group to help"
}
```

## Report Table

```
| Area | Status | Changes Made |
|------|--------|--------------|
| README | ✅ | Updated command count |
| Commands | ✅ | No changes |
| Agents | ⚠️ | Missing workflow for X |
| CHANGELOG | ✅ | Added 3 entries |
```
```

### 8.2 Implementation Tasks

#### v0 (MVP) — 7 tasks

```
### Task 1: Create focus.cjs core module — scan functions
Files: pan-wizard-core/bin/lib/focus.cjs
What: cmdFocusScan() — read ROADMAP, phases, todos, patterns, grep TODO/FIXME.
      classifyItemPriority() — assign P0-P6 from source type.
      collectWorkItems() — aggregate from all sources.
      sortByPriority() — P0 first, then by effort (smallest first within tier).
Test: node --test tests/focus.test.cjs
Estimate: M
Priority: P3

### Task 2: Create focus.cjs — plan functions
Files: pan-wizard-core/bin/lib/focus.cjs
What: cmdFocusPlan() — read scan results, allocate by budget, write batch file.
      allocateBudget() — P0 mandatory, then fill by priority + smallest-first.
Test: node --test tests/focus.test.cjs
Estimate: S
Priority: P3

### Task 3: Create focus.cjs — sync functions
Files: pan-wizard-core/bin/lib/focus.cjs
What: cmdFocusSync() — read git diff, identify stale docs, report changes.
      checkDocStaleness() — compare command counts, module counts against docs.
Test: node --test tests/focus.test.cjs
Estimate: S
Priority: P3

### Task 4: Wire focus commands into pan-tools.cjs dispatcher
Files: pan-wizard-core/bin/pan-tools.cjs
What: Add 'focus' top-level command with scan/plan/sync subcommands.
Test: Unknown subcommand test + successful routing tests
Estimate: S
Priority: P3

### Task 5: Add optional priority/effort to frontmatter validation
Files: pan-wizard-core/bin/lib/frontmatter.cjs
What: Validate priority (P0-P6) and effort (XS-XL) when present in plan.md frontmatter.
      Return defaults (P3, M) when absent.
Test: node --test tests/frontmatter.test.cjs
Estimate: XS
Priority: P3

### Task 6: Create 3 command .md files + update help
Files: commands/pan/focus-scan.md, focus-plan.md, focus-sync.md, help workflow
What: Command definitions for v0 commands. Add Focus group to help.md.
Test: Commands appear in help output
Estimate: S
Priority: P3

### Task 7: Tests — unit + integration for v0
Files: tests/focus.test.cjs
What: Unit tests for scan, plan, sync functions. Integration tests via runPanTools.
      Minimum: 15 unit + 10 integration + 2 e2e.
Test: npm test — all pass
Estimate: M
Priority: P3
```

#### v1 (Complete) — 5 tasks

```
### Task 8: Add focus-exec to focus.cjs
Files: pan-wizard-core/bin/lib/focus.cjs
What: cmdFocusExec() — read batch, classify tiers, execute with shortcuts.
      executeMicroBatch() — group XS/S items, targeted tests.
      executeStandard() — full test per item.
      executeFull() — design review + implement + build + test.
Test: node --test tests/focus.test.cjs
Estimate: L
Priority: P3

### Task 9: Add focus-design workflow
Files: commands/pan/focus-design.md, agents/ (if needed)
What: Full 10-phase strategic investigation pipeline as command .md workflow.
      Phase 0: Problem Framing → Phase 1: Internal Recon → Phase 2: Competitive Intel →
      Phase 2.5: Reality Check (--audit) → Phase 3: Strategic Analysis (Blue Ocean, Wardley, Moat) →
      Phase 3.5: Architecture Assessment → Phase 4: Design Synthesis →
      Phase 5: ADR → Phase 6: Error Handling → Phase 7: Security →
      Phase 8: Implementation Roadmap → Phase 9: Test Plan → Phase 10: Output Artifacts.
      Modes: --full (all 10 phases), --internal (skip competitive intel),
      --outward (skip hardening phases 6-7), --spike (fast prototype).
      Modifiers: --gate (pause after Phase 3), --audit (add Phase 2.5), --mvp (stop after v0 tasks).
Test: Design output produces valid spec file + ADR
Estimate: L
Priority: P3

### Task 10: Wire exec + design into dispatcher + help
Files: pan-tools.cjs, help workflow, 2 command .md files
What: Add exec and design subcommands. Update help with all 5 Focus commands.
Test: All 5 commands routable
Estimate: S
Priority: P3

### Task 11: Full test suite for v1
Files: tests/focus.test.cjs
What: Add exec and design tests. Total target: 30+ unit, 15+ integration, 5+ e2e.
Test: npm test — all pass
Estimate: M
Priority: P3

### Task 12: Installer + documentation
Files: bin/install.js, README.md, USER-GUIDE.md, CHANGELOG.md, ARCHITECTURE.md
What: Register Focus commands in installer for all 5 runtimes. Update all docs.
Test: E2E install test includes Focus commands
Estimate: M
Priority: P4
```

### 8.3 Dependency Graph

```
Task 1 (Scan core)
  ├─→ Task 2 (Plan core)
  ├─→ Task 3 (Sync core)
  └─→ Task 5 (Frontmatter validation)
        │
        ├─→ Task 4 (Dispatcher wiring)
        │     └─→ Task 6 (Command .md + help)
        │           └─→ Task 7 (v0 Tests)
        │                 │
        │                 ▼
        │           Task 8 (Exec core) ─→ Task 9 (Design workflow)
        │                                      │
        │                                      ▼
        │                               Task 10 (v1 Dispatcher + help)
        │                                      │
        │                                      ▼
        │                               Task 11 (v1 Tests)
        │                                      │
        │                                      ▼
        └──────────────────────────────→ Task 12 (Installer + docs)
```

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Breaks existing tests | Low | High | Run full suite after each task |
| focus.cjs grows too large | Medium | Medium | Extract helpers early, cap at 400 LOC |
| Codebase TODO scanning is slow | Low | Medium | Limit to .planning/ + source dirs, skip node_modules |
| Batch file format changes | Low | Medium | Version field in batch JSON |
| Users confused by Focus vs Phase | Medium | Low | Clear help text distinguishing the two |

### 8.5 Cognitive Complexity Budget

- Max lines per function: 50
- Max nesting depth: 3
- Max parameters: 4 (use options object for scan filters)

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Unit** | Test scan/plan/sync/exec functions directly | 20+ | Logic bugs, priority sorting, budget math |
| **Integration** | `runPanTools('focus scan', tmpDir)` | 15+ | Dispatcher wiring, JSON output, error handling |
| **E2E** | Multi-command: scan → plan → exec → sync | 5+ | State transitions, batch file roundtrip |

### 9.2 Assertion Density

**Success tests assert:**
1. JSON shape (all expected fields present)
2. Correct priority ordering (P0 before P1)
3. Budget math (allocated <= limit)
4. No `error` field

**Error tests assert:**
1. `error` + `hint` fields present
2. State files unchanged after error
3. Clean exit

### 9.3 Boundary Values

- [x] Empty project (no phases, no todos, no patterns)
- [x] Project with 0 incomplete plans (all phases done)
- [x] Budget of 0 (should return empty batch)
- [x] Budget of 1000 (should include everything)
- [x] All items same priority (sort by effort)
- [x] No TODO/FIXME in codebase (scan still works)
- [x] Malformed plan.md frontmatter (defaults apply)
- [x] Batch file missing when exec runs (clear error)
- [x] Batch file with 0 items (no-op exec)

---

## Phase 10: Output Artifacts

### 10.1 Specification saved to: `docs/specs/pan_focus_commands_featureai.md`
### 10.2 ADR saved to: `docs/decisions/ADR-0006-focus-commands.md`

---

## /featureAI Complete — PAN Focus Commands

### Problem & Evidence
PAN's shipped workflow is phase-scoped with no strategic layer for prioritization, capacity budgeting, or feature design — Evidence: internal usage (15 superplan runs, 16 execplan sessions, 4 featureAI specs), Taskmaster AI (17k+ stars for task prioritization), Claude Code plan mode (2026 GA).

### Strategic Assessment
- Blue Ocean: Eliminate PAN-specific hardcoding + installation friction, Reduce nothing (full pipelines preserved), Raise integration with phase workflow + pipeline rigor, Create unified scan→design→plan→exec→sync pipeline with full 10-phase investigation + 7-phase scanning + 6-stage execution
- Wardley: Custom-Built → targeting Product stage
- Moat Score: 27/30 — strongest in Context Engineering + Cross-Platform
- Cognitive Load: +1 (adds complexity, justified by new group)
- Recommendation: Build (ship full uncompromised pipelines as 5 Focus commands)

### Design Summary
- Feature Type: New Core Module + 5 Workflow Commands
- Modules Affected: focus.cjs (new), pan-tools.cjs, frontmatter.cjs, help.md
- Output Schema: 5 contracts defined (scan, plan, exec, design, sync)
- Error Handling: safeReadFile + try-catch + JSON error + hint pattern
- Breaking Changes: Additive only (optional frontmatter fields, new directory)
- Layer Violations: None

### Feature Ladder
- v0 (MVP): focus-scan + focus-plan + focus-sync — L effort (new module + 3 commands + tests)
- v1 (Complete): + focus-exec + focus-design — L effort (2 commands + tier execution + design pipeline)
- v2 (Enhanced): + execution modes + pattern remediation + analytics — M-L effort

### Implementation
- Tasks: 12 tasks (7 v0, 5 v1)
- Complexity: L (new module + 5 commands + tests + installer + docs)
- Files to create: 6 (focus.cjs, 5 command .md files)
- Files to modify: 5 (pan-tools.cjs, frontmatter.cjs, help.md, install.js, docs)
- Tests planned: 40+ (unit: 20, integration: 15, e2e: 5)

### Security
- Attack surface: Read-only codebase scan, writes to .planning/ and docs/
- Path safety: Applied (all within project root)
- Output sanitization: Verified (toPosix, no absolute paths)

### Adoption
- Discovery: Focus group in /pan:help, progress command suggests scan
- Learning curve: Zero config — run focus-scan and follow the output
- Aha moment: First time scan surfaces a P0 bug and plan slots it into a 20-minute batch

### Documents Created
- Spec: `docs/specs/pan_focus_commands_featureai.md`
- ADR: `docs/decisions/ADR-0006-focus-commands.md`

### Next Step
Add to superplan: `/superplan --refresh`
Execute: `/execplan`
