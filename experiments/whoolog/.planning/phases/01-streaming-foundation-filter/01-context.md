# Phase 1: Streaming Foundation + filter - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning
**Source:** Auto-mode synthesis (P-1803, v3.7.8) — derived from idea.md + project.md + requirements.md without user dialogue

<domain>
## Phase Boundary

**Goal:** Users can stream-filter a JSONL log with field predicates, time ranges, and multi-source input — all in one command with no dependencies.

This phase builds the entire streaming foundation that Phase 2 (count + histogram) and Phase 3 (table + perf + dogfood) reuse without modification: CLI dispatch, source reader, line decoder, nested-key resolver, where-DSL parser/evaluator, time filter, JSONL formatter, and the `filter` subcommand. Aggregation, table rendering, and the perf gate are explicitly out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### From idea.md (locked constraints)

- **Tech stack:** Node.js >= 16 baseline, but `util.parseArgs` and `node:test` push the practical floor to **Node 18.3+ (20 LTS recommended)**. Zero runtime dependencies. Built-ins only: `fs`, `readline`, `path`, `node:util`, `node:test`, `node:assert/strict`, `node:child_process`.
- **Streaming, never buffer:** every reader is line-by-line via `readline.createInterface` with `crlfDelay: Infinity`. No `fs.readFileSync`, no `Array.from(stream)`, no full-file load.
- **Cross-platform:** path output uses forward slashes via a `toPosix()` helper (PAN convention). CRLF line endings on Windows are absorbed at the reader, not handled per-line.
- **Malformed-line policy:** warn on stderr `whoolog: skipping malformed line at <file>:<lineno>` and continue; `--strict` flips to fail-fast (exit 1).
- **Output stability:** errors → stderr; data → stdout; JSON shape stable across releases.
- **Exit codes:** 0 success (incl. empty results), 1 runtime error, 2 usage error.

### From research/architecture.md (locked architecture)

- **Pull-based async-generator pipeline:** each stage is `async function*`; composition via `for await ... of`. No Transform streams, no event wiring.
- **Module layout** (Phase 1 set):
  - `bin/whoolog.js` — entrypoint, shebang, subcommand dispatch via `process.argv[2]` then `util.parseArgs(argv.slice(3))`
  - `lib/source.js` — multi-source reader (files, glob, stdin) → line iterator
  - `lib/decode.js` — JSON.parse with line-number tracking and malformed-line policy
  - `lib/resolve-key.js` — `compileKey(path)` returns a closure that walks dotted paths null-safely
  - `lib/where.js` — `compileWhere(expr)` returns a closure; lexer tries longer ops first (`>=`, `<=`, `!=`, `~`, `=`, `>`, `<`)
  - `lib/time-filter.js` — `--since`/`--until` predicate using the resolver against `--ts-field`
  - `lib/format.js` — JSONL writer (table mode is Phase 3)
  - `lib/filter.js` — `filter` subcommand: composes source → decode → where → time-filter → format
- **Compile-once predicates:** `compileWhere` and `compileKey` execute once at startup; closures run in the per-line hot loop.

### From requirements.md (locked behaviors — 37 REQs in scope)

- **CLI-01..05** — entrypoint, `util.parseArgs` with `multiple: true` for `--where`, `--help` to stdout, EPIPE handler exits 0, POSIX exit codes.
- **SRC-01..06** — `readline.createInterface({ crlfDelay: Infinity })`; `--files` accepts multiple values; built-in glob via `fs.readdir` (recursive `**` is v2); stdin when piped; help-on-empty-TTY; 100 MB / 1 M-line streaming budget (perf gate is Phase 3, but the streaming pattern is enforced here).
- **DEC-01..03** — `JSON.parse` per line, line numbers tracked per file, skip-with-warn default, `--strict` for fail-fast.
- **KEY-01..04** — null-safe nested-key resolver; compile-once; literal-`.`-in-key not specially escaped (documented limitation); array indexing (`arr[0]`) is undefined behavior in v1.
- **WHR-01..07** — operators `=`, `!=`, `~`, `>=`, `<=`, `>`, `<`; multiple `--where` AND-ed; nested-field references work; numeric ops coerce to Number with non-numeric → no match; `~` is JS regex (case-sensitive, no flag syntax v1); `=`/`!=` use type-aware equality (string vs number never silently match); `compileWhere` once.
- **TIM-01..04** — `--ts-field` configurable (default `ts`); `--since` inclusive, `--until` exclusive; date-only (`YYYY-MM-DD`) parses as UTC midnight; bare datetimes without `Z` are rejected (usage error 2); missing-ts rows dropped by default with `--keep-missing-ts` and `--ts-required` overrides.
- **FLT-01..02** — `filter` streams O(1) memory; default output is JSONL with the original parsed JSON re-stringified.
- **FMT-01, FMT-04, FMT-05** — JSONL output (one row per line), `--format` defaults to `json` when stdout is not a TTY, `toPosix()` helper for path normalization in error messages.
- **TST-01..03** — `node:test` + `node:assert/strict`; integration tests via `child_process.spawnSync(process.execPath, [...])` with `input:` for stdin; ≥10 tests covering filter exact-match, regex, numeric comparison, multi-where AND, nested-key in `--where`, stdin, multi-file merge, malformed-line skip and `--strict`, empty input.

