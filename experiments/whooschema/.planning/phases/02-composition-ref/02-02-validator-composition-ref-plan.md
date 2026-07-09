---
phase: 02-composition-ref
plan: 02
type: execute
wave: 2
depends_on: ["01"]
files_modified:
  - src/validate.js
  - src/validator-core.js
  - src/keyword-handlers.js
autonomous: true
requirements: [COMP-01, COMP-02, COMP-03, COMP-04, REF-01]
change_class: feature

must_haves:
  truths:
    - "validate(schema, data) destructures refMap from loadSchema and threads it into validateNode (refMap is no longer discarded)"
    - "validateNode accepts refMap as its 4th parameter with default {} so calls without refMap still work"
    - "When schema has $ref, validateNode resolves it via refMap and recurses with the SAME path (no '$ref' or 'definitions' segment in error paths)"
    - "$ref short-circuits: sibling keywords on the same node are ignored per Draft-07 (a schema like {$ref:'#/definitions/foo', minimum: 5} validates only against definitions.foo)"
    - "allOf runs every branch and aggregates errors from all failing branches into the parent error list"
    - "anyOf returns valid when any branch passes; on 0-match it pushes a single 'anyOf' wrapper error followed by the fewest-errors branch's sub-errors"
    - "oneOf with passing.length === 1 returns valid; passing.length === 0 surfaces best-branch errors prefixed by an 'oneOf' wrapper error containing 'matched 0'; passing.length > 1 emits a single 'oneOf' wrapper error containing 'matched N' and NO sub-errors"
    - "not produces exactly one error with rule:'not' when the inner schema passes; emits no errors when the inner schema fails"
    - "validateArray and validateObject in keyword-handlers.js accept refMap as a 5th parameter and forward it to all internal validateNode calls"
    - "All 40 Phase 1 tests still pass; no regression in primitive keyword behavior"
  artifacts:
    - path: "src/validate.js"
      provides: "Public validate() — destructures refMap from loadSchema, threads into validateNode"
      exports: ["validate"]
      contains: "const { refMap }"
    - path: "src/validator-core.js"
      provides: "validateNode(schema, data, path, refMap?) with $ref short-circuit + composition dispatch (allOf/anyOf/oneOf/not) inline"
      exports: ["validateNode"]
      contains: "schema.$ref"
      min_lines: 75
    - path: "src/keyword-handlers.js"
      provides: "validateArray and validateObject updated to accept and thread refMap through internal validateNode calls"
      exports: ["validateType", "validateString", "validateNumber", "validateArray", "validateObject", "validateEnum", "canonicalize"]
      contains: "refMap"
  key_links:
    - from: "src/validate.js"
      to: "src/schema-loader.js (loadSchema return)"
      via: "const { refMap } = loadSchema(schema)"
      pattern: "const \\{ refMap \\} = loadSchema"
    - from: "src/validate.js"
      to: "src/validator-core.js (validateNode call)"
      via: "validateNode(schema, data, '$', refMap)"
      pattern: "validateNode\\(schema, data, '\\$', refMap\\)"
    - from: "src/validator-core.js"
      to: "src/error-utils.js"
      via: "import { makeError } — composition handlers need it for wrapper errors"
      pattern: "makeError"
    - from: "src/keyword-handlers.js (validateArray, validateObject)"
      to: "src/validator-core.js (validateNode)"
      via: "Both handlers thread refMap as final arg to all validateNode calls"
      pattern: "validateNode\\([^)]*refMap"
---

<objective>
Wire `refMap` from Plan 02-01 through the validator and add `$ref` resolution + composition keyword handlers (allOf, anyOf, oneOf, not). Closes COMP-01..04 and REF-01.

Purpose: Plan 02-01 produced a `refMap` at load time but nothing consumed it. This plan threads `refMap` from `validate()` into `validateNode()` and into `validateArray`/`validateObject`, then adds the seven new dispatch branches inside `validateNode` (one for `$ref`, four for composition). After this plan, `validate()` end-to-end supports composition + `$ref` semantics; only the test suite (Plan 02-03) remains.

