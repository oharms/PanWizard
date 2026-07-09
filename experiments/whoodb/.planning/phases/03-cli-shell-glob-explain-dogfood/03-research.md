# Phase 3: CLI Shell + Glob + Explain + Dogfood - Research

**Researched:** 2026-05-02
**Domain:** Node.js CLI wiring, glob expansion, explain printer, table formatter, EPIPE, dogfood validation
**Confidence:** HIGH — all builtins verified in the running Node 24 environment; key behaviors confirmed with live code tests

> **No `context.md` exists for Phase 3.** Auto-mode synthesis applies.
>
> **Project-level research is the source of truth for stack choices, zero-deps constraint, and broad patterns.** This file emits Phase-3-specific deltas only:
> - `.planning/research/stack.md` — chosen builtins, versions, patterns (do not re-derive)
> - `.planning/research/architecture.md` — system structure and component table (do not re-derive)
> - `.planning/research/features.md` — v1 feature set and anti-features (do not re-derive)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRC-01 | FROM accepts a single JSONL file path | `plan.scan.source` (set by parser/analyzer) is passed to `from-resolver.js`; if no glob characters, resolves to single file path → passes to evaluator |
| SRC-02 | FROM accepts a glob pattern expanding to multiple files | `fs.promises.glob` (async iterator, Node 22+) expands the pattern; `src/from-resolver.js` returns `string[]`; evaluator loops over files |
| SRC-03 | Glob handles backslash and forward-slash on Windows | Verified live: `fs.promises.glob` returns Windows backslash paths on win32; normalize with `path.sep` join/split or `.replaceAll(path.sep, '/')` — see Code Examples below |
| CLI-01 | `whoodb query "<sql>"` runs the query | `bin/whoodb.js` (shebang entry) dispatches to `src/cli.js`; `util.parseArgs` extracts subcommand + SQL string |
| CLI-02 | Default output is JSONL (one result row per line) | `src/formatter.js` new module; JSONL path: `JSON.stringify(row) + '\n'` per row; called from `cli.js` result loop |
| CLI-03 | `--format table` produces fixed-width text output | `src/formatter.js` table path: compute max column widths, `String.padEnd`; `util.styleText` for bold headers — see Code Examples |
| CLI-04 | `--explain` prints AST + execution plan, exits 0 | `src/explain.js` new module; receives AST + ExecutionPlan; prints to stdout; cli.js calls it BEFORE `from-resolver.js` so no file I/O happens |
| CLI-05 | Exit code 0 success, non-zero on parse error, distinct code for IO error | `process.exitCode = 0/1/2` from `cli.js`; ParseError/LexError → exit 1; I/O errors → exit 2 (see Architecture Patterns) |
| CLI-06 | EPIPE from downstream pipe exits cleanly with code 0 | `process.stdout.on('error', ...)` handler installed at startup; `err.code === 'EPIPE'` → `process.exit(0)` — verified live |
| TEST-01 | Test suite ≥15 tests covering all required cases | Phase 3 adds `test/cli.test.js` and `test/from-resolver.test.js`; combined suite target: 130 (Phase 2) + ~30 new = 160+ |
| TEST-02 | Tests run via `node --test` without external deps | Existing infra: `node --test test/*.js` — unchanged; new tests use same pattern |
| TEST-03 | Dogfood query returns plausible aggregate output against `.planning/metrics/tokens.jsonl` | CRITICAL: field shape mismatch — see Open Question 1 below; tokens.jsonl uses flat `output_tokens`, query uses `usage.output_tokens` |
| TEST-04 | `--explain` output for non-trivial query shows reasonable execution plan | `src/explain.js` produces indented text representation of AST + plan stages |
| PERF-01 | WHERE-only query on ~100MB JSONL in under 15 seconds | Phase 1/2 streaming path already built; `from-resolver.js` must NOT buffer all files before streaming |
| PERF-02 | GROUP BY over 100K rows in under 5 seconds | Phase 2 accumulator already built; performance is in the evaluator, not the CLI layer |
</phase_requirements>

---

## Summary

Phase 3 is the wiring phase. All evaluation logic (lexer, parser, analyzer, evaluator, accumulator, sort, project) was shipped in Phases 1 and 2. Phase 3's job is to add three thin new modules (`src/from-resolver.js`, `src/explain.js`, `src/formatter.js`), one entry point (`src/cli.js` + `bin/whoodb.js`), and wire them together correctly. The hard parts are (1) the evaluator currently accepts a single `filePath` string — Phase 3 must extend it to accept `string[]` for glob multi-file support, and (2) the existing `tokens.jsonl` has `output_tokens` at the top level, not nested under `usage`, so the dogfood query will produce null results unless the file is augmented or the query is adjusted.

