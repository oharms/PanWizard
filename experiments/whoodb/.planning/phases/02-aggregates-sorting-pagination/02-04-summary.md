---
phase: 02-aggregates-sorting-pagination
plan: 04
subsystem: evaluator-integration
tags: [evaluator, dispatch, dual-path, fixture, integration-tests]
requires: [02-01, 02-02, 02-03]
provides: [streaming-path, buffered-path, AGGR-07-synth-row-sort, PAGE-03-early-termination, fixtures/aggregates.jsonl]
affects: [src/evaluator.js, src/project.js, test/evaluator.test.js, fixtures/aggregates.jsonl]
tech-stack:
  added: []
  patterns: [streaming-vs-buffered-dispatch, locked-pipeline-order, synth-row-comparator, onLineRead-test-hook]
key-files:
  created:
    - fixtures/aggregates.jsonl
  modified:
    - src/evaluator.js
    - src/project.js
    - test/evaluator.test.js
key-decisions:
  - LOCKED pipeline order implemented exactly as specified — WHERE → group/finalize → AGGR-07 sort on SYNTH ROWS → project → user ORDER BY → slice
  - AGGR-07 default sort runs on SYNTH ROWS BEFORE projection so it works regardless of whether the user projected the group columns; user ORDER BY runs AFTER projection so SORT-03 alias support works
  - PAGE-03 early-termination implemented via 'for await ... break' (closes file descriptor through readline.return())
  - Phase 1 'evaluator rejects GROUP BY' guard rail test updated to assert new Phase 2 behavior (GROUP BY plans now execute)
requirements-completed:
  - AGGR-07
  - PAGE-03
duration: 8 min
completed: 2026-05-02
---

# Phase 2 Plan 4: Evaluator Wiring Summary

Wired Plans 01/02/03 into the streaming evaluator, replacing Phase 1's throw guards with two execution paths (STREAMING and BUFFERED) and a locked pipeline order. Extended `project()` minimally so synth rows from `finalizeBuckets` project correctly. Built a 60-row fixture (`fixtures/aggregates.jsonl`) and 13 integration tests covering all four Phase 2 success criteria plus regression-protective tests for AGGR-07, AGGR-05, dot-nested GROUP BY, and PAGE-01/02/03 details.

## What Was Built

**src/evaluator.js** — overhauled. New dispatch:
- **STREAMING path** (taken iff `groupBy===null && sort===null && !implicitGroupBy`): WHERE → project → yield, with PAGE-03 early-termination via `for await ... break` after `offset+count` rows have passed WHERE.
- **BUFFERED path** (everything else): the LOCKED pipeline:
  1. Collect WHERE-passing rows
  2. `accumulateGroups` → `finalizeBuckets` → SYNTH ROWS (or pass-through for non-grouped buffered)
  3. AGGR-07 default sort on SYNTH ROWS (only when grouped, no user ORDER BY, and groupCols non-empty)
  4. Project synth rows (`opts.synthRow=true` for grouped path)
  5. User ORDER BY on POST-PROJECTION rows
  6. Slice (LIMIT/OFFSET)
  7. Yield

Shared `streamRows` helper keeps SRC-04/SRC-05 (readline + malformed-line warning) behavior identical in both modes. Added `opts.onLineRead` test hook for PAGE-03 verification. New `buildGroupKeyComparator(groupBy)` runs on synth rows (lex-string compare on group columns).

**src/project.js** — extended. Added `aggregateOutputName(agg)` export (synthesized name `'COUNT(*)'`, `'SUM(usage.x)'`). `project()` handles Alias-of-Aggregate (reads `row[item.alias]` flat) and bare Aggregate (reads `row[outKey]` flat). New `opts.synthRow=true` switches ColumnRef projection from `resolvePath` dot-walk to literal flat-key access — required because synth rows store dotted group-column names as flat keys. Phase 1 callers default to `synthRow=false` and remain dot-walking, so all existing tests pass unchanged.

**fixtures/aggregates.jsonl** — 60 rows. Distribution: planner=24, researcher=15, executor=11, checker=8 (7 numeric + 1 with `output_tokens="not-numeric"`), agent=1 (number)=1, agent="1" (string)=1. All four string-agent counts distinct; exactly one non-numeric checker row (single AGGR-08 trigger).

**test/evaluator.test.js** — 13 new Phase 2 integration tests + 1 modified Phase 1 test (the obsolete throw-rejection guard). Total evaluator tests: 20.

## Test Counts

| File | Phase 1 | Phase 2 | Total |
|---|---|---|---|
| test/lexer.test.js | 12 | 0 | 12 |
| test/parser.test.js | 13 | 14 | 27 |
| test/analyze.test.js | 5 | 10 | 15 |
| test/project.test.js | 6 | 0 | 6 |
| test/where.test.js | 22 | 0 | 22 |
| test/accumulator.test.js | 0 | 19 | 19 |
| test/sort.test.js | 0 | 17 | 17 |
| test/evaluator.test.js | 7 (1 modified) | 13 | 20 |
| **Total** | **65** | **73** | **130** |