Output:
- `src/validate.js` — destructures `refMap` from `loadSchema` and passes it into `validateNode`
- `src/validator-core.js` — adds `refMap = {}` parameter, `$ref` short-circuit at top, four composition dispatch blocks at bottom
- `src/keyword-handlers.js` — `validateArray` and `validateObject` accept `refMap` as a 5th param and forward it to all four internal `validateNode` calls

The end-to-end behavior produced by this plan is what Plan 02-03's tests will assert against.
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
@.planning/phases/02-composition-ref/02-01-summary.md
@.planning/research/architecture.md
@.planning/research/pitfalls.md
@.planning/phases/01-foundation/01-02-summary.md
@src/validate.js
@src/validator-core.js
@src/keyword-handlers.js

<interfaces>
Phase 2 target signatures (the contract this plan delivers):

  // src/validate.js
  export function validate(schema, data) {
    const { refMap } = loadSchema(schema);
    const raw = validateNode(schema, data, '$', refMap);
    const errors = sortErrors(raw);
    return { valid: errors.length === 0, errors };
  }

  // src/validator-core.js
  export function validateNode(schema, data, path, refMap = {}) { ... }

  // src/keyword-handlers.js
  export function validateArray(schema, data, path, errors, refMap = {}) { ... }
  export function validateObject(schema, data, path, errors, refMap = {}) { ... }

Composition wrapper-error shapes (use existing makeError):
  - allOf wrapper: NO wrapper error — just aggregate sub-errors directly
  - anyOf wrapper: makeError(path, 'anyOf', 'value must match at least one schema', data)
  - oneOf wrapper: makeError(path, 'oneOf', `value must match exactly one schema (matched ${N})`, data)
  - not wrapper:   makeError(path, 'not',   'value must not match schema', data)

Pitfall references:
  - Pitfall 3:  oneOf two-match case must fail — run all branches, count passes, do not short-circuit on first match
  - Pitfall 6:  $ref escaping — out of scope; refMap uses literal $ref strings as keys
  - Pitfall 10: branch contamination — anyOf/oneOf surface only best-branch errors, not all branches
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update src/validate.js to destructure refMap and thread into validateNode</name>
  <files>src/validate.js</files>
  <action>
Modify `src/validate.js` (currently 21 lines) to consume Plan 02-01's new return shape.

Current implementation (Phase 1):

  import { loadSchema } from './schema-loader.js';
  import { validateNode } from './validator-core.js';
  import { sortErrors } from './error-utils.js';

  export function validate(schema, data) {
    loadSchema(schema);
    const raw = validateNode(schema, data, '$');
    const errors = sortErrors(raw);
    return { valid: errors.length === 0, errors };
  }

Phase 2 target:

  import { loadSchema } from './schema-loader.js';
  import { validateNode } from './validator-core.js';
  import { sortErrors } from './error-utils.js';

  export function validate(schema, data) {
    const { refMap } = loadSchema(schema);
    const raw = validateNode(schema, data, '$', refMap);
    const errors = sortErrors(raw);
    return { valid: errors.length === 0, errors };
  }

Two changes:
1. `loadSchema(schema)` becomes `const { refMap } = loadSchema(schema)`
2. `validateNode(schema, data, '$')` becomes `validateNode(schema, data, '$', refMap)`

Update the leading file comment to mention that Phase 2 threads `refMap` from the loader into the validator (in addition to the existing pre-walk-then-validate ordering note).

Self-test note: After this change, `validateNode` does not yet accept the 4th arg (Task 2 adds it). JS silently ignores extra positional args, so this temporary state still passes Phase 1 tests because no Phase 1 schema uses `$ref` or composition. Run `node --test` after Task 1 — must show 40 passing, 0 failures.
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/validate.js').then(async m => { const r = m.validate({type:'string'}, 42); if(r.valid)throw new Error('expected invalid'); if(r.errors[0].rule!=='type')throw new Error('rule wrong'); console.log('OK'); })" && node --test test/type.test.js test/loader.test.js</automated>
  </verify>
  <done>`src/validate.js` destructures `refMap` from `loadSchema(schema)` and passes it as the 4th argument to `validateNode`. Module imports unchanged. Phase 1 tests `node --test test/type.test.js test/loader.test.js` pass.</done>
</task>

<task type="auto">
  <name>Task 2: Extend validateNode with refMap param, $ref short-circuit, and composition dispatch (allOf/anyOf/oneOf/not)</name>
  <files>src/validator-core.js</files>
  <action>