Key constraint: **zero runtime dependencies**. Every Phase 3 component uses only Node 22+ builtins: `util.parseArgs` for CLI args, `fs.promises.glob` (async iterator) for glob expansion, `util.styleText` for table headers, `node:path` for cross-platform normalization, and `process.stdout.on('error')` for EPIPE.

**Primary recommendation:** Build Phase 3 as four plans: (1) `src/from-resolver.js` + evaluator multi-file extension, (2) `src/explain.js` + `src/formatter.js`, (3) `src/cli.js` + `bin/whoodb.js` + `package.json` bin entry, (4) dogfood + perf validation + `test/cli.test.js` integration.

---

## Standard Stack

All builtins — no new npm dependencies. This section references `stack.md` and documents only Phase-3-specific usage.

### Core (Phase 3 builtins)

| Builtin | Version Floor | Purpose | Verified |
|---------|--------------|---------|---------|
| `util.parseArgs` | Node 20 (stable) | CLI arg parsing — subcommand + --explain + --format | YES — live test confirms positionals[0]=subcommand, positionals[1]=SQL |
| `fs.promises.glob` | Node 22.17.0 (stable) | Glob expansion — returns async iterator of matched paths | YES — returns backslash paths on Windows |
| `node:path` (`path.sep`, `path.resolve`, `path.join`) | all LTS | Cross-platform path normalization | YES |
| `util.styleText` | Node 22.13.0 (stable) | Table header bold/underline; NO_COLOR respected automatically | YES — live test confirms availability on Node 24 |
| `process.stdout.on('error', ...)` | all LTS | EPIPE handler — exits cleanly when pipe breaks | YES — verified pattern works |
| `node:test` + `node:assert/strict` | Node 20 (stable) | Test framework (unchanged from Phases 1+2) | YES |

### What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `commander`, `yargs`, `minimist`, `meow` | Runtime dependencies — violates zero-deps constraint | `util.parseArgs` |
| `glob`, `fast-glob`, `picomatch` | Runtime dependencies | `fs.promises.glob` |
| `chalk`, `kleur`, `picocolors` | Runtime dependencies | `util.styleText` |
| `console.table()` | Non-configurable formatting, not stable across Node versions | Manual `padEnd`/`padStart` |

**No `npm install` needed for Phase 3.** Node version already ≥ 22.17.0 (confirmed: running 24.15.0).

---

## Architecture Patterns

### Phase 3 Module Layout (new files in bold)

```
whoodb/
├── src/
│   ├── lexer.js          ← Phase 1 (unchanged)
│   ├── parser.js         ← Phase 1 (unchanged)
│   ├── ast.js            ← Phase 1+2 (unchanged)
│   ├── analyze.js        ← Phase 1+2 (unchanged)
│   ├── where.js          ← Phase 1 (unchanged)
│   ├── project.js        ← Phase 1+2 (unchanged)
│   ├── accumulator.js    ← Phase 2 (unchanged)
│   ├── sort.js           ← Phase 2 (unchanged)
│   ├── evaluator.js      ← Phase 1+2 — EXTEND: accept string[] for filePath
│   ├── from-resolver.js  ← NEW Phase 3 — glob expansion + path normalization
│   ├── explain.js        ← NEW Phase 3 — AST + plan pretty-printer
│   ├── formatter.js      ← NEW Phase 3 — JSONL and table output
│   └── cli.js            ← NEW Phase 3 — arg parsing, wiring, exit codes
├── test/
│   ├── (existing Phase 1+2 tests — untouched)
│   ├── from-resolver.test.js  ← NEW Phase 3
│   ├── explain.test.js        ← NEW Phase 3
│   ├── formatter.test.js      ← NEW Phase 3
│   └── cli.test.js            ← NEW Phase 3 (integration)
├── bin/
│   └── whoodb.js         ← NEW Phase 3 — shebang entry point
└── package.json          ← EXTEND: add "bin" entry + update engines
```

### Pattern 1: evaluator.js Multi-File Extension

**What:** The existing `execute(plan, filePath, opts)` accepts a single `string`. Phase 3 changes the signature to accept `string | string[]`. The `streamRows` internal generator already iterates over one file; extend it to iterate over an array.

**Why this approach (not a wrapper in cli.js):** Keeping multi-file logic inside the evaluator means tests can test multi-file execution directly without the CLI layer.

**Implementation sketch:**

```js
// src/evaluator.js — minimal extension
// Change: filePath → filePaths (string | string[])
export async function* execute(plan, filePaths, opts = {}) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  // ... existing dispatch (streaming vs buffered) ...
}

async function* streamRows(filePaths, plan, opts) {
  for (const filePath of filePaths) {
    const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    // ... existing readline loop (unchanged) ...
  }
}
```

