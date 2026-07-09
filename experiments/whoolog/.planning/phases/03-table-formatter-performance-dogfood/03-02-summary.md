---
phase: 03-table-formatter-performance-dogfood
plan: "02"
subsystem: performance-dogfood
tags: [perf, fixture, dogfood, highwatermark, streaming, integration-tests]

requires:
  - phase: 01-streaming-foundation-filter (plan 01)
    provides: lib/source.js (sources, lines, expandGlob, toPosix)
  - phase: 03-table-formatter-performance-dogfood (plan 01)
    provides: --format table wiring (used by dogfood table cross-link test)
provides:
  - lib/source.js — highWaterMark: 256 KiB on fs.createReadStream (Windows readline mitigation)
  - scripts/gen-fixture.js — deterministic 1 M-line JSONL fixture generator with backpressure handling
  - test/perf.test.js — TST-05 perf integration tests (filter <10s, histogram <15s, sanity --where)
  - test/dogfood.test.js — DOG-01 tokens.jsonl + missing-file path + FMT-05 forward-slash
affects: [verification, future v1.1 polish]

tech-stack:
  added: []
  patterns:
    - "256 KiB highWaterMark on fs.createReadStream — mitigates Windows readline default-64KiB overhead"
    - "Deterministic fixture generator with drain-loop backpressure pattern (writeLines/writeMore split)"
    - "Wall-clock perf assertions with 2x hard-kill timeout — passing on elapsed ms, not on the timeout"
    - "spawnSync encoding: 'buffer' to avoid string-decode overhead skewing perf timing"
    - "SKIP_PERF env gate skips fixture+tests for fast local iteration"
    - "fs.existsSync gate on dogfood test makes it portable to fresh clones without tokens.jsonl"

key-files:
  created:
    - scripts/gen-fixture.js
    - test/perf.test.js
    - test/dogfood.test.js
  modified:
    - lib/source.js

key-decisions:
  - "highWaterMark: 256 * 1024 (4x default) is the only behavioral change to source.js. Inline comment cites research and TST-05 as the validation point."
  - "Fixture generator split into writeLines/writeMore for clean backpressure handling. A pure synchronous loop would buffer ~100 MB in memory and risk OOM during fixture generation."
  - "Perf thresholds (10s filter / 15s histogram) are LOCKED at requirement-level. If timing regresses, surface in summary; do NOT silently relax."
  - "Sanity check (filter --where level=error) asserts exact 100,000 matches — regression check on the predicate hot loop."
  - "Dogfood missing-file test verifies three stack-trace shapes are absent (Error:, '    at ', TypeError) — covers throw, unhandled rejection, sync uncaught."
  - "Total-count fidelity check (sum of count == file line count) catches any silent row drop regression."

patterns-established:
  - "Perf integration test shape: before() generates fixture, tests use spawnSync wall-clock timing, after() cleans up. SKIP_PERF gates everything."
  - "Dogfood test shape: existence-gated success path + always-on missing-file path. Portable across fresh clones."

requirements-completed:
  - TST-05
  - DOG-01

test-tiers: [integration]

duration: ~12 min
completed: 2026-05-02

# Recorded perf timings on dev machine (Windows 11, Node 24.15.0):
perf-actuals:
  fixture_gen_1M_lines_ms: 2896
  fixture_size_mb: 131.4
  filter_1M_ms: 3259      # limit 10000
  histogram_1M_ms: 1158   # limit 15000
  filter_where_1M_ms: 1367
  filter_where_match_count: 100000
---

# Phase 3 Plan 02: Perf + Dogfood Summary

**1 M-line perf gate validated end-to-end (filter 3.3s / 10s limit; histogram 1.2s / 15s limit); dogfood gate locks tokens.jsonl integration and missing-file ergonomics. `lib/source.js` bumped to 256 KiB highWaterMark. 7 new tests (3 perf + 4 dogfood). Total: 110/110 passing (107 + 3 perf gated by SKIP_PERF).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files created:** 3 (`scripts/gen-fixture.js` 86 lines, `test/perf.test.js` 112 lines, `test/dogfood.test.js` 79 lines)
- **Files modified:** 1 (`lib/source.js` — single-line highWaterMark addition + 3-line comment)

