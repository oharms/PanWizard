---
phase: 01-lexer-parser-core-evaluator
plan: 01
status: complete
wave: 1
completed: 2026-05-02
requirements_covered: [PARSE-01, PARSE-02, PARSE-03, PARSE-04, PARSE-05, PARSE-06, PARSE-07, PARSE-08, PARSE-09]
test_count: 30
---

# Plan 01-01 Summary: Compiler Frontend

## What was built

The WHERE-side compiler frontend: AST shapes, lexer, recursive-descent parser, and semantic analyzer. Plus the project skeleton (package.json with engines.node>=22.17.0 and zero deps, .gitignore).

## Key files

- `package.json` — manifest, type:module, engines.node>=22.17.0, no deps
- `.gitignore` — node_modules, *.log, .DS_Store, coverage
- `src/ast.js` — 10 factory functions (selectStmt, wildcard, columnRef, alias, binaryOp, unaryOp, literal, inList, betweenRange, likePattern) plus LexError + ParseError classes; documents Token shape and ExecutionPlan shape
- `src/lexer.js` — tokenize(query) with case-insensitive keywords, original-case identifiers, dotted-IDENT support, 1-indexed col tracking captured at start of each iteration
- `src/parser.js` — parse(tokens) recursive-descent with iterative while loops at every expression level. Precedence ladder OR < AND < NOT < comparison < primary documented at top. BETWEEN consumed at Comparison level (Pitfall 2). NOT right-associative above AND/OR (Pitfall 7).
- `src/analyze.js` — analyze(ast) producing ExecutionPlan; enforces PARSE-09 GROUP BY rule
- `test/lexer.test.js` — 12 tests covering PARSE-01..04 + error positions + punctuation + empty input
- `test/parser.test.js` — 13 tests covering SELECT * / fields / aliases, WHERE basic, BETWEEN+AND collision (Pitfall 2), NOT precedence (Pitfall 7), no-left-recursion smoke timer (Pitfall 1), PARSE-08 error format, IN, LIKE, OR, parens, STRING-as-FROM, GROUP BY parser surface
- `test/analyze.test.js` — 5 tests covering GROUP BY rule pass/fail cases including SELECT * rejection

## Test results

`node --test test/lexer.test.js test/parser.test.js test/analyze.test.js` → 30 pass, 0 fail.

## Pitfall mitigations confirmed by tests

| Pitfall | Mitigation | Test gate |
|---|---|---|
| 1: Left recursion | Iterative `while` at each precedence level | smoke timer asserts <50ms for 5-AND chain |
| 2: BETWEEN/AND collision | BETWEEN parsed at Comparison; inner AND consumed there | structural assertion on `n BETWEEN 1 AND 10 AND name = 'x'` |
| 7: NOT precedence | parseNotExpr above parseAndExpr, below parseComparison | structural assertion on `NOT a = 1 AND b = 2` |
| 8: Lexer col tracking | `col = i + 1` at start of each iteration | `tokenize('SELECT FROM')` → FROM at col 8 |

## Interface contract for Plan 01-02

Plan 01-02 imports:
- `tokenize` from `./lexer.js`
- `parse` from `./parser.js`
- `analyze` from `./analyze.js`
- AST node-type strings (`'BinaryOp'`, `'UnaryOp'`, `'Literal'`, `'ColumnRef'`, `'Alias'`, `'Wildcard'`, `'InList'`, `'BetweenRange'`, `'LikePattern'`)
- ColumnRef carries `path: string[]` already split on `.`

ExecutionPlan shape: `{ scan: { source }, filter, projection, groupBy, sort: null, limit: null }` — Phase 1 evaluator must reject non-null groupBy/sort/limit.

## Notes

- Project intentionally has zero deps (no `dependencies` or `devDependencies` keys at all).
- Node engine floor `>=22.17.0` per `01-context.md` decision (resolves the project.md vs research.md drift).
- ORDER BY / LIMIT / OFFSET parsing throws ParseError in Phase 1 — Phase 2 will replace with full grammar.
