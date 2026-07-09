---
phase: 03-cli-shell-glob-explain-dogfood
plan: 02
subsystem: presentation

requires:
  - phase: 02-aggregates-sorting-pagination
    provides: AST + ExecutionPlan shapes (analyze.js, ast.js)
provides:
  - printExplain(ast, plan) — two-section text dump (Execution Plan + AST), no I/O
  - jsonlRow(row) — streaming JSON-per-line writer
  - formatTable(rows) — fixed-width table with auto-fit columns and bold headers
affects: [03-03 cli, 03-04 dogfood]

tech-stack:
  added: []
  patterns:
    - "node:util styleText for terminal coloring (auto-disabled when piped/NO_COLOR)"
    - "captureStdout test helper using process.stdout.write override"
    - "process.stdout.write throughout (NOT console.log) for buffering consistency"

key-files:
  created:
    - src/explain.js
    - src/formatter.js
    - test/explain.test.js
    - test/formatter.test.js
  modified: []

key-decisions:
  - "Use real AST field names (func/dir/STAR/expr) per src/ast.js, not the plan's draft names (fn/direction/Star/operand)"
  - "explain uses process.stdout.write throughout — no buffering inconsistency vs formatter"
  - "formatTable buffers (must compute widths); jsonlRow streams (one row at a time)"
  - "Empty/non-array rows → '(no rows)' to avoid empty-table awkwardness"

patterns-established:
  - "Two-section explain output: numbered stages + indented AST tree"
  - "Auto-fit column widths via Math.max(header.length, ...rows.map(cell.length))"

requirements-completed: [CLI-02, CLI-03, CLI-04, TEST-04]
test-tiers: [unit]

duration: ~12min
completed: 2026-05-02
---

# Plan 03-02: Explain + Formatter Summary

**printExplain produces a numbered-stage execution plan plus a pretty AST tree (no I/O); formatter exposes streaming JSONL and buffered fixed-width table**

## Accomplishments
- `src/explain.js` (146 lines): two-section output — Execution Plan with numbered stages (only present clauses appear) + AST tree with Alias/Aggregate/ColumnRef rendering
- `src/formatter.js` (62 lines): jsonlRow streams JSON-per-line; formatTable buffers, auto-fits widths, bold headers via util.styleText
- 13 tests across 2 files (≥8 required)
- 153 total tests passing (140 → 153, zero regression)

## Task Commits

1. **Tasks 1+2+3: explain.js + formatter.js + 13 tests** — `229ff20` (feat)

(Single commit since all three tasks share a logically atomic feature: presentation modules.)

## Files Created/Modified
- `src/explain.js` (NEW) — printExplain pretty-printer
- `src/formatter.js` (NEW) — jsonlRow + formatTable
- `test/explain.test.js` (NEW) — 6 explain tests including TEST-04 full-clause query
- `test/formatter.test.js` (NEW) — 7 formatter tests

## Decisions Made
- **Real AST field names**: The plan's draft used `fn`/`direction`/`{type:'Star'}`/`operand`. Actual AST per `src/ast.js` uses `func`/`dir`/`'STAR'`/`expr`. I matched the actual shape — verified by smoke test producing `Aggregate SUM(usage.output_tokens)` and `SORT calls DESC` exactly as the plan's regex assertions required.
- **No console.log anywhere**: All writes go through `process.stdout.write` to avoid the double-newline / buffering quirks that bit Phase 2.
- **Auto-fit widths**: First-row keys define columns; widths are max of header + every cell's String() length (with `?? ''` for null/undefined).

## Deviations from Plan

### Auto-fixed Issues

**1. [AST-shape correction] Plan field names matched src/ast.js, not the plan draft**
- **Found during:** Task 1 (explain.js implementation)
- **Issue:** Plan's `<interfaces>` block listed `Aggregate { fn, arg: { type: 'Star' } }` and `OrderByItem { direction }` and `UnaryOp { operand }`. Actual AST uses `func`, `arg: 'STAR'`, `dir`, `expr`.
- **Fix:** Used the real field names. Verified the plan's regex assertions (e.g., `Aggregate SUM\\(usage\\.output_tokens\\)`) still match correctly.
- **Files modified:** src/explain.js (only)
- **Verification:** All 13 explain+formatter tests pass; smoke test prints expected output exactly.
- **Committed in:** 229ff20

---

**Total deviations:** 1 auto-fixed (AST shape mismatch in plan draft).
**Impact on plan:** Zero behavior change vs plan intent — only field-name renames to match the real AST.

## Issues Encountered
None — the AST-shape correction was caught immediately by smoke-testing.

## Next Phase Readiness
- 03-03 has all four imports ready: resolveFrom, execute, printExplain, jsonlRow, formatTable
- 153 tests green; CLI integration tests can layer on top

---
*Phase: 03-cli-shell-glob-explain-dogfood*
*Completed: 2026-05-02*
