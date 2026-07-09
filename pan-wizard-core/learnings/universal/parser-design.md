---
topic: parser-design
last_updated: 2026-05-02T15:25:33.484Z
patterns:
  - id: P-1203
    summary: Compile-once / evaluate-many: parse user predicates/keys/queries into a closure or AST at startup, reuse on every row. 10-100x speedup vs re-parsing per row
    promoted_at: 2026-05-02T15:25:33.484Z
    source_experiments: [whoolog, whoodb, whooschema]
---

# Parser Design (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1203 — Compile-once / evaluate-many: parse user predicates/keys/queries into a closure or AST at startup, reuse on every row. 10-100x speedup vs re-parsing per row

**Evidence:** whoolog where.js, resolve-key.js, time-filter.js: each compiles once and exports a closure. whoodb lexer/parser/analyzer is a 3-stage compile-once pipeline. Phase 1-02 summary: '109 lines: compileWhere(expr), lex(expr), parseRhs(raw). Operator order locked.' Performance contract: filter 1M lines in <10s requires this discipline.

**Rule:** When user input (a where-expr, a dotted key path, a SQL query, a regex) will be evaluated against many rows, parse it ONCE into a callable (closure, AST, or compiled regex), then call repeatedly. Don't re-tokenize/re-parse inside the per-row hot loop. Examples: whoolog compileKey('a.b.c') returns row => row.a?.b?.c; compileWhere('level=error') returns row => row.level === 'error'. Type-aware equality via JSON.stringify when comparing user-supplied literals to JSON values keeps the evaluator simple.

**Applies in:** predicate/expression evaluators, query engines, validators with reusable schema
