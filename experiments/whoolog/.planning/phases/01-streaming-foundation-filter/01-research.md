# Phase 1: Streaming Foundation + filter - Research

**Researched:** 2026-05-02
**Domain:** Streaming JSONL log aggregator CLI — Phase 1 foundations
**Confidence:** HIGH (delta-only file; project-level research is canonical and already cross-verified)

> **This is a delta file.** Project-level research is canonical and covers the broad domain. See:
>
> - `.planning/research/architecture.md` — system structure, async-generator pipeline, build order
> - `.planning/research/stack.md` — Node.js APIs, versions, library choices
> - `.planning/research/features.md` — feature landscape, MVP scope, dogfood queries
> - `.planning/research/pitfalls.md` — 26 enumerated pitfalls with phase mapping
>
> This file emits only Phase-1-specific specifics: which files Plan 01/02/03 touch, which pitfalls each plan must guard, the exact code idioms to drop into each module, and the test cases that gate each plan.

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions

**From idea.md (locked constraints):**
- Tech stack: Node.js >= 16 baseline, but `util.parseArgs` and `node:test` push the practical floor to **Node 18.3+ (20 LTS recommended)**. Zero runtime dependencies. Built-ins only: `fs`, `readline`, `path`, `node:util`, `node:test`, `node:assert/strict`, `node:child_process`.
- Streaming, never buffer: every reader is line-by-line via `readline.createInterface` with `crlfDelay: Infinity`. No `fs.readFileSync`, no `Array.from(stream)`, no full-file load.
- Cross-platform: path output uses forward slashes via a `toPosix()` helper. CRLF line endings on Windows are absorbed at the reader, not handled per-line.
- Malformed-line policy: warn on stderr `whoolog: skipping malformed line at <file>:<lineno>` and continue; `--strict` flips to fail-fast (exit 1).
- Output stability: errors → stderr; data → stdout; JSON shape stable across releases.
- Exit codes: 0 success (incl. empty results), 1 runtime error, 2 usage error.

**From research/architecture.md (locked architecture):**
- Pull-based async-generator pipeline: each stage is `async function*`; composition via `for await ... of`. No Transform streams, no event wiring.
- Module layout (Phase 1 set):
  - `bin/whoolog.js` — entrypoint, shebang, subcommand dispatch via `process.argv[2]` then `util.parseArgs(argv.slice(3))`
  - `lib/source.js` — multi-source reader (files, glob, stdin) → line iterator
  - `lib/decode.js` — JSON.parse with line-number tracking and malformed-line policy
  - `lib/resolve-key.js` — `compileKey(path)` returns a closure that walks dotted paths null-safely
  - `lib/where.js` — `compileWhere(expr)` returns a closure; lexer tries longer ops first (`>=`, `<=`, `!=`, `~`, `=`, `>`, `<`)
  - `lib/time-filter.js` — `--since`/`--until` predicate using the resolver against `--ts-field`
  - `lib/format.js` — JSONL writer (table mode is Phase 3)
  - `lib/filter.js` — `filter` subcommand: composes source → decode → where → time-filter → format
- Compile-once predicates: `compileWhere` and `compileKey` execute once at startup; closures run in the per-line hot loop.

**From requirements.md (37 REQs in scope):** CLI-01..05, SRC-01..06, DEC-01..03, KEY-01..04, WHR-01..07, TIM-01..04, FLT-01..02, FMT-01, FMT-04, FMT-05, TST-01..03. See `<phase_requirements>` table below for the verbatim mapping.

**From research/pitfalls.md (Phase-1-specific guards):**
- Pitfall 1 (readFileSync): mitigated by streaming-only reader; reviewed in Plan-01 plan-checker.
- Pitfalls 2-3 (last-line-no-newline, CRLF): `crlfDelay: Infinity` + `readline` last-line behavior verified by tests.
- Pitfalls 4-6 (Where DSL): longer-ops-first lexer; type-aware equality on `=`/`!=`; explicit numeric coercion contract on `>`/`<`/`>=`/`<=`.
- Pitfall 7 (null intermediate): resolver uses `obj?.[key]` throughout the path reducer.
- Pitfall 18 (EPIPE): `process.stdout.on('error', err => err.code === 'EPIPE' && process.exit(0))` at entry.
- Pitfall 20 (`--help` to stdout): validated by an integration test.
- Pitfall 23 (test fixture line endings): fixtures generated programmatically in tests, not committed as binary blobs.

