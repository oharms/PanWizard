# Phase 1 Research — Lexer + Parser + Core Evaluator

**Researched:** 2026-05-02
**Confidence:** HIGH — phase scope is fully covered by project-level research; this file consolidates the planning-relevant subset.
**Authoring agent:** in-process orchestrator acting as `pan-phase-researcher` (Task tool unavailable in environment; instructions to read project research were honored)

> Project-level research is the source of truth. This file points back to it and surfaces only the items the planner needs at hand.
>
> Source files read:
> - `.planning/research/summary.md`
> - `.planning/research/architecture.md`
> - `.planning/research/pitfalls.md`
> - `.planning/research/stack.md`
> - `.planning/research/features.md`
> - `.planning/phases/01-lexer-parser-core-evaluator/01-context.md`
> - `.planning/idea.md`, `.planning/project.md`, `.planning/requirements.md`, `.planning/roadmap.md`, `.planning/state.md`, `.planning/standards.md`

## 1. Question this research answers

> "What do we need to know to PLAN Phase 1 well?"

Specifically: how do the 22 Phase-1 requirements map to source files, what build order is forced by dependencies, what test tiers are appropriate, and which pitfalls must be encoded into the plan's tasks rather than left to the executor's judgment.

## 2. Phase 1 component layout (locked in context)

| Module | Purpose | Phase 1 status | Builds against |
|--------|---------|----------------|----------------|
| `src/ast.js` | AST node shape constants + factory helpers (single source of truth) | Full Phase 1 surface (SelectStmt, ColumnRef, Wildcard, Alias, BinaryOp, UnaryOp, Literal, InList, BetweenRange, LikePattern). Aggregate / GroupBy / OrderByItem / LimitOffset shapes may be defined as placeholders for Phase 2 consumers but not used. | nothing |
| `src/lexer.js` | `string -> Token[]` with `{ type, value, col }`; case-insensitive keywords; 1-indexed columns | Complete. Token types: KEYWORD, IDENT, NUMBER, STRING, BOOLEAN, NULL_LIT, OPERATOR (`= != < <= > >=`), PUNCT (`, ( )`), WILDCARD (`*`), DOT, EOF. | nothing |
| `src/parser.js` | `Token[] -> SelectStmt` via recursive descent + precedence climbing | SELECT / FROM (single string) / WHERE only. GROUP BY / ORDER BY / LIMIT / OFFSET parser hooks may be present but the analyzer rejects them in Phase 1 OR the parser stubs them out (planner picks one). PARSE-09 GROUP BY semantic check goes in `analyze.js`, not the parser. | `lexer.js`, `ast.js` |
| `src/analyze.js` | Semantic pass: produces `ExecutionPlan { scan, filter, projection, groupBy: null, sort: null, limit: null }` for Phase 1; runs PARSE-09 if a GROUP BY clause appears (rejects non-aggregate non-grouped projection). | Phase 1 plan struct only has `scan`, `filter`, `projection`. Groups/sort/limit fields exist on the struct but stay null. | `ast.js` |
| `src/where.js` | Pure `(node, row) -> boolean` evaluator. Documents two-valued NULL policy at top of file. Implements `sqlEqual`, `sqlCompare`, `likeToRegex`, dot-path resolver. | All FILT-01..06 operators. | `ast.js` |
| `src/project.js` | Pure `(projectionList, row) -> outRow` projector with dot-nested resolution and alias mapping. | All PROJ-01..03. PROJ-04 alias-not-in-WHERE rule lives in `analyze.js` (or is enforced by virtue of WHERE evaluating against raw rows, not projected ones). | `ast.js` |
| `src/evaluator.js` | Drives `readline` async iterator over a single file path. For Phase 1, the only path is `streaming WHERE -> project -> emit`. Skips/warns malformed JSONL lines. | SRC-04, SRC-05, FILT-07. | `analyze.js`, `where.js`, `project.js`, Node `fs`/`readline` |