**Backward compatibility:** passing a single string still works (Array.isArray returns false → wraps in array). Existing Phase 1+2 tests pass without change.

### Pattern 2: from-resolver.js — Glob + Path Normalization

**What:** Resolves the `plan.scan.source` string into `string[]` of normalized file paths.

**Key behavior verified on live Windows environment:**
- `fs.promises.glob('fixtures/*.jsonl')` returns an **async iterator**, not a promise. You must use `for await`.
- On Windows, returned paths use backslashes (`fixtures\sample.jsonl`).
- Normalize with `path.sep` split/join, or simply `f.split(path.sep).join('/')`.
- The evaluator's `createReadStream` works with either separator on Windows, but normalized paths make testing easier.

```js
// src/from-resolver.js
import { glob } from 'node:fs/promises';
import { sep as PATH_SEP, resolve } from 'node:path';

/**
 * Resolve a FROM clause string to an array of normalized file paths.
 * Handles:
 *   - Single quoted path: 'logs/file.jsonl'  → strips quotes, resolves
 *   - Glob pattern: logs/*.jsonl              → expands via fs.glob
 *   - Unquoted literal path: logs/file.jsonl  → resolves
 *
 * Returns forward-slash paths (cross-platform consistent).
 * Throws if zero files are matched.
 */
export async function resolveFrom(source, cwd = process.cwd()) {
  // Strip surrounding single-quotes if the parser left them in
  // (parser may or may not strip them — confirm with src/parser.js)
  const raw = source.startsWith("'") && source.endsWith("'")
    ? source.slice(1, -1)
    : source;

  // If no glob characters, treat as a literal path
  if (!hasGlobChars(raw)) {
    return [raw.split(PATH_SEP).join('/')];
  }

  const matched = [];
  for await (const f of glob(raw, { cwd })) {
    matched.push(f.split(PATH_SEP).join('/'));
  }

  if (matched.length === 0) {
    throw new Error(`no files matched: ${raw}`);
  }
  return matched;
}

function hasGlobChars(s) {
  return s.includes('*') || s.includes('?') || s.includes('[');
}
```

**Important: cwd matters for glob.** `fs.promises.glob` resolves relative patterns against `process.cwd()` (Node docs). The `cwd` option must be the working directory of the process invoking `whoodb`, not the location of `from-resolver.js`.

**Quoted path handling:** The parser stores the FROM clause verbatim from the SQL string. Inspect `src/parser.js` `parseFrom()` to confirm whether it strips the surrounding quotes from `FROM 'path/to/file.jsonl'`. The research shows the AST's `from` field is a raw string. Live test: `SELECT * FROM 'fixtures/sample.jsonl'` — confirm whether `plan.scan.source` is `'fixtures/sample.jsonl'` (with quotes) or `fixtures/sample.jsonl` (without). The resolver must handle both.

### Pattern 3: explain.js — AST + Plan Pretty-Printer

**What:** Walks the AST and ExecutionPlan and emits human-readable text to stdout. Called when `--explain` flag is present; exits 0 without running the query.

**Output format (two-section):**

```
=== Execution Plan ===
Query type: SELECT with GROUP BY + ORDER BY + LIMIT
Stages:
  1. SCAN        .planning/metrics/tokens.jsonl
  2. FILTER      WHERE ... (inline streaming)
  3. GROUP BY    agent
  4. AGGREGATE   COUNT(*) AS calls, SUM(usage.output_tokens) AS out
  5. SORT        out DESC (post-projection)
  6. LIMIT       10

=== AST ===
SelectStmt
  projection:
    Alias "calls"
      Aggregate COUNT STAR
    Alias "out"
      Aggregate SUM
        ColumnRef usage.output_tokens
  from: ".planning/metrics/tokens.jsonl"
  where: (none)
  groupBy:
    ColumnRef agent
  orderBy:
    OrderByItem out DESC
  limit:
    LimitOffset count=10 offset=0
```

**Key design points:**
- Two sections: Plan first (high-level), AST second (detailed).
- The plan section names the stages in execution order (matches architecture.md data flow diagram).
- The AST section is an indented tree walk — not JSON (for human readability).
- A `--format json` flag could emit `JSON.stringify({ast, plan})` for programmatic use — but this is a `Claude's Discretion` area; the requirement only says "readable".
- EXIT CODE: `--explain` exits 0 after printing. No file I/O.

### Pattern 4: formatter.js — JSONL + Table

**What:** Two output modes called from `cli.js`. For JSONL: `process.stdout.write(JSON.stringify(row) + '\n')` per row. For table: collect all rows, compute column widths, then write.