### Claude's Discretion

- File-internal organization (helper function names, private helpers, comment density)
- Exact glob pattern-matching algorithm (`fs.readdir` walk vs version-gated `fs.promises.glob` for Node 22+) — recommendation: manual walk for portability
- Test fixture data shapes beyond what requirements call out
- Internal error message wording (only the documented `whoolog: skipping malformed line at …` is locked)
- How to organize tests across files (one per module vs one per behavior)

### Deferred Ideas (OUT OF SCOPE)

- `count` and `histogram` subcommands → Phase 2
- Time-bucket calculator → Phase 2
- `--format table` rendering → Phase 3
- 100 MB / 1 M-line perf gate test (TST-05) → Phase 3
- Dogfood gate against tokens.jsonl (DOG-01) → Phase 3
- Recursive `**` glob, ANSI color, follow-mode, `top`/`select`, OR/parens in `--where`, regex flags, multi-key group-by → v2

</user_constraints>

<phase_requirements>
## Phase Requirements (37 REQs, must all be covered by plans)

| ID | Description | Module / Plan |
|----|-------------|---------------|
| CLI-01 | `bin/whoolog.js` entrypoint with shebang, dispatches to subcommands | Plan 01 |
| CLI-02 | Argv parsing via `util.parseArgs`; `multiple: true` for `--where` | Plan 01 (entrypoint) + Plan 03 (filter subcommand args) |
| CLI-03 | `--help` / `-h` to stdout, exit 0; usage errors stderr exit 2 | Plan 01 (top-level) + Plan 03 (filter --help) |
| CLI-04 | EPIPE handler on `process.stdout` exits 0 cleanly | Plan 01 |
| CLI-05 | POSIX exit codes 0/1/2 | Plan 01 |
| SRC-01 | `readline.createInterface({ crlfDelay: Infinity })`; no full-file buffering | Plan 01 (source.js) |
| SRC-02 | Multiple `--files` arguments merge into one stream | Plan 01 (source.js) |
| SRC-03 | Built-in glob via `fs.readdir`; supports `*.jsonl` (no recursive `**`) | Plan 01 (source.js) |
| SRC-04 | Read from stdin when no `--files` and stdin is not TTY | Plan 01 (source.js) |
| SRC-05 | Print help and exit 0 when no input source and stdin is TTY | Plan 01 (entrypoint or filter dispatch) |
| SRC-06 | Streams 100 MB / 1 M-line without OOM (pattern only; perf gate Phase 3) | Plan 01 (source.js streaming pattern) |
| DEC-01 | Each line `JSON.parse`'d; line numbers tracked per file | Plan 01 (decode.js) |
| DEC-02 | Malformed-line warn on stderr, continue | Plan 01 (decode.js) |
| DEC-03 | `--strict` flag: malformed line exits 1 with same format | Plan 01 (decode.js) + Plan 03 (filter wires --strict) |
| KEY-01 | `compileKey(path)` walks `a.b.c` null-safely returns undefined | Plan 02 (resolve-key.js) |
| KEY-02 | Path compiled once; closure reused per row | Plan 02 (resolve-key.js) |
| KEY-03 | Object key with literal `.` not specially escaped (documented) | Plan 02 (resolve-key.js docs) |
| KEY-04 | Array indexing (`arr[0]`) explicitly NOT supported in v1 | Plan 02 (resolve-key.js docs) |
| WHR-01 | Operators `=`, `!=`, `~`, `>=`, `<=`, `>`, `<`; longer-first lexer | Plan 02 (where.js) |
| WHR-02 | Multiple `--where` AND-ed | Plan 02 (where.js) + Plan 03 (filter wiring) |
| WHR-03 | Field reference uses nested-key resolver | Plan 02 (where.js) |
| WHR-04 | Numeric ops coerce to Number; non-numeric → no match | Plan 02 (where.js) |
| WHR-05 | `~` is JS regex (case-sensitive, no flags) | Plan 02 (where.js) |
| WHR-06 | `=`/`!=` use type-aware equality | Plan 02 (where.js) |
| WHR-07 | Predicate compiled once; closure reused per row | Plan 02 (where.js) |
| TIM-01 | `--since`/`--until` filter rows by `--ts-field` (default `ts`) | Plan 02 (time-filter.js) |
| TIM-02 | Boundary semantics: `--since` ≥, `--until` < | Plan 02 (time-filter.js) |
| TIM-03 | Date-only inputs UTC midnight; ISO without `Z` rejected | Plan 02 (time-filter.js) |
| TIM-04 | Missing-ts dropped by default; `--keep-missing-ts`/`--ts-required` overrides | Plan 02 (time-filter.js) |
| FLT-01 | `filter` streams matching rows to stdout (O(1) memory) | Plan 03 (filter.js) |
| FLT-02 | Default JSONL output (one row per line, original JSON re-serialized) | Plan 03 (filter.js + format.js) |
| FMT-01 | `--format json` emits one JSON per line (default when stdout not TTY) | Plan 03 (format.js) |
| FMT-04 | `--format` defaults to `json` when stdout is not TTY (table fallback for TTY is Phase 3) | Plan 03 (format.js / filter.js) |
| FMT-05 | `toPosix()` helper for path normalization in error messages | Plan 01 (source.js or shared helper) |
| TST-01 | `node:test` + `node:assert/strict`; runnable via `node --test tests/` | Plan 03 (test setup) |
| TST-02 | Integration tests via `child_process.spawnSync(process.execPath, ...)` with `input:` for stdin | Plan 03 (tests) |
| TST-03 | ≥10 tests covering listed scenarios | Plan 03 (tests) |

