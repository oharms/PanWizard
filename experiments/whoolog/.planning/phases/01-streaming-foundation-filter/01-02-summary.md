---
phase: 01-streaming-foundation-filter
plan: "02"
subsystem: predicates
tags: [predicates, dsl, time-parsing, null-safe, compile-once]

requires:
  - phase: 01-streaming-foundation-filter (plan 01)
    provides: streaming pipeline contract — these modules will plug into it in plan 03
provides:
  - compileKey: null-safe nested-key resolver (split-once, walk per row)
  - compileWhere: full operator set with longer-first lexing and type-aware equality
  - compileTimeFilter: strict UTC parsing, since-inclusive/until-exclusive, missing-ts policy
affects: [01-03, 02-*, 03-*]

tech-stack:
  added: []
  patterns:
    - "Compile-once / hot-loop closures: every parse and split happens at setup, not per row"
    - "err.usage = true sentinel for usage-vs-runtime exit-code routing"
    - "JSON.stringify-based type-aware equality (no hand-rolled deep-equal)"

key-files:
  created:
    - lib/resolve-key.js
    - lib/where.js
    - lib/time-filter.js
  modified: []

key-decisions:
  - "OPS array order is LOCKED to ['>=', '<=', '!=', '~', '=', '>', '<']. Longer ops MUST appear before their proper prefixes; otherwise the lexer would split `count>=10` as `count > '=10'` (Pitfall 6)."
  - "Type-aware equality is implemented via JSON.stringify rather than a hand-rolled deep-equal: it is shorter, naturally handles primitives + arrays-of-primitives, and gives the user the type-distinguishing semantics required by WHR-06."
  - "Date-only strings (YYYY-MM-DD) parse as UTC midnight by JS spec. Naive ISO datetimes (HH:MM without Z/offset) are REJECTED with a usage error rather than silently treated as local or UTC; this is the only way to keep cross-machine results reproducible (Pitfall 12)."

patterns-established:
  - "All compile work outside the returned closure: regex compiled once per --where, key path split once per --where, since/until parsed once per --since/--until."
  - "Numeric comparison non-numeric LHS → false (silent drop, not an error)."
  - "Regex op (~) only matches when LHS is a string; numeric/null LHS returns false."

requirements-completed:
  - KEY-01
  - KEY-02
  - KEY-03
  - KEY-04
  - WHR-01
  - WHR-03
  - WHR-04
  - WHR-05
  - WHR-06
  - WHR-07
  - TIM-01
  - TIM-02
  - TIM-03
  - TIM-04
test-tiers: []

duration: 12 min
completed: 2026-05-02
---

# Phase 1 Plan 02: Predicate Compilers Summary

**Compile-once predicate stack — null-safe dotted-key getter, where-DSL with longer-first lexing and JSON.stringify-based type-aware equality, and time-range filter with strict UTC parsing.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-02T13:02:00Z
- **Completed:** 2026-05-02T13:14:00Z
- **Tasks:** 3
- **Files created:** 3

## Accomplishments

- `lib/resolve-key.js` (33 lines): `compileKey(path)` splits the dotted path once and returns a closure that walks the precomputed segments, returning `undefined` for any null/undefined intermediate.
- `lib/where.js` (109 lines): `compileWhere(expr)`, `lex(expr)`, `parseRhs(raw)`. Operator order locked. `indexOf`-based split preserves values containing `=`. Type-aware equality via JSON.stringify; numeric ops with explicit Number coercion; regex op compiled once and only matches string LHS.
- `lib/time-filter.js` (74 lines): `compileTimeFilter({ since, until, tsField, keepMissing, required })` and `parseTimeBoundary(str)`. Date-only → UTC midnight; naive datetimes rejected; since inclusive, until exclusive; missing-ts policy honored.

## Task Commits

1. **Task 1: lib/resolve-key.js** — `e44bdbf` (feat)
2. **Task 2: lib/where.js** — `416342e` (feat)
3. **Task 3: lib/time-filter.js** — `6e76c56` (feat)

## Files Created/Modified

- `lib/resolve-key.js` — split-once null-safe nested-key getter
- `lib/where.js` — predicate compiler with full operator set + type-aware equality
- `lib/time-filter.js` — `--since`/`--until` predicate with strict UTC parsing

## Decisions Made

- Operator order: `OPS = ['>=', '<=', '!=', '~', '=', '>', '<']` is the only ordering that lets `count>=10` lex as a single `>=` token (Pitfall 6).
- Equality strategy: `JSON.stringify(lhs) === JSON.stringify(rhs)` — gives type-distinguishing equality without manual type-tag tracking, and naturally extends to primitive arrays.
- Naive ISO datetime handling: REJECT rather than coerce. The spec ambiguity (naive datetimes parse as local in some implementations and UTC in others) means any silent default would produce surprising cross-machine results (Pitfall 12).

## Deviations from Plan

None — plan executed exactly as written. The supplied implementation snippets were used verbatim with only minor refactoring (e.g., extracting a `makeUsageError` helper inside each module to avoid duplicating the `e.usage = true` boilerplate).

## Issues Encountered

None.

## Pitfall Guard Verification

| Pitfall | Guard | Status |
|---------|-------|--------|
| 6 (operator lexing) | `grep -q "OPS = \['>=', '<=', '!='"` lib/where.js | passes |
| 8 (split-on-equals) | `! grep -q "expr.split"` lib/where.js | passes |
| 12 (naive datetimes) | `grep -q "missing a Z"` lib/time-filter.js | passes |
| 13 (split-once) | `path.split('.')` outside the returned closure | passes (manual review) |
| 14 (null intermediates) | `if (cur == null) return undefined` | passes (manual review) |
| no-eval | `! grep -q "eval("` lib/where.js | passes |

## Module Exports Surface

| File | Exports |
|------|---------|
| `lib/resolve-key.js` | `compileKey` |
| `lib/where.js` | `compileWhere`, `lex`, `parseRhs` |
| `lib/time-filter.js` | `compileTimeFilter`, `parseTimeBoundary` |

## Compile-Once Verification

All three modules separate compile-time work from per-row work:

- `compileKey('a.b.c')`: `split('.')` runs ONCE; the returned `resolve(obj)` walks the precomputed segments per row.
- `compileWhere('msg~^err')`: `new RegExp(value)` runs ONCE; the returned predicate runs `re.test(v)` per row.
- `compileTimeFilter({since, until})`: `parseTimeBoundary` runs ONCE for each bound; the returned `timeFilter(obj)` does only `getTs(obj)` and a numeric comparison per row.

This is the foundation of the project's hot-loop optimization promise: a 1 M-line file does not pay for parsing 1 M times.

## User Setup Required

None.

## Next Phase Readiness

- Plan 03 (`filter` subcommand + integration tests) can now compose `sources` + `lines` + `decode` (from Plan 01) with `compileWhere` + `compileTimeFilter` (from this plan) and emit JSONL via the writer it builds.
- All thrown errors carry `err.usage = true`, so Plan 03's `try/catch` can route to `process.exit(2)` for usage errors and `process.exit(1)` for runtime.

---
*Phase: 01-streaming-foundation-filter*
*Completed: 2026-05-02*
