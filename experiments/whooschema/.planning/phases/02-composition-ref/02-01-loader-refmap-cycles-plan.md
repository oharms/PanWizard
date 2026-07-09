---
phase: 02-composition-ref
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/schema-loader.js
autonomous: true
requirements: [LOAD-03, REF-02]
change_class: feature

must_haves:
  truths:
    - "loadSchema(schema) returns an object of shape { schema, refMap } where refMap is a plain object keyed by $ref strings"
    - "buildRefMap indexes every entry in schema.definitions and schema.$defs under both '#/definitions/<name>' and '#/$defs/<name>' keys"
    - "loadSchema throws with a message containing 'cycle' when given a schema with a circular $ref chain (A -> B -> A) BEFORE returning"
    - "loadSchema throws with a message mentioning the missing target when a $ref points to an undefined definition"
    - "loadSchema preserves all Phase 1 behaviors: invalid pattern still throws, unknown keywords still warn once, walk still recurses only into sub-schema slots"
    - "The DFS cycle detector uses a visiting Set keyed by $ref strings and backtracks correctly so non-cyclic chains (A -> B where B has no further refs) load successfully"
  artifacts:
    - path: "src/schema-loader.js"
      provides: "loadSchema(schema) -> { schema, refMap }; buildRefMap(schema); detectCycles(schema, refMap)"
      exports: ["loadSchema"]
      contains: "buildRefMap"
      min_lines: 130
  key_links:
    - from: "src/schema-loader.js"
      to: "src/schema-loader.js (detectCycles)"
      via: "loadSchema calls walk() then buildRefMap() then detectCycles()"
      pattern: "detectCycles\\("
    - from: "loadSchema return"
      to: "validate.js consumer (Plan 02-02)"
      via: "destructure { schema, refMap }"
      pattern: "return \\{ schema, refMap \\}"
---

<objective>
Extend `src/schema-loader.js` so `loadSchema()` builds a `$ref` resolution map and rejects circular `$ref` chains at load time, BEFORE any data is checked. This is the load-time foundation that Plan 02-02 will consume.

Purpose: Closes LOAD-03 and REF-02 at the loader layer. By doing this in its own plan we lock the load-time contract (return shape, error semantics) before Plan 02-02 wires `refMap` through the validator and adds composition handlers. If Plan 02-02 had to evolve the loader and the validator simultaneously, a failure in either change would block both halves.

Output:
- `src/schema-loader.js` updated: adds `buildRefMap()`, adds `detectCycles()`, changes `loadSchema()` return value from `schema` to `{ schema, refMap }`.
- All existing Phase 1 behaviors preserved (invalid `pattern` throws, unknown keywords warn once, sub-schema slot walking unchanged).
- The 40 Phase 1 tests still pass (the only existing internal caller of `loadSchema()` is `validate.js`, which discards the return value — the shape change is invisible until Plan 02-02 destructures it).
</objective>

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
</execution_context>

<context>
@.planning/project.md
@.planning/roadmap.md
@.planning/state.md
@.planning/requirements.md
@.planning/phases/02-composition-ref/02-research.md
@.planning/research/architecture.md
@.planning/research/pitfalls.md
@.planning/phases/01-foundation/01-01-summary.md
@.planning/phases/01-foundation/01-02-summary.md
@src/schema-loader.js

<interfaces>
<!-- Phase 1 contract being evolved (current Phase 1 implementation) -->

```js
// src/schema-loader.js — Phase 1 (current)
export function loadSchema(schema) {
  walk(schema);          // throws on bad pattern; warns on unknown keywords
  return schema;         // <-- Phase 2 changes this
}
```

<!-- Phase 2 target contract -->

```js
// src/schema-loader.js — Phase 2 (target)
export function loadSchema(schema) {
  walk(schema);
  const refMap = buildRefMap(schema);
  detectCycles(schema, refMap);
  return { schema, refMap };
}

// New internal helpers (NOT exported — kept private to the module)
function buildRefMap(rootSchema): Record<string, object>;
function detectCycles(node, refMap, visiting?: Set<string>): void; // throws on cycle/dangling
```

