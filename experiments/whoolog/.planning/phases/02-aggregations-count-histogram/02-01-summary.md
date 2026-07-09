---
phase: 02-aggregations-count-histogram
plan: "01"
subsystem: aggregations-histogram
tags: [time-bucket, histogram, parseargs, async-iterators, jsonl]

requires:
  - phase: 01-streaming-foundation-filter (plan 01)
    provides: sources(), lines(), decode() streaming pipeline
  - phase: 01-streaming-foundation-filter (plan 02)
    provides: compileWhere, compileTimeFilter, compileKey predicate compilers
  - phase: 01-streaming-foundation-filter (plan 03)
    provides: writeJsonl, runCLI helper
provides:
  - lib/time-bucket.js — parseBucket + bucketStart + bucketStartIso (HST-02, HST-03)
  - lib/histogram.js — histogram subcommand: parseArgs + accumulate Map + sorted JSONL emit
  - bin/whoolog.js — histogram dispatch wired
affects: [02-02]

tech-stack:
  added: []
  patterns:
    - "Pure-math module with usage-error sentinel (.usage = true) for routing exit code"
    - "Accumulate-then-emit Map<bucket_ms, count> with Math.floor inclusive-lower formula"

key-files:
  created:
    - lib/time-bucket.js
    - lib/histogram.js
  modified:
    - bin/whoolog.js

key-decisions:
  - "parseBucket regex (^(\\d+)([mhd])$) accepts any positive integer with one of m/h/d. The HST-02 list (1m, 5m, 1h, 1d) is exemplary — values like 15m or 2h work without special-casing. Seconds (s) is NOT in the unit table; explicit rejection (exit 2 with .usage = true)."
  - "Output sort comparator on numeric bucket_start ms ((a,b) => a[0] - b[0]) instead of locale-string compare on ISO. Numeric is unambiguous and faster; ISO sorts identically only because the Z-suffix ISO format is naturally lex-sortable, but the numeric form removes any doubt."
  - "Rows where getByField returns undefined/null/object/boolean → silently skipped. Rows where the value is a string that new Date() returns NaN for → also silently skipped. Same fail-quiet posture as time-filter.js for missing-ts."

patterns-established:
  - "Subcommand module shape: parseArgs(strict, allowPositionals:false) → help/TTY/required-flag gates → compile-once → for-await stream → accumulate → sort → writeJsonl"
  - "Required-flag validation BEFORE opening any files (research §3): missing --by or --bucket exits 2 without touching the filesystem"

requirements-completed:
  - HST-01
  - HST-02
  - HST-03
  - HST-04
  - HST-05

test-tiers: [unit-implicit]

duration: ~10 min
completed: 2026-05-02
---

# Phase 2 Plan 01: Time-bucket + histogram subcommand Summary

**Time-bucket calculator and histogram subcommand wired up. HST-02 (units), HST-03 (Math.floor formula + boundary semantics), HST-04 (sort ascending), HST-05 (omit empty buckets) all implemented in pure modules. Wave-1 deliverable for Phase 2.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3
- **Files created:** 2 (`lib/time-bucket.js` 57 lines, `lib/histogram.js` 171 lines)
- **Files modified:** 1 (`bin/whoolog.js`)

## Accomplishments

- `lib/time-bucket.js` (57 lines): exports `parseBucket(spec) → ms`, `bucketStart(tsMs, bucketMs) → ms` (Math.floor formula), `bucketStartIso(tsMs, bucketMs) → ISO string`. Pure module — no fs, no streams, no other lib/ deps.
- `lib/histogram.js` (171 lines): exports async `run(argv)`. Reuses every Phase 1 utility unchanged (sources, lines, decode, compileWhere, compileTimeFilter, compileKey, writeJsonl) plus the new time-bucket. Map<bucket_ms, count> accumulator, sorted ascending, `{bucket_start, count}` JSONL output.
- `bin/whoolog.js`: added `else if (SUB === 'histogram')` branch dispatching to `require('../lib/histogram').run(...)`. Top-level help line for histogram updated from `(Phase 3)` placeholder to actual description.

## Task Commits

1. **Task 1: lib/time-bucket.js** — `06eebda` (feat)
2. **Task 2: lib/histogram.js** — `6284ee7` (feat)
3. **Task 3: bin/whoolog.js dispatch** — `1a719f8` (feat)

## Files Created/Modified

- `lib/time-bucket.js` — created (57 lines)
- `lib/histogram.js` — created (171 lines)
- `bin/whoolog.js` — modified (+3/-1)

## Decisions Made

- Bucket formula uses `Math.floor(tsMs / bucketMs) * bucketMs` — verified inline (Task 1 verify) against the TST-04 boundary case (`2026-04-01T01:00:00.000Z` with `--bucket 1h` → bucket_start `2026-04-01T01:00:00.000Z`, NOT `00:00:00.000Z`).
- Numeric sort comparator on bucket_start ms (not locale-string compare on ISO) — unambiguous and matches the architecture-doc spec.
- Unparseable timestamps (NaN from `new Date()`, missing field, null intermediate) silently skipped — same posture as `time-filter.js` for missing-ts.

## Deviations from Plan

None.

## Verification Results

| Gate | Status |
|------|--------|
| `node --check lib/time-bucket.js` | passes |
| `node --check lib/histogram.js` | passes |
| `node --check bin/whoolog.js` | passes |
| `parseBucket('1h') === 3_600_000` | passes |
| `parseBucket('5m') === 300_000` | passes |
| `parseBucket('1d') === 86_400_000` | passes |
| `parseBucket('1s')` throws with `.usage = true` | passes |
| Boundary: `bucketStart(2026-04-01T01:00:00Z, 1h) === ts itself` | passes |
| Mid-bucket: `bucketStartIso(00:30, 1h) === 00:00` | passes |
| `! grep -qE "Math\\.(ceil|round|trunc)" lib/time-bucket.js` | passes (no matches) |
| `grep -q "compileKey" lib/histogram.js` | passes |
| `grep -q "Buckets with zero" lib/histogram.js` | passes |
| `! grep -q "console.log" lib/histogram.js lib/time-bucket.js` | passes |
| `node bin/whoolog.js histogram --help; exit 0` | passes |
| `node bin/whoolog.js histogram` (no args) → exit 2 with `requires --by` | passes |

## Module Exports Surface

| File | Exports |
|------|---------|
| `lib/time-bucket.js` | `parseBucket`, `bucketStart`, `bucketStartIso` |
| `lib/histogram.js` | `run` |

## Next Plan Readiness

Plan 02-02 can now:
- Write integration tests against `whoolog histogram` via the existing `runCLI` helper.
- Write unit tests against `lib/time-bucket.js` directly.
- Wire the `count` dispatch in `bin/whoolog.js` (file-conflict resolution per the plan dependency).
- Reuse all Phase 1 utilities + the new `time-bucket.js` for `lib/count.js`.

## User Setup Required

None.

---
*Phase: 02-aggregations-count-histogram*
*Completed: 2026-05-02*
