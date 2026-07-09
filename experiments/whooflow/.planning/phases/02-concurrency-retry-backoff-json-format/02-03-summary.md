---
phase: 02-concurrency-retry-backoff-json-format
plan: 03
subsystem: cli
tags: [json, ndjson, formatter, structured-clone, bigint-conversion]

requires:
  - phase: 02-01
    provides: seq counter on every event, scheduler emit shape
  - phase: 02-02
    provides: stable event surface (retry transparent — single ok|fail per task)
provides:
  - createJsonFormatter() — sibling to createTextFormatter; emits NDJSON to stdout
  - duration_ns: Number(durationNs) at scheduler emit (post-Plan 03 conversion)
  - --format text|json CLI option (validated; invalid -> exit 2)
  - structuredClone snapshot safety at the formatter boundary
affects:
  - 02-04 (preflight): no direct dependency; CLI parseArgs config will gain --dry-run/--list

tech-stack:
  added: []
  patterns:
    - "JSON formatter as sibling factory (same event-subscriber shape as text formatter)"
    - "structuredClone(event) at formatter boundary — defensive snapshot"
    - "BigInt -> Number conversion at scheduler emit for JSON.stringify compatibility"
    - "formatDuration polymorphic over BigInt and Number (back-compat)"

key-files:
  created:
    - test/json-formatter.test.js
  modified:
    - src/formatter.js
    - src/scheduler.js
    - src/cli.js
    - test/integration.test.js

key-decisions:
  - "duration_ns converted to Number at scheduler emit (precision safe up to ~100 days; documented)"
  - "structuredClone at formatter boundary, not at scheduler — defensive insurance against future event-shape changes"
  - "JSON formatter does NOT filter running events (text suppresses; JSON consumers want full visibility)"
  - "Single-subscriber rule: --format json installs createJsonFormatter as the SOLE subscriber; no parallel text emission"
  - "Integration test uses silent fixture (node -e \"\") because stdio: 'inherit' from children bleeds child output into stdout — Phase 1 design decision; Phase 3 may revisit if total stdout isolation is needed"

patterns-established:
  - "Test pattern: capture events directly via onEvent, then run formatter over captured events — avoids node:test stdout capture fragility on Windows"
  - "JSON formatter as a renderer over scheduler-emitted seq (single source of monotonicity)"

requirements-completed: [CLI-04]
test-tiers: [unit, integration]

duration: ~30 min
completed: 2026-05-02
---

# Phase 2 Plan 03: --format json Summary

**NDJSON output for machine consumers — createJsonFormatter sibling factory, duration_ns Number conversion at emit, validated --format CLI flag**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 (all atomic-committed)
- **Files modified:** 4 (src/formatter.js, src/scheduler.js, src/cli.js, test/integration.test.js)
- **Files created:** 1 (test/json-formatter.test.js)
- **Tests:** 86 → 93 (+7 new tests; all passing)

## Accomplishments

- `createJsonFormatter()` exported alongside `createTextFormatter()` — same event-subscriber shape
- `structuredClone(event) + JSON.stringify + '\n'` per emission (defensive snapshot)
- `duration_ns: Number(durationNs)` at every scheduler emit site — BigInt would throw on JSON.stringify
- `formatDuration` made polymorphic (BigInt and Number both supported)
- CLI `--format text|json` option with validation (invalid → stderr + exit 2)
- 5 unit tests for JSON formatter + 2 integration tests for CLI

## Task Commits

1. **Task 1: createJsonFormatter + duration_ns conversion** — `0f0ae76` (feat)
2. **Task 2: Wire --format CLI option** — `944da33` (feat)
3. **Task 3: Tests (json-formatter.test.js + integration)** — `0a080d4` (test)

## Files Created/Modified

