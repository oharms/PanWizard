# Workflow Integration Redesign — featureAI Spec

**Generated:** 2026-03-01
**Status:** Proposed
**Method:** featureAI 10-phase analysis applied to end-to-end workflow redesign
**Goal:** Integrate 14 capabilities from custom skills into PAN Wizard's existing 8 workflows by redesigning flows end-to-end — not bolting features on, but weaving them into natural decision points.

---

## Phase 0: Problem Framing

### Problem Statement

PAN Wizard's current workflow treats all work identically: every task gets the full discuss -> plan -> execute -> verify pipeline regardless of size. A one-line typo fix and a multi-module feature both go through the same research, planning, and verification ceremony. This wastes context tokens, time, and user patience. Meanwhile, capabilities that users naturally need during execution — safety checks before commits, rollback points before risky changes, error pattern learning, execution budgets, dry-run previews — don't exist in the shipped product despite being proven in the custom skills used to build PAN Wizard itself.

### Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Internal dogfooding | 12 development sessions | PanMonty tier system used in every session; MICRO tier skipped 60-80% of ceremony for XS/S items |
| ExecPlan usage | 12 sessions | Capacity budgeting prevented context exhaustion; 40-60 point budgets scoped sessions |
| Commit safety | Session 12 | Accidental install artifacts caught by commit safety checks |
| Session continuity | Every multi-session project | Session start/end preserved context across 12+ sessions |

### Success Criteria

```
SC-1: XS/S tasks complete in 1 pan-tools round-trip (no agent spawn)
SC-2: Execution budget prevents context exhaustion before phase completion
SC-3: Commit safety checks catch sensitive files and unintended deletions
SC-4: Error patterns learned in session N are available in session N+1
SC-5: --dry-run shows what would execute without executing
SC-6: Rollback snapshot exists before every execute-phase
SC-7: All 674+ existing tests pass unchanged
SC-8: Zero new runtime dependencies
```

---

## Phase 1: Current Flow Gaps

### Gap Map — Where Capabilities Are Missing

```
CURRENT FLOW:                    MISSING CAPABILITY:

new-project                      (no gaps — flow is solid)
    │
    ▼
discuss-phase                    (no gaps — flow is solid)
    │
    ▼
plan-phase ─────────────────────── ① No priority/effort metadata in plan.md
    │                               ② No tier classification (all plans = FULL)
    │                               ③ No feature ladder (v0/v1/v2) in plans
    ▼
execute-phase ──────────────────── ④ No rollback snapshot before execution
    │                               ⑤ No capacity budget (executes until done or crash)
    │                               ⑥ No tier-aware execution (XS treated same as XL)
    │                               ⑦ No dry-run preview
    │                               ⑧ No execution modes (bugfix/balanced/features)
    │                               ⑨ No smart test skip for docs-only changes
    ├── execute-plan (subagent) ─── ⑩ No error pattern consultation before execution
    │                               ⑪ No commit safety checks (sensitive/deleted files)
    │                               ⑫ No conventional commit types
    ▼
verify-work                      (no gaps — flow is solid)
    │
    ▼
transition ─────────────────────── ⑬ No session summary generation
    │                               ⑭ No error pattern capture from execution
    ▼
progress ───────────────────────── ⑮ No codebase TODO/FIXME scanning
                                    ⑯ No project-wide health check (only .planning/)
```

### Gap Classification

| # | Gap | Source Skill | Effort | Priority |
|---|-----|-------------|--------|----------|
| ① | Priority/effort in plan.md | SuperPlan | XS | P3 |
| ② | Tier classification | PanMonty | M | P2 |
| ③ | Feature ladder | FeatureAI | S | P4 |
| ④ | Rollback snapshots | PanMonty | S | P1 |
| ⑤ | Capacity budget | ExecPlan | M | P1 |
| ⑥ | Tier-aware execution | PanMonty | L | P2 |
| ⑦ | Dry-run preview | ExecPlan | S | P2 |
| ⑧ | Execution modes | ExecPlan | M | P3 |
| ⑨ | Smart test skip | Commit | XS | P2 |
| ⑩ | Error pattern consultation | PanMonty | S | P3 |
| ⑪ | Commit safety checks | Commit | S | P1 |
| ⑫ | Conventional commit types | Commit | XS | P3 |
| ⑬ | Session summary | Session End | S | P2 |
| ⑭ | Error pattern capture | PanMonty + Session End | S | P2 |
| ⑮ | Codebase TODO scanning | SuperPlan | S | P3 |
| ⑯ | Extended health check | Check | M | P3 |

