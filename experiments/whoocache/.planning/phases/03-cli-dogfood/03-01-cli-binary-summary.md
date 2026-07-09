---
phase: 03-cli-dogfood
plan: 01
subsystem: cli
tags: [parseArgs, child_process, spawnSync, exit-codes, stdin]

requires:
  - phase: 02-concurrency-eviction
    provides: createCache API surface (get/set/delete/list/clear), error types, WHOOCACHE_DIR override pattern
provides:
  - whoocache binary entrypoint (package.json bin)
  - src/cli.js parseArgs dispatcher mapping argv to createCache method calls
  - exit-code semantics 0/1/2 (success/error/miss)
  - test/cli.test.js spawnSync round-trip coverage
affects: [downstream consumers of the whoocache CLI; future shell-script integrations]

tech-stack:
  added: []
  patterns:
    - "parseArgs config with strict:false to permit unknown flags + --help fallthrough (research §Pitfall 3)"
    - "process.exitCode on hot paths; process.exit(1) only on early-bail validation before stdout write (research §Pitfall 1)"
    - "WHOOCACHE_DIR env override (mirrors test/helpers/child-writer.js) for test isolation"

key-files:
  created:
    - src/cli.js
    - test/cli.test.js
  modified:
    - package.json

key-decisions:
  - "fd 0 stdin read via fs.readFileSync(0,'utf8') — works cross-platform on Node 16.17+ without /dev/stdin path"
  - "Tab-separated columns in human list output (avoids alignment pitfalls per research §Pitfall 6)"
  - "Buffer values from binary-encoded entries written raw to stdout + newline (preserves binary fidelity for STOR-08 entries)"

patterns-established:
  - "CLI exit-code triplet: 0 success / 1 error / 2 miss (UNIX convention for cache-style binaries)"
  - "Stdout/stderr discipline: values + control output on stdout; errors and usage on stderr with whoocache: prefix"

requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08]
test-tiers: [unit, integration]

duration: 7min
completed: 2026-05-02
---

# Phase 03 Plan 01: CLI Binary Summary

**Whoocache binary wired via package.json bin → src/cli.js parseArgs dispatcher with exit codes 0/1/2 and 7 spawnSync tests covering all CLI requirements**

## Performance

- **Duration:** ~7 min
- **Tasks:** 3 (bin field, src/cli.js, test/cli.test.js)
- **Files modified:** 3 (package.json, src/cli.js created, test/cli.test.js created)

## Accomplishments
- `whoocache` binary callable via `node src/cli.js` and via npm bin link
- All five subcommands (get/set/delete/list/clear) mapped 1:1 to createCache API
- Exit-code contract honored: 0=success, 1=error, 2=cache miss on get
- `--stdin` reads value from fd 0 (cross-platform on Node 16.17+)
- `list --json` emits machine-readable JSON; `list` (no flag) emits tab-separated table
- WHOOCACHE_DIR env override enables tmp-dir isolation for tests and dogfood

## Task Commits

1. **Task 1: bin field** — `42143f0` (feat)
2. **Task 2: src/cli.js** — `48cdc86` (feat)
3. **Task 3: test/cli.test.js** — `33b864b` (test)

## Files Created/Modified
- `package.json` — added `"bin": {"whoocache": "./src/cli.js"}` (CLI-01)
- `src/cli.js` — 166-line parseArgs dispatcher (CLI-01..07)
- `test/cli.test.js` — 120-line spawnSync test file with 7 tests (CLI-08)

## Decisions Made
- Used `fs.readFileSync(0, 'utf8')` for `--stdin` rather than path-based `/dev/stdin` (cross-platform; Node 16.17+ supports fd 0 sync read on Windows)
- Kept `--ttl`, `--max-bytes`, `--max-entries` as `string` in parseArgs config (research §parseArgs Contract — `type:'number'` was inconsistent across Node versions); manual `parseInt(val, 10)` with NaN/negative validation
- `strict: false` in parseArgs so unknown flags don't throw (research §Pitfall 3)
- `process.exitCode = 2; break;` on get-miss (NOT `process.exit(2)`) — research §Pitfall 1 documents stdout truncation on fast machines when exit follows write
- Added a 7th test (`delete returns "deleted" or "not found"`) and an 8th-effective test (`unknown subcommand exits 1`) on top of the plan's 5 required tests — both are minimal, defensive, and directly tied to plan must_haves

## Deviations from Plan

None — plan executed as written. No deviation rules triggered for this plan.

## Issues Encountered
None.

## Next Phase Readiness
- CLI surface is stable and tested; no blockers
- Plan 03-02 (dogfood) does NOT use the CLI directly (uses createCache library), so the two plans are independent

---
*Phase: 03-cli-dogfood*
*Completed: 2026-05-02*