Rewrite `src/validator-core.js` to add (a) `refMap = {}` as the 4th parameter, (b) a `$ref` short-circuit at the top of `validateNode`, (c) four composition dispatch blocks at the bottom of `validateNode`, and (d) a private `resolveRef(ref, refMap)` helper.

Add `makeError` to the imports from `./error-utils.js` (currently not imported here).

Target file (replace existing content):

  // src/validator-core.js
  // validateNode(schema, data, path, refMap?) — flat dispatcher over keyword handlers
  // and composition keywords. Each primitive handler self-guards on data type, so
  // we call them all in a fixed order. Phase 2 adds:
  //   - $ref short-circuit (REF-01): when schema.$ref is present, only the target
  //     schema is validated; sibling keywords are ignored per Draft-07.
  //   - allOf / anyOf / oneOf / not (COMP-01..04): inline dispatch after primitives.
  //
  // refMap is built by loadSchema (Plan 02-01) and threaded in from validate.js.
  // Default {} keeps the function callable without a refMap for tests / direct use.

  import {
    validateType,
    validateString,
    validateNumber,
    validateArray,
    validateObject,
    validateEnum
  } from './keyword-handlers.js';
  import { makeError } from './error-utils.js';

  export function validateNode(schema, data, path, refMap = {}) {
    const errors = [];
    if (schema === null || typeof schema !== 'object') return errors;

    // $ref short-circuits per Draft-07: sibling keywords are ignored.
    if (typeof schema.$ref === 'string') {
      const target = resolveRef(schema.$ref, refMap);
      // Path is preserved — the $ref is transparent (REF-01).
      return validateNode(target, data, path, refMap);
    }

    // Primitive keyword handlers (Phase 1 — order preserved for deterministic output).
    validateType(schema, data, path, errors);
    validateEnum(schema, data, path, errors);
    validateString(schema, data, path, errors);
    validateNumber(schema, data, path, errors);
    validateArray(schema, data, path, errors, refMap);
    validateObject(schema, data, path, errors, refMap);

    // Composition keywords (Phase 2).

    // allOf — run every branch; aggregate ALL errors from failing branches.
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) {
        const branchErrors = validateNode(sub, data, path, refMap);
        for (const e of branchErrors) errors.push(e);
      }
    }

    // anyOf — at least one branch must pass. On 0-match, surface fewest-errors branch
    // prefixed by a single 'anyOf' wrapper error.
    if (Array.isArray(schema.anyOf)) {
      const results = schema.anyOf.map(sub => validateNode(sub, data, path, refMap));
      const anyPassed = results.some(r => r.length === 0);
      if (!anyPassed) {
        const best = results.reduce((a, b) => a.length <= b.length ? a : b);
        errors.push(makeError(path, 'anyOf', 'value must match at least one schema', data));
        for (const e of best) errors.push(e);
      }
    }

    // oneOf — exactly one branch must pass. Two failure modes:
    //   passing.length === 0 → emit wrapper "(matched 0)" + best-branch sub-errors
    //   passing.length  > 1 → emit only the wrapper "(matched N)" — branches passed, no sub-errors
    if (Array.isArray(schema.oneOf)) {
      const results = schema.oneOf.map(sub => validateNode(sub, data, path, refMap));
      const passingCount = results.filter(r => r.length === 0).length;
      if (passingCount === 0) {
        const best = results.reduce((a, b) => a.length <= b.length ? a : b);
        errors.push(makeError(path, 'oneOf', 'value must match exactly one schema (matched 0)', data));
        for (const e of best) errors.push(e);
      } else if (passingCount > 1) {
        errors.push(makeError(path, 'oneOf', `value must match exactly one schema (matched ${passingCount})`, data));
      }
      // passingCount === 1 → no error
    }

    // not — schema must NOT match. Single inverse error; sub-errors are discarded.
    if (schema.not !== undefined && schema.not !== null && typeof schema.not === 'object') {
      const subErrors = validateNode(schema.not, data, path, refMap);
      if (subErrors.length === 0) {
        errors.push(makeError(path, 'not', 'value must not match schema', data));
      }
    }

    return errors;
  }

  /**
   * Resolve a $ref string against the pre-built refMap.
   *
   * The refMap is built at loadSchema time (Plan 02-01) and indexes
   * #/definitions/<key>, #/$defs/<key>, and the root #. A miss here is
   * unreachable in practice because detectCycles already throws on dangling
   * refs at load time — but we throw defensively in case validateNode is
   * called directly with a fabricated refMap (e.g. from a test).
   */
  function resolveRef(ref, refMap) {
    if (Object.prototype.hasOwnProperty.call(refMap, ref)) return refMap[ref];
    throw new Error('$ref target not found at validate time: ' + ref);
  }

