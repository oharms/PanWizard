---
phase: 03-cli-dogfood
plan: 02
subsystem: dogfood
tags: [child_process, fork, npm-view, lock-contention, parallel-write]

requires:
  - phase: 01-core-library
    provides: createCache, ttl, atomic write, errors
  - phase: 02-concurrency-eviction
    provides: withLock retry+stale reclamation, child-writer.js fixture, eviction
provides:
  - dogfood/pan-check-update.js (whoocache fork of PAN's hooks/pan-check-update.js)
  - dogfood/parallel-test.js (1000×2 sustained-contention audit driver)
  - lock retry budget bumped to handle documented dogfood load
affects: [PAN-Wizard update-check hook (future migration target); future stress-test infrastructure]

tech-stack:
  added: []
  patterns:
    - "Top-level CommonJS `return` for hit-path early exit (avoids process.exit() stdout truncation per research §Pitfall 1)"
    - "Reuse Phase 2 child-writer.js fixture via WRITES env var override — no fixture duplication"
    - "Audit interpretation: 'lost write' = corruption only, NOT eviction (eviction is documented LRU behavior)"

key-files:
  created:
    - dogfood/pan-check-update.js
    - dogfood/parallel-test.js
  modified:
    - src/lock.js (Rule 1 deviation — lock retry budget bump)
    - test/lock.test.js (timeout widened to match new budget)

key-decisions:
  - "Locked from roadmap: createCache('pan-update', {maxEntries: 10}) namespace and cap"
  - "Lock retry budget MAX_ATTEMPTS=10 → 50 (Rule 1 bug fix surfaced by 1000×2 dogfood load)"
  - "STALE_AGE_MS 5000 → 15000 to keep retry budget below stale-reclamation threshold"
  - "Audit accepts ~1000 surviving entries (default maxEntries cap) — eviction is not lost writes"

patterns-established:
  - "Sustained-contention dogfood as the integration test for lock retry tuning"
  - "WHOOCACHE_DIR isolation pattern reused from CLI for dogfood scripts"

requirements-completed: [DOG-01, DOG-02, DOG-03]
test-tiers: [integration]

duration: 25min
completed: 2026-05-02
---

# Phase 03 Plan 02: Dogfood (pan-update + parallel audit) Summary

**Whoocache replaces PAN's ad-hoc pan-update-check.json with one createCache call (1h TTL, hit/miss/refresh) and survives a 1000×2 parallel-write audit with zero corruption — surfaced and fixed a lock-retry-budget gap in Phase 2**

## Performance

- **Duration:** ~25 min (mostly investigating + fixing the lock-retry-budget deviation)
- **Tasks:** 2 (pan-check-update.js, parallel-test.js)
- **Files modified:** 4 (2 dogfood scripts created + 2 lock files modified for the bug fix)

## Accomplishments
- `dogfood/pan-check-update.js` reproduces PAN's hook semantics on top of whoocache
  - First run: `CACHE MISS`, fetches via `npm view pan-wizard version`, caches with 1h TTL
  - Second run within TTL: `CACHE HIT`, no fetch
- `dogfood/parallel-test.js` forks two children, each writing 1000 keys
  - 3 consecutive runs: all PASS, ~10s wall-clock, ~1000 surviving entries (default cap), zero value corruption
- Surfaced and fixed a Phase 2 lock-retry gap (Rule 1 bug) that prevented the documented dogfood load from completing on Windows

## Task Commits

1. **Task 1: dogfood/pan-check-update.js** — `1640823` (feat)
2. **Lock retry bump (Rule 1 deviation)** — `64c0393` (fix)
3. **Task 2: dogfood/parallel-test.js** — `6a9623e` (feat)

## Files Created/Modified
- `dogfood/pan-check-update.js` — 77-line whoocache fork of PAN's update-check hook
- `dogfood/parallel-test.js` — 111-line standalone driver forking child-writer.js × 2
- `src/lock.js` — MAX_ATTEMPTS 10→50, STALE_AGE_MS 5000→15000, comment explaining trigger
- `test/lock.test.js` — timeout 5s→15s; renamed test to "after MAX_ATTEMPTS attempts"

## Decisions Made
- **Audit interpretation:** "lost write" means index says entry exists but read returns wrong value (corruption / torn write). Entries evicted by maxEntries=1000 cap are NOT lost — that is documented LRU behavior. The plan locked Option A; this summary confirms the interpretation.
- **Lock retry budget:** the existing 10-attempt budget (~1.3s) was sufficient for Phase 2's 50×2 fixture but insufficient for Phase 3's documented 1000×2 dogfood. Bumping to 50 attempts (~10s) and widening STALE_AGE_MS proportionally was the minimal fix. Library callers under non-pathological load (every Phase 1+2 test) still complete in <100ms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lock retry budget insufficient for documented dogfood load**
- **Found during:** Task 2 verification (`node dogfood/parallel-test.js`)
- **Issue:** Both child writers crashed mid-run with `LockTimeoutError: Could not acquire lock after 10 attempts`. Plan asserts "Re-running multiple times always passes" — actual behavior was 100% reproducible failure.
- **Root cause:** Phase 2 set MAX_ATTEMPTS=10 (~1.3s of jittered backoff). Two writers each holding the lock 5-10ms × 1000 ops fills 5-10s of cumulative contention. Peer waiters exhaust the budget before getting a turn.
- **Fix:** MAX_ATTEMPTS 10 → 50 (~10s budget at 200ms cap); STALE_AGE_MS 5000 → 15000 so the retry budget stays below the stale-reclamation threshold (otherwise the lockfile self-reclaims mid-retry, masking the test).
- **Files modified:** `src/lock.js`, `test/lock.test.js`
- **Verification:** 3 consecutive `node dogfood/parallel-test.js` runs all PASS; full test suite 72/72 still passes; no behavior change for non-pathological loads.
- **Committed in:** `64c0393`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for plan completion. The fix touches Phase 2 internals that the plan did not include in its files_modified, but the plan's success criterion "Re-running multiple times always passes" cannot be honored without it. Treated as Rule 1 (Bug fix) per execute-plan.md deviation rules. No scope creep — only retry tuning constants changed.

## Issues Encountered

- See deviation #1 above. The fix was straightforward once the retry math was clear (5-10s contention vs 1.3s budget).
- A node:child_process `fork`-spawned grandchild (the dogfood `child-writer.js` invocation) inherits stdio differently on Windows than on POSIX; the verify smoke for pan-check-update.js needed `timeout: 15000` to absorb npm-view network latency on first run. The plan already specified 15000.

## Next Phase Readiness
- Phase 3 deliverables complete; project is at the documented v1.0 surface (library + CLI + dogfood proof).
- The lock retry tuning gives ~10× more headroom for sustained-contention workloads, which de-risks any future high-throughput consumers.
- No blockers for milestone close-out.

---
*Phase: 03-cli-dogfood*
*Completed: 2026-05-02*
