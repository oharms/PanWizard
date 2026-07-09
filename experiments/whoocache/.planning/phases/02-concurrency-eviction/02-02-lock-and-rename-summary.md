---
phase: 02-concurrency-eviction
plan: 02
subsystem: concurrency
tags: [lockfile, o-excl, atomics, windows, rename-retry]

requires:
  - phase: 01-core-library
    provides: errors.LockTimeoutError, atomic-write skeleton, withLock signature
provides:
  - Real O_EXCL lockfile with PID-aware stale reclamation, jittered backoff via Atomics.wait, LockTimeoutError after 10 attempts
  - Windows EPERM rename retry wrapper in atomic-write.js (PLAT-02)
  - isLockStale exported for unit testing
affects: [02-03-integration-and-phase-tests]

tech-stack:
  added: []
  patterns:
    - "Synchronous sleep via Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) — no spin, no subprocess"
    - "PID-liveness check via process.kill(pid, 0) — ESRCH=dead, EPERM=alive-not-ours"
    - "Pitfall-3 Windows zombie defense: live PID with age > STALE_AGE_MS treated as stale"

key-files:
  created:
    - src/lock.js (rewritten from no-op shim to real implementation)
    - test/lock.test.js
  modified:
    - src/atomic-write.js (renameWithRetry helper, fs.renameSync call site swap)

key-decisions:
  - "Stale-lock reclamation costs one of 10 attempts (using `continue`, not `attempt--`) — simpler, and TEST-14 verified reclamation succeeds within budget"
  - "isLockStale returns true on JSON.parse failure — defensive, conservative; the next reclaim+retry is safe"
  - "Atomics.wait per-call SharedArrayBuffer allocation — sync library; allocation cost is negligible vs. sleep duration"
  - "renameWithRetry only retries on `EPERM && win32` — POSIX EPERM and any other error propagate immediately, preserving Phase 1 behavior on Linux/macOS"

patterns-established:
  - "Lock + retry pattern: try acquire → check stale → reclaim or backoff → max 10 attempts → throw with path"
  - "Sync sleep primitive: Atomics.wait, reused in lock.js and atomic-write.js renameWithRetry"

requirements-completed: [CONC-01, CONC-02, CONC-03, CONC-04, CONC-05, PLAT-02, TEST-14]
test-tiers: [unit]

duration: 5min
completed: 2026-05-02
---

# Phase 02 Plan 02: Lock + Rename Retry Summary

**Real O_EXCL lockfile with PID-stale reclamation, Atomics.wait backoff, and Windows EPERM rename retry**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-02T12:09Z
- **Completed:** 2026-05-02T12:14Z
- **Tasks:** 3
- **Files created:** 1 (test/lock.test.js)
- **Files modified:** 2 (src/lock.js body replaced, src/atomic-write.js renameWithRetry added)

## Accomplishments
- src/lock.js: O_CREAT | O_EXCL | O_WRONLY acquisition; JSON {pid, acquired} content; isLockStale truth-table-correct
- LockTimeoutError after 10 attempts carries lockfilePath for caller diagnostics (CONC-05)
- Atomics.wait jittered exponential backoff (base 10ms + jitter, capped at 200ms)
- src/atomic-write.js: renameWithRetry wraps fs.renameSync — 5 retries on Windows EPERM with 50ms Atomics.wait sleep
- 7 unit tests in test/lock.test.js cover CONC-01/02/03/05 and TEST-14 stale-PID reclamation
- Phase 1's 37 tests still pass — cache.js call sites untouched

## Task Commits

1. **Task 1: Rewrite src/lock.js with real O_EXCL body** — `e07e9ee` (feat)
2. **Task 2: renameWithRetry in atomic-write.js** — `e07e9ee` (feat, folded with Task 1)
3. **Task 3: test/lock.test.js** — `e07e9ee` (folded since Task 1 verify required tests)

All three tasks committed atomically — the lock body, the rename-retry, and the lock tests are interdependent (the smoke test required the full body present).

## Files Created/Modified
- `src/lock.js` — body replaced; signature unchanged (`withLock(lockPath, fn) -> T`); now exports `withLock` and `isLockStale`
- `src/atomic-write.js` — added `renameWithRetry` helper; replaced bare `fs.renameSync(tmpPath, targetPath)` with `renameWithRetry(tmpPath, targetPath)`. `writeAtomic`'s OWFCRD sequence is preserved.
- `test/lock.test.js` (new) — 7 unit tests; CONC-05 timeout test takes ~1.4s (the 10-attempt backoff sum)

## Decisions Made
- **Used `continue` (not `attempt--`)** in the stale-reclamation branch — per the plan's locked decision. TEST-14 verifies one stale-reclamation succeeds within the 10-attempt budget.
- **isLockStale on parse-failure → true** — garbage content reclaimed; the next acquire is atomic so no race risk.
- **renameWithRetry caller-side**: `writeAtomic` is the only caller. Helper is private (not exported); a Linux CI runner cannot exercise the win32 branch (PLAT-05 is an out-of-band CI gate).

## Deviations from Plan

None — plan executed exactly as written. The CONC-05 test takes ~1.4 seconds; the plan called this out and recommended `{ timeout: 5000 }` which I applied.

## Issues Encountered
None.

## Next Phase Readiness
- src/lock.js is now multi-process safe via O_EXCL. cache.js call sites can now rely on real mutual exclusion.
- src/atomic-write.js renameWithRetry positions us for PLAT-02 verification on Windows CI (PLAT-05).
- Plan 02-03 will integrate eviction (02-01) + the live lock (this plan) into cache.js.

---
*Phase: 02-concurrency-eviction*
*Completed: 2026-05-02*