---

## Phase 2: Redesigned Flow

### Design Principle

**Don't add commands. Enhance existing ones.**

Every integration point below modifies an existing workflow, command, or pan-tools function. No new `/pan:` commands are created. The cognitive load delta is zero — users invoke the same commands; they just work better.

### The Redesigned End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PAN WIZARD v0.3 — REDESIGNED FLOW                   │
│                                                                         │
│  Additions marked with ★                                                │
│  Modifications marked with ◆                                            │
└─────────────────────────────────────────────────────────────────────────┘

/pan:new-project
    │ (unchanged — already solid)
    ▼
/pan:discuss-phase
    │ (unchanged — already solid)
    ▼
/pan:plan-phase <phase>
    │
    ├─ ★ CLASSIFY TIER: Auto-classify each plan into MICRO/STANDARD/FULL
    │   based on: task_count, files_modified count, has checkpoints
    │   → Writes `tier: micro|standard|full` to plan.md frontmatter
    │
    ├─ ★ PRIORITY/EFFORT: Planner assigns priority (P0-P4) and effort
    │   (XS/S/M/L/XL) to each plan
    │   → Writes `priority: P0-P4` and `effort: XS-XL` to frontmatter
    │
    └─ ★ OPTIONAL FEATURE LADDER: For L/XL plans, planner defines
       v0 (MVP) / v1 (complete) / v2 (enhanced) scope
       → Writes `delivery: {v0: "...", v1: "...", v2: "..."}` to frontmatter
    │
    ▼
/pan:execute-phase <phase> [--dry-run] [--budget N] [--mode bugfix|balanced|features]
    │
    ├─ ★ ROLLBACK SNAPSHOT: Before any execution begins
    │   → `git tag pan-rollback-{phase}-{timestamp}`
    │   → Record tag name in execution context
    │
    ├─ ★ DRY-RUN: If --dry-run, show execution plan and exit
    │   → Display: plans by wave, estimated budget, tier distribution
    │   → No agents spawned, no files modified
    │
    ├─ ★ CAPACITY BUDGET: Track cumulative budget consumption
    │   → XS=1, S=2, M=4, L=10, XL=20 points
    │   → Default: 50 points (configurable via --budget)
    │   → Stop when budget exhausted, report remaining items
    │
    ├─ ★ EXECUTION MODE: Reorder plans based on mode
    │   → bugfix: P0 first → P1 → smallest-first
    │   → balanced: P0-P2 (60%) → P3-P4 (40%)
    │   → features: P0 mandatory → P3-P4 (80%) → P1-P2 (20%)
    │   → (default if no --mode: execute in wave order as today)
    │
    ├─ ◆ TIER-AWARE EXECUTION (per plan):
    │   │
    │   ├─ MICRO (XS/S, ≤3 tasks, ≤2 files):
    │   │   → Execute inline in orchestrator (no subagent spawn)
    │   │   → Single commit, skip summary.md ceremony
    │   │   → Minimal state update (advance-plan + commit)
    │   │   → Saves: ~30s agent spawn + 200K context allocation
    │   │
    │   ├─ STANDARD (M, ≤8 tasks):
    │   │   → Spawn pan-executor as today
    │   │   → Skip: research consultation, extensive verification
    │   │   → summary.md required but compact format
    │   │
    │   └─ FULL (L/XL, or autonomous=false):
    │       → Full executor flow as today (unchanged)
    │       → Full summary.md, full verification
    │
    ├─ ◆ EXECUTE-PLAN (subagent, per plan):
    │   │
    │   ├─ ★ CONSULT ERROR PATTERNS: Before starting execution
    │   │   → Read .planning/patterns.md (if exists)
    │   │   → Include relevant patterns in executor prompt
    │   │   → "Known pitfall: toPosix() required for JSON paths"
    │   │
    │   ├─ ◆ COMMIT SAFETY CHECKS: Before every git commit
    │   │   → Check for deleted files: warn if unintentional
    │   │   → Check for sensitive files: .env, .pem, .key, credentials
    │   │   → Block commit if sensitive file detected
    │   │
    │   ├─ ◆ CONVENTIONAL COMMIT TYPE: Auto-assign from task type
    │   │   → auto task → `feat:` or `fix:` based on task name
    │   │   → tdd task → `test:` for RED, `feat:` for GREEN
    │   │   → docs → `docs:`
    │   │   → Stored in summary.md commit_type field
    │   │
    │   └─ ★ SMART TEST SKIP: If plan only modifies .md files
    │       → Skip test verification step
    │       → Mark in summary.md: `test_strategy: skipped_docs_only`
    │
    ├─ ★ BUDGET CHECKPOINT: After each wave completes
    │   → Display: points consumed / budget remaining / plans remaining
    │   → If budget < next plan's effort: stop and report
    │   → Remaining items carry forward to next /pan:execute-phase
    │
    └─ (continue to verification as today)
    │
    ▼
