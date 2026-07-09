---
phase: 02-composition-ref
plan: 03
type: execute
wave: 3
depends_on: ["01", "02"]
files_modified:
  - test/composition.test.js
  - test/ref.test.js
autonomous: true
requirements: [COMP-01, COMP-02, COMP-03, COMP-04, REF-01, REF-02, LOAD-03]
change_class: feature

must_haves:
  truths:
    - "test/composition.test.js asserts: validate({oneOf:[{type:'string'},{minLength:1}]}, 'hello') is invalid with a rule:'oneOf' error whose message contains 'matched 2' and NO sub-errors (SC-1)"
    - "test/composition.test.js asserts: anyOf with all branches failing surfaces a rule:'anyOf' wrapper followed only by the fewest-errors branch's sub-errors (not all branches' errors) (SC-2)"
    - "test/composition.test.js asserts: allOf with minimum:5 AND maximum:3 returns BOTH minimum and maximum errors aggregated (SC-3)"
    - "test/composition.test.js asserts: not produces exactly one rule:'not' error when the inner schema passes; produces no errors when inner schema fails"
    - "test/ref.test.js asserts: validate({$ref:'#/definitions/email',definitions:{email:{type:'string'}}}, 42) returns invalid with path '$' (path transparency, SC-4)"
    - "test/ref.test.js asserts: $ref nested inside properties keeps original data path (e.g. $.email, NOT $.definitions.email)"
    - "test/ref.test.js asserts: a circular $ref chain throws at load time with a message containing 'cycle' BEFORE any data is checked (SC-5)"
    - "test/ref.test.js asserts: a dangling $ref throws at load with a message containing 'not found'"
    - "Full suite passes: node --test reports 0 failures across all test files (Phase 1: 40 + Phase 2: target ~21 = ~61 tests)"
  artifacts:
    - path: "test/composition.test.js"
      provides: "Phase 2 composition coverage: COMP-01..04 + SC-1..3"
      min_lines: 130
    - path: "test/ref.test.js"
      provides: "Phase 2 $ref + cycle coverage: REF-01, REF-02, LOAD-03 + SC-4..5"
      min_lines: 100
  key_links:
    - from: "test/composition.test.js"
      to: "src/validate.js"
      via: "import { validate } from '../src/validate.js'"
      pattern: "from ['\"]\\.\\./src/validate\\.js['\"]"
    - from: "test/ref.test.js"
      to: "src/validate.js"
      via: "import { validate } from '../src/validate.js'"
      pattern: "from ['\"]\\.\\./src/validate\\.js['\"]"
---

<objective>
Write the Phase 2 test suite. Two `node --test` files covering all 7 Phase 2 requirements and all 5 Phase 2 success criteria. After this plan, all Phase 2 requirements are demonstrably closed.

Purpose: Plan 02-01 added load-time refMap + cycle detection. Plan 02-02 added composition + $ref dispatch. This plan converts each requirement and success criterion into observable `validate()`-level test cases. The test suite is the executable proof that Phase 2 is complete.

Output:
- `test/composition.test.js` — 13 tests covering COMP-01..04 + SC-1..3 + Pitfalls 3, 10
- `test/ref.test.js` — 8 tests covering REF-01, REF-02, LOAD-03 + SC-4..5 + Draft-07 sibling-ignore
- Full suite green: `node --test` reports 0 failures, ~61 passing tests
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
@.planning/phases/02-composition-ref/02-02-summary.md
@.planning/research/pitfalls.md
@.planning/phases/01-foundation/01-03-summary.md

<interfaces>
Public API under test (locked by Plan 02-02):

  import { validate } from '../src/validate.js';
  const r = validate(schema, data);
  // r: { valid: boolean, errors: ValidationError[] }
  // ValidationError: { path, rule, message, value, expected? }

