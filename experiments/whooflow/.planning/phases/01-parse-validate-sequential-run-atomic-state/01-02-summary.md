---
phase: 01-parse-validate-sequential-run-atomic-state
plan: 02
subsystem: parse
tags: [loader, validator, kahn, cycle-detection, json-parsing]

requires:
  - phase: "01"
    provides: "ValidationError, CycleError, RuntimeError typed-error contract"
provides:
  - "loadFlow(path) -> normalized Flow IR"
  - "validateFlow(flow) -> ValidatedFlow with .children + .topoOrder"
  - "detectCycle(flow) exposed for direct testing"
  - "16 test fixtures locked in for Plans 04 and 05 reuse"
affects: [scheduler, cli]

tech-stack:
  added: []
  patterns:
    - "Loader does basic shape; validator aggregates schema errors and detects cycles"
    - "Iterative Kahn topo-sort + leftover-DFS path recovery (no recursion -> no RangeError)"
    - "U+2192 EM ARROW (→) as canonical cycle path separator"

key-files:
  created:
    - "src/loader.js"
    - "src/validator.js"
    - "test/loader.test.js"
    - "test/validator.test.js"
    - "test/fixtures/linear.json"
    - "test/fixtures/diamond.json"
    - "test/fixtures/cycle-2.json"
    - "test/fixtures/cycle-self.json"
    - "test/fixtures/cycle-long.json"
    - "test/fixtures/dup-id.json"
    - "test/fixtures/missing-dep.json"
    - "test/fixtures/bad-retry.json"
    - "test/fixtures/empty-id.json"
    - "test/fixtures/null-tasks.json"
    - "test/fixtures/empty-tasks.json"
    - "test/fixtures/malformed.json"
    - "test/fixtures/single.json"
    - "test/fixtures/single-fail.json"
  modified: []

key-decisions:
  - "Flow IR shape is {tasks: {[id]: task}, children: {[id]: [childId]}, topoOrder: [id]} — locked for Plan 04+05"
  - "Loader catches duplicate ids; validator trusts uniqueness — separates concerns cleanly"
  - "Iterative Kahn over recursive DFS — pitfall C1 (no RangeError on long chains)"
  - "Schema errors aggregated into ValidationError.details[] (M5 mitigation) — single throw lists all problems"
  - "ID charset: /^[A-Za-z0-9_][A-Za-z0-9_./:-]*$/ — explicit deny-list of whitespace and arrow chars"

patterns-established:
  - "Test fixtures live in test/fixtures/*.json with portable node -e commands (pitfall C6)"
  - "Cycle errors include the actual cycle path with U+2192 separator: 'cycle detected: a → b → a'"

requirements-completed: [PARSE-01, PARSE-02, PARSE-03, PARSE-04, PARSE-05]
test-tiers: [unit]

duration: 12min
completed: 2026-05-02
---

# Phase 1 Plan 02: Parse + Validate Pipeline Summary

**JSON loader with shape normalization (default depends_on=[], retry={attempts:1, backoff_ms:0}) and validator with aggregated schema errors + iterative-Kahn cycle detection (diamond DAGs accepted, 1000-chain no RangeError, cycle path recovered).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files created:** 18 (2 src + 2 tests + 14 fixtures)

## Accomplishments
- 5 of 18 phase requirements addressed: PARSE-01..PARSE-05
- Pitfall mitigations verified: C1 (Kahn iterative + leftover-DFS), C2 (normalize), M5 (aggregated), C6 (portable test cmds)
- Flow IR shape locked in for Plans 04+05: `{tasks, children, topoOrder}`
- Test fixtures available for reuse by Plans 04 (scheduler) and 05 (CLI integration)

## Task Commits

1. **Task 1+2: loader.js + validator.js** — `1d83da7` (feat)
2. **Task 3: fixtures + tests** — `98a7cee` (test) — 17 tests passing

## Files Created/Modified
- `src/loader.js` — readFile, JSON.parse, normalize Flow IR (~95 lines)
- `src/validator.js` — aggregated schema check + iterative Kahn + leftover DFS (~145 lines)
- `test/loader.test.js` — 8 tests covering PARSE-01/02, normalization, ordering
- `test/validator.test.js` — 9 tests covering PARSE-03/04/05, C1 (diamond, 1000-chain, self-loop, long cycle), M5
- `test/fixtures/*.json` — 14 catalogued fixtures

## Decisions Made
- **Loader vs validator division:** loader does file I/O + basic per-task shape (id-is-string, depends_on-is-array, retry-is-object-or-default); validator does cross-task validation (depends_on references, retry shape, ID charset, cycles). Aggregated errors are validator-only.
- **Iterative Kahn algorithm:** chosen over recursive DFS to defend pitfall C1. The 1000-task linear-chain test verifies no RangeError.
- **Cycle path recovery:** separate `recoverCyclePath` does iterative DFS over the leftover subgraph after Kahn discovers the cycle, with a special-case for self-loops (a→a).
- **Aggregated errors (M5):** all schema problems collected into `errors[]`, joined into one human-readable message + machine-readable `details[]` array. CLI prints `details[]` line-by-line.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
- Plan 04 (scheduler) consumes `validatedFlow` (with `.children` and `.topoOrder` filled). Contract is locked.
- Plan 05 (CLI) wires `loadFlow` → `validateFlow` and maps `ValidationError`/`CycleError` to exit code 2.
- Fixture catalog is complete: linear/diamond/single available for happy-path tests; cycle-2/self/long, dup-id, missing-dep, bad-retry, empty-id, null-tasks, malformed available for failure tests; single-fail available for "non-zero exit" path.

---
*Phase: 01-parse-validate-sequential-run-atomic-state*
*Completed: 2026-05-02*
