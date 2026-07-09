---
phase: 02-aggregations-count-histogram
plan: "02"
subsystem: aggregations-count-tests
tags: [count, jsonl, integration-tests, unit-tests, parseargs, async-iterators]

requires:
  - phase: 01-streaming-foundation-filter (plan 01)
    provides: sources(), lines(), decode() streaming pipeline
  - phase: 01-streaming-foundation-filter (plan 02)
    provides: compileWhere, compileTimeFilter, compileKey predicate compilers
  - phase: 01-streaming-foundation-filter (plan 03)
    provides: writeJsonl, runCLI helper
  - phase: 02-aggregations-count-histogram (plan 01)
    provides: lib/time-bucket.js, lib/histogram.js
provides:
  - lib/count.js — count subcommand: argv parsing, predicate compilation, accumulate Map, sorted JSONL emit
  - bin/whoolog.js — count dispatch wired (Plan 02-01 wired histogram; this plan closes the file conflict)
  - test/time-bucket.test.js — 12 unit tests for parseBucket + bucketStart + bucketStartIso
  - test/count.test.js — 9 integration tests via runCLI
  - test/histogram.test.js — 15 integration tests including TST-04 boundary
affects: [03-*]

tech-stack:
  added: []
  patterns:
    - "Map<JSON.stringify(value), {outputValue, count}> for type-fidelity preservation across number/string collisions"
    - "Sentinel ('__undef__') for undefined keys because JSON.stringify(undefined) returns undefined (not a string)"
    - "Phase 2 test suite uses programmatic fixtures (fs.mkdtempSync) and shape-based assertions (parseJsonlOutput + deepEqual/regex)"

key-files:
  created:
    - lib/count.js
    - test/time-bucket.test.js
    - test/count.test.js
    - test/histogram.test.js
  modified:
    - bin/whoolog.js

key-decisions:
  - "count Map key uses JSON.stringify(raw) for non-undefined values and the sentinel '__undef__' for undefined. JSON.stringify(undefined) returns undefined (not a string), which would corrupt the Map's string-key invariant."
  - "Output value field preserves the original JS type (number stays number, string stays string, null stays null). undefined is normalized to null in the OUTPUT for cleaner JSON, but kept distinct in the KEY (so missing-vs-explicit-null are bucketed together via the same '__undef__'/'null' distinction matching research §Implementation §2)."
  - "Sort tie-break uses the SERIALIZED key string (not the output value). This guarantees deterministic ordering even when output values are mixed types — e.g., a tie between number 5 and string '5' resolves stably as `\"5\"` < `5` (because `\"` is ASCII 0x22, `5` is 0x35)."
  - "TST-04 boundary fixture is Test 1 in test/histogram.test.js for visibility — the most important assertion in Phase 2."
  - "Test/count nested-key test for {usage: null} is asserted tolerantly (membership + counts) because two values tie at count 2; the deterministic order (gpt-4 then null) is implementation-detail and the membership check survives any future tweak to the tie-break ordering of mixed types."

patterns-established:
  - "Subcommand counting pattern: Map<string_key, {outputValue, count}> + JSON.stringify keying + serialized-key tie-break"
  - "Phase 2 test suite shape: time-bucket as unit test, count + histogram as integration via runCLI, all fixtures programmatic"

requirements-completed:
  - CNT-01
  - CNT-02
  - CNT-03
  - TST-04

test-tiers: [unit, integration]

duration: ~12 min
completed: 2026-05-02
---

# Phase 2 Plan 02: Count subcommand + Phase 2 test suite Summary

**count subcommand wired up; full Phase 2 test suite (36 new tests) lands. After this plan, both count and histogram are user-facing and all four Phase 2 success criteria are observable via `node --test test/`. Total project test count: 78/78 passing (42 Phase 1 + 36 Phase 2).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files created:** 4 (`lib/count.js` 171 lines, `test/time-bucket.test.js` 66 lines, `test/count.test.js` 151 lines, `test/histogram.test.js` 216 lines)
- **Files modified:** 1 (`bin/whoolog.js`)

## Accomplishments

