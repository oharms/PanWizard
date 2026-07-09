# Phase 1: Foundation - Research

**Researched:** 2026-05-02
**Domain:** Zero-dependency JSON Schema Draft-07 primitive-keyword validator (TYPE/LOAD/API/TEST groups)
**Confidence:** HIGH (project-level research already covered the technical territory; this file emits only the Phase 1 deltas)

> **Note:** This research is intentionally thin — `.planning/research/architecture.md`, `.planning/research/stack.md`, and `.planning/research/pitfalls.md` already cover the standard stack, module layout, recursion strategy, and known pitfalls in detail. Re-deriving any of that here would duplicate ~80KB of context for the planner. Read those files first; this file lists only what is *specific* to the foundation phase: file paths to touch, the per-keyword test matrix, and the small handful of design hooks that the planner needs to bake into Plan 01.

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions

**From idea.md (locked constraints):**
- Zero runtime dependencies — pure Node.js builtins only (`fs`, `path`, `node:test`, `node:assert/strict`). Non-negotiable.
- Module format: Pure ESM. `"type": "module"` in package.json.
- Node minimum: Engines `>=18`.
- Public API shape: `validate(schema, data) => { valid: bool, errors: [{path, rule, message, value, expected}] }`.
- No short-circuit: validation aggregates all errors.
- Path format: JSONPath-style — `$` for root, `$.field` for object properties, `$.field[2]` for array indices. Forward slashes regardless of host OS.
- Determinism: errors sorted by path with numeric-aware comparator (`[2]` < `[10]`). Identical schema + data must produce byte-identical error arrays.
- Schema-load-time validation: invalid `pattern` regex rejected at load with clear error before any data is checked. Unknown keywords warned (not failed).
- Type strictness: no coercion. `"5"` does NOT pass `type: number`. NaN and Infinity rejected. `null` does not match `type: object`.

**From requirements.md → Phase 1 mapping (locked in scope):**
- API-01..05: public function signature, error aggregation, deterministic numeric-aware sort, root-path `$` and JSONPath syntax, cross-platform forward-slash output.
- TYPE-01: `type` keyword across string/number/integer/boolean/null/array/object — including integer-vs-number, NaN/Infinity rejection, `null` not matching object.
- TYPE-02: String keywords — `minLength`, `maxLength`, `pattern`, `enum`. (`pattern` regex compilation tested at schema load.)
- TYPE-03: Number keywords — `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` (with float-epsilon awareness for fractional `multipleOf`).
- TYPE-04: Array keywords — `items` (single schema OR tuple form), `minItems`, `maxItems`, `uniqueItems` (deep equality via canonical-key-sorted JSON.stringify).
- TYPE-05: Object keywords — `properties`, `required`, `additionalProperties` (true | false), `patternProperties` with the correct interaction: `additionalProperties` rejects only keys not matched by either `properties` or `patternProperties`.
- LOAD-01: invalid `pattern` regex throws a clear load-time error.
- LOAD-02: unknown keywords warned (`console.warn` once per unknown keyword), not failed. `additionalProperties` as a SCHEMA OBJECT is treated as the permissive `true` case in Phase 1 (deferred to Phase 2).
- TEST-01..02: ≥14 tests via `node --test`, zero runtime deps in production code.

### Claude's Discretion

