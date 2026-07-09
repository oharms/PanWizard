---
phase: 03-cli-shell-glob-explain-dogfood
plan: 03
subsystem: cli

requires:
  - phase: 03-cli-shell-glob-explain-dogfood/03-01
    provides: resolveFrom + multi-file execute()
  - phase: 03-cli-shell-glob-explain-dogfood/03-02
    provides: printExplain + jsonlRow + formatTable
provides:
  - whoodb query "<sql>" — CLI binary (installable via npm bin entry)
  - main(argv) → Promise<number> (testable orchestrator)
  - EPIPE handler at module load (CLI-06)
  - exit codes: 0 success / 1 parse|usage|format / 2 IO|runtime
affects: [03-04 dogfood]

tech-stack:
  added: []
  patterns:
    - "node:util parseArgs with strict + allowPositionals"
    - "Return-exit-code pattern (main returns number, bin sets process.exitCode)"
    - "Module-load EPIPE handler before any stdout write"
    - "Child-process per integration test (avoids stdout-override TAP corruption)"

key-files:
  created:
    - src/cli.js
    - bin/whoodb.js
    - test/cli.test.js
  modified:
    - package.json (bin entry)

key-decisions:
  - "main() returns exit code instead of calling process.exit — makes tests trivial"
  - "EPIPE handler at module load (NOT inside main) — runs before any stdout.write"
  - "Child-process spawning for integration tests — manual stdout override in parent eats node:test's TAP output for completed tests, making earlier tests invisible. Child-process isolation is the only clean way to capture output without breaking node:test."
  - "Cross-platform EPIPE test uses a driver Node script consuming one line and destroying stdout, instead of `| head -1` which isn't on Windows by default"
  - "process.exitCode (not process.exit) in bin shim → ensures stdout flushes"

patterns-established:
  - "Return-code main + bin shim translation"
  - "Child-process integration tests via spawnSync"

requirements-completed: [CLI-01, CLI-05, CLI-06, TEST-01, TEST-02]
test-tiers: [integration, e2e]

duration: ~25min (incl. test infrastructure debugging)
completed: 2026-05-02
---

# Plan 03-03: CLI Shell + Integration Tests Summary

**whoodb is now an installable CLI binary — `whoodb query "<sql>"` runs the full Phase 1+2+3 pipeline with --explain, --format jsonl|table, EPIPE-safe piping, and proper exit codes**

## Accomplishments
- `src/cli.js` (~135 lines): main orchestrator with parseArgs, EPIPE handler, three-tier exit codes
- `bin/whoodb.js`: shebang shim using `process.exitCode` for safe stdout flush
- `package.json`: bin entry — `npm install` makes `whoodb` available globally
- `test/cli.test.js`: 15 integration tests via child-process spawning
- 168 total tests (153 → 168, zero regression)

## Task Commits

1. **Task 1+2: cli.js, bin/whoodb.js, package.json bin, 15 integration tests** — `5b25ec9` (feat)

(Single commit since the wiring + tests form one atomic CLI feature.)

## Files Created/Modified
- `src/cli.js` (NEW) — main(argv) returning Promise<number>; EPIPE handler at module load
- `bin/whoodb.js` (NEW) — shebang shim translating return code to process.exitCode
- `package.json` — added `bin: { whoodb: "./bin/whoodb.js" }`
- `test/cli.test.js` (NEW) — 15 integration tests via spawnSync (CLI-01 through CLI-06 + TEST-01)

## Decisions Made
- **Return-code main**: `main()` returns Promise<number> instead of calling `process.exit()`. Makes tests trivially callable and the bin shim sets `process.exitCode` so any pending stdout flushes before the process exits.
- **Child-process integration tests** (deviation from plan's recommendation of in-process `main(argv)` with stdout override). See deviation #1 below.
- **EPIPE handler at module load**: top-level `process.stdout.on('error', ...)` runs before any test or first row write — required for the pipe-close-mid-stream case.

## Deviations from Plan

### Auto-fixed Issues

**1. [test infrastructure] Child-process spawning replaces in-process stdout-override capture**
- **Found during:** Task 2 (running CLI integration tests)
- **Issue:** The plan recommended an in-process `captureStreams` helper that overrides `process.stdout.write`. When tests run, node:test writes its own TAP output asynchronously to process.stdout. With the override active during a test, the runner's "ok N" emissions are eaten by the test's stdout buffer. Result: 13 of 15 tests ran successfully but only 2 appeared in the test runner output (the two whose TAP lines happened to fire after the override was restored). Tried `describe({ concurrency: 1 })` — same problem because TAP emission is asynchronous regardless of test serialization.
- **Fix:** Replaced `captureStreams + main(argv)` with `spawnSync(node, [bin, ...argv])`. Each test spawns a child process running `bin/whoodb.js` and reads its stdout/stderr from spawnSync's result. The parent test runner's stdout is never touched; node:test reports cleanly.
- **Files modified:** test/cli.test.js (full rewrite)
- **Verification:** All 15 tests now visible and passing. Total test runtime ~700ms (15 × ~45ms per child spawn) — acceptable for integration tests.
- **Committed in:** 5b25ec9
- **Trade-off:** Slower than in-process (45ms vs <1ms per test), but only way to get reliable isolation. The plan's `main(argv)` export remains useful for future programmatic API consumers.

---

**Total deviations:** 1 auto-fixed (test infrastructure mismatch with node:test reporter behavior).
**Impact on plan:** Zero behavior change in production code — only the test strategy changed. All required CLI assertions are still made; the `main(argv)` export remains as the plan specified.

## Issues Encountered

**Test runner stdout corruption** — see deviation #1. Initial run showed only 2 of 15 tests in output despite the file containing 15 `test()` calls. Diagnosed by switching to `--test-reporter=tap` which revealed "5 subtests failed" with only tests 14 + 15 listed individually — confirming tests 1-13 were running but their TAP "ok N" lines were being captured by the global stdout override active in subsequent tests.

## Next Phase Readiness
- `whoodb` is callable as a CLI binary
- All four success paths verified end-to-end via child-process tests
- Plan 03-04 can write the dogfood test against `.planning/metrics/tokens.jsonl` and the perf harness against generated fixtures

---
*Phase: 03-cli-shell-glob-explain-dogfood*
*Completed: 2026-05-02*
