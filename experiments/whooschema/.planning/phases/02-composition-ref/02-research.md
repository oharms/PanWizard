# Phase 2: Composition + $ref — Research

**Researched:** 2026-05-02
**Domain:** JSON Schema Draft-07 composition keywords (oneOf/anyOf/allOf/not) + local $ref resolution + cycle detection
**Confidence:** HIGH (domain fully covered by project-level research files; this document is Phase 2 deltas only)

> **Note:** `.planning/research/architecture.md`, `.planning/research/pitfalls.md`, and `.planning/research/stack.md` already cover the full technical domain. This file emits ONLY what is specific to Phase 2: which existing files to modify, exact algorithms to implement, integration points with Phase 1 code, and the per-requirement test matrix.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | `oneOf` — exactly one branch must match; 0-match and ≥2-match cases both fail with branch diagnostics | architecture.md "oneOf" pseudocode; pitfalls.md Pitfall 3 (two-match case) + Pitfall 10 (branch contamination) |
| COMP-02 | `anyOf` — at least one branch must match; on 0-match, surface closest branch (fewest errors) | architecture.md "anyOf" pseudocode; pitfalls.md Pitfall 10 |
| COMP-03 | `allOf` — every branch must match; errors aggregated across branches | architecture.md "allOf" pseudocode; pitfalls.md Pitfall 10 (deduplication) |
| COMP-04 | `not` — schema must NOT match; produce single inverse error | architecture.md "not" pseudocode |
| REF-01 | `$ref` local pointer resolves at validate time via pre-built refMap; path stays at call-site path | architecture.md "$ref Resolution" section; pitfalls.md Pitfall 6 (JSON Pointer escaping) |
| REF-02 | $ref cycle detection at schema-load time; clear error before data is checked | architecture.md "Cycle detection at schema load time"; pitfalls.md Pitfall 5 |
| LOAD-03 | $ref pre-walk builds resolution map; cycle detection rejects at load | architecture.md "buildRefMap + detectCycles" in schema-loader flow |

</phase_requirements>

---

## Summary

Phase 2 adds three capabilities on top of the Phase 1 foundation: composition keyword handlers (oneOf/anyOf/allOf/not), local `$ref` resolution via a pre-built pointer map, and load-time cycle detection. All work by extending the existing recursive descent; no new data structures or external tools are needed.

The Phase 1 codebase already reserved space for Phase 2: `schema-loader.js` has `SUBSCHEMA_ARRAY_KEYWORDS` covering allOf/anyOf/oneOf and `SUBSCHEMA_KEYWORDS` covering `not`; `validator-core.js` has a comment "Phase 2 will add composition handlers here"; `KNOWN_KEYWORDS` already includes all seven new keywords so they produce no warnings.

**Primary recommendation:** Phase 2 fits in two sequential plans. Plan 02-01 wires composition + $ref into the validator (all seven requirements). Plan 02-02 writes the full test suite for Phase 2 requirements. Each plan is independently testable.

---

## What Phase 1 Already Provides

### Files available to extend (all in `src/`)

| File | Phase 1 role | Phase 2 hook |
|------|-------------|-------------|
| `src/validate.js` (lines 1–21) | Calls `loadSchema(schema)` then `validateNode(schema, data, '$')` | Must pass `refMap` from `loadSchema` into `validateNode`. Currently discards the return value of `loadSchema`; Phase 2 changes `loadSchema` to return `{ schema, refMap }` and threads `refMap` through |
| `src/schema-loader.js` (lines 46–103) | Pre-walks for regex + unknown-keyword warn | Add `buildRefMap()` call and `detectCycles()` DFS after the existing walk; return `refMap` to `validate.js` |
| `src/validator-core.js` (lines 21–34) | Dispatches primitive keyword handlers | Add `$ref` branch and composition handler calls; accept `refMap` as 4th parameter |
| `src/keyword-handlers.js` | Primitive keyword handlers | No changes required for Phase 2 |
| `src/error-utils.js` | `makeError`, `sortErrors`, `appendKey`, `appendIndex` | No changes required |

### Exact Phase 1 call sites that need modification

1. **`src/validate.js` line 13–19** — `loadSchema(schema)` return value is discarded; `validateNode` is called with 3 args. Phase 2 must:
   - Destructure `const { refMap } = loadSchema(schema)`
   - Pass `refMap` as 4th arg: `validateNode(schema, data, '$', refMap)`