- `src/formatter.js` — added `createJsonFormatter`; updated `formatDuration` to accept BigInt or Number; updated header
- `src/scheduler.js` — `duration_ns: Number(durationNs)` at success and failed emit sites
- `src/cli.js` — `format: { type: 'string', default: 'text' }` parseArgs option; `formatVal` validation; ternary formatter selection; help text update; CLI-04 in header
- `test/json-formatter.test.js` (new, ~165 LOC) — NDJSON discipline, seq monotonicity, structuredClone safety, duration_ns Number, running events not filtered
- `test/integration.test.js` — added 2 subprocess tests: --format json (silent fixture), --format xml exits 2

## Decisions Made

- **duration_ns conversion at scheduler emit, not formatter.** The scheduler is the single source of the `duration_ns` field; converting at the source keeps both formatters (text + JSON) free of BigInt vs Number conditionals. Precision is safe up to 2^53 ns (~100 days per task).
- **structuredClone at formatter, not scheduler.** Phase 2's events are flat primitives, but a future event-shape change (e.g., embedding currentState) cannot introduce mutation-after-emit bugs at the JSON path. Cost: zero (one structuredClone per event = sub-microsecond).
- **JSON formatter does NOT filter running events.** Text formatter filters them for human readability ("running" events would spam the console). JSON consumers (CI, dashboards) want full visibility — they can filter at parse time.
- **Silent fixture in integration test.** Phase 1's `stdio: 'inherit'` for children means task stdout bleeds into the parent's stdout. Real users running `whooflow run --format json` with verbose tasks will see mixed output. The integration test uses silent `node -e ""` children to verify pure NDJSON purity. Phase 3 may revisit if true stdout isolation is needed.

## Deviations from Plan

**1. [Test infrastructure] captureStdoutAsync didn't return captured output reliably under node:test on Windows**
- **Found during:** Task 3 (json-formatter tests)
- **Issue:** Replacing `process.stdout.write` doesn't catch stdio inheritance from child processes, AND node:test on Windows has fragile stdout-buffer interaction.
- **Fix:** Refactored tests to capture events directly via `onEvent: (e) => events.push(e)`, then run the formatter synchronously over the captured events using a simpler `captureStdout` (no async). Pure formatter tests now use direct `fmt(event)` calls.
- **Files modified:** test/json-formatter.test.js
- **Verification:** All 5 json-formatter tests pass.
- **Committed in:** `0a080d4` (Task 3 commit)

**2. [Integration test] Linear fixture had children that wrote to stdout**
- **Found during:** Task 3 (integration test for --format json)
- **Issue:** linear.json fixture has tasks like `cmd: "node -e \"console.log('a')\""`. With `stdio: 'inherit'`, child output mixes into stdout — breaking "all-NDJSON" assertion.
- **Fix:** Wrote a silent fixture inline (node -e "" children) using `writeFileSync` directly in the test.
- **Files modified:** test/integration.test.js (added writeFileSync import)
- **Verification:** Both new integration tests pass.
- **Committed in:** `0a080d4` (Task 3 commit)

**Total deviations:** 2 auto-fixed (test infrastructure)
**Impact on plan:** No production code change. Tests verify the contract (NDJSON output from the formatter); the inherited-stdio interaction is a separate Phase 1 architectural decision.

## Issues Encountered

- **Plan said "use binPath" for integration tests** — actual integration.test.js uses a `BIN`/`runCli` helper. Adapted to the existing convention.

## Next Phase Readiness

**Plan 02-04 (preflight) consumes:**
- `--format` flag plumbing in cli.js (parseArgs config) — Plan 04 adds `--dry-run` and `--list` alongside it
- The validate-then-dispatch pattern — Plan 04 dispatches preflight commands BEFORE assertWritable

**Phase 3 may revisit:**
- The stdio: 'inherit' on child processes is a Phase 1 decision; if Phase 3 needs total stdout isolation under --format json, executor.js would need a stdio: 'pipe' branch.

---
*Phase: 02-concurrency-retry-backoff-json-format*
*Plan: 03*
*Completed: 2026-05-02*