<!-- Existing module-level constants in schema-loader.js (DO NOT REMOVE — reuse in detectCycles) -->

```js
const SUBSCHEMA_MAP_KEYWORDS   = new Set(['properties','patternProperties','definitions','$defs']);
const SUBSCHEMA_KEYWORDS       = new Set(['items','additionalProperties','not']);
const SUBSCHEMA_ARRAY_KEYWORDS = new Set(['allOf','anyOf','oneOf']);
```

<!-- Pitfall references (from .planning/research/pitfalls.md) -->
<!-- Pitfall 5: lazy cycle detection — DFS the full refMap at loadSchema time -->
<!-- Pitfall 6: JSON Pointer escaping (~0/~1) — out of scope for v1; refMap uses literal keys -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add buildRefMap() to src/schema-loader.js</name>
  <files>src/schema-loader.js</files>
  <action>
Add a new module-private function `buildRefMap(rootSchema)` to `src/schema-loader.js` that returns a plain object whose keys are `$ref` strings exactly as they would appear in a schema and whose values are the corresponding sub-schema object references (NOT deep copies — same object identity as in the input tree).

Place the function after the existing `walk()` function (around line 103) but before `loadSchema` is updated (Task 3 will rewire `loadSchema`). Do not export it.

Implementation per `02-research.md` §"refMap structure":

```js
/**
 * Build a $ref resolution map from definitions / $defs.
 *
 * Indexes each entry under BOTH '#/definitions/<name>' and '#/$defs/<name>'
 * so a schema authored with either alias resolves correctly. The values are
 * the same object references that appear in the input schema — no copies.
 *
 * Limitation (v1): Only definitions / $defs are indexed. Refs into
 * properties (e.g. '#/properties/foo') are NOT supported and will fail the
 * dangling-ref check in detectCycles. This is documented in
 * .planning/research/pitfalls.md (Pitfall 6) and matches the dogfood scope.
 */
function buildRefMap(rootSchema) {
  const refMap = {};
  if (rootSchema === null || typeof rootSchema !== 'object') return refMap;

  const definitions = (rootSchema.definitions && typeof rootSchema.definitions === 'object' && !Array.isArray(rootSchema.definitions))
    ? rootSchema.definitions
    : null;
  const defs = (rootSchema.$defs && typeof rootSchema.$defs === 'object' && !Array.isArray(rootSchema.$defs))
    ? rootSchema.$defs
    : null;

  if (definitions) {
    for (const [key, sub] of Object.entries(definitions)) {
      refMap['#/definitions/' + key] = sub;
      refMap['#/$defs/' + key]       = sub;
    }
  }
  if (defs) {
    for (const [key, sub] of Object.entries(defs)) {
      refMap['#/definitions/' + key] = sub;
      refMap['#/$defs/' + key]       = sub;
    }
  }

  // Optional: index the root schema under '#' for self-ref support.
  // The cycle detector will catch any actually-circular self-reference,
  // so it is safe to expose this key.
  refMap['#'] = rootSchema;

  return refMap;
}
```

Notes:
- Do NOT walk into nested `definitions` blocks. JSON Schema Draft-07 only resolves refs into the root's `definitions`/`$defs`, not nested ones.
- Including `'#'` as a refMap entry is intentional: it lets schema authors write `{$ref: '#'}` to mean "the root", and the cycle detector will reject the pure-cycle case (which is exactly the behavior SC-5 expects).
- `Array.isArray` guards prevent treating an array-shaped `definitions` as a definitions map.