2. **`src/validator-core.js` line 21** — function signature is `validateNode(schema, data, path)`. Phase 2 must add `refMap = {}` as 4th parameter (default empty so existing tests pass without modification).

3. **`src/validator-core.js` lines 25–33** — dispatch block. Phase 2 adds the composition + $ref calls here.

4. **`src/schema-loader.js` line 46** — `loadSchema(schema)` returns `schema`. Phase 2 changes the return to `{ schema, refMap }` and adds ref-map building + cycle detection.

5. **`src/keyword-handlers.js` lines 213, 257** — two `validateNode` call sites inside `validateArray` and `validateObject` that pass 3 args. Phase 2 must update both to thread `refMap` through. The handlers must accept `refMap` as a 4th parameter and forward it.

---

## Composition Keyword Design

### How each keyword works

**`allOf` (COMP-03) — simplest case**

Run every branch. Aggregate all errors. If any branch fails, its errors are included in the parent error list.

```js
// src/validator-core.js — inside validateNode
if (Array.isArray(schema.allOf)) {
  for (const sub of schema.allOf) {
    const branchErrors = validateNode(sub, data, path, refMap);
    for (const e of branchErrors) errors.push(e);
  }
}
```

Deduplication: pitfalls.md Pitfall 10 recommends deduplicating by `path|rule` when two branches produce the same error. Given the project's simple schemas, this is a nice-to-have, not a must-have for v1 — but the planner should decide. The success criterion (SC-3: "minimum: 5 AND maximum: 3") involves different rules, so no dedup fires in the SC test cases. **Recommendation: skip dedup in v1; add it if a test case requires it.**

**`anyOf` (COMP-02) — fewest-errors heuristic**

```js
if (Array.isArray(schema.anyOf)) {
  const results = schema.anyOf.map(sub => validateNode(sub, data, path, refMap));
  const anyPassed = results.some(r => r.length === 0);
  if (!anyPassed) {
    const best = results.reduce((a, b) => a.length <= b.length ? a : b);
    errors.push(makeError(path, 'anyOf', 'value must match at least one schema', data));
    for (const e of best) errors.push(e);
  }
}
```

Key design: the wrapper `anyOf` error is pushed first; the best-branch sub-errors follow. This lets callers filter by `rule === 'anyOf'` to find composition failures, and the subsequent errors are the diagnostics.

**`oneOf` (COMP-01) — count passes; two distinct failure modes**

```js
if (Array.isArray(schema.oneOf)) {
  const results = schema.oneOf.map(sub => validateNode(sub, data, path, refMap));
  const passing = results.filter(r => r.length === 0);
  if (passing.length === 0) {
    // Zero branches matched — surface best-match branch errors
    const best = results.reduce((a, b) => a.length <= b.length ? a : b);
    errors.push(makeError(path, 'oneOf', 'value must match exactly one schema (matched 0)', data));
    for (const e of best) errors.push(e);
  } else if (passing.length > 1) {
    // Multiple branches matched — no sub-errors to surface (all passed)
    errors.push(
      makeError(path, 'oneOf', `value must match exactly one schema (matched ${passing.length})`, data)
    );
  }
  // passing.length === 1 → no error
}
```

The SC-1 test case `validate({oneOf:[{type:'string'},{minLength:1}]}, 'hello')` hits the `passing.length > 1` branch: both schemas pass for `'hello'`. The error message must contain "matched 2".

**`not` (COMP-04) — invert result**

```js
if (schema.not !== undefined) {
  const subErrors = validateNode(schema.not, data, path, refMap);
  if (subErrors.length === 0) {
    // Sub-schema passed → not fails
    errors.push(makeError(path, 'not', 'value must not match schema', data));
  }
  // Sub-schema failed → not succeeds; sub-errors are discarded
}
```

No sub-errors are surfaced; only one error is emitted when `not` fails.

### Where to place composition handlers

Two options per architecture.md "Circular Dependency Prevention":

**Option 1 (recommended):** Inline composition dispatch directly inside `validateNode` in `src/validator-core.js`. At Phase 2 completion, `validator-core.js` will be ~80–100 lines — well under the 200-line threshold where splitting pays off. This avoids the circular-import risk entirely.