Composition error shapes (locked by Plan 02-02):
  - allOf: NO wrapper error — sub-errors from failing branches appear directly in r.errors
  - anyOf: wrapper { rule:'anyOf', message:'value must match at least one schema' } followed by fewest-errors branch's sub-errors (only on 0-match)
  - oneOf 0-match: wrapper { rule:'oneOf', message:'value must match exactly one schema (matched 0)' } + best-branch sub-errors
  - oneOf 2+-match: wrapper { rule:'oneOf', message includes 'matched N' for N>=2 } + NO sub-errors
  - not pass:  no errors emitted
  - not fail:  single { rule:'not', message:'value must not match schema' }

$ref behaviors (locked by Plan 02-02):
  - $ref short-circuits: sibling keywords ignored per Draft-07
  - Path transparency: error.path is the call-site path, not '...definitions...'
  - dangling/cycle refs throw at load time (Plan 02-01)

node:test conventions (per Phase 1 Plan 03):
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  // Flat test() calls, no describe — same style as Phase 1 test files.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write test/composition.test.js — COMP-01..04 + SC-1..3</name>
  <files>test/composition.test.js</files>
  <action>
Create `test/composition.test.js`. Follow Phase 1's flat-test convention (no describe blocks). All assertions go through the public `validate()` API — never import handlers directly.

Target test list (13 tests):

  // ---- oneOf (COMP-01) ----
  // 1. oneOf: 0 branches match → wrapper "(matched 0)" + best-branch sub-errors
  // 2. oneOf: exactly 1 branch matches → valid
  // 3. oneOf: 2+ branches match (SC-1) → single wrapper containing "matched 2", NO sub-errors
  // ---- anyOf (COMP-02) ----
  // 4. anyOf: at least 1 branch matches → valid
  // 5. anyOf: 0 branches match (SC-2) → wrapper + fewest-errors branch only
  // 6. anyOf: all branches match → valid (still passes, no error)
  // ---- allOf (COMP-03) ----
  // 7. allOf: all branches match → valid
  // 8. allOf: one branch fails → that branch's errors present
  // 9. allOf: conflicting constraints minimum:5 AND maximum:3 (SC-3) → BOTH errors
  // ---- not (COMP-04) ----
  // 10. not: inner schema fails → not succeeds (valid)
  // 11. not: inner schema passes → invalid with single rule:'not' error, no sub-errors
  // 12. not: produces correct path at root → '$'
  // ---- composition + path ----
  // 13. composition nested inside object property keeps correct path