Test files mirror this layout under `test/`. The planner decides whether tests are colocated or grouped.

## 3. Build order (forced by deps)

```
ast.js (shapes only)
  -> lexer.js (testable in isolation against strings)
    -> parser.js (testable against a token list)
      -> analyze.js (testable against a SelectStmt)
        -> where.js (testable as a pure function over fake rows)
          -> project.js (testable as a pure function over fake rows)
            -> evaluator.js (the only async file in Phase 1)
```

Branches that can run in parallel:
- `where.js` and `project.js` are both pure functions over `ast.js` shapes — **once `ast.js` is finalised, they have no dependency on each other or on `parser.js`**. They can be built and tested in parallel with the parser.
- `analyze.js` depends only on `ast.js` shapes for its WHERE walk and on `parser.js` only as the *producer* of inputs to its tests. It can also be built in parallel with `where.js` / `project.js`.

This is the single most important insight for plan decomposition: **after `ast.js` lands, `lexer + parser` and `where + project + analyze` are two independent vertical slices that converge at `evaluator.js`**.

## 4. Plan-decomposition options the planner should weigh

The phase has 22 requirements, depth = `quick` (1-3 plans allowed), and idea.md's "Wave hint" suggests "Plan 01 = lexer + parser + AST + WHERE + projection".

### Option A — One plan, three waves of tasks (sequential within a single plan)

- Plan `01-01`: ast -> lexer -> parser -> analyze -> where -> project -> evaluator. Single atomic deliverable.
- **Pros:** simplest; one summary; no cross-plan dependency tracking.
- **Cons:** ~7 tasks, busts the "2-3 tasks per plan" rule (planner doctrine: split when >3 tasks). Pushes context past 50%.

### Option B — Two plans, two waves (recommended by context.md)

- **Plan `01-01` (Wave 1):** Frontend — `ast.js`, `lexer.js`, `parser.js`, `analyze.js` + their tests. Output: a tested `parse(query) -> ExecutionPlan` function.
- **Plan `01-02` (Wave 2, depends on 01-01):** Backend — `where.js`, `project.js`, `evaluator.js` + their tests + an end-to-end fixture test that satisfies all five Phase-1 success criteria.
- **Pros:** matches context.md's `lexer + parser + AST` vs `analyzer + WHERE + project + evaluator` split; each plan is 3-4 tasks; single sequential dependency edge; clear interface between plans (the AST + ExecutionPlan struct).
- **Cons:** 01-02 is bigger than 01-01 (3 source modules vs 4). Manageable.

### Option C — Three plans, two waves (fully parallel within Wave 2)

- **Plan `01-01` (Wave 1):** `ast.js` + `lexer.js` + `parser.js` + `analyze.js` (frontend).
- **Plan `01-02` (Wave 2, depends on 01-01):** `where.js` + `project.js` (pure-function backend; could run parallel to 01-03 because no file overlap).
- **Plan `01-03` (Wave 2, depends on 01-01):** `evaluator.js` + integration test (streaming + SRC-04 + SRC-05 + 5 success criteria). Must depend on 01-02 too because evaluator imports from where + project — making it Wave 3.
- **Pros:** smaller plans.
- **Cons:** evaluator can't start until both 01-02 and Plan 01-01 finish, so it ends up at Wave 3 anyway. The added plan boundary buys nothing because there is no parallelism gain and the integration test must wait for everything regardless. **Discard.**

### Recommendation

**Option B.** Two plans, two waves. Matches context.md's wave hint, fits the 2-3 tasks-per-plan doctrine when each plan is broken into 3 tasks, and keeps the interface boundary at the natural fault line (the AST / ExecutionPlan struct).

## 5. Pitfalls that must be encoded as task instructions, not left to executor judgment

Source: `.planning/research/pitfalls.md`. The planner MUST surface each of these in a task `<action>` field (with the exact mitigation, not just "avoid X"):

