---
phase: 03-table-formatter-performance-dogfood
plan: "01"
subsystem: cli-output-formatter
tags: [table, tty, ansi, format, parseargs, integration-tests, unit-tests]

requires:
  - phase: 01-streaming-foundation-filter (plan 03)
    provides: writeJsonl, runCLI helper, streaming filter pipeline
  - phase: 02-aggregations-count-histogram (plan 02)
    provides: count and histogram subcommands with format guard
provides:
  - lib/format.js — formatTable/writeTable/defaultFormat exports + writeJsonl preserved
  - lib/filter.js — buffer-then-render path for --format table; defaultFormat() FMT-04 default
  - lib/count.js — outputRows array + dispatch on format; defaultFormat() default
  - lib/histogram.js — outputRows array + dispatch on format; defaultFormat() default
  - test/format.test.js — 12 unit tests for pure formatter
  - test/format-tty.test.js — 13 integration tests for FMT-02/FMT-03/FMT-04 wiring
affects: [03-02, future polish phases]

tech-stack:
  added: []
  patterns:
    - "Pure formatter: formatTable(rows, columns) -> string with no I/O, no ANSI, deterministic"
    - "Two-space column separator + max(headerLen, ...valueLen) widths via padEnd"
    - "Nullish coalescing (?? not ||) for cellStr so 0 renders as '0' not ''"
    - "FMT-04 TTY default via defaultFormat() helper; FORCE_COLOR=1 forces table for tests since spawnSync never allocates a PTY"
    - "Filter buffers in table mode (memory becomes O(matching rows)); JSON mode preserves O(1) streaming"

key-files:
  created:
    - test/format.test.js
    - test/format-tty.test.js
  modified:
    - lib/format.js
    - lib/filter.js
    - lib/count.js
    - lib/histogram.js

key-decisions:
  - "formatTable uses ?? (nullish coalescing) not || so zero values render as '0'. Falsy coalescing would hide every zero count, which is the most important diagnostic."
  - "Two-space column separator (not one space, tab, or pipe). Visually breathable, no special chars needed in the separator line, and lets users pipe directly into wc/grep without surprises."
  - "Filter table mode infers columns from Object.keys(matched[0]) -- documented limitation: fields absent in the first matching row are excluded. Avoids a two-pass schema-merge that would defeat the streaming design."
  - "defaultFormat() centralizes the TTY check so a single change updates all three subcommands (DRY)."
  - "FORCE_COLOR=1 (not just isTTY) is the test escape hatch since spawnSync never allocates a PTY -- documented in research §Pitfall E."

patterns-established:
  - "Formatter contract: pure functions for rendering, thin writer wrappers for I/O. Same shape works for any future subcommand."
  - "Subcommand format dispatch: const format = values.format || defaultFormat(); validate; then if (format === 'table') writeTable(...) else writeJsonl-loop."
  - "Filter buffer-vs-stream split: if-format-json path stays streaming; else-path buffers matching rows then renders."

requirements-completed:
  - FMT-02
  - FMT-03

test-tiers: [unit, integration]

duration: ~10 min
completed: 2026-05-02
---

# Phase 3 Plan 01: Table Formatter + TTY Default Summary

**Table formatter (`lib/format.js`) and `--format table` wiring across filter/count/histogram. TTY default switch via `defaultFormat()`. 25 new tests (12 unit + 13 integration). Total project test count: 103/103 passing (78 prior + 25 new).**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3
- **Files created:** 2 (`test/format.test.js` 95 lines, `test/format-tty.test.js` 162 lines)
- **Files modified:** 4 (`lib/format.js` 16 -> 64 lines, `lib/filter.js`, `lib/count.js`, `lib/histogram.js`)

## Accomplishments

- `lib/format.js`: extended from 16 to 64 lines with `formatTable(rows, columns)` (pure renderer), `writeTable(rows, columns)` (writer wrapper), and `defaultFormat()` (FMT-04 TTY-aware default). `writeJsonl` preserved unchanged.
- `lib/filter.js`: format-mode dispatch -- JSON path stays streaming (FLT-01 O(1) preserved), table path buffers matching rows then renders. Help text documents the memory trade-off.
- `lib/count.js` + `lib/histogram.js`: build `outputRows` array, then dispatch -- table path uses `writeTable`, json path loops `writeJsonl`. Identical shape across both subcommands.
- All three subcommands now: (a) accept `--format table`, (b) emit exact error `whoolog: --format <fmt>: must be 'json' or 'table'` on unknown values, (c) default to `defaultFormat()` instead of hardcoded `'json'`.
- `test/format.test.js` (12 unit tests): empty input, single column, two columns, header-vs-values widths, null/undefined cells, zero rendering (?? not ||), ANSI absence, defaultFormat behavior, export shape.
- `test/format-tty.test.js` (13 integration tests): count/histogram/filter table mode, empty result, ANSI absence, invalid format error, FMT-04 default switch (FORCE_COLOR=1 forces table; piped defaults to json), filter column inference from first row, regression on json mode.

## Task Commits

1. **Task 1: Extend lib/format.js with formatTable + writeTable + defaultFormat** -- `c748841` (feat)
2. **Task 2: Wire --format table into filter, count, histogram** -- `80754b4` (feat)
3. **Task 3: Create format unit + integration tests** -- `4277856` (test)

## Files Created/Modified

- `lib/format.js` -- 4 exports: writeJsonl (unchanged), formatTable (pure), writeTable (writer), defaultFormat (TTY gate)
- `lib/filter.js` -- buffer-then-render path for table mode; preserves O(1) streaming for json mode
- `lib/count.js` -- outputRows array + per-format dispatch; FMT-04 default switch
- `lib/histogram.js` -- outputRows array + per-format dispatch; FMT-04 default switch
- `test/format.test.js` -- 12 unit tests (95 lines)
- `test/format-tty.test.js` -- 13 integration tests via runCLI (162 lines)

## Decisions Made

- See key-decisions in frontmatter. All decisions match research locks; no improvisation.
- `formatTable([], cols)` and `formatTable(rows, [])` both return `''` (empty input -> empty output, preserves CLI-05).
- Filter help text now documents the table-mode O(matching rows) memory trade-off explicitly.

## Deviations from Plan

None -- plan executed exactly as written. All grep gates pass:
- `grep -q "formatTable" lib/format.js` -> present
- `grep -q "defaultFormat" lib/{filter,count,histogram}.js` -> all 3 present
- `! grep -q "table mode arrives in Phase 3" lib/` -> placeholder removed
- `grep -q "must be 'json' or 'table'" lib/{filter,count,histogram}.js` -> all 3 present
- No `*.jsonl` fixtures committed in `test/`

## Issues Encountered

None.

## Next Phase Readiness

- Phase 3 success criterion #1 ("any subcommand with --format table shows fixed-width column-aligned table; piped output has no ANSI") is observable.
- Plan 03-02 can build on the stable formatter; perf and dogfood tests are independent (no overlap with format.js).
- Ready for verification.

---
*Phase: 03-table-formatter-performance-dogfood*
*Completed: 2026-05-02*
