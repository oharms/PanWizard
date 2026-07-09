---
phase: 03-resume-skip-downstream-dogfood
plan: 04
status: complete
completed: 2026-05-02
---

# Plan 03-04 Summary — Wire mergeState + propagateSkip + active-children into scheduler/cli

## What was built

Three concrete wirings:

### 1. `src/scheduler.js` — resume-aware seed loop + startup-skip pass + propagateSkip in failure branch + opts.signal threading

- **Imports `propagateSkip` from `src/skip.js`.**
- **Accepts `opts.signal` (AbortSignal)** and threads it through to `runTaskWithRetry(task, { persistAttempt, signal: abortSignal })`. Combined with `retry.js`'s existing signal-aware sleep (Phase 2 Plan 02 scaffold) and `executor.js`'s new `opts.signal` handling (Plan 03), this means a single CLI-level abort drains both pending retry sleeps AND live spawned children.
- **Resume-aware seed loop (STATE-05):** Replaces the simple `if (indegree[id] === 0) ready.push(id)` loop with a branch on `state.tasks[id].status`:
  - `success` → pre-decrement children's indegrees (the work is already done).
  - `pending` + indegree 0 → push to ready queue.
  - Other statuses → handled by the next pass.
  This is the **only** mechanism that makes resume work — no "resume mode" flag exists. The scheduler's behavior is uniform across fresh and resumed runs because for fresh runs every task is `pending` and the success branch never fires.
- **Resume-startup BFS pass:** Walks `flow.topoOrder` with a snapshot of original statuses (computed BEFORE any propagateSkip mutates state) and:
  - For each `failed` task on entry: increments `summary.failed`, calls `propagateSkip` to mark all transitive descendants `skipped`. Counting already-failed tasks in `summary.failed` ensures the exit code reflects FINAL state on resume (pitfall N2).
  - For each `skipped` task on entry: increments `summary.skipped` (forward-compat — currently dead branch since `mergeState` resets `skipped` to `pending`).
  - Snapshot is critical: a single-pass loop would double-count tasks that propagateSkip just marked `skipped`.
- **Failure branch wiring:** Replaces the Phase 1 `// Phase 3 will replace this with a BFS skip-downstream propagation.` comment with the real call. After `markFailed + atomicWriteJson + onEvent({status:'failed'})` execute, `summary.skipped += propagateSkip(...)` runs synchronously, then `atomicWriteJson(stateFile, state)` persists. Pitfall M1 ordering is structural — the `failed` event was emitted before this synchronous block.

### 2. `src/cli.js` — --resume flag + AbortController + SIGINT drain protocol

- **Imports `mergeState`, `stateFilePath`, `killActiveChildren`.**
- **Adds `--resume` option** to parseArgs and `printHelp()` documentation.
- **AbortController + drain protocol:** Replaces the Phase 2 stub `process.exitCode = ...` handler with the real drain:
  ```
  abortController.abort()         // drains retry.js sleeps via opts.signal
  killActiveChildren('SIGTERM')   // drains live spawned children
  setTimeout(killActiveChildren('SIGKILL'), 5000).unref()  // SIGKILL fallback
  // runFlow promise settles naturally; main() persists final state via the
  // failure branch's markFailed + atomicWriteJson + propagateSkip. No explicit
  // process.exit() — process exits via process.exitCode = 130 (POSIX) or 1 (Windows).
  ```
  `shutdownStarted` flag guards against multiple Ctrl-C invocations producing duplicate drains (pitfall M6).
- **--resume dispatch:**
  - Reads `stateFilePath(absPath)` (sibling `whooflow.state.json` of the flow file).
  - On `ENOENT` → throws `RuntimeError('cannot resume: state file not found at <path>')`.
  - On malformed JSON → throws `RuntimeError('cannot resume: state file is malformed JSON: ...')`.
  - Calls `mergeState(validatedFlow, oldState)` (which throws `RuntimeError` on unknown task ids).
  - Forces `state.flow_file = absPath` (defensive against relative-vs-absolute path drift).
  - Runs `assertWritable(dirname(absPath))` AFTER mergeState — so resume-error messages dominate over write-test failures.