1. **Left-recursion** — parser uses precedence climbing (iterative `while` loops at each level), not direct recursion. Verify with a `< 1ms` parse of `a = 1 AND b = 2`.
2. **BETWEEN/AND collision** — BETWEEN consumes its inline `AND` separator at the comparison level before the boolean-AND loop runs. Test `WHERE n BETWEEN 1 AND 10 AND name = 'x'` immediately after wiring BETWEEN.
3. **NULL semantics** — two-valued logic (NULL = anything returns false). Document at the top of `where.js` BEFORE writing any comparison code. Implement `sqlEqual(a, b)` helper.
4. **LIKE anchoring** — convert pattern to `^` + escaped + `$` regex with `%` -> `.*`. Never `String.prototype.includes`. Test `'err%'` does NOT match `'my_error'`.
5. **NOT precedence** — NOT sits above AND/OR (between AND and comparison). Document the precedence ladder as a comment block at the top of `parser.js` BEFORE writing any expression rule.
6. **Lexer column tracking** — 1-indexed, points to the FIRST char of the token, not the char after it. Off-by-one is the most common bug here. Test `tokenize("SELECT FROM")` produces a token at col 8.
7. **Keyword case-insensitivity** — `SELECT`, `select`, `SeLeCt` all tokenize as KEYWORD `SELECT`. Internal value should be normalized (uppercase) so the parser can switch on it without re-uppercasing.

## 6. Test strategy

**Tier classification (all Phase 1 truths are T1 unit tests — no infrastructure needed):**

| Truth / Criterion | Minimum Tier | Infrastructure | Rationale |
|---|---|---|---|
| Lexer tokenizes correctly | T1 | None | Pure function over strings |
| Parser produces correct AST | T1 | None | Pure function over Token[] |
| WHERE evaluator returns correct boolean | T1 | None | Pure function over (node, row) |
| Projector produces correct shape | T1 | None | Pure function over (projection, row) |
| Streaming JSONL with WHERE prints expected rows | T1 | None | `node:test` reads a fixture file via `fs`, no Docker — single file, sub-100-row, in `fixtures/` |
| Parse error message format | T1 | None | Run parse on bad input, assert error message string |
| Malformed JSONL line warning | T1 | None | Capture process.stderr in test, run evaluator against fixture with bad line |

**Test runner:** `node --test`, no config file. Test files end in `.test.js`. Run with `node --test test/**/*.test.js`.

**Fixture strategy:** `fixtures/sample.jsonl` (small, hand-written, ~10-30 rows). At least one row exercises a dot-nested field (e.g., `usage.input_tokens`), one row exercises a string field used in LIKE, one row has a numeric field used in BETWEEN, and the file includes one deliberately malformed line for SRC-05 testing. A `fixtures/empty.jsonl` and a `fixtures/bom.jsonl` are out of scope (BOM is Phase 3).

**Test count:** context.md specifies `>=6 lexer + >=6 parser + >=3 WHERE` for Phase 1. Plus integration tests for the 5 success criteria. Total ~20 tests.

**Project-level standards (from `.planning/standards.md`):** test files use `node:test` and `node:assert/strict`. No `expect()` — use `assert.strictEqual`, `assert.deepStrictEqual`, `assert.throws`, `assert.match`.

## 7. Validation Architecture (Nyquist)

Each plan's `<verify>` block must include an `<automated>` command. Phase 1 commands:

- **Plan 01-01 (parse pipeline):** `node --test test/lexer.test.js test/parser.test.js test/analyze.test.js`
- **Plan 01-02 (evaluator pipeline):** `node --test test/where.test.js test/project.test.js test/evaluator.test.js`
- **Phase-level verification:** `node --test` (runs everything) + a 5-success-criteria smoke test that constructs queries and asserts results against the fixture.

## 8. Frontmatter requirement coverage map (planner cross-check)