- Internal function signatures for `validateNode`, error factory, path-segment helpers (planner decides exact shape).
- Test fixture structure and naming.
- Whether `validateNode` mutates an `errors` array or returns one (immutable vs accumulator — both meet the contract).
- Internal module boundary between `keyword-handlers.js` and `validator-core.js` (one file vs split).
- Test framework conventions (describe blocks vs flat tests).
- Comment density and inline doc style.
- Whether `additionalProperties` defaults treat `undefined` as `true` (permissive, per spec) or strict — go with spec default (permissive).
- `multipleOf` epsilon strategy for floating-point cases.
- `uniqueItems` canonical-stringify implementation (research suggests sorted-key JSON.stringify; planner can pick).

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- `additionalProperties` as a sub-schema (not just true/false) — Phase 2.
- All composition keywords (`oneOf`, `anyOf`, `allOf`, `not`) — Phase 2.
- Local `$ref` resolution + cycle detection — Phase 2.
- Format validators (email, uri, date, date-time, uuid) — Phase 3.
- CLI binary, `--format json`, exit codes — Phase 3.
- Dogfood (validate `.planning/config.json`) — Phase 3.
- Performance benchmark (1MB / 200ms) — Phase 3.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | `validate(schema, data)` returns `{valid, errors[]}` with `{path, rule, message, value, expected}` | architecture.md "Component Responsibilities" — `validate.js` is the public API |
| API-02 | Aggregates errors — no short-circuit | architecture.md "Error Aggregation Strategy → Primitive keywords"; pitfalls.md "Anti-Pattern 1" |
| API-03 | Sorted by path, numeric-aware (`[2]` < `[10]`); byte-identical for identical inputs | architecture.md "Error Determinism" — custom comparator over `.` and `[N]` segments |
| API-04 | Root path `$`; JSONPath syntax for nested | architecture.md "Path Segment Rules"; pitfalls.md Pitfall 11 |
| API-05 | Forward slashes on all platforms; deterministic output | Path strings are constructed from string concatenation only — never derived from `path.join`, so no `\` ever appears |
| TYPE-01 | `type` covers string/number/integer/boolean/null/array/object correctly | pitfalls.md Pitfall 1 — NaN/Infinity guards + `Number.isInteger` |
| TYPE-02 | String keywords `minLength`, `maxLength`, `pattern`, `enum` | pitfalls.md Pitfall 8 — pattern anchoring + no `m` flag |
| TYPE-03 | Number keywords `minimum`, `maximum`, `exclusive*`, `multipleOf` | architecture.md (handler grouping); spec — `multipleOf` for floats requires epsilon |
| TYPE-04 | Array keywords `items` (single or tuple), `minItems`, `maxItems`, `uniqueItems` | pitfalls.md Pitfall 7 — sorted-key canonical stringify for deep equality |
| TYPE-05 | Object keywords `properties`, `required`, `additionalProperties` (bool), `patternProperties` interaction | pitfalls.md Pitfall 4 — covered-key set is `properties` UNION `patternProperties` matches |
| LOAD-01 | Invalid `pattern` regex rejected at load | architecture.md "Schema Loader → validate patterns"; try/catch around `new RegExp(p)` at load |
| LOAD-02 | Unknown keywords warned, not failed | architecture.md "Schema Loader → warn unknown keywords"; use `console.warn` once per unknown keyword (Set-tracked dedup) |
| TEST-01 | ≥14 tests via `node --test` | stack.md "Test Runner" — `node:test` + `node:assert/strict` |
| TEST-02 | Zero runtime deps in production code | stack.md "Recommended Stack" — all builtins; package.json has no `dependencies` block |

</phase_requirements>

## Summary

Phase 1 builds the **foundation slice**: the public `validate()` API, the recursive `validateNode` walker, the immutable-path accumulator, the error factory + numeric-aware sort, and the schema-loader skeleton (regex pre-compile + unknown-keyword warning). After this phase, callers can validate any non-composition, non-`$ref` schema and get a sorted, deterministic, JSONPath-located error list.

**Primary recommendation:** Implement in **two parallel vertical slices** with a third sequential glue plan:
1. **Plan 01-01 (foundation primitives):** types, paths, error utils, schema loader skeleton — the core data model that everything else hangs off.
2. **Plan 01-02 (keyword handlers + integration):** all string/number/array/object keyword handlers + the `validate()` public entry — depends on 01-01's contracts.
3. **Plan 01-03 (test suite):** the ≥14 `node --test` test files covering the full success-criteria matrix — depends on 01-02 being callable.

This is genuinely sequential (each plan needs the previous plan's exports) so all three plans run as **single-task waves**: Wave 1 → Wave 2 → Wave 3. Trying to parallelize across keyword groups (string/number/array/object as separate plans) would require pre-defining the dispatch contract anyway, and creates artificial file-ownership conflicts in `keyword-handlers.js`.

## Standard Stack

(See `.planning/research/stack.md` for the full table — only Phase 1 specifics here.)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `node:test` | builtin (stable v20+, project floor v18) | Test runner | Zero-dep, covers describe/it/test, hooks |
| `node:assert/strict` | builtin | Assertions | Pair with node:test; strict equality |
| RegExp (native) | builtin | `pattern` keyword + load-time validation | `new RegExp(p)` in try/catch at load |
| `Number.isFinite` / `Number.isInteger` / `Number.isNaN` | builtin | Type guards | Block NaN/Infinity from `type:number` |

**No installation needed** — all builtins. `package.json` is created with empty `dependencies` and either no `devDependencies` or just `@biomejs/biome` (lint, optional in Phase 1 — not a TYPE/API requirement, defer to Phase 3 hardening).

## Architecture Patterns

(See `.planning/research/architecture.md` for the full system overview — only Phase 1 specifics here.)

### Module Layout for Phase 1

```
src/
├── validate.js            # Public API: validate(schema, data) — calls schema-loader then validator-core, sorts errors
├── schema-loader.js       # loadSchema(schema) — pre-walks for regex compile + unknown-keyword warn (NO $ref/cycle yet)
├── validator-core.js      # validateNode(schema, data, path) — dispatch into keyword handlers
├── keyword-handlers.js    # validateType, validateString, validateNumber, validateArray, validateObject
└── error-utils.js         # makeError(path, rule, message, value, expected) + sortErrors + path-segment helpers
test/
├── type.test.js           # TYPE-01: string, number, integer, boolean, null, array, object + NaN/Infinity
├── string.test.js         # TYPE-02: minLength, maxLength, pattern, enum
├── number.test.js         # TYPE-03: minimum, maximum, exclusive*, multipleOf
├── array.test.js          # TYPE-04: items (single + tuple), minItems, maxItems, uniqueItems
├── object.test.js         # TYPE-05: properties, required, additionalProperties (bool), patternProperties
├── paths.test.js          # API-04, API-05: $ root, JSONPath nested, forward slashes
├── aggregation.test.js    # API-02, API-03: no short-circuit, byte-identical sort, numeric-aware
└── loader.test.js         # LOAD-01, LOAD-02: invalid regex throws at load; unknown keyword warns once
package.json               # type: module, engines >=18, no dependencies, scripts.test = "node --test"
index.d.ts                 # Hand-written TypeScript declarations (small public surface)
```

**NOT in Phase 1 (deferred to Phase 2/3):** `composition-handlers.js`, `ref-resolver.js`, `formats.js`, `bin/whooschema.js`.

### Pattern: Recursive Descent with Accumulator

`validateNode(schema, data, path)` returns `Error[]`. Per architecture.md "Pattern 1". Path is an immutable string passed into each recursive call:

```js
// Object property:  validateNode(propSchema, data[key], path + '.' + key)
// Array item:       validateNode(itemSchema, data[i], path + '[' + i + ']')
// Root:             validateNode(schema, data, '$')
```

Phase 1 does NOT yet need to handle `$ref` or composition — `validateNode` only dispatches into the keyword handlers. The signature should already accept a `refMap` parameter (even if unused) so Phase 2 can extend without breaking the contract — but planner can choose to omit and add in Phase 2 (low cost either way; plan-02 will refactor).

**Recommendation:** OMIT refMap from the Phase 1 signature. Phase 2 adds it as an optional fourth argument. This keeps Phase 1 simpler and YAGNI-compliant. Phase 2's plan should explicitly call out the signature extension.

### Pattern: Schema Load is Separate from Validate

Per architecture.md "Pattern 2". `loadSchema(schema)` does the pre-walk; `validate(schema, data)` is the only public entry but internally calls `loadSchema` (and may cache on a WeakMap, planner discretion).

For Phase 1 the loader does only:
- Walk the schema tree depth-first.
- For every `pattern` keyword found: try `new RegExp(value)` — throw a clear error if it fails.
- For every keyword not in the known-keyword set: `console.warn` once (deduped via Set).

It does NOT yet build a refMap (that's Phase 2). The pre-walk is still useful in Phase 1 because it pre-emptively rejects bad regexes (LOAD-01).

### Pattern: Numeric-Aware Path Sort

Per architecture.md "Error Determinism". The comparator splits each path on `.` and `[N]` segments; for each segment, if it parses as a positive integer, compare numerically; otherwise lexicographically.

Reference implementation (~15 lines):
```js
function comparePaths(a, b) {
  const segs = (s) => s.split(/(\.|\[\d+\])/).filter(Boolean);
  const sa = segs(a), sb = segs(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (sa[i] === undefined) return -1;
    if (sb[i] === undefined) return 1;
    const ma = sa[i].match(/^\[(\d+)\]$/);
    const mb = sb[i].match(/^\[(\d+)\]$/);
    if (ma && mb) {
      const d = Number(ma[1]) - Number(mb[1]);
      if (d !== 0) return d;
    } else if (sa[i] !== sb[i]) {
      return sa[i] < sb[i] ? -1 : 1;
    }
  }
  return 0;
}
```

Sort once at the end of `validate()` over the full flat error array. Do NOT sort inside `validateNode`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Number type checking | Custom integer regex on stringified numbers | `Number.isInteger`, `Number.isFinite`, `!Number.isNaN` | JS builtins handle all edge cases; pitfalls.md Pitfall 1 |
| Pattern compilation | Walk the regex string yourself | `new RegExp(value)` in try/catch | Native engine catches all syntax errors uniformly |
| Test framework | Mocha/Jest devDep | `node:test` (stable v20, available v18) | TEST-02 says zero runtime deps — also keeps devDep tree empty |
| Argument parsing for tests | n/a | `node --test` discovers `test/**/*.test.js` automatically | No CLI to wire in Phase 1 |
| Deep clone for branch isolation | Custom `cloneDeep` | n/a — no composition in Phase 1 | Defer to Phase 2 |

## Common Pitfalls (Phase 1 specific — see pitfalls.md for full catalog)

The pitfalls that **must** be addressed in Phase 1 task design and verification:

| # | Pitfall (from pitfalls.md) | Phase 1 Mitigation |
|---|----------------------------|---------------------|
| 1 | NaN/Infinity passing `type: number` | Type guard: `typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v)`. Test: `validate({type:'number'}, NaN)` fails. |
| 2 | Mutable path corruption | Use immutable string concat in every recursive call. NEVER push/pop a shared array. Test: nested `{a:{b:'x'}}` produces full path `$.a.b`. |
| 4 | `additionalProperties` ignoring `patternProperties` | Compute covered set as `properties` keys UNION `patternProperties`-matching keys. Test: `{properties:{a:{}},patternProperties:{"^x":{}},additionalProperties:false}` with `{a:1,xFoo:2,b:3}` rejects only `b`. |
| 7 | `uniqueItems` reference equality / key-order false positive | Use canonical stringify with sorted keys (recursive sort-then-stringify, ~15 lines). Test: `[{a:1,b:2},{b:2,a:1}]` fails uniqueItems. |
| 8 | `pattern` anchoring / `m` flag | `new RegExp(p)` only — no flags. Test: `pattern:"[0-9]+"` matches `"abc123def"` (substring); `pattern:"^[0-9]+$"` does NOT match `"123\nmore"`. |
| 11 | Path format `$.0.key` instead of `$[0].key` | Two helpers: `appendKey(path, key) → path + '.' + key`; `appendIndex(path, i) → path + '[' + i + ']'`. Test: `[{a:1}]` against `items.properties.a.type:string` produces `$[0].a`. |

Pitfalls 3, 5, 6, 9, 10 (oneOf, $ref cycles, $ref unescaping, formats, branch contamination) are Phase 2/3 concerns — explicitly NOT mitigated in Phase 1.

## Code Examples

### Type Handler (covers TYPE-01 + Pitfall 1)

```js
// src/keyword-handlers.js
function validateType(schema, data, path, errors) {
  if (schema.type === undefined) return;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.some(t => matchesType(t, data))) return;
  errors.push(makeError(path, 'type', `expected ${types.join(' or ')}`, data, schema.type));
}

