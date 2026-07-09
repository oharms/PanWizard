---
phase: 02-aggregates-sorting-pagination
plan: 03
subsystem: sort
tags: [order-by, comparator, stable-sort, post-projection]
requires: [02-01]
provides: [buildComparator, compareValues]
affects: [src/sort.js, test/sort.test.js]
tech-stack:
  added: []
  patterns: [stable-native-sort, literal-flat-key-comparator, nulls-first-policy]
key-files:
  created:
    - src/sort.js
    - test/sort.test.js
  modified: []
key-decisions:
  - SORT-04 stability satisfied by Array.prototype.sort native stability (ES2019 / V8 7.0+ / Node 12+); zero tiebreaker-index machinery
  - Comparator reads row[key] LITERALLY — no dot-walk — so post-projection rows with alias keys AND dotted-name flat keys both work
  - Nullish policy: NULLS FIRST under ASC (null/undefined sort before non-nullish); DESC flips
  - NaN policy: NaN sorts before non-NaN numerics; total ordering preserved
requirements-completed:
  - SORT-01
  - SORT-02
  - SORT-03
  - SORT-04
duration: 3 min
completed: 2026-05-02
---

# Phase 2 Plan 3: Sort Comparator Summary

Built the ORDER BY comparator: a pure module that turns an `OrderByItem[]` into a stable, multi-key comparator function consumable by `Array.prototype.sort`. Lives at `src/sort.js`. Comparator runs on POST-PROJECTION rows (per SORT-03) — meaning input rows have aliases as flat keys and dotted-name group columns as flat keys. Reads `row[key]` literally; does NOT walk dot paths.

## What Was Built

**src/sort.js** (~75 LOC, 2 exports):
- `buildComparator(orderByItems)` — multi-key comparator builder. Returns a closure suitable for `Array.prototype.sort`. Iterates keys in order; first non-zero comparison wins; equal under all keys returns 0 (relies on native stable sort for SORT-04).
- `compareValues(a, b)` — primitive comparator. Handles null/undefined (NULLS FIRST), NaN (sorts before non-NaN), number-vs-number (`a-b`), string-vs-string (`<`/`>`), mixed-type fallback (`String(a)` vs `String(b)`).

**test/sort.test.js** (~200 LOC, 17 tests):
- 6 compareValues tests covering all primitive policy branches (numeric, null, undefined, NaN, string, mixed).
- 2 single-key tests (SORT-01): ASC and DESC.
- 2 multi-key tests (SORT-02): ASC+ASC tiebreaks correctly, ASC+DESC mixes directions independently.
- 2 SORT-04 stability tests: 4-row anchor (the SC#1 stable-tiebreak case) + 50-row regression gate.
- 2 SORT-03 literal-key tests: dotted-name flat key (group-column case from `finalizeBuckets`) + alias flat key (post-projection case).
- 3 edge cases: empty orderBy returns 0 always, nullish ASC sorts to start, nullish DESC sorts to end.

## Test Counts

Phase 1 + 02-01 + 02-02 + 02-03 = **118 tests passing** (was 101 before Plan 02-03).

## Requirement Coverage

- **SORT-01** (single-key ORDER BY): `single-key ASC sorts ascending`, `single-key DESC sorts descending`.
- **SORT-02** (multi-key ORDER BY): `multi-key ASC+ASC tiebreaks via second key`, `multi-key ASC+DESC mixes directions independently`.
- **SORT-03** (POST-PROJECTION literal-flat-key access): `comparator reads row[key] LITERALLY (does NOT dot-walk into nested objects)`, `ORDER BY on alias key works`.
- **SORT-04** (stable sort, no tiebreaker index): `equal-keyed rows retain input order (stable sort, NO tiebreaker added)`, `stability holds for many equal-key rows (regression gate)` (50-row).

## LOCKED Decisions Implemented

1. **No tiebreaker index** — SORT-04 satisfied purely by Array.prototype.sort stability (Node ≥ 22.17.0 floor guarantees ES2019 stability). Verified by 50-row regression test.
2. **Comparator built ONCE outside sort()** — `array.sort(buildComparator(items))` pattern, never inline lambda (research Pitfalls performance trap).
3. **Literal flat-key access** — `row[key]` not `resolvePath(row, key.split('.'))`. SORT-03 test proves dotted-name flat keys (`'usage.output_tokens'`) work, alias flat keys (`'out'`) work.
4. **Nullish policy LOCKED** — null/undefined treated equal-nullish, sort before any non-null under ASC; DESC flips. Documented in code + 3 tests.
5. **NaN policy LOCKED** — NaN sorts before non-NaN. Total ordering preserved.
6. **Numeric vs numeric: `a - b`** — not lex compare. Verified.
7. **String vs string: `<` / `>`** — basic-Latin lex order. No locale-aware sorting (out of scope per "small precise grammar" principle).
8. **Mixed types: `String(a)` lex compare** — fallback for the rare case. Verified.
9. **No external imports** — fully self-contained. Zero-deps invariant.

## Deviations from Plan

None — plan executed exactly as written.

**Total deviations:** 0. **Impact:** clean.

## Status

Plan 02-03 done. With 02-02 (accumulator), Wave 2 is complete. Plan 02-04 (evaluator wiring) can now compose all three module contracts into the user-facing pipeline.
