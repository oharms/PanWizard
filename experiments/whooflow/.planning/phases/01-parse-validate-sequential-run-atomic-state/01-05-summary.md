---
phase: 01-parse-validate-sequential-run-atomic-state
plan: 05
subsystem: cli
tags: [cli, parseargs, exit-codes, integration]

requires:
  - phase: "01"
    provides: "loader, validator, state, executor, scheduler, formatter, errors — full Phase 1 stack"
provides:
  - "bin/whooflow.js — executable entry with shebang"
  - "src/cli.js — main(argv) dispatcher; printHelp; printVersion"
  - "End-to-end CLI invocation with exit codes 0/1/2 per CLI-10"
affects: []

tech-stack:
  added: []
  patterns:
    - "node:util parseArgs with strict:true for option discipline"
    - "Subprocess integration tests via spawnSync(node, [bin, ...argv])"
    - "Aggregated ValidationError details printed line-by-line on stderr"

key-files:
  created:
    - "bin/whooflow.js"
    - "src/cli.js"
    - "test/cli.test.js"
    - "test/integration.test.js"
  modified:
    - "package.json"  # test script glob fix for Node 24

key-decisions:
  - "loadFlow + validateFlow run BEFORE assertWritable — input errors dominate over write-test"
  - "Concurrency arg parsed and validated but not propagated (Phase 1 cap=1 hardcoded in scheduler)"
  - "Test script glob 'test/**/*.test.js' instead of 'test/' — Node 24 compatibility"
  - "Subprocess integration tests use process.execPath + bin path — cross-platform without chmod +x"

patterns-established:
  - "CLI surface: 'whooflow run --file <path> [--concurrency N]' (Phase 1) — Phase 2 adds --format json, --dry-run, --list, retry; Phase 3 adds --resume"
  - "Error line format on stderr: 'whooflow: <message>'; aggregated details: '  - <path>: <issue>'"

requirements-completed: [CLI-01, CLI-02, CLI-07, CLI-10]
test-tiers: [unit, integration, e2e]

duration: 8min
completed: 2026-05-02
---

# Phase 1 Plan 05: CLI Wiring Summary

**End-to-end CLI: parseArgs -> dispatch -> loadFlow -> validateFlow -> assertWritable -> buildInitialState -> runFlow with text formatter -> exit code 0/1/2 (CLI-10). Integration tests verify success/fail/cycle/malformed/missing-file/missing-dep paths via subprocess invocation.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files created:** 4 (+ 1 modified)

## Accomplishments
- 4 of 18 phase requirements addressed: CLI-01, CLI-02, CLI-07, CLI-10
- All 18 phase requirements have at least one test exercising them across the suite
- Phase goal achieved: a user can run a JSON flow file end-to-end on a single core, with malformed flows rejected before any task runs and state written crash-safely after every transition
- The package is installable (`npm install -g .` would create a `whooflow` binary)
- Full test suite: **71 tests passing** across 8 test files

## Task Commits

1. **Task 1: bin/whooflow.js + src/cli.js** — `2147009` (feat)
2. **Task 2: test/cli.test.js + test/integration.test.js** — `bf2cef8` (test) — 18 tests passing
3. **Bug fix: package.json test script for Node 24** — `f26d7c5` (fix) — glob pattern instead of bare directory

## Files Created/Modified
- `bin/whooflow.js` — shebang + import + exit code mapping (~12 lines)
- `src/cli.js` — main, printHelp, printVersion (~135 lines)
- `test/cli.test.js` — 7 unit tests with stdout/stderr capture
- `test/integration.test.js` — 11 e2e tests via spawnSync
- `package.json` — test script: `node --test "test/**/*.test.js"` (was `node --test test/`)

## Decisions Made
- **Pipeline order — load+validate before assertWritable:** A user pointing at a malformed file should see the malformed-JSON error, not an unrelated write-test failure. Reordered from plan: `loadFlow -> validateFlow -> assertWritable -> buildInitialState -> runFlow`.
- **Concurrency parsed but not propagated:** Phase 1 forces `concurrency: 1` in the runFlow opts. Phase 2 lifts this with one line: pass `concurrencyN` instead of `1`.
- **Subprocess integration tests:** Use `spawnSync(process.execPath, [BIN, ...])` rather than relying on `chmod +x`. Works on Windows without modification.
- **Test script glob:** Node 24 changed `node --test <path>` semantics — bare `test/` resolves as a single-file path (`test/index.js`), not a directory scan. Fix: `node --test "test/**/*.test.js"`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] npm test script broken on Node 24**
- **Found during:** Final smoke test of full suite
- **Issue:** Plan specified `"test": "node --test test/"`. On Node 24 this fails with `Cannot find module 'C:\...\test'` because the test runner treats the path as a single-module specifier, not a directory.
- **Fix:** Changed script to `"test": "node --test \"test/**/*.test.js\""` so the glob expands to explicit file paths the runner can dispatch.
- **Files modified:** package.json
- **Verification:** `npm test` reports 71 tests passing across 8 files.
- **Committed in:** f26d7c5

**2. [Rule 1 - Bug] Pipeline reorder: load+validate before assertWritable**
- **Found during:** Task 1 implementation
- **Issue:** Plan code did `assertWritable(dirname)` before `loadFlow + validateFlow`. If a user passes a path inside a read-only directory, they see a "cannot write" error instead of a more relevant "file not found" or "malformed JSON" error.
- **Fix:** Reordered to `loadFlow -> validateFlow -> assertWritable -> buildInitialState`. Input errors take precedence over write-test failures (which become relevant only once we know the input is valid).
- **Files modified:** src/cli.js
- **Verification:** The "nonexistent file exits 2" integration test passes with a "file not found" message rather than "cannot write".
- **Committed in:** 2147009 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug in npm script, 1 bug in pipeline ordering)
**Impact on plan:** Both fixes essential. Without the npm script fix, `npm test` doesn't run. Without the pipeline reorder, error messages mislead users. No scope creep.

## Issues Encountered
None.

## Next Phase Readiness

### Phase 1 Complete
All 18 phase requirements have implementation + tests:
- **PARSE-01..05** (Plan 02): malformed JSON, ID rules, depends_on refs, retry shape, cycle detection
- **EXEC-01..02** (Plan 03): spawn(shell:true), close-event resolve, signal-killed mapping
- **STATE-01..03** (Plan 03): per-task state, atomic write, transition persistence
- **SCHED-01, SCHED-05** (Plan 04): sequential cap=1, deterministic ordering
- **CLI-01, CLI-02, CLI-07, CLI-08, CLI-09, CLI-10** (Plans 04+05): run subcommand, --concurrency, --help/--version, NO_COLOR, ASCII fallback, exit-code mapping

### What Phase 2 adds
- Propagate `concurrencyN` from CLI through to `runFlow({concurrency: concurrencyN})`
- `--format json` as a parallel subscriber alongside text formatter
- `--dry-run` (validate-only, no spawn)
- `--list` subcommand to print topo order
- Retry wrapper around runTask in scheduler
- Lift cap=1 in scheduler (already structured for this)

### What Phase 3 adds
- `--resume` flag + `mergeState(flow, oldState) -> newState` pre-scheduler merge
- Skip-downstream BFS propagation on terminal failure
- SIGINT handler in CLI for graceful shutdown
- Dogfood flow.json (DOG-01..03)

---
*Phase: 01-parse-validate-sequential-run-atomic-state*
*Completed: 2026-05-02*
