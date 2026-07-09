# Feature Specification: Internal Cleanup & Code Quality Hardening

**Mode:** `--internal` (skip competitive intelligence)
**Date:** 2026-03-03
**Status:** Ready for Implementation

---

## Phase 0: Problem Framing

### 0.1 Problem Statement

PAN Wizard's 15 core modules (4,770+ LOC), CLI dispatcher (735+ LOC), and installer (2,636 LOC) have accumulated technical debt across 23 development sessions. While the codebase is functionally correct (1,180 tests, 0 failures), a deep audit reveals ~170 issues including: duplicate functions across modules, functions exceeding 50-line complexity budgets, missing argument validation in the dispatcher, inconsistent error handling patterns, dead/unused code, and scattered magic numbers. These issues increase maintenance cost, slow onboarding for contributors, and create surface area for future bugs.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Internal audit | 5 parallel scan agents | 170+ issues found across all modules (0 P0, 4 P1, 26 P2, 62 P3, 49 P4, 29 P5) |
| Memory file | MEMORY.md | 23 sessions of accumulated patterns documented; stability patterns applied iteratively but never holistically |
| User request | This conversation | User explicitly asked for "internal cleanup and review and optimisations, scan all code and make sure everything is perfect" |
| Architecture docs | ARCHITECTURE.md | Cognitive complexity budget defined (50 lines, 3 nesting, 4 params) but 12+ functions exceed it |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Dead code removal | New features (this is cleanup only) |
| Function complexity reduction (>50 LOC) | Installer refactoring to strategy pattern (too large, separate effort) |
| Duplicate function consolidation | Test file style unification (test vs it, assert vs assert/strict — cosmetic) |
| Missing argument validation in dispatcher | Performance optimization of file I/O (already fast enough) |
| Magic number extraction to constants | Documentation rewrites (already synced in prior session) |
| Unused import cleanup | |
| Consistent error handling patterns | |

### 0.4 Success Criteria

```
SC-1: All 15 core modules have zero functions exceeding 50 lines
SC-2: Zero duplicate functions across modules (getArchivedPhaseDirs consolidated)
SC-3: All dispatcher argument access has bounds validation (args[idx+1] checked)
SC-4: Zero dead code (unused imports, unused exports, unreachable branches)
SC-5: All magic numbers extracted to constants.cjs
SC-6: No test regressions — 1180/1180 tests still pass
SC-7: No new runtime dependencies added
```

### 0.5 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:health --repair` | Partial | Health checks .planning/ integrity, not code quality — no conflict |
| `/pan:focus-scan` | None | Scans work items, not code quality |
| Tests | None | Tests verify behavior, this fixes internals |

### 0.6 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 41 | 41 | 0 |
| New concepts introduced | 0 | 0 | 0 |
| Score | — | — | simplifies (-1) |

---

## Phase 1: Internal Reconnaissance — Audit Results

### 1.1 Consolidated Issue Inventory

**Total issues found: ~170 across 5 parallel audits**

| Module Group | P1 | P2 | P3 | P4 | P5 | Total |
|-------------|----|----|----|----|----|----|
| Core 1-5 (constants, core, utils, frontmatter, config) | 1 | 5 | 8 | 12 | 1 | 27 |
| Core 6-10 (state, init, phase, roadmap, verify) | 0 | 11 | 28 | 9 | 4 | 52 |
| Core 11-15 (milestone, commands, template, context-budget, focus) | 0 | 6 | 14 | 16 | 7 | 43 |
| Dispatcher + Tests | 2 | 6 | 6 | 8 | 4 | 26 |
| Installer | 1 | 7 | 8 | 5 | 1 | 22 |
| **TOTAL** | **4** | **35** | **64** | **50** | **17** | **170** |

### 1.2 Top Findings by Category

#### A. Dead Code (13 items)
1. **core.cjs:216** — `execFileSync` re-imported inside `execGit()` (already at top, line 7)
2. **milestone.cjs:7** — `isSummaryFile` imported but never used in module
3. **phase.cjs:887** — `phaseName` param in `markPhaseCompleteInRoadmap()` documented as unused
4. **phase.cjs:990** — `totalPhases` param in `updateStateAfterPhaseComplete()` documented as unused
5. **pan-tools.cjs:662** — `core.cjs` re-required inside focus/design case block

#### B. Duplicate Functions (3 items)
1. **core.cjs:388 vs utils.cjs:130** — `getArchivedPhaseDirs()` vs `listArchivedPhaseDirs()` are nearly identical (33 vs 38 LOC)
2. **config.cjs:372-383 vs 528-534** — Standards section parsing logic duplicated
3. **commands.cjs:473-485** — `parseDecisions()` inline instead of module-level like similar helpers