**Coverage check:** every REQ ID maps to at least one plan. Plan 01 = 11 REQs (CLI + SRC + DEC + FMT-05). Plan 02 = 16 REQs (KEY + WHR + TIM). Plan 03 = 10 REQs (FLT + FMT-01,04 + TST + cross-cutting --strict/--where wiring). Some REQs span plans (CLI-02, CLI-03, DEC-03, WHR-02) where the implementation is in one plan but the wiring/CLI flag is in another.

</phase_requirements>

## Phase-Specific Specifics

### Plan 01 module shapes

**`bin/whoolog.js`** (entrypoint):

```js
#!/usr/bin/env node
'use strict';

// EPIPE handler MUST be first thing — before any I/O attempts (Pitfall 17)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const SUB = process.argv[2];
if (SUB === '--help' || SUB === '-h' || SUB === undefined) {
  printTopLevelHelp(); // writes to stdout, exit 0
  process.exit(0);
}

// Dispatch — only `filter` is wired in Phase 1; count/histogram are Phase 2/3
switch (SUB) {
  case 'filter':
    require('../lib/filter').run(process.argv.slice(3));
    break;
  default:
    process.stderr.write(`whoolog: unknown subcommand: ${SUB}\n`);
    process.exit(2);
}
```

**`lib/source.js`** (multi-source reader):