- `lib/count.js` (171 lines): exports async `run(argv)`. Reuses Phase 1 streaming pipeline (sources, lines, decode, compileWhere, compileTimeFilter, compileKey, writeJsonl). Map<JSON.stringify(value), {outputValue, count}> accumulator preserves type fidelity. Sort: count desc, ties broken by serialized-key ascending. `--help` text documents `O(distinct values)` memory cost.
- `bin/whoolog.js`: added `else if (SUB === 'count')` branch dispatching to `require('../lib/count').run(...)`. Top-level help line for count updated from `(Phase 2)` placeholder to actual description. (Plan 02-01 wired histogram; this plan closes the file conflict.)
- `test/time-bucket.test.js` (66 lines, 12 tests): unit tests for parseBucket valid units (1m/5m/1h/1d), rejected units (1s/empty/garbage), bucketStart boundary cases (TST-04 math), mid-bucket cases for 1m/5m/1h/1d.
- `test/count.test.js` (151 lines, 9 tests): integration via runCLI — basic top-level field with sort desc (CNT-02), nested key (CNT-01), tie-break ascending, type fidelity (number 5 vs string "5"), missing --by, empty input, --help O(distinct values), --where pre-filter, missing-field → null value.
- `test/histogram.test.js` (216 lines, 15 tests): integration via runCLI — Test 1 is the explicit TST-04 boundary, plus HST-01 (basic 1h/1d/5m bucketing, numeric epoch ms, nested-key via compileKey), HST-04 (sort ascending from unsorted input), HST-05 (empty buckets omitted, --help text mentions it), missing-flag exits, silent-skip for unparseable timestamps, --where pre-filter.

## Test Count Breakdown

| File | Tests | Coverage |
|------|-------|----------|
| test/time-bucket.test.js | 12 | parseBucket units (4 valid + 3 invalid groups) + bucketStart cases (5: boundary, 1d, 5m, 1m, mid-bucket) |
| test/count.test.js | 9 | CNT-01, CNT-02, CNT-03, type fidelity, missing --by, empty, --where, missing-field-null |
| test/histogram.test.js | 15 | TST-04 (test 1), HST-01..05, missing flags, invalid spec, silent-skip, sort, --where, --help |
| **Phase 2 new** | **36** | All four phase success criteria + all phase requirements |
| Phase 1 (existing) | 42 | Unchanged |
| **Project total** | **78** | All passing |

## Task Commits

1. **Task 1: lib/count.js + bin/whoolog.js dispatch** — `e1c132c` (feat)
2. **Task 2: time-bucket + count tests** — `0d35c61` (test)
3. **Task 3: histogram tests + TST-04 boundary** — `8266f2b` (test)

## Files Created/Modified

- `lib/count.js` — created (171 lines)
- `bin/whoolog.js` — modified (+3/-1)
- `test/time-bucket.test.js` — created (66 lines, 12 tests)
- `test/count.test.js` — created (151 lines, 9 tests)
- `test/histogram.test.js` — created (216 lines, 15 tests)

## Decisions Made

- count Map key strategy: `JSON.stringify(raw)` for non-undefined; sentinel `'__undef__'` for undefined. Output `value` preserves original JS type; undefined → null only in output.
- Sort tie-break uses the serialized key string (deterministic across mixed types).
- TST-04 boundary fixture is Test 1 in `test/histogram.test.js` (highest-visibility placement; it's a phase success criterion).
- count nested-key test asserts on membership/counts (not strict order) because two values tie at count 2 — the deterministic order is implementation-detail.

## Deviations from Plan

None.

## Pitfall Guard Verification

| Pitfall | Guard | Status |
|---------|-------|--------|
| 22 (no snapshot strings) | All assertions via parsed JSONL + deepEqual + regex | passes (manual review) |
| 23 (no committed fixtures) | All fixtures via fs.mkdtempSync in `before()` | passes (no `.jsonl` files committed) |
| Numeric vs string value type fidelity | `count: type fidelity` test | passes |
| Missing-vs-null vs undefined | `count: missing --by field on rows` test | passes |
| HST-03 boundary (TST-04) | `histogram: TST-04` test (Test 1) | passes |
| HST-05 empty bucket omission | `histogram: empty buckets are omitted` test + `--help` text | passes |

## Phase 2 Success Criteria — Test Coverage

| SC | Source Test |
|----|-------------|
| SC-1 (count by level, sort desc, tie-break asc) | count.test.js tests 1, 3 |
| SC-2 (count nested key + --help O(distinct values)) | count.test.js tests 2, 7 |
| SC-3 (histogram by ts, sort asc, empty buckets omitted) | histogram.test.js tests 2, 3, 14 |
| SC-4 (boundary semantics — TST-04) | histogram.test.js test 1 |

## Module Exports Surface

| File | Exports |
|------|---------|
| `lib/count.js` | `run` |

## Final Test Results

```
ℹ tests 78
ℹ pass  78
ℹ fail  0
ℹ duration_ms ~890
```

## User Setup Required

None.

## Next Phase Readiness

- Phase 2 ships its user-facing value: `whoolog count --files X --by level` and `whoolog histogram --files X --by ts --bucket 1h` work end to end.
- All four phase success criteria are observable via passing tests.
- The aggregation pipeline contract is locked. Phase 3 (table formatter + perf gate + dogfood) can plug into the existing `{value, count}` and `{bucket_start, count}` JSONL shapes without changes.
- No blockers; Phase 2 verification can run.

---
*Phase: 02-aggregations-count-histogram*
*Completed: 2026-05-02*