Reference implementation (write this file verbatim, with light edits OK):

  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { validate } from '../src/validate.js';

  // ---------- oneOf (COMP-01) ----------

  test('oneOf: 0 branches match — wrapper + best-branch sub-errors', () => {
    // value: 42 (number). Branches: type:string fails (1 error), type:boolean fails (1 error).
    // Tie → leftmost wins.
    const r = validate({ oneOf: [{ type: 'string' }, { type: 'boolean' }] }, 42);
    assert.equal(r.valid, false);
    const wrapper = r.errors.find(e => e.rule === 'oneOf');
    assert.ok(wrapper, 'oneOf wrapper missing');
    assert.ok(wrapper.message.includes('matched 0'), 'message must say "matched 0": ' + wrapper.message);
    // Best branch contributed exactly 1 sub-error (a type error).
    const subErrors = r.errors.filter(e => e.rule !== 'oneOf');
    assert.equal(subErrors.length, 1, 'expected exactly 1 sub-error from best branch');
    assert.equal(subErrors[0].rule, 'type');
  });

  test('oneOf: exactly 1 branch matches — valid', () => {
    const r = validate({ oneOf: [{ type: 'string' }, { type: 'number' }] }, 'hello');
    assert.equal(r.valid, true);
  });

  test('oneOf: 2 branches match (SC-1) — single wrapper containing "matched 2", NO sub-errors', () => {
    // 'hello' satisfies both type:string and minLength:1.
    const r = validate({ oneOf: [{ type: 'string' }, { minLength: 1 }] }, 'hello');
    assert.equal(r.valid, false);
    assert.equal(r.errors.length, 1, 'must be exactly 1 error (no sub-errors when branches passed): ' + JSON.stringify(r.errors));
    assert.equal(r.errors[0].rule, 'oneOf');
    assert.ok(r.errors[0].message.includes('matched 2'), 'message must include "matched 2": ' + r.errors[0].message);
  });

  // ---------- anyOf (COMP-02) ----------

  test('anyOf: at least 1 branch matches — valid', () => {
    const r = validate({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 42);
    assert.equal(r.valid, true);
  });

  test('anyOf: 0 branches match (SC-2) — wrapper + fewest-errors branch only', () => {
    // value: 42. Branches:
    //   {type:'string', minLength:5}  → 1 error: type
    //   {type:'boolean'}              → 1 error: type
    // Tie → leftmost wins. Best branch contributes 1 sub-error.
    const r = validate({
      anyOf: [
        { type: 'string', minLength: 5 },
        { type: 'boolean' }
      ]
    }, 42);
    assert.equal(r.valid, false);
    const wrapper = r.errors.find(e => e.rule === 'anyOf');
    assert.ok(wrapper, 'anyOf wrapper missing');
    const subs = r.errors.filter(e => e.rule !== 'anyOf');
    assert.equal(subs.length, 1, 'fewest-errors branch should contribute exactly 1 error, got: ' + JSON.stringify(subs));
    // Critical: errors from OTHER branches must NOT appear (Pitfall 10).
    assert.ok(!subs.some(e => e.rule === 'minLength'), 'minLength is from a non-best branch — must not surface');
  });

  test('anyOf: 0 branches match — fewest-errors branch wins, even when one branch has more errors', () => {
    // Branch A produces 2 errors (type + minimum), branch B produces 1 error (type).
    // Best branch is B → only 1 sub-error in result.
    const r = validate({
      anyOf: [
        { type: 'number', minimum: 100 },  // for value 'hi': type + minimum = 2 errors
        { type: 'boolean' }                // for value 'hi': type = 1 error
      ]
    }, 'hi');
    assert.equal(r.valid, false);
    const subs = r.errors.filter(e => e.rule !== 'anyOf');
    assert.equal(subs.length, 1, 'fewest-errors branch (B) should win: ' + JSON.stringify(subs));
    assert.equal(subs[0].rule, 'type');
  });

  // ---------- allOf (COMP-03) ----------

  test('allOf: all branches match — valid', () => {
    const r = validate({ allOf: [{ type: 'string' }, { minLength: 1 }] }, 'hello');
    assert.equal(r.valid, true);
  });

  test('allOf: one branch fails — that branch errors are present', () => {
    const r = validate({ allOf: [{ type: 'string' }, { minLength: 5 }] }, 'hi');
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.rule === 'minLength'), 'minLength error missing: ' + JSON.stringify(r.errors));
  });

  test('allOf: conflicting constraints (SC-3) — BOTH errors aggregated', () => {
    // value 4 violates BOTH minimum:5 (from branch A) AND maximum:3 (from branch B).
    const r = validate({ allOf: [{ minimum: 5 }, { maximum: 3 }] }, 4);
    assert.equal(r.valid, false);
    const rules = r.errors.map(e => e.rule).sort();
    assert.deepEqual(rules, ['maximum', 'minimum'], 'both errors must surface: ' + JSON.stringify(rules));
  });

  // ---------- not (COMP-04) ----------

  test('not: inner schema fails — outer not succeeds (valid)', () => {
    const r = validate({ not: { type: 'string' } }, 42);
    assert.equal(r.valid, true);
  });

  test('not: inner schema passes — outer not fails with single rule:"not" error', () => {
    const r = validate({ not: { type: 'string' } }, 'hi');
    assert.equal(r.valid, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].rule, 'not');
    // Sub-errors from inside the inner schema must NOT leak.
    assert.equal(r.errors[0].path, '$');
  });

  test('not: produces correct path at root — "$"', () => {
    const r = validate({ not: { type: 'string' } }, 'hi');
    assert.equal(r.errors[0].path, '$');
  });

  // ---------- composition + path ----------

  test('composition + path: oneOf nested under object property keeps the property path', () => {
    const schema = {
      properties: {
        value: { oneOf: [{ type: 'string' }, { minLength: 1 }] }
      }
    };
    const r = validate(schema, { value: 'hello' });
    assert.equal(r.valid, false);
    const wrapper = r.errors.find(e => e.rule === 'oneOf');
    assert.ok(wrapper, 'oneOf wrapper missing');
    assert.equal(wrapper.path, '$.value', 'composition error must carry parent property path: ' + wrapper.path);
  });

