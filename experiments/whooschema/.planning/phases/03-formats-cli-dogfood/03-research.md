# Phase 3: Formats + CLI + Dogfood — Research

**Researched:** 2026-05-02
**Domain:** JSON Schema `format` validators (5 formats) + zero-dep Node CLI + dogfood validation against PAN's `.planning/config.json` + 200ms perf budget verification
**Confidence:** HIGH (domain fully covered by project-level research files; this document is Phase 3 deltas only)

> **Note:** `.planning/research/architecture.md`, `.planning/research/features.md`, `.planning/research/stack.md`, and `.planning/research/pitfalls.md` already cover the standard stack, format validator philosophy, CLI conventions (`util.parseArgs`, exit codes, shebang), and the relevant pitfalls (Pitfall 9 — format over/under-engineering). This file emits ONLY what is specific to Phase 3: the integration points in the existing Phase 1/2 codebase, exact regex/validator implementations to commit to, the schema for PAN's `config.json`, and the per-requirement test/benchmark plan.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FMT-01 | `format: email` — pragmatic regex (RFC 5322 simple-form), not RFC-perfect | pitfalls.md Pitfall 9 ("defensible pragmatic"); features.md "Format Validators" |
| FMT-02 | `format: uri` — uses `new URL()` for validation | pitfalls.md Pitfall 9 ("URL parser is the cleanest zero-dep option"); features.md table; verified locally — `new URL('not a url')` throws, relative paths throw, `mailto:`/`ftp:`/`https:` accepted |
| FMT-03 | `format: date` — calendar validation (rejects 2024-02-30); ISO 8601 date | pitfalls.md Pitfall 9 ("regex + numeric range checks; do NOT rely on Date constructor — `new Date('2024-02-30')` silently rolls to March 1"); verified locally |
| FMT-04 | `format: date-time` — RFC 3339 with calendar validation | pitfalls.md Pitfall 9 ("regex with capture groups + numeric range checks; toISOString round-trip is unreliable"); spec — RFC 3339 §5.6 |
| FMT-05 | `format: uuid` — RFC 4122 v1-v5 pattern | pitfalls.md Pitfall 9 ("case-insensitive `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`; do not restrict to v4 only — spec accepts any UUID") |
| FMT-06 | Unknown formats silently ignored (per spec); pluggable via internal format-table | features.md Anti-Features ("unknown format values silently pass per JSON Schema spec"); architecture.md `formats.js` as pure map |
| CLI-01 | `whooschema validate --schema <file> --data <file>` prints `OK` and exits 0 if valid | stack.md "CLI Conventions"; features.md "CLI Feature Expectations" — `OK` matches success line convention |
| CLI-02 | On invalid input, CLI prints one human-readable line per error and exits 1 | features.md "CLI Feature Expectations"; pitfalls.md UX Pitfalls — exit 1 for data-invalid |
| CLI-03 | `--format json` emits the full error array as JSON | features.md "CLI Feature Expectations" — matches ajv-cli `--errors=json` shape |
| CLI-04 | CLI uses `node:util.parseArgs` only — no commander/yargs/minimist dep | stack.md "Arg Parsing — `util.parseArgs` (zero dep)"; locked by zero-dep constraint |
| DOG-01 | Validate PAN's `.planning/config.json` against a hand-written `config.schema.json` and produce clean `OK` | idea.md "Eat-our-own-dogfood marker"; existing `.planning/config.json` shape verified — has `mode`, `depth`, `parallelization`, `commit_docs`, `model_profile`, `workflow{}` |
| DOG-02 | Deliberately-broken copy of `config.json` produces a list of human-readable error paths | idea.md SC; matches CLI-02 output format |
| PERF-01 | Validate 1MB JSON document against 200-line schema in under 200ms | architecture.md "Compile-Then-Validate vs Interpretive" ("naive recursion at 10k nodes/sec clears 1MB in under 200ms"); pitfalls.md Performance Traps — RegExp recompilation, error sort frequency |

</phase_requirements>

---

## Summary

Phase 3 is the "shipping polish" phase: it adds format-keyword dispatch, the `whooschema` CLI binary, two dogfood schemas (clean + broken `config.json`), and a benchmark script that proves the 200ms budget. Every requirement maps to a small, isolated addition on top of the Phase 1+2 foundation; nothing in the existing core needs to be rewritten.

The Phase 1+2 codebase already reserves space for Phase 3: `KNOWN_KEYWORDS` in `schema-loader.js` already includes `'format'` (line 23 of schema-loader.js — already verified) so format keywords do NOT trigger the unknown-keyword warning, and `validateString` in `keyword-handlers.js` is the natural plug-in point for the format check (string-only per spec).