### From research/pitfalls.md (Phase-1-specific guards)

- **Pitfall 1 (readFileSync):** mitigated by streaming-only reader; reviewed in Plan-01 plan-checker.
- **Pitfalls 2-3 (last-line-no-newline, CRLF):** `crlfDelay: Infinity` + `readline` last-line behavior verified by tests.
- **Pitfalls 4-6 (Where DSL):** longer-ops-first lexer; type-aware equality on `=`/`!=`; explicit numeric coercion contract on `>`/`<`/`>=`/`<=`.
- **Pitfall 7 (null intermediate):** resolver uses `obj?.[key]` throughout the path reducer.
- **Pitfall 18 (EPIPE):** `process.stdout.on('error', err => err.code === 'EPIPE' && process.exit(0))` at entry.
- **Pitfall 20 (`--help` to stdout):** validated by an integration test that runs `whoolog --help` and asserts stdout is non-empty / stderr is empty.
- **Pitfall 23 (test fixture line endings):** fixtures generated programmatically in tests, not committed as binary blobs.

### Claude's Discretion

- File-internal organization (helper function names, private helpers, comment density)
- Exact glob pattern-matching algorithm (`fs.readdir` walk vs version-gated `fs.promises.glob` for Node 22+)
- Test fixture data shapes beyond what requirements call out
- Internal error message wording (only the documented `whoolog: skipping malformed line at …` is locked)
- How to organize tests across files (one per module vs one per behavior — planner picks)

</decisions>

<specifics>
## Specific References

- **`pan-wizard-core/bin/lib/cost.cjs`** — streaming reader for `tokens.jsonl`, same shape as `lib/source.js`
- **`pan-wizard-core/bin/lib/optimize.cjs`** — line-by-line filter for `trace.jsonl`, structurally similar to `lib/decode.js` + `lib/filter.js`
- **`whooo` linter** — same project shape (zero deps, Node built-ins, file walking + per-line analysis + multi-format output) — copy patterns where they fit
- **angle-grinder (`agrind`)** — confirms the operator set `=`, `!=`, `~`, `>`, `<`, `>=`, `<=` is the right one to ship
- **`util.parseArgs` Node docs** — `multiple: true` semantics for repeated flags is the canonical pattern for `--where`

## Specific behaviors

- `--help` printed by the entrypoint must list all subcommands and the `--where`, `--since`, `--until`, `--ts-field`, `--keep-missing-ts`, `--ts-required`, `--strict`, `--format`, `--files` flags with one-line descriptions.
- The `--help` body explicitly documents:
  - operator set and lexing order
  - bucket-edge semantics (deferred to Phase 2 in `histogram --help`, but `filter --help` notes that `--since` is inclusive, `--until` exclusive)
  - missing-ts behavior (default drop, `--keep-missing-ts`, `--ts-required`)
  - malformed-line behavior (default warn-and-skip, `--strict` fail-fast)

</specifics>

<deferred>
## Deferred Ideas

None — Phase 1 honors the original idea.md scope. The following stay parked in their assigned phases:

- `count` and `histogram` subcommands → Phase 2
- Time-bucket calculator → Phase 2
- `--format table` rendering → Phase 3
- 100 MB / 1 M-line perf gate test (`TST-05`) → Phase 3
- Dogfood gate against `tokens.jsonl` (`DOG-01`) → Phase 3
- Recursive `**` glob, ANSI color, follow-mode, `top`/`select`, OR/parens in `--where`, regex flags, multi-key group-by → v2 (per requirements.md "v2 Requirements")

</deferred>

---

*Phase: 01-streaming-foundation-filter*
*Context auto-synthesized: 2026-05-02 via discuss-phase P-1803 bypass — no user dialogue*