function matchesType(t, v) {
  switch (t) {
    case 'string':  return typeof v === 'string';
    case 'number':  return typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v) && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null':    return v === null;
    case 'array':   return Array.isArray(v);
    case 'object':  return typeof v === 'object' && v !== null && !Array.isArray(v);
    default:        return false; // unknown type — load-time warn already emitted
  }
}
```

### Object Handler with `additionalProperties`+`patternProperties` (covers TYPE-05 + Pitfall 4)

```js
function validateObject(schema, data, path, errors) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return;

  // required
  if (Array.isArray(schema.required)) {
    for (const k of schema.required) {
      if (!(k in data)) {
        errors.push(makeError(path, 'required', `missing required property "${k}"`, undefined, k));
      }
    }
  }

  // properties
  if (schema.properties) {
    for (const [k, subSchema] of Object.entries(schema.properties)) {
      if (k in data) {
        validateNode(subSchema, data[k], path + '.' + k, errors);
      }
    }
  }

  // patternProperties
  const compiledPatterns = []; // Could be cached on the loaded schema
  if (schema.patternProperties) {
    for (const [pattern, subSchema] of Object.entries(schema.patternProperties)) {
      const re = new RegExp(pattern); // safe — already validated at load
      compiledPatterns.push({ re, subSchema });
      for (const k of Object.keys(data)) {
        if (re.test(k)) {
          validateNode(subSchema, data[k], path + '.' + k, errors);
        }
      }
    }
  }

  // additionalProperties (only true/false form in Phase 1)
  if (schema.additionalProperties === false) {
    const propKeys = new Set(Object.keys(schema.properties || {}));
    for (const k of Object.keys(data)) {
      if (propKeys.has(k)) continue;
      if (compiledPatterns.some(({ re }) => re.test(k))) continue;
      errors.push(makeError(path, 'additionalProperties', `additional property "${k}" not allowed`, data[k], false));
    }
  }
  // schema.additionalProperties === true OR a sub-schema → permissive (Phase 2 implements sub-schema form)
}
```

### Schema Loader Skeleton (covers LOAD-01, LOAD-02)

```js
// src/schema-loader.js
const KNOWN_KEYWORDS = new Set([
  'type','enum','const','minLength','maxLength','pattern',
  'minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf',
  'items','minItems','maxItems','uniqueItems',
  'properties','required','additionalProperties','patternProperties',
  '$schema','title','description','default','examples','definitions','$defs',
  // Phase 2 keywords are listed here so they don't warn — but they're no-ops in Phase 1's validateNode
  'oneOf','anyOf','allOf','not','$ref',
  // Phase 3 keyword
  'format'
]);
const warned = new Set();

