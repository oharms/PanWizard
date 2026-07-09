---
phase: 03-formats-cli-dogfood
plan: 03
type: execute
wave: 3
depends_on: ["01", "02"]
files_modified:
  - test/format.test.js
  - test/cli.test.js
  - test/dogfood.test.js
  - scripts/bench.js
  - package.json
autonomous: true
requirements: [PERF-01]
change_class: feature

must_haves:
  truths:
    - "test/format.test.js exists with at least 14 tests covering FMT-01..06 + leap-year math + non-string no-op; all pass via `node --test test/format.test.js`"
    - "test/cli.test.js exists with at least 6 tests covering CLI-01..04 + schema-error exit-2 + file-not-found exit-2; all pass via `node --test test/cli.test.js`"
    - "test/dogfood.test.js exists with 2 tests: DOG-01 (real .planning/config.json validates clean) and DOG-02 (broken copy produces deterministic error paths); all pass"
    - "scripts/bench.js exists; running `node scripts/bench.js` validates a 1MB synthetic JSON doc against a 200-line synthetic schema in under 200ms (PERF-01, SC-4)"
    - "scripts/bench.js exits 0 on under-budget, exit 1 on over-budget — usable as a CI gate"
    - "Full test suite passes via `node --test`: ~80+ tests, 0 failures (Phase 1: 40 + Phase 2: 21 + format: ~14 + cli: ~6 + dogfood: 2)"
    - "package.json declares `bench` script: `\"bench\": \"node scripts/bench.js\"`"
    - "Bench output is parseable: prints `[bench] doc=<bytes> errors=<n> time=<N>ms` then either `[bench] OK — under 200ms ...` or `[bench] FAIL: ...` to stderr"
    - "PERF-01 contingency: if the initial bench run exceeds 200ms, this plan applies the WeakMap regex-cache optimization to validateString in src/keyword-handlers.js line 88 (per 03-research.md §Metadata) and re-runs to confirm under-budget"
  artifacts:
    - path: "test/format.test.js"
      provides: "FMT-01..06 + leap-year + non-string no-op coverage (~14 tests)"
      min_lines: 80
    - path: "test/cli.test.js"
      provides: "CLI-01..04 + schema-error exit-2 + file-not-found exit-2 coverage (~6 tests)"
      min_lines: 80
    - path: "test/dogfood.test.js"
      provides: "DOG-01 (real config OK) + DOG-02 (broken copy error paths) coverage (2 tests)"
      min_lines: 35
    - path: "scripts/bench.js"
      provides: "PERF-01 proof — 1MB doc against 200-line schema under 200ms via Date.now()"
      contains: "Date.now()"
      min_lines: 50
    - path: "package.json"
      provides: "Adds bench script for CI gating; no new dependencies"
      contains: "\"bench\""
      min_lines: 22
  key_links:
    - from: "test/format.test.js"
      to: "src/validate.js"
      via: "import { validate } from '../src/validate.js'"
      pattern: "from ['\"]\\.\\./src/validate\\.js['\"]"
    - from: "test/cli.test.js"
      to: "bin/whooschema.js"
      via: "spawnSync('node', [CLI, 'validate', ...]) where CLI = resolve(__dirname,'..','bin','whooschema.js')"
      pattern: "spawnSync"
    - from: "test/dogfood.test.js"
      to: "dogfood/config.schema.json + .planning/config.json"
      via: "readFile(resolve(root, 'dogfood/config.schema.json')) and readFile(resolve(root, '.planning/config.json'))"
      pattern: "dogfood/config\\.schema\\.json"
    - from: "scripts/bench.js"
      to: "src/validate.js"
      via: "import { validate } from '../src/validate.js'"
      pattern: "from ['\"]\\.\\./src/validate\\.js['\"]"
---

<objective>
Write the Phase 3 test suite and the benchmark script. Three test files (`format.test.js`, `cli.test.js`, `dogfood.test.js`) close FMT-01..06, CLI-01..04, DOG-01, and DOG-02 in CI-friendly form (`node --test`). The benchmark script (`scripts/bench.js`) closes PERF-01 by validating a 1MB synthetic JSON document against a 200-line synthetic schema in under 200ms via `Date.now()` deltas.

Purpose: Plan 03-01 implemented formats. Plan 03-02 implemented the CLI + dogfood schemas. Both plans included smoke-test verify commands, but those are one-shot. This plan converts every Phase 3 requirement and success criterion into a repeatable, automated test that runs as part of `node --test`. After this plan, Phase 3 is demonstrably complete: all 13 phase requirements pass under CI, and the 200ms perf budget has measurable proof.