```js
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function toPosix(p) { return p.split('\\').join('/'); }

// Expand a single glob pattern (no `**`, only `*` within one segment)
async function* expandGlob(pattern) {
  // If no `*` → literal file path
  if (!pattern.includes('*')) { yield pattern; return; }
  const dir = path.dirname(pattern) || '.';
  const base = path.basename(pattern);
  // Convert `*.jsonl` → /^[^/\\]*\.jsonl$/
  const re = new RegExp('^' + base.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/\\\\]*') + '$');
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    process.stderr.write(`whoolog: cannot read directory ${toPosix(dir)}: ${err.message}\n`);
    process.exit(1);
  }
  for (const ent of entries) {
    if (ent.isFile() && re.test(ent.name)) yield path.join(dir, ent.name);
  }
}

// Main entry: yields { stream, label } for each input source (file or stdin)
async function* sources({ files }) {
  if (files && files.length > 0) {
    for (const pat of files) {
      for await (const file of expandGlob(pat)) {
        // Verify file exists with stat (Pitfall 24)
        try {
          await fs.promises.stat(file);
        } catch {
          process.stderr.write(`whoolog: file not found: ${toPosix(file)}\n`);
          process.exit(1);
        }
        yield { stream: fs.createReadStream(file), label: toPosix(file) };
      }
    }
    return;
  }
  // No --files → stdin (when piped)
  if (!process.stdin.isTTY) {
    yield { stream: process.stdin, label: '<stdin>' };
    return;
  }
  // No --files AND stdin is TTY → caller decides (filter prints help)
}

// Per-source line iterator. crlfDelay: Infinity is mandatory (Pitfall 3).
async function* lines(source) {
  const rl = readline.createInterface({ input: source.stream, crlfDelay: Infinity });
  let lineno = 0;
  for await (const line of rl) {
    lineno++;
    yield { line, lineno, file: source.label };
  }
}

module.exports = { sources, lines, toPosix, expandGlob };
```

**`lib/decode.js`** (JSON parsing with malformed-line policy):

```js
async function* decode(linesIter, opts = {}) {
  for await (const { line, lineno, file } of linesIter) {
    if (line.trim() === '') continue; // skip blank lines silently
    try {
      yield { obj: JSON.parse(line), file, lineno };
    } catch (err) {
      const msg = `whoolog: ${opts.strict ? 'malformed' : 'skipping malformed'} line at ${file}:${lineno}\n`;
      process.stderr.write(msg);
      if (opts.strict) process.exit(1);
      // else: continue
    }
  }
}

module.exports = { decode };
```

### Plan 02 module shapes

**`lib/resolve-key.js`** (compile-once nested-key resolver):

```js
function compileKey(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`compileKey: path must be a non-empty string, got: ${JSON.stringify(path)}`);
  }
  const segments = path.split('.');
  return function resolve(obj) {
    let cur = obj;
    for (const seg of segments) {
      if (cur == null) return undefined; // Pitfall 14: null intermediate
      cur = cur[seg];
    }
    return cur;
  };
}

module.exports = { compileKey };
```

**`lib/where.js`** (compile-once predicate):

```js
const { compileKey } = require('./resolve-key');

// Operator order: longer first (Pitfall 6)
const OPS = ['>=', '<=', '!=', '~', '=', '>', '<'];

function lex(expr) {
  if (typeof expr !== 'string' || expr.trim() === '') {
    const e = new Error('--where value cannot be empty');
    e.usage = true; throw e;
  }
  for (const op of OPS) {
    const idx = expr.indexOf(op);
    if (idx > 0) {
      return {
        field: expr.slice(0, idx).trim(),
        op,
        value: expr.slice(idx + op.length), // do NOT trim — values may have meaningful whitespace
      };
    }
  }
  const e = new Error(`--where: no operator found in expression: ${expr}`);
  e.usage = true; throw e;
}

function compileWhere(expr) {
  const { field, op, value } = lex(expr);
  const getField = compileKey(field);
  // Compile RHS by operator
  if (op === '~') {
    let re;
    try { re = new RegExp(value); }
    catch (err) {
      const e = new Error(`--where: invalid regex /${value}/: ${err.message}`);
      e.usage = true; throw e;
    }
    return (obj) => { const v = getField(obj); return typeof v === 'string' && re.test(v); };
  }
  if (op === '>' || op === '<' || op === '>=' || op === '<=') {
    const rhs = Number(value);
    if (Number.isNaN(rhs)) {
      const e = new Error(`--where: numeric operator ${op} requires numeric RHS, got: ${value}`);
      e.usage = true; throw e;
    }
    return (obj) => {
      const v = getField(obj);
      const lhs = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(lhs)) return false; // WHR-04: non-numeric → no match
      switch (op) {
        case '>': return lhs > rhs;
        case '<': return lhs < rhs;
        case '>=': return lhs >= rhs;
        case '<=': return lhs <= rhs;
      }
    };
  }
  // = and != → type-aware (WHR-06)
  // Strategy: compare JSON.stringify of both sides — naturally type-aware
  // (number 5 stringifies as "5"; string "5" stringifies as "\"5\"" → never equal)
  return (obj) => {
    const v = getField(obj);
    const eq = JSON.stringify(v) === JSON.stringify(parseRhs(value));
    return op === '=' ? eq : !eq;
  };
}

// Type the RHS at compile time: bare digits → Number, "quoted" → string, true/false/null → literal
function parseRhs(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  // Numeric literal: matches /^-?\d+(\.\d+)?$/
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  // Otherwise plain string
  return raw;
}

module.exports = { compileWhere, lex, parseRhs };
```

