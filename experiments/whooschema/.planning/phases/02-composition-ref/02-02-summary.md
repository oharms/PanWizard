---
phase: 02-composition-ref
plan: 02
subsystem: validator
tags: [composition, $ref, allOf, anyOf, oneOf, not, draft-07]

requires:
  - phase: 02-composition-ref
    provides: loadSchema -> { schema, refMap }, locked load-time error vocabulary
provides:
  - "validate() destructures refMap from loadSchema and threads it through validateNode"
  - "validateNode(schema, data, path, refMap = {}) — refMap-aware dispatcher"
  - "$ref short-circuit at top of validateNode (REF-01: path transparency, sibling keywords ignored per Draft-07)"
  - "Composition dispatch (allOf/anyOf/oneOf/not) inline after primitives"
  - "validateArray and validateObject thread refMap into all internal validateNode calls"
  - "Composition wrapper-error shapes locked: anyOf/oneOf/not have rule wrappers; allOf has none (raw aggregation)"
affects: [02-03-tests-composition-ref]

tech-stack:
  added: []
  patterns:
    - "Default refMap = {} keeps validateNode callable without a refMap (e.g. tests / direct use)"
    - "anyOf/oneOf use reduce((a,b) => a.length <= b.length ? a : b) — leftmost branch wins on ties"
    - "Composition runs AFTER primitives so combined schemas like {type:'string', allOf:[...]} report deterministically"

key-files:
  created: []
  modified:
    - src/validate.js
    - src/validator-core.js
    - src/keyword-handlers.js

key-decisions:
  - "Path transparency for $ref: validateNode(target, data, path, refMap) reuses the call-site path, never injecting 'definitions' or '$ref' segments"
  - "$ref short-circuit returns immediately — sibling keywords ignored per Draft-07"
  - "allOf has no wrapper: callers see raw branch errors aggregated, which gives the most actionable diagnostic"
  - "anyOf 0-match: emit wrapper + fewest-errors branch's sub-errors only (Pitfall 10 mitigation)"
  - "oneOf 2+-match: emit wrapper '(matched N)' WITHOUT sub-errors — branches passed, so there are no failing sub-errors to surface"
  - "not pass: single rule:'not' error, no sub-error leakage from the inner schema"
  - "not non-object guard mirrors Phase 1 pattern (typeof === 'object' && !== null) — boolean form silently no-ops in v1"

patterns-established:
  - "Composition wrapper rule names: anyOf, oneOf, not (allOf has no wrapper)"
  - "oneOf message template: 'value must match exactly one schema (matched N)' for N=0 or N>=2"
  - "anyOf message: 'value must match at least one schema'"
  - "not message: 'value must not match schema'"

requirements-completed: [COMP-01, COMP-02, COMP-03, COMP-04, REF-01]
test-tiers: [unit]

duration: ~12 min
completed: 2026-05-02
---

# Phase 2 Plan 02: Validator Composition + $ref Wiring

**`validate()` end-to-end now supports JSON Schema composition (`allOf`, `anyOf`, `oneOf`, `not`) and local `$ref` resolution with Draft-07 sibling-ignore + path transparency.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `validate()` destructures `refMap` from `loadSchema` and threads it into `validateNode`.
- `validateNode` now accepts `refMap = {}` as 4th parameter, has a `$ref` short-circuit at the top, and dispatches `allOf`/`anyOf`/`oneOf`/`not` inline after primitives.
- `validateArray` and `validateObject` accept and forward `refMap` to all four internal `validateNode` calls — closes the recursion path so `$ref` and composition work inside nested arrays/objects.
- All 40 Phase 1 tests still pass.

## Task Commits

1. **Task 1: validate.js destructure** — `20105ed`
2. **Task 2: validator-core.js refMap + composition** — `9562a54`
3. **Task 3: keyword-handlers.js thread refMap** — `f7c3911`

## Files Created/Modified

- `src/validate.js` — destructures `refMap`, threads to `validateNode`. Header comment updated to mention Phase 2 refMap threading.
- `src/validator-core.js` — added `refMap = {}` parameter, `$ref` short-circuit, four composition dispatch blocks, private `resolveRef` helper. Imports `makeError` from error-utils.
- `src/keyword-handlers.js` — `validateArray` and `validateObject` accept `refMap = {}` (5th param) and forward it to internal `validateNode` calls.

## Final validateNode Signature & Dispatch Order

```
validateNode(schema, data, path, refMap = {})
```

1. `$ref` short-circuit (returns early; sibling keywords ignored per Draft-07)
2. validateType
3. validateEnum
4. validateString
5. validateNumber
6. validateArray(refMap)
7. validateObject(refMap)
8. allOf (raw aggregation, no wrapper)
9. anyOf (wrapper + fewest-errors branch on 0-match)
10. oneOf (wrapper '(matched N)' for N=0 or N>=2; valid on N=1)
11. not (single 'not' error when inner passes)

## Locked Behaviors for Plan 02-03 Tests

- **`oneOf` 2-match (SC-1):** single error with message including `'matched 2'`, NO sub-errors.
- **`anyOf` 0-match (SC-2):** wrapper error first, then ONLY the fewest-errors branch's sub-errors (not all branches').
- **`allOf` (SC-3):** no wrapper; errors aggregated raw from all failing branches.
- **`not` pass:** no error; **`not` fail:** single `rule:'not'` error at the call-site path.
- **`$ref` (SC-4):** target's errors carry the original call-site path (`$`, `$.email`, etc.) — no `definitions` or `$ref` segments leak.
- **Sibling-ignore (Draft-07):** `{$ref:'...', minimum:5}` validates only against the ref target.

## Decisions Made

- Default `refMap = {}` on the new parameters keeps existing direct-callers (e.g. tests calling `validateNode` without going through `validate`) working unchanged.
- `not` non-object form (`not: true` / `not: false`) silently no-ops in v1 — out of scope per Plan 02-02's interface comment.
- `resolveRef` throws on misses defensively; in production this branch is unreachable because `detectCycles` (Plan 02-01) already rejects dangling refs at load time.

## Deviations from Plan

None — implemented as specified.

## Issues Encountered

None — Phase 1 test suite stayed green at every commit.

## Next Phase Readiness

- Plan 02-03 can now write tests against the locked composition wrapper-error shapes and $ref path-transparency contract.
- All Phase 2 source-code changes are in place; only the test files remain.

---

*Phase: 02-composition-ref, Plan 02*
*Completed: 2026-05-02*