The test files mirror Phase 1/2 conventions exactly: flat `test()` calls (no describe), `node:assert/strict`, public-API-only assertions (never reach into private internals). The CLI test uses `node:child_process.spawnSync` to invoke the actual `bin/whooschema.js` binary — true E2E from arg parsing through validate() through stdout/exit-code.

Scope expansion guard: This plan adds NEW files and a NEW package.json script — it does NOT modify Phase 1+2 source files, formats.js, the CLI binary, or the dogfood schemas. The ONE exception is the PERF-01 contingency (Task 4): if the initial bench run exceeds 200ms, apply the WeakMap regex-cache optimization to `src/keyword-handlers.js` line 88 (research-identified hot spot) and re-bench. If the initial bench is already under-budget, skip Task 4 entirely.

Output:
- `test/format.test.js` (NEW) — ~14 tests, closes FMT-01..06 verification.
- `test/cli.test.js` (NEW) — ~6 tests, closes CLI-01..04 verification.
- `test/dogfood.test.js` (NEW) — 2 tests, closes DOG-01 + DOG-02 verification.
- `scripts/bench.js` (NEW) — closes PERF-01.
- `package.json` (MODIFIED) — adds `bench` script entry. No new dependencies.
- (Conditional) `src/keyword-handlers.js` — WeakMap regex cache, ONLY if Task 3's bench exceeds 200ms.
- Full suite: `node --test` reports ~80+ tests, 0 failures.
</objective>

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
</execution_context>

<context>
@.planning/project.md
@.planning/roadmap.md
@.planning/state.md
@.planning/requirements.md
@.planning/phases/03-formats-cli-dogfood/03-research.md
@.planning/research/pitfalls.md
@.planning/phases/03-formats-cli-dogfood/03-01-summary.md
@.planning/phases/03-formats-cli-dogfood/03-02-summary.md
@.planning/phases/02-composition-ref/02-03-summary.md
@src/validate.js

<interfaces>
<!-- Public API under test (locked since Phase 1+2) -->

```js
import { validate } from '../src/validate.js';
const r = validate(schema, data);
// r: { valid: boolean, errors: ValidationError[] }
// ValidationError: { path: string, rule: string, message: string, value: unknown, expected?: unknown }
```

<!-- node:test conventions (per Phase 1+2 test files — same style required) -->

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Flat test() calls — no describe blocks (matches all 10 existing test files).
```

<!-- CLI binary contract (locked by Plan 03-02) -->

```text
bin/whooschema.js
  Exit codes: 0 (valid), 1 (data-invalid), 2 (usage/file/schema-error).
  Text output: "OK\n" on success; "<path>: <rule> — <message>\n" per error.
  JSON output: "OK\n" on success; JSON.stringify(errors) + "\n" on failure.
  Reads files via node:fs/promises.readFile.
  Uses node:util.parseArgs only.
```

<!-- Dogfood files (locked by Plan 03-02) -->

```text
dogfood/config.schema.json   — hand-written schema; required: mode/depth/parallelization/commit_docs/model_profile/workflow
dogfood/config.broken.json   — 3 violations: $.mode (enum), $.depth (type), $.workflow (3 missing required keys)
.planning/config.json        — the actual PAN config (DOG-01 target)
```

<!-- Format error shape (locked by Plan 03-01) -->

```js
// On format failure, validate() pushes:
{ rule: 'format', path: '<json-path>', message: 'value does not match format "<name>"', value: <data>, expected: '<format-name>' }
```

<!-- spawnSync convention for CLI tests (verified in 03-research.md §"Test pattern for CLI") -->

```js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'bin', 'whooschema.js');
const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
// r.status, r.stdout, r.stderr — all populated synchronously.
```

<!-- PERF-01 contingency reference (only if Task 3 fails) -->

src/keyword-handlers.js line 88 currently does:
  const re = new RegExp(schema.pattern);   // recompiled per call

Optimization (apply ONLY if bench >200ms):
  const PATTERN_CACHE = new WeakMap();   // schema -> RegExp
  // ... in validateString:
  let re = PATTERN_CACHE.get(schema);
  if (!re) { re = new RegExp(schema.pattern); PATTERN_CACHE.set(schema, re); }
WeakMap keyed by `schema` (the sub-schema object) — same schema reference reused across calls hits the cache; GC works because WeakMap holds keys weakly.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write test/format.test.js — FMT-01..06 + leap year + non-string no-op (~14 tests)</name>
  <files>test/format.test.js</files>
  <action>
Create `test/format.test.js`. Follow Phase 1/2 conventions: flat `test()` calls, no describe blocks, public-API-only assertions via `validate()`. Reference: 03-research.md §"Test pattern for FMT-01..06".

Target test list (write all of these — exactly these names so Plan 03-04 verification can grep for them):

```js
// test/format.test.js — Phase 3 format coverage
// Closes FMT-01..06 + SC-1 (5-format pass/fail matrix + unknown-format silent ignore).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validate.js';

