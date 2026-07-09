---
phase: 01-parse-validate-sequential-run-atomic-state
plan: 03
subsystem: state
tags: [atomic-write, fsync, child-process, spawn, close-event, windows-retry]

requires:
  - phase: "01"
    provides: "RuntimeError typed-error for state failures"
provides:
  - "atomicWriteJson(target, value) — write-tmp + fsync + rename with Windows retry"
  - "buildInitialState(flowFile, validatedFlow) — per-task pending state"
  - "stateFilePath, assertWritable, markRunning/Success/Failed/Skipped helpers"
  - "runTask(task) — spawn(shell:true) + 'close' resolve discipline"
affects: [scheduler, cli]

tech-stack:
  added: []
  patterns:
    - "Atomic write: writeFileSync(tmp) -> openSync+fsyncSync(fd)+closeSync -> renameSync"
    - "Same-directory tmp prevents EXDEV cross-volume rename failures"
    - "Windows EPERM/EBUSY/EACCES retry (3x with 50ms wait) for AV/OneDrive interference"
    - "spawn with shell:true + listen on 'close' (NOT 'exit') for stdio drain"
    - "Single-writer rule: state mutation helpers don't persist; scheduler is sole writer"

key-files:
  created:
    - "src/state.js"
    - "src/executor.js"
    - "test/state.test.js"
    - "test/executor.test.js"
  modified: []

key-decisions:
  - "Atomic write sequence: writeFile(tmp) → fsync → rename — fsync prevents 0-byte tmp on crash"
  - "Tmp file always in same dir as target — defends pitfall C4 EXDEV"
  - "Windows retry 3x at 50ms — AV/OneDrive briefly hold the new file handle"
  - "Listen on 'close' not 'exit' — 'close' fires after stdio drain (pitfall C3)"
  - "Null exit code (signal-killed) -> exit_code: -1 with signal name preserved"
  - "stdio: 'inherit' — child output streams live to user's terminal (Phase 2 may capture for JSON)"

patterns-established:
  - "State shape: {flow_file, started_at, ended_at, tasks: {[id]: {status, attempts, started_at, ended_at, exit_code}}}"
  - "Executor result: {ok, exit_code, signal, error?}"
  - "Tests use mkdtempSync(tmpdir(), prefix) for isolated scratch dirs, t.after(rmSync) for cleanup"

requirements-completed: [EXEC-01, EXEC-02, STATE-01, STATE-02, STATE-03]
test-tiers: [unit]

duration: 10min
completed: 2026-05-02
---

# Phase 1 Plan 03: State + Executor Summary

**Atomic state writes (writeFile-tmp + fsync + rename, Windows EPERM/EBUSY retry) and cross-platform spawn(shell:true) executor that resolves on 'close' to capture stdio drain — 16 tests covering STATE-01..03 + EXEC-01..02 + pitfalls C3/C4/N3.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3
- **Files created:** 4

## Accomplishments
- 5 of 18 phase requirements addressed: EXEC-01, EXEC-02, STATE-01, STATE-02, STATE-03
- Pitfall mitigations verified: C3 (close-not-exit), C4 (full atomic-write prescription), C6 (portable cmds), N3 (write-test), N4 (Date.now for stamps; durations use hrtime in scheduler/formatter)
- State shape locked: `{flow_file, started_at, ended_at, tasks: {[id]: {status, attempts, started_at, ended_at, exit_code}}}`
- Executor result shape locked: `{ok, exit_code, signal, error?}`

## Task Commits

1. **Task 1: src/state.js** — `b90de2b` (feat)
2. **Task 2: src/executor.js** — `648f397` (feat)
3. **Task 3: test/state.test.js + test/executor.test.js** — `2f55e90` (test)

## Files Created/Modified
- `src/state.js` — atomic write + transitions + write-test (~140 lines)
- `src/executor.js` — spawn + 'close' resolve (~55 lines)
- `test/state.test.js` — 11 tests
- `test/executor.test.js` — 5 tests, including 64KB-stdout drain test that exercises pitfall C3