**Option 2:** New `src/composition-handlers.js`. Functions receive `validateNode` as a parameter (dependency injection). Preferred only if the file grows large.

**Recommendation: Option 1 (inline in validator-core.js)** per architecture.md guidance. The planner can split into `composition-handlers.js` if desired, but it adds no value at this scale.

### Call order inside `validateNode`

The existing Phase 1 dispatch order (type → enum → string → number → array → object) should be preserved. Composition keywords run after primitive checks. `$ref` is special: when present, it short-circuits the rest of schema processing (a `$ref` schema is resolved and only the target schema applies).

```js
export function validateNode(schema, data, path, refMap = {}) {
  const errors = [];
  if (schema === null || typeof schema !== 'object') return errors;

  // $ref short-circuits — per JSON Schema Draft-07 spec
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, refMap);
    return validateNode(target, data, path, refMap);
  }

  // Primitive keyword handlers (Phase 1 — unchanged)
  validateType(schema, data, path, errors);
  validateEnum(schema, data, path, errors);
  validateString(schema, data, path, errors);
  validateNumber(schema, data, path, errors);
  validateArray(schema, data, path, errors);  // must receive refMap — see below
  validateObject(schema, data, path, errors); // must receive refMap — see below

  // Composition keywords (Phase 2)
  // allOf
  if (Array.isArray(schema.allOf)) { /* ... */ }
  // anyOf
  if (Array.isArray(schema.anyOf)) { /* ... */ }
  // oneOf
  if (Array.isArray(schema.oneOf)) { /* ... */ }
  // not
  if (schema.not !== undefined) { /* ... */ }

  return errors;
}
```

Note: `validateArray` and `validateObject` in `keyword-handlers.js` call `validateNode` recursively (for items and properties). They currently pass 3 args. Phase 2 must add `refMap` as a 4th arg to both handler functions and update those internal `validateNode(...)` calls accordingly.

---

## $ref Resolution Design

### refMap structure

Built at `loadSchema()` time. Keys are `$ref` string values exactly as they appear in the schema (`"#/definitions/foo"`, `"#/$defs/bar"`). Values are the resolved schema nodes (not deep copies — same object references as in the original schema tree).

```js
function buildRefMap(rootSchema) {
  const refMap = {};
  const defs = rootSchema.definitions || rootSchema.$defs || {};
  for (const [key, subSchema] of Object.entries(defs)) {
    refMap['#/definitions/' + key] = subSchema;
    refMap['#/$defs/' + key] = subSchema;
  }
  return refMap;
}
```

For Phase 2 scope (local refs only, `#/definitions/...` convention), this is sufficient. The project explicitly scopes out full JSON Pointer support.

For correctness on keys containing `/` or `~` (pitfalls.md Pitfall 6, JSON Pointer escaping), the refMap keys are the literal `$ref` values from the schema, and resolution uses the same string directly. This works for the normal case. A full JSON Pointer resolver (handling `~1` → `/` and `~0` → `~`) is a delta if needed but not required for the dogfood schemas.

**Recommendation:** Add JSON Pointer unescaping in the `resolveRef` function so `$ref: "#/definitions/a~1b"` maps to key `a/b`. It is 3 lines and prevents a confusing failure mode:

```js
function resolveRef(ref, refMap) {
  if (refMap[ref] !== undefined) return refMap[ref];
  // Attempt JSON Pointer fragment resolution for refs not directly in map
  if (ref.startsWith('#/')) {
    const tokens = ref.slice(2).split('/').map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
    // Walk the root schema by token... (see full implementation below)
  }
  throw new Error('$ref not found: ' + ref);
}
```

Since `buildRefMap` only indexes `definitions` and `$defs`, a ref like `#/properties/foo` would not be in the map. For the Phase 2 scope (dogfood uses `#/definitions/...` only), the direct-lookup approach is fine. The throw on miss is the right error.

### Path transparency (REF-01)

When `$ref` resolves, `validateNode` recurses into the target schema using the **same `path`** as the call site. The `$ref` is transparent — it does not add a path segment. This is the correct JSON Schema behaviour and is already encoded in the architecture pseudocode.