#### C. Functions Exceeding 50 Lines (12 items)
1. **config.cjs:21-106** — `cmdConfigEnsureSection()` — 86 lines
2. **config.cjs:462-554** — `cmdStandardsPhaseTrack()` — 93 lines
3. **core.cjs:123-186** — `loadConfig()` — 64 lines
4. **commands.cjs:320-446** — `cmdCommit()` — 127 lines
5. **commands.cjs:682-754** — `renderHealthReport()` — 73 lines
6. **focus.cjs:234-332** — `allocateBudget()` — 99 lines
7. **frontmatter.cjs:223-295** — `parseMustHavesBlock()` — 73 lines
8. **phase.cjs:536-587** — `renumberDecimalPhases()` — 52 lines
9. **phase.cjs:602-667** — `renumberIntegerPhases()` — 66 lines
10. **verify.cjs:25-119** — `cmdVerifySummary()` — 95 lines
11. **verify.cjs:738-804** — `checkPhaseContents()` — 67 lines
12. **verify.cjs:930-996** — `cmdValidateHealth()` — 67 lines

#### D. Missing Argument Validation (11 dispatcher locations)
- pan-tools.cjs lines 225, 303, 330, 332, 355, 437, 455, 467, 478, 497, 621
- Pattern: `args[1]` or `args[2]` accessed without undefined check before passing to cmd functions

#### E. Magic Numbers Not in Constants (15+ items)
- focus.cjs: budget limits 40/60, ratios 0.6/0.8
- template.cjs: thresholds 2/3/5/6
- context-budget.cjs: CHARS_PER_TOKEN = 4
- commands.cjs: DEFAULT_SENSITIVE_PATTERNS array
- verify.cjs: health status strings ('broken', 'degraded', 'healthy')

#### F. Inconsistent Patterns (20+ items)
- Error handling: some functions use `error()`, others `output({error: ...})`
- State mutation: `cmdStateJson()` rebuilds state as a side effect
- Regex global state: `PHASE_HEADER_RE.lastIndex = 0` reset required in multiple places
- Flag parsing: 44 separate `indexOf()` calls with no shared helper

### 1.3 Convention Enforcement Checklist

- [x] Function naming: `cmd*` for entry points, camelCase for helpers — **CONSISTENT**
- [x] File reads: try-catch pattern — **CONSISTENT (zero existsSync in core)**
- [x] File writes: try-catch wrapping — **CONSISTENT**
- [x] JSON output via `output()` — **CONSISTENT**
- [x] Errors via `error()` — **MOSTLY CONSISTENT** (some use `output({error:...})`)
- [x] Paths through `toPosix()` — **CONSISTENT**
- [x] Module exports at bottom — **CONSISTENT**
- [x] CommonJS format — **CONSISTENT**
- [x] Zero runtime deps — **MAINTAINED**
- [ ] Functions under 50 lines — **12 VIOLATIONS**
- [ ] Max 3 nesting levels — **~8 VIOLATIONS**
- [ ] Max 4 parameters — **~5 VIOLATIONS**

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Decisions |
|--------|-----------|
| **ELIMINATE** | Duplicate functions (getArchivedPhaseDirs x2), dead imports, unused params, re-required modules |
| **REDUCE** | Function complexity (12 functions over 50 lines), dispatcher arg parsing duplication (44 indexOf calls), magic numbers scattered across 6 modules |
| **RAISE** | Code consistency (error handling patterns, argument validation, naming), maintainability (extract helpers, reduce nesting) |
| **CREATE** | `getArgValue()` dispatcher helper, extracted standards parsing helper, consolidated archive search |

### 3.2 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| Context Engineering | No change | 0 |
| Cross-Platform | Stronger (fewer fragile patterns) | 1 |
| Developer Experience | No user-facing change | 0 |
| Zero Dependencies | Maintained | 0 |
| State Persistence | No change | 0 |
| Verification Quality | Stronger (fewer internal bugs possible) | 1 |
| **Maintainability** | **Significantly improved** | **4** |

### 3.3 Strategic Recommendation

**Build.** This is pure internal quality improvement with zero user-facing risk. The codebase is functionally sound (1,180 tests prove it) but 12 functions exceed the project's own 50-line complexity budget, 3 functions are duplicated across modules, and the dispatcher has 11 unvalidated argument accesses. Fixing these reduces maintenance cost, makes the codebase more approachable for contributors, and prevents future bugs from accumulating in complex functions. Delivery should be incremental — dead code first, then duplication, then complexity reduction — each independently testable.