- **Threads `abortController.signal`** into `runFlow(validatedFlow, state, { onEvent, concurrency, signal })`.

## Why summary.failed counts already-failed-on-entry tasks (pitfall N2)

Exit code reflects FINAL flow state, not just delta. If A failed terminally in run 1 and the user runs `--resume`, the exit code must be 1 because the flow is not in a fully-successful state. Counting A in `summary.failed` (and B as skipped if B depends on A) achieves this without any explicit "resume exit code" logic.

## Tests

### `test/scheduler.test.js` — 3 new unit tests
- `STATE-04 + STATE-05`: runFlow with `success`-marked task pre-decrements children's indegrees on the seed loop. A is preserved, B runs, `summary.success === 1` (B only).
- `SCHED-06 + STATE-04`: runFlow with `failed`-on-entry task fires propagateSkip on startup. B becomes `skipped` with `skip_reason: 'upstream A failed'`; `summary.failed === 1`, `summary.skipped === 1`.
- `SCHED-06`: runFlow failure branch fires propagateSkip mid-run with independent branches preserved. A→B (A fails) + C→D (independent) → B skipped, D succeeds, `summary: failed=1, skipped=1, success=2`.

Updated existing test "failed task halts dispatch of its dependents (Phase 1 — no skip propagation yet)" → renamed to "SCHED-06: failed task propagates skip to its dependents (Phase 3 — propagateSkip wired)" with new assertions for `b.status === 'skipped'` + `skip_reason` + `summary.skipped === 1`.

### `test/integration.test.js` — 7 new subprocess tests
- `CLI-03 I-1`: `--resume` on a clean successful run exits 0 and re-runs nothing (attempts unchanged).
- `CLI-03 I-2`: `--resume` reruns failed task with retries remaining (`status: 'failed', attempts: 1, retry.attempts: 3` → after resume: `success`, `attempts: 2`).
- `CLI-03 I-3`: `--resume` on `running`-state task (kill simulation via direct state write) reruns it (Pitfall C5: `attempts: 2` after resume).
- `CLI-03 I-4`: `--resume` exit code reflects FINAL flow state. Pre-existing failed A + pending B → resume → A stays failed, B becomes skipped, exit 1.
- `CLI-03`: `--resume` with missing state file errors with `cannot resume.*state file not found`.
- `CLI-03`: `--resume` with malformed state file errors with `cannot resume.*malformed`.
- `CLI-03`: `--resume` with state referencing unknown task id errors with `state references unknown task: ghost`.

## Test count

- Baseline (after Wave 1): 126.
- After Plan 03-04: **136 tests** (+3 scheduler + 7 integration). All pass.

## Hand-off to Plan 05

Plan 05 will:
- Ship the dogfood `flow.json` at the repo root running `npm test` + `npm run build:hooks` in parallel + a count step.
- Add `build:hooks` script to `package.json` (cross-platform `node -e` stub).
- Create `test/fixtures/sleepy.json` for kill-and-resume.
- Add `D-2` kill-and-resume integration test using `spawn` + marker-file polling (POSIX-only; Windows-skipped — covered by I-3 via direct state write).

## Commits

- `feat(03-04): wire propagateSkip + resume-aware seed loop into scheduler`
- `feat(03-04): wire --resume + AbortController drain into cli.js`
- `test(03-04): add 3 scheduler + 7 integration tests for resume + skip-downstream`

## Self-Check: PASSED

- All 136 tests pass.
- `whooflow --help` documents `--resume`.
- One existing test renamed/updated to reflect Phase 3 skip-downstream behavior (was previously asserting Phase 1's halt-but-no-skip behavior).
- Scheduler is structurally oblivious to fresh-vs-resume mode (the only branch on resumability is in CLI's state-construction step).