```js
// In validateNode:
if (typeof schema.$ref === 'string') {
  const target = resolveRef(schema.$ref, refMap);
  return validateNode(target, data, path, refMap); // same path, not path + '.$ref'
}
```

### `resolveRef` function

Can be a private function inside `validator-core.js` or a small exported helper. Given the project's "inline where small" preference, put it in `validator-core.js` or a new `src/ref-resolver.js`. Either works; the planner decides.

---

## Cycle Detection Design

### Algorithm (REF-02 + LOAD-03)

DFS with a `visiting` Set of `$ref` strings. Walk the schema tree depth-first. When a `$ref` is encountered:

1. Check if `schema.$ref` is already in `visiting` — if yes, throw.
2. Resolve the target from `refMap` — if not found, throw (dangling ref).
3. Add `schema.$ref` to `visiting`.
4. Recurse into the target schema.
5. Remove `schema.$ref` from `visiting` (backtrack).

```js
function detectCycles(node, refMap, visiting = new Set()) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) detectCycles(item, refMap, visiting);
    return;
  }
  if (typeof node.$ref === 'string') {
    if (visiting.has(node.$ref)) {
      throw new Error('$ref cycle detected: ' + [...visiting].join(' -> ') + ' -> ' + node.$ref);
    }
    const target = refMap[node.$ref];
    if (!target) throw new Error('$ref target not found: ' + node.$ref);
    visiting.add(node.$ref);
    detectCycles(target, refMap, visiting);
    visiting.delete(node.$ref);
    return; // target walked; don't also walk node's other keys (it has only $ref)
  }
  // Walk sub-schema slots (same classification as Phase 1 SUBSCHEMA_MAP_KEYWORDS etc.)
  for (const [key, value] of Object.entries(node)) {
    if (['properties', 'patternProperties', 'definitions', '$defs'].includes(key)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const sub of Object.values(value)) detectCycles(sub, refMap, visiting);
      }
    } else if (['items', 'additionalProperties', 'not'].includes(key)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const sub of value) detectCycles(sub, refMap, visiting);
        } else {
          detectCycles(value, refMap, visiting);
        }
      }
    } else if (['allOf', 'anyOf', 'oneOf'].includes(key)) {
      if (Array.isArray(value)) {
        for (const sub of value) detectCycles(sub, refMap, visiting);
      }
    }
  }
}
```

**Error message shape:** Include the chain for debuggability: `"$ref cycle detected: #/definitions/A -> #/definitions/B -> #/definitions/A"`. The SC-5 test just checks that a clear load-time error is thrown — any message containing "cycle" satisfies it.

**Legitimate recursive schemas:** A self-referential schema with a base case (e.g., `oneOf: [{type:'null'}, {properties:{child:{$ref:'#'}}}]`) is NOT a cycle in the DFS sense because `#` resolves to the root schema and the DFS backtracks after walking it. The `visiting` set approach correctly handles this: when DFS enters `#` for the first time it adds `#` to `visiting`, walks the root's `oneOf` branches, enters `#` again on the second branch — at this point `#` is already in `visiting`, so it would throw.

**Wait — that's a problem.** The self-referential tree schema IS flagged as a cycle by the simple algorithm above. This is actually the correct v1 behaviour per the project scope: the requirements only ask that cycle detection rejects circular chains. The project does NOT support self-referential schemas with base cases in v1 (that would require runtime recursion depth limiting, which is explicitly out of scope per requirements.md "definitions recursion limit configuration — out of scope").

For the dogfood target schemas (flat config validation schemas), there are no self-referential refs. So this limitation is acceptable and should be documented.

**Conclusion:** The DFS cycle detector as written is correct for v1. Schemas with any `$ref` that transitively leads back to itself (even with a base case) will be rejected at load time. This is intentional and matches the constraint from project.md "Out of Scope: definitions recursion limit configuration."

### Integration into `loadSchema`

```js
export function loadSchema(schema) {
  walk(schema);                           // existing: regex validation + unknown keyword warn
  const refMap = buildRefMap(schema);     // NEW Phase 2
  detectCycles(schema, refMap);           // NEW Phase 2
  return { schema, refMap };              // CHANGED: was just `return schema`
}
```