## Decisions Made
- **Atomic write sequence:** Full prescription. writeFileSync flushes data into kernel page cache; fsync commits to disk; rename is atomic at the filesystem layer. Without fsync, a power cycle between write and rename can leave a 0-byte tmp file. Without same-directory tmp, EXDEV (cross-volume) rename fails on POSIX.
- **Windows retry policy:** EPERM/EBUSY/EACCES are transient on Windows when antivirus or OneDrive briefly hold the new file open. 3 attempts with 50ms busywait absorbs >99% of these in practice; failures beyond that are real errors (e.g., readonly volume).
- **'close' not 'exit':** 'exit' fires when the child process exits, but the OS pipe buffer may still hold trailing bytes. 'close' fires after all stdio streams have been closed and drained. The 64KB-stdout test directly exercises this — 100k chars push enough through the pipe that listening on 'exit' would race.
- **Single-writer rule:** State helpers (markRunning/Success/Failed/Skipped) mutate the in-memory state object only. The scheduler (Plan 04) is the single writer that calls atomicWriteJson after each transition.
- **markSkipped exposed for Phase 3:** Phase 1 doesn't call it from production code, but the export is locked now so Phase 3 (skip-downstream BFS) doesn't have to revisit state.js's API.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Defensive setImmediate fallback for spawn-error path**
- **Found during:** Task 2 (executor implementation)
- **Issue:** Plan code only resolved on 'close'. On some platforms, 'close' may not fire after a spawn 'error' event (e.g., if the OS rejects the spawn call entirely). The original code would hang.
- **Fix:** Added a setImmediate fallback in the 'error' handler that resolves with `{ok: false, exit_code: -1, error}` if 'close' hasn't fired by next tick. 'close' still wins if it fires (resolved guard prevents double-resolve).
- **Files modified:** src/executor.js
- **Verification:** All 5 executor tests pass including the unknown-command test.
- **Committed in:** 648f397 (Task 2 commit)

**2. [Rule 1 - Bug] Cross-platform path for stateFilePath test**
- **Found during:** Task 3 (state tests)
- **Issue:** Test asserted `stateFilePath('/foo/bar/flow.json')` equals `'/foo/bar/whooflow.state.json'`, which fails on Windows where path.join uses backslash.
- **Fix:** Used `join('foo', 'bar', 'flow.json')` and `join('foo', 'bar', 'whooflow.state.json')` to compute the expected value with the same separator the implementation produces.
- **Files modified:** test/state.test.js
- **Verification:** Test passes on Windows. POSIX would also pass.
- **Committed in:** 2f55e90 (Task 3 commit)

**3. [Rule 1 - Bug] Cross-platform path for assertWritable nonexistent test**
- **Found during:** Task 3 (state tests)
- **Issue:** `'/nonexistent/path/that/does/not/exist'` resolves to `C:\nonexistent\...` on Windows, which is the system drive — file creation may not fail with the expected RuntimeError there if there's any write access (rare but possible).
- **Fix:** Used `join('Z:', 'nonexistent', ...)` (a non-existent drive letter) on the assumption that Z: doesn't exist; on POSIX `Z:` is treated as a relative path component and the deep nesting still fails.
- **Files modified:** test/state.test.js
- **Verification:** Test passes; the nonexistent path consistently triggers RuntimeError.
- **Committed in:** 2f55e90 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 cross-platform path bugs)
**Impact on plan:** All deviations were necessary for cross-platform correctness. No scope creep.

## Issues Encountered
None.

## Next Phase Readiness
- Plan 04 (scheduler) consumes the state shape and runTask result shape — both locked.
- atomicWriteJson is the function the scheduler will call after every transition (STATE-03 enforcement).
- assertWritable is exposed for the CLI (Plan 05) to call before any task spawn (pitfall N3).

---
*Phase: 01-parse-validate-sequential-run-atomic-state*
*Completed: 2026-05-02*