Implementation notes:
- The dispatch order (type → enum → string → number → array → object → allOf → anyOf → oneOf → not) is deliberate and matches Phase 1's ordering for primitives. Composition keywords run AFTER primitives so a schema combining both (e.g. `{type:'string', allOf:[{minLength:3}]}`) reports errors in a deterministic order.
- The `$ref` branch is `return validateNode(...)` — it short-circuits the rest of the function. Per Draft-07, sibling keywords on a `$ref` node are ignored.
- `not`'s guard `typeof schema.not === 'object' && schema.not !== null` mirrors Phase 1's pattern of accepting only object sub-schemas. A `not: true` or `not: false` shape is not part of v1 scope and will silently no-op.
- `anyOf` / `oneOf` use `reduce((a, b) => a.length <= b.length ? a : b)` — the `<=` keeps the LEFTMOST branch in a tie (Risk 4 in research.md: documented deterministic tie-break).
- The `validateArray` and `validateObject` calls receive `refMap` as the 5th argument. Task 3 updates those handlers to accept it.

Self-test: Phase 1 tests still pass because the new code is purely additive — primitive dispatch unchanged, default `refMap = {}` keeps non-ref callers working. After this task, `validate({allOf:[{type:'string'},{minLength:3}]}, 'hi')` should return invalid with the minLength error (string passes type:string, fails minLength:3).
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/validate.js').then(async m => { /* allOf */ const r1 = m.validate({allOf:[{type:'string'},{minLength:3}]}, 'hi'); if(r1.valid)throw new Error('allOf should fail on minLength'); if(!r1.errors.some(e=>e.rule==='minLength'))throw new Error('allOf missing minLength error: '+JSON.stringify(r1.errors)); /* oneOf two-match */ const r2 = m.validate({oneOf:[{type:'string'},{minLength:1}]}, 'hello'); if(r2.valid)throw new Error('oneOf 2-match must fail'); const oneOfErr = r2.errors.find(e=>e.rule==='oneOf'); if(!oneOfErr)throw new Error('oneOf wrapper missing'); if(!oneOfErr.message.includes('matched 2'))throw new Error('oneOf message must contain matched 2: '+oneOfErr.message); /* anyOf 0-match wrapper */ const r3 = m.validate({anyOf:[{type:'string'},{type:'boolean'}]}, 42); if(r3.valid)throw new Error('anyOf should fail'); if(!r3.errors.some(e=>e.rule==='anyOf'))throw new Error('anyOf wrapper missing'); /* not */ const r4 = m.validate({not:{type:'string'}}, 'hi'); if(r4.valid)throw new Error('not should fail when inner passes'); if(r4.errors[0].rule!=='not')throw new Error('not error rule wrong'); /* not (success) */ const r5 = m.validate({not:{type:'string'}}, 42); if(!r5.valid)throw new Error('not should pass when inner fails'); /* $ref */ const r6 = m.validate({definitions:{e:{type:'string'}},$ref:'#/definitions/e'}, 42); if(r6.valid)throw new Error('$ref should resolve and reject number'); if(r6.errors[0].rule!=='type')throw new Error('$ref resolved error wrong'); if(r6.errors[0].path!=='$')throw new Error('$ref must preserve path: '+r6.errors[0].path); console.log('OK composition + $ref'); })" && node --test test/type.test.js test/string.test.js test/number.test.js test/array.test.js test/object.test.js test/paths.test.js test/aggregation.test.js test/loader.test.js</automated>
  </verify>
  <done>`src/validator-core.js` exports `validateNode(schema, data, path, refMap = {})`. `$ref` short-circuits with path preserved (REF-01). `allOf` aggregates branch errors (COMP-03). `anyOf` emits wrapper + best-branch sub-errors on 0-match (COMP-02). `oneOf` emits "matched N" wrapper for 0 or 2+ branches (COMP-01). `not` emits a single inverse error (COMP-04). All 40 Phase 1 tests still pass. `resolveRef` throws on misses (defensive — production path should never hit it because cycle detection rejects dangling refs at load).</done>
