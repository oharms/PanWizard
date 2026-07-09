# Feature Spec: `optimize` Category for focus-auto

**featureAI output** · Status: DESIGN · Date: 2025-07-25

---

## Phase 0: Problem Framing

### 0.1 Problem Statement

PAN Wizard's focus-auto currently covers five categories (cleanup, tests, stability, features, docs) but lacks a dedicated category for **code performance and robustness optimization**. Users who want to systematically improve runtime performance, reduce memory allocations, simplify hot paths, or tighten error handling across a codebase must manually hunt for opportunities or misuse the `cleanup` or `stability` categories, which have different scanning heuristics and priority ranges. A purpose-built `optimize` category would provide targeted scan patterns for performance and robustness issues, and — critically — operate in a **convergent loop** where each cycle re-scans to discover new optimization opportunities revealed by previous changes, stopping only when measurable improvement plateaus.

### 0.2 Scope

| In Scope | Out of Scope |
|----------|-------------|
| New `optimize` entry in FOCUS_CATEGORIES | Runtime/language-specific profilers |
| Priority range, default mode, default budget | Benchmark harness infrastructure |
| Optimization-specific scan heuristics | Breaking API changes for performance |
| Convergent-loop stop condition (diminishing returns) | Auto-parallelization or concurrency rewrites |
| Scan pattern catalog for common perf/robustness issues | External dependency upgrades |
| `optimize` support in all 5 runtimes (command is runtime-agnostic) | GPU/WASM-specific optimizations |

### 0.3 Success Criteria

```
SC-1: `optimize` is a valid --category value for focus-auto across all 5 runtimes
SC-2: Existing FOCUS_CATEGORIES consumers (categoryFilter, focusAutoInit, constants) handle `optimize` without regression
SC-3: Scan step detects ≥8 distinct optimization pattern types
SC-4: Convergent-loop logic stops when cycle-over-cycle improvement delta < threshold
SC-5: Unit tests cover: category validation, priority filtering, defaults, diminishing-returns stop condition
SC-6: Documentation updated (CLI-REFERENCE, focus-auto.md, model-profiles.md category table)
SC-7: All existing 1649+ tests continue to pass
```

### 0.4 User Stories

```
As a PAN Wizard user, I want to run `pan:focus-auto --category optimize`
so that my codebase is systematically scanned for performance and robustness
improvements in iterative cycles, instead of manually grepping for N+1 loops
and unguarded operations one file at a time.

As a PAN Wizard user, I want the optimize campaign to automatically stop
when further cycles yield diminishing returns, so that I don't waste budget
on micro-optimizations after the major gains have been captured.
```

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Infrastructure

| Component | File | What it does |
|-----------|------|-------------|
| FOCUS_CATEGORIES | `constants.cjs:126` | Array of valid category names — **add `optimize` here** |
| CATEGORY_PRIORITY_RANGE | `constants.cjs:129-135` | Maps category → `{ min, max }` priority indices |
| CATEGORY_DEFAULTS | `constants.cjs:138-144` | Maps category → `{ mode, budget }` |
| categoryFilter() | `focus.cjs:~640` | Filters work items by category's priority range |
| focusAutoInit() | `focus.cjs:~830` | Validates category, reads defaults, creates run state |
| cmdFocusAuto() | `focus.cjs:~880` | Dispatcher: init/status/stop/update/continue |
| determineStopReason() | `focus.cjs:~790` | Checks regression/budget/max_cycles/zero_completed |
| focus-auto.md | `commands/pan/focus-auto.md` | Command definition with scan heuristics per category |
| focus.test.cjs | `tests/focus.test.cjs` | Unit tests for all focus module exports |

### 1.2 Category Wiring Path

Adding a new category requires touching these locations:

1. **`constants.cjs`** — Add `'optimize'` to `FOCUS_CATEGORIES` array
2. **`constants.cjs`** — Add `optimize` entry to `CATEGORY_PRIORITY_RANGE`
3. **`constants.cjs`** — Add `optimize` entry to `CATEGORY_DEFAULTS`
4. **`focus.cjs`** — `determineStopReason()` — add diminishing-returns check
5. **`focus-auto.md`** — Add optimize to category menu, scan heuristics, category defaults table
6. **`focus.test.cjs`** — Tests for new category filtering, defaults, stop condition
7. **Docs** — CLI-REFERENCE.md, USER-GUIDE.md updates

### 1.3 Runtime Compatibility