Do NOT change `loadSchema` yet — Task 3 will do that, after Task 2 adds `detectCycles`. Keeping these as three small commits makes the diff trivially auditable.
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/schema-loader.js').then(async (m) => { /* buildRefMap is private — verify indirectly via loadSchema in Task 3. For Task 1 we just verify the file still parses and Phase 1 behavior is intact. */ const r = m.loadSchema({type:'object',properties:{name:{type:'string'}}}); console.log('OK loadSchema still returns:', typeof r); })"</automated>
  </verify>
  <done>`buildRefMap` is defined inside `src/schema-loader.js` (not exported). The file still parses as ESM. Phase 1 `loadSchema` behavior is unchanged because Task 3 has not yet rewired it. All 40 Phase 1 tests still pass: `node --test`.</done>
</task>

<task type="auto">
  <name>Task 2: Add detectCycles() DFS to src/schema-loader.js</name>
  <files>src/schema-loader.js</files>
  <action>
Add a module-private `detectCycles(node, refMap, visiting)` function that throws on circular `$ref` chains and on dangling refs.

Place it directly after `buildRefMap` from Task 1. Do not export it.

Implementation per `02-research.md` §"Cycle Detection Design" — DFS with a `visiting` Set of `$ref` strings, backtracking on exit:

```js
/**
 * Depth-first walk that throws on circular $ref chains and dangling refs.
 *
 * `visiting` is a Set of $ref strings currently on the DFS stack. When a
 * $ref is re-encountered while still in `visiting`, we have a cycle.
 * After we finish walking the target, the ref is removed (backtrack) so a
 * legitimate diamond pattern (A -> C, B -> C) does not falsely trigger.
 *
 * Limitation (v1, intentional): Self-referential schemas with base cases
 * (e.g. `{oneOf: [{type:'null'}, {properties:{child:{$ref:'#'}}}]}`) ARE
 * rejected — the algorithm conservatively treats any transitively-self-
 * referential schema as a cycle. Runtime recursion-depth limits are out of
 * scope per project.md. Document this limitation in the function comment.
 *
 * Closes LOAD-03 (cycle detection at load) and REF-02.
 */
function detectCycles(node, refMap, visiting = new Set()) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) detectCycles(item, refMap, visiting);
    return;
  }

  // $ref short-circuits: when a node has a $ref, only that ref's target is
  // walked — sibling keywords are ignored per Draft-07 semantics.
  if (typeof node.$ref === 'string') {
    if (visiting.has(node.$ref)) {
      const chain = [...visiting, node.$ref].join(' -> ');
      throw new Error('$ref cycle detected: ' + chain);
    }
    if (!Object.prototype.hasOwnProperty.call(refMap, node.$ref)) {
      throw new Error('$ref target not found: ' + node.$ref);
    }
    visiting.add(node.$ref);
    detectCycles(refMap[node.$ref], refMap, visiting);
    visiting.delete(node.$ref);
    return;
  }

  // Walk sub-schema slots only (mirrors walk()'s classification).
  for (const [key, value] of Object.entries(node)) {
    if (SUBSCHEMA_MAP_KEYWORDS.has(key)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const sub of Object.values(value)) detectCycles(sub, refMap, visiting);
      }
    } else if (SUBSCHEMA_KEYWORDS.has(key)) {
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const sub of value) detectCycles(sub, refMap, visiting);
        } else {
          detectCycles(value, refMap, visiting);
        }
      }
    } else if (SUBSCHEMA_ARRAY_KEYWORDS.has(key)) {
      if (Array.isArray(value)) {
        for (const sub of value) detectCycles(sub, refMap, visiting);
      }
    }
  }
}
```

Implementation notes:
- The function uses `Object.prototype.hasOwnProperty.call(refMap, ref)` rather than `refMap[ref] !== undefined` so that even a falsey-but-defined entry (theoretically `null`, though we never index one) is detected.
- `visiting` is a plain `Set` — not a `Map` — keyed by `$ref` strings. The chain message in the error is built from `[...visiting, node.$ref].join(' -> ')` which gives the user a readable trail like `#/definitions/A -> #/definitions/B -> #/definitions/A`.
- Reuses the existing `SUBSCHEMA_MAP_KEYWORDS`, `SUBSCHEMA_KEYWORDS`, and `SUBSCHEMA_ARRAY_KEYWORDS` Sets defined at the top of the file. **Do not redefine them.**
- `walk()` (Phase 1) does not include the root-self-ref `'#'` in its visited set, but `detectCycles` doesn't visit `walk` — they are orthogonal. The only point where they interact is via the fact that the same Sets are reused.