## Accomplishments

- `lib/source.js`: `fs.createReadStream(file, { highWaterMark: 256 * 1024 })` — 4x the Node default, mitigates the Windows readline throughput penalty documented in research and state.md.
- `scripts/gen-fixture.js` (86 lines): deterministic JSONL generator. CLI `node scripts/gen-fixture.js <outfile> <n_lines>`. Same N produces byte-identical output (locked dictionaries: 4 agents, 3 models, 1-minute step from 2026-01-01T00:00:00Z, 10% error rate). Drain-loop backpressure handling (writeLines/writeMore).
- `test/perf.test.js` (112 lines, 3 tests): generates 1 M-line / 131.4 MB fixture in `before()`, runs `filter` and `histogram` against it with wall-clock asserts, deletes fixture in `after()`. SKIP_PERF=1 skips everything.
- `test/dogfood.test.js` (79 lines, 4 tests): success path on real `.planning/metrics/tokens.jsonl` (existence-gated), missing-file exit-1 with no stack trace, FMT-05 forward-slash path message, and `--format table` cross-link with the Plan 03-01 formatter.

## Task Commits

1. **Task 1: highWaterMark + scripts/gen-fixture.js** — `b077612` (feat)
2. **Task 2: 1M-line perf tests (TST-05)** — `b048291` (test)
3. **Task 3: DOG-01 dogfood tests** — `1ef1b83` (test)

## Files Created/Modified

- `lib/source.js` — single-line behavioral change (highWaterMark)
- `scripts/gen-fixture.js` — new deterministic fixture generator
- `test/perf.test.js` — TST-05 perf integration tests
- `test/dogfood.test.js` — DOG-01 + FMT-05 dogfood tests

## Decisions Made

See key-decisions in frontmatter. Notable:
- Fixture generator handles backpressure with a writeLines/writeMore split rather than a single sync loop — measured 2.9s gen for 131 MB.
- Perf thresholds left at requirement-level (10s/15s); actuals (3.3s/1.2s) leave plenty of headroom.

## Recorded Timings (Dev Machine)

| Metric | Value | Limit |
|--------|-------|-------|
| Fixture gen (1 M lines) | 2896 ms | 60000 ms |
| Fixture size | 131.4 MB | (>50 MB sanity) |
| filter 1M | **3259 ms** | 10000 ms |
| histogram 1M | **1158 ms** | 15000 ms |
| filter --where level=error | 1367 ms | (sanity, no perf assert) |
| filter --where match count | 100000 | exact (every 10th row) |

## Deviations from Plan

None — plan executed exactly as written. All grep gates pass:
- `grep -q "highWaterMark: 256" lib/source.js` -> present
- `grep -q "1_000_000" test/perf.test.js` -> present
- `grep -q "SKIP_PERF" test/perf.test.js` -> present
- `grep -q "tokens.jsonl" test/dogfood.test.js` -> present
- `grep -q "fs.existsSync" test/dogfood.test.js` -> present
- `grep -q "stack trace" test/dogfood.test.js` -> present
- No `*.jsonl` fixtures committed in test/

## Issues Encountered

None. The Windows readline penalty documented in state.md proved nonblocking — actual filter timing is 3.3s, well under the 10s limit.

## Next Phase Readiness

- Phase 3 success criterion #2 (1 M-line filter < 10s, histogram < 15s, no OOM) is observable.
- Phase 3 success criterion #3 (DOG-01 — count on real tokens.jsonl works; missing file exits 1 cleanly) is observable.
- v1 CLI is feature-complete and validated against real performance + real data.
- Ready for `/pan:verify-phase`.

---
*Phase: 03-table-formatter-performance-dogfood*
*Completed: 2026-05-02*