The focus system is **runtime-agnostic**. Categories are string constants consumed by `pan-tools` (CommonJS) and command `.md` files. No runtime-specific handling needed — `optimize` works identically across Claude, Codex, Gemini, OpenCode, and GitHub Copilot.

---

## Phase 2: Competitive Analysis

| Tool | Optimization Approach | Strengths | Gaps |
|------|----------------------|-----------|------|
| **SonarQube** | Cognitive complexity, code smells, performance hotspots | Deep static analysis, historical trends | No automated fixing, no iterative loop |
| **ESLint perf rules** | `no-loop-func`, `no-await-in-loop`, `prefer-const` | Fast, integrated in CI | Limited to style rules, no semantic analysis |
| **Deepsource** | Anti-patterns, algorithmic issues | Multi-language, auto-fix suggestions | Per-file, not project-wide campaigns |
| **Sourcery (Python)** | Refactor suggestions, complexity reduction | AI-powered, shows before/after | Python-only, no iterative convergence |
| **Cursor / Copilot refactor** | Single-shot refactoring on selection | Contextual, good for spot fixes | No campaign orchestration, no tracking |

**Differentiation opportunity:** None of these tools offer a **convergent iterative loop** — scan, fix, re-scan, fix again — with automatic diminishing-returns detection. PAN Wizard's `optimize` category would be the first to combine project-wide scan heuristics with a tracked budget-limited convergence loop that discovers cascading optimization opportunities.

---

## Phase 3: Design

### 3.1 Category Parameters

```
Name:           optimize
Priority Range: P1-P4 (min: 1, max: 4)
Default Mode:   balanced
Default Budget:  50 points per cycle
```

**Rationale for P1-P4:**
- P1: Algorithmic disasters (O(n³) where O(n) is possible, unbounded recursion)
- P2: Significant inefficiencies (N+1 operations, synchronous blocking in async paths, repeated full-collection scans)
- P3: Moderate improvements (unnecessary allocations, redundant computations, suboptimal data structures)
- P4: Polish (micro-optimizations, const correctness, minor code tightening)
- Excludes P0 (those are crashes — `stability` handles them) and P5-P6 (those are tooling/docs)

### 3.2 Optimization Scan Heuristics

The `focus-auto.md` command already defines scan heuristics per category in Step 2.1.2. The `optimize` category adds:

| ID | Pattern | What to grep/analyze | Priority | Effort |
|----|---------|---------------------|----------|--------|
| OPT-01 | **N+1 operations** | Loop containing file I/O, DB query, or network call; `readFileSync`/`readdirSync` inside `for`/`forEach`/`map` | P2 | S-M |
| OPT-02 | **Redundant re-computation** | Same function called with identical args in the same scope; repeated `JSON.parse`/`JSON.stringify` of the same data | P3 | XS-S |
| OPT-03 | **Synchronous blocking in async paths** | `readFileSync`/`execSync` in modules that also export async functions | P2 | M |
| OPT-04 | **Algorithmic complexity** | Nested loops over the same collection (O(n²)+); `.find()` or `.filter()` inside `.map()` or `.forEach()` | P1 | M-L |
| OPT-05 | **Unnecessary allocations** | Array spread `[...arr]` or `Object.assign({}, obj)` in hot loops; string concatenation in loops instead of `join()` | P3 | XS-S |
| OPT-06 | **Missing early returns** | Deep nesting (4+ levels) that could be flattened with guard clauses | P4 | XS-S |
| OPT-07 | **Regex in hot paths** | `new RegExp()` construction inside loops (should be hoisted); repeated `.match()`/`.test()` with the same pattern | P3 | XS |
| OPT-08 | **Unbounded growth** | Arrays/objects that `.push()` in loops without size limits; `Map`/`Set` that grows without eviction | P2 | S-M |
| OPT-09 | **Error path robustness** | `catch` blocks that swallow errors silently (`catch {}`/`catch { /* */ }`); missing error propagation | P2 | S |
| OPT-10 | **Suboptimal data structures** | Repeated `.includes()` on arrays (should be Set); repeated object key lookup patterns that would benefit from Map | P3 | S |
| OPT-11 | **Dead assignments** | Variables assigned but never read before reassignment or scope exit | P4 | XS |
| OPT-12 | **Unguarded `.length`/property access** | Accessing `.length`, `.split()`, `.match()[0]` on potentially null/undefined values without null check | P2 | XS-S |