**`lib/time-filter.js`** (--since/--until predicate):

```js
const { compileKey } = require('./resolve-key');

function parseTimeBoundary(str) {
  if (typeof str !== 'string' || str.length === 0) {
    const e = new Error(`time boundary cannot be empty`); e.usage = true; throw e;
  }
  // date-only: YYYY-MM-DD → UTC midnight (JS already does this)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) {
      const e = new Error(`invalid date: ${str}`); e.usage = true; throw e;
    }
    return d.getTime();
  }
  // ISO datetime without Z → REJECT (TIM-03)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str)) {
    const e = new Error(`datetime ${str} missing Z suffix; use ${str}Z or a timezone offset`);
    e.usage = true; throw e;
  }
  // Full ISO with Z or offset
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) {
    const e = new Error(`invalid timestamp: ${str}`); e.usage = true; throw e;
  }
  return d.getTime();
}

function compileTimeFilter({ since, until, tsField, keepMissing, required }) {
  const getTs = compileKey(tsField || 'ts');
  const sinceMs = since != null ? parseTimeBoundary(since) : null;
  const untilMs = until != null ? parseTimeBoundary(until) : null;
  const hasBound = sinceMs != null || untilMs != null;
  return function timeFilter(obj) {
    const raw = getTs(obj);
    if (raw === undefined || raw === null) {
      if (required) {
        process.stderr.write(`whoolog: row missing ts field (--ts-required)\n`);
        process.exit(1);
      }
      return keepMissing === true; // default false (drop)
    }
    if (!hasBound) return true;
    const ms = typeof raw === 'number' ? raw : new Date(raw).getTime();
    if (Number.isNaN(ms)) return keepMissing === true;
    if (sinceMs != null && ms < sinceMs) return false;   // since inclusive (>=)
    if (untilMs != null && ms >= untilMs) return false;  // until exclusive (<)
    return true;
  };
}

module.exports = { compileTimeFilter, parseTimeBoundary };
```

### Plan 03 module shapes

**`lib/format.js`** (JSONL writer — Phase 3 adds table mode):

```js
function writeJsonl(obj) {
  // Re-stringify the parsed object — preserves shape across releases (FLT-02, FMT-01)
  const ok = process.stdout.write(JSON.stringify(obj) + '\n');
  if (!ok) {
    // Backpressure — caller may want to await drain. For MVP, accept best-effort.
  }
}

module.exports = { writeJsonl };
```

**`lib/filter.js`** (filter subcommand):