(verify-work — unchanged)
    │
    ▼
/pan:transition (phase complete → next phase)
    │
    ├─ ★ SESSION SUMMARY: Auto-generate session summary
    │   → Append to .planning/session-history.md:
    │     ### {date} — Phase {N}: {name}
    │     - Plans executed: N, Tests: before→after
    │     - Key decisions: [from state.md]
    │     - Duration: {estimated from metrics}
    │   → Keep last 20 entries, trim oldest
    │
    ├─ ★ ERROR PATTERN CAPTURE: If executor reported deviations
    │   → Extract Rule 1-3 deviations from summary.md files
    │   → Append to .planning/patterns.md:
    │     ### PAT-NNN: {short description}
    │     - Wrong: {what was tried}
    │     - Right: {what worked}
    │     - Context: Phase {N}, Plan {M}
    │
    └─ (continue transition as today)
    │
    ▼
/pan:progress
    │
    ├─ ★ CODEBASE TODO SCAN: Extend progress health subcommand
    │   → Scan source files for TODO, FIXME, HACK, STUB
    │   → Add `codebase_todos: N` to health output
    │   → Add to health grade calculation (many TODOs = lower grade)
    │
    └─ ★ EXTENDED HEALTH: validate health --full
       → Run tests (npm test or equivalent)
       → Check build (if build script exists)
       → Cross-reference command count vs documented count
       → Full project integrity, not just .planning/
```

---

## Phase 3: Architecture & Implementation Design

### 3.1 What Changes Where

| Integration | Module | Function | Change Type |
|------------|--------|----------|-------------|
| Tier classification | `phase.cjs` | New: `classifyPlanTier()` | New helper |
| Priority/effort frontmatter | `template.cjs` | `cmdTemplateFill()` | Add optional fields |
| Rollback snapshot | `commands.cjs` | New: `cmdRollbackSnapshot()` | New command |
| Dry-run | `init.cjs` | `cmdInitExecutePhase()` | New `--dry-run` flag |
| Capacity budget | `commands.cjs` | New: `trackBudget()` | New helper |
| Budget in progress | `commands.cjs` | `cmdProgressRender()` | Add budget display |
| Execution modes | `init.cjs` | `cmdInitExecutePhase()` | New `--mode` flag |
| Inline MICRO execution | execute-phase workflow | Orchestrator change | Workflow .md change |
| Error pattern read | execute-plan workflow | Executor context | Workflow .md change |
| Error pattern write | transition workflow | Post-phase summary | Workflow .md change |
| Commit safety | `commands.cjs` | `cmdCommit()` | Add pre-commit checks |
| Conventional types | `commands.cjs` | `cmdCommit()` | Add `--type` flag |
| Smart test skip | execute-plan workflow | Executor decision | Workflow .md change |
| Session summary | transition workflow | Post-transition | Workflow .md change |
| TODO scanning | `commands.cjs` | `cmdListTodos()` | Extend to scan source |
| Extended health | `verify.cjs` | `cmdValidateHealth()` | Add `--full` flag |

### 3.2 New Files

| File | Purpose |
|------|---------|
| `.planning/patterns.md` | Error pattern learning (created on first capture) |
| `.planning/session-history.md` | Session summaries (created on first transition) |

No new core modules. No new commands. No new agents. All changes are extensions of existing code.

### 3.3 New plan.md Frontmatter Fields (All Optional)

```yaml
---
phase: "05-setup"
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified: ["src/auth.ts"]
autonomous: true
must_haves: {...}
# ★ NEW — all optional, backward-compatible
tier: micro          # micro | standard | full (auto-classified)
priority: P2         # P0-P4 (planner assigns)
effort: S            # XS | S | M | L | XL (planner assigns)
delivery:            # Only for L/XL plans
  v0: "Basic auth with username/password"
  v1: "Add OAuth2 + MFA"
  v2: "Add SSO + SAML"