// ---------- FMT-01: email ----------
test('FMT-01: email accepts a@b.io', () => {
  const r = validate({ format: 'email' }, 'a@b.io');
  assert.equal(r.valid, true);
});
test('FMT-01: email rejects "not-an-email"', () => {
  const r = validate({ format: 'email' }, 'not-an-email');
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].rule, 'format');
  assert.equal(r.errors[0].expected, 'email');
});

// ---------- FMT-02: uri ----------
test('FMT-02: uri accepts https://example.com/path', () => {
  assert.equal(validate({ format: 'uri' }, 'https://example.com/path').valid, true);
});
test('FMT-02: uri rejects "not a url"', () => {
  assert.equal(validate({ format: 'uri' }, 'not a url').valid, false);
});

// ---------- FMT-03: date with calendar validation (Pitfall 9a) ----------
test('FMT-03: date accepts 2024-01-15', () => {
  assert.equal(validate({ format: 'date' }, '2024-01-15').valid, true);
});
test('FMT-03: date rejects 2024-02-30 (calendar — Pitfall 9a)', () => {
  // The Date constructor silently rolls 2024-02-30 to March 1; format:date MUST reject.
  assert.equal(validate({ format: 'date' }, '2024-02-30').valid, false);
});
test('FMT-03: date accepts leap day 2024-02-29', () => {
  assert.equal(validate({ format: 'date' }, '2024-02-29').valid, true);
});
test('FMT-03: date rejects non-leap-year 2023-02-29', () => {
  assert.equal(validate({ format: 'date' }, '2023-02-29').valid, false);
});

// ---------- FMT-04: date-time ----------
test('FMT-04: date-time accepts 2024-01-15T12:00:00Z', () => {
  assert.equal(validate({ format: 'date-time' }, '2024-01-15T12:00:00Z').valid, true);
});
test('FMT-04: date-time rejects 2024-01-15T25:00:00Z (hour out of range)', () => {
  assert.equal(validate({ format: 'date-time' }, '2024-01-15T25:00:00Z').valid, false);
});

// ---------- FMT-05: uuid ----------
test('FMT-05: uuid accepts a v4 UUID', () => {
  assert.equal(validate({ format: 'uuid' }, '550e8400-e29b-41d4-a716-446655440000').valid, true);
});
test('FMT-05: uuid rejects a non-UUID string', () => {
  assert.equal(validate({ format: 'uuid' }, 'not-a-uuid').valid, false);
});

// ---------- FMT-06: unknown format silent-pass ----------
test('FMT-06: unknown format "phone" silently passes (per spec)', () => {
  const r = validate({ format: 'phone' }, 'whatever');
  assert.equal(r.valid, true);
});

// ---------- format applies only to strings ----------
test('format on non-string is a no-op (number)', () => {
  const r = validate({ format: 'email' }, 42);
  assert.equal(r.valid, true);
});
```

Implementation notes:
- The test names MUST match exactly (Plan 03-verification can grep for `'FMT-01:'`, `'FMT-02:'`, etc.).
- Use `node:assert/strict` (not `node:assert`).
- Test count: 14. This alone exceeds TEST-01's >=14 requirement (Phase 1 already met it); these add Phase 3 coverage.
- File expected size: 80-110 lines including header comment.
- DO NOT import from `../src/formats.js` directly — assertions go through the public API (`validate`).

Commit message: `test(phase-03-03): add test/format.test.js — FMT-01..06 + leap year + non-string no-op`
  </action>
  <verify>
    <automated tier="T1">node --test test/format.test.js</automated>
  </verify>
  <done>`test/format.test.js` exists with 14 passing tests via `node --test test/format.test.js` (0 failures, 0 skipped). FMT-01..06 each have at least one passing-case and one failing-case test. SC-1 (5-format pass/fail matrix) is fully covered. Pitfall 9a (date 2024-02-30 must fail despite Date constructor rolling) has a dedicated test. The leap-year math is exercised by 2024-02-29 (valid) and 2023-02-29 (invalid). The non-string no-op case is covered. The change is committed as one atomic commit.</done>
</task>

<task type="auto">
  <name>Task 2: Write test/cli.test.js + test/dogfood.test.js — CLI-01..04 + DOG-01 + DOG-02 (~8 tests total)</name>
  <files>test/cli.test.js, test/dogfood.test.js</files>
  <action>
Two test files in this single task — they share the same setup pattern (read files, possibly spawn the CLI), and they're tightly tied to Plan 03-02 artifacts. Closes CLI-01..04 + DOG-01 + DOG-02 in CI-friendly form.

**Step 2a — Create `test/cli.test.js`:**

Follow the pattern from 03-research.md §"Test pattern for CLI". Spawn the actual `bin/whooschema.js` binary via `spawnSync` and assert on stdout/stderr/exit-code. This is a true E2E test — it reaches the FS and the node process boundary, but it does NOT require Docker or external services (still T1 unit tier per node:test).

Reference implementation:

```js
// test/cli.test.js — Phase 3 CLI coverage
// Closes CLI-01..04 by spawning bin/whooschema.js and asserting on stdout/exit.
// Uses node:child_process.spawnSync + node:fs/promises for fixtures; no external infra.

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

