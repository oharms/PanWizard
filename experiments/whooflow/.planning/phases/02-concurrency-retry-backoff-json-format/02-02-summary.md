---
phase: 02-concurrency-retry-backoff-json-format
plan: 02
subsystem: scheduler
tags: [retry, backoff, jitter, exponential-backoff, slot-hold]

requires:
  - phase: 01-parse-validate-sequential-run-atomic-state
    provides: runTask single-attempt primitive, markRunning/atomicWriteJson state helpers, slot-based dispatch
  - phase: 02-01
    provides: cap = opts.concurrency, seq counter on events, parallel.test.js fixture pattern
provides:
  - src/retry.js — runTaskWithRetry wrapping runTask with capped jittered backoff
  - MAX_BACKOFF_MS = 30000 constant
  - persistAttempt(n) closure pattern (scheduler-supplied; no state.js import in retry.js)
  - 'running' event emitted only on attempt 1 (Pattern 4: retries transparent to scheduler)
  - 5-task chain at concurrency 1 with mid-chain retry integration test (slot-hold proof)
affects:
  - 02-03 (--format json): event shape unchanged (failed events still have id/status/attempts/exit_code/duration_ns/seq)
  - 02-04 (preflight): no direct dependency
  - phase 3 (resume + skip-downstream): opts.signal threaded from CLI AbortController; resume merges see correct attempts counter from EXEC-05 persist-before-sleep

tech-stack:
  added: []
  patterns:
    - "Retry wrapper as separate file (architecture.md Pattern 4)"
    - "Capped exponential backoff with equal jitter (delay * (0.5 + random*0.5))"
    - "Persist-before-sleep: state file shows attempt count BEFORE backoff begins"
    - "Slot-hold via single awaited Promise — running.add/delete bracket the await"
    - "Injectable sleepFn + randomFn for deterministic test math"

key-files:
  created:
    - src/retry.js
    - test/retry.test.js
  modified:
    - src/scheduler.js
    - test/parallel.test.js

key-decisions:
  - "Scheduler removes its own markRunning + atomicWriteJson; retry.js calls persistAttempt for ALL attempts including the first (avoids double-increment for attempts:1 case)"
  - "'running' event emitted ONLY on attemptNumber===1 (per-attempt running events would break Pattern 4)"
  - "MAX_BACKOFF_MS = 30000 (30s) — caps DoS retry storm at 6-day waits down to bounded 30s waits"
  - "Equal-jitter (0.5..1.0x) chosen over full jitter — preserves meaningful spread without instant retries"
  - "AbortSignal accepted as opts.signal scaffold; Phase 2 doesn't wire it; Phase 3 will"

patterns-established:
  - "retry.js has zero imports from state.js or scheduler.js — clean test seam"
  - "Test pattern: marker-file pattern for retry-then-success (subprocess writes attempt count to file)"
  - "persistAttempt callback as the only state mutation pathway from retry.js"

requirements-completed: [EXEC-03, EXEC-04, EXEC-05]
test-tiers: [unit, integration]

duration: ~25 min
completed: 2026-05-02
---

# Phase 2 Plan 02: Retry/Backoff Summary

**Retry-with-bounded-jittered-backoff wrapper around runTask: capped at 30s, equal-jitter, persist-before-sleep, single-Promise slot-hold semantic**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (split task 1+2 as separate atomic commits)
- **Files modified:** 2 (src/scheduler.js, test/parallel.test.js)
- **Files created:** 2 (src/retry.js, test/retry.test.js)
- **Tests:** 77 → 86 (+9 new tests; all passing)

## Accomplishments

- `src/retry.js` exports `runTaskWithRetry(task, opts)` and `MAX_BACKOFF_MS=30000`
- Off-by-one defense: `for (attempt=1; attempt<=attempts; attempt++)`; sleep skipped after last attempt
- Equal-jitter formula: `delay = min(MAX, base * 2^(n-1)) * (0.5 + random*0.5)`
- `persistAttempt(n)` called BEFORE runTask AND BEFORE any sleep on every iteration
- Scheduler uses `runTaskWithRetry` instead of `runTask`; persistAttempt closure captures state/id/stateFile
- 'running' event emitted only on attempt 1 (Pattern 4 — retries transparent to scheduler/event consumers)
- 8 retry.js unit tests + 1 parallel.test.js integration test (5-task chain w/ middle-retry at concurrency 1)

## Task Commits

1. **Task 1: Create src/retry.js** — `b56549a` (feat)
2. **Task 2: Wire scheduler to runTaskWithRetry** — `9785415` (feat)
3. **Task 3: Tests (retry.test.js + parallel.test.js EXEC-04 chain)** — `e0d2486` (test)

## Files Created/Modified

- `src/retry.js` (new, ~88 LOC) — exports runTaskWithRetry, MAX_BACKOFF_MS; defaultSleep with AbortSignal scaffold
- `src/scheduler.js` — pump() body refactored: persistAttempt closure, runTaskWithRetry call, 'running' event gated on attempt===1, runTask import replaced with runTaskWithRetry
- `test/retry.test.js` (new, ~155 LOC) — 8 tests covering math, off-by-one, cap, persist-before-sleep, jitter, real-spawn
- `test/parallel.test.js` — added EXEC-04 5-task chain test

## Decisions Made

- **markRunning ownership moved fully into persistAttempt.** The Phase 1 scheduler called `markRunning + atomicWriteJson` directly in pump() before spawn. With retry, that would double-increment for attempts:1 tasks (scheduler increments to 1, then retry.js calls persistAttempt(1) which increments again to 2). Solution: scheduler stops calling markRunning directly; retry.js calls persistAttempt for ALL attempts including the first. State-file content is identical to Phase 1 for attempts:1 tasks (markRunning called once per task either way).
- **'running' event gated on attempt===1.** Per-attempt running events would expose retry internals to event consumers — breaks Pattern 4 (scheduler sees one ok|fail per task; retries are transparent). Final 'running' event semantics: "task started overall," not "this attempt is starting."
- **AbortSignal scaffold only.** opts.signal is accepted; defaultSleep checks signal.aborted; CLI does NOT pass an active signal in Phase 2. Phase 3 wires SIGINT-triggered AbortController.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Plan 02-03 (--format json) consumes:**
- Failed events have unchanged shape: `id, status, attempts, exit_code, duration_ns, seq` (retry's hidden retries don't change the event surface).
- duration_ns at emit is still BigInt — Plan 03 converts to Number at the scheduler emit site so JSON.stringify works.

**Phase 3 will consume:**
- `opts.signal` parameter threaded from a CLI-level AbortController triggered by SIGINT.
- Resume-merge will see correct `attempts` counter for tasks killed mid-sleep (because EXEC-05 persisted before the sleep).

---
*Phase: 02-concurrency-retry-backoff-json-format*
*Plan: 02*
*Completed: 2026-05-02*