Implementation notes:
- Tests 5 and 6 BOTH guard against Pitfall 10 (branch contamination) — test 6 is the harder case where the branches have different error counts.
- Test 11 must check `r.errors.length === 1` to guarantee `not` does not leak inner-schema sub-errors.
- Test 13 uses an object property to confirm composition errors carry the parent path correctly.
- Use `node:assert/strict` (not `node:assert`) for stricter equality.
- File expected size: ~140-180 lines including header comment.
  </action>
  <verify>
    <automated tier="T1">node --test test/composition.test.js</automated>
  </verify>
  <done>13 tests in `test/composition.test.js` all pass via `node --test test/composition.test.js`. SC-1 (oneOf 2-match) verified. SC-2 (anyOf 0-match best-branch) verified. SC-3 (allOf conflict) verified. COMP-01..04 each have at least one passing test plus failure-mode coverage. No regressions in Phase 1 tests when the full suite runs.</done>
</task>

<task type="auto">
  <name>Task 2: Write test/ref.test.js — REF-01, REF-02, LOAD-03 + SC-4..5</name>
  <files>test/ref.test.js</files>
  <action>
Create `test/ref.test.js`. Same style as Task 1 — flat tests, public API only.

Target test list (8 tests):

  // ---- REF-01 + LOAD-03 (resolution + path transparency) ----
  // 1. $ref to #/definitions/email resolves; valid data passes
  // 2. $ref top-level: invalid data returns error with path '$' (SC-4: path transparency)
  // 3. $ref nested inside properties keeps property path (NOT '$.definitions...')
  // 4. $ref chain (A refs B; B is a primitive constraint) resolves correctly
  // 5. $ref via $defs alias works equivalently to definitions
  // 6. $ref siblings ignored per Draft-07 (e.g. {$ref, minimum:5} only validates against ref target)
  // ---- REF-02 + LOAD-03 (cycle + dangling at load time, SC-5) ----
  // 7. Pure cycle (A → B → A) throws at LOAD time with "cycle" in message
  // 8. Dangling $ref throws at load with "not found" in message

