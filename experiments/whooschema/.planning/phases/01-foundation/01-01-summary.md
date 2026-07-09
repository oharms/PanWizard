---
phase: 01-foundation
plan: 01
status: complete
completed: 2026-05-02
requirements: [API-04, API-05, LOAD-01, LOAD-02, TEST-02]
---

# Plan 01 Summary — Foundation Data Structures

## Files Created

| File | Exports | Purpose |
|------|---------|---------|
| `package.json` | (n/a) | Zero-dep ESM package, Node >= 18, `node --test` script |
| `index.d.ts` | `ValidationError`, `ValidationResult`, `validate` | Public TS surface |
| `src/error-utils.js` | `makeError`, `sortErrors`, `appendKey`, `appendIndex` | Error factory + numeric-aware path sort |
| `src/schema-loader.js` | `loadSchema` | Pre-walk: bad pattern throw + unknown-keyword warn-once |
| `src/validator-core.js` | `validateNode` (shell), `makeError`, `appendKey`, `appendIndex` (re-exports) | Locked dispatch signature |

## Locked Contracts (for Plan 02 to rely on)

1. **ValidationError shape:** `{ path, rule, message, value, expected? }`. `expected` is OMITTED entirely from the object when caller passes undefined — keeps `JSON.stringify` byte-identical (API-03 determinism).

2. **Path syntax:** JSONPath bracket-index. `appendKey(p, k)` => `p + '.' + k`. `appendIndex(p, i)` => `p + '[' + i + ']'`. Forward slashes never produced.

3. **`sortErrors(errors)`:** numeric-aware, stable, returns a new array. Splits on `/(\.[^.\[]+|\[\d+\])/`; numeric `[N]` segments compare as numbers so `[2]` precedes `[10]`.

4. **`loadSchema(schema)` (LOAD-01 + LOAD-02):**
   - Throws `Error("Invalid pattern regex \"...\" at schema-load time: ...")` on any bad `pattern: string` anywhere in the schema tree.
   - `console.warn`s exactly once per unknown keyword per Node process via a module-level `warned: Set<string>`.
   - `KNOWN_KEYWORDS` already lists Phase 2/3 keywords (oneOf, anyOf, allOf, not, $ref, format) so they will not warn when those phases ship.
   - Returns the schema unchanged.

5. **`validateNode(schema, data, path)`:** signature locked. Plan 01 returns `[]`. Plan 02 will add dispatch into keyword handlers; Phase 2 will add composition + $ref.

## Deviations from Plan

None. `KNOWN_KEYWORDS` matched the plan exactly. The `expected`-undefined omission was preserved as plain object construction (no spread).

## Verification

All three task `<verify>` automated checks passed:
- package.json structure validated.
- error-utils: `expected` omitted, sort places `$.users[2]` before `$.users[10]`, appendKey/appendIndex produce correct strings.
- schema-loader: warns once per unknown keyword, throws on invalid pattern.
- validator-core: `validateNode` returns `[]`.

Three atomic commits made (one per task).
