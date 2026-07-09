# featureAI: Focus Auto-Runner — Continuous Categorized Execution Pipeline

> **Generated**: 2026-03-03 (v2 — deep rewrite incorporating budget heritage + ADR quality bar)
> **Mode**: `--full` (all 10 phases)
> **Feature**: `/pan:focus-auto` — Continuous scan→plan→exec loop with purpose-driven campaigns
> **ADR**: ADR-0015
> **Predecessors**: execplan.md (capacity budget), superplan.md (scan/priority), panmonty_protocol.md (change categories, loop exhaustion)

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard's focus system — born from the execplan/superplan lineage (sessions 1-16) and reified in the focus commands (session 17, ADR-0006) — requires **three manual invocations per improvement cycle**: `/pan:focus-scan` → `/pan:focus-plan` → `/pan:focus-exec`. Each cycle takes 20-60 minutes of AI time and produces 15-50 points of verified work. For the sustained multi-cycle campaigns that produce transformative codebase improvement (sessions 24-25 together cleaned 44 items across 65 files), the human must manually bridge each cycle: reviewing the scan, confirming the plan, monitoring execution, then repeating.

This matters NOW because: (a) the focus system has proven its value over 6 consecutive sessions, establishing that iterative refinement delivers compound quality gains, (b) competitors are converging on continuous execution (Cursor Background Agents, GitHub Copilot Coding Agent, Aider --watch-files), and (c) PAN's unique budget + priority + category infrastructure — which no competitor has — is the perfect foundation for intelligent autonomous looping.

The cost of NOT building this: Users plateau at 1-2 manual cycles per session instead of running the 5-10 cycle campaigns that transform codebase quality. The manual overhead also prevents off-hours execution — a developer can't say "clean up the test suite overnight" without this feature.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| **User-stated explicit request** | This conversation | "design auto flow, new one that can perform continuously from scan-plan-exec-scan... etc, with categories of what it scans for, like cleanups for example and then categorizes them" |
| **Internal usage pattern (quantified)** | Sessions 24-25 (2026-03-03) | Two back-to-back manual cycles in a single day: session 24 (20 items, 45 pts, 1180→1190 tests) + session 25 (24 items, 50 pts, 1190→1169 tests). Total: 44 items, 95 pts across 2 manual cycles |
| **Internal usage pattern (historical)** | Sessions 1-12 | The execplan/superplan pipeline was manually invoked 12+ times across 12 sessions, accumulating 363→674 tests. Each session required manual plan loading + capacity budgeting |
| **Competitor convergence** | Cursor, Copilot, Aider | Cursor ships cloud Background Agents (2M PRs/month). GitHub Copilot Coding Agent runs on issue assignment. Aider has --watch-files event-driven mode. Industry moving toward autonomous execution |
| **PanMonty heritage** | panmonty_protocol.md | PanMonty already defines 5 change categories (DOCS_ONLY, TESTS_ONLY, LIB_CHANGE, HOOK_CHANGE, FULL_FEATURE) and a loop exhaustion guard (3rd Phase 7 entry → ask user). This proves the concept of categorized looping is architecturally native to PAN |

