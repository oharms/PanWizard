---
phase: 02-composition-ref
plan: 01
subsystem: schema-loader
tags: [refmap, cycle-detection, $ref, json-schema, esm]

requires:
  - phase: 01-foundation
    provides: walk(), SUBSCHEMA_*_KEYWORDS, KNOWN_KEYWORDS, loadSchema(schema)->schema
provides:
  - "loadSchema(schema) returns { schema, refMap } — locked Phase 2 contract"
  - "buildRefMap indexes definitions/$defs under both '#/definitions/<k>' and '#/$defs/<k>' aliases plus root '#'"
  - "detectCycles DFS rejects circular $ref chains and dangling $refs at load time"
  - "Phase 1 invariants preserved: invalid pattern still throws, unknown keywords still warn once, sub-schema slot walking unchanged"
affects: [02-02-validator-composition-ref, 02-03-tests-composition-ref]

tech-stack:
  added: []
  patterns:
    - "module-private helpers (buildRefMap, detectCycles) — not exported, single export remains loadSchema"
    - "dual-alias refMap keys for definitions/$defs equivalence"
    - "DFS visiting Set with backtrack to allow diamond patterns"

key-files:
  created: []
  modified:
    - src/schema-loader.js
    - test/loader.test.js

key-decisions:
  - "v1 conservative cycle detection: any transitively-self-referential schema is rejected, even with a base case (documented in detectCycles comment)"
  - "Index root schema under '#' so {$ref:'#'} is a syntactically-valid ref string; the cycle detector still rejects pure self-cycles"
  - "Dangling-ref check uses Object.prototype.hasOwnProperty.call so a defined-but-falsy entry would still be detected"
  - "Tie-break for cycle error chain: [...visiting, node.$ref].join(' -> ') gives a readable trail like '#/definitions/A -> #/definitions/B -> #/definitions/A'"

patterns-established:
  - "Loader return shape: { schema, refMap } — destructured downstream, never the bare schema"
  - "Load-time error vocabulary: 'Invalid pattern' (LOAD-01), 'cycle' (LOAD-03/REF-02), 'not found' (REF-01 dangling case)"

requirements-completed: [LOAD-03, REF-02]
test-tiers: [unit]

duration: ~10 min
completed: 2026-05-02
---

# Phase 2 Plan 01: Loader $ref Map + Cycle Detection

**`loadSchema()` now builds a `$ref` resolution map and rejects circular `$ref` chains at load time, returning `{ schema, refMap }` for downstream consumption.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3
- **Files modified:** 2 (`src/schema-loader.js`, `test/loader.test.js`)

## Accomplishments

- Added module-private `buildRefMap(rootSchema)` (Task 1) — indexes `definitions` and `$defs` under both alias forms plus the root under `#`.
- Added module-private `detectCycles(node, refMap, visiting)` (Task 2) — DFS with backtracking visiting Set, throws `$ref cycle detected: ...` on revisit and `$ref target not found: ...` on dangling.
- Rewired `loadSchema()` (Task 3) to call `walk → buildRefMap → detectCycles` and return `{ schema, refMap }`.
- All 40 Phase 1 tests still pass via `node --test`.

## Task Commits

1. **Task 1: Add buildRefMap()** — `b185ba2`
2. **Task 2: Add detectCycles() DFS** — `971db98`
3. **Task 3: Rewire loadSchema** — `6d01bce`

## Files Created/Modified

- `src/schema-loader.js` — added `buildRefMap`, added `detectCycles`, rewired `loadSchema`, updated leading comment to mention LOAD-03.
- `test/loader.test.js` — minor adjustment: the `LOAD-02 known Phase 2/3 keywords do NOT warn` test now uses `{ definitions:{foo:{type:'string'}}, $ref:'#/definitions/foo' }` instead of a dangling `$ref`. The warning-suppression intent is preserved; the schema now also satisfies the new LOAD-03 dangling-ref check.

## Decisions Made

- Updated one Phase 1 test (`test/loader.test.js`, the LOAD-02 known-keyword test) because its prior schema relied on `$ref` being a no-op pre-Phase-2; under the new contract that schema is a dangling ref and rightly throws. The fix preserves the test's intent (verifying $ref doesn't trigger an unknown-keyword warning) while satisfying the new dangling-ref guarantee.

## Locked Load-Time Error Messages

- Cycle: contains `'cycle'` (full text: `'$ref cycle detected: <chain>'`)
- Dangling: contains `'not found'` (full text: `'$ref target not found: <ref>'`)
- Pattern: contains `'Invalid pattern'` (Phase 1, unchanged)

## Phase 2 Contract Notes for Plan 02-02

- Destructure point in `validate.js`: `const { refMap } = loadSchema(schema);`
- Pass `refMap` into `validateNode(schema, data, '$', refMap)`.
- `refMap` keys are literal `$ref` strings. `resolveRef` should look up by the exact key (no JSON Pointer escaping in v1, per pitfall 6).
- Cycle/dangling refs are already rejected at load — `resolveRef` throwing on miss is defensive, not a real production path.

## Issues Encountered

- One Phase 1 test (`LOAD-02: known Phase 2/3 keywords ... do NOT emit unknown-keyword warnings`) used `{ $ref: '#/definitions/foo' }` with no matching `definitions`. Under Phase 2's load-time dangling-ref check, this now throws. Fixed by adding the missing `definitions.foo` to the test schema; the test's intent (no unknown-keyword warning) is preserved.

## Next Phase Readiness

- Plan 02-02 can destructure `refMap` from `loadSchema` and thread it through `validateNode` and the keyword handlers.
- Plan 02-03's `test/ref.test.js` cycle/dangling assertions can rely on the locked error-message vocabulary (`'cycle'`, `'not found'`).

---

*Phase: 02-composition-ref, Plan 01*
*Completed: 2026-05-02*
