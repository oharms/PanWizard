---
phase: 02-aggregates-sorting-pagination
phase_number: 02
status: passed
verified: 2026-05-02
test_gate_status: passed
test_total: 130
test_passed: 130
test_failed: 0
must_haves_verified: 4
must_haves_total: 4
requirement_ids_verified: 16
requirement_ids_total: 16
---

# Phase 2 Verification Report: Aggregates + Sorting + Pagination

**Status:** PASSED — all 4 success criteria observable, all 16 requirement IDs accounted for, 130/130 tests passing.

## Phase Goal

> A user can ask aggregation questions (COUNT, SUM, AVG, MIN, MAX with GROUP BY) and receive deterministically ordered results with ORDER BY and row-capped with LIMIT/OFFSET.

## Test Gate

`node --test` reports:
- **Total:** 130
- **Passed:** 130
- **Failed:** 0

Phase 1 baseline: 58. Phase 2 added 72 net (24 frontend in 02-01 + 19 accumulator + 17 sort + 13 evaluator integration tests, with one Phase-1 throw-rejection test rewritten to verify Phase 2's new behavior).

## Goal-Backward Verification — Success Criteria

### SC #1 — aggregates + GROUP BY + ORDER BY DESC + LIMIT
**Truth:** `SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out FROM 'fixtures/aggregates.jsonl' GROUP BY agent ORDER BY out DESC LIMIT 5` produces 5 rows in descending order of `out`, with stable tie-breaking on equal values.

**Test:** `test/evaluator.test.js > Phase 2 SC #1: aggregates + GROUP BY + ORDER BY DESC + LIMIT`. Verified row count is exactly 5; verified `rows[i].out >= rows[i+1].out` for every adjacent pair; verified all 3 projected keys (`agent`, `calls`, `out`) present in every row.

**Status:** VERIFIED.

### SC #2 — type-tagged group keys (AGGR-06)
**Truth:** A GROUP BY query over rows where the same key field appears as both integer `1` and string `"1"` produces two distinct groups.

**Test:** `test/evaluator.test.js > Phase 2 SC #2: integer 1 and string "1" produce DISTINCT GROUP BY buckets (AGGR-06)`. Verified `rows.find(r => r.agent === 1 && typeof r.agent === 'number')` and `rows.find(r => r.agent === '1' && typeof r.agent === 'string')` are both present and distinct.

**Status:** VERIFIED. Cross-cut by `test/accumulator.test.js > groupKey: integer 1 and string "1" produce DIFFERENT keys (AGGR-06)` at the unit level.

### SC #3 — non-numeric handling (AGGR-08, AGGR-09)
**Truth (3a):** `SUM` over a field containing a non-numeric value emits a stderr warning and the offending row is excluded from the sum.
**Truth (3b):** `AVG` over all-non-numeric input returns `null`.

**Test (3a):** `test/evaluator.test.js > Phase 2 SC #3a: SUM with non-numeric value emits stderr warning AND excludes that row`. Strengthened: asserts NUMERIC EQUALITY against `expectedCheckerSum` (computed at runtime by re-reading the fixture and summing only numeric values), AND asserts EXACTLY ONE `whoodb:` warning fires (fixture invariant: exactly one non-numeric `checker` row). Both assertions hold.

**Test (3b):** `test/evaluator.test.js > Phase 2 SC #3b: AVG over all-non-numeric input returns null (AGGR-09)`. Verified `rows[0].avg_out === null` against a 3-row temp fixture where all `usage.output_tokens` are non-numeric or null.

**Status:** VERIFIED (both halves).

### SC #4 — PAGE-03 early termination
**Truth:** `SELECT * FROM file LIMIT 5` with no ORDER BY stops reading after the row cap is reached (early termination).

**Test:** `test/evaluator.test.js > Phase 2 SC #4: SELECT * LIMIT 5 stops reading after the row cap (PAGE-03 early termination)`. Uses `opts.onLineRead` test hook to count `JSON.parse` invocations; asserts `linesRead < 30` for `LIMIT 5` against the 60-row fixture. Actual behavior: the streaming path `for await ... break`s after 5 emissions, the readline iterator's `return()` closes the underlying file descriptor.

**Status:** VERIFIED.

## Requirement ID Cross-Reference

All 16 Phase 2 requirement IDs accounted for. Each ID maps to at least one named test:

| ID | Requirement | Test(s) |
|---|---|---|
| AGGR-01 | COUNT(*) increments on every row | `accumulator.test.js > COUNT(*) increments on every row, including empty rows and null fields (AGGR-01)` |
| AGGR-02 | COUNT(field) skips null/undefined | `accumulator.test.js > COUNT(field) skips null AND undefined, counts everything else (AGGR-02)` |
| AGGR-03 | SUM/AVG/MIN/MAX happy paths | `accumulator.test.js > SUM happy path...`, `AVG happy path...`, `MIN returns smallest, MAX returns largest` |
| AGGR-04 | Parser surface for COUNT/SUM/AVG/MIN/MAX | `parser.test.js > parses COUNT(*) projection`, `parses COUNT(field) projection`, `parses SUM/AVG/MIN/MAX of dotted field`, `parses aggregate with alias` |
| AGGR-05 | Multi-field GROUP BY | `evaluator.test.js > Multi-field GROUP BY (AGGR-05)` |
| AGGR-06 | Type-tagged group keys | `accumulator.test.js > groupKey: integer 1 and string "1" produce DIFFERENT keys (AGGR-06)` + `evaluator.test.js > Phase 2 SC #2` |
| AGGR-07 | Default emission lex-sorts group keys | `evaluator.test.js > AGGR-07: GROUP BY without ORDER BY emits rows in lex order...` (projected column) + `... synth-row sort gate` (unprojected column) |
| AGGR-08 | Non-numeric warns + skips | `accumulator.test.js > SUM of non-numeric warns and skips (AGGR-08)`, NaN, MIN/MAX + `evaluator.test.js > Phase 2 SC #3a` |
| AGGR-09 | AVG-empty returns null | `accumulator.test.js > AVG over zero numeric inputs returns null (AGGR-09)` + `... all-non-numeric input returns null` + `evaluator.test.js > Phase 2 SC #3b` |
| SORT-01 | Single-key ORDER BY | `sort.test.js > buildComparator: single-key ASC...` + `... single-key DESC...` |
| SORT-02 | Multi-key ORDER BY | `sort.test.js > buildComparator: multi-key ASC+ASC...` + `... ASC+DESC mixes...` |
| SORT-03 | Post-projection scope check | `analyze.test.js > ORDER BY references unprojected column → throws ParseError`, alias support, SELECT * skip + `sort.test.js > SORT-03: comparator reads row[key] LITERALLY...` |
| SORT-04 | Stable sort, no tiebreaker | `sort.test.js > SORT-04: equal-keyed rows retain input order...` + `SORT-04: stability holds for many equal-key rows (regression gate)` (50-row) |
| PAGE-01 | LIMIT non-negative integer | `parser.test.js > parses LIMIT only`, `LIMIT -1 is rejected`, `LIMIT 1.5 is rejected` |
| PAGE-02 | OFFSET non-negative integer | `parser.test.js > parses LIMIT with OFFSET` + `evaluator.test.js > LIMIT + OFFSET in streaming mode` |
| PAGE-03 | LIMIT early termination | `evaluator.test.js > Phase 2 SC #4 (PAGE-03 early termination)` |

## Architectural Verification

The plan stipulated a **LOCKED pipeline order**:
> WHERE → group/finalize → AGGR-07 sort on synth rows → project → user ORDER BY → slice

Inspecting `src/evaluator.js`, the buffered-path code follows this order exactly (steps 1–7 in the comment block at the top of the file). The AGGR-07 sort runs on synth rows BEFORE projection — verified by the `AGGR-07: GROUP BY without projecting group column still emits in lex order (synth-row sort gate)` test, which would fail under any other architecture (post-projection rows lack the `agent` key when `agent` is not in the SELECT list).

The plan stipulated **zero-deps invariant**. Inspecting all `src/*.js` imports:
- All imports are either `node:` builtins or local `./` modules.
- No npm dependencies introduced.
- `src/sort.js` has zero imports (fully self-contained).
- `src/accumulator.js` imports only `./project.js` for `resolvePath`.

Both invariants hold.

## Deviations Found Across Plans

Two minor [Rule 3 - Blocking] auto-fixes, both documented in their respective summaries:

1. **02-01:** Lexer extended to emit `-` as OPERATOR (was LexError) so `parseNonNegativeInt` rejects `LIMIT -1` with the contracted ParseError instead of LexError. Phase 1 lexer tests still pass.

2. **02-04:** Phase 1's `Evaluator rejects plans with non-null groupBy` defensive test was rewritten as `Phase 2: GROUP BY plans now execute (Phase 1 throw-guards removed)` since Phase 2's purpose is to make GROUP BY work. The 7 streaming-path tests pass unchanged.

Neither deviation affects the contract surface of any module.

## Final Status

**PASSED.** All 4 success criteria observable in the test suite, all 16 requirement IDs accounted for, test gate green at 130/130, zero-deps invariant intact, LOCKED pipeline order implemented exactly as specified.

Phase 2 ready for completion. Phase 3 (CLI Shell + Glob + Explain + Dogfood) can plan against the now-stable evaluator surface.