**Breaking change:** `loadSchema` currently returns `schema`. Phase 2 changes it to return `{ schema, refMap }`. The only internal caller is `validate.js` line 13 (`loadSchema(schema)` — return value currently discarded). No external callers in Phase 1 (loadSchema was not exported in the public API). Safe to change.

---

## Integration Points: File-by-File

### `src/validate.js`

**Current (Phase 1):**
```js
export function validate(schema, data) {
  loadSchema(schema);                          // line 17
  const raw = validateNode(schema, data, '$'); // line 18
  ...
}
```

**Phase 2 change:**
```js
export function validate(schema, data) {
  const { refMap } = loadSchema(schema);            // destructure refMap
  const raw = validateNode(schema, data, '$', refMap); // thread refMap through
  ...
}
```

### `src/schema-loader.js`

- Add `buildRefMap(schema)` function (after existing `walk`)
- Add `detectCycles(schema, refMap)` function
- Change `loadSchema` to call both and return `{ schema, refMap }`
- The existing `SUBSCHEMA_MAP_KEYWORDS`, `SUBSCHEMA_KEYWORDS`, `SUBSCHEMA_ARRAY_KEYWORDS` sets can be reused in `detectCycles` (avoids duplication)

### `src/validator-core.js`

- Add `refMap = {}` to signature: `export function validateNode(schema, data, path, refMap = {})`
- Add `$ref` short-circuit branch at top of function body
- Add composition keyword dispatch after the Phase 1 primitive dispatch block
- Import `makeError` from `error-utils.js` (currently not imported — composition handlers need it)

### `src/keyword-handlers.js`

Two functions make recursive `validateNode` calls:
- `validateArray` (line 213): `validateNode(schema.items[i], data[i], appendIndex(path, i))` — must become `validateNode(schema.items[i], data[i], appendIndex(path, i), refMap)`
- `validateObject` (line 257): `validateNode(subSchema, data[k], appendKey(path, k))` — must become `validateNode(subSchema, data[k], appendKey(path, k), refMap)`

Both functions must accept `refMap` as a 4th parameter.

**Exact lines needing `refMap` threading in keyword-handlers.js:**
- `validateArray` signature: line 166 → add `refMap = {}`
- `validateArray` line 213: `validateNode(schema.items[i], data[i], appendIndex(path, i), refMap)`
- `validateArray` line 219: `validateNode(schema.items, data[i], appendIndex(path, i), refMap)` (single-schema branch)
- `validateObject` signature: line 241 → add `refMap = {}`
- `validateObject` line 257: `validateNode(subSchema, data[k], appendKey(path, k), refMap)` (properties loop)
- `validateObject` line 271: `validateNode(subSchema, data[k], appendKey(path, k), refMap)` (patternProperties loop)

---

## Testing Approach

### New test files for Phase 2

Two new files following the existing `test/*.test.js` naming convention:

**`test/composition.test.js`** — covers COMP-01..04

| Test | Requirement | What it checks |
|------|-------------|----------------|
| `oneOf: 0 branches match` | COMP-01 | Returns invalid; `rule: 'oneOf'`; message contains "matched 0"; best-branch sub-errors present |
| `oneOf: exactly 1 branch matches` | COMP-01 | Returns valid |
| `oneOf: 2 branches match ('hello' vs string+minLength)` | COMP-01 (SC-1) | Returns invalid; single `oneOf` error; message contains "matched 2"; NO sub-errors (branches passed) |
| `anyOf: at least 1 branch matches` | COMP-02 | Returns valid |
| `anyOf: 0 branches match — best branch surfaced` | COMP-02 (SC-2) | Returns invalid; `rule: 'anyOf'` wrapper error; followed by fewest-errors branch errors only |
| `anyOf: all branches match` | COMP-02 | Returns valid |
| `allOf: all branches match` | COMP-03 | Returns valid |
| `allOf: one branch fails` | COMP-03 | Returns invalid; failing branch errors present |
| `allOf: conflicting constraints (min 5 and max 3)` | COMP-03 (SC-3) | Both minimum and maximum errors in result |
| `not: inner schema fails → not succeeds` | COMP-04 | Returns valid |
| `not: inner schema passes → not fails` | COMP-04 | Returns invalid; single `not` error; no sub-errors |
| `not: produces correct path at root` | COMP-04 | path is `$` |
| `composition + path: allOf nested in object property` | COMP-03 | errors have correct nested path e.g. `$.config.value` |