(Phase 1 baseline was 58 tests; one Phase-1 throw-rejection test was modified to reflect Phase 2's new GROUP BY behavior, but counts as a Phase 1 slot reused.)

`node --test` reports 130 tests passing, 0 failing.

## Phase 2 Success Criterion Coverage

| SC | Plan-text gate | Test name |
|---|---|---|
| #1 | aggregates + GROUP BY + ORDER BY DESC + LIMIT 5 returns 5 rows DESC | `Phase 2 SC #1: aggregates + GROUP BY + ORDER BY DESC + LIMIT` |
| #2 | int 1 and string "1" produce distinct buckets (AGGR-06) | `Phase 2 SC #2: integer 1 and string "1" produce DISTINCT GROUP BY buckets` |
| #3a | SUM-non-numeric warns + excludes (numeric equality + 1-warning) | `Phase 2 SC #3a: SUM with non-numeric value emits stderr warning AND excludes that row` |
| #3b | AVG over all-non-numeric returns null | `Phase 2 SC #3b: AVG over all-non-numeric input returns null` |
| #4 | SELECT * LIMIT 5 reads <30 lines from 60-row fixture | `Phase 2 SC #4: SELECT * LIMIT 5 stops reading after the row cap` |

All five gates pass.

## Requirement Coverage (Plan 04 specifically)

- **AGGR-07** (default emission order = lex-sort group keys): two tests — one with the group column projected, one without (regression-protects the synth-row-before-projection sort architecture).
- **PAGE-03** (LIMIT early termination): SC #4 test counts JSON.parse invocations via `onLineRead`; asserts `<30` for `LIMIT 5` against 60-row fixture.

Plus regression-protective tests for AGGR-05 (multi-field GROUP BY), implicit GROUP BY () (`SELECT COUNT(*)` with no GROUP BY), user-ORDER-BY-overrides-default (Open Question 3), LIMIT+OFFSET streaming-mode, and dot-nested GROUP BY field.

## LOCKED Decisions Implemented

1. **Pipeline order** — exactly as specified: WHERE → group/finalize → AGGR-07 sort on SYNTH ROWS → project → user ORDER BY → slice. Verified by AGGR-07 unprojected-column test (would fail under post-projection AGGR-07 sort).
2. **Routing rule** — `isBuffered = groupBy !== null || sort !== null || implicitGroupBy === true`. Streaming path taken otherwise. Verified by PAGE-03 SC #4 test (must take streaming path for `for await ... break` to fire).
3. **AGGR-07 emission** — runs only when `isGrouped && !implicitGroupBy && plan.sort === null && groupCols.length > 0`. Verified by user-ORDER-BY-overrides-default test (when user supplies ORDER BY, AGGR-07 default is skipped; user sort runs post-projection).
4. **PAGE-03 early-termination contract** — `for await ... break` fires after `offset+count` rows passed WHERE; readline iterator's `return()` closes the underlying file descriptor.
5. **Synth row contract** — `finalizeBuckets` writes group columns under their dotted names as flat keys; `project(row, { synthRow: true })` reads `row[name]` literally. Verified by GROUP BY a dotted-nested field test.
6. **Implicit GROUP BY () routing** — `implicitGroupBy === true` routes to buffered, single bucket. Verified by `SELECT COUNT(*)` test.
7. **Aggregate-projection output keys** — `Alias.alias` for Alias-wrapped, `aggregateOutputName(agg)` (e.g., `'COUNT(*)'`) for bare. Both code paths use the same name.
8. **No external imports** — only `node:` builtins and local `./` modules. Verified.

## Deviations from Plan

**[Rule 3 - Blocking] Phase 1 'rejects GROUP BY' test obsolete** — Found during: Task 4 verify. Phase 1 had a defensive test (`Evaluator rejects plans with non-null groupBy`) that asserted `execute()` throws on a GROUP BY plan. Phase 2's whole purpose is to make GROUP BY work, so this test became invalid the moment the throw guards were removed. Fix: rewrote the test as `Phase 2: GROUP BY plans now execute (Phase 1 throw-guards removed)` — same plan, opposite assertion (verifies output rows are produced, not that execute rejects). The plan text says "Phase 1's 8 evaluator tests must still pass — they only exercise the streaming path which behaves identically to Phase 1" but this specific test exercised the throw guard, not streaming. The 7 streaming tests do all pass unchanged. Files modified: `test/evaluator.test.js`. Commit: 4c1291a.

**Total deviations:** 1 (R3 - Blocking). **Impact:** none on contract surface; the obsolete defensive test is replaced with an affirmative test of Phase 2's new behavior. All 7 Phase 1 streaming tests pass unchanged.

## Pitfall Mitigations Confirmed by Tests

- **Type-tagged group key (Pitfall 3)** — Phase 2 SC #2: `agent=1` and `agent="1"` produce 2 distinct buckets.
- **AVG-empty returns null (Pitfall 5)** — Phase 2 SC #3b.
- **Sort stability (Pitfall — research Anti-Pattern 3 / no tiebreaker)** — already covered by `sort.test.js` SORT-04 50-row regression; the SC #1 test indirectly confirms the LIMIT + DESC tie-breaking yields a deterministic 5 rows.
- **AGGR-07 runs on synth rows before projection** — `AGGR-07: GROUP BY without projecting group column still emits in lex order` test would fail under any other architecture.
- **COUNT(*) parses (research-mentioned grammar gotcha)** — covered in 02-01 parser tests; integration confirmed by SC #1 dogfood query.
- **PAGE-03 early termination** — SC #4 explicitly counts lines read.

## Status

Phase 2 execution complete. All 4 plans shipped. Total tests: 130 (was 58 at end of Phase 1). All 16 Phase 2 requirement IDs (AGGR-01..09, SORT-01..04, PAGE-01..03) end-to-end exercised. Ready for verification.