**JSONL mode (streaming-safe):**
```js
export function jsonlRow(row) {
  process.stdout.write(JSON.stringify(row) + '\n');
}
```

**Table mode:** Must buffer all rows first to compute column widths. This is unavoidable for a fixed-width table. For the performance budget, this is fine — the table formatter only runs on GROUP BY / ORDER BY results which are already buffered, or on streaming results where the user chose human-readable output (accepting that all rows are collected first).

```js
// src/formatter.js (table path — from stack.md pattern)
import { styleText } from 'node:util';

export function formatTable(rows) {
  if (rows.length === 0) { process.stdout.write('(no rows)\n'); return; }
  const columns = Object.keys(rows[0]);
  const widths = columns.map(col =>
    Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length))
  );
  const header = columns.map((col, i) => styleText('bold', col.padEnd(widths[i]))).join(' | ');
  const sep    = widths.map(w => '-'.repeat(w)).join('-+-');
  process.stdout.write(header + '\n' + sep + '\n');
  for (const row of rows) {
    const line = columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join(' | ');
    process.stdout.write(line + '\n');
  }
}
```

**Caveat:** `util.styleText` only emits ANSI codes when stdout is a TTY. If stdout is piped, styleText returns the plain string (no ANSI codes) — which is correct behavior. No special detection needed.

### Pattern 5: cli.js — Arg Parsing + Wiring + Exit Codes

**What:** The top-level entry point. Reads argv, routes to explain or execute, handles all errors, sets exit codes.

**`util.parseArgs` verified behavior:**

```js
// From live test: node -e with argv = ['query', 'SELECT * FROM f', '--explain', '--format', 'table']
// Result: { values: { explain: true, format: 'table' }, positionals: ['query', 'SELECT * FROM f'] }
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    explain: { type: 'boolean', short: 'e', default: false },
    format:  { type: 'string',  short: 'f', default: 'jsonl' },
  },
  allowPositionals: true,
  strict: true,
});

const subcommand = positionals[0];     // 'query'
const sql        = positionals[1];     // the SQL string
```

**Exit code policy (CLI-05):**

| Condition | Exit Code | Channel |
|-----------|-----------|---------|
| Success | 0 | — |
| Parse error (LexError / ParseError) | 1 | stderr |
| IO error (file not found, glob no match) | 2 | stderr |
| EPIPE (pipe broken by downstream) | 0 | — (silent) |
| Unknown flag (parseArgs strict mode) | 1 | stderr |

**Skeleton:**

