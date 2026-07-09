---
phase: 03-formats-cli-dogfood
plan: 02
subsystem: cli
tags: [cli, parseArgs, dogfood, exit-codes, json-schema]

requires:
  - phase: 01-foundation
    provides: validate() public API throws on schema errors (catch and exit 2)
  - phase: 03-formats-cli-dogfood plan 01
    provides: format infrastructure (not directly used here, but available)
provides:
  - "whooschema CLI binary (subcommand-via-positional, parseArgs only)"
  - "Three-tier exit code contract: 0=valid / 1=data-invalid / 2=usage|file|schema-error"
  - "text and JSON output formats (parseable JSON array on --format json)"
  - "dogfood schema for PAN's .planning/config.json (proves real-world dogfooding)"
  - "deliberately-broken dogfood copy (3 violation hooks: enum/type/required)"
affects: [03-03-tests-bench, npm publish workflow]

tech-stack:
  added:
    - "node:util.parseArgs (built-in, zero new deps)"
    - "node:fs/promises (built-in)"
  patterns:
    - "Subcommand-via-positional (parseArgs has no native subcommand support)"
    - "process.stdout.write + process.exit (NOT console.log — flush guarantee)"
    - "Library throws / binary exits — src/ never calls process.exit"
    - "Em-dash separator (U+2014) in text output: '$path: rule — message'"

key-files:
  created:
    - bin/whooschema.js
    - dogfood/config.schema.json
    - dogfood/config.broken.json
  modified:
    - package.json

key-decisions:
  - "Exit codes: 0/1/2 strict — schema errors (bad regex, $ref cycle, dangling) exit 2 not 1, so CI scripts can distinguish 'your data is wrong' from 'your schema is broken'"
  - "Zero new dependencies — parseArgs from node:util only (CLI-04)"
  - "Em-dash separator in text output is the locked contract; Plan 03-03 asserts it"
  - "Dogfood schema uses additionalProperties:false at both levels — typo-catching contract for PAN config keys"
  - "package.json adds bin/ to files array so npm publish ships the binary"

patterns-established:
  - "Subcommand-via-positional: parseArgs handles flags, positionals[0] is the subcommand"
  - "Three-layer error catch: parseArgs throw / file read / JSON parse / validate throw — each exits 2 with helpful stderr"
  - "Dogfood pair: real-world schema + deliberately-broken copy in dogfood/ folder"

requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04, DOG-01, DOG-02]
test-tiers: [unit, integration]

duration: 5min
completed: 2026-05-02
---

# Phase 3 Plan 02: CLI + Dogfood Summary

**`whooschema` CLI binary with strict 0/1/2 exit codes (parseArgs only — zero deps), plus dogfood schema for PAN's .planning/config.json (validates clean) and a broken copy that fires 6 errors covering enum/type/required violations.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `bin/whooschema.js` (NEW): shebang + parseArgs subcommand-via-positional + 3-tier exit codes (0/1/2) + text/json output, 120 lines
- `dogfood/config.schema.json` (NEW): hand-written schema, additionalProperties:false at both levels, locked enum sets
- `dogfood/config.broken.json` (NEW): 3 violation hooks encoded (enum on mode, type on depth, missing required keys in workflow → fires 1 enum + 1 type + 4 required = 6 errors total)
- `package.json` (MODIFIED): added `"bin": { "whooschema": "./bin/whooschema.js" }` and `bin/` in `files` array
- DOG-01 smoke: `whooschema validate --schema dogfood/config.schema.json --data .planning/config.json` → `OK`, exit 0
- DOG-02 smoke: same against `dogfood/config.broken.json` → 6 errors, exit 1, also parseable in `--format json` mode
- All 61 prior tests still pass — zero regressions

## Task Commits

1. **Task 1: Create bin/whooschema.js (CLI binary)** — `e81d94f` (feat)
2. **Task 2: Dogfood schema + broken copy + bin field in package.json** — `f0f27c3` (feat)

## Files Created/Modified

- `bin/whooschema.js` — CLI entry point: parseArgs, file I/O, validate(), text/json output, exit 0/1/2
- `dogfood/config.schema.json` — Draft-07 schema for PAN's planning config (mode/depth/parallelization/commit_docs/model_profile/workflow)
- `dogfood/config.broken.json` — minimal violation fixture (mode=experimental, depth=5, workflow missing 3 required keys)
- `package.json` — added `bin` field; added `bin/` to `files`; zero runtime dependencies

## Decisions Made

None beyond plan — followed plan spec exactly. Em-dash, exit code triplet, parseArgs-only, additionalProperties:false at both levels — all locked by plan and unchanged.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The DOG-02 broken copy actually produces 6 errors (1 enum + 1 type + 4 required: workflow is missing plan_check, verifier, auto_advance, plus the cascade — confirmed via the json-mode count). Plan said "≥3 errors", verification accepted ≥3, this overshoots cleanly.

## Next Phase Readiness

- CLI infrastructure in place. Plan 03-03 (`test/cli.test.js`) can spawn `bin/whooschema.js` via `spawnSync` and assert on stdout/stderr/exit code.
- Dogfood files in place. Plan 03-03 (`test/dogfood.test.js`) can reference `dogfood/config.schema.json` against the real `.planning/config.json` for DOG-01, and `dogfood/config.broken.json` for DOG-02.
- Plan 03-03's benchmark script (`scripts/bench.js`) is independent of this plan — it builds a synthetic 1MB doc + 200-line schema and asserts <200ms via Date.now() (PERF-01).

---
*Phase: 03-formats-cli-dogfood*
*Completed: 2026-05-02*
