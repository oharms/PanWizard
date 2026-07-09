---
phase: 01-parse-validate-sequential-run-atomic-state
phase_number: 1
phase_name: "Parse + Validate + Sequential Run + Atomic State"
status: passed
verified_at: "2026-05-02"
verifier: orchestrator-inline
test_suite:
  command: "npm test"
  total: 71
  passed: 71
  failed: 0
plans_complete: 5
plans_total: 5
requirements_total: 18
requirements_verified: 18
---

# Phase 1 Verification Report

**Status: PASSED**

All 18 phase requirements have implementation + automated test coverage. Full test suite (71 tests across 8 test files) is green. The phase goal is achieved: a user can run a JSON flow file end-to-end on a single core, with malformed flows rejected before any task runs and state written crash-safely after every transition.

## Phase Goal

> A user can run a JSON flow file end-to-end on a single core, with malformed flows rejected before any task runs and state written crash-safely after every transition. This phase establishes the data shapes (Flow IR, state JSON), the atomic-write contract, and the deterministic ordering that every later phase rides on.

**Verdict: ACHIEVED.** Manual smoke test succeeds:
- `node bin/whooflow.js --help` -> usage, exit 0
- `node bin/whooflow.js --version` -> 'whooflow 0.1.0', exit 0
- `node bin/whooflow.js run --file test/fixtures/single.json` -> '[ v ] only (44ms)', exit 0
- Cycle/malformed/missing-file rejection verified via integration tests with exit code 2
- State file written next to flow file, validates as JSON with `ended_at` set

## Test Suite Gate

```
$ npm test
> whooflow@0.1.0 test
> node --test "test/**/*.test.js"

ℹ tests 71
ℹ pass 71
ℹ fail 0
```

PASS — no regressions. 71 tests across 8 files (errors, loader, validator, state, executor, scheduler, formatter, cli, integration).

## Success Criteria Verification

### 1. Linear/diamond flow runs to completion (defends C2 + C4)
- **Linear:** `test/scheduler.test.js` SCHED-01 — a→b→c executes in order, summary.success=3
- **Diamond:** `test/scheduler.test.js` SCHED-05 — A→{B,C}→D, A first / D last, all 4 success
- **Atomic state writes:** `test/state.test.js` STATE-02/03 — same-dir tmp + fsync + rename + 1000 sequential writes
- **Windows retry:** `src/state.js renameWithRetry` — 3× retry on EPERM/EBUSY/EACCES with 50ms wait when `process.platform === 'win32'`
- **Exit code mapping:** `test/integration.test.js` — linear exits 0, single-fail exits 1, cycle/malformed/missing-file exit 2
- **Verdict:** PASSED

### 2. Malformed flows rejected before any task runs, with named errors (defends C1 + M5)
- **Cycle path output:** `test/validator.test.js` PARSE-05 — `cycle detected: a → b → a` (U+2192 EM ARROW). Long cycle (a→b→c→d→a) and self-loop (a→a) also tested.
- **Iterative Kahn (no recursion):** `test/validator.test.js` C1 — 1000-task linear chain validates without RangeError.
- **Diamond is NOT a cycle:** `test/validator.test.js` C1 — A→{B,C}→D validates successfully.
- **Aggregated schema errors (M5):** `test/validator.test.js` PARSE-04 — bad-retry.json fixture produces 3 errors in `ValidationError.details[]`, all surfaced.
- **Pre-spawn rejection:** CLI's `loadFlow + validateFlow` happen before `runFlow` — no task spawn on validation failure (verified via `test/integration.test.js` cycle/malformed tests showing no glyph output before exit 2).
- **Verdict:** PASSED