### 3.3 Convergent Loop: Diminishing Returns Detection

This is the key differentiator for `optimize`. The existing stop conditions in `determineStopReason()` are:

```
regression      → tests_after < tests_before        (immediate stop)
budget_cap      → totals.points_used >= total_budget (stop)
max_cycles      → totals.cycles_completed >= max     (stop)
zero_completed  → items_completed === 0              (stop)
```

**New stop condition: `diminishing_returns`**

After each cycle, the auto-runner already records `items_completed` and `points_used`. Define a new metric:

```
cycle_efficiency = items_completed / points_used
```

The diminishing-returns check compares the current cycle's efficiency to the previous cycle's:

```
if (run.cycles.length >= 2) {
  const prev = run.cycles[run.cycles.length - 2];
  const curr = cycle;
  const prevEff = prev.items_completed / (prev.points_used || 1);
  const currEff = curr.items_completed / (curr.points_used || 1);
  if (currEff < prevEff * DIMINISHING_RETURNS_THRESHOLD) {
    return 'diminishing_returns';
  }
}
```

**`DIMINISHING_RETURNS_THRESHOLD = 0.3`** — If current cycle efficiency drops below 30% of the previous cycle's, optimization has plateaued. This threshold is aggressive enough to stop wasting budget on micro-gains, but lenient enough to allow 2-3 productive cycles before triggering.

**This condition only activates for the `optimize` category.** Other categories use the existing stop conditions only. The check is gated on `run.category === 'optimize'` in `determineStopReason()`.

### 3.4 Circular Re-scan Strategy

Standard categories scan once per cycle and may find overlapping items. For `optimize`:

1. **Cycle 1:** Full scan — find all optimization opportunities, prioritize by impact
2. **Cycle 2+:** Re-scan from scratch — previous fixes may expose new patterns:
   - Extracting a hot function reveals it's called in a tight loop → OPT-04
   - Removing a redundant parse reveals the remaining one can be cached → OPT-02
   - Flattening nesting reveals a dead assignment → OPT-11
3. **Deduplication:** Cross-reference new scan against `cycles[].items` from previous cycles. Skip items with the same `id` that were previously completed or failed. Only pick genuinely new findings.
4. **Convergence signal:** When re-scan finds fewer new items than the previous cycle AND efficiency drops below threshold → stop

This creates the "circular optimization" the user described: fix → re-scan → discover cascading opportunities → fix → re-scan → until plateau.

### 3.5 Architecture Decision

```
Modified files:
  pan-wizard-core/bin/lib/constants.cjs        — 3 additions (array + 2 objects)
  pan-wizard-core/bin/lib/focus.cjs            — ~15 lines (determineStopReason update)
  commands/pan/focus-auto.md                   — ~30 lines (menu item, scan heuristics, defaults row)
  tests/focus.test.cjs                         — ~40 lines (new tests)
  docs/CLI-REFERENCE.md                        — Category table update
  docs/USER-GUIDE.md                           — Mention in focus section

New constants:
  DIMINISHING_RETURNS_THRESHOLD = 0.3          — in constants.cjs

No new files needed. No installer changes. No manifest changes.
```

---

## Phase 4: Specification

### Files to Modify

#### 1. `pan-wizard-core/bin/lib/constants.cjs`

**A. Add to FOCUS_CATEGORIES array (line 126):**
```js
const FOCUS_CATEGORIES = ['cleanup', 'tests', 'stability', 'features', 'docs', 'optimize'];
```

**B. Add to CATEGORY_PRIORITY_RANGE (after line 135):**
```js
  optimize:  { min: 1, max: 4 },  // P1-P4
```

**C. Add to CATEGORY_DEFAULTS (after line 144):**
```js
  optimize:  { mode: 'balanced', budget: 50 },
```

**D. Add new constant (near other focus constants, ~line 500):**
```js
/** Efficiency drop threshold for optimize category diminishing-returns stop */
const DIMINISHING_RETURNS_THRESHOLD = 0.3;
```

**E. Export the new constant** in the module.exports block.

#### 2. `pan-wizard-core/bin/lib/focus.cjs`

**Update `determineStopReason()`** to add diminishing-returns check:

