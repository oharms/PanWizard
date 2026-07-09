---
phase: 02-concurrency-retry-backoff-json-format
plan: 01
subsystem: scheduler
tags: [concurrency, slot-based, parallelism, ndjson-prep, monotonic-seq]

requires:
  - phase: 01-parse-validate-sequential-run-atomic-state
    provides: slot-based ready-queue scheduler at cap=1, indegree tracking, atomic state writes, event emission shape
provides:
  - cap = opts.concurrency ?? 4 — semantic lift from hardcoded ?? 1
  - CLI passes parsed concurrencyN to runFlow (was hardcoded 1)
  - Monotonic seq counter on every emitted event (single source: scheduler closure)
  - parallel.test.js suite proving slot-based (NOT wave-based) behavior
affects:
  - 02-02 (retry): runTaskWithRetry will replace runTask call site at slot dispatch
  - 02-03 (--format json): JSON formatter consumes event.seq for ordering across interleaved parallel events
  - 02-04 (preflight): no direct dependency; CLI parseArgs config will be extended

tech-stack:
  added: []
  patterns:
    - "Slot-based scheduler with cap = opts.concurrency (no wave/batch barrier)"
    - "Monotonic seq generated in scheduler (single source of truth, race-free per microtask queue)"
    - "Programmatic 100-task fixture for perf gate (no committed fixture file)"
    - "Generous wall-clock upper bounds in tests per pitfall M4"

key-files:
  created:
    - test/parallel.test.js
  modified:
    - src/scheduler.js
    - src/cli.js
    - test/scheduler.test.js

key-decisions:
  - "cap default lifted from 1 to 4 (matches CLI default; defensive fallback for direct API callers)"
  - "seq generated in scheduler (single source), not in formatter — future text-format debug logs could use it too"
  - "duration_ns left as BigInt this plan; Plan 03 will convert at emit when JSON formatter lands"

patterns-established:
  - "Slot-based ready-queue scheduler: while (running.size < cap) — no batch barrier, no +1 starvation"
  - "Race-free seq via JS microtask queue (single-threaded .then continuations)"
  - "Test pattern: generous upper-bound wall-clock assertions to absorb CI/Windows spawn jitter"

requirements-completed: [SCHED-02, SCHED-03, SCHED-04]
test-tiers: [unit, integration]

duration: ~25 min
completed: 2026-05-02
---

# Phase 2 Plan 01: Slot-based scheduler with --concurrency Summary

**Slot-based ready-queue scheduler unlocked: cap = opts.concurrency, CLI wires concurrencyN through, every event carries a monotonic seq integer**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (all atomic-committed)
- **Files modified:** 3 (src/scheduler.js, src/cli.js, test/scheduler.test.js)
- **Files created:** 1 (test/parallel.test.js)
- **Tests:** 71 → 77 (+6 new tests; all passing)

## Accomplishments

- Lifted `cap = opts.concurrency ?? 1` to `?? 4` (defensive default matches CLI default)
- Added monotonic seqCounter closure in `runFlow`; every emitted event now carries `seq: <integer>`
- CLI now passes parsed `concurrencyN` to `runFlow` (was hardcoded `concurrency: 1`)
- Updated CLI help text and file header comments to reflect the lift
- Created `test/parallel.test.js` (5 tests): 100-task perf gate (SCHED-04), slow+fast wall-clock (SCHED-03/M2), cap=1 chain regression (M2), seq monotonicity (CC-5 #4), parallelism overlap proof
- Added scheduler.test.js smoke test confirming new default cap=4

## Task Commits

1. **Task 1: Lift scheduler cap and add seq counter** — `f7fd925`
2. **Task 2: Wire CLI --concurrency through** — `92b61df`
3. **Task 3: Tests (parallel.test.js + scheduler smoke)** — `bbf9eb0`

## Files Created/Modified

- `src/scheduler.js` — `cap = opts.concurrency ?? 4`; `seqCounter`/`nextSeq()` closure; seq added to all 6 emit sites (run-empty, run-complete, task-running, task-success, task-failed, defensive-failed)
- `src/cli.js` — `concurrency: concurrencyN` (was `concurrency: 1`); help text de-Phase-2-caveatted; file header updated
- `test/parallel.test.js` (new, ~150 LOC) — parallelism invariant suite
- `test/scheduler.test.js` — added Phase 2 default-cap smoke test

## Decisions Made

- **seq generation lives in the scheduler, not the formatter.** Single source of truth. The formatter (text or JSON) is the rendering boundary; the scheduler owns the canonical event surface. Future debug-log formatters can also benefit from seq.
- **duration_ns stays BigInt for now.** Plan 03 (JSON formatter) will convert to Number at emit because BigInt throws on JSON.stringify. Text formatter handles BigInt fine, so no change needed yet.
- **Default cap moved from 1 to 4.** The CLI passes the parsed value explicitly (default 4 from parseArgs config), so this fallback is essentially defensive for direct `runFlow(flow, state, {})` API callers.

## Deviations from Plan

**1. [Test fix] JSON.stringify on event objects with BigInt failed in seq test error message**
- **Found during:** Task 3 (running parallel.test.js)
- **Issue:** Used `JSON.stringify(e)` in test assertion error message; events have `duration_ns: BigInt` which throws.
- **Fix:** Replaced with shape-only message `${e.type}/${e.id ?? ''}/${e.status ?? ''}`.
- **Files modified:** test/parallel.test.js
- **Verification:** All 6 new tests pass.
- **Committed in:** `bbf9eb0` (part of Task 3 commit)

**Total deviations:** 1 auto-fixed (test cosmetics)
**Impact on plan:** None — pure test message fix. The underlying duration_ns BigInt is an intentional Phase 1 carryover that Plan 03 will convert.

## Issues Encountered

None.

## Next Phase Readiness

**Plan 02-02 (retry-with-backoff) consumes:**
- The `runTask(task)` call site at scheduler.js — Plan 02 swaps for `runTaskWithRetry(task, opts)`.
- The slot-hold semantic at concurrency=1 — structurally tested by the 5-task chain test in this plan; Plan 02's retry-mid-chain integration test extends it.

**Plan 02-03 (--format json) consumes:**
- The `seq` field on every event — JSON formatter just passes it through; consumers re-sort interleaved parallel events using seq.
- The duration_ns BigInt at emit — Plan 03 will convert to Number at the scheduler emit site so JSON.stringify works.

**Plan 02-04 (preflight) consumes:**
- No direct dependency; will extend the CLI parseArgs config alongside the existing `--concurrency` and (post-Plan 03) `--format` flags.

---
*Phase: 02-concurrency-retry-backoff-json-format*
*Plan: 01*
*Completed: 2026-05-02*