---

## Phase 3.5: Architecture Assessment

### 3.5.1 Feature Type: Core Enhancement
All changes are internal to existing modules. No new commands, agents, workflows, or hooks.

### 3.5.2 Layer Violation Check
- [x] No new commands calling core directly
- [x] No new upward dependencies
- [x] All changes stay within Layer 4 (Core Library) and dispatcher

### 3.5.3 Breaking Change Assessment
| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | **No** |
| Changes file formats? | **No** |
| Changes directory structure? | **No** |
| Changes installer output? | **No** |

**Zero breaking changes. All internal refactoring.**

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

This is an internal cleanup with no user-facing changes. After completion:
- The same 41 commands work identically
- The same 93 CLI subcommands produce identical output
- The same 1,180 tests pass
- The codebase is cleaner, more consistent, and easier to maintain

### 4.2 Feature Ladder

| Version | Scope | Value | Effort |
|---------|-------|-------|--------|
| **v0 (Wave 1)** | Dead code removal + unused imports | Cleaner codebase, smaller surface area | XS (5 pts) |
| **v1 (Wave 2)** | Duplicate consolidation + magic numbers to constants | Single source of truth | S (10 pts) |
| **v2 (Wave 3)** | Complexity reduction (extract helpers from 12 functions) | All functions under 50 lines | M (20 pts) |
| **v3 (Wave 4)** | Dispatcher hardening + pattern consistency | Robust arg validation | S (10 pts) |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0014-internal-cleanup-code-quality.md`

---

## Phase 6: Error Handling Design

### 6.1 Dispatcher Argument Validation

All 11 unvalidated `args[N]` accesses will be protected:

**Pattern (before):**
```js
case 'find-phase': {
  phase.cmdFindPhase(cwd, args[1], raw);
  break;
}
```

**Pattern (after):**
```js
case 'find-phase': {
  if (!args[1]) { error('find-phase requires a phase number'); }
  phase.cmdFindPhase(cwd, args[1], raw);
  break;
}
```

### 6.2 `getArgValue()` Helper

```js
function getArgValue(args, flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}
```

Eliminates 44 inline `indexOf` + `args[idx+1]` patterns.

---

## Phase 7: Security Review

### 7.1 Findings
- No command injection vulnerabilities (all shell calls use `execFileSync` with array args)
- No path traversal vulnerabilities (all paths resolved within project root)
- No sensitive data exposure (output goes through `toPosix()` and never includes absolute paths)
- The duplicate `execFileSync` import in core.cjs is benign (performance only)

### 7.2 Assessment
**No security issues found.** The codebase's security posture is strong. The cleanup items are all maintainability concerns, not security risks.

---

## Phase 8: Implementation Roadmap

### Wave 1: Dead Code Removal (XS — 5 pts, MICRO tier)

#### Task 1.1: Remove duplicate `execFileSync` import in core.cjs
- **File:** `pan-wizard-core/bin/lib/core.cjs`
- **Action:** Remove line 216 `const { execFileSync } = require('child_process');` inside `execGit()` — already imported at line 7
- **Priority:** P2
- **Effort:** XS (1 pt)

#### Task 1.2: Remove duplicate `core.cjs` require in dispatcher
- **File:** `pan-wizard-core/bin/pan-tools.cjs`
- **Action:** Remove line 662 re-require of core.cjs; use top-level import (add `output` to line 168 destructuring)
- **Priority:** P3
- **Effort:** XS (1 pt)

#### Task 1.3: Remove unused `isSummaryFile` import from milestone.cjs
- **File:** `pan-wizard-core/bin/lib/milestone.cjs`
- **Action:** Remove `isSummaryFile` from line 7 destructuring (verify it's truly unused in module first)
- **Priority:** P5
- **Effort:** XS (1 pt)

#### Task 1.4: Clean up unused function parameters
- **File:** `pan-wizard-core/bin/lib/phase.cjs`
- **Action:** Remove or document `phaseName` (line 887) and `totalPhases` (line 990) — if tests pass without them, remove; if callers pass them, keep but prefix with `_`
- **Priority:** P4
- **Effort:** XS (1 pt)

#### Task 1.5: Remove `classifyItemPriority` from focus.cjs module internals
- **File:** `pan-wizard-core/bin/lib/focus.cjs`
- **Action:** Keep export (used by tests), but verify no internal callers — if none, note in comment as test-only export
- **Priority:** P5
- **Effort:** XS (1 pt)

---

### Wave 2: Duplication Consolidation + Constants (S — 10 pts, STANDARD tier)

#### Task 2.1: Consolidate getArchivedPhaseDirs / listArchivedPhaseDirs
- **Files:** `core.cjs`, `utils.cjs`, `commands.cjs`, `phase.cjs`
- **Action:** Keep `getArchivedPhaseDirs()` in core.cjs (it's the canonical location). Remove `listArchivedPhaseDirs()` from utils.cjs. Update any callers of `listArchivedPhaseDirs` to use `getArchivedPhaseDirs`.
- **Priority:** P2
- **Effort:** S (2 pts)

#### Task 2.2: Extract standards section parsing helper
- **File:** `pan-wizard-core/bin/lib/config.cjs`
- **Action:** Extract duplicated checkbox parsing (lines 372-383 and 528-534) into `parseStandardsChecklist(content, standardName)` helper
- **Priority:** P3
- **Effort:** S (2 pts)

#### Task 2.3: Extract magic numbers to constants.cjs
- **Files:** `constants.cjs`, `focus.cjs`, `template.cjs`, `context-budget.cjs`, `commands.cjs`, `verify.cjs`
- **Action:** Extract:
  - `BUDGET_LIMIT_BUGFIX = 40`, `BUDGET_LIMIT_FULL = 60`
  - `STABILITY_RATIO = 0.6`, `FEATURE_RATIO = 0.8`
  - `SIMPLE_TASK_THRESHOLD = 2`, `SIMPLE_FILE_THRESHOLD = 3`, `COMPLEX_TASK_THRESHOLD = 5`, `COMPLEX_FILE_THRESHOLD = 6`
  - `CHARS_PER_TOKEN = 4`
  - `HEALTH_STATUS = { HEALTHY: 'healthy', DEGRADED: 'degraded', BROKEN: 'broken' }`
- **Priority:** P4
- **Effort:** M (4 pts)

#### Task 2.4: Extract `getArgValue()` helper for dispatcher
- **File:** `pan-wizard-core/bin/pan-tools.cjs`
- **Action:** Add `getArgValue(args, flag, defaultVal)` helper at top of file. Replace the most-repeated patterns (start with state/commit/init blocks — ~20 occurrences)
- **Priority:** P3
- **Effort:** S (2 pts)

---

### Wave 3: Complexity Reduction (M — 20 pts, STANDARD tier)

#### Task 3.1: Split `cmdCommit()` (127 LOC)
- **File:** `commands.cjs`
- **Action:** Extract `validateCommitSafety(stagedFiles, config)` and `buildCommitMessage(msg, type, phaseMeta)` helpers. Target: main function under 50 lines.
- **Priority:** P2
- **Effort:** M (4 pts)

#### Task 3.2: Split `allocateBudget()` (99 LOC)
- **File:** `focus.cjs`
- **Action:** Extract mode-specific allocation into `allocateForMode(items, mode, budget)` with per-mode functions. Extract batch dedup to `Set`-based tracking.
- **Priority:** P2
- **Effort:** M (4 pts)

#### Task 3.3: Split `cmdConfigEnsureSection()` (86 LOC)
- **File:** `config.cjs`
- **Action:** Extract `createDefaultConfig(configPath)` and `mergeConfigDefaults(config)` helpers.
- **Priority:** P3
- **Effort:** S (2 pts)

#### Task 3.4: Split `cmdStandardsPhaseTrack()` (93 LOC)
- **File:** `config.cjs`
- **Action:** Extract `scanPlanForStandards(planContent, standards)` helper.
- **Priority:** P3
- **Effort:** S (2 pts)

#### Task 3.5: Split `cmdVerifySummary()` (95 LOC)
- **File:** `verify.cjs`
- **Action:** Extract `verifySummaryFrontmatter(fm)`, `verifySummaryContent(content)`, `verifySummaryCommits(content, cwd)` helpers.
- **Priority:** P3
- **Effort:** M (4 pts)

#### Task 3.6: Split `renumberIntegerPhases()` (66 LOC)
- **File:** `phase.cjs`
- **Action:** Extract sort comparator and rename loop into helpers.
- **Priority:** P3
- **Effort:** S (2 pts)

#### Task 3.7: Split remaining oversized functions
- **Files:** `verify.cjs` (checkPhaseContents, cmdValidateHealth), `frontmatter.cjs` (parseMustHavesBlock), `core.cjs` (loadConfig)
- **Action:** Extract inner loops and validation logic into focused helpers.
- **Priority:** P4
- **Effort:** S (2 pts)

---

### Wave 4: Dispatcher Hardening (S — 10 pts, STANDARD tier)

#### Task 4.1: Add argument validation to 11 dispatcher cases
- **File:** `pan-wizard-core/bin/pan-tools.cjs`
- **Action:** Add `if (!args[N]) { error('command requires <arg>'); }` before each unvalidated `args[N]` access at lines 225, 303, 330, 332, 355, 437, 455, 467, 478, 497, 621.
- **Priority:** P1
- **Effort:** S (2 pts)

#### Task 4.2: Standardize flag parsing with getArgValue
- **File:** `pan-wizard-core/bin/pan-tools.cjs`
- **Action:** Replace remaining `indexOf`+`args[idx+1]` patterns (beyond Task 2.4) with `getArgValue()`.
- **Priority:** P4
- **Effort:** S (2 pts)

#### Task 4.3: Add new tests for dispatcher argument validation
- **File:** `tests/commands.test.cjs` (or new `tests/dispatcher.test.cjs`)
- **Action:** Test each of the 11 cases with missing required args — should return `{error: ...}` not crash.
- **Priority:** P2
- **Effort:** M (4 pts)

#### Task 4.4: Validate getArgValue bounds in existing flag patterns
- **File:** `pan-wizard-core/bin/pan-tools.cjs`
- **Action:** Ensure `getArgValue` returns null when flag is last arg (no value follows). Add test for this.
- **Priority:** P2
- **Effort:** S (2 pts)

---

### Dependency Graph

```
Wave 1 (dead code) → Wave 2 (duplication + constants) → Wave 3 (complexity) → Wave 4 (dispatcher)
   Task 1.1-1.5         Task 2.1-2.4                     Task 3.1-3.7           Task 4.1-4.4
   (independent)        (2.3 after 1.*)                  (after 2.*)            (4.1 after 2.4)
