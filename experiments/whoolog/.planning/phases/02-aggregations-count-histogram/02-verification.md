---
phase: 02-aggregations-count-histogram
verified: 2026-05-02
status: passed
verifier: orchestrator-inline
test_baseline: 42
test_after: 78
test_delta: +36
must_haves_total: 4
must_haves_verified: 4
requirements_total: 9
requirements_verified: 9
---

# Phase 2 Verification: Aggregations (count + histogram)

**Status: PASSED**

All four phase success criteria observable end-to-end via passing tests AND manual `node bin/whoolog.js` invocation. All nine phase requirements (CNT-01..03, HST-01..05, TST-04) traceable to specific test assertions.

## Phase Goal

> Users can aggregate log data with `count --by field` and `histogram --by ts --bucket 1h`, getting sorted results in stable JSONL shape.

**Verdict:** ACHIEVED. Both subcommands are user-facing via `bin/whoolog.js`; both emit the documented JSONL shapes; both are sorted as specified.

## Success Criteria

### SC-1 — count by field, sort desc, tie-break asc

> User can run `whoolog count --by level` and see `{value, count}` JSONL on stdout sorted by count descending, with ties broken by value ascending.

**Status:** PASSED

Manual verification (rows: 3×error, 2×info, 1×warn):
```
{"value":"error","count":3}
{"value":"info","count":2}
{"value":"warn","count":1}
```

Tie-break verification (3 values each at count 2 → sorted alpha asc):
- `count.test.js: tie-break by value asc (CNT-02)` — passing.

Tests:
- `count.test.js: basic top-level field, sorted desc by count (CNT-02)` — passing
- `count.test.js: tie-break by value asc (CNT-02)` — passing

### SC-2 — count by nested key, --help O(distinct values)

> User can run `whoolog count --by usage.model` (nested key) and get correct grouping; the `--help` text documents that memory is O(distinct values).

**Status:** PASSED

Manual verification:
```
$ whoolog count --files X --by usage.model
{"value":"gpt-4","count":2}
{"value":"claude-3","count":1}
$ whoolog count --help | grep "O(distinct values)"
Memory: O(distinct values). Avoid `--by` on high-cardinality fields ...
```

Tests:
- `count.test.js: nested key (CNT-01)` — passing
- `count.test.js: --help mentions O(distinct values) (CNT-03)` — passing

### SC-3 — histogram by ts, bucket 1h, sort asc, empty buckets omitted

> User can run `whoolog histogram --by ts --bucket 1h` and see `{bucket_start, count}` JSONL sorted by bucket_start ascending; buckets with zero rows are absent.

**Status:** PASSED

Manual verification (rows in 00:30 and 02:30; 01:00 bucket should be ABSENT):
```
{"bucket_start":"2026-04-01T00:00:00.000Z","count":1}
{"bucket_start":"2026-04-01T02:00:00.000Z","count":1}
```

Sort verification with unsorted input (rows at 05:00, 02:00, 07:00, 01:00 → output ascending):
- `histogram.test.js: output sorted ascending by bucket_start (HST-04)` — passing.

Tests:
- `histogram.test.js: basic 1h bucketing across multiple hours (HST-01, HST-04)` — passing
- `histogram.test.js: empty buckets are omitted (HST-05)` — passing
- `histogram.test.js: output sorted ascending by bucket_start (HST-04)` — passing
- `histogram.test.js: --help mentions empty buckets omitted (HST-05 doc)` — passing

### SC-4 — boundary semantics (TST-04)

> A row whose timestamp is exactly on a bucket boundary (e.g., `2026-04-01T01:00:00.000Z` with `--bucket 1h`) appears in the `01:00` bucket, not the `00:00` bucket.

**Status:** PASSED

Manual verification (rows at 00:30, 01:00, 01:30):
```
{"bucket_start":"2026-04-01T00:00:00.000Z","count":1}
{"bucket_start":"2026-04-01T01:00:00.000Z","count":2}
```
The 01:00 boundary row is in the 01:00 bucket (count 2), NOT the 00:00 bucket (count 1).