**Primary recommendation:** Phase 3 fits in **three sequential plans** (mirrors Phase 2's structure):

1. **Plan 03-01 — Formats:** Create `src/formats.js` (pure map of 5 validator functions); plug a single `validateFormat` call into `validateString` in `src/keyword-handlers.js` (handles FMT-01..06).
2. **Plan 03-02 — CLI + dogfood schema:** Create `bin/whooschema.js` (shebang + `parseArgs` + file I/O + text/json output); create `dogfood/config.schema.json`; add `bin` field + `format`/`uri`/etc. tests; wire `bin` field in `package.json`.
3. **Plan 03-03 — Tests + benchmark:** Create `test/format.test.js`, `test/cli.test.js`, `test/dogfood.test.js`; create `scripts/bench.js` (PERF-01 proof).

These are sequential (CLI depends on formats existing for its dogfood test cases; tests depend on both). Each plan is independently testable against `node --test` after completion.

---

## What Phase 1+2 Already Provides

### Files available to extend

| File | Phase 1+2 role | Phase 3 hook |
|------|---------------|--------------|
| `src/keyword-handlers.js` (lines 62–101 = `validateString`) | minLength / maxLength / pattern checks for strings | Add `validateFormat` import + call inside `validateString` after `pattern` check |
| `src/schema-loader.js` (line 23 — `KNOWN_KEYWORDS`) | `'format'` already listed as known | No change needed — format keywords already pass schema-load without warning |
| `src/validate.js` | Public API entry | No change needed |
| `src/validator-core.js` | Dispatcher | No change needed — format is dispatched within `validateString`, not at the top level |
| `package.json` | Already has `"type":"module"`, `"engines":{"node":">=18"}` | Add `"bin": { "whooschema": "./bin/whooschema.js" }` |
| `index.d.ts` | `validate()` signature; `ValidationError` shape with `path/rule/message/value/expected?` | No type changes needed (format errors fit existing shape) |

### Exact integration point for FMT-01..06 in `keyword-handlers.js`

In `validateString` (lines 62–101), after the existing `pattern` check (line 100), add ONE call:

```js
// existing pattern check ends at line 100
}
// NEW (Phase 3): format check — last in validateString so that pattern errors emit first.
validateFormat(schema, data, path, errors);
```

Where `validateFormat` is imported from a new `src/formats.js`. The schema-load-time check is NOT extended — formats are runtime-only annotations per spec; an unknown `format` value (e.g. `"phone"`) is silently ignored at validate time and produces NO load-time warning (FMT-06).

### Exact line counts and positions verified by direct read

- `src/keyword-handlers.js` is 298 lines; `validateString` ends at line 101 (after `pattern` check). Format check insertion point: line 100 just before the closing `}` of `validateString`.
- `src/schema-loader.js` line 23: `'format'` is already in `KNOWN_KEYWORDS`.
- `src/validate.js` is 26 lines and unchanged for Phase 3.

---

## Standard Stack

(See `.planning/research/stack.md` for the full table — only Phase 3 specifics here.)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:util` `parseArgs` | builtin (stable v20, backported v16.17) | CLI argument parsing | Zero-dep, covers all needed flags + subcommand-via-positional pattern (verified locally) |
| `node:fs/promises` | builtin | Read schema + data files in CLI | Promise-based; avoids callback hell |
| `node:path` | builtin | Resolve relative paths from CWD | Cross-platform path handling for input files (NOT for error paths — those stay forward-slash strings) |
| `node:url` `fileURLToPath` | builtin | ESM `__dirname` equivalent if dogfood schema lookup needs it | Only if benchmark/CLI needs to locate fixtures relative to itself |
| `RegExp` (native) | builtin | Format regexes (email, date, date-time, uuid) | Compiled once per process; no flags |
| `URL` constructor | builtin | `format: uri` validation | `new URL(v)` throws on invalid; verified locally for `'not a url'`, relative paths |

### Alternatives considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `util.parseArgs` | `commander` / `yargs` / `minimist` | All are runtime deps — **forbidden** by zero-dep constraint (CLI-04) |
| Hand-rolled email regex | `validator.js` / `isemail` | Runtime deps — forbidden |
| `tinybench` / `benchmark.js` for PERF-01 | npm dev deps | Adds devDependency; `Date.now()` + a `for` loop is sufficient for a single threshold check (success criterion specifies `Date.now()` explicitly) |
| Full RFC 5322 email parser | n/a | Per pitfalls.md Pitfall 9 — over-engineering; "defensible pragmatic" wins |
| Strict RFC 3986 URI parser | n/a | `new URL()` is ~95% correct and zero-dep |

**Installation:** None — all builtins. `package.json` keeps zero `dependencies`. No new `devDependencies` needed.

---

## Architecture Patterns

### Recommended File Layout (delta on top of Phase 1+2)

```
src/
├── validate.js            # (unchanged Phase 1+2)
├── schema-loader.js       # (unchanged — 'format' already in KNOWN_KEYWORDS)
├── validator-core.js      # (unchanged)
├── keyword-handlers.js    # ONE-LINE change inside validateString — add validateFormat call
├── error-utils.js         # (unchanged)
└── formats.js             # NEW — pure map { email, uri, date, 'date-time', uuid } + validateFormat dispatcher
bin/
└── whooschema.js          # NEW — shebang + parseArgs + file I/O + output formatter + exit code
dogfood/
├── config.schema.json     # NEW — hand-written schema for PAN's .planning/config.json (DOG-01)
└── config.broken.json     # NEW — deliberately-broken copy for DOG-02 demonstration / test fixture
scripts/
└── bench.js               # NEW — PERF-01 proof: 1MB doc / 200-line schema in <200ms via Date.now()
test/
├── format.test.js         # NEW — FMT-01..06
├── cli.test.js            # NEW — CLI-01..04 (uses node:child_process to spawn the CLI)
└── dogfood.test.js        # NEW — DOG-01 (clean → 0 errors) + DOG-02 (broken → expected error paths)
package.json               # CHANGED — add "bin": { "whooschema": "./bin/whooschema.js" }
```

**Rationale per file:**

- `src/formats.js` is a **pure map** so future formats are pluggable without touching the validator (features.md Differentiator: pluggable format model). The dispatcher does a single `if (table[name]) { ...check... }` — unknown format → no-op, satisfying FMT-06.
- `bin/whooschema.js` is the ONLY place the library calls `process.exit`. The library never calls `process.exit` itself (stack.md "What NOT to Use" — `process.exit(0)` inside library code).
- `dogfood/` (not `examples/` or `fixtures/`) per the project's "eat-our-own-dogfood" marker in idea.md.
- `scripts/bench.js` is one-shot — `node scripts/bench.js` prints `<duration>ms` and exits non-zero if it exceeds 200ms. Not added to `npm test` (slow), but available for the perf-verification gate.

### Pattern 1: Format Table

```js
// src/formats.js
//
// Format validators per JSON Schema Draft-07 § 7.3.
// FMT-01..05: five validators. FMT-06: unknown formats no-op silently.
// All validators receive a string and return true on valid, false on invalid.
// Non-string values cause format to be skipped (validateString already type-guards).
//
// Pitfall 9 mitigations encoded here:
//   - email: pragmatic regex (no quoted local parts, no IP literals)
//   - uri:   `new URL()` constructor (catches malformed; mailto:/ftp:/https: all pass)
//   - date:  regex anchors + numeric range + LEAP YEAR check (Date constructor rolls over silently)
//   - date-time: regex with capture groups + per-field range check
//   - uuid:  case-insensitive RFC 4122 (any version 1-5)

import { makeError } from './error-utils.js';

// Pragmatic email — RFC 5322 "simple form": local@domain.tld
// Rejects whitespace, requires @ and at least one dot in domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// UUID — RFC 4122 v1-v5 (any version digit, case-insensitive).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISO 8601 calendar date YYYY-MM-DD — anchored.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// RFC 3339 date-time: YYYY-MM-DDTHH:MM:SS(.sss)?(Z|±HH:MM)
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

function isValidCalendarDate(y, m, d) {
  // Month: 1-12. Day: 1-31, with month-specific limits and leap year for Feb.
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let max = daysInMonth[m - 1];
  if (m === 2) {
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    if (isLeap) max = 29;
  }
  return d <= max;
}

export const FORMATS = {
  email: (v) => EMAIL_RE.test(v),
  uri: (v) => {
    try { new URL(v); return true; } catch { return false; }
  },
  uuid: (v) => UUID_RE.test(v),
  date: (v) => {
    const m = DATE_RE.exec(v);
    if (!m) return false;
    return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  },
  'date-time': (v) => {
    const m = DATE_TIME_RE.exec(v);
    if (!m) return false;
    const [, y, mo, d, hh, mm, ss] = m;
    if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return false;
    const H = Number(hh), M = Number(mm), S = Number(ss);
    // Allow leap second :60 per RFC 3339 §5.6.
    return H <= 23 && M <= 59 && S <= 60;
  }
};

export function validateFormat(schema, data, path, errors) {
  if (typeof schema.format !== 'string') return;
  if (typeof data !== 'string') return;          // format applies only to strings
  const checker = FORMATS[schema.format];
  if (!checker) return;                          // FMT-06: unknown format is silent
  if (!checker(data)) {
    errors.push(
      makeError(
        path,
        'format',
        `value does not match format "${schema.format}"`,
        data,
        schema.format
      )
    );
  }
}
```

### Pattern 2: CLI Entry Point

```js
#!/usr/bin/env node
// bin/whooschema.js
//
// Subcommand-via-positional pattern (parseArgs cannot do native subcommands).
// Exit codes:
//   0 — valid (CLI-01)
//   1 — invalid data (CLI-02)
//   2 — usage / load / file-read / JSON-parse error (pitfalls.md UX Pitfalls — distinguish from data-invalid)
//
// Output:
//   default (text):     "OK\n" on success, one "$path: rule — message" line per error on failure
//   --format json:      "OK\n" on success, JSON.stringify(errors) + "\n" on failure
//
// Locked design: NO commander/yargs/minimist (CLI-04). NO chalk (zero-dep).

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { validate } from '../src/validate.js';

const HELP = `Usage: whooschema validate --schema <file> --data <file> [--format text|json]

Options:
  --schema, -s <file>   Path to JSON Schema file (Draft-07 subset)
  --data,   -d <file>   Path to JSON data file to validate
  --format       <text|json>   Output format (default: text)
  --help,   -h          Show this help

Exit codes: 0=valid, 1=invalid data, 2=usage/file/parse error`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        schema: { type: 'string', short: 's' },
        data:   { type: 'string', short: 'd' },
        format: { type: 'string', default: 'text' },
        help:   { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
      strict: true
    });
  } catch (e) {
    process.stderr.write(`whooschema: ${e.message}\n${HELP}\n`);
    process.exit(2);
  }

  const { values, positionals } = parsed;

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP + '\n');
    process.exit(values.help ? 0 : 2);
  }

  if (positionals[0] !== 'validate') {
    process.stderr.write(`whooschema: unknown subcommand "${positionals[0]}"\n${HELP}\n`);
    process.exit(2);
  }

  if (!values.schema || !values.data) {
    process.stderr.write(`whooschema: --schema and --data are required\n${HELP}\n`);
    process.exit(2);
  }

  if (values.format !== 'text' && values.format !== 'json') {
    process.stderr.write(`whooschema: --format must be "text" or "json"\n`);
    process.exit(2);
  }

  // File reads + JSON parses with helpful error messages on failure.
  let schema, data;
  try {
    schema = JSON.parse(await readFile(values.schema, 'utf8'));
  } catch (e) {
    process.stderr.write(`whooschema: failed to read schema "${values.schema}": ${e.message}\n`);
    process.exit(2);
  }
  try {
    data = JSON.parse(await readFile(values.data, 'utf8'));
  } catch (e) {
    process.stderr.write(`whooschema: failed to read data "${values.data}": ${e.message}\n`);
    process.exit(2);
  }

  // Library may throw on invalid schema (bad regex, $ref cycle, dangling ref) — exit 2.
  let result;
  try {
    result = validate(schema, data);
  } catch (e) {
    process.stderr.write(`whooschema: schema error: ${e.message}\n`);
    process.exit(2);
  }

  if (result.valid) {
    process.stdout.write('OK\n');
    process.exit(0);
  }

  if (values.format === 'json') {
    process.stdout.write(JSON.stringify(result.errors) + '\n');
  } else {
    for (const err of result.errors) {
      process.stdout.write(`${err.path}: ${err.rule} — ${err.message}\n`);
    }
  }
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`whooschema: unexpected error: ${e.stack || e.message}\n`);
  process.exit(2);
});
```

### Pattern 3: Dogfood Schema for PAN's `.planning/config.json`

The actual `.planning/config.json` (verified by direct read) is:

```json
{
  "mode": "yolo",
  "depth": "quick",
  "parallelization": true,
  "commit_docs": true,
  "model_profile": "balanced",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": true
  }
}
```

Hand-written schema (`dogfood/config.schema.json`) for DOG-01:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["mode", "depth", "parallelization", "commit_docs", "model_profile", "workflow"],
  "properties": {
    "mode": { "type": "string", "enum": ["yolo", "interactive"] },
    "depth": { "type": "string", "enum": ["quick", "standard", "deep"] },
    "parallelization": { "type": "boolean" },
    "commit_docs": { "type": "boolean" },
    "model_profile": { "type": "string", "enum": ["fast", "balanced", "thorough"] },
    "workflow": {
      "type": "object",
      "required": ["research", "plan_check", "verifier", "auto_advance"],
      "properties": {
        "research": { "type": "boolean" },
        "plan_check": { "type": "boolean" },
        "verifier": { "type": "boolean" },
        "auto_advance": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

The `enum` values are inferred from the actual config + reasonable PAN conventions. The planner can adjust the enum sets after re-checking PAN docs; the schema's *structure* is what matters for DOG-01 to produce `OK`.

For DOG-02, `dogfood/config.broken.json` is a hand-edited copy with three deliberate violations:
- `"mode": "experimental"` (not in enum) → enum violation at `$.mode`
- `"depth": 5` (wrong type) → type violation at `$.depth`
- `"workflow": { "research": true }` (missing required `plan_check`/`verifier`/`auto_advance`) → required violations at `$.workflow`

This produces a **deterministic, sorted, multi-line error report** when run through the CLI in text mode, and a JSON array in `--format json` mode.

### Anti-Patterns to Avoid

- **`process.exit()` inside the library:** Only `bin/whooschema.js` calls exit. `src/*` only ever throws or returns errors. (stack.md "What NOT to Use".)
- **Compiling regex per validation call:** `EMAIL_RE`, `UUID_RE`, `DATE_RE`, `DATE_TIME_RE` are module-level constants compiled once per process (pitfalls.md Performance Trap — RegExp recompilation).
- **Setting `m` / `g` / `s` / `i` flags on user-supplied `pattern`:** Phase 1 already enforces this. Format regexes can use `i` (UUID is case-insensitive per RFC 4122 §3) — that is fine because format regexes are author-written, not user-supplied.
- **Reading `process.stdin`:** Out of scope for v1 — files-only CLI per features.md table.
- **Glob support in `--schema` / `--data`:** Out of scope — single-file invocation only.
- **Calling `process.exit(0)` after `console.log` and assuming stdout flushed:** Use `process.stdout.write(...)` (synchronous on TTY/pipe) to guarantee the output is written before exit.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email RFC parser | Full RFC 5322 grammar | Pragmatic regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | RFC-perfect is hundreds of lines AND wrong in practice (rejects what real systems accept and vice versa) — pitfalls.md Pitfall 9 |
| URI parser | Custom RFC 3986 grammar | `new URL(v)` in try/catch | Built-in, ~95% correct, zero deps, throws on invalid — verified locally |
| ISO 8601 date-time parser | Custom tokenizer/state machine | Anchored regex with capture groups + per-field numeric range check | Date constructor silently rolls over `2024-02-30` → March 1 (verified locally), so calendar validation is mandatory anyway; regex+ranges is ~20 lines |
| UUID v4 / v5 detector | Bit-pattern decoder | Case-insensitive shape regex | Spec accepts any version (1-5); only the structural shape matters; pitfalls.md Pitfall 9 |
| Argument parser | Custom `process.argv` walker | `node:util.parseArgs` (stable v20) | Locked by CLI-04; verified locally — handles short flags, defaults, positionals, strict-unknown |
| Subcommand router | argparse-style parser | First positional + switch | parseArgs cannot do native subcommands; `if (positionals[0] === 'validate')` is sufficient for one subcommand |
| Help text generator | Library-driven | Static `HELP` string | One subcommand, four flags — manual formatting is shorter than any generator config |
| Bench harness | `tinybench` / `benchmark.js` | `Date.now()` deltas in a single hot loop | Success criterion explicitly says "measured with `Date.now()`"; only need a single pass/fail threshold check |
| Color output | `chalk` / `kleur` | Plain text | Zero-dep constraint; CLI is for piped/CI use, color is noise |

**Key insight:** Phase 3 has the highest "tempting to npm install" surface in the project. Every row above is a place where the zero-dep constraint forces a smaller, simpler solution that is good enough. The validator domain is well-defined; perfect format compliance is unattainable anyway (pitfalls.md Pitfall 9), so pragmatic stops are the right answer.

---

## Common Pitfalls (Phase 3 specific — see pitfalls.md for full catalog)

The pitfalls that **must** be addressed in Phase 3 task design and verification:

| # | Pitfall | Phase 3 Mitigation |
|---|---------|--------------------|
| 9 | Format over/under-engineering | Adopt the "defensible pragmatic" formulas above. Test each format with one obvious-fail and one obvious-pass case (the SC-1 list); document the limitation in a code comment so v2 contributors know not to "fix" by adding RFC compliance. |
| 9a | `new Date('2024-02-30')` rolls over silently | **NEVER** rely on the Date constructor for `format: date` validation. Use anchored regex + `isValidCalendarDate(y, m, d)` with leap-year math. Test: `validate({format:'date'}, '2024-02-30')` must return `{valid:false}`. (Verified locally — `new Date('2024-02-30')` → `Mar 1 2024`.) |
| 9b | `URL` constructor accepts mailto/ftp | `new URL('mailto:a@b')` returns OK — this is **correct** for `format: uri`. Test that `'not a url'` fails (throws). Do not over-restrict to http/https. |
| 9c | Unknown format silent-pass | Per spec, `format: "phone"` must NOT cause an error. The format dispatcher must short-circuit when `FORMATS[name]` is undefined. Test: `validate({format:'phone'}, 'anything')` returns `{valid:true}`. |
| 9d | UUID version restriction | RFC 4122 v1-v5 all valid per spec. Do not narrow to v4. Test: a v1 UUID (`...-1xxx-...`) and a v4 UUID (`...-4xxx-...`) both pass; a non-UUID string fails. |
| - | CLI exit code conflation | Distinguish 0 (valid) / 1 (invalid data) / 2 (usage / file / schema error) — pitfalls.md UX Pitfalls. CI scripts depend on this distinction. |
| - | CLI piped output trailing newline | Always emit exactly one `\n` after the JSON array in `--format json`. Test by capturing stdout and asserting `endsWith('\n')` and that `JSON.parse(stdout)` succeeds. |
| - | Performance: regex compiled per call | `formats.js` has module-level `const EMAIL_RE = ...` etc. Failing this would re-compile on every string check, multiplying perf cost; verified by direct review of the formats.js plan example above. |
| - | Performance: error sort inside `validateNode` | Sort happens once in `validate()` after all errors collected (already the case in Phase 1+2). Phase 3 must NOT change this. |

Pitfalls 1, 2, 3, 4, 5, 6, 7, 8, 10, 11 are Phase 1/2 concerns and should already be mitigated — verify by ensuring all 61 existing tests still pass after Phase 3.

---

## Code Examples

### Validate format inside `validateString` (FMT-01..06 plug-in point)

```js
// src/keyword-handlers.js — validateString modification (Phase 3)
import { makeError, appendKey, appendIndex } from './error-utils.js';
import { validateNode } from './validator-core.js';
import { validateFormat } from './formats.js';   // NEW

export function validateString(schema, data, path, errors) {
  if (typeof data !== 'string') return;

  // ... existing minLength / maxLength / pattern checks (lines 64-100, unchanged) ...

  // NEW (Phase 3): format check after pattern.
  validateFormat(schema, data, path, errors);
}
```

### Test pattern for FMT-01..06 — `test/format.test.js`

```js
// test/format.test.js — Phase 3 format coverage
// Closes FMT-01..06 + SC-1 (5-format pass/fail matrix + unknown-format silent ignore).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validate.js';

// FMT-01 — email
test('FMT-01: email accepts a@b.c', () => {
  const r = validate({ format: 'email' }, 'a@b.c');
  assert.equal(r.valid, true);
});
test('FMT-01: email rejects "not-an-email"', () => {
  const r = validate({ format: 'email' }, 'not-an-email');
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].rule, 'format');
  assert.equal(r.errors[0].expected, 'email');
});

// FMT-02 — uri
test('FMT-02: uri accepts https://example.com/path', () => {
  assert.equal(validate({ format: 'uri' }, 'https://example.com/path').valid, true);
});
test('FMT-02: uri rejects "not a url"', () => {
  assert.equal(validate({ format: 'uri' }, 'not a url').valid, false);
});

// FMT-03 — date with calendar validation (Pitfall 9a)
test('FMT-03: date accepts 2024-01-15', () => {
  assert.equal(validate({ format: 'date' }, '2024-01-15').valid, true);
});
test('FMT-03: date rejects 2024-02-30 (calendar)', () => {
  assert.equal(validate({ format: 'date' }, '2024-02-30').valid, false);
});
test('FMT-03: date accepts leap day 2024-02-29', () => {
  assert.equal(validate({ format: 'date' }, '2024-02-29').valid, true);
});
test('FMT-03: date rejects non-leap 2023-02-29', () => {
  assert.equal(validate({ format: 'date' }, '2023-02-29').valid, false);
});

// FMT-04 — date-time
test('FMT-04: date-time accepts 2024-01-15T12:00:00Z', () => {
  assert.equal(validate({ format: 'date-time' }, '2024-01-15T12:00:00Z').valid, true);
});
test('FMT-04: date-time rejects 2024-01-15T25:00:00Z (hour >23)', () => {
  assert.equal(validate({ format: 'date-time' }, '2024-01-15T25:00:00Z').valid, false);
});

// FMT-05 — uuid
test('FMT-05: uuid accepts a v4 UUID', () => {
  assert.equal(validate({ format: 'uuid' }, '550e8400-e29b-41d4-a716-446655440000').valid, true);
});
test('FMT-05: uuid rejects a non-UUID string', () => {
  assert.equal(validate({ format: 'uuid' }, 'not-a-uuid').valid, false);
});

// FMT-06 — unknown format silent-pass
test('FMT-06: unknown format "phone" silently passes', () => {
  const r = validate({ format: 'phone' }, 'whatever');
  assert.equal(r.valid, true);
});

// Format applies only to strings (per spec)
test('format on non-string is a no-op', () => {
  const r = validate({ format: 'email' }, 42);
  assert.equal(r.valid, true);
});
```

### Test pattern for CLI — `test/cli.test.js`

CLI tests use `node:child_process` to spawn the actual binary in a subprocess and assert on stdout/exit code. This is one of the few places where a test reaches into the filesystem (writes temporary fixtures) — that is acceptable in T1 unit tests because there is no external service; only the local node process and the local FS.

```js
// test/cli.test.js — Phase 3 CLI coverage
// Closes CLI-01..04 by spawning the actual bin/whooschema.js and asserting
// on stdout/stderr/exit code. Uses node:child_process.spawn + node:fs/promises
// for fixtures; no external infra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'bin', 'whooschema.js');
const TMP = resolve(__dirname, '..', '.tmp-cli');

async function fixture(name, content) {
  await mkdir(TMP, { recursive: true });
  const p = resolve(TMP, name);
  await writeFile(p, JSON.stringify(content));
  return p;
}

test.before(async () => { await mkdir(TMP, { recursive: true }); });
test.after(async () => { await rm(TMP, { recursive: true, force: true }); });

test('CLI-01: valid data exits 0 and prints OK', async () => {
  const sp = await fixture('s.json', { type: 'string' });
  const dp = await fixture('d.json', 'hello');
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK\s*$/);
});

test('CLI-02: invalid data exits 1 with one line per error', async () => {
  const sp = await fixture('s.json', { type: 'string' });
  const dp = await fixture('d.json', 42);
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\$.*type.*expected string/i);
});

test('CLI-03: --format json emits a parseable JSON array', async () => {
  const sp = await fixture('s.json', { type: 'string' });
  const dp = await fixture('d.json', 42);
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].rule, 'type');
});

test('CLI: unknown subcommand exits 2 with help', async () => {
  const r = spawnSync('node', [CLI, 'foo'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('CLI: file not found exits 2', async () => {
  const r = spawnSync('node', [CLI, 'validate', '--schema', '/nonexistent', '--data', '/nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('CLI: schema with bad regex exits 2 (schema error, not data error)', async () => {
  const sp = await fixture('s.json', { pattern: '[' });
  const dp = await fixture('d.json', 'x');
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
  assert.equal(r.status, 2, 'schema error must NOT use exit 1 (data-invalid)');
});

// CLI-04 — verified by code review (no commander/yargs/minimist in package.json
// dependencies; bin/whooschema.js imports only from 'node:util'). No runtime test needed.
```

### Test pattern for dogfood — `test/dogfood.test.js`

```js
// test/dogfood.test.js — DOG-01 + DOG-02
// Validates PAN's actual .planning/config.json against dogfood/config.schema.json,
// and a deliberately-broken copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validate } from '../src/validate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(p) {
  return JSON.parse(await readFile(resolve(root, p), 'utf8'));
}

test('DOG-01: PAN .planning/config.json is valid against dogfood schema', async () => {
  const schema = await readJson('dogfood/config.schema.json');
  const data = await readJson('.planning/config.json');
  const r = validate(schema, data);
  assert.equal(r.valid, true, 'errors: ' + JSON.stringify(r.errors, null, 2));
});

test('DOG-02: deliberately-broken config produces deterministic error paths', async () => {
  const schema = await readJson('dogfood/config.schema.json');
  const data = await readJson('dogfood/config.broken.json');
  const r = validate(schema, data);
  assert.equal(r.valid, false);
  // At least the three deliberate violations:
  const paths = r.errors.map(e => e.path).sort();
  assert.ok(paths.some(p => p === '$.mode'),  'missing $.mode error');
  assert.ok(paths.some(p => p === '$.depth'), 'missing $.depth error');
  assert.ok(paths.some(p => p.startsWith('$.workflow')), 'missing $.workflow error(s)');
});
```

### Benchmark script — `scripts/bench.js`

```js
// scripts/bench.js — PERF-01 proof
// Generates a 1MB synthetic JSON document and validates it against a 200-line
// synthetic schema. Asserts wall-clock time < 200ms using Date.now() deltas.

import { validate } from '../src/validate.js';

function buildSchema() {
  // Reach ~200 lines by stamping a property block 30x with mixed type/format/pattern.
  const props = {};
  for (let i = 0; i < 30; i++) {
    props[`field_${i}`] = {
      type: 'object',
      properties: {
        id:     { type: 'string', format: 'uuid' },
        email:  { type: 'string', format: 'email' },
        count:  { type: 'integer', minimum: 0, maximum: 1000000 },
        tags:   { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
        nested: { type: 'object', properties: { a: { type: 'string', pattern: '^[a-z]+$' } } }
      },
      required: ['id', 'email', 'count']
    };
  }
  return { type: 'object', properties: props };
}

function buildData(targetBytes) {
  const out = {};
  let i = 0;
  while (JSON.stringify(out).length < targetBytes) {
    out[`field_${i % 30}_${i}`] = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'a@b.io',
      count: i % 1000,
      tags: ['x', 'y'],
      nested: { a: 'hello' }
    };
    i++;
  }
  return out;
}

const schema = buildSchema();
const data = buildData(1024 * 1024); // 1MB

// Warmup pass — primes any caches; matches real-world steady-state.
validate(schema, data);

const t0 = Date.now();
const r = validate(schema, data);
const elapsed = Date.now() - t0;

console.log(`[bench] doc=${JSON.stringify(data).length} bytes  errors=${r.errors.length}  time=${elapsed}ms`);

if (elapsed >= 200) {
  console.error(`[bench] FAIL: ${elapsed}ms exceeds 200ms PERF-01 budget`);
  process.exit(1);
}
console.log('[bench] OK — under 200ms PERF-01 budget');
```

---

## Suggested Plan Split

Three sequential plans, mirrors Phase 2's pattern:

### Plan 03-01 — Formats (Wave 1)

**Files:** `src/formats.js` (NEW), `src/keyword-handlers.js` (one-line addition).
**Closes:** FMT-01..06.
**Tests:** none yet — Plan 03-03 writes the test suite.
**Independently verifiable:** Quick smoke check `validate({format:'email'}, 'not-an-email').valid === false` after Plan 03-01.

### Plan 03-02 — CLI + dogfood schema (Wave 2, depends on 03-01)

**Files:**
- `bin/whooschema.js` (NEW, with shebang)
- `dogfood/config.schema.json` (NEW)
- `dogfood/config.broken.json` (NEW)
- `package.json` (add `bin` field)

**Closes:** CLI-01..04, prerequisites for DOG-01/DOG-02 (the schemas exist; tests come in 03-03).
**Independently verifiable:** `node bin/whooschema.js validate --schema dogfood/config.schema.json --data .planning/config.json` prints `OK` and exits 0.

### Plan 03-03 — Tests + benchmark (Wave 3, depends on 03-01 + 03-02)

**Files:**
- `test/format.test.js` (NEW — ~14 tests)
- `test/cli.test.js` (NEW — ~6 tests)
- `test/dogfood.test.js` (NEW — 2 tests)
- `scripts/bench.js` (NEW — PERF-01 proof)

**Closes:** verifies FMT-01..06 (already implemented); DOG-01, DOG-02; PERF-01.
**Independently verifiable:** `node --test` shows all 80+ tests pass; `node scripts/bench.js` exits 0.

### Why three plans, not one or two

- **Splitting the formats from the CLI** (rather than one mega-plan) means Plan 03-01 is reviewable in isolation — formats are pure functions with a clean test surface. CLI work (file I/O, exit codes, subprocess testing) is qualitatively different and benefits from focused review.
- **Tests in their own plan (03-03)** matches Phase 1/2 precedent (`01-03-plan` and `02-03-tests-...-plan`). It keeps test-writing focused and lets the implementation plans (03-01, 03-02) be smaller/simpler.

---

## State of the Art

(See `.planning/research/stack.md` and `.planning/research/features.md` — no Phase 3 specific deltas. The "format validators are pluggable" model is current best practice; ajv-formats v3 follows the same shape as the dogfood map proposed here.)

---

## Open Questions

1. **Should we publish the binary to npm registry as part of Phase 3?**
   - What we know: `package.json` has `"bin"` set up correctly with `"publishConfig": { "provenance": true }`; `npm publish` would work once `bin/whooschema.js` exists.
   - What's unclear: project state.md does not mark "publish to npm" as an active todo; it only mentions ESM/CJS interop verification ("can ship CJS and migrate to ESM in v1.x if needed").
   - **Recommendation:** Phase 3 ships the binary in-repo and via `npm link` only. Actual npm registry publish is post-Phase-3 (a v0.2 or v1.0 release event). Document in README.

2. **Should the bench script be wired into `npm test`?**
   - What we know: `node --test` runs all `test/**/*.test.js`. The bench script lives in `scripts/` so it is NOT picked up automatically.
   - What's unclear: PERF-01 says "validate ... in under 200ms (measured with Date.now() in the benchmark script)" — implies a separate script, not a test.
   - **Recommendation:** Keep `scripts/bench.js` separate from `npm test`. Add `npm run bench` script in `package.json` for one-shot measurement and CI gating. The phase verification step runs `node scripts/bench.js` once and asserts exit 0.

3. **Should the dogfood `config.schema.json` constrain `enum` values for `mode` / `depth` / `model_profile`?**
   - What we know: The actual config has `"mode":"yolo"`, `"depth":"quick"`, `"model_profile":"balanced"`. PAN convention suggests enums but they are not formally documented in `.planning/config.json` schema.
   - What's unclear: Whether other modes/depths/profiles are valid PAN values.
   - **Recommendation:** Use enums based on observed values + likely PAN conventions (`yolo`/`interactive`, `quick`/`standard`/`deep`, `fast`/`balanced`/`thorough`). If the planner finds PAN docs that contradict, adjust. The `additionalProperties:false` on `workflow` is the contract that matters most for DOG-01 (catches typos in workflow keys).

4. **Should the CLI support `--format text|json` aliasing or any output customization?**
   - **Recommendation:** No — strict `text` (default) and `json` per CLI-03. Stretch features (yaml, junit, sarif) are post-v1.

5. **Should `--help` and `--version` be mandatory?**
   - What we know: stack.md mentions hand-writing `printHelp()`. CLI-04 only requires `parseArgs`-only.
   - **Recommendation:** Implement `--help` (lightweight, improves UX). Skip `--version` — `package.json` version reading adds complexity for low value in v1; users can `cat package.json | grep version`. Add `--version` in v1.x.

---

## Validation Architecture

> `workflow.nyquist_validation` is NOT set in `.planning/config.json` — defaults to false. **Section omitted per pan-phase-researcher template rule.**

If you turn nyquist on later: framework is `node --test` (no config file), quick run is `node --test test/<single>.test.js`, full suite is `node --test`, all tests are unit-tier T1 — no infrastructure. Bench is a separate manual run via `node scripts/bench.js`.

---

## Sources

### Primary (HIGH confidence)
- `.planning/research/architecture.md` — `formats.js` as pure map; `bin/whooschema.js` as thin CLI shell over `validate()`; module layout diagram
- `.planning/research/features.md` — Format Validators table (5 formats cover ~90%); CLI Feature Expectations table (matches ajv-cli pattern)
- `.planning/research/stack.md` — `util.parseArgs` capabilities (verified locally); shebang + `bin` field convention; what NOT to use (`commander`, `chalk`, etc.)
- `.planning/research/pitfalls.md` — Pitfall 9 (format over/under-engineering); CLI exit-code distinction (UX Pitfalls); RegExp recompile (Performance Traps); `new Date()` rollover (Integration Gotchas)
- `src/keyword-handlers.js`, `src/schema-loader.js`, `src/validate.js`, `src/validator-core.js` — Phase 1+2 implementation (line references verified by direct read)
- `.planning/requirements.md` — FMT-01..06, CLI-01..04, DOG-01..02, PERF-01 definitions
- `.planning/roadmap.md` — Phase 3 success criteria SC-1..4
- `.planning/config.json` — verified shape used to build dogfood schema
- JSON Schema Draft-07 spec — `format` keyword as annotation by default; unknown format silent-pass (HIGH confidence, stable spec)
- RFC 3339 §5.6 — date-time grammar (HIGH confidence)
- RFC 4122 §3 — UUID structure (case-insensitive shape; v1-v5 versions)
- Node.js docs — `util.parseArgs`, `URL` constructor, `fs/promises`, `child_process.spawnSync` (HIGH confidence — verified locally where applicable)

### Secondary (MEDIUM confidence)
- ajv-formats source — what other implementations choose for the 5 standard formats (referenced in features.md table)
- ajv-cli — CLI conventions for validators (referenced in features.md table)

### Tertiary (LOW confidence)
- None. Phase 3 surface is fully covered by HIGH/MEDIUM-confidence sources, and the live verification (URL/Date constructor behavior, parseArgs subcommand pattern) confirmed the design choices on this machine.

---

## Infrastructure Dependencies

**None.** Phase 3 is a pure-computation library + a local CLI binary. All tests are T1 unit tests via `node --test`. CLI tests spawn local node processes via `node:child_process` — no Docker, no external services, no network calls. `bin/whooschema.js` only reads two local files passed by the user; no environment variables, no IPC, no daemons.

---

## Metadata

**Confidence breakdown:**
- Format validators: HIGH — pseudocode verified against pitfalls.md; URL/Date constructor edge cases verified by local execution; spec references checked
- CLI design: HIGH — `parseArgs` capabilities verified locally including subcommand-via-positional pattern; exit-code distinction documented in pitfalls.md UX Pitfalls
- Dogfood schema: HIGH — actual `.planning/config.json` shape confirmed by direct read; schema is a straightforward enumeration of its fields
- Performance approach: MEDIUM — architecture.md asserts "well under 200ms" for interpretive walk; not yet measured on this codebase. Bench script will be the proof. If PERF-01 fails, the most likely cause is per-call regex recompile in `validateString` for `pattern` — the planner should verify the existing code already lifts these (line 88 of `keyword-handlers.js` recompiles per call — flag for optimization in Plan 03-03 if bench fails)
- Integration points: HIGH — all file:line references verified by direct read of Phase 1+2 source

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (30 days — zero external dependencies; no fast-moving ecosystem)

---

*Phase research for: 03-formats-cli-dogfood*
*Researched: 2026-05-02 — delta on top of project-level research*
