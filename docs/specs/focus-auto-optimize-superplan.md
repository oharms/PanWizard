# PAN Wizard Work Plan — focus-auto `optimize` Category

**Generated:** 2026-03-18 · **Source spec:** `docs/specs/focus-auto-optimize-category.md`

---

## Baseline

| Metric | Value |
|--------|-------|
| Version | 2.8.0 |
| Tests passing | 1649/1649 |
| Test files | 46 unit + 25 scenario = 71 |
| Commands shipped | 40 |
| Agents shipped | 12 |
| Core modules | 16 |
| Focus tests | 128 (37 suites) |
| Open TODOs in affected files | 0 |
| Focus categories | 5 (cleanup, tests, stability, features, docs) |

---

## Items

| ID | Priority | Size | Title | Files | Status |
|----|----------|------|-------|-------|--------|
| 1 | P0 | XS | Add `'optimize'` to FOCUS_CATEGORIES array | `constants.cjs:126` | Remaining |
| 2 | P0 | XS | Add `optimize` entry to CATEGORY_PRIORITY_RANGE | `constants.cjs:129-135` | Remaining |
| 3 | P0 | XS | Add `optimize` entry to CATEGORY_DEFAULTS | `constants.cjs:138-144` | Remaining |
| 4 | P1 | XS | Add DIMINISHING_RETURNS_THRESHOLD constant | `constants.cjs:~502` | Remaining |
| 5 | P1 | XS | Export DIMINISHING_RETURNS_THRESHOLD | `constants.cjs:~640` (exports block) | Remaining |
| 6 | P1 | S | Import DIMINISHING_RETURNS_THRESHOLD in focus.cjs | `focus.cjs:14-20` (imports) | Remaining |
| 7 | P1 | S | Add diminishing-returns check to determineStopReason() | `focus.cjs:779-785` | Remaining |
| 8 | P1 | XS | Export determineStopReason from focus.cjs | `focus.cjs:862-885` (exports) | Remaining |
| 9 | P2 | XS | Update existing test: FOCUS_CATEGORIES count 5→6 | `focus.test.cjs:1125-1127` | Remaining |
| 10 | P2 | XS | Update existing test: FOCUS_CATEGORIES deepStrictEqual array | `focus.test.cjs:1127` | Remaining |
| 11 | P3 | S | Add test: categoryFilter includes P1-P4 for optimize | `focus.test.cjs` (new block) | Remaining |
| 12 | P3 | S | Add test: CATEGORY_DEFAULTS.optimize has balanced/50 | `focus.test.cjs` (new block) | Remaining |
| 13 | P3 | S | Add test: CATEGORY_PRIORITY_RANGE.optimize min=1, max=4 | `focus.test.cjs` (new block) | Remaining |
| 14 | P3 | S | Add test: diminishing_returns triggers when efficiency < 30% of prev | `focus.test.cjs` (new block) | Remaining |
| 15 | P3 | S | Add test: diminishing_returns does NOT trigger for non-optimize categories | `focus.test.cjs` (new block) | Remaining |
| 16 | P3 | XS | Add test: diminishing_returns does NOT trigger on first cycle | `focus.test.cjs` (new block) | Remaining |
| 17 | P3 | S | Add test: focusAutoInit accepts optimize via CLI --dry-run | `focus.test.cjs` (new block) | Remaining |
| 18 | P3 | XS | Add test: determineStopReason returns null when efficiency stays high | `focus.test.cjs` (new block) | Remaining |
| 19 | P5 | S | Add category 6 to focus-auto.md menu + mapping | `focus-auto.md:38-56` | Remaining |
| 20 | P5 | XS | Add optimize row to focus-auto.md Category Defaults table | `focus-auto.md:~88` | Remaining |
| 21 | P5 | M | Add optimize scan heuristics to focus-auto.md Step 2.1.2 | `focus-auto.md:~136-145` | Remaining |
| 22 | P5 | S | Add convergent re-scan note to focus-auto.md optimize section | `focus-auto.md:~150` | Remaining |
| 23 | P5 | XS | Add diminishing_returns to focus-auto.md stop reason list | `focus-auto.md:~240` | Remaining |
| 24 | P6 | XS | Update CLI-REFERENCE.md categories line | `CLI-REFERENCE.md:2210` | Remaining |
| 25 | P6 | XS | Add diminishing_returns stop condition to CLI-REFERENCE.md | `CLI-REFERENCE.md:~2222` | Remaining |
| 26 | P6 | XS | Update USER-GUIDE.md focus-auto categories mention | `USER-GUIDE.md:332,336` | Remaining |

---

## Points Summary

| Priority | Items | Points | Description |
|----------|-------|--------|-------------|
| P0 | 3 | 3 | Core constants — feature won't work without these |
| P1 | 5 | 7 | Convergent-loop logic — key differentiator |
| P2 | 2 | 2 | Fix breaking tests — must pass before merge |
| P3 | 8 | 13 | New tests — validate correctness |
| P5 | 5 | 9 | Command doc — user-facing behavior definition |
| P6 | 3 | 3 | Reference doc updates |
| **Total** | **26** | **37** | |

---

## Execution Sessions

### Session 1: Core Infrastructure (P0 + P1 + P2) — 12 points

**Goal:** Make `optimize` a valid category with diminishing-returns logic, passing all tests.