---
```

### 3.4 New Config Options

```json
{
  "budget": {
    "default_points": 50,
    "micro_threshold_tasks": 3,
    "micro_threshold_files": 2
  },
  "commit": {
    "safety_checks": true,
    "conventional_types": true,
    "sensitive_patterns": ["\\.env$", "\\.pem$", "\\.key$", "credentials", "secret"]
  },
  "execution": {
    "default_mode": "wave_order",
    "rollback_snapshots": true,
    "error_pattern_learning": true
  }
}
```

### 3.5 Output Contract Changes

**`pan-tools commit` — Enhanced output:**
```json
{
  "committed": true,
  "hash": "abc1234",
  "reason": "committed",
  "type": "feat",
  "safety_checks": {
    "deleted_files": [],
    "sensitive_files_blocked": []
  }
}
```

**`pan-tools init execute-phase` — Enhanced output:**
```json
{
  ...existing fields...,
  "plans_by_tier": { "micro": 2, "standard": 3, "full": 1 },
  "total_budget_points": 50,
  "estimated_points": 24,
  "execution_mode": "wave_order",
  "rollback_tag": "pan-rollback-05-20260301T120000",
  "dry_run": false
}
```

**`pan-tools progress health` — Enhanced output:**
```json
{
  ...existing fields...,
  "codebase_todos": 3,
  "session_count": 12,
  "patterns_count": 5,
  "budget_remaining": 26
}
```

### 3.6 Backward Compatibility

| Change | Backward Compatible? | Migration |
|--------|---------------------|-----------|
| New plan.md frontmatter fields | Yes — all optional | Old plans work fine, new fields added by planner |
| Enhanced commit output | Yes — new fields added, none removed | Callers that don't check new fields unaffected |
| New config options | Yes — defaults applied if missing | `config-ensure-section` merges defaults |
| `--dry-run` flag | Yes — new flag, ignored if not present | No change to existing invocations |
| `--budget` flag | Yes — new flag, default=50 | No change to existing invocations |
| `--mode` flag | Yes — new flag, default=wave_order | No change to existing invocations |
| patterns.md file | Yes — only read if exists | No file = no patterns consulted |
| session-history.md file | Yes — only written on transition | Created automatically |

**Zero breaking changes. Every enhancement is opt-in or transparent.**

---

## Phase 4: Design Synthesis

### Guide-Level Explanation

PAN Wizard v0.3 introduces **smart execution** — the system automatically classifies work by size and adjusts its behavior accordingly. Small tasks (fix a typo, update a doc) skip the full agent ceremony and execute inline. Medium tasks get the standard executor flow. Large tasks get everything including verification.

You don't need to learn anything new. Run the same commands you always have:

```bash
/pan:execute-phase 5
```

Behind the scenes, PAN now:
1. Creates a git rollback tag before starting
2. Classifies each plan as MICRO/STANDARD/FULL
3. Executes MICRO plans inline (no agent spawn — 10x faster)
4. Tracks a point budget to prevent context exhaustion
5. Checks for sensitive files before every commit
6. Learns from errors and applies patterns in future sessions

Want more control? Three new optional flags:

```bash
/pan:execute-phase 5 --dry-run          # Preview what would execute
/pan:execute-phase 5 --budget 30        # Limit to 30 budget points
/pan:execute-phase 5 --mode bugfix      # Prioritize P0-P1 items
```

### Reference-Level Explanation

#### Tier Classification Algorithm

```
function classifyPlanTier(plan):
  if plan.autonomous == false:
    return 'full'
  if plan.task_count <= 3 AND plan.files_modified.length <= 2:
    return 'micro'
  if plan.task_count <= 8:
    return 'standard'
  return 'full'