Reference implementation:

  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { validate } from '../src/validate.js';

  // ---------- REF-01 + LOAD-03: resolution + path transparency ----------

  test('REF-01: $ref to #/definitions/<key> resolves; valid data passes', () => {
    const schema = {
      definitions: { email: { type: 'string' } },
      $ref: '#/definitions/email'
    };
    const r = validate(schema, 'a@b.io');
    assert.equal(r.valid, true);
  });

  test('SC-4: $ref top-level invalid data returns error with path "$" (path transparency)', () => {
    const schema = {
      definitions: { email: { type: 'string' } },
      $ref: '#/definitions/email'
    };
    const r = validate(schema, 42);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].rule, 'type');
    assert.equal(r.errors[0].path, '$', 'path must be transparent — no definitions segment: ' + r.errors[0].path);
    // Defensive: no path token mentions "definitions" or "$ref".
    assert.ok(!r.errors[0].path.includes('definitions'), 'path leaked definitions: ' + r.errors[0].path);
    assert.ok(!r.errors[0].path.includes('$ref'), 'path leaked $ref token: ' + r.errors[0].path);
  });

  test('REF-01: $ref nested inside properties keeps property path', () => {
    const schema = {
      definitions: { email: { type: 'string' } },
      properties: { contact: { $ref: '#/definitions/email' } }
    };
    const r = validate(schema, { contact: 42 });
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].path, '$.contact', 'expected $.contact, got: ' + r.errors[0].path);
    assert.equal(r.errors[0].rule, 'type');
  });

  test('REF-01: $ref chain — A refs primitive constraint; data validates against it', () => {
    const schema = {
      definitions: {
        smallNumber: { type: 'number', maximum: 10 }
      },
      $ref: '#/definitions/smallNumber'
    };
    assert.equal(validate(schema, 5).valid, true);
    const r = validate(schema, 42);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.rule === 'maximum'), 'maximum error missing through $ref: ' + JSON.stringify(r.errors));
  });

  test('REF-01: $ref via $defs alias resolves equivalently to definitions', () => {
    const schema = {
      $defs: { email: { type: 'string' } },
      properties: { e: { $ref: '#/$defs/email' } }
    };
    const r = validate(schema, { e: 42 });
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].path, '$.e');
    assert.equal(r.errors[0].rule, 'type');
  });

  test('REF-01 (Draft-07): $ref short-circuits — sibling keywords ignored', () => {
    // Even though minimum:100 is a sibling, only the ref target is checked.
    // Target is type:string, so value 'hi' must pass.
    const schema = {
      definitions: { s: { type: 'string' } },
      $ref: '#/definitions/s',
      minimum: 100  // would fail for any data if applied — but $ref ignores siblings
    };
    const r = validate(schema, 'hi');
    assert.equal(r.valid, true, 'sibling minimum must be ignored when $ref is present (Draft-07)');
  });

  // ---------- REF-02 + LOAD-03: load-time errors (SC-5) ----------

  test('SC-5: pure cycle (A → B → A) throws at LOAD time with "cycle" in message', () => {
    const schema = {
      definitions: {
        A: { $ref: '#/definitions/B' },
        B: { $ref: '#/definitions/A' }
      },
      $ref: '#/definitions/A'
    };
    let threw = false;
    let message = '';
    try {
      validate(schema, 'any data');
    } catch (e) {
      threw = true;
      message = e.message;
    }
    assert.equal(threw, true, 'circular $ref must throw at load time');
    assert.ok(message.includes('cycle'), 'error must mention "cycle": ' + message);
    // Verify load-time semantics: the throw happens regardless of data shape.
    let alsoThrew = false;
    try { validate(schema, 12345); } catch { alsoThrew = true; }
    assert.equal(alsoThrew, true, 'cycle throw must be independent of input data');
  });

  test('LOAD-03: dangling $ref throws at load with "not found" in message', () => {
    const schema = { $ref: '#/definitions/missing' };
    let threw = false;
    let message = '';
    try {
      validate(schema, 'x');
    } catch (e) {
      threw = true;
      message = e.message;
    }
    assert.equal(threw, true, 'dangling $ref must throw');
    assert.ok(message.includes('not found'), 'error must mention "not found": ' + message);
  });