```js
// src/cli.js
import { parseArgs }  from 'node:util';
import { tokenize }   from './lexer.js';
import { parse }      from './parser.js';
import { analyze }    from './analyze.js';
import { resolveFrom } from './from-resolver.js';
import { execute }    from './evaluator.js';
import { printExplain } from './explain.js';
import { jsonlRow, formatTable } from './formatter.js';
import { LexError, ParseError } from './ast.js';

// ① EPIPE handler — must be installed before any stdout writes
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  process.stderr.write(`whoodb: stdout error: ${err.message}\n`);
  process.exit(2);
});

export async function main(argv = process.argv.slice(2)) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        explain: { type: 'boolean', short: 'e', default: false },
        format:  { type: 'string',  short: 'f', default: 'jsonl' },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (err) {
    process.stderr.write(`whoodb: ${err.message}\n`);
    process.exit(1);
  }

  if (positionals[0] !== 'query' || !positionals[1]) {
    process.stderr.write('usage: whoodb query "<sql>" [--explain] [--format jsonl|table]\n');
    process.exit(1);
  }

  const sql = positionals[1];

  // ② Parse + analyze (synchronous — errors exit 1)
  let ast, plan;
  try {
    ast = parse(tokenize(sql));
    plan = analyze(ast);
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError) {
      process.stderr.write(`whoodb: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  // ③ --explain: print plan and exit WITHOUT touching the filesystem
  if (values.explain) {
    printExplain(ast, plan);
    process.exit(0);
  }

  // ④ Resolve FROM → file paths (async — errors exit 2)
  let filePaths;
  try {
    filePaths = await resolveFrom(plan.scan.source);
  } catch (err) {
    process.stderr.write(`whoodb: ${err.message}\n`);
    process.exit(2);
  }

  // ⑤ Execute + output
  const isTable = values.format === 'table';
  const buffer = isTable ? [] : null;

  try {
    for await (const row of execute(plan, filePaths)) {
      if (isTable) buffer.push(row);
      else jsonlRow(row);
    }
  } catch (err) {
    process.stderr.write(`whoodb: runtime error: ${err.message}\n`);
    process.exit(2);
  }

  if (isTable) formatTable(buffer);
}
```

**`bin/whoodb.js` shebang entry:**

```js
#!/usr/bin/env node
import { main } from '../src/cli.js';
main().catch(err => {
  process.stderr.write(`whoodb: fatal: ${err.message}\n`);
  process.exit(2);
});
```

**`package.json` bin entry:**

```json
{
  "bin": {
    "whoodb": "./bin/whoodb.js"
  }
}
```

npm automatically sets the executable bit on POSIX and creates a `.cmd` shim on Windows during `npm install -g`. No manual `chmod +x` needed in the build.

### Anti-Patterns to Avoid

- **Parsing glob in the parser:** The parser must store the raw FROM string in `ast.from` (no I/O). `from-resolver.js` expands at execution time. `--explain` prints the raw string without filesystem access. (Architecture.md Anti-Pattern 2 — already locked.)
- **Awaiting `fs.promises.glob` as a promise:** `fs.promises.glob` returns an **async iterator**, not a promise. `await glob(...)` will return the iterator object, not the results. Use `for await`.
- **`console.log` in formatter:** `console.log` adds a trailing newline and has different buffering than `process.stdout.write`. Use `process.stdout.write` for all output to keep behavior consistent between JSONL and table modes.
- **Installing EPIPE handler after first stdout write:** The EPIPE error fires on the next write after the pipe closes, which may happen at any time. Install the handler at the TOP of `main()` before any output.
- **Streaming table output row-by-row:** Table mode MUST buffer all rows first to compute column widths. You cannot stream a fixed-width table. This is acceptable because GROUP BY results are already buffered.
- **`path.normalize` instead of sep replacement for glob results:** `path.normalize` on Windows converts forward slashes to backslashes, which is the OPPOSITE of what we want. Use `.split(path.sep).join('/')` or `replaceAll(path.sep, '/')`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI arg parsing | Custom `process.argv.slice(2)` string scanner | `util.parseArgs` | Handles `--flag value`, `--flag=value`, short aliases, `strict` mode for unknown flags, defaults — all edge cases covered |
| Glob expansion | Manual `fs.readdirSync` + regex against filename | `fs.promises.glob` | Node 22 glob handles nested patterns (`**`), bracket expressions, and multiple dirs; the manual approach misses edge cases and is ~50 lines of recursive code |
| Windows path normalization in glob | Trusting that forward-slash works everywhere | Explicit `path.sep` replacement after each glob result | Verified: `fs.promises.glob` returns backslash paths on win32 (live test above) |
| Column width computation | Hard-coded widths | `Math.max(col.length, ...rows.map(...))` | Headers or data may be wider than a fixed width; auto-computation is ~3 lines |
| ANSI color detection | `process.stdout.isTTY` check before calling styleText | `util.styleText` directly | styleText already checks TTY and respects `NO_COLOR` / `NODE_DISABLE_COLORS` env vars — no extra detection needed |

---

## Common Pitfalls

### Pitfall 1: `fs.promises.glob` is an async iterator, not a promise

**What goes wrong:** `const files = await glob('*.jsonl')` returns the async iterator object, not an array. Using `files` as an array then silently fails (no entries), making all queries return zero rows.

**Why it happens:** Node's `fs.promises.glob` returns `AsyncGenerator<string>`, not `Promise<string[]>`. This is different from the npm `glob` package which returns a Promise.

**How to avoid:**
```js
const matched = [];
for await (const f of glob(pattern)) matched.push(f);
```
Or `Array.fromAsync(glob(pattern))` (available in Node 22+).

**Warning signs:** Query returns 0 rows with no error. Test by asserting matched.length > 0.

### Pitfall 2: Windows backslash in glob results breaks createReadStream

**What goes wrong:** On Windows, `glob('logs/*.jsonl')` returns `['logs\\file.jsonl']`. Passing this to `createReadStream` works fine on Windows, but test assertions on the path string fail if tests compare to `'logs/file.jsonl'`. More critically, if the path ends up in error messages or the explain output, users see backslashes inconsistently.

**How to avoid:** Normalize immediately after glob expansion:
```js
matched.push(f.split(path.sep).join('/'));
```
Do NOT use `path.normalize` (it converts forward-slashes to backslashes on Windows — wrong direction).

**Warning signs:** FROM resolver test passes on POSIX but fails on Windows; explain output shows mixed separators.

### Pitfall 3: EPIPE crash from piping to head

**What goes wrong:** `whoodb query '...' | head -1` — `head` closes its stdin after reading 1 line. The next `process.stdout.write` call in whoodb throws `EPIPE` error (code `EPIPE`), which crashes the process with an unhandled error.

**Why it happens:** Node's default behavior is to emit an `error` event on the stdout stream when the pipe breaks. Without a handler, this becomes an uncaught error.

**How to avoid:** Install at startup, before any write:
```js
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  process.stderr.write(`whoodb: stdout error: ${err.message}\n`);
  process.exit(2);
});
```
**Verified pattern:** live test confirms `process.stdout.on('error', ...)` is the correct approach.

### Pitfall 4: `--explain` touches the filesystem

**What goes wrong:** If the FROM resolver is called before checking `--explain`, a query like `--explain 'SELECT * FROM nonexistent/*.jsonl'` fails with "no files matched" instead of printing the plan and exiting 0.

**Why it happens:** FROM resolution is an async I/O step. Calling it before the `--explain` check means `--explain` loses its "no file I/O" property.

**How to avoid:** The cli.js skeleton above shows the correct order: parse → analyze → if explain → printExplain+exit → THEN resolveFrom.

### Pitfall 5: FROM clause quote stripping — check parser behavior

**What goes wrong:** The query `SELECT * FROM '.planning/metrics/tokens.jsonl'` stores `'path'` (with single quotes) or `path` (without) in `ast.from` depending on parser behavior. The FROM resolver must handle both cases, or the evaluator gets `ENOENT: no such file or directory, open ''path''`.

**How to verify:** Run `parse(tokenize("SELECT * FROM '.planning/metrics/tokens.jsonl'")).from` and inspect the result. If it includes quotes, the resolver must strip them.

**How to avoid:** Add a single defensive strip in `resolveFrom`:
```js
const raw = source.startsWith("'") && source.endsWith("'") ? source.slice(1, -1) : source;
```

### Pitfall 6: Dogfood query field mismatch — CRITICAL

**What goes wrong:** The dogfood query in requirements.md and roadmap.md is:
```sql
SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out
FROM '.planning/metrics/tokens.jsonl'
GROUP BY agent ORDER BY out DESC LIMIT 10
```
But `.planning/metrics/tokens.jsonl` has `output_tokens` at the **top level**, not nested under `usage`. Every `usage.output_tokens` resolves to `undefined`, SUM returns 0 (with 14 non-numeric warnings), and `out` is 0 for all groups.

**The file has:** `"output_tokens": 36700` (flat field, top level)
**The query expects:** `usage.output_tokens` (nested under `usage` object)

**How to resolve (two options):**
1. Augment `tokens.jsonl` to have a nested `usage: { output_tokens: N }` field alongside the flat one (backward-compatible).
2. Modify the dogfood query to use `SUM(output_tokens)` (flat field).

**Recommendation:** Option 1 — augment the file. The requirements.md dogfood query is locked as a success criterion. Changing it would be a requirements change. Adding a `usage` wrapper field to each row keeps the existing flat fields intact and makes the query work.

**Confirmed data:** 14 rows, 6 distinct agents, `output_tokens` values range from 10910 to 67089. Agents: `general-purpose` (7), `pan-planner` (2), `pan-plan-checker` (2), `pan-research-synthesizer` (1), `pan-roadmapper` (1), `pan-phase-researcher` (1).

### Pitfall 7: Table formatter assumes all rows have the same keys

**What goes wrong:** If result rows have different key sets (e.g., sparse JSONL where some rows have `level` and others do not), `Object.keys(rows[0])` misses columns present only in later rows.

**How to avoid:** For Phase 3's scope (aggregation output is always uniform key sets from the projector), this is not a real risk. The projector in Phase 2 always emits exactly the projected keys. Document this assumption; don't build a union-of-keys column collector unless needed.

---

## Code Examples

### Glob resolution (cross-platform)

```js
// src/from-resolver.js — verified on Windows (Node 24)
import { glob } from 'node:fs/promises';
import { sep as PATH_SEP } from 'node:path';

