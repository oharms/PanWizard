---
phase: 01-foundation
plan: 03
status: complete
completed: 2026-05-02
requirements: [API-03, TEST-01, TEST-02]
---

# Plan 03 Summary — Test Suite

## Total Test Count

**40 tests across 8 files, 0 failures, 0 skipped.** Well above the 14-test floor in TEST-01.

| File | Tests | Coverage |
|------|------:|----------|
| `test/type.test.js` | 7 | TYPE-01 + Pitfall 1 |
| `test/string.test.js` | 5 | TYPE-02 + Pitfall 8 |
| `test/number.test.js` | 5 | TYPE-03 |
| `test/array.test.js` | 5 | TYPE-04 + Pitfall 7 |
| `test/object.test.js` | 5 | TYPE-05 + Pitfall 4 |
| `test/paths.test.js` | 3 | API-04, API-05 + Pitfall 11 |
| `test/aggregation.test.js` | 4 | API-02, API-03 (SC-2, SC-3) |
| `test/loader.test.js` | 6 | LOAD-01, LOAD-02 (SC-4, SC-5) |
| **Total** | **40** | |

## SC / Pitfall → Test Mapping

| Criterion | Verifying test |
|-----------|----------------|
| SC-1 (validate shape) | type.test.js: `type:string rejects number` |
| SC-2 (5 violations aggregated) | aggregation.test.js: `SC-2: validate aggregates 5 distinct primitive violations` |
| SC-3 (numeric sort, deep) | aggregation.test.js: `SC-3: errors sort with numeric-aware path comparator` |
| SC-3 (numeric sort, root) | aggregation.test.js: `SC-3: sort is NOT plain lexicographic` |
| SC-3 (byte-identical determinism) | aggregation.test.js: `SC-3: identical inputs produce byte-identical errors arrays` |
| SC-4 (bad pattern at load, top-level) | loader.test.js: `SC-4: invalid pattern regex throws at load time` |
| SC-4 (bad pattern at load, nested) | loader.test.js: `SC-4: invalid pattern in nested schema also throws at load time` |
| SC-4 (bad pattern BEFORE data) | loader.test.js: `SC-4: bad pattern throws BEFORE data validation runs` |
| SC-5 (unknown keyword warn-once) | loader.test.js: `SC-5: unknown keyword emits exactly one console.warn` |
| SC-5 (warn deduped across calls) | loader.test.js: `SC-5: unknown keyword is deduped across multiple validate() calls` |
| LOAD-02 (Phase 2/3 keywords don't warn) | loader.test.js: `LOAD-02: known Phase 2/3 keywords ... do NOT emit ...` |
| Pitfall 1 (NaN/Infinity bypass) | type.test.js: `type:number rejects NaN and Infinity` |
| Pitfall 4 (additionalProperties + patternProperties) | object.test.js: `additionalProperties:false respects patternProperties` |
| Pitfall 7 (uniqueItems deep equality) | array.test.js: `uniqueItems uses deep equality with key-order normalization` |
| Pitfall 8 (pattern anchoring + no flags) | string.test.js: `pattern matches anywhere ...` + `pattern does not enable multiline flag` |
| Pitfall 11 (path format `[N]` not `.N`) | paths.test.js: `array index uses bracket notation [N], not dot` |

## Adjustments Made During Execution

1. **Schema-loader bug surfaced by tests:** The Plan 01 walker treated user-defined keys inside `properties:`, `patternProperties:`, `definitions:`, `$defs:` as unknown schema keywords. This produced spurious `whooschema: unknown keyword "name"` warnings whenever a schema declared sub-schemas. Fixed in `src/schema-loader.js` by classifying keywords by structural shape (sub-schema map / sub-schema / sub-schema array / data) and only walking into actual sub-schema slots. The fix is committed as a separate fix(...) commit between Plan 02 task 3 and Plan 03 task 1. All 40 tests pass after the fix; no SC requirement was changed.
2. **Bonus: regex validation of patternProperties keys.** While fixing the walker, also added load-time validation of the regex patterns used as `patternProperties` keys (an invalid pattern there would have surfaced as a runtime error, violating LOAD-01).

## Test Plan Spec Adjustment

The plan suggested `[...data].length` for `'🎉'.length` checks but Windows shell escapes in heredocs are tricky; used `'\u{1F389}'` Unicode escape literal in the test file to ensure both authoring and runtime produce a single-codepoint string. Behavior unchanged.

## Phase 1 Final Readiness Statement

**Phase 1 success criteria SC-1 through SC-5 are demonstrably satisfied via 40 tests** spanning all primitive keywords, all five Phase-1-applicable pitfalls, and the LOAD-01/LOAD-02 schema-loader contracts. Zero runtime dependencies (TEST-02 verified — `package.json` has no `dependencies` block). The codebase is ready for Phase 2 (composition + `$ref`) to extend `validateNode` and `loadSchema` without breaking the locked Phase 1 contracts.
