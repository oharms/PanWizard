---
phase: 03-formats-cli-dogfood
plan: 01
subsystem: validation
tags: [json-schema, formats, regex, validation, draft-07]

requires:
  - phase: 01-foundation
    provides: makeError, validateString, KNOWN_KEYWORDS includes 'format'
  - phase: 02-composition-ref
    provides: stable validateNode dispatch (no changes needed here)
provides:
  - "FORMATS map (email/uri/date/date-time/uuid) as a pluggable validator table"
  - "validateFormat dispatcher (string-only, unknown-format silent-pass per Draft-07)"
  - "format keyword wired into validateString (one call after pattern check)"
affects: [03-02-cli-dogfood, 03-03-tests-bench, future format additions]

tech-stack:
  added: []
  patterns:
    - "Pluggable format table: append a key to FORMATS without touching keyword-handlers.js"
    - "Module-level const regex literals (compile once per process, not per call)"
    - "Anchored regex + manual calendar/leap-year math (NOT new Date() rollover)"

key-files:
  created:
    - src/formats.js
  modified:
    - src/keyword-handlers.js

key-decisions:
  - "Pragmatic email regex (no quoted local parts, no IP literals) — defensible RFC 5322 'simple form'"
  - "URI validation uses new URL() constructor in try/catch — accepts mailto:/ftp:/https:, rejects malformed"
  - "Date validation uses anchored regex + manual leap-year math, NOT new Date() (which silently rolls 2024-02-30 to March 1 — Pitfall 9a)"
  - "UUID regex matches v1-v5 (any version digit, case-insensitive) per RFC 4122"
  - "Unknown formats silently pass per Draft-07 spec — FMT-06 lock"
  - "format applies only to strings (type-guarded twice: in validateString and in validateFormat dispatcher)"

patterns-established:
  - "Pluggable format table: future formats added by appending to FORMATS map without touching keyword-handlers.js"
  - "Anchored regex + per-field range check + leap-year math for calendar validation"

requirements-completed: [FMT-01, FMT-02, FMT-03, FMT-04, FMT-05, FMT-06]
test-tiers: [unit]

duration: 4min
completed: 2026-05-02
---

# Phase 3 Plan 01: Format Validators Summary

**Five JSON Schema Draft-07 format validators (email/uri/date/date-time/uuid) added as a pluggable map plus a single one-line wire-up in validateString — closes FMT-01..06 with zero regressions.**

## Performance

- **Duration:** ~4 min
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `src/formats.js` (NEW): exports `FORMATS` map (5 validators) + `validateFormat` dispatcher
- `src/keyword-handlers.js` (MODIFIED): one new import + one validateFormat call at end of validateString
- All 61 existing Phase 1+2 tests still pass — zero regressions
- Pitfall 9a (date constructor rollover) explicitly mitigated with manual calendar/leap-year math
- All format regexes are module-level `const` (compile once per process, no per-call recompilation)

## Task Commits

1. **Task 1: Create src/formats.js with FORMATS map + validateFormat dispatcher** — `112e5e6` (feat)
2. **Task 2: Wire validateFormat into validateString in src/keyword-handlers.js** — `251c482` (feat)

## Files Created/Modified

- `src/formats.js` — FORMATS map (5 validators) + validateFormat dispatcher; locked regex literals for performance
- `src/keyword-handlers.js` — added `import { validateFormat } from './formats.js'` and one `validateFormat(schema, data, path, errors)` call at end of `validateString`

## Decisions Made

None beyond plan — followed plan spec exactly. The five format formulas, the leap-year math, the dispatcher type-guards, and the FORMATS keys all came from the plan verbatim.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Format infrastructure in place. Plan 03-02 (CLI + dogfood) can use formats in dogfood schemas if desired (the actual `.planning/config.json` shape uses type/enum/required/additionalProperties only, so it doesn't need formats — but `dogfood/config.broken.json` could exercise format errors).
- Plan 03-03 (test suite) will close FMT-01..06 with `test/format.test.js`: 5 happy-paths, 5 deliberate rejects, leap-year corners, FMT-06 unknown-format case, and the non-string no-op case.
- End-to-end format dispatch verified: 13 cases pass via the public `validate()` API. SC-1 (rule:'format' on email failure), Pitfall 9a (2024-02-30 rejected), and FMT-06 (unknown format silently passes) all confirmed.

---
*Phase: 03-formats-cli-dogfood*
*Completed: 2026-05-02*
