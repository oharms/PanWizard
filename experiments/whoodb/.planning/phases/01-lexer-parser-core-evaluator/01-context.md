# Phase 1: Lexer + Parser + Core Evaluator - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning
**Source:** Auto-mode synthesis (P-1803, v3.7.8) — derived from idea.md + project.md + requirements.md + research/summary.md without user dialogue

<domain>
## Phase Boundary

A user can stream a single JSONL file through a WHERE expression and receive projected, filtered rows — the core data-flow path is correct and the most critical parsing pitfalls (left-recursion, BETWEEN/AND collision, NULL semantics, LIKE anchoring, NOT precedence) are provably handled.

This phase delivers: lexer, recursive-descent parser, AST node shapes, semantic analyzer (GROUP BY rule even though GROUP BY itself is Phase 2), WHERE evaluator (pure function), projector with dot-nested + alias support, and the streaming row source from `readline`. It does NOT deliver: aggregates, GROUP BY execution, ORDER BY, LIMIT/OFFSET buffered paths, glob FROM, the CLI shell, or `--explain` printing. Those are Phase 2 and Phase 3.

</domain>

<decisions>
## Implementation Decisions

### From idea.md (Constraints / Scope / Notes)
- **Hand-rolled recursive-descent parser, no parser-generator dependency.** PEG.js / nearley / chevrotain are explicitly excluded as runtime deps. Reference for grammar shape only.
- **Zero runtime dependencies.** Pure Node builtins only: `fs`, `readline`, `path`, `node:test`, `node:assert/strict`. No lodash, chalk, commander, yargs.
- **Grammar surface for Phase 1:**
  - `SELECT <projection-list> FROM <single-file> [WHERE <expr>]`
  - Projection: `*`, field name (with dot-nested via `usage.input_tokens`), `field AS alias`
  - WHERE expressions: `=`, `!=`, `<`, `<=`, `>`, `>=`, `IN (a, b, c)`, `LIKE 'prefix%'`, `BETWEEN a AND b`, `AND`, `OR`, `NOT`, parens
  - Literals: string, number, boolean, null
- **`LIKE` supports `%` only.** No `_`, no full regex, no ILIKE. Anchor as `^...$` regex.
- **Determinism:** parser must be deterministic; same input → same AST. (Trivial for hand-rolled.)
- **Parse-error format:** `whoodb: parse error at column 23: expected FROM, got 'WHERE'`. Column is 1-indexed and tracked from the lexer.
- **Streaming WHERE:** evaluate row-by-row over the readline async iterator. No full-file buffer.
- **Malformed JSONL line:** stderr warning, skip row, continue. Do not abort the query.
- **Risk callout from idea.md:** the parser is the biggest "could go sideways" item; mitigation is to write the lexer first with comprehensive token tests, then build the parser top-down.

### From research/summary.md (Synthesizer-resolved choices)
- **Node version floor: `>=22.17.0`.** Resolved against idea.md's `>=16` — adopt v22.17.0. Reason: every prior LTS is EOL; `fs.promises.glob`, `util.styleText`, `util.parseArgs`, and `node:test` are all simultaneously stable only at v22.17.0. Phase 1 only needs `node:readline` + `node:test` from this floor; the floor itself must be set in `package.json` `engines` before any code lands.
- **`readline` API style: `for await...of`, not event-based.** Resolved against the perf-vs-correctness conflict. `for await` for cleaner async control flow, natural early-termination via `break`, and backpressure-safe behavior. Phase 3 will benchmark against the 100MB / 15s budget; if missed, the fallback (`rl.on('line')` + `events.once(rl, 'close')`) is a contained change to one file.
- **NULL semantics policy:** two-valued logic — `NULL = NULL` returns `false`. Document this as a comment block at the top of `where.js` before any comparison code is written. Implement `sqlEqual(a, b)` helper that returns `false` whenever either side is null/undefined.
- **LIKE anchoring:** convert pattern to a fully anchored regex (`^` + escaped literal text + `$`, with `%` → `.*`). Never use `String.prototype.includes()`. Test that `'err%'` does NOT match `'my_error'`.
- **Operator precedence ladder (locked):** `OR < AND < NOT < comparison < BETWEEN/IN/LIKE < primary`. Implement with iterative `while` loops at each precedence level (precedence-climbing), not direct recursion — left recursion is the documented top risk.
- **BETWEEN consumption rule:** parse BETWEEN as a unit at the comparison level. Consume both bounds and the inline `AND` separator inline before the boolean-AND loop runs at its own level. Test `WHERE n BETWEEN 1 AND 10 AND name = 'x'` immediately after wiring BETWEEN.

### From requirements.md (locked v1 requirements mapped to Phase 1)
- **PARSE-01..09:** lexer case-insensitivity, 1-indexed column tracking, full literal set, dotted identifiers, full v1 grammar AST, precedence-climbing parser, BETWEEN-vs-AND, parse-error formatting, GROUP BY semantic check (parse-time even though GROUP BY exec is Phase 2)
- **PROJ-01..04:** `SELECT *`, named/dot-nested fields, `AS` aliases, alias-in-ORDER-BY-not-WHERE rule
- **FILT-01..07:** all comparison operators, `IN`, anchored `LIKE %`, `BETWEEN` inclusive, boolean composition with parens, NULL → false, streaming WHERE
- **SRC-04:** readline-based line-by-line JSONL parsing
- **SRC-05:** malformed-line stderr warning + skip