Implementation notes:
- Test 6 explicitly proves Draft-07 sibling-ignore semantics. If `minimum:100` were applied alongside the ref, value `'hi'` would somehow have to satisfy minimum (impossible — strings don't have a numeric value), so the test would fail. Passing the test confirms `$ref` short-circuits.
- Test 7 uses BOTH a try/catch AND a second `validate()` call to prove the cycle throw is data-independent (the test would still throw on `validate(schema, 12345)`).
- The cycle test sets up a real A↔B chain (not just `{$ref: '#/definitions/A', definitions: {A: {$ref: '#'}}}`), exercising the multi-step DFS. Either form works, but the A↔B form is what users actually write.
- Use `node:assert/strict`. Flat `test()` calls — no describe.
- File expected size: ~110-140 lines including header comment.

After this task, run the FULL suite from the project root: `node --test`. Expected: ~61 passing tests, 0 failures, 0 skipped. (Phase 1: 40, Plan 02-03 Task 1: 13, Plan 02-03 Task 2: 8.) Test count >= 14 (TEST-01) was already met by Phase 1 — Phase 2 only adds coverage; it does not have a separate count requirement.
  </action>
  <verify>
    <automated tier="T1">node --test test/ref.test.js && node --test</automated>
  </verify>
  <done>8 tests in `test/ref.test.js` all pass via `node --test test/ref.test.js`. SC-4 (path transparency) verified. SC-5 (cycle at load) verified. REF-01, REF-02, LOAD-03 each have at least one passing test. Full suite passes: `node --test` reports 0 failures across all 10 test files (~61 tests total).</done>
</task>

</tasks>

<verification>
After both tasks:

1. Per-file test runs:
   - `node --test test/composition.test.js` — 13 passing, 0 failures
   - `node --test test/ref.test.js` — 8 passing, 0 failures
2. Full suite: `node --test` — ~61 passing tests, 0 failures, 0 skipped
3. Each Phase 2 success criterion has a named test:
   - SC-1 (oneOf 2-match): test "oneOf: 2 branches match (SC-1)" in composition.test.js
   - SC-2 (anyOf best-branch): test "anyOf: 0 branches match (SC-2)" in composition.test.js
   - SC-3 (allOf conflict): test "allOf: conflicting constraints (SC-3)" in composition.test.js
   - SC-4 ($ref path transparency): test "$ref top-level invalid data returns error with path '$'" in ref.test.js
   - SC-5 (cycle at load): test "pure cycle (A → B → A) throws at LOAD time" in ref.test.js
4. Each Phase 2 requirement closed:
   - COMP-01 (oneOf): tests 1, 2, 3 in composition.test.js
   - COMP-02 (anyOf): tests 4, 5, 6 in composition.test.js
   - COMP-03 (allOf): tests 7, 8, 9 in composition.test.js
   - COMP-04 (not): tests 10, 11, 12 in composition.test.js
   - REF-01 ($ref resolution): tests 1-6 in ref.test.js
   - REF-02 (cycle detection at load): test 7 in ref.test.js
   - LOAD-03 (refMap pre-walk + cycle/dangling): tests 7, 8 in ref.test.js
5. Pitfall coverage:
   - Pitfall 3 (oneOf two-match): test 3 in composition.test.js
   - Pitfall 10 (branch contamination): tests 5, 6, 11 in composition.test.js
   - Pitfall 5 (lazy cycle detection): test 7 in ref.test.js
</verification>

<success_criteria>
- [ ] `test/composition.test.js` exists with 13 passing tests
- [ ] `test/ref.test.js` exists with 8 passing tests
- [ ] `node --test` from project root: 0 failures across all test files (~61 total)
- [ ] All 5 Phase 2 success criteria (SC-1..SC-5) have at least one direct test
- [ ] All 7 Phase 2 requirements (COMP-01..04, REF-01, REF-02, LOAD-03) have at least one direct test
- [ ] Pitfalls 3, 5, 10 have at least one direct test
- [ ] No Phase 1 test was modified (`git status test/` shows only the two new files)
- [ ] Two atomic commits (one per file)
</success_criteria>

<output>
After completion, create `.planning/phases/02-composition-ref/02-03-summary.md` documenting:
- Total Phase 2 test count and full-suite total (Phase 1 + Phase 2)
- Mapping of each Phase 2 SC and requirement → which test name verifies it
- Mapping of each tested Pitfall → which test name verifies it
- Any minor adjustments needed (e.g., wrapper-message text matching that required loosening or strengthening assertions)
- Phase 2 final readiness statement: "Phase 2 success criteria 1-5 demonstrably satisfied via X tests; safe to proceed to Phase 3."
</output>
