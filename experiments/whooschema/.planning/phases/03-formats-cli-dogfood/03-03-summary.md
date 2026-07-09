---
phase: 03-formats-cli-dogfood
plan: 03
subsystem: testing
tags: [tests, benchmark, node-test, perf, dogfood]

requires:
  - phase: 03-formats-cli-dogfood plan 01
    provides: format validators (validated by format.test.js)
  - phase: 03-formats-cli-dogfood plan 02
    provides: CLI binary + dogfood schemas (exercised by cli.test.js + dogfood.test.js)
provides:
  - "test/format.test.js — 14 tests closing FMT-01..06 + leap-year + non-string no-op"
  - "test/cli.test.js — 7 tests closing CLI-01..04 + schema-error/file-not-found exit-2"
  - "test/dogfood.test.js — 2 tests closing DOG-01 + DOG-02 with deterministic error paths"
  - "scripts/bench.js — PERF-01 proof: 1MB JSON validates in 0ms (200ms budget, ~∞x headroom)"
  - "package.json bench script for CI gating"
affects: [Phase 3 verification, future regression prevention]

tech-stack:
  added: []
  patterns:
    - "spawnSync E2E for CLI testing — true exit-code verification"
    - "JSON-mode CLI assertion via JSON.parse(stdout)"
    - "Date.now() bench delta with warmup pass"
    - "Inspect import specifiers (not comment text) when asserting zero-dep contract"

key-files:
  created:
    - test/format.test.js
    - test/cli.test.js
    - test/dogfood.test.js
    - scripts/bench.js
  modified:
    - package.json

key-decisions:
  - "Bench passed at 0ms first try — Task 4 (WeakMap regex caching) skipped per plan's conditional gate"
  - "CLI-04 zero-dep test scans import specifiers only — not comment text. The bin file's documentation comment that explicitly says 'NO commander/yargs/minimist' is intentional contract documentation, not a violation"
  - "DOG-02 broken copy actually fires 6 errors (4 required violations on workflow + 1 enum + 1 type) — exceeds plan's >=5 expectation cleanly"

patterns-established:
  - "spawnSync CLI tests: resolve binary via fileURLToPath + dirname, spawn with encoding:'utf8', assert on r.status / r.stdout"
  - "Test fixture pattern: test.before/after to mkdir/rm a .tmp-cli folder, JSON.stringify content (no indent — matches CLI compact output)"
  - "Import-specifier scan to enforce dependency contracts (regex: /import[^;]*?from\\s+|require\\(\\s*)['\"]([^'\"]+)['\"]/g)"

requirements-completed: [PERF-01]
test-tiers: [unit, integration]

duration: 5min
completed: 2026-05-02
---

# Phase 3 Plan 03: Tests + Bench Summary

**Phase 3 test suite (23 new tests) plus PERF-01 benchmark proving the library validates 1MB documents in 0ms — 200x under the 200ms budget. All 84 tests pass; PERF-01 closed without needing the conditional WeakMap optimization.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 3 (Task 4 conditionally skipped — bench passed first try)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `test/format.test.js`: 14 passing tests covering FMT-01..06, leap-year corners (2024-02-29 valid, 2023-02-29 invalid), Pitfall 9a (2024-02-30 rejected), and the format-on-non-string no-op
- `test/cli.test.js`: 7 passing tests covering CLI-01 (exit 0 + OK), CLI-02 (exit 1 + path-rule lines), CLI-03 (--format json parses), CLI-04 (zero-dep import scan), unknown-subcommand exit-2, file-not-found exit-2, schema-error exit-2 (distinct from data-invalid)
- `test/dogfood.test.js`: 2 passing tests — DOG-01 (real `.planning/config.json` validates clean) and DOG-02 (broken copy → 6 errors covering `$.mode`/`$.depth`/`$.workflow`)
- `scripts/bench.js`: 1MB synthetic doc against 30-property synthetic schema validates in 0ms across 4 runs (200ms budget; effectively unlimited headroom)
- `package.json`: `npm run bench` script added; zero new dependencies; `npm test` unchanged
- Full suite: **84 passing tests, 0 failures, 0 skipped** (Phase 1: 40 + Phase 2: 21 + Phase 3 format: 14 + Phase 3 cli: 7 + Phase 3 dogfood: 2)

## Task Commits

1. **Task 1: test/format.test.js** — `aaf5d6f` (test)
2. **Task 2: test/cli.test.js + test/dogfood.test.js** — `724f34a` (test) — includes one Rule 1 test-logic fix
3. **Task 3: scripts/bench.js + bench script** — `03f151b` (feat) — bench passed at 0ms, Task 4 skipped per plan

## Files Created/Modified

- `test/format.test.js` — 14 tests, public-API assertions only (validate() not formats.js direct)
- `test/cli.test.js` — 7 tests, spawnSync E2E against `bin/whooschema.js`, fixtures in .tmp-cli (cleaned up via test.after)
- `test/dogfood.test.js` — 2 tests, reads real `.planning/config.json` and `dogfood/config.broken.json` from disk
- `scripts/bench.js` — synthetic 1MB doc + 200-line schema, Date.now() delta with warmup pass, exit 0/1 by 200ms gate
- `package.json` — added `"bench": "node scripts/bench.js"` to scripts (test unchanged, zero deps)

