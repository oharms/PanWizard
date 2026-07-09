---
phase: 02
phase_name: concurrency-retry-backoff-json-format
status: passed
verified: 2026-05-02
verified_by: orchestrator-inline
test_count: 105
test_baseline: 71
must_haves_satisfied: 9
must_haves_total: 9
---

# Phase 2 Verification Report

**Status:** PASSED — all 9 phase requirements satisfied; all 105 tests pass; goal achieved.

## Phase Goal Verification

**Phase goal:** A user with a parallelizable flow gets wall-clock speedup proportional to `--concurrency`; transient failures retry with bounded jittered backoff; machine consumers can parse the run via NDJSON events on stdout. The sequential scheduler from Phase 1 becomes a slot-based ready-queue (not a wave/batch barrier).

| Goal sub-claim | Verified by | Status |
|----------------|-------------|--------|
| Wall-clock speedup proportional to --concurrency | parallel.test.js: 100 trivial tasks under 3000ms at concurrency 4 (SCHED-04 perf gate) | passed |
| Transient failures retry with bounded jittered backoff | retry.test.js: 8 tests covering attempts/cap/jitter/persist-before-sleep | passed |
| NDJSON events on stdout | json-formatter.test.js + integration test (--format json) | passed |
| Slot-based ready-queue (NOT wave/batch barrier) | parallel.test.js: 1 slow + 4 fast at concurrency 2 finishes well below serial-equivalent | passed |

## Requirements Traceability

Phase 2 covers 9 requirements from requirements.md. Each is verified against the actual codebase.

| Req ID | Description | Verified by (test or source) | Status |
|--------|-------------|------------------------------|--------|
| CLI-04 | `--format text\|json` NDJSON | json-formatter.test.js (5 tests) + integration (--format json/xml) | satisfied |
| CLI-05 | `--dry-run` prints planned waves | preflight.test.js (printDryRun on linear/diamond) + integration | satisfied |
| CLI-06 | `--list` prints task ids + deps | preflight.test.js (printList on linear/diamond/single) + integration | satisfied |
| SCHED-02 | Slot-based ready-queue (NOT batch/wave) | parallel.test.js: 1 slow + 4 fast at concurrency 2 (slot-based proof); src/scheduler.js line 100 `while (running.size < cap)` | satisfied |
| SCHED-03 | Independent tasks run in parallel up to N | parallel.test.js: 4 independent at concurrency 4 — running events overlap before any success | satisfied |
| SCHED-04 | 100 trivial tasks under 3s at concurrency 4 | parallel.test.js: SCHED-04 perf gate test | satisfied |
| EXEC-03 | Retry up to attempts with exponential backoff | retry.test.js: attempts:1/2/3 tests + cap test + jitter formula tests | satisfied |
| EXEC-04 | Slot held during backoff at concurrency 1 | parallel.test.js: 5-task linear chain at concurrency 1 with middle-retry-twice — all 5 succeed, no deadlock | satisfied |
| EXEC-05 | Persist attempts BEFORE backoff sleep | retry.test.js: persist-before-sleep ordering test (interleaved log) | satisfied |

## Two Critical Acceptance Tests (Phase Plan)

| Test | Plan | Result |
|------|------|--------|
| 100 trivial tasks under 3s at --concurrency 4 | 02-01 Task 3 | PASS |
| 5-task linear chain at --concurrency 1 with retry-in-the-middle | 02-02 Task 3 | PASS |

## Tests Summary

- **Baseline (Phase 1):** 71 tests
- **After Phase 2:** 105 tests
- **New tests this phase:** +34 (across parallel.test.js, retry.test.js, json-formatter.test.js, preflight.test.js, scheduler.test.js, integration.test.js)
- **All passing:** yes

## Pitfall Mitigations Verified

| Pitfall | Mitigation | Verified by |
|---------|------------|-------------|
| C7 off-by-one | attempts:N means N total runs; sleep skipped after last attempt | retry.test.js |
| C7 retry storm cap | MAX_BACKOFF_MS = 30_000 (30s); attempts:20+base:1000 still capped | retry.test.js |
| C7 equal-jitter | delay * (0.5 + random*0.5) | retry.test.js (random=0.0/0.5/1.0) |
| C7 persist-before-sleep | persistAttempt called BEFORE every sleep | retry.test.js (interleaved log) |
| M2 deadlock-at-N=1 | Slot held during backoff sleep — single awaited Promise | parallel.test.js (5-task chain) |
| M2 wave starvation | Slot-based, no batch barrier | parallel.test.js (1 slow + 4 fast) |
| M3 listener leak | Single named SIGINT/SIGTERM handler at startup | src/cli.js handleSigint |
| M4 test flakiness | Generous wall-clock upper bounds; injectable sleepFn/randomFn | retry.test.js + parallel.test.js |
| N1 NDJSON discipline | One JSON.stringify(event) + '\n' per write; no \r; single-line | json-formatter.test.js |
| N4 BigInt -> Number | Convert at scheduler emit (not formatter) | scheduler.js + json-formatter.test.js |
| CC-5 #4 monotonic seq | Single source in scheduler closure; race-free per microtask queue | parallel.test.js (diamond) + json-formatter.test.js |

## Plans Completed

| Plan | Title | Commits | Tests added |
|------|-------|---------|-------------|
| 02-01 | Slot-based scheduler with --concurrency | 3 atomic + 1 docs | +6 |
| 02-02 | Retry/backoff with persist-before-sleep | 3 atomic + 1 docs | +9 |
| 02-03 | --format json NDJSON output | 3 atomic + 1 docs | +7 |
| 02-04 | Preflight (--list/--dry-run) + SIGINT discipline | 2 combined + 1 docs | +12 |

## Smoke Tests

- `node bin/whooflow.js run --file test/fixtures/diamond.json --concurrency 2` — exit 0, 4/4 success
- `node bin/whooflow.js run --file test/fixtures/diamond.json --dry-run` — prints wave 1: A / wave 2: B, C / wave 3: D
- `node bin/whooflow.js --help` — documents all new flags

## Files Created (Phase 2)

- src/retry.js (88 LOC)
- src/preflight.js (70 LOC)
- test/parallel.test.js (~180 LOC)
- test/retry.test.js (~155 LOC)
- test/json-formatter.test.js (~165 LOC)
- test/preflight.test.js (~115 LOC)

## Files Modified (Phase 2)

- src/scheduler.js — cap lift, seq counter, runTaskWithRetry, persistAttempt closure, BigInt -> Number
- src/cli.js — concurrencyN passthrough, --format flag, preflight dispatch, --dry-run/--list flags, SIGINT/SIGTERM handlers
- src/formatter.js — createJsonFormatter sibling, formatDuration polymorphic
- test/scheduler.test.js — Phase 2 default-cap smoke
- test/integration.test.js — +6 tests (--format json/xml, --list, --dry-run, --list on cycle, --list+--dry-run)

## Conclusion

Phase 2 successfully transitions whooflow from a Phase 1 sequential runner to a fully parallelizable runner with retry/backoff and machine-readable output. All 9 phase requirements are satisfied with verifiable tests. The two critical acceptance tests (100-task perf gate at concurrency 4; 5-task chain at concurrency 1 with mid-chain retry) both pass. Phase 3 (resume + skip-downstream + dogfood) can now build on a stable parallel runner.