```js
const { parseArgs } = require('node:util');
const { sources, lines } = require('./source');
const { decode } = require('./decode');
const { compileWhere } = require('./where');
const { compileTimeFilter } = require('./time-filter');
const { writeJsonl } = require('./format');

const FILTER_OPTIONS = {
  files: { type: 'string', multiple: true },
  where: { type: 'string', multiple: true },
  since: { type: 'string' },
  until: { type: 'string' },
  'ts-field': { type: 'string' },
  'keep-missing-ts': { type: 'boolean' },
  'ts-required': { type: 'boolean' },
  strict: { type: 'boolean' },
  format: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

async function run(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: FILTER_OPTIONS, allowPositionals: false }));
  } catch (err) {
    process.stderr.write(`whoolog: ${err.message}\n`);
    process.exit(2);
  }
  if (values.help) { printFilterHelp(); process.exit(0); }
  if ((!values.files || values.files.length === 0) && process.stdin.isTTY) {
    printFilterHelp(); process.exit(0); // SRC-05
  }
  // Compile predicates ONCE (WHR-07, KEY-02)
  let predicates, timePred;
  try {
    predicates = (values.where || []).map(compileWhere);
    timePred = compileTimeFilter({
      since: values.since,
      until: values.until,
      tsField: values['ts-field'],
      keepMissing: values['keep-missing-ts'],
      required: values['ts-required'],
    });
  } catch (err) {
    process.stderr.write(`whoolog: ${err.message}\n`);
    process.exit(err.usage ? 2 : 1);
  }
  const passes = (obj) => predicates.every(p => p(obj)) && timePred(obj);
  // Stream
  for await (const source of sources({ files: values.files })) {
    for await (const decoded of decode(lines(source), { strict: values.strict })) {
      if (passes(decoded.obj)) writeJsonl(decoded.obj);
    }
  }
}

module.exports = { run };
```

### Tests (Plan 03)

The full test set (≥10 tests for TST-03, layered across unit + integration):

| # | Test | File | Type | Verifies |
|---|------|------|------|----------|
| 1 | exact match `level=error` | `test/filter.test.js` | integration | SC-1, FLT-01, WHR-06 |
| 2 | nested key numeric `usage.input_tokens>1000` | `test/filter.test.js` | integration | SC-2, KEY-01, WHR-04 |
| 3 | regex match `msg~timeout` | `test/filter.test.js` | integration | WHR-05 |
| 4 | multiple --where AND-ed | `test/filter.test.js` | integration | SC-3, WHR-02 |
| 5 | --since / --until date-only UTC | `test/filter.test.js` | integration | SC-4, TIM-01..03 |
| 6 | --since rejects ISO without Z | `test/filter.test.js` | integration | TIM-03 (usage error path) |
| 7 | stdin input when no --files | `test/filter.test.js` | integration | SRC-04 |
| 8 | multi-file glob merge | `test/filter.test.js` | integration | SRC-02, SRC-03 |
| 9 | malformed line skip-with-warn | `test/decode.test.js` + integration | integration | DEC-02 |
| 10 | --strict on malformed exits 1 with file:lineno | `test/filter.test.js` | integration | DEC-03 |
| 11 | empty input exits 0 | `test/filter.test.js` | integration | CLI-05 |
| 12 | --help to stdout, no stderr, exit 0 | `test/filter.test.js` | integration | CLI-03, Pitfall 19 |
| 13 | EPIPE → exit 0 (pipe to `head -1`) | `test/filter.test.js` | integration | CLI-04, Pitfall 17 |
| 14 | non-existent file → exit 1 with path in message | `test/filter.test.js` | integration | Pitfall 24 |
| 15 | empty `--where ""` → exit 2 | `test/filter.test.js` | integration | Pitfall 26 |
| 16 | last-line without trailing newline | `test/decode.test.js` | unit | Pitfall 2 |
| 17 | CRLF line endings | `test/decode.test.js` | unit | Pitfall 3 |
| 18 | resolve-key null intermediate | `test/resolve-key.test.js` | unit | KEY-01, Pitfall 14 |
| 19 | where lexer `>=` vs `>` | `test/where.test.js` | unit | WHR-01, Pitfall 6 |
| 20 | where `=` type-aware (`"5"` ≠ `5`) | `test/where.test.js` | unit | WHR-06, Pitfall 7 |

20 tests; well above the TST-03 floor of 10. Layered: 6 unit (resolve-key, where, decode pure logic) + 14 integration (spawnSync against bin/whoolog.js).

### Test-fixture programmatic generation

Per Pitfall 23, fixtures are generated in `before` hooks, not committed:

```js
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let tmpdir;
before(() => { tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'whoolog-')); });
after(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

function writeFixture(name, lines) {
  const file = path.join(tmpdir, name);
  fs.writeFileSync(file, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  return file;
}
```