```

### Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Refactored function changes behavior | Low | High | Run full test suite after every extraction |
| Extracted helper has wrong signature | Low | Medium | Write test for helper before extracting |
| Removed "dead" code is actually used | Low | High | Grep entire codebase before removing |
| Constants rename breaks existing test expectations | Low | Medium | Use find-and-replace, run tests |

---

## Phase 9: Test Plan

### 9.1 Test Strategy
Each wave runs the full test suite (1,180 tests) after completion. No test should change expectations — all changes are behavioral no-ops.

### 9.2 New Tests Required

| Wave | New Tests | What They Cover |
|------|-----------|-----------------|
| Wave 1 | 0 | Dead code removal — existing tests cover behavior |
| Wave 2 | 3-5 | `getArgValue()` helper, consolidated `getArchivedPhaseDirs`, `parseStandardsChecklist` |
| Wave 3 | 5-10 | Each extracted helper function (validateCommitSafety, allocateForMode, etc.) |
| Wave 4 | 11+ | Missing-arg error paths for each dispatcher case |

### 9.3 Regression Verification
- [ ] Full suite passes unchanged after each wave
- [ ] No existing test expectations changed
- [ ] Test count only increases (new tests for new helpers)
- [ ] Build hooks compile without error

### 9.4 Assertion Density
Every new test asserts:
- Correct return value shape (JSON with expected keys)
- Correct values for 2+ fields
- No `error` field on success paths
- Actionable `error` message on failure paths

---

## Phase 10: Summary

### Problem & Evidence
PAN Wizard's 15 core modules have accumulated ~170 code quality issues across 23 development sessions. 12 functions exceed the 50-line complexity budget, 3 functions are duplicated across modules, and the dispatcher has 11 unvalidated argument accesses.

### Strategic Assessment
- **Blue Ocean:** ELIMINATE dead code, REDUCE complexity, RAISE consistency, CREATE shared helpers
- **Moat Score:** Maintainability +4, Cross-Platform +1, Verification +1
- **Cognitive Load:** Simplifies (-1) — no new user-facing concepts
- **Recommendation:** Build. Zero user-facing risk, significant maintenance improvement.

### Implementation Summary
- **4 waves**, ordered by risk (lowest first)
- **Wave 1:** Dead code removal (5 tasks, 5 pts, MICRO)
- **Wave 2:** Duplication + constants (4 tasks, 10 pts, STANDARD)
- **Wave 3:** Complexity reduction (7 tasks, 20 pts, STANDARD)
- **Wave 4:** Dispatcher hardening (4 tasks, 10 pts, STANDARD)
- **Total:** 20 tasks, 45 points, ~19-30 new tests
- **Zero breaking changes**

### Next Steps
1. Run `/pan:focus-plan` with this spec as source
2. Execute wave-by-wave with `/pan:focus-exec`
3. Run full test suite after each wave
4. Commit per wave with descriptive messages