**`test/ref.test.js`** — covers REF-01, REF-02, LOAD-03

| Test | Requirement | What it checks |
|------|-------------|----------------|
| `$ref to #/definitions/email resolves` | REF-01, LOAD-03 | Valid data against the ref passes; invalid data returns error with original data path (not `definitions.email`) |
| `$ref path is transparent (no ref segment in path)` | REF-01 | Error path does not contain `$ref` or `definitions` tokens |
| `$ref in nested position (properties value)` | REF-01 | e.g. `{properties: {email: {$ref: '#/definitions/emailType'}}}` — error path is `$.email` |
| `$ref chain (A refs B, B validates)` | REF-01 | Two-hop ref chain resolves correctly |
| `$ref: schema with pure cycle throws at load` | REF-02, LOAD-03 | `validate({$ref: '#'}, {})` throws before data checked; error message mentions "cycle" |
| `$ref: A→B→A cycle throws at load` | REF-02 | Load-time throw; message includes both refs |
| `$ref: dangling ref (target not in definitions) throws` | LOAD-03 | Throws with message mentioning the missing ref target |
| `$ref with $defs (Draft-2019+ alias)` | REF-01 | `$defs` supported as well as `definitions` |

### Unchanged test files that Phase 2 must not break

All 40 Phase 1 tests (`type.test.js`, `string.test.js`, `number.test.js`, `array.test.js`, `object.test.js`, `paths.test.js`, `aggregation.test.js`, `loader.test.js`) must continue to pass. The `refMap = {}` default parameter in `validateNode` ensures backward compat. The `loadSchema` return-value change is internal to `validate.js` and invisible to callers of `validate()`.

### Test runner

`node --test` (no config file needed, discovers `test/**/*.test.js` automatically).

Quick check per-file: `node --test test/composition.test.js`  
Full suite: `node --test`

---

## Risks and Unknowns

### Risk 1: `loadSchema` return value change is a silent breaking change for any code calling `loadSchema` directly

**Assessment:** LOW risk. `loadSchema` is not exported from `src/validate.js` (the public entry point). The only export is `validate`. Internal to the library, only `validate.js` calls `loadSchema`. The change from `return schema` to `return { schema, refMap }` only affects `validate.js` line 17, which currently discards the return value anyway.

**Action:** Planner should double-check that `loadSchema` is not exported from `src/validate.js`. It currently is not (validate.js only exports `validate`). Confirm this holds.

### Risk 2: `keyword-handlers.js` receives `refMap` but current callers in test code call `validateNode` directly with 3 args

**Assessment:** NONE. Test files call `validate()` (the public API), not `validateNode` directly. The `refMap = {}` default parameter handles any edge case.

### Risk 3: Legitimate self-referential schemas are rejected by cycle detection

**Assessment:** KNOWN and intentional. Per project scope, self-referential schemas with base cases are not supported in v1 (no runtime recursion depth limit). The cycle detector treats ALL transitively-self-referential schemas as cycles. This is documented in requirements.md and project.md as "out of scope."

**Action:** Add a comment in `detectCycles` noting this limitation. Add a test verifying that the pure-cycle case `{$ref: '#'}` throws (SC-5) but do NOT add tests for recursive schemas with base cases (those would fail).

### Risk 4: `anyOf` "fewest errors" tie-breaking is non-deterministic

**Assessment:** LOW. When two branches have the same error count, `reduce` picks the first one (left-to-right). This is deterministic given the same schema definition order. Document in code.

### Risk 5: allOf error deduplication — are duplicate errors possible in the SC-3 test case?

**Assessment:** NO risk to the SC test. The SC-3 test uses `minimum: 5` in one branch and `maximum: 3` in another. These produce different rule names so they cannot be duplicates. No deduplication logic needed for v1.

### Risk 6: `$ref` in Draft-07 can coexist with sibling keywords; `$ref` replaces the whole schema in Draft-07

**Assessment:** IMPORTANT design decision. In JSON Schema Draft-07, a `$ref` is supposed to replace the entire schema — sibling keywords (like `description`) are ignored when `$ref` is present. The current implementation design short-circuits on `$ref` and returns early, which is correct for Draft-07 semantics. Draft-2019-09 and later removed this restriction, but whooschema targets Draft-07.