```

Overridable: if `tier:` is set in plan.md frontmatter, that takes precedence.

#### Budget Point System

| Effort | Points | Plans per 50-point budget |
|--------|--------|---------------------------|
| XS | 1 | Up to 50 |
| S | 2 | Up to 25 |
| M | 4 | Up to 12 |
| L | 10 | Up to 5 |
| XL | 20 | Up to 2 |

Budget tracking lives in the orchestrator's execution loop, not in pan-tools state. It's ephemeral per `/pan:execute-phase` invocation.

#### MICRO Execution Path

For plans classified as MICRO:
1. Orchestrator reads plan.md directly (no agent spawn)
2. Implements tasks inline using Edit/Write/Bash tools
3. Single atomic commit with conventional type
4. Calls `pan-tools state advance-plan` and `pan-tools commit`
5. Skips summary.md creation (minimal overhead)
6. Total: 1 round-trip vs 3-4 for agent-based execution

This saves ~30 seconds of agent spawn overhead and ~200K tokens of context allocation per MICRO plan.

#### Commit Safety Protocol

Added to `cmdCommit()` before git operations:

```
1. git status --porcelain → parse for deleted files (^D or ^ D)
2. If deleted files AND not --force: return { error: "Deleted files detected", files: [...], hint: "Use --force to confirm" }
3. git diff --cached --name-only → match against config.commit.sensitive_patterns
4. If matches found: return { error: "Sensitive file detected", files: [...], hint: "Remove from staging" }
5. Proceed with commit
```

#### Error Pattern File Format

```markdown
# Error Patterns

### PAT-001: toPosix required for JSON path output
- **Wrong:** `output({ path: path.join(dir, file) })`
- **Right:** `output({ path: toPosix(path.join(dir, file)) })`
- **Context:** Phase 7, Plan 2 — Windows backslash in JSON output
- **Date:** 2026-02-27

### PAT-002: readStateSafe for file reads
- **Wrong:** `if (existsSync(f)) readFileSync(f)` (TOCTOU race)
- **Right:** `try { readFileSync(f) } catch { return null }`
- **Context:** Phase 8, Plan 1 — concurrent access crash
- **Date:** 2026-02-28
```

---

## Phase 5: ADR

```markdown
# ADR-0003: Smart Execution with Tier Classification and Budget Control

## Status
Proposed

## Context
PAN Wizard's execute-phase workflow treats all plans identically — every plan
spawns a full executor agent with 200K context, creates a detailed summary.md,
and goes through the complete verification flow. For XS/S tasks (typo fixes,
doc updates, single-file changes), this overhead takes longer than the actual
work. Meanwhile, there's no mechanism to prevent context exhaustion when a
phase has many plans, and no safety checks before git commits.

Custom skills developed during PAN Wizard's own construction (PanMonty,
ExecPlan, Commit) proved that tier-based execution, capacity budgets, and
commit safety checks significantly improve development velocity and safety.

## Decision
Integrate these capabilities into existing workflows rather than creating
new commands:

1. **Tier classification** (micro/standard/full) based on plan complexity,
   stored in plan.md frontmatter, auto-assigned by planner
2. **MICRO execution** inline in orchestrator (no agent spawn)
3. **Capacity budgets** tracked per execution session (default 50 points)
4. **Rollback snapshots** via git tags before execution
5. **Commit safety** checks for deleted/sensitive files
6. **Error pattern learning** from execution deviations
7. **Session summaries** appended to session-history.md
8. **Dry-run mode** for execution preview

## Consequences

### Positive
- MICRO plans execute 10x faster (skip agent spawn)
- Budget prevents context window exhaustion
- Rollback provides safety net for risky changes
- Commit safety catches sensitive files before they hit git
- Error patterns improve over time (cross-session learning)
- Zero new commands to learn — same UX, better behavior

### Negative
- Tier classification adds complexity to plan-phase workflow
- Budget tracking adds state to orchestrator loop
- patterns.md and session-history.md are new persistent files

### Neutral
- All new features are optional and backward-compatible
- Existing plans without tier/priority/effort work unchanged
- Config defaults preserve current behavior