export async function resolveFrom(source) {
  // Strip surrounding single-quotes (parser may leave them)
  const raw = source.startsWith("'") && source.endsWith("'")
    ? source.slice(1, -1)
    : source;

  if (!raw.includes('*') && !raw.includes('?') && !raw.includes('[')) {
    // Single file — no glob expansion needed
    return [raw.split(PATH_SEP).join('/')];
  }

  const matched = [];
  for await (const f of glob(raw)) {
    matched.push(f.split(PATH_SEP).join('/'));
  }

  if (matched.length === 0) throw new Error(`no files matched: ${raw}`);
  return matched;
}
```

### EPIPE handler (install at startup)

```js
// First lines of src/cli.js — before any stdout write
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  process.stderr.write(`whoodb: stdout error: ${err.message}\n`);
  process.exit(2);
});
```

### Table formatter

```js
// src/formatter.js
import { styleText } from 'node:util';

export function formatTable(rows) {
  if (rows.length === 0) { process.stdout.write('(no rows)\n'); return; }
  const columns = Object.keys(rows[0]);
  const widths = columns.map(col =>
    Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length))
  );
  const header = columns.map((col, i) => styleText('bold', col.padEnd(widths[i]))).join(' | ');
  const sep    = widths.map(w => '-'.repeat(w)).join('-+-');
  process.stdout.write(header + '\n' + sep + '\n');
  for (const row of rows) {
    const line = columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join(' | ');
    process.stdout.write(line + '\n');
  }
}

