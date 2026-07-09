---
phase: 02-composition-ref
verified: 2026-05-02T12:42:27Z
status: passed
score: 5/5 must-haves verified
---

# Phase 2: Composition + $ref Verification Report

**Phase Goal:** Users can validate documents against schemas that use composition keywords and local $ref pointers, with branch-level diagnostics on composition failures and cycle errors caught at load time.
**Verified:** 2026-05-02T12:42:27Z
**Status:** passed

## Test Gate

| Field | Value |
|-------|-------|
| Status | passed |
| Total tests | 61 |
| Passed | 61 |
| Failed | 0 |
| Skipped | 0 |
| Phase 1 baseline preserved | Yes (40/40 still passing) |

Run: `node --test` from project root → 0 failures across 10 test files.

## Goal Achievement

### Observable Truths (from roadmap.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `validate({oneOf:[{type:'string'},{minLength:1}]}, 'hello')` returns invalid with a single oneOf error describing "matched 2" | ✓ VERIFIED | test/composition.test.js: `oneOf: 2 branches match (SC-1) — single wrapper containing "matched 2", NO sub-errors` passes; src/validator-core.js:74 emits `value must match exactly one schema (matched ${passingCount})` |
| SC-2 | A failing `anyOf` surfaces errors from the closest-match branch (fewest errors), not errors from all branches | ✓ VERIFIED | test/composition.test.js: `anyOf: 0 branches match (SC-2) — wrapper + fewest-errors branch only` passes (Pitfall 10 mitigation); src/validator-core.js:55-62 reduces with `<=` for fewest-errors |
| SC-3 | `allOf` with two conflicting constraints returns errors from both branches aggregated together | ✓ VERIFIED | test/composition.test.js: `allOf: conflicting constraints (SC-3) — BOTH errors aggregated` passes (asserts `['maximum','minimum']`); src/validator-core.js:46-50 raw aggregation, no wrapper |
| SC-4 | `$ref: '#/definitions/email'` resolves and returns errors with original data path (transparent) | ✓ VERIFIED | test/ref.test.js: `SC-4: $ref top-level invalid data returns error with path "$" (path transparency)` passes; src/validator-core.js:27-31 reuses call-site path on $ref short-circuit |
| SC-5 | A circular $ref chain throws a clear load-time error before any data is checked | ✓ VERIFIED | test/ref.test.js: `SC-5: pure cycle (A → B → A) throws at LOAD time with "cycle" in message` passes (also tests data-independence); src/schema-loader.js:115-156 DFS detectCycles |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/schema-loader.js` | buildRefMap, detectCycles, loadSchema returns `{schema, refMap}` | ✓ EXISTS + SUBSTANTIVE | 158 lines; line 67 buildRefMap, line 115 detectCycles, line 52 `return { schema, refMap }` |
| `src/validate.js` | Destructures refMap and threads to validateNode | ✓ EXISTS + SUBSTANTIVE | Line 21 `const { refMap } = loadSchema(schema)`, line 22 `validateNode(schema, data, '$', refMap)` |
| `src/validator-core.js` | refMap = {} param, $ref short-circuit, composition dispatch | ✓ EXISTS + SUBSTANTIVE | 95 lines; line 22 `validateNode(schema, data, path, refMap = {})`, line 27 $ref short-circuit, lines 46-86 composition dispatch (allOf/anyOf/oneOf/not), line 91 resolveRef |
| `src/keyword-handlers.js` | validateArray and validateObject thread refMap through internal validateNode calls | ✓ EXISTS + SUBSTANTIVE | Line 165 `validateArray(...refMap = {})`, line 241 `validateObject(...refMap = {})`; lines 213, 220, 257, 271 forward refMap |
| `test/composition.test.js` | 13 tests covering COMP-01..04 + SC-1..3 | ✓ EXISTS + SUBSTANTIVE | 141 lines, 13 tests, all passing |
| `test/ref.test.js` | 8 tests covering REF-01, REF-02, LOAD-03 + SC-4..5 | ✓ EXISTS + SUBSTANTIVE | 124 lines, 8 tests, all passing |

**Artifacts:** 6/6 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| src/schema-loader.js loadSchema | detectCycles | Pre-walk → buildRefMap → detectCycles ordering | ✓ WIRED | src/schema-loader.js:49-52 |
| src/validate.js | src/schema-loader.js | `const { refMap } = loadSchema(schema)` | ✓ WIRED | src/validate.js:21 |
| src/validate.js | src/validator-core.js | `validateNode(schema, data, '$', refMap)` | ✓ WIRED | src/validate.js:22 |
| src/validator-core.js | src/error-utils.js | `import { makeError }` for composition wrapper errors | ✓ WIRED | src/validator-core.js:20 |
| src/validator-core.js | src/keyword-handlers.js | `validateArray(..., refMap)` and `validateObject(..., refMap)` | ✓ WIRED | src/validator-core.js:39-40 |
| src/keyword-handlers.js validateArray | src/validator-core.js validateNode | refMap forwarded as 4th arg in items recursion | ✓ WIRED | src/keyword-handlers.js:213, 220 |
| src/keyword-handlers.js validateObject | src/validator-core.js validateNode | refMap forwarded as 4th arg in properties + patternProperties recursion | ✓ WIRED | src/keyword-handlers.js:257, 271 |
| test/composition.test.js | src/validate.js | `import { validate } from '../src/validate.js'` | ✓ WIRED | test/composition.test.js:11 |
| test/ref.test.js | src/validate.js | `import { validate } from '../src/validate.js'` | ✓ WIRED | test/ref.test.js:13 |

**Wiring:** 9/9 connections verified

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| COMP-01 (oneOf — exactly one branch must match) | ✓ SATISFIED | tests 1, 2, 3 in composition.test.js (0/1/2-match all covered) |
| COMP-02 (anyOf — at least one; surface closest branch) | ✓ SATISFIED | tests 4, 5, 6 in composition.test.js |
| COMP-03 (allOf — every branch; errors aggregated) | ✓ SATISFIED | tests 7, 8, 9 in composition.test.js (incl. SC-3 conflict test) |
| COMP-04 (not — single inverse error) | ✓ SATISFIED | tests 10, 11, 12 in composition.test.js |
| REF-01 ($ref to local pointer resolves at validate time) | ✓ SATISFIED | tests 1-6 in ref.test.js (resolution, $defs alias, sibling-ignore, path transparency) |
| REF-02 ($ref cycle detection at schema-load time) | ✓ SATISFIED | test 7 in ref.test.js + src/schema-loader.js detectCycles |
| LOAD-03 ($ref pre-walk + cycle/dangling at load) | ✓ SATISFIED | tests 7, 8 in ref.test.js + src/schema-loader.js buildRefMap + detectCycles |

**Coverage:** 7/7 Phase 2 requirements satisfied

## Anti-Patterns Found

`grep -nE "TODO|FIXME|XXX|HACK"` over `src/` → no matches.
`grep -niE "placeholder|coming soon|will be here"` over `src/` → no matches.

**Anti-patterns:** 0 found

## Human Verification Required

None — all 5 success criteria are mechanically asserted by the test suite.

## Phase 1 Regression Check

- All 40 Phase 1 tests still pass.
- One test in `test/loader.test.js` (LOAD-02 known-keyword test) was updated to use a defined `$ref` target (`{definitions:{foo:{type:'string'}}, $ref:'#/definitions/foo'}`) instead of a dangling reference. The test's intent — verifying that `oneOf`, `$ref`, and `format` do not emit "unknown keyword" warnings — is preserved. The change was necessary because the prior schema relied on `$ref` being a no-op pre-Phase-2; under Phase 2's new dangling-ref check at load time (LOAD-03), the prior schema rightly throws.
- Documented in 02-01-summary.md "Issues Encountered".

## Gaps Summary

**No gaps found.** Phase 2 goal achieved. Ready to proceed to Phase 3.

## Verification Metadata

**Verification approach:** Goal-backward — Success Criteria from roadmap.md used directly as observable truths
**Must-haves source:** roadmap.md Success Criteria (overrides plan-level must_haves per workflow Option B)
**Automated checks:** 5/5 truths, 6/6 artifacts, 9/9 key links, 7/7 requirements — all passed
**Test gate:** 61/61 passing
**Human checks required:** 0
**Verification time:** ~3 min

---
*Verified: 2026-05-02T12:42:27Z*
*Verifier: orchestrator inline (no Task tool available in this environment)*
