# /featureAI — Lifecycle Completeness: Closing the V-Model Gap

**Generated:** 2026-03-08
**Feature:** Wire test generation, code review, test suite gates, and retrospective into PAN's main lifecycle
**Scope:** 4 new capabilities (P0-P3), 2 new agents, 3 workflow modifications, 1 new command

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard's lifecycle has a critical structural gap: the stages between code execution and goal verification are hollow. Industry-standard SDLCs (V-Model, Agile, DevOps) all include dedicated test generation, code review, and full test suite gates as mandatory stages. PAN has `/pan:phase-tests` for test generation but it's orphaned — no orchestrator calls it. `pan-verifier` checks goals but never runs the actual test suite. There's no code review stage at all. This means PAN ships code that passes per-task `<automated>` checks but has never been reviewed for quality, tested as an integrated suite, or validated against generated test cases. For a tool whose value proposition is "verify-before-ship," this is a significant credibility gap.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| User pain (stated) | This conversation | User discovered `/pan:phase-tests` is orphaned and asked "where in the main processes does it define test cases?" |
| Gap analysis | `link_system_temp.md` | Systematic comparison against 8 industry frameworks identified 6 gaps, 4 in the testing/review lifecycle |
| V-Model violation | Architecture analysis | PAN implements left-side of V (requirements → design → code) but skips right-side (unit → integration → system → UAT) |
| Competitor gap | Devin comparison | Devin runs tests in sandbox and self-reviews code — PAN does neither automatically |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Wire `/pan:phase-tests` into exec-phase → verify-phase chain | CI/CD pipeline integration (separate feature, different domain) |
| Add `pan-reviewer` agent for code review gate | Security scanning / SAST (L effort, separate feature) |
| Add test suite gate to `pan-verifier` | Performance testing (specialized tooling needed) |
| Add `/pan:retro` milestone retrospective | Deployment/release workflow (out of PAN's core domain) |
| Enhance exec-phase workflow to call tests + review | Monitoring/SRE (out of scope by design) |

### 0.4 Success Criteria

```
SC-1: After /pan:exec-phase completes, /pan:phase-tests is auto-invoked (not orphaned)
SC-2: pan-reviewer agent exists and is spawned between execution and verification
SC-3: pan-verifier runs the project's test suite and compares before/after counts
SC-4: /pan:retro generates estimation accuracy and failure pattern analysis
SC-5: No regression in existing 1604+ tests
SC-6: Works identically on Windows, Mac, and Linux
SC-7: All new agents registered in model-profiles.md and settings.json
```

### 0.5 User Stories

```
As a developer using PAN Wizard, I want test generation to happen automatically after execution,
so that I don't have to remember to manually run /pan:phase-tests after every phase.

As a developer, I want an AI code review before verification,
so that quality issues, convention violations, and security anti-patterns are caught
before I consider the phase "done."

As a developer, I want the verifier to actually run my test suite,
so that I know tests pass — not just that goals were theoretically met.

As a project lead, I want a retrospective after each milestone,
so that I can learn from estimation errors, common gap patterns, and process friction.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:phase-tests` | Partial — exists but orphaned | Wire into lifecycle (enhance, don't replace) |
| `/pan:verify-phase` + `pan-verifier` | Partial — add test suite gate | Extend verification workflow |
| `/pan:milestone-audit` + `pan-integration-checker` | None | Retro is process-focused, audit is artifact-focused |
| `/pan:focus-sync` | None | Sync is docs, retro is process |

No full overlap. This enhances existing commands and adds 1 new command + 1 new agent.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 38 | 39 (+retro) | +1 |
| New concepts introduced | 0 | 1 (review gate) | +1 |
| Score | — | — | neutral (0) — review/test are automatic, retro is optional |

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Per-task test execution | Working | pan-executor `<verify>` + `<automated>` blocks | Foundation for test stage |
| Phase-level test generation | Orphaned | `/pan:phase-tests`, `phase-tests.md` workflow | Must wire into lifecycle |
| Goal-backward verification | Working | `pan-verifier`, `verify-phase.md` | Add test suite gate |
| Artifact verification | Working | `verify.cjs` — cmdVerifyArtifacts, cmdVerifyKeyLinks | Unchanged |
| Drift checking | Working | `verify.cjs` — cmdDriftCheck | Could feed into review |
| Milestone audit | Working | `/pan:milestone-audit`, `pan-integration-checker` | Unchanged — retro is additive |
| Health validation | Working | `verify.cjs` — cmdValidateHealth --full (runs npm test) | Pattern to reuse for test gate |

### 1.2 Architecture Scan — Current Lifecycle Flow

```
exec-phase.md workflow steps:
  1. initialize
  2. handle_branching
  3. validate_phase
  4. discover_and_group_plans
  5. execute_waves (spawns pan-executor ×N)
  6. aggregate_results
  7. close_parent_artifacts (decimal phases only)
  8. verify_phase_goal (spawns pan-verifier)     ◄── GAP: no tests, no review before this
  9. update_roadmap
  10. offer_next
```

**Insertion points for new stages:**
- After step 6 (aggregate_results): INSERT test generation + code review
- Enhance step 8 (verify_phase_goal): ADD test suite gate to verifier prompt

### 1.3 Convention Enforcement Checklist

- [x] Functions named `cmd<Module><Action>(cwd, raw, ...args)`
- [x] File reads use `safeReadFile()` pattern
- [x] File writes wrapped in try-catch
- [x] JSON output via `output(data, raw, humanLabel)`
- [x] Errors via `error(message)`
- [x] Paths through `toPosix()`
- [x] Module exports at bottom
- [x] CommonJS only (`.cjs`)
- [x] Zero runtime dependencies

### 1.4 Dependency & Integration Map

```
[Lifecycle Completeness]
    ├── extends: exec-phase.md (add test + review steps)
    ├── extends: verify-phase.md (add test suite gate)
    ├── wires: phase-tests.md (already exists, connect to exec-phase)
    ├── creates: pan-reviewer agent (new)
    ├── creates: /pan:retro command + workflow (new)
    ├── depends on: verify.cjs (cmdValidateHealth pattern for test running)
    ├── depends on: core.cjs (model profiles for new agent)
    ├── depends on: constants.cjs (agent registration)
    └── enables: future security scanning, performance gates
```

---

## Phase 2: Competitive Intelligence

### 2.1 AI Tool Post-Execution Lifecycle Comparison

| Stage | Devin | Copilot WS | Cursor | Cline | PAN (Current) | PAN (Proposed) |
|-------|-------|------------|--------|-------|---------------|----------------|
| **Test Generation** | Auto (writes tests) | Auto (generates) | On request | On request | ORPHANED | Auto after exec |
| **Test Execution** | Auto (runs in sandbox) | No | No | Partial (retry) | Per-task only | Full suite gate |
| **Code Review** | Self-review | PR review | Inline | No | MISSING | pan-reviewer agent |
| **Goal Verification** | No | No | No | No | pan-verifier | Enhanced verifier |
| **Gap Closure** | Retry loop | No | No | Error retry | plan --gaps loop | Unchanged |
| **Retrospective** | No | No | No | No | MISSING | /pan:retro |

### 2.2 Key Insights from Competitors

**Devin's approach:** Runs tests after every code change in its sandbox. If tests fail, it debugs autonomously. This tight loop catches regressions immediately but doesn't have strategic verification (did we achieve the GOAL?).

**Copilot Workspace:** Generates tests alongside code in the PR. Review happens via GitHub's native PR review. No verification of goals.

**What nobody does:** Goal-backward verification + gap closure. PAN is unique here. The opportunity is to ADD the testing/review stages that competitors have WITHOUT losing PAN's unique verification advantage.

### 2.3 Strategic Differentiation

PAN's proposed lifecycle would be the ONLY AI coding tool with ALL of:
1. Parallel research → planning → plan validation
2. Wave-parallel execution with TDD
3. **NEW: Auto test generation**
4. **NEW: AI code review gate**
5. **NEW: Full test suite verification gate**
6. Goal-backward verification (unique to PAN)
7. Gap closure loop
8. **NEW: Process retrospective**

This makes PAN the most complete SDLC coverage of any AI coding tool.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Decision |
|--------|----------|
| **ELIMINATE** | Manual invocation of `/pan:phase-tests` — make it automatic |
| **REDUCE** | Cognitive load of "what do I run next after exec?" — the lifecycle auto-chains |
| **RAISE** | Verification quality — from goal-check-only to goal + test suite + code review |
| **CREATE** | Process learning loop (retro) — no AI coding tool has this |

### 3.2 Wardley Evolution

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                    ↑                ↑
                    │                └── Test execution (well understood)
                    └── AI code review (emerging), Process retrospective (novel)
```

- Test suite gates: Commodity practice — PAN should just have this
- AI code review: Product stage — emerging in Copilot/Devin, PAN can do better
- Process retrospective: Genesis — no AI tool does this, PAN creates category

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| Context Engineering | Review agent has full phase context, not just diff | 5 |
| Cross-Platform | All changes are .md workflows — works everywhere | 5 |
| Developer Experience | Auto-chain reduces manual steps from 4 to 1 | 4 |
| Zero Dependencies | No new deps — review is agent-based, tests use project's runner | 5 |
| State Persistence | Retro reads historical state.md + verification.md | 4 |
| Verification Quality | Three-layer verification (tests + review + goals) | 5 |
| **Total** | | **28/30** |

### 3.4 Strategic Recommendation

**Build — Full scope.** This closes the most embarrassing gap in PAN's lifecycle (an orphaned test command the user literally discovered during review). The implementation is mostly wiring changes to existing workflows plus one new agent and one new command. The competitive differentiation is strong: PAN would become the only AI tool with a complete V-Model right-side (test generation → review → test execution → goal verification). The `/pan:retro` command creates an entirely new category that no competitor offers.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

| Component | Type | Template |
|-----------|------|----------|
| exec-phase.md test/review steps | Workflow enhancement | Edit existing workflow |
| pan-reviewer agent | New Agent | New .md in agents/ |
| verify-phase.md test gate | Workflow enhancement | Edit existing workflow |
| /pan:retro command + workflow | New Command + Workflow | New .md in commands/pan/ + workflows/ |

### 3.5.2 Layer Violation Check

- [x] Workflows invoke agents via Task tool (not direct function calls)
- [x] pan-reviewer reads files via Read/Grep tools (agent-level, not lib-level)
- [x] Test suite execution via Bash `npm test` (not importing test framework)
- [x] Retro reads .planning/ files (Layer 5 access from Layer 2 workflow)
- [x] No upward dependencies

### 3.5.3 Output Contract — `/pan:retro`

```json
{
  "milestone": "string — milestone identifier",
  "phases_completed": "number",
  "phases_with_gaps": "number",
  "gap_closure_phases": "number",
  "estimation_accuracy": {
    "planned_phases": "number",
    "actual_phases": "number — including gap closures",
    "accuracy_percent": "number"
  },
  "common_gap_patterns": [
    { "pattern": "string", "frequency": "number", "phases": ["string"] }
  ],
  "verification_stats": {
    "passed_first_try": "number",
    "required_gaps": "number",
    "required_human": "number"
  },
  "recommendations": ["string — process improvement suggestions"]
}
```

### 3.5.4 State Transition Modeling

No state mutations — all changes are to workflow orchestration. `/pan:retro` is read-only (reads historical files, produces report).

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes existing command JSON output? | No |
| Changes file formats? | No |
| Changes directory structure? | No |
| Changes installer? | Yes — new agent + command must be installed |

### 3.5.6 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Test generation (phase-tests) | ~30s-2min | Agent-based, already exists |
| Code review (pan-reviewer) | ~30s-1min | New agent, reads changed files |
| Test suite execution | ~5-30s | Project-dependent, `npm test` equivalent |
| Retro analysis | < 500ms | CLI, reads .planning/ files |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**Lifecycle Completeness** closes the gap between execution and verification in PAN's workflow.

**Before:** After `/pan:exec-phase`, the verifier checks goals but never runs your tests or reviews the code. You had to manually run `/pan:phase-tests` (and most users didn't know it existed).

**After:** The lifecycle auto-chains:
```
exec-phase → phase-tests (auto) → review (auto) → verify (with test gate)
```

**Example 1 — Normal phase execution:**
```
/pan:exec-phase 3

## Wave 1 Complete
Built authentication module — JWT tokens, login endpoint, middleware.

## Test Generation
Generated 12 tests for phase 3 (unit: 8, integration: 4).
Tests: 145/145 passing (+12 new).

## Code Review
pan-reviewer checked 6 files:
  ✓ Convention compliance
  ✓ Error handling patterns
  ⚠ auth.ts:42 — password compared without constant-time comparison (security)
  ⚠ auth.ts:78 — missing input validation on email format

## Verification
  ✓ Goals: 5/5 success criteria met
  ✓ Tests: 145/145 passing (was 133)
  ✓ Artifacts: all present and wired
  → Phase 3 PASSED
```

**Example 2 — Milestone retrospective:**
```
/pan:retro

## Milestone 1.0 Retrospective

Estimation Accuracy: 85% (planned 8 phases, needed 9 including 1 gap closure)

Common Gap Patterns:
  1. "Missing error handling" — appeared in 3/8 phases
  2. "Integration wiring incomplete" — appeared in 2/8 phases

Verification Stats:
  - Passed first try: 6/8 (75%)
  - Required gap closure: 1/8
  - Required human verification: 1/8

Recommendations:
  1. Add error handling checklist to pan-planner must_haves
  2. Consider integration tests in plan <verify> blocks
```

### 4.2 Reference-Level Explanation

#### 4.2.1 New Lifecycle (exec-phase.md changes)

Insert two new steps between `aggregate_results` and `verify_phase_goal`:

**Step 6.5: generate_tests**
```
After aggregate_results, auto-invoke phase-tests:

1. Record baseline test count: `npm test 2>&1 | tail -5` (or project-specific)
2. Invoke phase-tests workflow with phase number
3. Record new test count
4. Report delta: "Generated N tests (+M from baseline)"

Skip if: --skip-tests flag, or no test runner detected
```

**Step 6.7: code_review**
```
After test generation, spawn pan-reviewer:

1. Collect changed files from executor summaries
2. Spawn pan-reviewer with file list + phase context
3. Reviewer checks: conventions, error handling, security patterns, duplication
4. Report findings with severity levels (error/warning/info)

If ERROR-level findings: present to user, ask "Fix before verification?" or "Continue?"
Skip if: --skip-review flag
```

#### 4.2.2 verify-phase.md changes

Add test suite gate to verifier prompt:

```
Before checking goals, run the project's test suite:
1. Execute: `npm test` (or detected test command from package.json)
2. Parse: total tests, passing, failing
3. Compare against pre-execution baseline (from exec-phase)
4. If tests REGRESS: verification status = gaps_found (test regression)
5. If tests PASS: continue to goal-backward verification
```

#### 4.2.3 pan-reviewer Agent

**Role:** Post-execution code review. Reads changed files from executor summaries, checks quality patterns, reports findings.

**Tools:** Read, Grep, Glob, Bash (read-only — no Edit/Write)

**Checks:**
1. Convention compliance (naming, exports, error handling patterns)
2. Security anti-patterns (eval, unsanitized input, hardcoded secrets)
3. Dead code / unused imports
4. Duplication across changed files
5. Missing error handling (try-catch on fs/network operations)
6. Path safety (toPosix usage, no hardcoded separators)

**Output:** Structured findings with severity levels.

#### 4.2.4 `/pan:retro` Command

**Reads:** `.planning/roadmap.md`, `.planning/state.md`, all `*-verification.md`, all `*-summary.md`

**Analyzes:**
- Phase count (planned vs actual, including gap closures)
- Verification outcomes (passed/gaps/human per phase)
- Common gap patterns (text similarity across gap descriptions)
- Estimation accuracy (planned effort vs actual)
- Time between phases (if timestamps available)

**Output:** Structured JSON report + human-readable summary

### 4.3 Design Decisions

| Decision | Rationale | What We Did NOT Copy |
|----------|-----------|---------------------|
| Auto-chain tests + review | Reduces lifecycle friction from 4 manual commands to 1 | Devin's tight loop (too aggressive — PAN batches at phase level) |
| Review as separate agent | Fresh 200K context, focused on quality | Cursor's inline suggestions (too granular for phase-level review) |
| Test gate in verifier | Single verification pass, not separate command | Copilot WS's PR-based review (PAN isn't PR-centric) |
| --skip-tests/--skip-review flags | User control for small phases or quick iterations | Mandatory gates (too rigid for exploratory work) |

### 4.4 Feature Ladder

| Version | Scope | Value | Effort |
|---------|-------|-------|--------|
| **v0 (MVP)** | Wire phase-tests into exec-phase + test gate in verifier | Tests are no longer orphaned | S (8 pts) |
| **v1 (Complete)** | Add pan-reviewer agent + review step in exec-phase | Full test + review + verify chain | M (16 pts) |
| **v2 (Enhanced)** | Add /pan:retro command + workflow | Process learning loop | M (12 pts) |

---

## Phase 5: Architecture Decision Record

See: `docs/decisions/ADR-0022-lifecycle-completeness.md`

---

## Phase 6: Error Handling & Diagnostics

### 6.1 Failure Mode Analysis

| Failure Mode | Detection | Recovery | User Sees |
|-------------|-----------|----------|-----------|
| No test runner detected | Check package.json scripts | Skip test generation, warn | "No test runner found — skipping test generation" |
| Test generation fails | Agent error/timeout | Continue to verify without tests | "Test generation failed — proceeding to verification" |
| Reviewer finds ERROR-level issues | Structured findings | Pause, present to user | "Code review found N issues — fix before verify?" |
| Test suite regresses | Compare before/after counts | verification status = gaps_found | "Tests regressed: N failing (was 0)" |
| Retro has no historical data | Check for verification.md files | Graceful empty report | "No completed phases found for retrospective" |

### 6.2 Skip Flags

| Flag | Effect | When to Use |
|------|--------|-------------|
| `--skip-tests` | Skip test generation + test gate | Quick iterations, non-code phases |
| `--skip-review` | Skip code review | Trusted/small changes |
| `--fast` | Skip both tests and review | Rapid prototyping |

---

## Phase 7: Security & Threat Model

### 7.1 Attack Surface

| Asset | Access | Trust |
|-------|--------|-------|
| Changed source files | Read (reviewer) | User-controlled |
| Test output | Read (verifier) | System-generated |
| .planning/ files | Read (retro) | System-generated |

Minimal attack surface — all new components are READ-ONLY against existing files. No new file writes except reviewer findings (written to verification.md by verifier).

### 7.2 Reviewer Security

The pan-reviewer agent has **no Edit or Write tools** — it can only read and report. This prevents a compromised agent from modifying source code during "review."

---

## Phase 8: Implementation Roadmap

### 8.1 pan-reviewer Agent Definition (DRAFT)

```markdown
---
name: pan-reviewer
description: Post-execution code review — checks quality, conventions, security patterns
tools: [Read, Grep, Glob, Bash]
color: yellow
---

<purpose>
Review code changes from a completed phase execution. Check for quality issues,
convention violations, security anti-patterns, and duplication. Report findings
with severity levels. Do NOT modify any files — read-only review.
</purpose>

<process>
1. Read executor summary.md files to identify changed/created files
2. Read each changed file
3. Check against quality criteria (below)
4. Produce structured findings report

<quality_checks>
## Convention Compliance
- Functions follow cmd<Module><Action> naming (for core modules)
- Error handling uses error() not console.error/throw
- JSON output uses output() not console.log
- Paths use toPosix() in output
- File reads use safeReadFile/readStateSafe pattern
- File writes wrapped in try-catch
- CommonJS exports at bottom of file

## Security Patterns
- No eval(), Function(), or template string injection
- No hardcoded secrets/tokens/keys
- Input validation on user-provided values
- Path traversal protection (no raw .. in paths)
- No shell injection (execFileSync, not execSync with string)

## Code Quality
- Functions under 50 lines
- Nesting depth under 3 levels
- No unused imports/variables
- No duplicated blocks (>10 lines identical across files)
- Consistent error message style ("X not found" format)

## Missing Patterns
- Async operations without error handling
- File operations without try-catch
- Missing null checks after safeReadFile()
</quality_checks>

<output_format>
## Code Review Report

**Phase:** {phase_number} - {phase_name}
**Files Reviewed:** {count}
**Findings:** {error_count} errors, {warning_count} warnings, {info_count} info

### Errors (must fix)
- `{file}:{line}` — {description}

### Warnings (should fix)
- `{file}:{line}` — {description}

### Info (consider)
- `{file}:{line}` — {description}

### Summary
{1-2 sentence overall assessment}
</output_format>
</process>
```

### 8.2 Implementation Tasks

#### Task 1: Wire phase-tests into exec-phase workflow
**Files:** `pan-wizard-core/workflows/exec-phase.md`
**What:** Add step 6.5 `generate_tests` between `aggregate_results` and `verify_phase_goal`
**Test:** Run exec-phase → verify phase-tests was invoked
**Effort:** S (2 pts)
**Priority:** P0

#### Task 2: Add test suite gate to verify-phase workflow
**Files:** `pan-wizard-core/workflows/verify-phase.md`
**What:** Before goal-backward verification, run test suite and compare counts
**Test:** Verifier reports test counts in verification.md
**Effort:** S (2 pts)
**Priority:** P0

#### Task 3: Add --skip-tests and --skip-review flags to exec-phase
**Files:** `pan-wizard-core/workflows/exec-phase.md`, `commands/pan/exec-phase.md`
**What:** Parse flags, skip steps when set
**Test:** exec-phase --skip-tests skips test generation
**Effort:** XS (1 pt)
**Priority:** P1

#### Task 4: Create pan-reviewer agent
**Files:** `agents/pan-reviewer.md`
**What:** New agent with quality check instructions (see 8.1 draft)
**Test:** Agent exists, registered in model-profiles
**Effort:** S (2 pts)
**Priority:** P1

#### Task 5: Add review step to exec-phase workflow
**Files:** `pan-wizard-core/workflows/exec-phase.md`
**What:** Add step 6.7 `code_review` — spawn pan-reviewer, present findings
**Test:** Review findings appear in exec-phase output
**Effort:** S (2 pts)
**Priority:** P1

#### Task 6: Register pan-reviewer in model profiles + core.cjs
**Files:** `pan-wizard-core/bin/lib/core.cjs`, `pan-wizard-core/references/model-profiles.md`
**What:** Add `'pan-reviewer': { quality: 'sonnet', balanced: 'haiku', budget: 'haiku' }`
**Test:** Model profile resolves correctly
**Effort:** XS (1 pt)
**Priority:** P1

#### Task 7: Create /pan:retro command and workflow
**Files:** `commands/pan/retro.md`, `pan-wizard-core/workflows/retro.md`
**What:** Read historical .planning/ data, analyze patterns, produce report
**Test:** /pan:retro produces structured JSON output
**Effort:** M (4 pts)
**Priority:** P2

#### Task 8: Add retro CLI subcommand to pan-tools.cjs
**Files:** `pan-wizard-core/bin/pan-tools.cjs`, `pan-wizard-core/bin/lib/verify.cjs` (or new module)
**What:** `retro` command that reads roadmap, verification files, produces JSON analysis
**Test:** `pan-tools retro` returns valid JSON
**Effort:** M (4 pts)
**Priority:** P2

#### Task 9: Update installer for new agent + command
**Files:** `bin/install.js`
**What:** Include pan-reviewer.md and retro.md in installation
**Test:** Scenario test verifies files installed
**Effort:** XS (1 pt)
**Priority:** P2

#### Task 10: Tests for new functionality
**Files:** `tests/verify.test.cjs` (test gate), `tests/retro.test.cjs` (new)
**What:** Unit tests for retro analysis, integration tests for test gate
**Test:** All new tests pass, no regressions
**Effort:** S (2 pts)
**Priority:** P2

#### Task 11: Update documentation
**Files:** `README.md`, `docs/USER-GUIDE.md`, `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `docs/CLI-REFERENCE.md`
**What:** Document new agent, new command, updated lifecycle
**Test:** Doc references match reality
**Effort:** S (2 pts)
**Priority:** P3

#### Task 12: Update link_system_temp.md with final lifecycle
**Files:** `link_system_temp.md`
**What:** Replace "MISSING" annotations with actual commands
**Test:** No gaps remain in lifecycle matrix
**Effort:** XS (1 pt)
**Priority:** P3

### 8.3 Dependency Graph

```
Task 1 (wire phase-tests) ─────────────────────┐
Task 2 (test suite gate) ──────────────────────┤
Task 3 (skip flags) ── depends on 1,5 ─────────┤
Task 4 (pan-reviewer agent) ───────────┐       │
Task 5 (review step) ── depends on 4 ──┤       │
Task 6 (model profiles) ── depends on 4 ┤      │
                                        ├──────┤
Task 7 (retro command) ────────────────┐│      │
Task 8 (retro CLI) ── depends on 7 ───┤│      │
Task 9 (installer) ── depends on 4,7 ─┤│      │
Task 10 (tests) ── depends on 1-8 ────┤│      │
Task 11 (docs) ── depends on 1-10 ────┘│      │
Task 12 (link_system) ── depends on 11 ┘      │
```

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Phase-tests fails on project without test runner | Medium | Low | Detect test runner first, skip gracefully |
| Review agent too noisy (many false warnings) | Medium | Medium | Start conservative, tune thresholds |
| Test suite takes too long in verifier | Low | Medium | Add timeout, --skip-tests for large suites |
| Retro analysis on small projects is useless | Low | Low | Require minimum 3 phases for meaningful retro |

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Count | What |
|-------|-------|------|
| Unit | 8+ | Retro analysis functions, test count parsing, finding classification |
| Integration | 6+ | exec-phase with test/review steps, verifier test gate, retro command |
| E2E | 2+ | Full lifecycle with auto-test + review, retro after milestone |

### 9.2 Key Test Cases

1. exec-phase auto-invokes phase-tests after execution
2. exec-phase --skip-tests bypasses test generation
3. exec-phase --skip-review bypasses code review
4. exec-phase --fast bypasses both
5. verifier reports test counts in verification.md
6. verifier sets gaps_found when tests regress
7. pan-reviewer produces structured findings
8. pan-reviewer ERROR findings pause for user
9. /pan:retro with 0 phases returns empty report
10. /pan:retro with 5+ phases produces accuracy stats
11. /pan:retro identifies common gap patterns
12. Full lifecycle: exec → tests → review → verify → passed

---

## Phase 10: Output Artifacts

### 10.1 Documents Created

- **Spec:** `docs/specs/lifecycle_completeness_featureai.md` (this file)
- **ADR:** `docs/decisions/ADR-0022-lifecycle-completeness.md`

### 10.2 Summary

```
## /featureAI Complete — Lifecycle Completeness

### Problem & Evidence
PAN's lifecycle has a V-Model gap: test generation is orphaned, no code review, verifier
doesn't run tests, no retrospective. Evidence: user discovered gap in live session +
systematic gap analysis against 8 industry frameworks.

### Strategic Assessment
- Blue Ocean: ELIMINATE manual test invocation, CREATE review gate + retrospective
- Wardley: Test gates (commodity), AI review (product), retrospective (genesis)
- Moat Score: 28/30 — strongest in verification quality + context engineering
- Cognitive Load: neutral (0) — new stages are automatic
- Recommendation: Build — Full scope

### Design Summary
- Feature Type: 2 workflow enhancements + 1 new agent + 1 new command
- Modules Affected: exec-phase.md, verify-phase.md, core.cjs, pan-tools.cjs
- New: pan-reviewer agent, /pan:retro command
- Breaking Changes: none

### Feature Ladder
- v0 (MVP): Wire phase-tests + test gate — 4 pts
- v1 (Complete): Add pan-reviewer + review step — 6 pts
- v2 (Enhanced): Add /pan:retro — 10 pts

### Implementation
- Tasks: 12 tasks across 4 priority tiers
- Total points: 24 pts
- New files: 4 (agent, command, workflow, tests)
- Modified files: 8 (workflows, core, installer, docs)
- Tests planned: 16+ (unit: 8, integration: 6, e2e: 2)

### Next Step
/superplan → /execplan
```