Tests:
- `histogram.test.js: TST-04 — row at exact bucket boundary lands in LATER bucket (HST-03)` — passing (Test 1 in the file for visibility)
- `time-bucket.test.js: bucketStart on exact boundary (HST-03 / TST-04)` — passing

## Requirements Verification

| Requirement | Description | Verified By |
|-------------|-------------|-------------|
| CNT-01 | count by single field, nested keys allowed | count.test.js: nested key |
| CNT-02 | {value,count} JSONL, sort count desc, tie-break value asc | count.test.js: basic + tie-break |
| CNT-03 | Memory O(distinct values), documented in --help | count.test.js: --help mentions O(distinct values) |
| HST-01 | histogram --by --bucket time-buckets matching rows | histogram.test.js: basic 1h, numeric epoch ms, nested key |
| HST-02 | Bucket sizes: 1m, 5m, 1h, 1d (fixed durations) | time-bucket.test.js: parseBucket(1m/5m/1h/1d) + invalid spec; histogram.test.js: 1d, 5m, invalid bucket |
| HST-03 | Math.floor(ts_ms/bucket_ms)*bucket_ms inclusive lower | time-bucket.test.js: boundary; histogram.test.js: TST-04 |
| HST-04 | {bucket_start,count} JSONL sorted ascending | histogram.test.js: sorted ascending from unsorted input |
| HST-05 | Empty buckets omitted, documented in --help | histogram.test.js: empty buckets omitted, --help mentions |
| TST-04 | Boundary row at exactly bucket_start belongs to that bucket | histogram.test.js Test 1 + time-bucket.test.js boundary test |

**All 9 requirements verified.**

## Test Suite Results

```
ℹ tests 78
ℹ pass  78
ℹ fail  0
ℹ duration_ms ~890
```

| Suite | Tests | Status |
|-------|-------|--------|
| Phase 1 (existing) | 42 | All passing |
| Phase 2 time-bucket | 12 | All passing |
| Phase 2 count | 9 | All passing |
| Phase 2 histogram | 15 | All passing |
| **Total** | **78** | **All passing** |

## Phase 2 New Code

| File | Lines | Role |
|------|-------|------|
| lib/time-bucket.js | 57 | Pure module: parseBucket + bucketStart + bucketStartIso |
| lib/histogram.js | 171 | histogram subcommand |
| lib/count.js | 171 | count subcommand |
| test/time-bucket.test.js | 66 | 12 unit tests |
| test/count.test.js | 151 | 9 integration tests |
| test/histogram.test.js | 216 | 15 integration tests |
| **Total** | **832** | |

`bin/whoolog.js` modified (+5/-2): two new dispatch branches and two updated help-text lines.

## Code Convention Compliance

- All new lib/*.js files start with `'use strict'` and end with `module.exports = { ... }` (CommonJS, no ESM).
- No `console.log` in lib/*.js (all output via `writeJsonl` or `process.stdout.write` in help functions).
- No `readFileSync` in lib/*.js (streaming only, per Pitfall 1).
- All test fixtures are programmatic (`fs.mkdtempSync`); no committed `.jsonl` files in `test/` (Pitfall 23 guarded; verified via `find test -name '*.jsonl'` returning nothing).
- All test assertions are shape-based (parsed JSONL + `deepEqual`/regex), not snapshot strings (Pitfall 22).
- Pitfall 10 (bucket boundary off-by-one): `Math.floor` confirmed — no `Math.ceil`/`Math.round`/`Math.trunc` in `lib/time-bucket.js`.
- Pitfall 11 (empty bucket documentation): `histogram --help` text contains "Buckets with zero matching rows are OMITTED".
- Pitfall 25 (giant Map): `count --help` text contains `O(distinct values)` warning + recommendation to use histogram for time-series.

## Issues Found

None.

## Gaps

None.

## Human Verification

Not required — all checks automated and passing.

---
*Verified: 2026-05-02 by orchestrator-inline*