| Order | ID | Title | Points |
|-------|-----|-------|--------|
| 1 | 1 | Add `'optimize'` to FOCUS_CATEGORIES | 1 |
| 2 | 2 | Add optimize to CATEGORY_PRIORITY_RANGE | 1 |
| 3 | 3 | Add optimize to CATEGORY_DEFAULTS | 1 |
| 4 | 4 | Add DIMINISHING_RETURNS_THRESHOLD constant | 1 |
| 5 | 5 | Export DIMINISHING_RETURNS_THRESHOLD | 1 |
| 6 | 6 | Import DIMINISHING_RETURNS_THRESHOLD in focus.cjs | 2 |
| 7 | 7 | Add diminishing-returns check to determineStopReason() | 2 |
| 8 | 8 | Export determineStopReason from focus.cjs | 1 |
| 9 | 9 | Fix test: FOCUS_CATEGORIES count 5→6 | 1 |
| 10 | 10 | Fix test: deepStrictEqual array includes optimize | 1 |

**Gate:** `npm test` — all 1649 tests pass (items 9-10 fix the 2 that would break).

**Files touched:** `constants.cjs`, `focus.cjs`, `focus.test.cjs`
**Commit:** `feat: add optimize category to focus-auto with diminishing-returns stop condition`

### Session 2: Test Coverage (P3) — 13 points

**Goal:** Full test coverage for the new category and diminishing-returns logic.

| Order | ID | Title | Points |
|-------|-----|-------|--------|
| 1 | 11 | Test categoryFilter P1-P4 for optimize | 2 |
| 2 | 12 | Test CATEGORY_DEFAULTS.optimize | 2 |
| 3 | 13 | Test CATEGORY_PRIORITY_RANGE.optimize | 2 |
| 4 | 14 | Test diminishing_returns triggers at <30% efficiency | 2 |
| 5 | 15 | Test diminishing_returns skipped for non-optimize | 2 |
| 6 | 16 | Test diminishing_returns skipped on first cycle | 1 |
| 7 | 17 | Test focusAutoInit accepts optimize via CLI | 2 |
| 8 | 18 | Test determineStopReason null when efficiency high | 1 |

**Gate:** `npm test` — 1649 + 8 new = 1657 tests, 0 failures.

**Files touched:** `focus.test.cjs`
**Commit:** `test: add 8 tests for optimize category and diminishing-returns logic`

### Session 3: Command Documentation (P5) — 9 points

**Goal:** User-facing focus-auto.md fully documents the optimize category.

| Order | ID | Title | Points |
|-------|-----|-------|--------|
| 1 | 19 | Add category 6 to interactive menu | 2 |
| 2 | 20 | Add optimize to Category Defaults table | 1 |
| 3 | 21 | Add optimize scan heuristics (12 pattern types) | 4 |
| 4 | 22 | Add convergent re-scan note | 2 |
| 5 | 23 | Add diminishing_returns to stop reason list | 1 |

**Gate:** Visual review — menu shows 6 categories, heuristics list is complete, table has 6 rows.

**Files touched:** `focus-auto.md`
**Commit:** `docs: add optimize category to focus-auto command with scan heuristics and convergence logic`

### Session 4: Reference Documentation (P6) — 3 points

**Goal:** All reference docs reflect the new category.

| Order | ID | Title | Points |
|-------|-----|-------|--------|
| 1 | 24 | Update CLI-REFERENCE.md categories line | 1 |
| 2 | 25 | Add diminishing_returns to CLI-REFERENCE.md stop conditions | 1 |
| 3 | 26 | Update USER-GUIDE.md focus category list | 1 |

**Gate:** `npm run test:all` — full 1657+ tests pass. Grep for "5 categories" or "cleanup, tests, stability, features, docs" (without optimize) returns 0 stale references.

**Files touched:** `CLI-REFERENCE.md`, `USER-GUIDE.md`
**Commit:** `docs: update CLI reference and user guide with optimize category`

---

## Dependency Graph

```
Session 1 (constants + focus.cjs + test fixes)
    │
    ├── Session 2 (new tests — depends on Session 1 exports)
    │
    └── Session 3 (command docs — independent of tests but needs category to exist)
              │
              └── Session 4 (ref docs — should match command doc)
```

Sessions 2 and 3 can run in parallel after Session 1. Session 4 depends on Session 3 (content alignment).

---

## Risk Register

| Risk | Impact | Mitigation | Detected By |
|------|--------|------------|-------------|
| Test `FOCUS_CATEGORIES.length === 5` breaks | **Blocks merge** | Item 9 — update to 6 | `npm test` in Session 1 gate |
| Test `deepStrictEqual` array breaks | **Blocks merge** | Item 10 — add optimize to expected array | `npm test` in Session 1 gate |
| Other tests iterate FOCUS_CATEGORIES by index | Low | Grep confirmed: all uses are `.includes()` or `.forEach()`, never by index | Phase 0 scan |
| determineStopReason not exported (can't unit test) | Medium | Item 8 — export it | Session 2 import |
| Diminishing-returns threshold too aggressive | Medium (false stops) | 0.3 is conservative; existing max_cycles/budget_cap still provide hard stops | Integration testing |
| focus-auto.md menu numbering drift | Low | Item 19 explicitly updates to "1-6" | Visual review |
| CLAUDE.md test count goes stale | Low | Don't update CLAUDE.md until after final test run confirms count | Session 4 gate |

---

## Success Criteria Checklist

| SC | Criterion | Validated By |
|----|-----------|-------------|
| SC-1 | `optimize` is a valid --category | Session 1: focusAutoInit + Session 2: CLI test |
| SC-2 | No regression in existing consumers | Session 1 gate: 1649 tests pass |
| SC-3 | ≥8 scan pattern types documented | Session 3: 12 patterns in focus-auto.md |
| SC-4 | Convergent-loop stops on plateau | Session 2: diminishing_returns tests |
| SC-5 | Unit tests cover all new paths | Session 2: 8 new tests |
| SC-6 | Documentation updated | Session 3 + 4: focus-auto.md, CLI-REFERENCE, USER-GUIDE |
| SC-7 | All existing tests pass | Every session gate |
