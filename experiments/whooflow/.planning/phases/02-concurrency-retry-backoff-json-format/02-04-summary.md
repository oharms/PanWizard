---
phase: 02-concurrency-retry-backoff-json-format
plan: 04
subsystem: cli
tags: [preflight, dry-run, list, sigint, depth-grouping]

requires:
  - phase: 01
    provides: validatedFlow shape (topoOrder + tasks[id].depends_on)
  - phase: 02-03
    provides: --format CLI flag plumbing pattern (validate-then-dispatch)
provides:
  - src/preflight.js — printList, computeDepthWaves, printDryRun (pure functions)
  - --list and --dry-run CLI options
  - Single-SIGINT-handler-at-startup discipline (named handler, registered once)
  - Dispatch-position pattern: AFTER validate, BEFORE assertWritable
affects:
  - phase 3: SIGINT handler body will be replaced with SIGTERM-then-SIGKILL drain protocol
  - phase 3: opts.signal threading via CLI-level AbortController

tech-stack:
  added: []
  patterns:
    - "Pure rendering functions over validatedFlow (no I/O beyond supplied stream)"
    - "Depth-grouping algorithm: depth[id] = max(depth[parents]) + 1 over topoOrder"
    - "Single named handler at startup (M3 listener-discipline)"
    - "Mutual-exclusivity rule: --list wins over --dry-run (structural over predictive)"

key-files:
  created:
    - src/preflight.js
    - test/preflight.test.js
  modified:
    - src/cli.js
    - test/integration.test.js

key-decisions:
  - "Preflight dispatch happens AFTER validateFlow (cycle/schema errors still exit 2) but BEFORE assertWritable (preflight is read-only against the filesystem)"
  - "--list wins over --dry-run when both passed (more fundamental: structural view trumps predictive view)"
  - "Single SIGINT + SIGTERM handler at startup of main(); named functions registered once; Phase 3 replaces only the body with drain protocol"
  - "Display-waves abstraction (depth-grouped) is purely for UX; the runtime scheduler is slot-based per architecture.md Pattern 1"
  - "preflight.js has zero imports from state.js, scheduler.js, executor.js — pure rendering module"

patterns-established:
  - "Test pattern: in-memory captureWriter with .out/.text() interface for stream-based tests"
  - "Mutual-exclusivity policy documented inline in CLI dispatch logic"
  - "Help text tracks all CLI flags inline with parseArgs config"

requirements-completed: [CLI-05, CLI-06]
test-tiers: [unit, integration]

duration: ~25 min
completed: 2026-05-02
---

# Phase 2 Plan 04: Preflight + SIGINT Discipline Summary

**Pre-flight ergonomics — `--list` and `--dry-run` route through src/preflight.js (pure rendering); single SIGINT/SIGTERM handler at startup establishes Phase 3's drain-protocol shape**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (Tasks 1+2 combined as one feat commit, Task 3 as test commit)
- **Files modified:** 2 (src/cli.js, test/integration.test.js)
- **Files created:** 2 (src/preflight.js, test/preflight.test.js)
- **Tests:** 93 → 105 (+12 new tests; all passing)

## Accomplishments

- `src/preflight.js` exports `printList`, `computeDepthWaves`, `printDryRun` (~70 LOC)
- CLI parseArgs adds `'dry-run'` and `'list'` boolean options
- Dispatch happens after `validateFlow` succeeds but before `assertWritable` runs
- `--list` wins over `--dry-run` when both are passed
- Single SIGINT + SIGTERM handler at startup (named function, registered once)
- Help text documents all new flags
- 8 preflight unit tests + 4 CLI integration tests

## Task Commits

1. **Tasks 1+2: preflight.js + CLI plumbing + SIGINT** — `1e1c4f2` (feat)
2. **Task 3: Tests (preflight.test.js + 4 integration tests)** — `31ed773` (test)

## Files Created/Modified

- `src/preflight.js` (new) — printList, computeDepthWaves, printDryRun; pure functions, no state.js/scheduler.js imports
- `src/cli.js` — added imports, added 'dry-run' and 'list' to parseArgs options, added SIGINT/SIGTERM handlers at top of main(), added preflight dispatch between validateFlow and assertWritable, updated help text
- `test/preflight.test.js` (new) — 8 unit tests covering linear/diamond/single shapes
- `test/integration.test.js` — added 4 subprocess tests: --list happy, --dry-run happy, --list on cycle, --list+--dry-run conflict

## Decisions Made

- **Dispatch position chosen carefully.** AFTER validateFlow (cycle/schema errors still exit 2 — user-facing error path is consistent across run/list/dry-run modes) but BEFORE assertWritable (a user running `--list` or `--dry-run` on a flow file in a read-only directory should still get the listing — the preflight commands are purely read-only against the filesystem).
- **--list wins over --dry-run.** When users pass both flags, --list is the more fundamental structural view (just the task graph). --dry-run adds the predictive wave analysis on top. So --list takes precedence.
- **SIGINT handler scaffold only.** Phase 2's handler body is intentionally minimal (just sets exitCode). Phase 3 will replace the body with a SIGTERM-then-SIGKILL drain that kills running children before exiting. The registration shape (single named handler, registered once at startup of main()) is what matters now — it prevents listener accumulation across CLI invocations.
- **No coloring or NO_COLOR honoring in preflight.** preflight is plain text structural output; styling would complicate testing without user benefit.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Phase 3 will consume:**
- The SIGINT handler body — replace with SIGTERM-then-SIGKILL drain protocol that kills running children before exiting
- The runTaskWithRetry signal parameter (Plan 02 scaffold) wired to a CLI-level AbortController triggered by the SIGINT handler

**Phase 2 surface complete:**
- `--concurrency N` — slot-based parallelism up to N
- `--format text|json` — NDJSON for machine consumers
- `--dry-run` — print planned waves
- `--list` — print task ids + deps
- Retry with capped jittered backoff (transparent to event consumers)
- Single SIGINT handler discipline (Phase 3 ready)

---
*Phase: 02-concurrency-retry-backoff-json-format*
*Plan: 04*
*Completed: 2026-05-02*
