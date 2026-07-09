---
phase: 01-foundation
plan: 02
status: complete
completed: 2026-05-02
requirements: [API-01, API-02, TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-05]
---

# Plan 02 Summary — Keyword Handlers + Public API

## Files Created / Updated

| File | Action | Exports |
|------|--------|---------|
| `src/keyword-handlers.js` | created | `validateType`, `validateString`, `validateNumber`, `validateArray`, `validateObject`, `validateEnum`, `canonicalize` |
| `src/validator-core.js` | rewritten (replaced shell) | `validateNode` (real dispatcher) |
| `src/validate.js` | created | `validate` (public API) |

## Pitfall Mitigations Applied

| # | Pitfall | Where | Proof |
|---|---------|-------|-------|
| 1 | NaN/Infinity bypass | `keyword-handlers.js` `matchesType` | `Number.isNaN` + `Number.isFinite` checks for type:number/integer |
| 2 | Mutable path corruption | architectural | All paths use `appendKey`/`appendIndex` returning new strings |
| 4 | additionalProperties + patternProperties union | `validateObject` | `compiledPatterns` array consulted before flagging additional props |
| 7 | uniqueItems naive equality | `canonicalize` | Recursive key-sort stringify; `{a:1,b:2}` and `{b:2,a:1}` collide |
| 8 | pattern unintended flags | `validateString` | `new RegExp(p)` with no flags arg |
| 11 | Path format | `appendIndex` | `[N]` bracket notation; never `.N` |

## Locked Behaviors for Plan 03 Tests

1. `validate({type:'string'}, 42)` => `{valid:false, errors:[{path:'$', rule:'type', message: '...', value:42, expected:'string'}]}`
2. Multiple keyword failures aggregate (no short-circuit) — every handler runs unconditionally; type-specific guards are early returns, not throws.
3. `additionalProperties:false` errors carry the path of the offending child property (`$.parent.badKey`), not the parent.
4. `required` errors omit `value` from the object (caller passes undefined).
5. `validate({pattern:'['}, anything)` throws `Error("Invalid pattern...")` BEFORE validateNode runs — guaranteed by call order in `validate.js`.
6. Determinism: identical input produces byte-identical `JSON.stringify(result.errors)` (handler order is fixed, sort is stable, `expected` is omitted-not-undefined).

## Deviations from Plan

`validateEnum` lifted out of `validateString` into its own export and dispatched at validateNode level (this was already explicitly allowed in the plan).

## Verification

All three task `<verify>` automated checks passed. Smoke tests for pitfall mitigations (#1, #4, #7, #8, #11) all pass via `validate()` end-to-end. Three atomic commits made.
