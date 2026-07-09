---
phase: 01-parse-validate-sequential-run-atomic-state
plan: 04
subsystem: scheduler
tags: [scheduler, ready-queue, indegree, formatter, ansi, hrtime]

requires:
  - phase: "01"
    provides: "validatedFlow, state shape, runTask, atomicWriteJson, transition helpers"
provides:
  - "runFlow(validatedFlow, state, opts) — slot-based scheduler at cap=1"
  - "createTextFormatter() — event subscriber, glyphs + durations + summary"
  - "shouldUseColor / shouldUseAscii helpers"
affects: [cli]

tech-stack:
  added: []
  patterns:
    - "Slot-based ready-queue (Pattern 1 from architecture.md): indegree map + ready FIFO + running Set"
    - "Cap=1 in Phase 1, lifted to opts.concurrency in Phase 2 (single-line change)"
    - "Event-bus shape between scheduler and formatter — Phase 2 adds JSON subscriber as parallel sink"
    - "process.hrtime.bigint() deltas for monotonic durations (NTP/DST-immune per pitfall N4)"

key-files:
  created:
    - "src/scheduler.js"
    - "src/formatter.js"
    - "test/scheduler.test.js"
    - "test/formatter.test.js"
  modified: []

key-decisions:
  - "Scheduler is ready-queue-shaped even at cap=1 — Phase 2 lifts cap without restructuring"
  - "ready queue seeded in topoOrder (validator output) — SCHED-05 deterministic sibling order"
  - "Failure halts dispatch of dependents (children stay pending) — Phase 3 will replace with BFS skip"
  - "atomicWriteJson called pre-spawn AND post-completion for every task — STATE-03 strict enforcement"
  - "Win32 unconditional ASCII glyphs (CC-5 #5) — cheapest, most reliable; revisit only if user complains"
  - "stdout for events, stderr for diagnostics — discipline for Phase 2 NDJSON --format json"

patterns-established:
  - "Event shape: {type:'task', id, status, attempts, exit_code?, duration_ns?} | {type:'run', status:'complete', summary}"
  - "Run summary: {success, failed, skipped, total}"
  - "Tests for scheduler use isolated tmpdir scratch dirs to avoid polluting test/fixtures/ with state files"

requirements-completed: [SCHED-01, SCHED-05, CLI-08, CLI-09]
test-tiers: [unit, integration]

duration: 12min
completed: 2026-05-02
---

# Phase 1 Plan 04: Scheduler + Formatter Summary

**Slot-based ready-queue scheduler at cap=1 (Phase 2 lifts the cap with one line) writing state atomically after every transition, plus event-driven text formatter with TTY/NO_COLOR/ASCII detection and BigInt-ns duration formatting (Nms / N.NNs).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files created:** 4

## Accomplishments
- 4 of 18 phase requirements addressed: SCHED-01, SCHED-05, CLI-08, CLI-09
- Pitfall mitigations verified: C2 (no deadlock; topoOrder seeding), N1 (stdout/stderr discipline), N4 (hrtime.bigint for durations)
- Scheduler structure is the slot-based ready-queue from architecture.md — Phase 2 lifts cap=1 to opts.concurrency without restructuring
- Formatter is event-subscriber-shaped — Phase 2 adds `--format json` as a parallel subscriber, no rewrite of the text path

## Task Commits

1. **Task 1: src/scheduler.js** — `10c09c3` (feat)
2. **Task 2: src/formatter.js** — `c1980e1` (feat)
3. **Task 3: scheduler + formatter tests** — `e123b0f` (test) — 14 tests passing

## Files Created/Modified
- `src/scheduler.js` — runFlow + indegree + ready FIFO + running Set, cap=1 (~165 lines)
- `src/formatter.js` — createTextFormatter + shouldUseColor + shouldUseAscii (~110 lines)
- `test/scheduler.test.js` — 6 integration tests (linear, diamond, fail-halts-deps, single, empty, STATE-03)
- `test/formatter.test.js` — 8 unit tests (NO_COLOR, isTTY, win32 ASCII, glyphs, durations, run-complete)

## Decisions Made
- **Slot-based shape over for-loop:** A `for (const id of topoOrder) await runTask(...)` would break Phase 2's concurrency lift. Pattern 1 from architecture.md keeps the same shape across phases.
- **Cap=1 placement:** Hardcoded in `cap = opts.concurrency ?? 1`. Phase 2 changes the default to whatever `--concurrency` parses (already wired through CLI in Plan 05).
- **Failed-task halt vs skip:** Phase 1 leaves children `pending`. Reasoning: skip-downstream propagation is a Phase 3 deliverable (DOG-02). The CLI maps `summary.failed > 0` to exit code 1, which is the Phase 1 contract.
- **Per-transition atomic write:** No batching. Every state change calls `atomicWriteJson` immediately. Acceptable cost in Phase 1 (cap=1, sequential), and required for STATE-03 crash-safety guarantee.
- **Pre-spawn markRunning + persist:** Pitfall M4 (kill-window safety): if the user Ctrl+C's between spawn and the next event, the state file already shows `running` for the task with the right attempt count.
- **Event ordering: pump() then maybeFinish():** Pump first so any newly-ready children get dispatched before the run-complete event fires. maybeFinish guarded by `finalized` flag to prevent double-resolution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added finalized flag to prevent double-resolution race**
- **Found during:** Task 1 (scheduler implementation)
- **Issue:** Plan code had two paths to maybeFinish (after each task completion AND inside the pump loop's bottom). Without a guard, an empty-running-and-empty-ready check could fire onEvent('run complete') twice and call resolveDone() twice. Test runner would still pass but the formatter would print the summary line twice.
- **Fix:** Added `let finalized = false` at top of runFlow; maybeFinish bails early if already finalized.
- **Files modified:** src/scheduler.js
- **Verification:** All 6 scheduler tests pass; events array shows exactly one 'run' event per test.
- **Committed in:** 10c09c3 (Task 1 commit)

**2. [Rule 1 - Bug] Move pump-then-maybeFinish ordering inside .then handler**
- **Found during:** Task 1 (scheduler implementation)
- **Issue:** Plan code called `maybeFinish()` before `pump()` in the .then handler. If a task completion unlocks new ready tasks, maybeFinish would fire first (with the old empty-ready state) and finalize the run before the new tasks ever run.
- **Fix:** Reordered to `pump()` then `maybeFinish()` so newly-ready children get dispatched before the run-complete check.
- **Files modified:** src/scheduler.js
- **Verification:** Linear chain test passes (a→b→c all execute, not just a).
- **Committed in:** 10c09c3 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs in scheduler concurrency control)
**Impact on plan:** Both fixes essential for correctness. Without them, the scheduler would either double-fire run-complete or skip dispatching dependents. No scope creep.

## Issues Encountered
None.

## Next Phase Readiness
- Plan 05 (CLI) wires `runFlow` directly: it builds the formatter via `createTextFormatter()`, passes it as `onEvent`, and maps `summary.failed > 0` to exit code 1.
- Phase 2 will: (a) propagate the concurrency arg from CLI into runFlow opts; (b) add `--format json` as a second subscriber alongside the text formatter; (c) wrap runTask in a retry loop in scheduler.

---
*Phase: 01-parse-validate-sequential-run-atomic-state*
*Completed: 2026-05-02*