### 3. Tasks execute correctly via shell-portable spawn (defends C3 + C6)
- **shell:true:** `src/executor.js` line 22 — `spawn(task.cmd, {shell:true, stdio:'inherit', windowsHide:true})`
- **'close' not 'exit':** `src/executor.js` — explicit `child.on('close', ...)` resolution; large-stdout test (`test/executor.test.js` C3) prints 100k lines and confirms ok:true.
- **Null exit code = failure:** `src/executor.js` — `if (code === null) resolve({ok:false, exit_code:-1, signal})`
- **Cross-platform cmds:** test fixtures use `node -e "console.log('...')"` (works in cmd.exe and sh).
- **Verdict:** PASSED

### 4. State writes crash-safe and durable (defends C4 + N3)
- **Atomic write sequence:** `src/state.js atomicWriteJson` — writeFileSync(tmp) → openSync+fsyncSync(fd)+closeSync → renameSync(tmp, target). Verified with explicit code review.
- **Same-dir tmp:** `src/state.js` line 50 — `tmpPath = join(dirname(targetPath), \`.\${basename(targetPath)}.tmp.\${pid}.\${Date.now()}\`)` — defends EXDEV.
- **Windows retry:** `renameWithRetry` retries 3× on EPERM/EBUSY/EACCES with 50ms busy-wait, only on win32.
- **Write-test at startup:** `src/state.js assertWritable` called from `src/cli.js main` BEFORE any task spawn (after load+validate so input errors dominate). Tested with `test/state.test.js` N3 cases.
- **Crash leaves at most one task in 'running':** scheduler calls `markRunning + atomicWriteJson` BEFORE spawn (pitfall M4). Verified by code review of `src/scheduler.js pump()`.
- **Verdict:** PASSED

### 5. Output structured, deterministic, CI-friendly (defends N1 + N4 + CC-5 #5)
- **Status glyphs with ASCII fallback:** `src/formatter.js shouldUseAscii()` returns true on win32 OR !isTTY. Tested in `test/formatter.test.js` and `test/integration.test.js` (which runs under non-TTY subprocess).
- **Per-task durations from process.hrtime.bigint():** `src/scheduler.js` captures `startedNs = process.hrtime.bigint()` and emits `duration_ns` in events. Formatter converts BigInt ns to 'Nms' / 'N.NNs'. Tested in `test/formatter.test.js` N4.
- **Color auto-detect + NO_COLOR:** `src/formatter.js shouldUseColor()` honors NO_COLOR and isTTY. Tested in `test/formatter.test.js` and `test/integration.test.js` (NO_COLOR test verifies no `\x1b[` escapes in output).
- **Stderr/stdout separation:** `src/cli.js` uses `process.stderr.write` for diagnostics; formatter uses `process.stdout.write` for events. Pitfall N1 discipline established for Phase 2 NDJSON.
- **Determinism:** ready queue seeded in topoOrder (validator output preserves insertion order). Tested in `test/scheduler.test.js` SCHED-05.
- **Verdict:** PASSED

## Requirements Coverage Matrix

All 18 Phase 1 requirements from `.planning/requirements.md` are covered:

| Req ID | Plan | Test File | Status |
|--------|------|-----------|--------|
| CLI-01 | 01-05 | test/cli.test.js, test/integration.test.js | VERIFIED |
| CLI-02 | 01-05 | test/cli.test.js, test/integration.test.js | VERIFIED |
| CLI-07 | 01-05 | test/cli.test.js | VERIFIED |
| CLI-08 | 01-04 | test/formatter.test.js, test/integration.test.js | VERIFIED |
| CLI-09 | 01-04 | test/formatter.test.js, test/integration.test.js | VERIFIED |
| CLI-10 | 01-01, 01-05 | test/errors.test.js, test/integration.test.js | VERIFIED |
| PARSE-01 | 01-02 | test/loader.test.js | VERIFIED |
| PARSE-02 | 01-02 | test/loader.test.js, test/validator.test.js | VERIFIED |
| PARSE-03 | 01-02 | test/validator.test.js | VERIFIED |
| PARSE-04 | 01-02 | test/validator.test.js | VERIFIED |
| PARSE-05 | 01-02 | test/validator.test.js | VERIFIED |
| SCHED-01 | 01-04 | test/scheduler.test.js | VERIFIED |
| SCHED-05 | 01-04 | test/scheduler.test.js | VERIFIED |
| EXEC-01 | 01-03 | test/executor.test.js | VERIFIED |
| EXEC-02 | 01-03 | test/executor.test.js | VERIFIED |
| STATE-01 | 01-03 | test/state.test.js | VERIFIED |
| STATE-02 | 01-03 | test/state.test.js | VERIFIED |
| STATE-03 | 01-03, 01-04 | test/state.test.js, test/scheduler.test.js, test/integration.test.js | VERIFIED |