export function loadSchema(schema) {
  walk(schema);
  return schema; // No transformation in Phase 1; future phases add refMap, etc.
}

function walk(node) {
  if (node === null || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'pattern' && typeof v === 'string') {
      try { new RegExp(v); }
      catch (e) { throw new Error(`Invalid pattern regex "${v}" at schema-load time: ${e.message}`); }
    }
    if (!KNOWN_KEYWORDS.has(k) && !warned.has(k)) {
      console.warn(`whooschema: unknown keyword "${k}" — ignoring`);
      warned.add(k);
    }
    if (typeof v === 'object') walk(v);
  }
}
```

> The `KNOWN_KEYWORDS` list intentionally includes Phase 2/3 keywords. This avoids spurious warnings when the user has a fully-elaborated schema; the keywords are simply no-ops in Phase 1's `validateNode` (which doesn't dispatch them yet). This matches the spec's "unknown keywords are annotations" interpretation. The set IS deliberately wider than what Phase 1 implements.

## State of the Art

(See `.planning/research/stack.md` and `.planning/research/architecture.md` — no Phase 1 specific deltas.)

## Open Questions

1. **Should `validate(schema, data)` cache the loaded schema?**
   - Decision deferred to planner. Caching with WeakMap keyed on the schema object is a simple optimization (avoids re-walking on repeat calls), but YAGNI for Phase 1's "validate once" use cases. Recommendation: NO caching in Phase 1 — `validate` calls `loadSchema` each time. Phase 2/3 can optimize once the surface is more complete.

2. **Should `loadSchema` be exported as part of the public API in Phase 1?**
   - Decision deferred to planner. The architecture has it as a separate exposed function, but Phase 1's locked decisions only require `validate(schema, data)`. Recommendation: keep `loadSchema` internal (do not export from `index.js`) until a real use case for "compile then validate many times" emerges. Phase 1 ships only `validate`.

## Validation Architecture

> `workflow.nyquist_validation` is NOT set in `.planning/config.json` — defaults to false. **Section omitted per pan-phase-researcher template rule.**

If you turn nyquist on later, the test framework is `node --test` (no config file), quick run is `node --test test/<single>.test.js`, full suite is `node --test`, all tests are unit-tier (T1) — no infrastructure.

## Sources

### Primary (HIGH confidence)
- `.planning/research/architecture.md` — system overview, recursion strategy, error determinism
- `.planning/research/stack.md` — node:test version history, package.json layout
- `.planning/research/pitfalls.md` — all 14 pitfalls catalogued; Phase 1 needs #1, #2, #4, #7, #8, #11
- `.planning/idea.md` (via context.md) — locked constraints
- `.planning/requirements.md` — Phase 1 requirement IDs (API-01..05, TYPE-01..05, LOAD-01..02, TEST-01..02)
- JSON Schema Draft-07 spec — keyword semantics

### Secondary (MEDIUM confidence)
- ajv source — composition error-surfacing patterns (deferred to Phase 2; mentioned for context)
- `is-my-json-valid` — interpretive validator pattern (referenced in architecture.md)

### Tertiary (LOW confidence)
- None — Phase 1 surface is fully covered by HIGH-confidence sources.

## Infrastructure Dependencies

**None.** Phase 1 is a pure-computation library. All tests are T1 unit tests run by `node --test` in-process. No Docker, no DB, no network.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — fully derived from stack.md (already verified)
- Architecture: HIGH — fully derived from architecture.md (already verified)
- Pitfalls: HIGH — directly mapped from pitfalls.md (already verified)
- Phase scope: HIGH — Phase 1 boundary cleanly drawn in idea.md / context.md / roadmap.md, no ambiguity

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (30 days — domain is stable; no fast-moving deps)

---

*Phase research for: 01-foundation*
*Researched: 2026-05-02 — delta on top of project-level research*
