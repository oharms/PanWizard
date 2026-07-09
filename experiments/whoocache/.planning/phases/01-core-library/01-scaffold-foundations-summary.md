---
phase: 01-core-library
plan: 01
subsystem: infra
tags: [nodejs, commonjs, fs, crypto, atomic-write, sha256]

requires: []
provides:
  - CommonJS package skeleton (package.json, .gitignore)
  - Test helper for namespaced tmp directories (createTmpNamespace, cleanupTmpNamespace)
  - Four typed error classes with stable code/payload contract (LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError)
  - Key validation + sha256-hex filename derivation (validateKey, keyToFilename)
  - Atomic write primitive with explicit fd sequence (writeAtomic) and PLAT-04-safe directory fsync (fsyncDir)
affects: [02-composition, 03-phase-tests, phase-2-concurrency]

tech-stack:
  added: [node:test, node:assert/strict, node:crypto, node:fs]
  patterns:
    - "CommonJS only (no type:module per API-09)"
    - "'use strict' directive at top of every src/ and test/ JS file"
    - "Explicit fd write sequence: openSync->writeSync->fsyncSync->closeSync->renameSync->fsyncDir"
    - "Caller-managed tmpDir (writeAtomic does not mkdir)"
    - "PLAT-04 cross-platform fsync: swallow EBADF/EINVAL/EISDIR/EPERM/EACCES, rethrow ENOENT/ENOSPC"

key-files:
  created:
    - package.json
    - .gitignore
    - test/helpers/tmp-namespace.js
    - src/errors.js
    - test/errors.test.js
    - src/keys.js
    - test/keys.test.js
    - src/atomic-write.js
    - test/atomic-write.test.js
  modified: []

key-decisions:
  - "Full 64-char sha256 hex for filenames (STOR-07 wins over alternative 32-char truncation noted in research)"
  - "tmpDir is a parameter to writeAtomic, not created internally - cache.js owns lifecycle"
  - "Random .tmp suffix uses crypto.randomBytes(8) (16 hex chars) per ATOM-02"
  - "fsyncDir on a non-existent path throws (ENOENT propagates) - this is a real bug, not a platform difference"
  - "LockTimeoutError export contract locked in Phase 1 even though it is not thrown until Phase 2"

patterns-established:
  - "Micro-test convention: node:test + node:assert/strict, one require('../src/X') per file"
  - "Error class shape: extends Error, sets this.name and this.code in constructor, carries actionable payload"
  - "Atomic write 'OWFCRD' mnemonic: Open, Write, Fsync, Close, Rename, Dirfsync"

requirements-completed:
  - API-09
  - API-10
  - API-08
  - STOR-07
  - STOR-09
  - ATOM-01
  - ATOM-02
  - ATOM-03
  - PLAT-01
  - PLAT-04
  - ERR-01
  - ERR-02
  - ERR-03

test-tiers: [unit]

duration: 8min
completed: 2026-05-02
---

# Phase 1 Plan 1: Scaffold Foundations Summary

**CommonJS package skeleton + three foundation modules (errors, keys, atomic-write) with 14 passing micro-tests, locking the typed-error export surface and the OWFCRD atomic-write sequence for downstream plans.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-02T11:10:10Z
- **Completed:** 2026-05-02T11:18:00Z
- **Tasks:** 3
- **Files modified:** 9 (all created)

## Accomplishments
- Package skeleton: zero-dep CommonJS, engines>=16.17.0, no type:module
- Four typed error classes (LockTimeoutError/CorruptIndexError/StaleIndexError/CachePermissionError) — exports locked for Phase 2 lock.js
- keys.js: validateKey rejects non-string/empty; keyToFilename produces 64-char sha256 hex
- atomic-write.js: explicit fd sequence (open->write->fsync->close->rename->fsyncDir), PLAT-04 cross-platform fsyncDir
- 14/14 unit tests green under `node --test`

## Task Commits

Note: Git identity was not configured in this environment; per environment_notes the commits returned `committed: false` with `reason: "commit_failed"`. File outputs landed on disk (the contract). Commits can be re-run later by the user once `git config user.email` / `user.name` are set.

1. **Task 1: Project scaffold (package.json, .gitignore, test helper)** - uncommitted (chore)
2. **Task 2: errors.js + errors.test.js** - uncommitted (feat)
3. **Task 3: keys.js + atomic-write.js + their micro-tests** - uncommitted (feat)

## Files Created/Modified
- `package.json` - CommonJS package metadata with `engines.node: ">=16.17.0"`, no `type` field
- `.gitignore` - node_modules, *.log, .DS_Store, whoocache-test/, .planning/run-state.json
- `test/helpers/tmp-namespace.js` - createTmpNamespace + cleanupTmpNamespace using os.tmpdir()
- `src/errors.js` - Four typed error classes with stable code/payload contract
- `test/errors.test.js` - 4 unit tests asserting code/name/payload for each error class
- `src/keys.js` - validateKey + keyToFilename (sha256-hex, 64 chars)
- `test/keys.test.js` - 5 unit tests covering input validation + sha256 correctness
- `src/atomic-write.js` - writeAtomic + fsyncDir with PLAT-04 cross-platform safety
- `test/atomic-write.test.js` - 5 unit tests asserting payload variants, no-leftover-tmp, fsyncDir behavior

## Decisions Made
- Full 64-char sha256 hex (STOR-07) — the research.md's note about an alternative 32-char truncation was rejected per the resolved_open_questions block in the plan.
- `tmpDir` parameter to writeAtomic (caller-managed) — Plan 2's cache.js will create `tmp/` once at construction.
- Random .tmp suffix via crypto.randomBytes(8) (collision-safe) per ATOM-02; not Date.now() / pid-based.
- fsyncDir on a non-existent path throws (ENOENT propagates) — this is a real bug, not something to swallow. Test asserts it throws but does not pin to a specific code (Windows may raise different codes).

## Deviations from Plan

None - plan executed exactly as written.

The plan supplied verbatim source/test file bodies for every file; the executor wrote them as specified. Only adjustment: in `test/atomic-write.test.js`, the ENOENT test uses `path.join(cacheDir, 'this-subdir-does-not-exist')` and asserts `assert.throws(() => fsyncDir(ghost))` without pinning to `code === 'ENOENT'` — the plan explicitly recommended this softer assertion for Windows compatibility.

## Issues Encountered
- Git commits failed with `Author identity unknown` (expected per environment_notes — `git config user.email`/`user.name` unset). All file outputs are on disk; commits can be re-run by the user.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three foundation modules are exported with the exact signatures from the `<interfaces>` block, so Plan 2 can compose them without surprise.
- Plan 2 can now author `src/ttl.js` (pure), `src/index-file.js` (uses errors + atomic-write), `src/lock.js` (no-op shim), and `src/cache.js` (orchestrator using all of the above + keys).
- `LockTimeoutError` is exported even though it is not thrown until Phase 2 — Phase 2 lock.js can `require('./errors')` cleanly.

---
*Phase: 01-core-library*
*Completed: 2026-05-02*