</task>

<task type="auto">
  <name>Task 3: Thread refMap through validateArray and validateObject in keyword-handlers.js</name>
  <files>src/keyword-handlers.js</files>
  <action>
Update `src/keyword-handlers.js` so `validateArray` and `validateObject` accept `refMap` as a 5th parameter and forward it to all internal `validateNode` calls. This closes the recursion path so `$ref` and composition work inside nested arrays/objects.

Two function signatures change. Four `validateNode(...)` call sites change.

Edit 1 — `validateArray` signature (currently line 165):

  Before:
    export function validateArray(schema, data, path, errors) {

  After:
    export function validateArray(schema, data, path, errors, refMap = {}) {

Edit 2 — `validateArray` tuple-form items recursion (currently line 213):

  Before:
    const sub = validateNode(schema.items[i], data[i], appendIndex(path, i));

  After:
    const sub = validateNode(schema.items[i], data[i], appendIndex(path, i), refMap);

Edit 3 — `validateArray` single-schema items recursion (currently line 220):

  Before:
    const sub = validateNode(schema.items, data[i], appendIndex(path, i));

  After:
    const sub = validateNode(schema.items, data[i], appendIndex(path, i), refMap);

Edit 4 — `validateObject` signature (currently line 241):

  Before:
    export function validateObject(schema, data, path, errors) {

  After:
    export function validateObject(schema, data, path, errors, refMap = {}) {

Edit 5 — `validateObject` properties recursion (currently line 257):

  Before:
    const sub = validateNode(subSchema, data[k], appendKey(path, k));

  After:
    const sub = validateNode(subSchema, data[k], appendKey(path, k), refMap);

Edit 6 — `validateObject` patternProperties recursion (currently line 271):

  Before:
    const sub = validateNode(subSchema, data[k], appendKey(path, k));

  After:
    const sub = validateNode(subSchema, data[k], appendKey(path, k), refMap);

Constraints:
- Do NOT modify any other function signatures (`validateType`, `validateString`, `validateNumber`, `validateEnum`, `canonicalize` — none of them recurse into `validateNode`).
- Do NOT change the order of dispatch inside `validateArray` or `validateObject` — preserves error ordering for determinism (API-03 / SC-3).
- The default `refMap = {}` ensures any caller still passing 4 args (none in production after Plan 02-02 Task 2, but possible in unit tests) works without modification.
- The 4 line numbers above are accurate as of the current file; if a previous edit shifted them, search for the exact `validateNode(` call patterns instead.

End-to-end check after Task 3: a $ref nested inside `properties` should resolve correctly. Schema `{properties:{email:{$ref:'#/definitions/e'}},definitions:{e:{type:'string'}}}` validating `{email: 42}` should produce one error with rule:'type', path:'$.email'. Without Task 3 the refMap would be lost at the `validateObject` boundary and the inner validateNode call would default to `{}`, throwing "$ref target not found".

Run the full test suite after this task: `node --test`. Expect 40 passing tests (Phase 1) + the additional behaviors verified by the Task 2 verify command. Plan 02-03 will add the explicit composition + $ref test files.
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/validate.js').then(async m => { /* $ref nested inside properties */ const r1 = m.validate({properties:{email:{$ref:'#/definitions/e'}},definitions:{e:{type:'string'}}}, {email: 42}); if(r1.valid)throw new Error('nested $ref should reject number'); if(r1.errors[0].path!=='$.email')throw new Error('nested $ref path wrong: '+r1.errors[0].path); if(r1.errors[0].rule!=='type')throw new Error('nested $ref rule wrong'); /* composition nested in array items */ const r2 = m.validate({items:{oneOf:[{type:'string'},{type:'number'}]}}, ['ok', 1, true]); if(r2.valid)throw new Error('oneOf inside items should reject boolean'); /* boolean fails both branches → oneOf wrapper at $[2] */ if(!r2.errors.some(e=>e.rule==='oneOf'&&e.path==='$[2]'))throw new Error('oneOf at $[2] missing: '+JSON.stringify(r2.errors)); console.log('OK nested $ref + composition'); })" && node --test</automated>
  </verify>
  <done>`validateArray` and `validateObject` accept `refMap` as their 5th parameter (defaulted to `{}`) and forward it to all four internal `validateNode` calls. `$ref` resolves correctly when used inside `properties` and `items`. Composition keywords work inside nested array/object positions. All 40 Phase 1 tests still pass: `node --test`.</done>
</task>

</tasks>

<verification>
After all three tasks:

1. Full Phase 1 suite: `node --test` — 40 passing, 0 failures.
2. End-to-end composition smoke tests (the snippets in Task 2 / Task 3 verify commands):
   - allOf: `validate({allOf:[{type:'string'},{minLength:3}]}, 'hi')` returns invalid with minLength error.
   - oneOf two-match (SC-1): `validate({oneOf:[{type:'string'},{minLength:1}]}, 'hello')` has rule:'oneOf' error with message containing "matched 2".
   - anyOf 0-match (SC-2): `validate({anyOf:[{type:'string'},{type:'boolean'}]}, 42)` has rule:'anyOf' wrapper followed by best-branch errors.
   - allOf conflict (SC-3): `validate({allOf:[{minimum:5},{maximum:3}]}, 4)` returns errors for both minimum and maximum.
   - not: `validate({not:{type:'string'}}, 'hi')` returns one rule:'not' error.
3. End-to-end $ref smoke tests (verify commands):
   - Top-level $ref (SC-4): `validate({$ref:'#/definitions/e',definitions:{e:{type:'string'}}}, 42)` rejects with path '$' (transparent).
   - Nested $ref: `validate({properties:{email:{$ref:'#/definitions/e'}},definitions:{e:{type:'string'}}}, {email: 42})` returns error with path '$.email'.
4. Cycle still throws at load (regression check from Plan 02-01): `validate({definitions:{A:{$ref:'#/definitions/A'}},$ref:'#/definitions/A'}, null)` throws with "cycle".
5. Pattern still throws at load (Phase 1 regression): `validate({pattern:'['}, 'x')` throws with "Invalid pattern".

If `node --test` is green and the smoke commands above all pass, this plan is complete.
</verification>

<success_criteria>
- [ ] `src/validate.js` destructures `refMap` and threads it into `validateNode`
- [ ] `src/validator-core.js` accepts `refMap = {}` as 4th parameter
- [ ] `$ref` short-circuit recurses with the SAME path (REF-01: path transparency)
- [ ] `$ref` siblings ignored per Draft-07 (e.g. `{$ref:'#/definitions/x', minimum:5}` validates only against `definitions.x`)
- [ ] `allOf` aggregates errors from all failing branches (COMP-03)
- [ ] `anyOf` emits one wrapper + fewest-errors branch on 0-match (COMP-02)
- [ ] `oneOf` emits "matched N" wrapper for N=0 or N>=2; valid on N=1 (COMP-01, including SC-1's two-match case)
- [ ] `not` emits a single inverse error when inner schema passes (COMP-04)
- [ ] `validateArray` and `validateObject` accept and forward `refMap` (5th arg)
- [ ] All 40 Phase 1 tests still pass: `node --test`
- [ ] One atomic commit per task (3 commits)
</success_criteria>

<output>
After completion, create `.planning/phases/02-composition-ref/02-02-summary.md` documenting:
- Final `validateNode` signature and dispatch order (primitives → allOf → anyOf → oneOf → not)
- `$ref` short-circuit semantics: path preserved, sibling keywords ignored (Draft-07)
- Composition error shapes (wrapper rule names, message templates) — locked for Plan 02-03 tests
- Confirmation that all 40 Phase 1 tests still pass
- Any deviations from the plan (e.g., handling of `not: true/false` non-object — should silently no-op in v1)
- Locked behaviors for Plan 02-03 tests:
    - `oneOf` 2-match: single error with message including "matched 2", NO sub-errors
    - `anyOf` 0-match: wrapper error first, then best-branch sub-errors
    - `allOf`: no wrapper, errors aggregated raw
    - `not` pass: no error; `not` fail: single 'not' error
    - `$ref` path transparency: target's errors carry the original call-site path
</output>