### From research/architecture.md (Component layout)
- **Files to create (locked layout):**
  - `src/ast.js` — plain JS object shapes shared by parser, analyzer, evaluator (single source of truth for node shapes)
  - `src/lexer.js` — string → `Token[]` with `{ type, value, col }`; case-insensitive keyword handling; 1-indexed column tracking
  - `src/parser.js` — `Token[]` → `SelectStmt` AST via recursive descent + precedence climbing
  - `src/analyze.js` — semantic analyzer; runs synchronously after parse; produces `ExecutionPlan` struct (Phase 1 fills `streaming` flag, leaves `groupBy`/`sort` null)
  - `src/where.js` — pure `(node, row) => boolean` WHERE evaluator
  - `src/project.js` — pure projector with dot-nested field access and alias mapping
  - `src/evaluator.js` — drives the readline async iterator; for Phase 1, the only path is "streaming WHERE → project → emit"
- **Build order (locked):** ast.js shapes → lexer.js (test in isolation) → parser.js (test against tokens) → analyze.js → where.js (pure-function tests) → project.js → evaluator.js (the only async file in Phase 1)
- **Type-tagged GROUP BY keys:** the helper `groupKey(vals)` returning `JSON.stringify(vals.map(v => [typeof v, v]))` should be defined in Phase 1's `accumulator.js` placeholder OR deferred entirely to Phase 2. Defer to Phase 2 — Phase 1 has no GROUP BY execution path.

### Claude's Discretion (planner / executor decides)
- Internal AST node naming convention (e.g., `ColumnRef` vs `FieldRef`) — pick one and use it consistently.
- Whether dotted identifiers are a single token at the lexer level or composed of `IDENT . IDENT` at the parser level. Either is valid; pick whichever is simpler to test.
- Test file layout under `test/` (one file per source module, vs grouped by feature).
- Fixture JSONL data shape and size for streaming-WHERE tests (small enough to be fast, varied enough to exercise dot-nested fields).
- Whether to expose a programmatic API (`require('whoodb').query(sql, file)`) in addition to the CLI surface — not required by Phase 1 requirements; the planner may add it if it simplifies testing.
- Comment density and inline doc style.
- Whether `analyze.js` runs the GROUP BY rule check (PARSE-09) by walking the AST or by structural pattern-matching. Either approach satisfies the requirement.

</decisions>

<specifics>
## Specific References

- **idea.md "Reference material":**
  - `pan-wizard-core/bin/lib/cost.cjs` `aggregate()` — manual aggregation pattern over `tokens.jsonl` (relevant for Phase 2 dogfood, not Phase 1).
  - `pan-wizard-core/bin/lib/optimize.cjs` `analyzeEvents()` — manual filtering + grouping over `trace.jsonl` (relevant for Phase 2/3, not Phase 1).
  - PEG.js / nearley docs — grammar-shape inspiration only; do NOT take a runtime dep.
- **idea.md "Wave hint":** "Plan 01 = lexer + parser + AST + WHERE + projection (no aggregates yet)" — use as the default plan-decomposition starting point. The phase contains 22 requirements; depth=`quick` allows 1-3 plans per phase. A single plan covering all 22 is plausible; two plans (lexer+parser+AST vs. analyzer+WHERE+projection+evaluator) is also reasonable. The planner decides.
- **research/pitfalls.md "Looks Done But Isn't" checklist:** apply as the acceptance gate before declaring Phase 1 done. Specific items to test:
  - Left-recursion: `a = 1 AND b = 2` returns in <1ms (stack overflow indicates left recursion)
  - BETWEEN-AND: `WHERE n BETWEEN 1 AND 10 AND name = 'x'` parses correctly
  - NULL: `WHERE missing_field = NULL` returns no rows (not all rows)
  - LIKE: `'err%'` does not match `'my_error'`
  - NOT precedence: `NOT a = 1 AND b = 2` parses as `(NOT (a = 1)) AND (b = 2)`
  - Keyword-as-identifier: a row with a field literally named `as` or `from` does not crash projection
- **Test framework:** `node --test` exclusively. ≥6 lexer tests, ≥6 parser tests, ≥3 WHERE evaluator tests in Phase 1 (the ≥15-test total in TEST-01 spans all three phases).
- **Coding posture:** the experiment's promote-worthy artifacts include the recursive-descent parser pattern, AST node shapes, and parse-error column tracking through the lexer. Code clarity and comment quality on these specific elements is more important than for evaluator internals.

</specifics>

<deferred>
## Deferred Ideas

None — auto-mode synthesis honors the original idea.md and roadmap scope. No scope-creep candidates surfaced from the upstream documents.

</deferred>

---

*Phase: 01-lexer-parser-core-evaluator*
*Context auto-synthesized: 2026-05-02 via discuss-phase P-1803 bypass — no user dialogue*