**Action:** The `$ref` short-circuit in `validateNode` is correct. No other keywords in a `$ref` schema are processed. Add a test that a schema like `{$ref: '#/definitions/foo', minimum: 5}` only validates against `definitions.foo` and ignores `minimum`.

---

## Architecture Summary for Planner

### New module to create

None required. Everything fits in the existing files. The planner may optionally create `src/ref-resolver.js` for `resolveRef()`, but it is equally valid inline in `validator-core.js`.

### Suggested plan split

**Plan 02-01: Composition + $ref implementation (Wave 1)**
- Extend `src/schema-loader.js`: add `buildRefMap`, `detectCycles`, update `loadSchema` return
- Extend `src/validate.js`: thread `refMap` from `loadSchema` into `validateNode`
- Extend `src/validator-core.js`: add `refMap` param, `$ref` short-circuit, inline composition handlers
- Extend `src/keyword-handlers.js`: add `refMap` param to `validateArray` and `validateObject`; thread through all 4 internal `validateNode` calls

**Plan 02-02: Test suite for Phase 2 (Wave 2, depends on 02-01)**
- Create `test/composition.test.js` covering COMP-01..04 (13 test cases)
- Create `test/ref.test.js` covering REF-01, REF-02, LOAD-03 (8 test cases)
- Run full `node --test` to confirm all 40 Phase 1 tests still pass plus the new tests

### Implementation sequence within Plan 02-01

1. `schema-loader.js` first — adds `buildRefMap` and `detectCycles`; changes `loadSchema` return
2. `validate.js` second — destructures `refMap` from `loadSchema`; passes to `validateNode`
3. `validator-core.js` third — adds `refMap` param, `$ref` branch, composition dispatch
4. `keyword-handlers.js` fourth — threads `refMap` through `validateArray` and `validateObject`

This order means each step can be independently confirmed: after step 1, `buildRefMap` can be tested in isolation; after step 3, `validate()` handles `$ref` and composition even without step 4 (because `validateArray`/`validateObject` call `validateNode` with a default `refMap = {}`).

---

## Sources

### Primary (HIGH confidence)
- `.planning/research/architecture.md` — composition pseudocode (oneOf/anyOf/allOf/not sections), $ref resolution, cycle detection DFS algorithm, module layout, circular dependency discussion
- `.planning/research/pitfalls.md` — Pitfall 3 (oneOf two-match), Pitfall 5 (cycle detection), Pitfall 6 (JSON Pointer escaping), Pitfall 10 (branch error contamination)
- `src/validate.js`, `src/validator-core.js`, `src/schema-loader.js`, `src/keyword-handlers.js` — Phase 1 implementation (verified line references above)
- `.planning/requirements.md` — COMP-01..04, REF-01..02, LOAD-03 definitions
- `.planning/roadmap.md` — Phase 2 success criteria SC-1..5
- JSON Schema Draft-07 spec — `$ref` replaces whole schema in Draft-07; composition keyword semantics (HIGH confidence, stable spec)

### Secondary (MEDIUM confidence)
- `ajv` source composition strategy (anyOf heuristic, best-branch selection) — referenced in architecture.md
- JSON Pointer RFC 6901 — `~0`/`~1` escaping rules (referenced in pitfalls.md Pitfall 6)

### Tertiary (LOW confidence)
- None — Phase 2 domain is fully covered by the HIGH-confidence project-level research files.

---

## Infrastructure Dependencies

**None.** Phase 2 is pure computation. All tests are T1 unit tests via `node --test`. No Docker, no network, no filesystem beyond reading `src/` and `test/` files.

---

## Metadata

**Confidence breakdown:**
- Composition keyword design: HIGH — pseudocode verified in architecture.md; pitfall analysis in pitfalls.md
- $ref resolution: HIGH — algorithm verified in architecture.md; line references verified in Phase 1 source
- Cycle detection: HIGH — DFS algorithm fully specified in architecture.md; edge cases documented
- Integration points: HIGH — all file:line references verified by direct read of Phase 1 source

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (30 days — zero external dependencies; no fast-moving ecosystem)

---

*Phase research for: 02-composition-ref*
*Researched: 2026-05-02 — delta on top of project-level research*
