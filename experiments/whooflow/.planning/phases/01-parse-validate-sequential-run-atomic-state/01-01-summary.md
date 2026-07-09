---
phase: 01-parse-validate-sequential-run-atomic-state
plan: 01
subsystem: infra
tags: [esm, node-test, typed-errors, exit-codes]

requires: []
provides:
  - "package.json with ESM, Node 18.17+, zero deps, npm test wired"
  - "src/errors.js: ValidationError, CycleError, RuntimeError + exitCodeFor"
  - ".gitignore covering node_modules, state file, tmp files"
affects: [loader, validator, state, executor, scheduler, formatter, cli]

tech-stack:
  added: ["node:test (built-in)", "node:assert/strict (built-in)"]
  patterns:
    - "ESM with explicit .js extensions on imports (`import x from './y.js'`)"
    - "Typed errors carry .code for stable cross-module routing"
    - "exitCodeFor as the single source of truth for exit-code mapping"

key-files:
  created:
    - "package.json"
    - ".gitignore"
    - "src/errors.js"
    - "test/errors.test.js"
  modified: []

key-decisions:
  - "Locked ESM (\"type\": \"module\") — all later plans use import/export with .js extensions"
  - "Locked Node engines >=18.17.0 — unlocks parseArgs, node:test, structuredClone without flags"
  - "Zero dependencies — no devDependencies block (no jest/vitest/etc; node:test is built-in)"
  - "Bin entry pre-declared at ./bin/whooflow.js even though file lands in Plan 05"

patterns-established:
  - "Test files live in test/ as *.test.js, run via `node --test test/`"
  - "Imports use explicit .js extension (ESM requirement)"
  - "Error class files export the class itself, not a factory"

requirements-completed: [CLI-10]
test-tiers: [unit]

duration: 5min
completed: 2026-05-02
---

# Phase 1 Plan 01: Project Scaffold + Typed Errors Summary

**Zero-dependency ESM project scaffold with Node 18.17+ floor and typed-error/exit-code contract (ValidationError|CycleError -> 2, RuntimeError|Error -> 1, success -> 0).**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- Project is buildable and testable (`npm test` green)
- ESM lock-in committed in package.json — no later plan revisits the module system question
- Node 18.17 floor encoded — first cross-cutting prerequisite from context.md is satisfied
- Error -> exit-code contract (CLI-10) defined and tested; Plans 02-05 import from `src/errors.js` instead of redefining

## Task Commits

1. **Task 1: package.json + .gitignore** — `5d25a12` (feat)
2. **Task 2: src/errors.js + test/errors.test.js** — `a254de1` (feat)

## Files Created/Modified
- `package.json` — ESM, Node 18.17+, zero deps, npm test
- `.gitignore` — node_modules, whooflow.state.json, *.tmp, .DS_Store
- `src/errors.js` — ValidationError / CycleError / RuntimeError / exitCodeFor (33 lines)
- `test/errors.test.js` — 6 tests covering all classes + exit-code mapping (35 lines)

## Decisions Made
- **ESM over CJS** — research/summary.md recommends ESM; aligns with parseArgs and node:test docs.
- **Node >=18.17.0** — bump from idea.md's >=16; allows parseArgs/structuredClone without warnings.
- **Zero deps** — the whole pitch. Adding any dependency is a regression and should be rejected.
- **Test framework: node:test** — built-in, zero install, runs via `node --test`.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
- All Wave 2 plans (01-02 loader/validator, 01-03 state/executor) can now `import { ValidationError, CycleError, RuntimeError } from './errors.js'`.
- ESM convention (.js extensions in imports) and zero-dep constraint are locked in for the rest of the phase.

---
*Phase: 01-parse-validate-sequential-run-atomic-state*
*Completed: 2026-05-02*
