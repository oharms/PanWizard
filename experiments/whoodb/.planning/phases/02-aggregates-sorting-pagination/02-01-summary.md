---
phase: 02-aggregates-sorting-pagination
plan: 01
subsystem: compiler-frontend
tags: [parser, analyzer, ast, aggregates, order-by, limit-offset]
requires: [phase-1-frontend]
provides: [aggregate-ast, orderbyitem-ast, limitoffset-ast, plan.sort, plan.limit, plan.implicitGroupBy]
affects: [src/ast.js, src/parser.js, src/analyze.js, src/lexer.js]
tech-stack:
  added: []
  patterns: [recursive-descent-extension, ident-then-paren-aggregate-detection, post-projection-scope-check]
key-files:
  created: []
  modified:
    - src/ast.js
    - src/parser.js
    - src/analyze.js
    - src/lexer.js
    - test/parser.test.js
    - test/analyze.test.js
key-decisions:
  - Lexer extended to emit '-' as OPERATOR (was LexError) so parseNonNegativeInt rejects 'LIMIT -1' as a parser-level error per the plan contract
  - LOCKED Aggregate / OrderByItem / LimitOffset AST shapes implemented exactly as plan specified
  - implicitGroupBy=true when projection has aggregates and groupBy is null; groupBy is set to [] (empty array, distinct from null)
requirements-completed:
  - AGGR-04
  - AGGR-05
  - SORT-01
  - SORT-02
  - SORT-03
  - PAGE-01
  - PAGE-02
duration: 8 min
completed: 2026-05-02
---

# Phase 2 Plan 1: Compiler Frontend Extensions Summary

Extended the Phase 1 frontend (AST + parser + analyzer) so the compiler accepts aggregate function calls (COUNT/SUM/AVG/MIN/MAX), ORDER BY clauses (single + multi-key, ASC/DESC), and LIMIT/OFFSET clauses, and produces ExecutionPlans with `sort`, `limit`, and `implicitGroupBy` populated. Pure compile-time work — no runtime path changes — so Wave 2's accumulator and sort modules can target stable AST/plan contracts.

## What Was Built

**src/ast.js** — added three exports: `aggregate(func, arg)`, `orderByItem(key, dir='ASC')`, `limitOffset(count, offset=0)`. Extended `selectStmt` to carry `orderBy` and `limit` (both default null, so all Phase 1 callers are unaffected). Top-of-file comment block now documents the three new node shapes and the extended ExecutionPlan shape.

**src/parser.js** — added `AGGREGATE_FUNCS` set, `parseAggregate`, `parseOrderBy`/`parseOrderByItem`, `parseLimit`/`parseNonNegativeInt`. `parseProjectionItem` detects the IDENT-then-`(` aggregate pattern; bare `count` (no parens) still parses as ColumnRef. Phase 1 throw on ORDER/LIMIT/OFFSET removed — those tokens now drive the new parsers. Clause chain in `parseSelect`: SELECT → FROM → WHERE → GROUP BY → ORDER BY → LIMIT.

**src/analyze.js** — implemented PARSE-09 implicit-GROUP-BY-() handling (aggregate-only projection with no GROUP BY → single-bucket case). Added SORT-03 post-projection scope check (ORDER BY key must resolve to a projected ColumnRef.name or Alias.alias; SELECT * skips). Plan now carries `implicitGroupBy: boolean`, `sort: OrderByItem[] | null`, `limit: LimitOffset | null`.

**src/lexer.js** — extended to emit `-` as OPERATOR token. Phase 1's lexer threw `LexError` on `-`; the plan's `parseNonNegativeInt` requires the parser to see an OPERATOR `-` before NUMBER and throw `ParseError`. Without this lexer change, `LIMIT -1` would surface as `LexError` rather than the contracted `ParseError(/non-negative integer/)`.

## Test Counts

| File | Before | After | Delta |
|---|---|---|---|
| test/parser.test.js | 13 | 27 | +14 |
| test/analyze.test.js | 5 | 15 | +10 |
| **Phase 1 + 02-01 total** | **58** | **82** | **+24** |

All 82 tests pass under `node --test`.

## Requirement Coverage

- **AGGR-04** (parser surface for aggregate calls): tests `parses COUNT(*)`, `parses COUNT(field)`, `parses SUM/AVG/MIN/MAX of dotted field`, `parses aggregate with alias`, `SELECT count FROM f — count is a column`, `SUM(*) is rejected`, `lowercase count(*) detected`.
- **AGGR-05** (multi-field GROUP BY parser surface — already worked in Phase 1; preserved): existing `GROUP BY produces ColumnRef list` test.
- **SORT-01** (single-key ORDER BY parses): `parses ORDER BY single key with default ASC`.
- **SORT-02** (multi-key ORDER BY): `parses multi-key ORDER BY with mixed directions`.
- **SORT-03** (ORDER BY post-projection scope): `ORDER BY references a projected column → passes`, `ORDER BY references an alias → passes`, `ORDER BY references unprojected column → throws ParseError`, `ORDER BY against SELECT * — scope check skipped`.
- **PAGE-01** (LIMIT non-negative integer): `parses LIMIT only`, `LIMIT -1 is rejected`, `LIMIT 1.5 is rejected`.
- **PAGE-02** (OFFSET non-negative integer): `parses LIMIT with OFFSET`.

The end-to-end test `end-to-end: full Phase 2 success-criterion query parses` proves the literal Phase 2 SC #1 query (`SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out FROM 'f' GROUP BY agent ORDER BY out DESC LIMIT 5`) parses to the correct AST shape.

## LOCKED Decisions Implemented

1. Aggregate AST shape `{type:'Aggregate', func, arg:'STAR'|ColumnRef}` — only COUNT may take STAR.
2. OrderByItem `{type:'OrderByItem', key, dir}` with default ASC.
3. LimitOffset `{type:'LimitOffset', count, offset}` with default offset 0.
4. AGGREGATE_FUNCS = `{COUNT, SUM, AVG, MIN, MAX}` — IDENT-then-`(` lookahead disambiguates from columns named `count`.
5. Implicit GROUP BY () routes to `groupBy=[], implicitGroupBy=true`.
6. SORT-03 post-projection scope check active for non-Wildcard projections.
7. PAGE-01/PAGE-02 non-negative integer guard at parse time (rejects `-1` and `1.5`).

(Note: type-tagged GROUP BY key formula lives in Plan 02 / accumulator. Stable Array.prototype.sort lives in Plan 03 / sort. Both are downstream of this plan's contracts.)

## Deviations from Plan

**[Rule 3 - Blocking] Lexer did not emit `-` as a token** — Found during: Task 2 verify. The plan's `parseNonNegativeInt` assumes `-` arrives as an OPERATOR token before NUMBER, but the Phase 1 lexer threw `LexError` on `-`. Fix: added an OPERATOR `-` branch to `tokenize()` (5 lines). This is the minimum change that lets the parser produce the contracted ParseError on `LIMIT -1`. Files modified: `src/lexer.js`. Verification: `LIMIT -1 is rejected` test now passes with `/non-negative integer/` ParseError. Commit: 6f90120.

**Total deviations:** 1 auto-fixed (R3 - Blocking). **Impact:** none on contract surface; lexer's external behavior is now slightly more permissive (`-` emits a token rather than throwing), but the parser still rejects every Phase 2 use. Phase 1 + Phase 2-01 lexer/parser tests all pass.

## Status

Ready for Plan 02-02 (accumulator) and Plan 02-03 (sort) — both depend on the AST shapes locked here. Wave 2 can run parallel.