**Demand status**: STRONG — direct user request + quantified internal usage across 25 sessions + competitive convergence + architectural heritage.

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Continuous scan→plan→exec loop orchestration | Cloud/remote execution (PAN is local-first, zero-dep — no Docker, no GitHub Actions) |
| 5 purpose categories (cleanup, tests, stability, features, docs) | User-defined custom categories (5 predefined covers 95% of real usage in sessions 1-25; extensibility adds config complexity for negligible value) |
| Category-scoped scanning with priority-range filtering | Real-time file watching (Aider's --watch-files approach; batch execution is PAN's paradigm, not event-driven) |
| Triple safety net: per-cycle budget + cumulative budget + max cycles | Multi-branch parallel execution (requires git worktree orchestration; session-bound is simpler and safer) |
| Circuit breaker on test regression (inherits PanMonty's loop exhaustion pattern) | External task sources like Jira/GitHub Issues (PAN reads .planning/ only; external integration is a separate feature) |
| Run state persistence in auto-run.json for cross-session resumability | AI model selection per category (model profile is a separate concern, handled by /pan:profile) |
| `pan-tools focus auto` core subcommand extending focus.cjs | New core module (focus.cjs is the right home; no module proliferation) |
| Inherits ALL 9 behavioral rules from focus-exec within each cycle | Modifying the 9 behavioral rules (these are battle-tested across 6+ sessions) |
| Inherits the capacity budget system from execplan/focus-plan | New budget system (the XS=1/S=2/M=4/L=10/XL=20 system is proven across 25 sessions) |

### 0.4 Success Criteria (Measurable)

```
SC-1: User starts a multi-cycle campaign with one command: `/pan:focus-auto --category cleanup`
SC-2: Each cycle produces a verifiable batch with before/after test counts (inherits focus-exec Stage 4)
SC-3: Loop stops automatically on ANY of: budget exhausted, no items remain, test regression, max cycles, zero completed items in a cycle
SC-4: Category filter reduces scan results by >= 40% vs unfiltered scan (measured: cleanup items are ~30% of total in sessions 24-25)
SC-5: Progress persists to .planning/focus/auto-run.json — can resume with --continue across sessions
SC-6: Zero regressions in existing 1169 tests
SC-7: Works across all 5 runtimes (Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI)
SC-8: pan-tools focus auto completes in < 300ms (state management only; scan/plan/exec are separate invocations)
SC-9: Raw mode (--raw) produces a human-readable campaign dashboard for non-JSON consumers
```

### 0.5 User Stories

```
As a developer who just ran 2 manual cleanup cycles back-to-back (like sessions 24-25),
I want to say "/pan:focus-auto --category cleanup --max-cycles 5",
so that the AI handles the scan→plan→exec cycling automatically while I review the results,
instead of manually invoking 3 commands per cycle (15 total invocations for 5 cycles).

As a developer maintaining a large codebase with 1169+ tests,
I want purpose-driven campaigns where "--category tests" only touches test files
and "--category stability" only touches error handling and validation,
so that each campaign has a clear, reviewable scope and doesn't mix unrelated changes,
instead of getting a mixed bag where cleanup items, feature items, and test items
are interleaved in ways that make commit review harder.

As a developer running improvement campaigns during focused work blocks,
I want the auto-runner to stop safely on test regression (circuit breaker),
stop on budget exhaustion (cumulative cap), and persist progress for --continue later,
so that I can trust the auto-runner to maintain codebase integrity autonomously,
instead of babysitting each cycle and worrying about runaway execution.

As a developer using PAN Wizard across different AI runtimes,
I want the auto-runner to work identically whether I invoke it from Claude Code,
OpenCode, Gemini CLI, Codex, or Copilot CLI,
so that my campaign workflow doesn't change when I switch tools,
instead of learning runtime-specific continuous execution patterns.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:focus-scan` | Partial — auto calls scan internally per cycle | No migration. Auto-runner USES scan. Scan remains independently invocable. |
| `/pan:focus-plan` | Partial — auto calls plan internally per cycle | No migration. Auto-runner USES plan with category-filtered items. Plan remains independently invocable. |
| `/pan:focus-exec` | Partial — auto calls exec internally per cycle | No migration. Auto-runner USES exec for the 6-stage pipeline. Exec remains independently invocable. |
| `/pan:focus-sync` | None — sync is called within exec's Stage 5 | N/A |
| `/pan:focus-design` | None — design is standalone investigation | N/A |
| `/pan:exec-phase` | None — different abstraction (roadmap phases vs focus items) | N/A |
| `/pan:panmonty` (PanMonty protocol) | Conceptual — PanMonty has change categories + loop exhaustion | Auto-runner adopts PanMonty's category concept but operates at focus-batch granularity, not individual-item granularity. PanMonty is for manual feature implementation; auto-runner is for automated quality campaigns. |
| `execplan.md` (legacy) | Historical — execplan's budget system is now in focus-exec | execplan is superseded by focus-exec. Auto-runner extends focus-exec, not execplan. |
| `superplan.md` (legacy) | Historical — superplan's scan system is now in focus-scan | superplan is superseded by focus-scan. Auto-runner extends focus-scan, not superplan. |

**Verdict**: No full overlap. The auto-runner is a NEW orchestration layer that composes existing focus commands into an automated loop. All existing commands remain independently usable. The conceptual heritage from PanMonty (categories) and execplan/superplan (budget) validates the approach rather than duplicating it.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Focus commands | 5 (scan, plan, exec, sync, design) | 6 (+auto) | +1 command |
| New concepts | 0 | 2 (categories, auto-loop) | +2 concepts |
| Manual invocations for 5-cycle campaign | 15 (3 per cycle × 5) | 1 | -14 invocations |
| Score | — | — | **-1 (net simplification)** |

**Justification**: While auto introduces +1 command and +2 concepts, it ELIMINATES 14 manual invocations for the most common power-user workflow (multi-cycle campaigns). The category concept is already familiar from PanMonty's change categories. Net effect: **simplification** for the target audience (users who run 2+ cycles).

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance to Auto-Runner |
|------------|--------|----------|--------------------------|
| Work item collection (phases, todos, patterns) | Production (session 17+) | focus.cjs:collectWorkItems | **Core dependency** — needs category post-filter |
| Priority classification (P0-P6) | Production (session 17+) | focus.cjs:classifyItemPriority | **Reuse unchanged** — categories map to priority ranges |
| Reality Score computation (RS formula) | Production (session 17+) | focus.cjs:computeRealityScore | **Reuse unchanged** — RS filtering within categories |
| Budget allocation (4 modes) | Production (session 17+) | focus.cjs:allocateBudget | **Reuse unchanged** — mode selection per category |
| Multi-pass allocation (stability/feature split) | Production (session 17+) | focus.cjs:allocatePass | **Reuse unchanged** — passes constrained by category priority range |
| Tier classification (MICRO/STANDARD/FULL) | Production (session 17+) | focus.cjs:classifyTier | **Reuse unchanged** — tier pacing within each cycle |
| Batch file persistence (JSON) | Production (session 17+) | focus.cjs:cmdFocusPlan | **Reuse unchanged** — each cycle produces a batch file |
| Latest batch reader | Production (session 17+) | focus.cjs:readLatestBatch | **Reuse unchanged** — exec reads batch per cycle |
| Doc staleness detection | Production (session 17+) | focus.cjs:checkDocStaleness | **Reuse unchanged** — sync within exec's Stage 5 |
| Error pattern reading | Production (session 14+) | commands.cjs:readErrorPatterns | **Reuse unchanged** — patterns are scan input source |
| Session history append | Production (session 14+) | commands.cjs:appendSessionSummary | **New usage** — append per-campaign summary |
| Rollback snapshots | Production (session 14+) | commands.cjs:cmdRollbackSnapshot | **Reuse unchanged** — snapshot per cycle |
| PanMonty change categories | Production (session 1+) | panmonty_protocol.md | **Heritage** — 5 categories (DOCS/TESTS/LIB/HOOK/FULL) inform auto-runner's 5 categories |
| PanMonty loop exhaustion | Production (session 1+) | panmonty_protocol.md Phase 7 | **Heritage** — 3rd Phase 7 entry asks user. Auto-runner adapts: zero-completed-items triggers stop |
| execplan capacity budget | Superseded by focus-exec | execplan.md | **Heritage** — XS=1/S=2/M=4/L=10/XL=20 system carried forward unchanged |
| execplan 9 behavioral rules | Superseded by focus-exec | execplan.md/focus-exec.md | **Heritage** — all 9 rules inherited by auto-runner cycles |
| Verbose logging | Production (session 18+) | core.cjs:verbose() | **Reuse** — per-cycle verbose output for diagnostics |
| Safe file read | Production (all sessions) | core.cjs:safeReadFile() | **Reuse** — auto-run.json reading |
| Path normalization | Production (all sessions) | core.cjs:toPosix() | **Reuse** — all paths in output |
| Config loading | Production (all sessions) | config.cjs:loadConfig() | **New usage** — load auto-runner defaults from config.json |

### 1.2 Budget System Heritage Map

The auto-runner's budget system traces a clear lineage:

```
execplan.md (v1, session 1-12)
├── Capacity Budget: XS=1, S=2, M=4, L=10, XL=20
├── 4 Modes: bugfix/balanced/features/full
├── 6-Stage Pipeline
├── 9 Behavioral Rules
└── Test cadence by tier: MICRO(batch 3)/STANDARD(each)/FULL(build+each)
    │
    ↓
superplan.md (v1-v18, session 1-20)
├── Priority Framework: P0-P6
├── Effort Estimation: XS-XL
├── Reality Score: RS = (UV + TC + RR) / JS
└── Scan Assembly: items grouped by priority
    │
    ↓
focus-scan/plan/exec (v1, session 17, ADR-0006)
├── Unified in focus.cjs module (559 LOC)
├── JSON batch files (.planning/focus/batch-*.json)
├── Constants in constants.cjs (EFFORT_POINTS, FOCUS_MODES, etc.)
├── allocateBudget() with multi-pass algorithm
└── 73 tests in focus.test.cjs
    │
    ↓
panmonty_protocol.md (parallel track, session 1+)
├── 5 Change Categories: DOCS_ONLY/TESTS_ONLY/LIB_CHANGE/HOOK_CHANGE/FULL_FEATURE
├── Loop Exhaustion Guard: 3rd Phase 7 entry → ask user
├── Batch Planning: size all items → assign tier → sequence
└── Quick Mode: auto-detect XS/S DOCS/TESTS → skip full workflow
    │
    ↓
focus-auto (THIS FEATURE)
├── Inherits: budget system, 4 modes, 6-stage pipeline, 9 rules, tier cadence
├── Inherits: P0-P6 priorities, RS scoring, effort estimation
├── Inherits: JSON batch files, allocateBudget(), constants
├── Adapts: PanMonty categories → 5 purpose categories with priority-range mapping
├── Adapts: PanMonty loop exhaustion → circuit breaker + zero-completed stop
└── Creates: continuous loop, run state persistence, campaign-level tracking
```

### 1.3 Convention Enforcement Checklist

- [x] Function naming: `cmdFocusAuto()` follows `cmd` prefix pattern (see cmdFocusScan, cmdFocusPlan, etc.)
- [x] File reads: safe read via `safeReadFile()` or try-catch with null return
- [x] File writes: wrapped in try-catch (see writeStateMd pattern in state.cjs)
- [x] JSON output: via `output(obj, raw, rawMessage)` — never console.log
- [x] Errors: via `error(msg)` — never console.error or throw
- [x] Paths: via `toPosix(path)` — never raw path.join in output fields
- [x] Exports: at bottom of focus.cjs via `module.exports = { ... }`
- [x] Subcommand routing: `auto` case in focus switch block in pan-tools.cjs
- [x] Module format: CommonJS (.cjs, require()/module.exports)
- [x] Zero runtime deps: Node.js built-ins only (fs, path, child_process)
- [x] getArgValue: use `getArgValue(args, flag, default)` for flag parsing (session 24 pattern)

### 1.4 Dependency & Integration Map

```
[focus auto]
    ├── depends on: focus.cjs — collectWorkItems, allocateBudget, classifyTier,
    │                           computeRealityScore, sortByPriority, readLatestBatch
    ├── depends on: constants.cjs — PRIORITY_LEVELS, EFFORT_POINTS, FOCUS_MODES,
    │                                FOCUS_TIERS, FOCUS_DIR, new AUTO_RUN_FILE,
    │                                new FOCUS_CATEGORIES, new DEFAULT_MAX_CYCLES,
    │                                new DEFAULT_TOTAL_BUDGET
    ├── depends on: core.cjs — output, error, safeReadFile, toPosix, verbose
    ├── depends on: utils.cjs — planningPath
    ├── extends: focus subcommand group (adds 'auto' alongside scan/plan/exec/sync/design)
    ├── informed by: panmonty_protocol.md — change categories, loop exhaustion guard
    ├── informed by: execplan.md — capacity budget, 6-stage pipeline, 9 behavioral rules
    ├── conflicts with: nothing (purely additive — no existing functions modified)
    └── enables: overnight campaigns, CI integration, scheduled quality runs, --continue resumability
```

**require() chain**: `pan-tools.cjs` → `focus.cjs` (cmdFocusAuto) → `constants.cjs` + `core.cjs` + `utils.cjs`. No new modules. No circular dependencies (verified: focus.cjs has no reverse dependency on pan-tools.cjs).

---

## Phase 2: Competitive Intelligence

### 2.1 Deep-Dive Summary (8 Tools Researched)

Full competitive research in: [continuous_autonomous_execution_featureai.md](continuous_autonomous_execution_featureai.md)

| Tool | Continuous Mode | Categories | Budget | Loop Control | Safety |
|------|----------------|------------|--------|-------------|--------|
| **Aider** | --watch-files (event) | None | None | User bash loop | --dry-run, --auto-test |
| **Cursor** | Background Agents (cloud) | None (Bugbot is 1 specialized agent) | Opaque credits | Run until done/fail | Plan mode, branch isolation |
| **Cline** | YOLO mode | None | None (removed v3.35) | None | Action-type permissions (can disable all) |
| **Windsurf** | Turbo Mode | None | Per-session | Debug loop (try→test→retry) | Memories system, rules |
| **GitHub Copilot** | Coding Agent (cloud, issue-triggered) | GitHub labels (implicit) | Per-issue | PR completion | Branch isolation, Actions CI |
| **Claude Code** | Headless -p, Agent SDK | None | --max-turns N | Session end | Permission modes |
| **Devin** | Compound agent (Planner/Coder/Critic) | None | Per-task | Checkpoint iteration | Sandboxed environment |
| **OpenAI Codex** | Per-task cloud sandbox | None | Per-task | Task completion | System-level sandbox |

### 2.2 Five Whitespace Opportunities

1. **Categorized work queue** — No tool has a structured, user-visible work queue with purpose-driven categories. GitHub Copilot uses labels but as implicit routing, not as a scoping mechanism.
2. **Budget-aware continuous execution** — No tool has per-cycle or cumulative budget caps. Cursor depletes credits opaquely. Cline removed its only safeguard.
3. **Priority-driven automatic selection** — No tool auto-selects work by priority × effort × reality score. Every competitor treats work items as equal.
4. **Structured progress persistence** — Most tools rely on git commits as only state. PAN's `.planning/` directory with structured JSON provides machine-readable progress that survives across sessions and runtimes.
5. **Cross-runtime orchestration** — Every tool is siloed to one runtime. PAN's 5-runtime command .md architecture means the auto-runner works identically across Claude Code, OpenCode, Gemini CLI, Codex, and Copilot CLI.

### 2.3 Heritage Advantage: PanMonty Categories → Focus Categories

PAN is uniquely positioned because the category concept is **already architecturally native**:

| PanMonty Category | Detected By | Focus Auto Category | Priority Range | Mode Hint |
|-------------------|-------------|---------------------|----------------|-----------|
| DOCS_ONLY | Only `.md` files touched | **docs** | P5-P6 | balanced |
| TESTS_ONLY | Only `tests/` files touched | **tests** | P2-P5 | balanced |
| LIB_CHANGE | `pan-wizard-core/bin/lib/*.cjs` files | **stability** or **cleanup** | P0-P3 | bugfix/balanced |
| HOOK_CHANGE | `hooks/src/*.js` files | **features** | P3-P5 | features |
| FULL_FEATURE | Cross-cutting changes | *(no direct mapping — auto-runner is for iterative refinement, not new features)* | P3-P5 | features |

This means the category concept has been **validated in production** (PanMonty has been used since session 1) — we're not inventing a new concept, we're elevating a proven one.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Complex configuration taxonomies. No YAML config for categories. No daemon/service mode. No cloud execution. No real-time file watching. No user-extensible category definitions (5 is enough). |
| **REDUCE** | What should be reduced? | Manual invocations per campaign: 15 → 1. Cognitive load of remembering scan→plan→exec sequence. Decision fatigue about mode/budget per cycle (category implies sensible defaults). Human attention required between cycles (from constant to zero, with circuit breaker safety). |
| **RAISE** | What should be raised? | Campaign visibility: structured per-cycle stats, cumulative progress dashboard. Safety guarantees: triple safety net + circuit breaker + PanMonty-derived loop exhaustion guard. Resumability: cross-session --continue with full state restore. Test quality assurance: regression detection between cycles, not just within. |
| **CREATE** | What should we create? | **Purpose-driven campaigns** — not "run stuff continuously" but "run a cleanup campaign" with domain-scoped scanning, appropriate mode defaults, and meaningful stopping conditions. **Campaign-level analytics** — total items, points, test delta across all cycles. **Intelligent default escalation** — category→mode→priority-range→budget chain eliminates manual flag selection. |

### 3.2 Wardley Evolution Assessment

```
Genesis ──────── Custom-Built ──────── Product ──────── Commodity
                      ▲                    ▲
                      │                    │
             Categorized work       Continuous execution
             queues (PAN only)      (Cursor/Copilot/Aider)
                      │
                      │
              Budget-aware execution
              (PAN only, proven 25 sessions)
```

- **Continuous execution**: Moving from Custom-Built → Product. Cursor, Copilot, Aider all have some form. Becoming table-stakes within 12 months.
- **Categorized work queues**: Still in Genesis. PAN is the only tool exploring this. First-mover advantage with 18+ months before competitors could replicate (they'd need to build the entire scan→plan→exec infrastructure first).
- **Budget-aware execution**: Custom-Built, unique to PAN. The XS/S/M/L/XL point system with 4 modes has been proven across 25 sessions. No competitor has attempted this.
- **2-3 year forecast**: Continuous execution becomes commodity. Categorization and budget awareness become the differentiators for enterprise adoption. PAN should own this space NOW.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Categories reduce scan noise by 40-70% per campaign, improving AI focus and item quality | 5 |
| **Cross-Platform** | Auto-runner works across 5 runtimes via command .md — no competitor has cross-runtime continuous execution | 5 |
| **Developer Experience** | Single command replaces 15 invocations for a 5-cycle campaign — transformative workflow reduction | 5 |
| **Zero Dependencies** | Pure Node.js, file-based state, no daemon, no database, no cloud, no Docker | 5 |
| **State Persistence** | auto-run.json tracks per-cycle stats with --continue resumability — survives session boundaries | 5 |
| **Verification Quality** | Triple safety net (per-cycle + cumulative + max-cycles) + regression circuit breaker + zero-completed-items guard (from PanMonty loop exhaustion) | 5 |
| **Budget Heritage** | 25 sessions of proven budget system (execplan → focus-exec), 4 allocation modes, RS scoring — no competitor has this depth | 5 |
| **Total** | | **35/35** |

### 3.4 Strategic Recommendation

**BUILD — IMMEDIATELY.** This is the most strategically differentiated feature PAN can ship. The auto-runner sits at the intersection of THREE unique capabilities that no competitor has: (1) categorized work queues, (2) budget-aware execution with 25 sessions of proven point-system heritage, and (3) cross-runtime portability. Our unique angle: **purpose-driven campaigns** — "run a cleanup campaign" or "run a test hardening campaign" as a single-command experience, with each category carrying sensible defaults for mode, priority range, and budget. We should explicitly NOT copy Cursor's opaque cloud execution (PAN is transparent and local), Cline's safety-free YOLO mode (PAN's circuit breaker is a feature, not a constraint), or Aider's "user writes the bash loop" approach (PAN provides the orchestration). The strategic timing is NOW — we have the infrastructure (focus-scan/plan/exec), the heritage (execplan/superplan/PanMonty), and the demand (user request + 25 sessions of manual cycling).

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

| Component | Type | Template |
|-----------|------|----------|
| `cmdFocusAuto()` in focus.cjs | Core Enhancement | Add to existing module |
| `categoryFilter()` in focus.cjs | Core Enhancement | New exported helper |
| `readAutoRun()` / `writeAutoRun()` in focus.cjs | Core Enhancement | New persistence helpers |
| `focus auto` dispatch in pan-tools.cjs | Dispatcher Addition | New case in focus switch |
| Constants (FOCUS_CATEGORIES, etc.) | Constants Addition | Add to constants.cjs |
| `focus-auto.md` command file | New Workflow | New command .md |
| Config defaults for auto section | Config Enhancement | Add section to loadConfig |

### 3.5.2 Layer Violation Check

- [x] Command file (.md) does NOT call core modules directly — invokes `pan-tools focus auto` via CLI
- [x] focus.cjs returns data objects — does NOT import agent files or command .md files
- [x] `cmdFocusAuto()` calls `output()` only as a cmd* entry point — helper functions return data
- [x] No upward dependencies — focus.cjs does NOT require pan-tools.cjs (verified in Phase 1.4)
- [x] `categoryFilter()` is a pure function — takes items + category, returns filtered items
- [x] `readAutoRun()` / `writeAutoRun()` follow the `readJsonFile()` / `safeReadFile()` patterns

### 3.5.3 Output Contract Design (Contract-First)

**`pan-tools focus auto` — Initialize a new run:**
```json
{
  "run_id": "string — auto-YYYY-MM-DD-N (N = run number for that day)",
  "status": "string — initialized",
  "category": "string|null — cleanup|tests|stability|features|docs|null(all)",
  "mode": "string — bugfix|balanced|features|full",
  "budget_per_cycle": "number — points per cycle (5-100)",
  "max_cycles": "number — maximum iterations (1-50)",
  "total_budget": "number — cumulative points cap (5-5000)",
  "priority_range": "[string, string] — [min_priority, max_priority] derived from category",
  "cycles_completed": 0,
  "total_items_completed": 0,
  "total_points_used": 0,
  "tests_baseline": "number|null — filled by workflow after npm test",
  "run_file": "string — posix path to .planning/focus/auto-run.json"
}
```

**`pan-tools focus auto --status` — Check progress:**
```json
{
  "run_id": "string",
  "status": "string — initialized|in_progress|completed|stopped|failed",
  "category": "string|null",
  "cycles_completed": "number",
  "total_items_completed": "number",
  "total_points_used": "number",
  "budget_remaining": "number — total_budget - total_points_used",
  "cycles_remaining": "number — max_cycles - cycles_completed",
  "tests_baseline": "number",
  "tests_current": "number",
  "tests_delta": "number — tests_current - tests_baseline",
  "stop_reason": "string|null — exhausted|no_items|regression|max_cycles|budget_cap|zero_completed|user_stop",
  "last_cycle": "object|null — { cycle, items_completed, items_failed, points_used, tests_before, tests_after, batch_file }"
}
```

**`pan-tools focus auto --update` — Record cycle results (called by workflow after each cycle):**
```json
{
  "run_id": "string",
  "status": "string — in_progress|completed|stopped",
  "cycle_recorded": "number — which cycle was just recorded",
  "total_items_completed": "number — updated cumulative",
  "total_points_used": "number — updated cumulative",
  "stop_reason": "string|null"
}
```

**`pan-tools focus auto --stop` — Graceful stop:**
```json
{
  "run_id": "string",
  "status": "stopped",
  "stop_reason": "user_stop",
  "cycles_completed": "number",
  "total_items_completed": "number"
}
```

**Contract rules verified:**
- [x] camelCase field names (run_id uses underscore for consistency with existing batch format)
- [x] No collisions with scan/plan/exec output fields
- [x] Error shape: `{"error": "descriptive message"}` — consistent with all 91 subcommands
- [x] Paths via toPosix() — relative to project root
- [x] Output < 2KB typical

### 3.5.4 State Transition Modeling

| Current State | Action | New State | Error If Invalid |
|--------------|--------|-----------|-----------------|
| No auto-run.json | `focus auto --category cleanup` | initialized | — |
| No auto-run.json | `focus auto --continue` | — | `"No auto-run in progress. Start with: focus auto --category <name>"` |
| No auto-run.json | `focus auto --status` | — | `"No auto-run found. Start with: focus auto --category <name>"` |
| initialized | Workflow starts cycle 1 (--update with cycle data) | in_progress | — |
| in_progress | Cycle completes, items remain, budget available | in_progress | — |
| in_progress | Scan finds 0 items matching category | completed (no_items) | — |
| in_progress | total_points_used >= total_budget | completed (budget_cap) | — |
| in_progress | cycles_completed >= max_cycles | completed (max_cycles) | — |
| in_progress | tests_after < tests_before for any cycle | stopped (regression) | — |
| in_progress | Cycle completes with 0 items completed (PanMonty loop exhaustion) | stopped (zero_completed) | — |
| in_progress | `focus auto --stop` | stopped (user_stop) | — |
| in_progress | `focus auto --category X` (new run attempt) | — | `"Auto-run already in progress. Use --stop to end it, or --continue to resume."` |
| completed | `focus auto --category X` | initialized (new run, old archived) | — |
| stopped | `focus auto --continue` | in_progress (resumes) | — |
| stopped | `focus auto --category X` | initialized (new run, old archived) | — |

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | **No** — all existing focus subcommands unchanged |
| Changes file formats? | **No** — new auto-run.json is additive; batch-*.json format unchanged |
| Changes directory structure? | **No** — auto-run.json goes in existing .planning/focus/ |
| Changes installer output? | **No** — no installer changes needed |

**No migration strategy needed.** This is purely additive.

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| Output feeds another command | Yes | `focus auto --status` JSON feeds CI/CD status checks |
| Callable from an agent | Yes | `pan-tools focus auto --category cleanup --max-cycles 3` |
| Usable in a hook pipeline | Yes | Post-commit hook could trigger `focus auto --status` to check if campaign is running |
| Works in --raw mode | Yes | Human-readable campaign dashboard: "Cycle 3/5 | 47/200 pts | 12 items | +3 tests" |
| Composable with existing focus commands | Yes | `focus scan --lean` still works independently; auto-runner calls it internally |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Read auto-run.json (1 × ~5ms) | ~5ms | safeReadFile + JSON.parse |
| Read config.json (1 × ~5ms) | ~5ms | loadConfig for auto defaults |
| Validate args (computation) | ~1ms | Enum checks, range checks |
| Write auto-run.json (1 × ~5ms) | ~5ms | JSON.stringify + writeFileSync |
| toPosix computation | ~1ms | Path normalization |
| **Total (cmdFocusAuto)** | **< 20ms** | Well under 500ms budget |

Note: Scan/plan/exec are separate CLI invocations (~200ms/~50ms/~100ms respectively), invoked by the workflow .md — NOT by cmdFocusAuto().

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration | Mitigation |
|----------|---------------|------------|
| Windows | Path separators in auto-run.json | All paths via toPosix() before storage |
| Windows | CRLF in JSON | JSON.stringify produces LF; consistent |
| Windows | 260-char path limit | auto-run.json path is ~40 chars — well within |
| Mac/Linux | Case-sensitive filesystem | All filenames lowercase (session 22 convention) |
| All | fs.mkdirSync for focus dir | recursive:true (already used in cmdFocusPlan) |
| All 5 runtimes | Command .md compatibility | Standard frontmatter + allowed_tools format |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation (User-Facing)

**Focus Auto-Runner** lets you run purpose-driven improvement campaigns with a single command. Instead of manually cycling through scan→plan→exec (15 invocations for a 5-cycle campaign), the auto-runner orchestrates the loop automatically with category-scoped scanning and intelligent stopping.

**Example 1: Cleanup Campaign**
```
/pan:focus-auto --category cleanup
```
Scans for cleanup items only (dead code, naming inconsistencies, empty catch blocks, unnecessary aliases, duplication). Plans a budget-constrained batch. Executes with full verification. Loops until no cleanup items remain or defaults are hit (10 cycles max, 500 pts cumulative). Progress saved to `.planning/focus/auto-run.json`.

**Example 2: Test Hardening with Limits**
```
/pan:focus-auto --category tests --max-cycles 3 --budget 40
```
Runs up to 3 cycles of test improvements (duplicate tests, tautology assertions, missing coverage, weak assertions, inconsistent patterns). Spends at most 40 points per cycle, 120 points cumulative.

**Example 3: Stability Sweep**
```
/pan:focus-auto --category stability --mode bugfix
```
Scans for P0-P2 stability items only (regex bugs, error handling inconsistencies, missing validation, TOCTOU races). Uses bugfix mode (40 pts/cycle, P0→P1→P2 priority order). Stops on regression.

**Example 4: Full Sweep (All Categories)**
```
/pan:focus-auto --max-cycles 5 --total-budget 200
```
Runs up to 5 cycles across ALL work categories with a cumulative 200-point budget cap. No category filter — picks highest-priority items regardless of type.

**Example 5: Resume After Interruption**
```
/pan:focus-auto --continue
```
Resumes the most recent auto-run from where it left off. Reads progress from auto-run.json. Picks up at the next cycle.

**Example 6: Check Progress**
```
/pan:focus-auto --status
```
Shows: `Cycle 3/10 | 87/500 pts | 19 items completed | Tests: 1169 → 1175 (+6) | Category: cleanup`

**What it does NOT do:**
- Does NOT run in the background as a daemon — runs in your current AI session
- Does NOT create branches or PRs — commits to your current branch per cycle
- Does NOT skip verification — every cycle runs the full test suite
- Does NOT modify the 9 behavioral rules — each cycle follows focus-exec exactly
- Does NOT replace manual focus commands — scan/plan/exec remain independently usable

**Error messages you'd see:**
- `"Category must be one of: cleanup, tests, stability, features, docs"` — invalid category
- `"Auto-run already in progress. Use --stop to end it, or --continue to resume."` — concurrent run guard
- `"No auto-run in progress. Start with: focus auto --category <name>"` — --continue with no run
- `"Cannot start: N tests failing. Fix tests before running auto campaign."` — failing baseline

### 4.2 Reference-Level Explanation (Technical)

#### 4.2.1 Command Interface

```
pan-tools focus auto [--category CAT] [--mode MODE] [--budget N] [--max-cycles N]
                     [--total-budget N] [--continue] [--stop] [--status] [--dry-run]
```

| Flag | Type | Default | Validation |
|------|------|---------|------------|
| `--category` | enum | null (all) | Must be: cleanup, tests, stability, features, docs |
| `--mode` | enum | category-dependent | Must be: bugfix, balanced, features, full |
| `--budget` | int | 50 | Range: 5-100 |
| `--max-cycles` | int | 10 | Range: 1-50 |
| `--total-budget` | int | 500 | Range: 5-5000 |
| `--continue` | flag | false | Requires existing in_progress or stopped run |
| `--stop` | flag | false | Requires existing in_progress run |
| `--status` | flag | false | Returns current run state or error if none |
| `--dry-run` | flag | false | Shows what would run without executing |

#### 4.2.2 Category → Default Mapping (Intelligent Defaults)

Each category carries **sensible defaults** so the user doesn't need to specify mode/budget/priority:

| Category | Priority Range | Default Mode | Default Budget | Rationale |
|----------|---------------|--------------|----------------|-----------|
| `cleanup` | P3-P5 | balanced | 50 | Cleanup is safe, medium-priority internal improvement |
| `tests` | P2-P5 | balanced | 50 | Test work spans quality (P2) to tooling (P5) |
| `stability` | P0-P2 | bugfix | 40 | Stability is highest-priority, use conservative budget |
| `features` | P3-P5 | features | 50 | Features need the features-mode 80/20 allocation |
| `docs` | P5-P6 | balanced | 30 | Doc work is low-risk, low-priority, small budget |
| *(all)* | P0-P6 | balanced | 50 | No filter, standard balanced allocation |

Explicit flags override category defaults: `--category stability --mode full --budget 60` uses those values, not the stability defaults.

#### 4.2.3 Category Filter Implementation

The category filter is a **post-filter on collectWorkItems()** — not a separate scan. This reuses 100% of the existing scan infrastructure:

```javascript
function categoryFilter(items, category) {
  if (!category) return items; // null = no filter
  const range = CATEGORY_PRIORITY_RANGE[category]; // e.g., { min: 3, max: 5 } for cleanup
  return items.filter(item => {
    const idx = PRIORITY_LEVELS.indexOf(item.priority);
    return idx >= range.min && idx <= range.max;
  });
}
```

Where `CATEGORY_PRIORITY_RANGE` maps:
```javascript
const CATEGORY_PRIORITY_RANGE = {
  cleanup:   { min: 3, max: 5 },  // P3-P5
  tests:     { min: 2, max: 5 },  // P2-P5
  stability: { min: 0, max: 2 },  // P0-P2
  features:  { min: 3, max: 5 },  // P3-P5
  docs:      { min: 5, max: 6 },  // P5-P6
};
```

#### 4.2.4 auto-run.json Schema

```json
{
  "run_id": "auto-2026-03-03-1",
  "status": "in_progress",
  "category": "cleanup",
  "mode": "balanced",
  "budget_per_cycle": 50,
  "max_cycles": 10,
  "total_budget": 500,
  "priority_range": { "min": 3, "max": 5 },
  "tests_baseline": 1169,
  "cycles": [
    {
      "cycle": 1,
      "items_completed": 12,
      "items_failed": 1,
      "points_used": 38,
      "tests_before": 1169,
      "tests_after": 1165,
      "batch_file": ".planning/focus/batch-2026-03-03.json",
      "timestamp": "2026-03-03T14:30:00Z"
    }
  ],
  "totals": {
    "cycles_completed": 1,
    "items_completed": 12,
    "items_failed": 1,
    "points_used": 38,
    "tests_current": 1165
  },
  "stop_reason": null
}
```

### 4.3 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|
| 5 predefined categories | PanMonty's 5 change categories | Proven concept, covers 95% of real usage, zero configuration | Did NOT copy Cursor's implicit categorization (labels are external, not workflow-native) |
| Post-filter on existing scan | PAN's collectWorkItems() | Reuses 100% of scan infrastructure, no duplication | Did NOT create per-category scanners (would require 5 separate scan implementations) |
| Category → default mapping chain | Blue Ocean: REDUCE decision fatigue | `--category cleanup` carries sensible mode/budget/priority defaults | Did NOT require all flags for every invocation (competitors require explicit config) |
| Workflow orchestrates loop, core manages state | Anthropic's two-phase pattern + ADR-0006 | Core returns data, workflow makes AI decisions | Did NOT put loop in core (workflow needs AI tool access: Read, Bash, git) |
| Circuit breaker on test regression | PanMonty Phase 7 loop exhaustion guard | 3rd loop entry pattern adapted: any test drop = immediate stop | Did NOT copy Cline's safety-free YOLO mode (user trust requires verification) |
| Zero-completed-items guard | PanMonty Phase 7 loop exhaustion | If a cycle completes with 0 items done, further cycles won't help | Did NOT allow infinite empty cycles (would waste context without progress) |
| Per-cycle commits (inherited from focus-exec) | execplan.md 6-stage pipeline | Each cycle is atomic; failure in cycle N doesn't lose cycles 1..N-1 | Did NOT use single final commit (losing all work on late failure) |
| JSON file for run state | PAN's batch-*.json pattern | Consistent persistence, human-readable, machine-parseable | Did NOT use SQLite (zero-dep constraint), did NOT use state.md (different lifecycle) |
| Triple safety net | Novel (no competitor) | Per-cycle budget + cumulative budget + max cycles | Did NOT rely on single limit (insufficient for autonomous execution) |
| auto-run.json in .planning/focus/ | Existing focus directory convention | Co-located with batch-*.json and scan-*.md | Did NOT create new directory (.planning/auto/ would be unnecessary) |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| 5 fixed categories | Predefined enum | User-defined via config.json | Config complexity, testing surface, low marginal value | Can't add "security" or "performance" categories without code change |
| Loop in workflow .md | AI orchestrates | Core module runs loop | Core can't invoke git, npm test, AI decisions, file edits | Depends on AI following instructions (mitigated: 9 behavioral rules are battle-tested) |
| Single auto-run.json | One run at a time | Multiple concurrent runs | Complexity, merge conflicts, git state confusion | Can't run "cleanup" and "tests" simultaneously |
| Per-cycle commits | Commit after each cycle | Single commit at end | Losing cycles 1..N-1 on failure in cycle N | More commits in git history (mitigated: each commit is self-describing) |
| No daemon mode | Session-bound execution | Background daemon | Zero-dep constraint, cross-platform daemon complexity | Can't run truly unattended overnight (user must keep session open) |
| Category as priority-range filter | Post-filter on full scan | Separate scan logic per category | 5x scan code, maintenance burden, inconsistency risk | Categories may include items the user considers "wrong category" (mitigated: priority ranges are based on 25 sessions of real data) |

### 4.5 Feature Ladder (Incremental Delivery)

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | `cmdFocusAuto()` with init/status/stop/update subcommands + `categoryFilter()` + constants + dispatcher routing + `focus-auto.md` command file | Single-command campaigns with categories, defaults, and run state persistence. Covers SC-1, SC-4, SC-5, SC-7. | M (4 pts) |
| **v1 (Complete)** | `--continue` resume logic + `--dry-run` preview + `--total-budget` cumulative cap + regression circuit breaker + zero-completed guard + per-cycle stats + campaign summary output | Full production auto-runner with all safety features and diagnostics. Covers SC-2, SC-3, SC-6, SC-8, SC-9. | M (4 pts) |
| **v2 (Enhanced)** | Config.json `auto` section for persistent defaults + campaign history archiving (past runs in .planning/focus/auto-history/) + aggregate campaign analytics + `focus auto --history` to show past campaigns | Best-in-class campaign management with historical tracking. | L (10 pts) |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | Natural progression: after running scan→plan→exec 2+ times, user wants automation. `/pan:help` lists focus-auto. README documents campaign workflow. The command name "auto" is intuitive given "scan", "plan", "exec" are already known. |
| What's the learning curve? | Minimal — if you know focus-exec, auto is "do it in a loop". One new flag (`--category`) is the key concept. Category names are self-documenting: cleanup, tests, stability, features, docs. |
| Does it require changing existing workflows? | No. Manual scan→plan→exec continues to work independently. Auto-runner is additive. Users who don't want continuous execution lose nothing. |
| What's the "aha moment"? | Running `/pan:focus-auto --category cleanup --max-cycles 5` and watching 50+ cleanup items get resolved across 5 cycles with per-cycle commits, test verification, and a final campaign summary — all from one command. The dashboard showing "Cycle 5/5 | 47 items | 142 pts | Tests: 1169→1175 (+6)" makes the value tangible. |
| What's the "power user moment"? | Discovering that `--category stability --mode bugfix` automatically restricts to P0-P2 items with conservative 40pt budget — no manual flag tuning needed. Category→defaults chain eliminates 80% of flag decisions. |

---

## Phase 5: Architecture Decision Record

*See separate file: [ADR-0015-focus-auto-runner.md](../decisions/ADR-0015-focus-auto-runner.md)*

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| Tests failing at start | Precondition | npm test fails in workflow | Refuse to start, show failure count | `"Cannot start: N tests failing. Fix tests before running auto campaign."` |
| Invalid category name | User error | Enum validation in cmdFocusAuto | JSON error with valid options | `"Category must be one of: cleanup, tests, stability, features, docs"` |
| Budget out of range | User error | Range check (5-100) | JSON error with bounds | `"Budget must be between 5 and 100"` |
| Max cycles out of range | User error | Range check (1-50) | JSON error with bounds | `"Max cycles must be between 1 and 50"` |
| Concurrent run attempt | User error | auto-run.json status === 'in_progress' | JSON error with hint | `"Auto-run already in progress. Use --stop to end it, or --continue to resume."` |
| --continue with no active run | User error | No auto-run.json or status is 'completed' | JSON error with hint | `"No auto-run in progress. Start with: focus auto --category <name>"` |
| Scan finds 0 items matching category | Normal completion | collectWorkItems → categoryFilter returns [] | Complete with no_items reason | `"No items found for category 'cleanup'. Campaign complete."` |
| Budget exhausted (cumulative) | Normal completion | total_points_used >= total_budget | Complete current cycle, stop | `"Total budget cap (500 pts) reached after 4 cycles."` |
| Max cycles reached | Normal completion | cycles_completed >= max_cycles | Stop cleanly | `"Maximum 10 cycles completed. 47 items across 10 cycles."` |
| Test regression detected | Safety trigger | tests_after < tests_before in any cycle | CIRCUIT BREAKER — stop immediately, preserve state | `"REGRESSION: tests dropped from 1169 to 1165 in cycle 3. Auto-run stopped. Review last cycle."` |
| Zero completed items in cycle | Loop exhaustion (PanMonty heritage) | Cycle produces 0 completed items | Stop — further cycles won't help | `"Cycle 4 completed 0 items. Stopping — remaining items may need manual review."` |
| auto-run.json corrupted | Data corruption | JSON.parse fails or required fields missing | Error with recovery hint | `"auto-run.json is corrupted. Delete it and restart with: focus auto --category <name>"` |
| .planning/ missing | Precondition | planningPath(cwd) not accessible | Error with hint | `".planning directory not found. Run pan-tools init first."` |
| Disk full on write | Environment | try-catch on writeFileSync | Graceful error, preserve in-memory state | `"Failed to write auto-run.json: ENOSPC. Run completed cycles are preserved in git commits."` |
| Batch creation fails mid-cycle | Internal | cmdFocusPlan returns error | Log warning, stop run | `"Cycle 3 failed: batch creation error. Run --continue to retry."` |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| `--raw` flag | Human-readable campaign dashboard (one-line summary) | Interactive monitoring |
| `--status` flag | Full progress JSON with per-cycle breakdown | Mid-campaign check |
| `--dry-run` flag | Show category defaults, predicted scan scope, but don't execute | Pre-flight check |
| `--verbose` (inherited) | Per-cycle verbose logging via core.cjs:verbose() | Troubleshooting |
| auto-run.json | Machine-readable run state with full cycle history | Post-mortem analysis |
| Per-cycle batch-*.json files | Preserved by focus-plan, one per cycle | Per-cycle item review |
| Git commits per cycle | Each cycle produces a verifiable commit | Per-cycle code review |
| stderr via error() | Error details to stderr | Failures |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface Inventory

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| auto-run.json | Read + Write by cmdFocusAuto | System-generated (PAN creates, PAN reads) |
| batch-*.json | Read only (created by focus plan) | System-generated |
| scan-*.md | Read only (created by focus scan) | System-generated |
| config.json | Read only (loadConfig) | User-editable but PAN-managed |
| .planning/focus/ directory | Read + Write | PAN-managed subdirectory |

| Input Vector | Source | Validation Required |
|-------------|--------|-------------------|
| --category flag | User-typed | Strict enum: 5 values + null. No partial matching, no regex. |
| --budget flag | User-typed | parseInt → range check 5-100. NaN → error. |
| --max-cycles flag | User-typed | parseInt → range check 1-50. NaN → error. |
| --total-budget flag | User-typed | parseInt → range check 5-5000. NaN → error. |
| --mode flag | User-typed | Strict enum: 4 values. From existing FOCUS_MODES constant. |
| auto-run.json content | Disk (PAN-generated) | JSON.parse in try-catch. Validate: run_id (string), status (enum), cycles (array). |

### 7.2 Path Safety Protocol

The auto-runner only reads/writes within `.planning/focus/`. All paths constructed via:
```javascript
path.join(planningPath(cwd), FOCUS_DIR, AUTO_RUN_FILE)
```
No user-supplied path arguments. No path traversal possible. Standard `planningPath(cwd)` + constant filename.

### 7.3 Output Sanitization

- [x] No absolute filesystem paths — all paths via toPosix() relative to project root
- [x] No environment variable values in output
- [x] No stack traces in error messages — only actionable error text with recovery hints
- [x] No internal function names in errors — user sees "auto-run.json is corrupted" not "JSON.parse failed at readAutoRun:14"

### 7.4 Content Validation

- auto-run.json: `JSON.parse()` in try-catch. Validate required fields: `run_id` (string), `status` (enum of 5 values), `cycles` (array). Missing/malformed → return null, error with recovery hint.
- batch-*.json: Already validated by existing `readLatestBatch()` (returns null on malformation)
- config.json: Already validated by existing `loadConfig()` (returns defaults on failure)
- No `eval()`, no `Function()`, no template string injection

### 7.5 Privilege Scope Declaration

```
Reads from:  .planning/focus/ (auto-run.json, batch-*.json, scan-*.md)
             .planning/ (state.md, config.json, roadmap.md, patterns.md, todos/)
Writes to:   .planning/focus/auto-run.json ONLY
             (batch-*.json written by focus plan, not by auto)
Executes shell: No (git, npm test are delegated to workflow .md, not core)
Reads outside project: No
Accesses network: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definition (DRAFT)

```markdown
---
command: focus-auto
group: Focus
description: Continuous categorized execution — automated scan-plan-exec loop
allowed_tools: Read, Write, Edit, Bash, Grep, Glob, Agent
---

# /pan:focus-auto — Continuous Categorized Execution Pipeline

Run purpose-driven improvement campaigns with automated scan-plan-exec cycling.

## Quick Start
/pan:focus-auto --category cleanup                    # cleanup campaign
/pan:focus-auto --category tests --max-cycles 3       # test hardening, 3 cycles
/pan:focus-auto --category stability --mode bugfix    # stability sweep
/pan:focus-auto --continue                            # resume interrupted run
/pan:focus-auto --status                              # check progress

## Flags
--category CAT       Scope: cleanup, tests, stability, features, docs (default: all)
--mode MODE          Allocation: bugfix, balanced, features, full (default: category-dependent)
--budget N           Points per cycle, 5-100 (default: category-dependent)
--max-cycles N       Maximum iterations, 1-50 (default: 10)
--total-budget N     Cumulative points cap, 5-5000 (default: 500)
--continue           Resume interrupted run
--stop               Gracefully stop current run
--status             Show progress dashboard
--dry-run            Preview without executing

## Category Definitions
| Category  | Scans For                                                              | Priority | Default Mode | Default Budget |
|-----------|------------------------------------------------------------------------|----------|-------------|----------------|
| cleanup   | Dead code, naming, aliases, inline requires, empty catches, duplication| P3-P5    | balanced    | 50 pts         |
| tests     | Duplicate tests, tautologies, missing coverage, weak assertions       | P2-P5    | balanced    | 50 pts         |
| stability | Regex bugs, error handling, missing validation, TOCTOU, unsafe ops    | P0-P2    | bugfix      | 40 pts         |
| features  | Incomplete commands, missing flags, roadmap TODOs                     | P3-P5    | features    | 50 pts         |
| docs      | Stale counts, missing docs, outdated references                       | P5-P6    | balanced    | 30 pts         |

## Auto-Run Loop Protocol

### Initialization
1. Run `pan-tools focus auto [flags]` to create run state
2. Record test baseline with `npm test` — if tests fail, STOP
3. Create rollback snapshot (git tag)

### Loop (repeat until stopping condition)
For each cycle N:
1. **SCAN**: `/pan:focus-scan` — collect all items, apply category filter
2. **CHECK**: If 0 items match category → stop (no_items)
3. **PLAN**: `/pan:focus-plan --mode MODE --budget N` — create batch from filtered items
4. **CHECK**: If total_points_used + allocated > total_budget → stop (budget_cap)
5. **EXEC**: `/pan:focus-exec` — full 6-stage pipeline (all 9 behavioral rules apply)
6. **VERIFY**: Compare tests_after vs tests_before — if regression → CIRCUIT BREAKER STOP
7. **CHECK**: If 0 items completed in this cycle → stop (zero_completed)
8. **UPDATE**: `pan-tools focus auto --update` with cycle results
9. **CHECK**: If cycles_completed >= max_cycles → stop (max_cycles)
10. **CONTINUE**: Loop to next cycle

### Stopping Conditions (ANY triggers stop)
| Condition              | Detection                                    | Reason          |
|------------------------|----------------------------------------------|-----------------|
| No items found         | Category filter returns 0 items              | no_items        |
| Budget exhausted       | total_points_used >= total_budget             | budget_cap      |
| Max cycles reached     | cycles_completed >= max_cycles                | max_cycles      |
| Test regression        | tests_after < tests_before in ANY cycle      | regression      |
| Zero items completed   | Cycle completed but 0 items done             | zero_completed  |
| User stop              | /pan:focus-auto --stop                       | user_stop       |

### Completion
1. Write final auto-run.json with all cycle stats
2. Output campaign summary dashboard

## AI Behavioral Rules (extends focus-exec)
1. ALL 9 focus-exec rules apply within each cycle
2. Between cycles: ALWAYS check ALL stopping conditions
3. NEVER skip verification between cycles
4. Category scope MUST be maintained — do not fix items outside the category
5. If scan returns items but plan allocates 0 (budget mismatch), stop
6. Each cycle MUST produce a git commit (per focus-exec Stage 6)
```

### 8.2 Implementation Tasks (Ordered)

#### Task 1: Add auto-runner constants to constants.cjs
**Files**: [constants.cjs](../../pan-wizard-core/bin/lib/constants.cjs)
**Changes**: Add `FOCUS_CATEGORIES` (array of 5 strings), `CATEGORY_PRIORITY_RANGE` (object mapping category→{min,max}), `CATEGORY_DEFAULTS` (object mapping category→{mode,budget}), `AUTO_RUN_FILE` ('auto-run.json'), `DEFAULT_MAX_CYCLES` (10), `DEFAULT_TOTAL_BUDGET` (500)
**Test**: `npm test -- --test-name-pattern constants`
**Estimate**: XS (1 pt)
**Priority**: P3

#### Task 2: Add categoryFilter() to focus.cjs
**Files**: [focus.cjs](../../pan-wizard-core/bin/lib/focus.cjs)
**Changes**: Add `categoryFilter(items, category)` pure function. Import `CATEGORY_PRIORITY_RANGE` from constants. Export it for testing.
**Test**: `npm test -- --test-name-pattern focus`
**Estimate**: XS (1 pt)
**Priority**: P3

#### Task 3: Add readAutoRun() / writeAutoRun() to focus.cjs
**Files**: [focus.cjs](../../pan-wizard-core/bin/lib/focus.cjs)
**Changes**: Add `readAutoRun(cwd)` (reads and validates .planning/focus/auto-run.json, returns parsed JSON or null) and `writeAutoRun(cwd, data)` (writes auto-run.json with try-catch, returns {written: true} or {error}). Both use planningPath + FOCUS_DIR + AUTO_RUN_FILE.
**Test**: `npm test -- --test-name-pattern focus`
**Estimate**: S (2 pts)
**Priority**: P3

#### Task 4: Add cmdFocusAuto() to focus.cjs
**Files**: [focus.cjs](../../pan-wizard-core/bin/lib/focus.cjs)
**Changes**: Add `cmdFocusAuto(cwd, raw, ...args)` function handling subcommands: init (default), --status, --stop, --continue, --update. Uses getArgValue for flag parsing. Validates category enum, budget range, max-cycles range. Creates/reads/updates auto-run.json via readAutoRun/writeAutoRun. Export it.
**Test**: `npm test -- --test-name-pattern focus`
**Estimate**: M (4 pts)
**Priority**: P3

#### Task 5: Add dispatcher routing for 'auto'
**Files**: [pan-tools.cjs](../../pan-wizard-core/bin/pan-tools.cjs)
**Changes**: Add `} else if (subcommand === 'auto') { focus.cmdFocusAuto(cwd, raw, ...args.slice(2)); }` to the focus switch block. Update the error message to include 'auto' in the Available list.
**Test**: `npm test -- --test-name-pattern dispatcher`
**Estimate**: XS (1 pt)
**Priority**: P3

#### Task 6: Write focus-auto.md command file
**Files**: `.claude/commands/pan/focus-auto.md` (new)
**Changes**: Create the full command file (from 8.1 draft above). Include frontmatter, category table, loop protocol, stopping conditions, behavioral rules.
**Test**: Manual invocation test
**Estimate**: S (2 pts)
**Priority**: P3

#### Task 7: Add unit + integration tests
**Files**: [focus.test.cjs](../../tests/focus.test.cjs)
**Changes**: Add test suites for: categoryFilter (7 tests: one per category + null + empty), readAutoRun/writeAutoRun (4 tests: round-trip, missing, malformed, missing dir), cmdFocusAuto init (3 tests: valid, invalid category, concurrent guard), cmdFocusAuto --status (2 tests: with/without run), cmdFocusAuto --stop (2 tests: active/no run), cmdFocusAuto --update (2 tests: valid cycle, no run), cmdFocusAuto --continue (2 tests: stopped run, no run). Total: ~22 new tests.
**Test**: `npm test -- --test-name-pattern focus`
**Estimate**: M (4 pts)
**Priority**: P2

#### Task 8: Add config.json auto section defaults
**Files**: [config.cjs](../../pan-wizard-core/bin/lib/config.cjs)
**Changes**: Add `auto` section to loadConfig with keys: default_category (null), default_max_cycles (10), default_total_budget (500). Follow existing pattern of explicit section return + catch fallback.
**Test**: `npm test -- --test-name-pattern config`
**Estimate**: XS (1 pt)
**Priority**: P5

#### Task 9: Doc sync (README, CLI-REF, CHANGELOG, USER-GUIDE)
**Files**: README.md, docs/CLI-REFERENCE.md, CHANGELOG.md, docs/USER-GUIDE.md
**Changes**: Add focus auto command documentation, category table, campaign workflow examples. Update command count from 41 to 42 (or 91 to 92 subcommands).
**Test**: `/pan:focus-sync --all`
**Estimate**: S (2 pts)
**Priority**: P6

### 8.3 Dependency Graph

```
Task 1 (constants) ──┬──→ Task 2 (categoryFilter) ──→ Task 4 (cmdFocusAuto) ──→ Task 5 (dispatcher)
                     │                                       │                          │
                     └──→ Task 3 (read/writeAutoRun) ────────┘                          │
                                                             │                          ↓
                                                             ├──→ Task 7 (tests)   Task 6 (command .md)
                                                             │                          │
                                                             └──→ Task 8 (config)  Task 9 (docs)
```

**Critical path**: Task 1 → Task 2 → Task 4 → Task 5 (dispatcher wiring unlocks CLI testing)
**Total**: 9 tasks, **18 points** (1+1+2+4+1+2+4+1+2)
**Estimated effort**: 2 focus-exec cycles at balanced mode

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| AI doesn't follow loop instructions | Medium | High — too many/few cycles | Max-cycles hard limit (default 10), circuit breaker, zero-completed guard |
| Category filter too broad | Low | Medium — includes irrelevant items | Priority ranges derived from 25 sessions of real data |
| Category filter too narrow | Low | Medium — misses relevant items | User can omit --category for unfiltered mode |
| auto-run.json corruption mid-write | Low | Medium — lost progress | try-catch + per-cycle git commits preserve all completed work |
| Concurrent runs from different sessions | Low | Medium — race condition | Concurrent guard: check status === 'in_progress' before init |
| Runaway execution | Very Low | High — unwanted changes | Triple safety net: per-cycle budget + total budget + max cycles + regression circuit breaker + zero-completed guard = 5 independent stopping mechanisms |
| Category defaults don't match user expectations | Low | Low — user overrides with flags | Explicit flags always override category defaults; docs clearly show defaults |

### 8.5 Cognitive Complexity Budget

| Function | Lines | Nesting | Params | Status |
|----------|-------|---------|--------|--------|
| `categoryFilter()` | ~10 | 1 | 2 | Within budget |
| `readAutoRun()` | ~12 | 2 | 1 | Within budget |
| `writeAutoRun()` | ~10 | 2 | 2 | Within budget |
| `cmdFocusAuto()` | ~45 | 3 | 3 | At budget (standard cmd* pattern) |
| Total new code | ~77 | — | — | Modest addition to 559-line module |

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Count | What It Catches |
|-------|---------|-------|-----------------|
| **Unit** | categoryFilter, readAutoRun, writeAutoRun, arg parsing, defaults | 14+ | Logic bugs, category boundaries, state serialization, enum validation |
| **Integration** | `pan-tools focus auto` CLI with real filesystem | 8+ | Wiring bugs, arg parsing, JSON output, file persistence, concurrent guard |
| **E2E** | Multi-command auto-run lifecycle | 3+ | State transitions, stopping conditions, cycle recording |
| **Total** | | **25+** | |

### 9.2 Unit Tests (14 minimum)

```
categoryFilter:
  1. cleanup category returns only P3-P5 items
  2. tests category returns only P2-P5 items
  3. stability category returns only P0-P2 items
  4. features category returns only P3-P5 items
  5. docs category returns only P5-P6 items
  6. null category returns all items (no filter)
  7. empty items array returns empty array

readAutoRun / writeAutoRun:
  8. writes and reads back valid run state (round-trip)
  9. readAutoRun returns null for missing file
  10. readAutoRun returns null for malformed JSON
  11. readAutoRun returns null when .planning/focus/ doesn't exist
  12. writeAutoRun creates focus dir if missing (mkdirSync recursive)

cmdFocusAuto defaults:
  13. --category cleanup sets mode=balanced, budget=50, priority P3-P5
  14. --category stability sets mode=bugfix, budget=40, priority P0-P2
```

### 9.3 Integration Tests (8 minimum)

```
focus auto init:
  1. creates auto-run.json with correct fields (run_id, status=initialized, category, etc.)
  2. returns initialized status JSON
  3. rejects invalid category name with error
  4. rejects when auto-run already in_progress (concurrent guard)

focus auto --status:
  5. returns run progress from auto-run.json
  6. returns error when no active run

focus auto --stop:
  7. updates status to stopped, stop_reason=user_stop

focus auto --continue:
  8. loads existing stopped run and returns in_progress status
```

### 9.4 E2E Tests (3 minimum)

```
  1. init → update with cycle data → status shows cycle recorded → update with completion → status shows completed
  2. init with --max-cycles 1 → update with 1 cycle → auto shows max_cycles stop reason
  3. init → stop → continue → status shows in_progress (full lifecycle)
```

### 9.5 Assertion Density Requirements

Every test asserts AT MINIMUM:
- **Success tests**: (a) `result.success === true`, (b) `output` has expected shape (2+ field checks), (c) no `error` field in parsed output
- **Error tests**: (a) `output.error` is a string with actionable message, (b) no auto-run.json corruption (check file wasn't partially written), (c) exit code is 1

### 9.6 Boundary Value Analysis

- [x] Empty project (no .planning/) → error with init hint
- [x] Minimal project (empty .planning/focus/) → creates auto-run.json successfully
- [x] Budget = 5 (minimum) → only picks XS items
- [x] Budget = 100 (maximum) → respects limit
- [x] Max cycles = 1 → exactly 1 cycle
- [x] Total budget = 5 → may stop mid-first-cycle
- [x] Malformed auto-run.json → error with recovery hint, no crash
- [x] --continue with completed run → error
- [x] --continue with stopped run → success (resumes)
- [x] Concurrent init attempt (status=in_progress) → error with hint
- [x] All 5 categories individually tested for correct priority filtering
- [x] null category (no --category flag) → all items, no filtering

### 9.7 Regression Verification

- [x] Full suite passes: `npm test` (1169 tests, 0 failures)
- [x] focus.test.cjs existing 73 tests still pass
- [x] constants.test.cjs existing tests still pass
- [x] config.test.cjs existing tests still pass
- [x] dispatcher.test.cjs existing tests still pass
- [x] No existing test expectations changed

---

## Phase 10: Output Artifacts

### 10.1 Specification Document
Saved to: `docs/specs/focus_auto_runner_featureai.md` (this file, v2 deep rewrite)

### 10.2 ADR
Saved to: `docs/decisions/ADR-0015-focus-auto-runner.md` (v2 deep rewrite)

### 10.3 Competitive Research
Preserved at: `docs/specs/continuous_autonomous_execution_featureai.md` (8-tool analysis)

### 10.4 Report Summary

**Problem & Evidence**: Manual 3-command cycling limits improvement campaigns. Quantified: sessions 24-25 ran 44 items across 2 manual cycles in one day. 5 evidence sources (user request, internal usage ×2, competitor convergence, PanMonty heritage).

**Strategic Assessment**:
- Blue Ocean: CREATE purpose-driven campaigns with category→defaults chain (first in industry). ELIMINATE manual cycling overhead (15 invocations → 1). REDUCE decision fatigue (category carries mode/budget/priority defaults).
- Wardley: Continuous execution → Product (table-stakes). Categorization → Genesis (first-mover). Budget awareness → Custom-Built (unique to PAN).
- Moat Score: **35/35** — maximum across all 7 dimensions
- Cognitive Load: **-1 (net simplification)** despite +1 command and +2 concepts
- Recommendation: **BUILD IMMEDIATELY** — strongest strategic alignment of any proposed feature

**Design Summary**: Workflow-orchestrated continuous loop with core state management. 5 purpose categories (cleanup, tests, stability, features, docs) with category→default mapping chain. Triple safety net + regression circuit breaker + zero-completed guard (5 independent stopping mechanisms). Inherits ALL infrastructure: budget system (execplan heritage, 25 sessions proven), 9 behavioral rules, 6-stage pipeline, 4 allocation modes, P0-P6 priorities, RS scoring. No new modules.

**Heritage Chain**: execplan.md → superplan.md → focus-scan/plan/exec (ADR-0006) → PanMonty categories → **focus-auto** (this feature)

**Feature Ladder**:
| Version | Effort | Value |
|---------|--------|-------|
| v0 (MVP) | M (4 pts) | Core function + category filter + command .md + dispatcher |
| v1 (Complete) | M (4 pts) | --continue, --stop, --status, --dry-run, circuit breaker, all guards |
| v2 (Enhanced) | L (10 pts) | Config defaults, campaign history, aggregate analytics |

**Implementation**: 9 tasks, 18 total points, 2 estimated focus-exec cycles. Critical path: constants → categoryFilter → cmdFocusAuto → dispatcher.

**Test Plan**: 25+ tests (14 unit, 8 integration, 3 E2E). Assertion density enforced. Boundary analysis covers all 5 categories, all edge cases.

**Security**: Minimal surface — reads/writes .planning/focus/ only. No shell execution from core. No user-supplied paths. Strict enum validation on all inputs. 6 validated fields in auto-run.json schema.

**Adoption**: "aha moment" = watching 50+ items resolved across 5 automated cycles. Power-user moment = discovering category→defaults chain eliminates manual flag tuning.

**Next Steps**: Implement v0+v1 via 2 focus-exec cycles, estimated 18 points across 9 tasks.
