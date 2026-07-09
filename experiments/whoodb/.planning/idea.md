---
title: "whoodb — JSONL query engine with SELECT / WHERE / ORDER / LIMIT / GROUP BY"
created: "2026-05-02"
created_by: oharms
runtime_preference: claude
budget: 45
priority: medium
---

# Idea: whoodb — tiny SQL-ish query engine over JSONL

A zero-dependency Node.js CLI that runs a small, well-defined SQL-ish query language against one or more JSONL files. Think `jq` but with a query shape closer to SQL: `SELECT field1, field2 FROM logs WHERE level = 'error' GROUP BY agent ORDER BY count DESC LIMIT 10`. Built for the case where someone needs an answer out of a JSONL log RIGHT NOW and does not want to pipe seven shell tools together.

## Problem

`jq` is brilliant but its DSL is opaque to humans who think in SQL terms. PAN ships several JSONL logs (tokens.jsonl, trace.jsonl, bus channels) and the natural questions about them — "top 5 agents by output_tokens", "error events grouped by phase", "average input_tokens per agent for last week" — read trivially in SQL but require careful jq composition. A small SQL-ish engine purpose-built for JSONL would be dogfood-able for PAN's own observability.

This experiment is interesting because it stresses **lexer/parser design**, **AST evaluation**, **expression trees**, **aggregate functions**, and **execution-plan ordering** (WHERE must run before GROUP BY before ORDER BY before LIMIT) — patterns no past `whoo*` has touched.

## Success Criteria

- **SC-1:** Query language (subset of SQL):
  ```sql
  SELECT <projection-list>
  FROM <file-or-glob>
  [WHERE <expr>]
  [GROUP BY <field-list>]
  [ORDER BY <field> [ASC|DESC] [, <field> [ASC|DESC]]*]
  [LIMIT <int> [OFFSET <int>]]
  ```
  Projection: `*`, field names (incl nested via dot like `usage.input_tokens`), or aggregates: `COUNT(*)`, `COUNT(field)`, `SUM(field)`, `AVG(field)`, `MIN(field)`, `MAX(field)`. Aliases via `AS`.
- **SC-2:** WHERE expressions: comparison (`=`, `!=`, `<`, `<=`, `>`, `>=`), `IN (a, b, c)`, `LIKE 'prefix%'` (only `%` wildcard), `BETWEEN a AND b`, boolean (`AND`, `OR`, `NOT`), parens. String + number + boolean + null literals.
- **SC-3:** GROUP BY: aggregate selections must include all grouped fields; non-aggregate non-grouped fields are an error at parse time.
- **SC-4:** ORDER BY operates on projected fields (post-projection names, including aliases).
- **SC-5:** Execution: streaming WHERE (don't load whole file unless GROUP BY or ORDER BY require it). With GROUP BY, hold an in-memory aggregator keyed by group tuple. With ORDER BY without GROUP BY, must buffer (document the trade-off).
- **SC-6:** CLI: `whoodb query "<sql>"` prints results as JSONL by default. `--format table` for fixed-width text. `--explain` prints the parsed AST + execution plan instead of running.
- **SC-7:** ≥15 tests: SELECT *, SELECT specific fields, SELECT with alias, WHERE equality, WHERE LIKE, WHERE IN, WHERE BETWEEN, WHERE AND/OR/NOT precedence, GROUP BY single field, GROUP BY multiple fields, COUNT(*), SUM with non-numeric value (must error or skip — pick policy), AVG with NaN, ORDER BY ASC/DESC, LIMIT, OFFSET, nested field access, malformed JSONL line handling, parse error on bad SQL, glob input with multiple files.
- **SC-8:** Dogfood: run `whoodb query "SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out FROM '.planning/metrics/tokens.jsonl' GROUP BY agent ORDER BY out DESC LIMIT 10"` against a real PAN tokens log and get plausible output.
- **SC-9:** Parse errors include the position: `whoodb: parse error at column 23: expected FROM, got 'WHERE'`.

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| Single-table queries | Multi-table JOIN |
| Aggregates: COUNT/SUM/AVG/MIN/MAX | Window functions, HAVING (defer if time) |
| Nested field access via dot | Array indexing, JSON Pointer |
| LIKE with `%` only | Full regex, ILIKE, GLOB |
| Streaming WHERE | Streaming GROUP BY (in-memory only) |
| ORDER BY in-memory sort | External sort for huge files |
| `--explain` execution plan | Cost-based optimization |

## Constraints

- **Tech stack:** Node.js >= 16, zero runtime deps. Pure builtins (`fs`, `readline`, `path`, `node:test`, `node:assert/strict`).
- **Performance:** WHERE-only over a 100MB JSONL streams in under 15 seconds. GROUP BY over 100K rows finishes in under 5 seconds. ORDER BY 1M rows known to be in-memory; document the limit.
- **Determinism:** ORDER BY is stable (rows with equal sort keys retain input order). GROUP BY tuple order is deterministic (group keys sorted lex).
- **Cross-platform:** glob expansion handles backslash-vs-forward-slash on Windows.
- **Behavior on type mismatch:** SUM of a non-numeric value emits a stderr warning and skips the row. AVG of all-non-numeric is null.

## Reference material

- PAN's `pan-wizard-core/bin/lib/cost.cjs` `aggregate()` — manual aggregation pattern over `tokens.jsonl`
- PAN's `pan-wizard-core/bin/lib/optimize.cjs` `analyzeEvents()` — manual filtering + grouping over `trace.jsonl`
- The existing `whoolog` idea — overlapping but `whoolog` is filter-first, `whoodb` is query-first; whoodb subsumes the count + histogram cases
- PEG.js / nearley docs for parser shape inspiration (do NOT take a dep — write a recursive-descent parser by hand; that's part of the experiment)

## Notes

- **Decision principle:** the query language is the spec. Make it small, precise, and deterministic. A clean error message at parse time beats a clever feature.
- **Eat-our-own-dogfood marker:** done when SC-8 produces real, plausible aggregate output and `whoodb query "<sql>" --explain` shows a reasonable execution plan for a non-trivial query (WHERE + GROUP BY + ORDER BY + LIMIT).
- **Promote-worthy findings expected:** recursive-descent parser pattern (no deps), AST node shape, two-pass query execution (parse-then-evaluate), streaming-WHERE early termination on LIMIT (when no ORDER BY), aggregate accumulator interface, parse-error column tracking through the lexer.
- **Wave hint:** Plan 01 = lexer + parser + AST + WHERE + projection (no aggregates yet). Plan 02 = aggregates + GROUP BY + ORDER BY + LIMIT/OFFSET. Plan 03 = CLI + `--explain` + dogfood + table formatter.
- **Risk:** writing a recursive-descent parser is the biggest "could go sideways" item. Mitigation: keep the grammar small, write the lexer first with comprehensive token tests, then build the parser top-down.