Fixture content for SC-4 (date-only UTC midnight):

```js
const file = writeFixture('app.jsonl', [
  JSON.stringify({ ts: '2026-03-31T23:59:59.000Z', level: 'info', msg: 'before' }),
  JSON.stringify({ ts: '2026-04-01T00:00:00.000Z', level: 'info', msg: 'on-since' }),
  JSON.stringify({ ts: '2026-04-15T12:00:00.000Z', level: 'info', msg: 'middle' }),
  JSON.stringify({ ts: '2026-05-01T00:00:00.000Z', level: 'info', msg: 'on-until' }),
]);
// --since 2026-04-01 --until 2026-05-01 should yield 2 rows: on-since + middle
//   (until is exclusive — on-until is dropped; before is dropped; on-since is kept)
```

### `runCLI` test helper (Pitfall 23)

Centralized spawn helper with kill-timeout:

```js
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'whoolog.js');

function runCLI(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    timeout: 5000, // SIGKILL after 5s — prevents zombie processes
    ...opts,
  });
}

module.exports = { runCLI, BIN };
```

### EPIPE test pattern (Pitfall 17)

```js
const { spawn } = require('node:child_process');

test('filter handles EPIPE when downstream closes', async () => {
  const file = writeFixture('big.jsonl', Array(1000).fill(JSON.stringify({ x: 1 })));
  const child = spawn(process.execPath, [BIN, 'filter', '--files', file]);
  // Read 1 line then close stdin of the consumer (us)
  let firstLine = '';
  await new Promise((resolve) => {
    child.stdout.once('data', (chunk) => {
      firstLine = chunk.toString().split('\n')[0];
      child.stdout.destroy();
      resolve();
    });
  });
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, 'EPIPE should produce clean exit 0');
  assert.match(firstLine, /"x":1/);
});
```

## Anti-Patterns Specific to Phase 1

(All sourced from research/pitfalls.md; called out here as Plan-01-blocking.)

1. **Reading the whole file into memory** — any `fs.readFileSync` in `lib/source.js` or `lib/decode.js` fails the streaming contract. The plan-checker MUST verify this on a Plan-01 commit grep.
2. **Re-parsing the where expression per row** — `expr.split('=')` inside the hot loop. Plans must show `compileWhere` returning a closure called from the loop.
3. **`.split('=')` for value parsing** — breaks on `--where "url=https://a.com?x=1"`. Use the longer-first operator scan via `expr.indexOf(op)`.
4. **Mutable shared state across the per-line loop** — keep accumulators inside the function, not module-level (a future Phase 2 trap when refactoring; flag now to prevent).
5. **Buffering filter output before flushing** — `process.stdout.write` per row, not `console.log` of an accumulated array.

## Validation Architecture

**SKIPPED** — `workflow.nyquist_validation` is not enabled in `.planning/config.json`. Standard `<verify>` blocks with bash commands suffice.

## Sources

This is a delta file; primary sources are in project-level research:

- `.planning/research/architecture.md` (system structure, build order, async-generator pipeline, dependency graph)
- `.planning/research/stack.md` (Node 18.3+, util.parseArgs, readline, node:test, time parsing UTC trap)
- `.planning/research/features.md` (table-stakes features, MVP scope, dogfood queries)
- `.planning/research/pitfalls.md` (26 enumerated pitfalls; Phase 1 owns Pitfalls 1–9, 12, 17–24, 26)

Phase-specific verification:

- Pitfalls 10, 11, 13–16 belong to later phases (10/11 = histogram boundaries Plan 02-bucket; 13/14/15 = nested-key full coverage Plan 02-resolve-key but minimum-viable in Plan 02 of this phase; 16 = ANSI color in pipe Phase 3 table mode)

---

*Research delta for: Phase 1 — Streaming Foundation + filter*
*Researched: 2026-05-02*
*Confidence: HIGH (project-level research is authoritative; this file is a Phase-1-scoped index of file paths, code idioms, test cases, and pitfall mappings)*