Do NOT call `detectCycles` yet — Task 3 wires it into `loadSchema`.
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/schema-loader.js').then(async (m) => { /* detectCycles is still private and uncalled. Phase 1 contract intact. */ const r = m.loadSchema({type:'object'}); if(typeof r!=='object')throw new Error('loadSchema return changed too early'); console.log('OK Phase 1 contract intact'); })"</automated>
  </verify>
  <done>`detectCycles` is defined inside `src/schema-loader.js` (not exported, not yet called). The file still parses as ESM. Phase 1 `loadSchema` still returns `schema` (Task 3 will change this). All 40 Phase 1 tests still pass: `node --test`.</done>
</task>

<task type="auto">
  <name>Task 3: Rewire loadSchema() to call buildRefMap + detectCycles and return { schema, refMap }</name>
  <files>src/schema-loader.js</files>
  <action>
Update the `loadSchema` function in `src/schema-loader.js` to wire in the helpers from Tasks 1 and 2, and change its return shape:

```js
export function loadSchema(schema) {
  walk(schema);                            // Phase 1: pattern + unknown-keyword pre-walk
  const refMap = buildRefMap(schema);      // Phase 2: build $ref index
  detectCycles(schema, refMap);            // Phase 2: throw on cycles / dangling refs
  return { schema, refMap };               // CHANGED return shape
}
```

Update the leading file comment to reflect the new behaviors:

```js
// src/schema-loader.js
// Pre-walk a schema before validation runs. Three responsibilities:
//   LOAD-01: throw on invalid `pattern` regex BEFORE any data is checked
//   LOAD-02: warn (once per process) on unknown keywords
//   LOAD-03: build a $ref resolution map and reject circular $ref chains
//            BEFORE any data is checked (Phase 2)
//
// loadSchema returns { schema, refMap } so callers can pass refMap into
// validateNode for $ref resolution at validate time.
```

**Important — backward-compat boundary:**
- The only internal caller of `loadSchema` is `src/validate.js` line 17, which currently writes `loadSchema(schema)` and discards the return value. The shape change is invisible to it for now; Plan 02-02 will destructure `refMap`.
- `loadSchema` is NOT exported from the public package entry (`src/validate.js` only re-exports `validate`). No external caller exists.
- The 40 Phase 1 tests do not call `loadSchema` directly — they call `validate()`. They continue to pass unchanged.

