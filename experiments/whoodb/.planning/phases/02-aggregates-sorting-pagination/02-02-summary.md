---
phase: 02-aggregates-sorting-pagination
plan: 02
subsystem: accumulator
tags: [aggregates, group-by, type-tagging, slot-state-machine]
requires: [02-01]
provides: [groupKey, newSlot, updateSlot, finalizeSlot, accumulateGroups, finalizeBuckets]
affects: [src/accumulator.js, test/accumulator.test.js]
tech-stack:
  added: []
  patterns: [type-tagged-group-key, per-slot-state-machine, stderr-warning-channel]
key-files:
  created:
    - src/accumulator.js
    - test/accumulator.test.js
  modified: []
key-decisions:
  - LOCKED group-key formula JSON.stringify(vals.map(v => [typeof v, v])) implemented as-is — int 1, str '1', null, undefined all map to distinct keys
  - AGGR-08 warning channel reuses Phase 1 evaluator's 'whoodb:' stderr prefix for consistency
  - AGGR-09 AVG-empty returns null (not NaN); MIN/MAX-empty return null
  - Synth-row contract: finalizeBuckets writes group-column DOTTED names as FLAT keys — evaluator (Plan 04) must call project() with synthRow=true to skip dot-walking
requirements-completed:
  - AGGR-01
  - AGGR-02
  - AGGR-03
  - AGGR-06
  - AGGR-08
  - AGGR-09
duration: 4 min
completed: 2026-05-02
---

# Phase 2 Plan 2: Accumulator Summary

Built the GROUP BY accumulator: a pure, in-memory module that maintains a `Map<keyString, Bucket>` of running aggregate state, updates buckets row-by-row, and finalizes them on stream-exhaust. Lives at `src/accumulator.js`. Consumed by the evaluator (Plan 04). Independent of `sort.js` (Plan 03) and the parser/analyzer (Plan 01) — only depends on Plan 01's Aggregate AST shape and Phase 1's `resolvePath`.

## What Was Built

**src/accumulator.js** (~180 LOC, 6 exports):
- `groupKey(row, groupByCols)` — type-tagged key builder. Empty-cols case returns stable `'[]'` key (implicit GROUP BY ()).
- `newSlot(agg)` — slot factory by aggregate kind (COUNT_STAR, COUNT_FIELD, SUM, AVG, MIN, MAX).
- `updateSlot(slot, row)` — row-by-row update. SUM/AVG/MIN/MAX null/undefined → silent skip; non-numeric → `whoodb:` stderr warning + skip.
- `finalizeSlot(slot)` — reduce slot to scalar. AVG-empty → null. MIN/MAX-empty → null.
- `accumulateGroups(rows, groupByCols, aggregateDefs)` — drive accumulation, return `Map<key, bucket>`.
- `finalizeBuckets(buckets, groupByCols)` — turn buckets into synth rows: `{ ...groupCols-as-flat-keys, ...aggregates-as-flat-keys }`.

**test/accumulator.test.js** (~210 LOC, 19 tests):
- 5 groupKey tests (AGGR-06): int vs string distinct, null vs missing distinct, empty cols → `[]`, multi-key, dot-nested.
- 1 COUNT_STAR test (AGGR-01).
- 1 COUNT_FIELD test (AGGR-02): skips null/undefined, counts 0/false/''.
- 4 SUM tests (AGGR-03/AGGR-08): happy path, null silent-skip, non-numeric warns+skips, NaN warns+skips.
- 3 AVG tests (AGGR-03/AGGR-09): happy path, zero inputs → null, all-non-numeric → null.
- 3 MIN/MAX tests (AGGR-03): smallest/largest, empty → null, skip null + warn non-numeric.
- 1 mixed-type SC #2 anchor: rows with `agent:'a'`, `'b'`, `1` (number), `'1'` (string) → 4 distinct buckets.
- 1 implicit GROUP BY () test: empty groupByCols → 1 bucket.

## Test Counts

Phase 1 + 02-01 + 02-02 = **101 tests passing** (was 82 before Plan 02-02).

## Requirement Coverage

- **AGGR-01** (COUNT(*) increments on every row): `COUNT(*) increments on every row, including empty rows and null fields`.
- **AGGR-02** (COUNT(field) skips null/undefined): `COUNT(field) skips null AND undefined, counts everything else`.
- **AGGR-03** (SUM/AVG/MIN/MAX numeric correctness): `SUM happy path`, `AVG happy path returns sum/count`, `MIN returns smallest, MAX returns largest`.
- **AGGR-06** (type-tagged group keys distinguish 1 vs "1"): `groupKey: integer 1 and string "1" produce DIFFERENT keys` + the SC #2 end-to-end anchor.
- **AGGR-08** (non-numeric warns + skips): `SUM of non-numeric warns and skips`, `SUM of NaN warns and skips`, `MIN/MAX skip null and warn on non-numeric`.
- **AGGR-09** (AVG-empty returns null, not NaN): `AVG over zero numeric inputs returns null`, `AVG over all-non-numeric input returns null`.

## LOCKED Decisions Implemented

1. **Group-key formula** — `JSON.stringify(vals.map(v => [typeof v, v]))` exactly as locked. Verified: int `1` → `'[["number",1]]'`, str `"1"` → `'[["string","1"]]'`, null → `'[["object",null]]'`, undefined → `'[["undefined",null]]'`.
2. **AGGR-08 warning channel** — `process.stderr.write` with `whoodb:` prefix, mirroring Phase 1 evaluator's malformed-line warning.
3. **AGGR-09 returns null** — verified by 2 distinct paths (zero inputs, all-non-numeric).
4. **MIN/MAX numeric only** — string min/max deferred per research (the SC #2 test uses string `agent` for grouping but MIN/MAX is on numeric `t`).
5. **No external imports** — only `import { resolvePath } from './project.js'`. Zero-deps invariant.

## Deviations from Plan

None — plan executed exactly as written. The fact that `groupValues` from `groupKey()` is unused in 4-bucket count assertion (test asserts `buckets.size === 4`) but used for spot-check of `aRow` / `oneNumeric` exactly matches the plan.

**Total deviations:** 0. **Impact:** clean.

## Status

Plan 02-02 done. Plan 02-03 (sort) ran in parallel — both feed into Plan 04 (evaluator wiring).