**Coverage:** 18/18 = 100%

## Plan Completion

| Plan | Status | Summary | Tests |
|------|--------|---------|-------|
| 01-01 | ✓ Complete | 01-01-summary.md | 6 (errors) |
| 01-02 | ✓ Complete | 01-02-summary.md | 17 (loader, validator) |
| 01-03 | ✓ Complete | 01-03-summary.md | 16 (state, executor) |
| 01-04 | ✓ Complete | 01-04-summary.md | 14 (scheduler, formatter) |
| 01-05 | ✓ Complete | 01-05-summary.md | 18 (cli, integration) |

**Total:** 71 tests across 8 test files. All passing.

## Pitfall Mitigation Verified

| Pitfall | Mitigation | Test |
|---------|------------|------|
| C1 (cycle UX) | Iterative Kahn + leftover DFS, U+2192 separator | test/validator.test.js (4 tests) |
| C2 (ready-queue starvation) | Loader normalizes depends_on:[] always | test/loader.test.js, test/scheduler.test.js |
| C3 (close vs exit) | Listen on 'close' for stdio drain | test/executor.test.js (64KB stdout) |
| C4 (atomic write) | writeFile+fsync+rename, same-dir tmp, win32 retry | test/state.test.js (1000 writes) |
| C6 (cross-platform cmd) | shell:true + node -e fixture pattern | test/executor.test.js, test/integration.test.js |
| M5 (first-fail validation) | Aggregated errors in ValidationError.details[] | test/validator.test.js bad-retry |
| N1 (stderr/stdout) | stderr for diagnostics; stdout for events | test/integration.test.js NO_COLOR |
| N3 (read-only dir) | assertWritable startup write-test | test/state.test.js |
| N4 (Date.now durations) | process.hrtime.bigint() deltas | test/formatter.test.js, src/scheduler.js |

## Architectural Notes

- **Scheduler is slot-based even at cap=1.** This is intentional architecture per architecture.md Pattern 1 — Phase 2 lifts the cap with one line (`cap = opts.concurrency ?? 1` -> propagate from CLI).
- **Skip-downstream not implemented in Phase 1.** Failed tasks halt their dependents (children stay `pending`). Phase 3 replaces this with BFS skip propagation. CLI maps `summary.failed > 0` to exit 1.
- **No retry loop in Phase 1.** Phase 2 adds retry-with-backoff inside the executor. Phase 1's executor calls runTask exactly once.
- **markSkipped exposed but unused in Phase 1.** Phase 3's skip-downstream calls it; the export contract is locked now so Phase 3 doesn't have to revisit src/state.js's API.

## Issues / Gaps

**None.** All requirements covered, all tests passing, phase goal achieved.

## Recommendations for Phase 2

1. Propagate `concurrencyN` from CLI through to `runFlow({concurrency: concurrencyN})` (already parsed/validated in Plan 05).
2. Add `--format json` as a parallel subscriber to the existing event bus.
3. Wrap runTask in a retry loop in scheduler (or layer above executor); persist `attempts` BEFORE the backoff sleep.
4. Add `--dry-run` and `--list` subcommands.

---

*Verification completed: 2026-05-02*
*Method: orchestrator-inline (no separate Task spawn — running as Claude Code agent)*