export function jsonlRow(row) {
  process.stdout.write(JSON.stringify(row) + '\n');
}
```

### bin/whoodb.js shebang

```js
#!/usr/bin/env node
import { main } from '../src/cli.js';
main().catch(err => {
  process.stderr.write(`whoodb: fatal: ${err.message}\n`);
  process.exit(2);
});
```

### package.json additions

```json
{
  "bin": { "whoodb": "./bin/whoodb.js" },
  "engines": { "node": ">=22.17.0" }
}
```

### util.parseArgs invocation (verified)

```js
// Verified live: argv = ['query', 'SELECT * FROM f', '--explain', '--format', 'table']
// Result: { values: { explain: true, format: 'table' }, positionals: ['query', 'SELECT * FROM f'] }
import { parseArgs } from 'node:util';
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    explain: { type: 'boolean', short: 'e', default: false },
    format:  { type: 'string',  short: 'f', default: 'jsonl' },
  },
  allowPositionals: true,
  strict: true,
});
```

---

## State of the Art

| Old Approach | Current Approach | Impact on Phase 3 |
|---|---|---|
| `process.argv` manual parsing | `util.parseArgs` stable (Node 20) | Use `util.parseArgs` — zero lines of custom arg scanner needed |
| npm `glob` package | `fs.promises.glob` (Node 22.17.0 stable) | No npm dep needed; returns async iterator (not promise) |
| npm `chalk` for terminal color | `util.styleText` (Node 22.13.0 stable) | No npm dep; auto-respects NO_COLOR |
| `readline` async iteration | event-based `readline.on('line')` for perf | Evaluator already uses async iteration via `for await` loop — this is the existing Phase 1/2 approach; performance budgets should be measured and only switched to event-based if 100MB/15s budget is missed |

---

## Open Questions

### 1. Dogfood query vs tokens.jsonl field shape — CRITICAL BLOCKER

**What we know:** `tokens.jsonl` has `output_tokens` at top level. The dogfood query uses `SUM(usage.output_tokens)`. With the current file, the dogfood query returns `out: 0` for all groups (14 SUM warnings, all non-numeric).

**What's unclear:** Which should change — the file or the query? Requirements.md TEST-03 defines the query as:
```sql
SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out
FROM '.planning/metrics/tokens.jsonl'
GROUP BY agent ORDER BY out DESC LIMIT 10
```
This is a locked success criterion.

**Recommendation:** Augment `tokens.jsonl` to include a nested `usage: { output_tokens: N }` field on each row. The existing flat `output_tokens` field can remain (backward compatible). The plan should include a task that writes a small Node script or shell command to convert the file, or adds to the CI fixture creation.

### 2. FROM clause — does the parser strip surrounding quotes?

**What we know:** The query `SELECT * FROM '.planning/metrics/tokens.jsonl'` — the `FROM` value in the AST could be `'.planning/metrics/tokens.jsonl'` (with quotes) or `.planning/metrics/tokens.jsonl` (without).

**What's unclear:** Need to verify `src/parser.js` `parseFrom()` behavior.

**Recommendation:** Plan includes a task that reads `src/parser.js` before implementing `resolveFrom()` and adds defensive quote-stripping regardless. This is a two-line defensive measure.

### 3. Performance validation methodology

**What we know:** PERF-01 (100MB/15s WHERE-only) and PERF-02 (100K rows GROUP BY/5s) are Phase 3 success criteria. The Phase 1/2 evaluator was built to support these budgets but they haven't been measured yet.

**What's unclear:** How to create the 100MB test fixture without committing a large file to git. Options: (a) generate it at test time with a Node script, (b) use a separate `perf/` test that's run manually, (c) use a smaller representative fixture and project linearly.

**Recommendation:** Create a `test/perf.test.js` that generates a large fixture in `os.tmpdir()`, runs the query, and asserts timing. Mark it `{ skip: !process.env.WHOODB_RUN_PERF }` so it doesn't block the normal test run. The CI/dogfood pass requires a human to run it explicitly.

### 4. Multi-file evaluator — does GROUP BY accumulate across files?

**What we know:** Phase 3 changes `execute(plan, filePaths)` to accept `string[]`. The `streamRows` generator will iterate over all files sequentially, yielding rows to the existing accumulator.

**What's unclear:** For GROUP BY queries spanning multiple files, the accumulator should correctly merge groups across files (e.g., `agent: 'general-purpose'` appears in both files → same bucket). This should work automatically because the accumulator keyed by group-key string accumulates across all rows regardless of which file they came from.

**Recommendation:** Add a multi-file integration test in `test/from-resolver.test.js` (or `test/cli.test.js`) that queries across two fixture files and verifies GROUP BY merging. No code change needed — just a test.

---

## Phase 3 File Impact Summary

### New files
- `src/from-resolver.js` — glob expansion + path normalization (~40 lines)
- `src/explain.js` — AST + plan pretty-printer (~80 lines)
- `src/formatter.js` — JSONL + table output (~40 lines)
- `src/cli.js` — CLI wiring, arg parsing, exit codes (~80 lines)
- `bin/whoodb.js` — shebang entry point (~5 lines)
- `test/from-resolver.test.js` — unit tests (~5 tests)
- `test/explain.test.js` — unit tests (~4 tests)
- `test/formatter.test.js` — unit tests (~4 tests)
- `test/cli.test.js` — integration tests (~10 tests)
- `test/perf.test.js` — optional performance tests (skipped unless env flag set)

### Modified files
- `src/evaluator.js` — change `filePath: string` parameter to accept `string | string[]`; wrap in array internally. (~5 line change)
- `package.json` — add `"bin"` entry; confirm `"engines": { "node": ">=22.17.0" }` is present
- `.planning/metrics/tokens.jsonl` — augment each row with `"usage": { "output_tokens": N }` field (see Open Question 1)

### Unchanged files
All Phase 1/2 source files (`lexer.js`, `parser.js`, `ast.js`, `analyze.js`, `where.js`, `project.js`, `accumulator.js`, `sort.js`) are untouched. The 130 existing Phase 1+2 tests continue to pass.

---

## Validation Architecture

> `workflow.nyquist_validation` is NOT set to `true` in `.planning/config.json`. Skipping the formal Validation Architecture section.

**Test framework:** `node --test test/*.js` — unchanged from Phases 1+2.

**Quick run:** `node --test test/from-resolver.test.js test/formatter.test.js test/explain.test.js test/cli.test.js`

**Full suite:** `npm test` (runs all 160+ tests including Phase 1+2 baseline).

**Wave 0 gaps:** None for test framework. New test files needed:
- `test/from-resolver.test.js`
- `test/explain.test.js`
- `test/formatter.test.js`
- `test/cli.test.js`

---

## Sources

### Primary (HIGH confidence — verified in live Node 24 environment)

- Live Node 24.15.0 test: `util.parseArgs` with subcommand positional — confirmed behavior
- Live Node 24.15.0 test: `fs.promises.glob` returns async iterator, Windows backslash paths
- Live Node 24.15.0 test: `util.styleText` available and functional
- Live Node 24.15.0 test: EPIPE handler pattern verified
- `.planning/research/stack.md` — builtin version floors, zero-deps constraint
- `.planning/research/architecture.md` — component table, data flow, FROM resolver design
- `.planning/metrics/tokens.jsonl` — direct read, confirmed field schema (flat `output_tokens`, not `usage.output_tokens`)
- `src/evaluator.js` — direct read, confirmed `execute(plan, filePath: string)` current signature
- `src/ast.js` — direct read, confirmed AST shape including `SelectStmt.from` field

### Secondary (MEDIUM confidence)

- Node.js `fs.promises.glob` docs — async iterator API, `cwd` option — referenced in stack.md
- Node.js `util.parseArgs` docs — `allowPositionals`, `strict`, `default` behavior — referenced in stack.md

### Tertiary (LOW confidence — flag for validation)

- Performance budget (PERF-01, PERF-02): Phase 1/2 evaluator was designed for these targets but measurements haven't been taken. The architecture supports them; actual measurement is a Phase 3 task.

---

## Infrastructure Dependencies

**None.** Phase 3 is pure-Node CLI with no external services or Docker requirements. Tests run against local JSONL fixtures.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all builtins verified in live Node 24 environment
- Architecture: HIGH — extends existing, well-understood Phase 1/2 evaluator; new modules are thin wrappers
- Pitfalls: HIGH — glob iterator vs promise (verified), Windows backslash (verified), EPIPE (verified), dogfood schema mismatch (discovered by direct file inspection)

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (30 days — Node builtins are stable; no fast-moving deps)

---

*Phase 3 research: 2026-05-02 — deltas only over project-level research in `.planning/research/`.*