```js
function determineStopReason(cycle, run) {
  if (cycle.tests_after < cycle.tests_before) return 'regression';
  if (run.totals.points_used >= run.total_budget) return 'budget_cap';
  if (run.totals.cycles_completed >= run.max_cycles) return 'max_cycles';
  if (cycle.items_completed === 0) return 'zero_completed';

  // Optimize category: stop when efficiency drops below threshold
  if (run.category === 'optimize' && run.cycles.length >= 2) {
    const prev = run.cycles[run.cycles.length - 2];
    const prevEff = prev.items_completed / (prev.points_used || 1);
    const currEff = cycle.items_completed / (cycle.points_used || 1);
    if (currEff > 0 && currEff < prevEff * DIMINISHING_RETURNS_THRESHOLD) {
      return 'diminishing_returns';
    }
  }

  return null;
}
```

**Note:** Import `DIMINISHING_RETURNS_THRESHOLD` from constants.cjs.

#### 3. `commands/pan/focus-auto.md`

**A. Add to category menu (FIRST ACTION section):**
```
6. **optimize** — Performance bottlenecks, redundant computation, robustness hardening (P1-P4)
```
Update: "Reply with a number (1-6) or category name."

Add mapping: `"6" or "optimize" → SELECTED_CATEGORY = optimize`

**B. Add to Category Defaults table:**
```
| optimize | P1-P4 | balanced | 50 |
```

**C. Add scan heuristics to Step 2.1.2:**
```markdown
  - **optimize:** N+1 operations (file I/O / network calls inside loops), redundant
    re-computation (`JSON.parse`/`stringify` of same data), synchronous blocking in
    async modules, algorithmic complexity (nested `.find()`/`.filter()` in loops),
    unnecessary allocations in hot paths (spread in loops, string concat vs join),
    regex construction inside loops, unbounded collection growth, swallowed errors
    (`catch {}`), suboptimal data structures (array `.includes()` → Set), dead
    assignments, unguarded property access on nullable values
```

**D. Add convergence note to Step 2.1 (optimize-specific):**
```markdown
**Optimize category: convergent re-scan.** On cycles 2+, cross-reference scan
findings against previous cycle completions. Only pick genuinely new items. If
the count of new findings drops below the previous cycle's AND efficiency drops
below 30% of the prior cycle, this signals convergence.
```

**E. Add to Phase 3 stop reason table:**
```
| `diminishing_returns` | Optimize only — cycle efficiency < 30% of previous cycle |
```

#### 4. `tests/focus.test.cjs`

Add the following test cases:

```js
describe('categoryFilter — optimize', () => {
  test('includes P1-P4 items for optimize category', () => {
    const items = [
      { priority: 'P0' }, { priority: 'P1' }, { priority: 'P2' },
      { priority: 'P3' }, { priority: 'P4' }, { priority: 'P5' }, { priority: 'P6' },
    ];
    const result = categoryFilter(items, 'optimize');
    assert.equal(result.length, 4);
    assert.deepEqual(result.map(i => i.priority), ['P1', 'P2', 'P3', 'P4']);
  });
});

describe('CATEGORY_DEFAULTS — optimize', () => {
  test('optimize has balanced mode and 50 budget', () => {
    assert.equal(CATEGORY_DEFAULTS.optimize.mode, 'balanced');
    assert.equal(CATEGORY_DEFAULTS.optimize.budget, 50);
  });
});

describe('CATEGORY_PRIORITY_RANGE — optimize', () => {
  test('optimize range is P1-P4 (indices 1-4)', () => {
    assert.equal(CATEGORY_PRIORITY_RANGE.optimize.min, 1);
    assert.equal(CATEGORY_PRIORITY_RANGE.optimize.max, 4);
  });
});

describe('FOCUS_CATEGORIES includes optimize', () => {
  test('optimize is a valid category', () => {
    assert.ok(FOCUS_CATEGORIES.includes('optimize'));
  });
});

describe('determineStopReason — diminishing returns', () => {
  // (test the updated determineStopReason with optimize category + cycles data)
  test('returns diminishing_returns when efficiency drops below 30%', () => {
    const cycle = { items_completed: 1, points_used: 10, tests_before: 100, tests_after: 101 };
    const run = {
      category: 'optimize',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 2, points_used: 60 },
      cycles: [
        { items_completed: 5, points_used: 10 },  // prev efficiency: 0.5
        cycle,                                       // curr efficiency: 0.1 (< 0.5 * 0.3 = 0.15)
      ],
    };
    // This test will validate the function returns 'diminishing_returns'
  });

  test('does not trigger diminishing_returns for non-optimize categories', () => {
    const cycle = { items_completed: 1, points_used: 10, tests_before: 100, tests_after: 101 };
    const run = {
      category: 'cleanup',
      total_budget: 500, max_cycles: 10,
      totals: { cycles_completed: 2, points_used: 60 },
      cycles: [
        { items_completed: 5, points_used: 10 },
        cycle,
      ],
    };
    // Should return null, not 'diminishing_returns'
  });

  test('does not trigger on first cycle (no previous to compare)', () => {
    const cycle = { items_completed: 1, points_used: 10, tests_before: 100, tests_after: 101 };
    const run = {
      category: 'optimize',
      total_budget: 500, max_cycles: 10,
      totals: { cycles_completed: 1, points_used: 10 },
      cycles: [cycle],
    };
    // Should return null — needs 2+ cycles
  });
});

describe('focusAutoInit — optimize category', () => {
  test('accepts optimize as valid category via CLI', () => {
    // Integration: runPanTools(tmpDir, 'focus', 'auto', '--category', 'optimize', '--dry-run')
    // Verify output contains category: 'optimize', mode: 'balanced', budget: 50
  });
});
```