## Options Considered
1. **New commands** (rejected — adds cognitive load, fragments workflow)
2. **Separate tool** (rejected — loses integration with PAN state)
3. **Enhance existing workflows** (chosen — zero new commands, natural integration)
```

---

## Phase 6: Error Handling

| Failure Mode | Detection | Recovery | User Sees |
|-------------|-----------|----------|-----------|
| Rollback tag creation fails | try-catch on `git tag` | Continue without snapshot, warn user | `"rollback_tag": null, "warning": "..."` |
| Budget exhausted mid-wave | Point check after each plan | Stop, report remaining plans | Budget report with carry-forward list |
| Sensitive file in commit | Pattern match on staged files | Block commit, return error | `"error": "Sensitive file: .env"` |
| patterns.md malformed | try-catch on read/parse | Skip pattern consultation | Silent skip, no crash |
| session-history.md write fails | try-catch on writeFileSync | Log warning, continue | Phase completes, history not written |
| Tier classification wrong | User can set `tier:` in frontmatter | Manual override takes precedence | User control preserved |

---

## Phase 7: Security

| Input | Validation |
|-------|------------|
| `--budget N` | parseInt, clamp 1-200, reject NaN |
| `--mode` | Enum check: wave_order, bugfix, balanced, features |
| `--type` | Enum check: feat, fix, docs, test, refactor, chore |
| Sensitive patterns | Compiled once from config, matched via regex |
| patterns.md content | Read-only, try-catch, never eval'd |
| Rollback tag name | Sanitized via generateSlug() — no shell injection |

No new attack surface. All inputs are CLI flags with strict validation. No new file parsing beyond patterns.md (which is only read, never executed).

---

## Phase 8: Implementation Roadmap

### Wave 1: Foundation (No workflow changes needed)

| Task | Files | Effort | Tests |
|------|-------|--------|-------|
| 1.1 Add `classifyPlanTier()` to phase.cjs | phase.cjs | XS | 3 unit tests |
| 1.2 Add `tier`, `priority`, `effort` to plan.md template | template.cjs | XS | 2 tests |
| 1.3 Add commit safety checks to `cmdCommit()` | commands.cjs | S | 5 tests (deleted, sensitive, force) |
| 1.4 Add `--type` flag to `cmdCommit()` | commands.cjs, pan-tools.cjs | XS | 2 tests |
| 1.5 Add `cmdRollbackSnapshot()` to commands.cjs | commands.cjs, pan-tools.cjs | S | 3 tests |

**Wave 1 total:** 15 tests, ~S-M combined effort

### Wave 2: Execution Enhancements (Workflow changes)

| Task | Files | Effort | Tests |
|------|-------|--------|-------|
| 2.1 Add `--dry-run` to init execute-phase | init.cjs, pan-tools.cjs | S | 3 tests |
| 2.2 Add `--budget` tracking to init execute-phase | init.cjs | S | 3 tests |
| 2.3 Add `--mode` execution ordering | init.cjs | S | 4 tests (one per mode) |
| 2.4 Add `plans_by_tier` to execute-phase init output | init.cjs | XS | 2 tests |
| 2.5 Update execute-phase.md workflow for MICRO inline | workflows/execute-phase.md | M | Manual verification |
| 2.6 Update execute-plan.md for error pattern consultation | workflows/execute-plan.md | S | Manual verification |

**Wave 2 total:** 12 tests + 2 workflow updates, ~M combined effort

### Wave 3: Learning & Reporting

| Task | Files | Effort | Tests |
|------|-------|--------|-------|
| 3.1 Add error pattern write to transition.md | workflows/transition.md | S | Manual verification |
| 3.2 Add session summary to transition.md | workflows/transition.md | S | Manual verification |
| 3.3 Extend `cmdListTodos()` for codebase scanning | commands.cjs | S | 3 tests |
| 3.4 Add `--full` to `cmdValidateHealth()` | verify.cjs | M | 4 tests |
| 3.5 Extend `progress health` with patterns/todos/sessions | commands.cjs | S | 2 tests |
| 3.6 Add budget config defaults to config-ensure-section | config.cjs | XS | 1 test |

**Wave 3 total:** 10 tests + 2 workflow updates, ~M combined effort

### Wave 4: Documentation & Polish

| Task | Files | Effort |
|------|-------|--------|
| 4.1 Update CLI-REFERENCE.md with new flags | docs/CLI-REFERENCE.md | S |
| 4.2 Update USER-GUIDE.md with tier/budget explanation | docs/USER-GUIDE.md | S |
| 4.3 Update ARCHITECTURE.md with patterns.md lifecycle | docs/ARCHITECTURE.md | XS |
| 4.4 Update CHANGELOG.md | CHANGELOG.md | XS |
| 4.5 Create ADR-0003 | docs/decisions/ | XS |

**Wave 4 total:** docs only, ~S combined effort

### Dependency Graph

```
Wave 1 (foundation)
  ├── 1.1 classifyPlanTier
  ├── 1.2 frontmatter fields
  ├── 1.3 commit safety ─────────────────┐
  ├── 1.4 commit types                    │
  └── 1.5 rollback snapshot               │
                                          │