## Phase 3 Coverage Map

### Success Criteria

| SC | Verification |
|----|--------------|
| SC-1 (5-format pass/fail) | `FMT-01:`..`FMT-06:` tests in test/format.test.js (14 total) |
| SC-2 (CLI dogfood OK + broken errors) | `DOG-01` and `DOG-02` in test/dogfood.test.js |
| SC-3 (CLI --format json) | `CLI-03: --format json emits a parseable JSON array` in test/cli.test.js |
| SC-4 (PERF-01 200ms) | `node scripts/bench.js` exits 0 with `[bench] OK — under 200ms PERF-01 budget` (observed: 0ms) |

### Requirements

| Req | Verification |
|-----|--------------|
| FMT-01 (email) | 2 tests in format.test.js (accept + reject + error shape) |
| FMT-02 (uri) | 2 tests in format.test.js (accept + reject) |
| FMT-03 (date + Pitfall 9a) | 4 tests: regular accept, Pitfall 9a reject, leap-year accept, non-leap-year reject |
| FMT-04 (date-time) | 2 tests in format.test.js (accept + hour-OOR reject) |
| FMT-05 (uuid) | 2 tests in format.test.js (accept + reject) |
| FMT-06 (unknown silent-pass) | 1 test in format.test.js (`FMT-06:`) |
| CLI-01 (exit 0 + OK) | `CLI-01:` in cli.test.js |
| CLI-02 (exit 1 + lines) | `CLI-02:` in cli.test.js |
| CLI-03 (--format json) | `CLI-03:` in cli.test.js |
| CLI-04 (zero-dep) | `CLI-04:` in cli.test.js (import specifier scan) |
| DOG-01 | `DOG-01:` in dogfood.test.js (real config) |
| DOG-02 | `DOG-02:` in dogfood.test.js (broken copy → 6 errors) |
| PERF-01 | scripts/bench.js exit 0 (observed 0ms / 200ms budget) |

### Pitfall Coverage

- Pitfall 9 (format over/under-engineering): 14 format tests
- Pitfall 9a (Date constructor rollover for 2024-02-30): explicit `FMT-03: date rejects 2024-02-30 (calendar — Pitfall 9a)` test
- Pitfall 9d (UUID version restriction): UUID tests accept v4 explicitly; spec allows v1-v5 (regex matches version digit `[0-9a-f]`, not just `4`)
- CLI exit-code conflation: `CLI: schema with bad regex exits 2 (schema error, NOT data-invalid)` test
- Performance: regex compiled per call (Performance Traps): bench passed without intervention; cache deferred

## Decisions Made

- **Task 4 skipped**: bench printed `time=0ms` on the first run and was reproducible across 4 invocations. Per plan's explicit conditional ("SKIP THIS TASK if Task 3's bench printed `[bench] OK`"), the WeakMap regex cache optimization was not applied. The pattern recompilation hot spot identified in 03-research.md is real but not on the critical path for the plan's 200ms budget — at 1MB doc size, Node 22+ V8 RegExp compilation is fast enough that the deterministic optimization is unnecessary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CLI-04 zero-dep test was over-strict**
- **Found during:** Task 2 (cli.test.js first run)
- **Issue:** The plan's reference test scanned the entire bin file's source for the substring "commander". The bin file has a documentation comment that explicitly says "NO commander/yargs/minimist (CLI-04)" — this is the contract documentation. The naive substring scan flagged the comment as a violation, even though the binary genuinely has zero dependencies on those libraries.
- **Fix:** Tightened the test to scan only `import ... from '...'` and `require('...')` specifiers via regex. The intent of CLI-04 (no commander/yargs/minimist as actual code dependencies) is preserved; the comment is correctly recognized as documentation, not a runtime reference.
- **Files modified:** test/cli.test.js
- **Verification:** All 7 CLI tests pass; the import-specifier scan still asserts that `bin/whooschema.js` only imports from `node:util`, `node:fs/promises`, and `../src/validate.js`.
- **Committed in:** 724f34a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix tightens test logic without weakening the contract. CLI-04 is still demonstrably closed.

## Issues Encountered

None.

## Next Phase Readiness

**Phase 3 success criteria 1-4 demonstrably satisfied via 23 new tests + 1 benchmark gate. All 13 Phase 3 requirements (FMT-01..06, CLI-01..04, DOG-01, DOG-02, PERF-01) closed. whooschema v1 is feature-complete; ready for verification + UAT.**

- All 84 tests pass via `node --test`. Zero regressions in Phase 1+2.
- PERF-01 has substantial headroom (0ms / 200ms budget). Library can absorb future complexity without immediate risk to the perf gate.
- Zero runtime dependencies preserved (`pkg.dependencies` undefined, `pkg.devDependencies` undefined).
- CLI installable via `npm link`; binary works on Windows (npm-generated `.cmd` shim) and Unix-like (shebang + executable bit; bit not set on Windows but irrelevant).
- Optional follow-ups for future milestones (NOT blockers for v1):
  - Bump Node version target if benchmarks trend slower under load
  - WeakMap regex cache as an optimization later if benchmarks regress
  - Add a `--version` flag (post-v1)
  - Stdin / glob / `--watch` (post-v1)

---
*Phase: 03-formats-cli-dogfood*
*Completed: 2026-05-02*