Every Phase-1 requirement ID MUST appear in exactly one plan's `requirements` field. The recommended split for Option B:

| Plan | Requirements covered | Why |
|------|---------------------|-----|
| 01-01 (parse pipeline) | PARSE-01, PARSE-02, PARSE-03, PARSE-04, PARSE-05, PARSE-06, PARSE-07, PARSE-08, PARSE-09 | All parse / lexer / analyzer concerns |
| 01-02 (evaluator pipeline) | PROJ-01, PROJ-02, PROJ-03, PROJ-04, FILT-01, FILT-02, FILT-03, FILT-04, FILT-05, FILT-06, FILT-07, SRC-04, SRC-05 | Projection, filtering, streaming source |

**Total: 22 / 22.** No requirement is split across plans; no requirement is missing.

PROJ-04 lands in 01-02 because it's enforced by `analyze.js` running before evaluation — but the rule only matters at evaluation time, and the test for it is "ORDER BY can use alias, WHERE can't". Phase 1 has no ORDER BY, so PROJ-04 is split: the *negative* half (alias not in WHERE) is testable in Phase 1 and goes in 01-02; the *positive* half (alias works in ORDER BY) is Phase 2's job. The frontmatter for 01-02 documents this in a comment.

> **Resolution:** Put PROJ-04 in 01-02 with a single test asserting that `WHERE alias_name = ...` produces an analyzer error. The Phase 2 ORDER-BY-uses-alias test arrives later.

## 9. Key node version + tooling notes (locked)

- `package.json` `engines.node` MUST be set to `>=22.17.0` before any code lands. (state.md todo: "Update package.json engines to >=22.17.0".) The first plan's first task is responsible for `package.json`.
- Zero runtime deps. Zero dev deps. `package.json` should have NO `dependencies` or `devDependencies` keys.
- `package.json` `type: "module"` so source files use ESM `import` / `export`. Test files import via `import { test } from 'node:test'`.
- Path resolution: every `import` between project files uses relative paths with the `.js` suffix (ESM requirement).
- No bundler. No transpiler. No linter (deferred to Phase 3 if at all).
- `.gitignore` should already exist; if it doesn't, plan 01-01 task 1 adds one.

## 10. Open questions / planner discretion

These are NOT blockers; the planner picks one of each:

1. **Dotted identifier tokenization:** lex `usage.input_tokens` as one IDENT token (with the dot inside) OR as `IDENT DOT IDENT`. Either is valid. The pure-IDENT-with-dots approach is simpler for the parser; the IDENT-DOT-IDENT approach is closer to standard SQL. **Recommendation:** lex as a single IDENT containing dots, then the parser splits on `.` for projection-list items. This avoids polluting the parser with dot-tracking state.
2. **AST node naming:** `ColumnRef` vs `FieldRef` vs `Identifier`. **Recommendation:** `ColumnRef` (matches architecture.md's pattern table).
3. **Test file granularity:** one test file per source module (`lexer.test.js`, `parser.test.js`, ...) vs grouped by concern. **Recommendation:** one per source module — matches architecture.md's project structure recommendation.
4. **Execution plan struct:** is it `{ scan, filter, projection }` for Phase 1 (Phase 2 adds keys) OR `{ scan, filter, projection, groupBy: null, sort: null, limit: null }` (full shape, nulls for unused)? **Recommendation:** the full shape with nulls. Keeps `analyze.js` and `evaluator.js` from changing signature in Phase 2.
5. **Programmatic API:** expose `import { query } from 'whoodb'` in addition to CLI? Not required by Phase 1. **Recommendation:** SKIP — adds surface area not exercised by Phase 1 requirements; Phase 3 will decide.

## 11. RESEARCH COMPLETE

All Phase 1 questions for planning are answered. Hand off to `pan-planner` with this file + `01-context.md` as primary inputs.

---
*Phase 1 research complete: 2026-05-02*