**Estimated: ~10 new test cases across 6 describe blocks.**

#### 5. Documentation

**`docs/CLI-REFERENCE.md`** — Add `optimize` row to focus-auto category table.

**`docs/USER-GUIDE.md`** — Mention optimize category in the focus-auto section.

### Implementation Steps

```
Step 1: constants.cjs — Add 'optimize' to FOCUS_CATEGORIES, CATEGORY_PRIORITY_RANGE,
        CATEGORY_DEFAULTS, and add DIMINISHING_RETURNS_THRESHOLD constant + export
Step 2: focus.cjs — Import new constant, update determineStopReason() with
        diminishing-returns check gated on category === 'optimize'
Step 3: focus-auto.md — Add category 6 to menu, defaults table row, scan heuristics,
        convergent re-scan note, stop reason row
Step 4: focus.test.cjs — Add ~10 tests for category filtering, defaults, priority range,
        diminishing-returns logic, CLI integration
Step 5: docs/ — Update CLI-REFERENCE.md and USER-GUIDE.md
Step 6: Run full test suite — verify 0 regressions
```

### Runtime Matrix

| Runtime | Supported | Notes |
|---------|-----------|-------|
| Claude | ✅ | focus-auto.md is runtime-agnostic |
| Codex | ✅ | Same command file, same constants |
| Gemini | ✅ | Same command file, same constants |
| OpenCode | ✅ | Same command file, same constants |
| GitHub | ✅ | Same command file, same constants |

---

## Phase 5: Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Existing tests referencing FOCUS_CATEGORIES.length | Medium | Medium | Search for `.length` assertions on FOCUS_CATEGORIES before implementing; update any hardcoded count |
| Diminishing-returns fires too early (false positive) | Medium | Low | Threshold 0.3 is conservative; only fires after 2+ cycles; only for `optimize` category |
| Diminishing-returns never fires (false negative) | Low | Low | Existing max_cycles and budget_cap still provide hard stops |
| Scan heuristics too aggressive (false positives in scan) | Medium | Medium | Heuristics are guidance for the LLM scan step, not automated grep rules — the agent applies judgment |
| `optimize` overlaps with `cleanup` category | Low | Medium | Priority ranges don't overlap (cleanup: P3-P5 vs optimize: P1-P4); scan heuristics are distinct (cleanup = dead code/imports vs optimize = perf/robustness) |
| `determineStopReason` order matters — diminishing_returns checked after zero_completed | Low | Low | If items_completed === 0, `zero_completed` fires first (correct: no items means can't compute efficiency) |
| Breaking change if consumers iterate FOCUS_CATEGORIES with index assumptions | Low | Very Low | FOCUS_CATEGORIES is always consumed by `.includes()` or `.forEach()`, never by index |

### Backward Compatibility

- **No breaking changes.** Adding a 6th category to the array is purely additive.
- Existing campaigns using cleanup/tests/stability/features/docs are unaffected.
- `determineStopReason` changes are gated on `run.category === 'optimize'` — zero impact on other categories.
- The new `DIMINISHING_RETURNS_THRESHOLD` constant is only referenced from the one gated code path.

### Estimated Effort

- **Constants + focus module:** ~25 lines of code changes
- **Command .md:** ~30 lines of additions
- **Tests:** ~80 lines of new tests
- **Docs:** ~10 lines of table updates
- **Total: ~145 lines, Size S-M**