test('CLI-01: valid data exits 0 and stdout is "OK"', async () => {
  const sp = await fixture('s.json', { type: 'string' });
  const dp = await fixture('d.json', 'hello');
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK\s*$/);
});

test('CLI-02: invalid data exits 1 with one human-readable line per error', async () => {
  const sp = await fixture('s.json', { type: 'string' });
  const dp = await fixture('d.json', 42);
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  // Path: '$' rule: 'type' message contains 'expected string'
  assert.match(r.stdout, /\$:\s*type/);
});

test('CLI-03: --format json emits a parseable JSON array on failure', async () => {
  const sp = await fixture('s.json', { type: 'string' });
  const dp = await fixture('d.json', 42);
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  // Stdout must end with exactly one trailing newline AND parse cleanly.
  assert.ok(r.stdout.endsWith('\n'), 'must end with newline: ' + JSON.stringify(r.stdout));
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed), 'must be JSON array');
  assert.equal(parsed[0].rule, 'type');
});

test('CLI: unknown subcommand exits 2', async () => {
  const r = spawnSync('node', [CLI, 'foo'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('CLI: file not found exits 2 (file error, NOT data-invalid)', async () => {
  const r = spawnSync('node', [CLI, 'validate', '--schema', '/nonexistent', '--data', '/nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('CLI: schema with bad regex exits 2 (schema error, NOT data-invalid)', async () => {
  const sp = await fixture('s.json', { pattern: '[' });
  const dp = await fixture('d.json', 'x');
  const r = spawnSync('node', [CLI, 'validate', '--schema', sp, '--data', dp], { encoding: 'utf8' });
  // CRITICAL: schema-load errors must NOT use exit 1 (data-invalid).
  // CI scripts depend on this distinction.
  assert.equal(r.status, 2, 'schema error must exit 2, got: ' + r.status);
});

// CLI-04 — verified by code review (no commander/yargs/minimist in package.json
// dependencies; bin/whooschema.js imports only from 'node:util').
test('CLI-04: bin imports only built-ins + ../src/validate.js (zero-dep CLI)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(CLI, 'utf8');
  // No 'commander', 'yargs', 'minimist', 'chalk', 'kleur' anywhere in the binary.
  for (const banned of ['commander', 'yargs', 'minimist', 'chalk', 'kleur']) {
    assert.ok(!src.includes(banned), `bin/whooschema.js must not reference "${banned}"`);
  }
  // Imports MUST include parseArgs from node:util.
  assert.match(src, /from\s+['"]node:util['"]/);
});
```

Test count: 7 (CLI-01, CLI-02, CLI-03, unknown subcommand, file-not-found, schema-error, CLI-04 zero-dep).

**Step 2b — Create `test/dogfood.test.js`:**

Reference: 03-research.md §"Test pattern for dogfood". Two tests — DOG-01 (real config validates clean) and DOG-02 (broken copy produces deterministic error paths).

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

test('DOG-01: PAN .planning/config.json is valid against dogfood/config.schema.json', async () => {
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
  // Paths covered: $.mode (enum), $.depth (type), $.workflow (multiple required).
  const paths = r.errors.map(e => e.path);
  assert.ok(paths.includes('$.mode'),  'missing $.mode error');
  assert.ok(paths.includes('$.depth'), 'missing $.depth error');
  assert.ok(paths.some(p => p.startsWith('$.workflow') || p === '$.workflow'),
            'missing $.workflow error(s): ' + JSON.stringify(paths));
  // Sanity: error count is at least 5 (1 enum + 1 type + 3 required).
  assert.ok(r.errors.length >= 5,
            `expected >=5 errors (enum + type + 3*required), got ${r.errors.length}: ` +
            JSON.stringify(r.errors.map(e => e.path + ':' + e.rule)));
});
```

Test count: 2.

Implementation notes:
- DO NOT pretty-print JSON in fixture writes — `JSON.stringify(content)` (no indent) — matches CLI's compact-JSON output behavior.
- The `test.before` / `test.after` hooks ensure the `.tmp-cli` directory is cleaned up even if a test throws.
- Use `assert.match` for regex matching, `assert.equal` for strict equality.
- The em-dash `—` in CLI text output may use either `—` (U+2014) or `-` (U+002D) depending on locale. The CLI was specified with `—`, so the regex `/\$:\s*type/` is intentionally lenient — it asserts the path/rule prefix without locking the dash character.
- File expected size: cli.test.js ~95-115 lines; dogfood.test.js ~35-50 lines.
- DO NOT modify the CLI binary or the dogfood schemas in this task. The tests must pass against the CURRENT artifacts from Plan 03-02. If a test fails, the bug is most likely in the test (regex too strict, wrong path expectation) — investigate the test first.

After both files exist, run the FULL suite from project root: `node --test`. Expected: ~80 passing tests, 0 failures.
- Phase 1: 40
- Phase 2: 21
- Phase 3 format: 14
- Phase 3 cli: 7
- Phase 3 dogfood: 2
- Total: ~84

Commit message: `test(phase-03-03): add test/cli.test.js + test/dogfood.test.js — CLI-01..04 + DOG-01 + DOG-02`
  </action>
  <verify>
    <automated tier="T1">node --test test/cli.test.js test/dogfood.test.js &amp;&amp; node --test</automated>
  </verify>
  <done>`test/cli.test.js` exists with 7 passing tests covering CLI-01, CLI-02, CLI-03, unknown subcommand (exit 2), file-not-found (exit 2), schema-error (exit 2 — distinct from data-invalid), CLI-04 (binary contains no commander/yargs/minimist/chalk references and imports `node:util`). `test/dogfood.test.js` exists with 2 passing tests: DOG-01 (real `.planning/config.json` validates clean against `dogfood/config.schema.json`) and DOG-02 (broken copy produces error paths covering `$.mode`, `$.depth`, and `$.workflow`, with >=5 errors). Full suite passes via `node --test`: ~84 tests, 0 failures, 0 skipped (Phase 1: 40 + Phase 2: 21 + format: 14 + cli: 7 + dogfood: 2). The `.tmp-cli` directory is cleaned up after each test run. The change is committed as one atomic commit.</done>
</task>

<task type="auto">
  <name>Task 3: Write scripts/bench.js + add `bench` script to package.json — PERF-01 proof</name>
  <files>scripts/bench.js, package.json</files>
  <action>
Create the benchmark script that proves PERF-01 (1MB JSON / 200-line schema validates in <200ms via `Date.now()`). Reference: 03-research.md §"Benchmark script — `scripts/bench.js`".

**Step 3a — Create `scripts/bench.js`:**

```js
// scripts/bench.js — PERF-01 proof
// Generates a 1MB synthetic JSON document and validates it against a 200-line
// synthetic schema. Asserts wall-clock time < 200ms using Date.now() deltas.
//
// Usage:
//   node scripts/bench.js
// Output:
//   [bench] doc=<bytes> errors=<n> time=<N>ms
//   [bench] OK — under 200ms PERF-01 budget    (exit 0)
//   [bench] FAIL: <N>ms exceeds 200ms PERF-01 budget   (exit 1, on stderr)
//
// PERF-01 / SC-4 contract: must exit 0 with elapsed < 200ms on a typical dev machine.

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

**Step 3b — Add `bench` script to `package.json`:**

Read the current `package.json` first, then add `"bench": "node scripts/bench.js"` to the `scripts` block. Keep the `test` script unchanged.

Final `package.json` `scripts` block:

```json
"scripts": {
  "test": "node --test",
  "bench": "node scripts/bench.js"
}
```

The full `package.json` (write whole file):

```json
{
  "name": "whooschema",
  "version": "0.1.0",
  "description": "Zero-dependency JSON Schema Draft-07 validator with JSONPath error paths",
  "type": "module",
  "engines": { "node": ">=18" },
  "license": "MIT",
  "main": "./src/validate.js",
  "bin": { "whooschema": "./bin/whooschema.js" },
  "exports": {
    ".": {
      "import": "./src/validate.js",
      "types": "./index.d.ts"
    }
  },
  "types": "./index.d.ts",
  "files": ["src/", "bin/", "index.d.ts"],
  "scripts": {
    "test": "node --test",
    "bench": "node scripts/bench.js"
  },
  "keywords": ["json-schema", "validation", "jsonpath", "zero-dependencies"],
  "publishConfig": { "provenance": true }
}
```

**Step 3c — Run the bench and observe the result.**

Run: `node scripts/bench.js`

Three possible outcomes:
1. **Bench prints `[bench] OK — under 200ms ...` and exits 0** → SUCCESS. PERF-01 is closed. Skip Task 4 entirely. Commit and proceed.
2. **Bench prints `[bench] FAIL: <N>ms exceeds 200ms ...` and exits 1** → contingency triggered. Proceed to Task 4 (regex-cache optimization), then re-run bench. Document the before/after times in the summary.
3. **Bench errors out with a thrown exception** → bug in the bench script or in the library. Investigate; do NOT skip the requirement.

DO NOT modify the bench script's shape (the success-criterion specifies `Date.now()` measurement explicitly). DO NOT add `tinybench` or any other dep — `Date.now()` deltas are the contract.

DO NOT wire `bench` into `npm test` — bench is not a unit test (per 03-research.md §"Open Questions" Q2).

Commit message: `feat(phase-03-03): add scripts/bench.js + bench package script (PERF-01 proof)`
  </action>
  <verify>
    <automated tier="T1">node scripts/bench.js &amp;&amp; node -e "const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8')); if (pkg.scripts.bench !== 'node scripts/bench.js') throw new Error('bench script missing or wrong: ' + pkg.scripts.bench); if (pkg.scripts.test !== 'node --test') throw new Error('test script regressed: ' + pkg.scripts.test); if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) throw new Error('zero-dep violation: ' + JSON.stringify(pkg.dependencies)); console.log('OK bench script + package.json wired correctly');"</automated>
  </verify>
  <done>`scripts/bench.js` exists. Running `node scripts/bench.js` either: (a) prints `[bench] doc=<bytes> errors=<n> time=<N>ms` followed by `[bench] OK — under 200ms PERF-01 budget` and exits 0 — PERF-01 closed; OR (b) prints the diagnostic line and `[bench] FAIL` to stderr and exits 1 — Task 4 must run next. `package.json` has `"bench": "node scripts/bench.js"` in scripts; `npm run bench` works. The change is committed as one atomic commit. **Document the observed elapsed time in the summary** so the gap between observed and budget is transparent.</done>
</task>

<task type="auto">
  <name>Task 4 (CONDITIONAL): WeakMap regex cache in keyword-handlers.js — only run if Task 3 bench exceeded 200ms</name>
  <files>src/keyword-handlers.js</files>
  <action>
**SKIP THIS TASK if Task 3's bench printed `[bench] OK — under 200ms`.** PERF-01 is already closed; this optimization is not needed. Proceed directly to the verification section below.

**Run this task ONLY if Task 3's bench printed `[bench] FAIL: <N>ms exceeds 200ms`.**

The most likely hot spot per 03-research.md §Metadata is the per-call `new RegExp(schema.pattern)` on line 88 of `src/keyword-handlers.js` inside `validateString`. The 200-line synthetic schema in `scripts/bench.js` includes `pattern: '^[a-z]+$'` and 30 distinct field shapes, so each validate() call recompiles patterns hundreds of times.

**The fix — WeakMap regex cache.**

Step 1: Add a module-level WeakMap declaration near the top of `src/keyword-handlers.js`, after the imports (around line 19, after `import { validateNode } from './validator-core.js';`):

```js
// Module-level cache: schema sub-object -> compiled RegExp.
// WeakMap holds keys weakly so GC reclaims cache entries when the schema is dropped.
// Schemas are typically reused across many validate() calls, so this turns a
// per-call new RegExp(...) into a one-time cost per (schema, pattern) pair.
// PERF-01 mitigation per .planning/research/pitfalls.md (Performance Traps).
const PATTERN_CACHE = new WeakMap();
```

Step 2: Modify the `pattern` block in `validateString` (currently lines 86-100). The current code is:

```js
if (typeof schema.pattern === 'string') {
  // Pattern was already validated at schema-load — safe to compile here, no flags.
  const re = new RegExp(schema.pattern);
  if (!re.test(data)) {
    errors.push(
      makeError(
        path,
        'pattern',
        `string does not match pattern "${schema.pattern}"`,
        data,
        schema.pattern
      )
    );
  }
}
```

Change to (cache lookup with miss fallback):

```js
if (typeof schema.pattern === 'string') {
  // Pattern was already validated at schema-load — safe to compile here, no flags.
  // Cache by schema reference so repeat validate() calls reuse the compiled regex.
  let re = PATTERN_CACHE.get(schema);
  if (!re) {
    re = new RegExp(schema.pattern);
    PATTERN_CACHE.set(schema, re);
  }
  if (!re.test(data)) {
    errors.push(
      makeError(
        path,
        'pattern',
        `string does not match pattern "${schema.pattern}"`,
        data,
        schema.pattern
      )
    );
  }
}
```

Step 3: Apply the same pattern in `validateObject` for `patternProperties` (lines 264-275). The current code is:

```js
const compiledPatterns = [];
if (schema.patternProperties) {
  for (const [pattern, subSchema] of Object.entries(schema.patternProperties)) {
    const re = new RegExp(pattern); // safe — already validated at load
    compiledPatterns.push({ re, subSchema });
    // ...
  }
}
```

This is harder to cache because `patternProperties` is a map and the regex key is a string, not an object. Skip this if Task 3's bench passed under 200ms after only the validateString fix is applied. If the bench STILL fails after the validateString fix, add a second-level cache:

```js
// PATTERN_PROP_CACHE: schema (the patternProperties parent object) -> Map<string, RegExp>
// Outer WeakMap GC's when the parent schema is dropped; inner Map keeps regex per pattern key.
const PATTERN_PROP_CACHE = new WeakMap();
// ...
let patternPropMap = PATTERN_PROP_CACHE.get(schema.patternProperties);
if (!patternPropMap) {
  patternPropMap = new Map();
  PATTERN_PROP_CACHE.set(schema.patternProperties, patternPropMap);
}
for (const [pattern, subSchema] of Object.entries(schema.patternProperties)) {
  let re = patternPropMap.get(pattern);
  if (!re) { re = new RegExp(pattern); patternPropMap.set(pattern, re); }
  // ... rest unchanged
}
```

Step 4: Re-run the full test suite. ALL 84 tests MUST still pass — the cache is a pure perf optimization, not a behavior change. If any test fails, the cache implementation has a bug — investigate before proceeding.

Step 5: Re-run `node scripts/bench.js`. The reported elapsed time should drop. If it now prints `[bench] OK — under 200ms ...` and exits 0, PERF-01 is closed.

Step 6: If the bench STILL fails after both fixes, the bottleneck is elsewhere. STOP and document the observed times + which optimizations were tried. Do NOT add more random optimizations. Update the summary with the observed regression and flag for Phase 4 / future-work investigation. (At this point, this is a research-level concern, not a planning-level concern — do not silently lower the budget.)

DO NOT change any other behavior in `keyword-handlers.js` (no new validations, no signature changes). The cache is invisible to all callers; only the wall-clock time changes.

Commit message: `perf(phase-03-03): cache compiled patterns via WeakMap to meet PERF-01 200ms budget`
  </action>
  <verify>
    <automated tier="T1">node --test &amp;&amp; node scripts/bench.js</automated>
  </verify>
  <done>SKIP CONDITIONS APPLY: if Task 3's bench passed, this task did not run and the verify command was not executed. CONDITIONAL CLOSURE: if Task 3's bench failed and this task ran, then `src/keyword-handlers.js` declares `PATTERN_CACHE` (WeakMap, module-level) and `validateString` uses `PATTERN_CACHE.get(schema) ?? new-and-set` to obtain a regex; if `patternProperties` was also a hot spot, `PATTERN_PROP_CACHE` is added similarly; full suite passes (84/84 tests, 0 failures); `node scripts/bench.js` now prints `[bench] OK — under 200ms ...` and exits 0; the change is committed as one atomic commit.</done>
</task>

</tasks>

<verification>
After all tasks (Task 4 conditional):

1. Test files exist:
   - `test/format.test.js` (~14 tests)
   - `test/cli.test.js` (~7 tests)
   - `test/dogfood.test.js` (~2 tests)
2. Full test suite passes: `node --test` reports ~84 tests, 0 failures, 0 skipped.
3. Per-file test runs pass:
   - `node --test test/format.test.js` — 14 passing
   - `node --test test/cli.test.js` — 7 passing
   - `node --test test/dogfood.test.js` — 2 passing
4. Each Phase 3 success criterion has a named test or smoke gate:
   - SC-1 (5-format pass/fail): tests in `test/format.test.js` (`FMT-01:`, `FMT-02:`, `FMT-03:`, `FMT-04:`, `FMT-05:`, `FMT-06:` prefixes)
   - SC-2 (CLI dogfood OK + broken errors): tests `DOG-01` and `DOG-02` in `test/dogfood.test.js`
   - SC-3 (CLI --format json): test `CLI-03: --format json emits a parseable JSON array on failure` in `test/cli.test.js`
   - SC-4 (PERF-01 200ms): `node scripts/bench.js` exits 0 with `[bench] OK — under 200ms ...`
5. Each Phase 3 requirement closed:
   - FMT-01..06: format.test.js (14 tests)
   - CLI-01..04: cli.test.js (7 tests)
   - DOG-01: dogfood.test.js (real config validates clean)
   - DOG-02: dogfood.test.js (broken config produces deterministic paths)
   - PERF-01: scripts/bench.js exit 0 under 200ms
6. Pitfall coverage:
   - Pitfall 9 (format over/under-engineering): tests across format.test.js
   - Pitfall 9a (Date constructor rollover for 2024-02-30): explicit test in format.test.js
   - Pitfall 9d (UUID version restriction): UUID tests accept v4 explicitly; spec allows v1-v5
   - CLI exit-code conflation (UX Pitfalls): test `CLI: schema with bad regex exits 2 (schema error, NOT data-invalid)`
   - Performance: regex compiled per call (Performance Traps): if bench failed, Task 4 fixed it via WeakMap cache
7. Zero-dep contract preserved: `package.json` has zero `dependencies`; no `commander`/`yargs`/`minimist`/`chalk` anywhere in the repo.
8. Three or four atomic commits (one per task, plus conditional perf commit if Task 4 ran).
</verification>

<success_criteria>
- [ ] `test/format.test.js` exists with ≥14 passing tests covering FMT-01..06 + leap-year + non-string no-op
- [ ] `test/cli.test.js` exists with ≥6 passing tests covering CLI-01..04 + schema-error exit-2 + file-not-found exit-2
- [ ] `test/dogfood.test.js` exists with 2 passing tests covering DOG-01 + DOG-02
- [ ] `scripts/bench.js` exists; `node scripts/bench.js` exits 0 with `[bench] OK — under 200ms ...`
- [ ] `package.json` has `bench` script (`node scripts/bench.js`); `test` script unchanged; zero dependencies
- [ ] Full suite: `node --test` reports ≥84 tests, 0 failures, 0 skipped
- [ ] Each Phase 3 SC has a named test/smoke that demonstrates it (SC-1, SC-2, SC-3, SC-4)
- [ ] Each Phase 3 requirement has at least one passing test or smoke gate (FMT-01..06, CLI-01..04, DOG-01, DOG-02, PERF-01)
- [ ] PERF-01 contingency (Task 4) executed only if Task 3 bench failed; if it ran, all 84 tests still pass
- [ ] No regressions in Phase 1+2 tests (40 + 21 = 61 still pass)
- [ ] 3-4 atomic commits (Task 1, Task 2, Task 3, optional Task 4)
</success_criteria>

<output>
After completion, create `.planning/phases/03-formats-cli-dogfood/03-03-summary.md` documenting:
- Total Phase 3 test count and full-suite total (Phase 1: 40 + Phase 2: 21 + Phase 3 format: 14 + cli: 7 + dogfood: 2 = ~84).
- Mapping of each Phase 3 SC → which test/smoke verifies it:
  - SC-1: `FMT-01:` ... `FMT-05:` tests in format.test.js
  - SC-2: `DOG-01` and `DOG-02` in dogfood.test.js
  - SC-3: `CLI-03: --format json` in cli.test.js
  - SC-4: `node scripts/bench.js` smoke
- Mapping of each Phase 3 requirement → which test verifies it:
  - FMT-01..06: 14 tests in format.test.js
  - CLI-01..04: 7 tests in cli.test.js
  - DOG-01, DOG-02: 2 tests in dogfood.test.js
  - PERF-01: scripts/bench.js exit 0
- Observed bench result: `[bench] doc=<N> bytes errors=<N> time=<N>ms` (record the actual elapsed time so future contributors see the budget margin).
- Whether Task 4 (WeakMap regex cache) executed. If yes, before/after times. If no, note "bench passed at <N>ms — optimization not needed."
- Confirmation that all 84 tests pass via `node --test`.
- Confirmation that zero runtime dependencies remain (`Object.keys(pkg.dependencies||{}).length === 0`).
- Phase 3 final readiness statement: "Phase 3 success criteria 1-4 demonstrably satisfied via X tests + bench. All 13 Phase 3 requirements (FMT-01..06, CLI-01..04, DOG-01, DOG-02, PERF-01) closed. whooschema v1 is feature-complete; ready for verification + UAT."
</output>