**Self-test before commit:**
1. Run `node --test` from project root. Expected: 40 passing tests, 0 failures.
2. Run the verify command below to confirm the new shape and load-time errors.
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/schema-loader.js').then(async (m) => { const r = m.loadSchema({type:'object',definitions:{email:{type:'string'}}}); if(!r||typeof r!=='object'||!('schema' in r)||!('refMap' in r))throw new Error('return shape wrong: '+JSON.stringify(Object.keys(r||{}))); if(r.refMap['#/definitions/email']?.type!=='string')throw new Error('refMap missing #/definitions/email'); if(r.refMap['#/$defs/email']?.type!=='string')throw new Error('refMap missing #/$defs/email alias'); /* cycle detection */ let threw=false; try { m.loadSchema({definitions:{A:{$ref:'#/definitions/B'},B:{$ref:'#/definitions/A'}},allOf:[{$ref:'#/definitions/A'}]}); } catch(e){ threw=true; if(!e.message.includes('cycle'))throw new Error('cycle error message missing \"cycle\": '+e.message); } if(!threw)throw new Error('A->B->A cycle was not detected'); /* dangling */ let danglingThrew=false; try { m.loadSchema({allOf:[{$ref:'#/definitions/missing'}]}); } catch(e){ danglingThrew=true; if(!e.message.includes('not found'))throw new Error('dangling-ref error message wrong: '+e.message); } if(!danglingThrew)throw new Error('dangling ref was not detected'); /* phase 1 contract preserved */ let patThrew=false; try { m.loadSchema({pattern:'['}); } catch(e){ patThrew=true; if(!e.message.includes('Invalid pattern'))throw new Error('pattern check broken: '+e.message); } if(!patThrew)throw new Error('Phase 1 pattern check regressed'); console.log('OK shape + cycle + dangling + Phase 1 preserved'); })"</automated>
  </verify>
  <done>`loadSchema` returns `{ schema, refMap }`. refMap indexes definitions/$defs under both `#/definitions/<k>` and `#/$defs/<k>`. A circular `$ref` chain throws an Error containing the word "cycle" at load time. A dangling `$ref` throws an Error containing "not found". Phase 1 invariants preserved: invalid `pattern` still throws, unknown keywords still warn, all 40 Phase 1 tests still pass via `node --test`.</done>
</task>

</tasks>

<verification>
After all three tasks:

1. `node --test` from project root: 40 Phase 1 tests still pass, 0 failures.
2. `node -e "import('./src/schema-loader.js').then(m=>{const r=m.loadSchema({definitions:{x:{type:'string'}}}); if(!('schema' in r)||!('refMap' in r))throw new Error('shape')})"` — return shape is `{schema, refMap}`.
3. Load-time cycle detection: `validate({definitions:{A:{$ref:'#/definitions/A'}},$ref:'#/definitions/A'}, null)` throws with "cycle" in the message before any data check.
4. Load-time dangling ref: `validate({$ref:'#/definitions/none'}, null)` throws with "not found" in the message.
5. Load-time pattern still throws (LOAD-01 regression check): `validate({pattern:'['}, 'x')` throws with "Invalid pattern".
6. Unknown-keyword warn still fires once (LOAD-02 regression check): `validate({'x-custom':true}, 'x')` warns once via console.warn.
</verification>

<success_criteria>
- [ ] `src/schema-loader.js` defines `buildRefMap` (private) — indexes `definitions` AND `$defs` under both `#/definitions/<k>` and `#/$defs/<k>`; also indexes the root under `#`
- [ ] `src/schema-loader.js` defines `detectCycles` (private) — DFS with `visiting` Set; throws "cycle" on revisit, "not found" on dangling
- [ ] `loadSchema` calls `walk(schema)` then `buildRefMap(schema)` then `detectCycles(schema, refMap)`, then returns `{ schema, refMap }`
- [ ] LOAD-03: cycle detection rejects at load time with a clear error
- [ ] REF-02: cycle detection runs BEFORE any data is checked (test: bad pattern + cycle = pattern error wins because walk runs first; cycle alone = cycle error)
- [ ] Phase 1 LOAD-01 (bad pattern throws) and LOAD-02 (unknown keyword warns once) preserved
- [ ] All 40 Phase 1 tests pass: `node --test`
- [ ] One atomic commit per task (3 commits)
</success_criteria>

<output>
After completion, create `.planning/phases/02-composition-ref/02-01-summary.md` documenting:
- Final shape of `loadSchema` return (`{ schema, refMap }`)
- New private helpers added (`buildRefMap`, `detectCycles`) — exact behavior, edge cases handled
- Locked load-time error messages: cycle text contains "cycle"; dangling text contains "not found"; pattern text contains "Invalid pattern"
- Confirmation that all 40 Phase 1 tests still pass
- Confirmation that no exports changed (only `loadSchema` is exported, and its return shape change is consumed only by Plan 02-02)
- Phase 1 → Phase 2 contract notes for Plan 02-02: the destructure point in `validate.js` and the `refMap` parameter to thread into `validateNode`
</output>
