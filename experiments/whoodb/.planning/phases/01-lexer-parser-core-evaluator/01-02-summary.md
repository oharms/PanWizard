---
phase: 01-lexer-parser-core-evaluator
plan: 02
status: complete
wave: 2
completed: 2026-05-02
requirements_covered: [PROJ-01, PROJ-02, PROJ-03, PROJ-04, FILT-01, FILT-02, FILT-03, FILT-04, FILT-05, FILT-06, FILT-07, SRC-04, SRC-05]
test_count: 28
---

# Plan 01-02 Summary: Evaluator Backend

## What was built

The evaluator backend: pure WHERE evaluator (`src/where.js`), pure projector (`src/project.js`), and the streaming JSONL evaluator (`src/evaluator.js`). Plus a 12-row JSONL fixture with one deliberately malformed line, and end-to-end integration tests covering all five Phase 1 success criteria.

## Key files

- `src/where.js` — pure `evalWhere(node, row)` covering all FILT-* operators. Two-valued NULL semantics policy documented at top of file (verbatim from `<null_semantics_policy>` block in plan). `likeToRegex` anchors at both ends. `!=` special-cased to return false on null operands.
- `src/project.js` — pure `project(projectionList, row)` and `resolvePath(row, path)`. Wildcard returns shallow copy. ColumnRef key is original dotted name. Alias key is alias name.
- `src/evaluator.js` — async generator `execute(plan, filePath)` driving `node:readline` with `for await`. Try/catch around `JSON.parse` emits `whoodb: skipping malformed JSON line N: <msg>` to stderr, skips and continues. Blank lines silently skipped. Phase 1 guards reject non-null groupBy/sort/limit.
- `fixtures/sample.jsonl` — 12 valid rows + 1 blank line + 1 malformed line covering BETWEEN, LIKE, IN, dot-nested fields, and the missing-usage row (id 9).
- `test/where.test.js` — 14 tests covering FILT-01..06 plus dot-nested WHERE access plus null-WHERE-means-no-filter.
- `test/project.test.js` — 6 tests covering wildcard, named field, dot-nested, alias, mixed projections, resolvePath helper.
- `test/evaluator.test.js` — 8 integration tests covering all 5 Phase 1 success criteria + PROJ-04 + FILT-02 against fixture + GROUP BY rejection guard.

## Test results

`npm test` → 58 tests pass, 0 fail across the entire suite (Wave 1 + Wave 2).

Per-file totals:
- `test/lexer.test.js` — 12 tests pass
- `test/parser.test.js` — 13 tests pass
- `test/analyze.test.js` — 5 tests pass
- `test/where.test.js` — 14 tests pass
- `test/project.test.js` — 6 tests pass
- `test/evaluator.test.js` — 8 tests pass

## Phase 1 success criteria coverage (verifier-relevant)

| # | Criterion | Test |
|---|---|---|
| 1 | Streaming WHERE + projection + alias produces correct rows | SC1 in evaluator.test.js — asserts 7 rows with 'name' + 'out' keys, no 'usage.output_tokens' key |
| 2 | Parse error prints column position + expected/got tokens | SC2 — asserts `err.col === 8`, message matches `/column 8/`, `/expected/i`, `/FROM/` |
| 3 | BETWEEN/AND precedence boundary correct | SC3 — `WHERE n BETWEEN 1 AND 10 AND name = 'x'` returns ids [4, 8, 11] |
| 4 | LIKE fully anchored ('err%' does NOT match 'my_error') | SC4 — returns only id [6] (name 'error') |
| 5 | Malformed JSONL emits stderr warning, query continues | SC5 — captures stderr, asserts /malformed/i and /line \d+/, asserts 11 valid rows returned |

## Pitfall mitigations confirmed by tests

| Pitfall | Mitigation | Test gate |
|---|---|---|
| 4: NULL semantics | Two-valued logic, doc'd at top of where.js | FILT-06 tests: missing field = null, missing field = 'x', n > null all return false |
| 5: LIKE anchoring | `^` and `$` anchors in likeToRegex | SC4 + 3 LIKE unit tests |
| 6: Stream backpressure | `for await (const line of rl)` | evaluator.js source uses for-await; passing tests prove correctness |

## Verification gate checklist

- [x] `npm test` passes — 58 tests, 0 fail
- [x] `src/where.js` opens with the LOCKED two-valued NULL semantics comment block
- [x] `src/where.js` `likeToRegex` produces a regex anchored at both ends with `%` → `.*` substitution
- [x] `src/evaluator.js` uses `for await (const line of rl)`, NOT `rl.on('line')`
- [x] `src/evaluator.js` rejects plans with non-null groupBy/sort/limit
- [x] `fixtures/sample.jsonl` contains 11 valid rows + 1 deliberately malformed line + 1 blank line
- [x] All 13 requirement IDs (PROJ-01..04, FILT-01..07, SRC-04, SRC-05) have at least one passing assertion
- [x] All 5 Phase 1 success criteria from roadmap.md have a dedicated integration test
- [x] No file under `src/` imports from any package — `node:` builtins only

## Notes / deviations

- `package.json` test script changed from `node --test test/` → `node --test test/*.js`. On Node 24, the trailing-slash form is treated as a single file path and fails with MODULE_NOT_FOUND; the glob form correctly enumerates the test files. The plan didn't pre-specify this; flagged here for awareness.
- FILT-07 (in-memory free for WHERE-only path) is satisfied architecturally: the async generator yields one row at a time and never accumulates. Not separately tested.