Wave 2 (execution) ← depends on Wave 1   │
  ├── 2.1 dry-run                         │
  ├── 2.2 budget tracking                 │
  ├── 2.3 execution modes                 │
  ├── 2.4 tier output                     │
  ├── 2.5 MICRO execution ← needs 1.1    │
  └── 2.6 error patterns ← needs 3.1     │ (can be parallel with Wave 3)
                                          │
Wave 3 (learning) ← depends on Wave 1    │
  ├── 3.1 pattern write                   │
  ├── 3.2 session summary                 │
  ├── 3.3 TODO scanning                   │
  ├── 3.4 extended health                 │
  ├── 3.5 enhanced progress ← needs 3.3,3.4
  └── 3.6 config defaults                 │
                                          │
Wave 4 (docs) ← depends on Waves 1-3     │
  └── 4.1-4.5 documentation              ◄┘
```

**Waves 2 and 3 can execute in parallel.** Wave 4 depends on all.

---

## Phase 9: Test Plan

### Test Pyramid

| Level | Count | What |
|-------|-------|------|
| Unit | 22 | classifyPlanTier, commit safety, budget math, TODO scanning |
| Integration | 15 | cmdCommit with safety, init execute-phase with flags, progress health |
| Workflow | 4 | MICRO execution path, dry-run, budget exhaustion, mode ordering |
| **Total** | **41** | |

### Key Test Scenarios

**Tier classification:**
- 1 task, 1 file → MICRO
- 5 tasks, 3 files → STANDARD
- 12 tasks, 8 files → FULL
- autonomous=false → always FULL
- Explicit `tier: micro` in frontmatter → MICRO regardless of size

**Commit safety:**
- No deleted, no sensitive → commit succeeds
- Deleted file present → error with file list
- Deleted file + --force → commit proceeds
- .env in staging → blocked, error
- .env.example in staging → not blocked (no match)

**Budget:**
- Budget 50, plan effort S (2pts) → budget 48 remaining
- Budget 3, next plan M (4pts) → stop, report
- Budget 0 → stop immediately
- No --budget flag → default 50

**Execution modes:**
- bugfix mode: P0 plans before P3 plans
- balanced mode: 60/40 split honored
- features mode: P0 mandatory, then P3-P4 first
- wave_order (default): wave 1 before wave 2 (unchanged)

---

## Phase 10: Summary

### What Changes for Users

**Nothing to learn. Same commands, smarter behavior.**

| Before (v0.2) | After (v0.3) |
|---------------|-------------|
| All plans spawn full executor agents | MICRO plans execute inline (10x faster) |
| Execute until done or context crash | Budget stops execution gracefully |
| No safety net | Rollback snapshot before execution |
| No commit checks | Sensitive file detection |
| No learning | Error patterns carry across sessions |
| No session memory | Session summaries preserved |
| No preview | `--dry-run` shows execution plan |
| One execution strategy | `--mode` for bugfix/balanced/features |

### What Changes for Developers

| Area | Changes |
|------|---------|
| Core modules | 6 functions added/modified across 4 modules |
| Workflow .md files | 4 workflows updated |
| New files created at runtime | `patterns.md`, `session-history.md` (both optional) |
| New frontmatter fields | `tier`, `priority`, `effort`, `delivery` (all optional) |
| New config options | `budget.*`, `commit.*`, `execution.*` (all with defaults) |
| New CLI flags | `--dry-run`, `--budget N`, `--mode`, `--type`, `--force` |
| Tests | ~41 new tests |
| Breaking changes | Zero |

### Implementation Effort

| Wave | Effort | Tests | Parallel? |
|------|--------|-------|-----------|
| 1: Foundation | S-M | 15 | No (first) |
| 2: Execution | M | 12 | Yes (with Wave 3) |
| 3: Learning | M | 10 | Yes (with Wave 2) |
| 4: Docs | S | 0 | No (last) |
| **Total** | **~L** | **37+** | 2 parallel waves |

### Next Step

Create superplan from this spec: `/superplan --refresh`
Execute: `/execplan --mode balanced`
