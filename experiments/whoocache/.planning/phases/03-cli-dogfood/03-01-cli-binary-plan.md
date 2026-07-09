---
phase: 03-cli-dogfood
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - src/cli.js
  - test/cli.test.js
autonomous: true
change_class: feature
requirements:
  - CLI-01
  - CLI-02
  - CLI-03
  - CLI-04
  - CLI-05
  - CLI-06
  - CLI-07
  - CLI-08

must_haves:
  truths:
    - "Binary `whoocache` is wired via package.json bin and dispatches to src/cli.js"
    - "`whoocache set --namespace test --value hello foo && whoocache get --namespace test foo` prints `hello\\n` and exits 0"
    - "`whoocache get --namespace test missing` exits with code 2 (cache miss)"
    - "`whoocache list --namespace test --json` emits valid JSON parseable by JSON.parse"
    - "Invalid usage (missing key, unknown subcommand) exits 1 with stderr message"
    - "set --stdin reads value from fd 0 (cross-platform via fs.readFileSync(0, 'utf8'))"
    - "test/cli.test.js passes under `node --test` exercising round-trip set→get, miss, list --json, error"
  artifacts:
    - path: "package.json"
      provides: "bin entry mapping whoocache → ./src/cli.js"
      contains: '"whoocache": "./src/cli.js"'
    - path: "src/cli.js"
      provides: "CLI entry point with parseArgs dispatch over get/set/delete/list/clear"
      min_lines: 100
      contains: "parseArgs"
    - path: "test/cli.test.js"
      provides: "spawnSync round-trip tests for CLI-08"
      min_lines: 60
      contains: "spawnSync"
  key_links:
    - from: "src/cli.js"
      to: "src/cache.js"
      via: "createCache factory call inside dispatch"
      pattern: "createCache\\("
    - from: "src/cli.js"
      to: "process.exitCode"
      via: "miss/error sets exitCode then returns (no process.exit on hot paths)"
      pattern: "process\\.exitCode\\s*=\\s*[12]"
    - from: "test/cli.test.js"
      to: "src/cli.js"
      via: "spawnSync(process.execPath, [CLI, ...args])"
      pattern: "spawnSync\\("
    - from: "src/cli.js"
      to: "WHOOCACHE_DIR env var"
      via: "process.env.WHOOCACHE_DIR override (test isolation, mirrors child-writer.js)"
      pattern: "process\\.env\\.WHOOCACHE_DIR"
---

<objective>
Wire whoocache as a shell-usable binary. Add `bin` field to package.json and create src/cli.js — a thin parseArgs-driven dispatcher over the existing createCache API. Cover all eight CLI requirements (CLI-01..08) including exit-code semantics (0/1/2), stdout/stderr discipline, stdin reading via fd 0, and machine-readable `list --json` output. Tests use spawnSync to exercise the full binary stack.

Purpose: Solo Phase-3 deliverable #1. Without the CLI, the cache is only library-callable. Shell scripts, CI pipelines, and ad-hoc inspection all need this surface. The CLI is the integration test for the library: if `node src/cli.js set ...` then `node src/cli.js get ...` works end-to-end, the public API is correct.

Output: A `whoocache` binary that can be invoked via `node src/cli.js` (and via `npx whoocache` / `npm link`) with five subcommands matching the library API one-to-one.
</objective>

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
</execution_context>

<context>
@.planning/roadmap.md
@.planning/state.md
@.planning/requirements.md
@.planning/phases/03-cli-dogfood/03-research.md

<!-- Phase 1+2 SUMMARYs only as needed for createCache API surface -->
@.planning/phases/02-concurrency-eviction/02-03-integration-and-phase-tests-summary.md

@src/cache.js
@package.json

<interfaces>
<!-- createCache API surface (extracted from src/cache.js — executor uses these directly, no exploration needed) -->

From src/cache.js:
```js
// Factory
const { createCache } = require('./cache');
const cache = createCache(namespace, {
  cacheDir,        // optional — directory override; defaults to ~/.whoocache/<namespace>
  maxBytes,        // optional — default 52428800 (50MB)
  maxEntries,      // optional — default 1000
  clockSkewToleranceMs,  // optional — default 0
});

// Instance methods (sync)
cache.get(key)                          // → string | Buffer | undefined  (binary-encoded entries return Buffer)
cache.set(key, value, { ttlMs })        // → undefined; ttlMs optional (undefined → no expiry; 0 → immediate; throws RangeError on negative)
cache.delete(key)                       // → boolean (true if existed)
cache.list({ includeExpired = false })  // → Array<{ key, size, expires_at, last_access }>
cache.clear()                           // → undefined
```

Validation behaviors (already enforced by library):
- namespace must match `[a-z0-9_-]+` (lowercased); else TypeError
- key must be non-empty string; else TypeError
- value must be string or Buffer; else TypeError
- ttlMs negative → RangeError

Exported error types: `LockTimeoutError`, `CorruptIndexError`, `StaleIndexError`, `CachePermissionError`.
All carry `code` property (`LOCK_TIMEOUT`, `CORRUPT_INDEX`, etc.).

Existing reference pattern from test/helpers/child-writer.js:
```js
const cacheDir = process.env.WHOOCACHE_DIR;
const cache = createCache('concurrency-test', { cacheDir });
```
The CLI must support the same WHOOCACHE_DIR env override for test isolation (test/cli.test.js needs it).

parseArgs config (from research §parseArgs Contract — locked):
```js
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    namespace:         { type: 'string',  short: 'n', default: 'default' },
    ttl:               { type: 'string' },
    value:             { type: 'string',  short: 'v' },
    stdin:             { type: 'boolean', short: 's', default: false },
    json:              { type: 'boolean', short: 'j', default: false },
    'max-bytes':       { type: 'string' },
    'max-entries':     { type: 'string' },
    'include-expired': { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: false,
});
const [subcommand, key] = positionals;
```
Why `strict: false`: research §Pitfall 3 — strict throws on `--help`, blocking usage print.
Why `--ttl`/`--max-bytes`/`--max-entries` as `string`: research §parseArgs Contract — `type: 'number'` was inconsistent across Node versions; parse with `parseInt(val, 10)` and validate.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add bin field to package.json (CLI-01)</name>
  <files>package.json</files>
  <action>
Add a `"bin"` field to package.json mapping `whoocache` to `./src/cli.js`. Do NOT change other fields. The exact insertion (after `exports`):

```json
"bin": {
  "whoocache": "./src/cli.js"
}
```

Also do NOT add `"type": "module"` — the package is CommonJS-only per stack.md decision (research §Stack Project Layout). The shebang on line 1 of src/cli.js (next task) handles the executable path.

Why minimal change: package.json is referenced by Phase 1 already; adding bin is purely additive and does not affect the library `main`/`exports` fields. Keep dependencies object empty (zero-dep constraint).
  </action>
  <verify>
    <automated tier="T1">node -e "const pkg = require('./package.json'); if (pkg.bin?.whoocache !== './src/cli.js') { console.error('bin field missing or wrong'); process.exit(1); } console.log('OK');"</automated>
  </verify>
  <done>package.json contains `"bin": {"whoocache": "./src/cli.js"}`. `node -e "require('./package.json').bin.whoocache"` returns `./src/cli.js`.</done>
</task>

<task type="auto">
  <name>Task 2: Implement src/cli.js (CLI-01..07)</name>
  <files>src/cli.js</files>
  <action>
Create `src/cli.js` as the CLI entry point. **Line 1 MUST be the shebang `#!/usr/bin/env node`** (no BOM, no comments before it, no blank line). Line 2 is `'use strict';`.

Implementation strictly follows research §Code Examples → src/cli.js. Key points:

1. **Imports & parseArgs (CLI-03, CLI-04):** Use the exact parseArgs config from `<interfaces>` above. Destructure `values` and `positionals`. Read `[subcommand, key] = positionals`.

2. **Helpers:**
   - `err(msg)` — write `whoocache: ${msg}\n` to stderr, set `process.exitCode = 1`. Does NOT call process.exit.
   - `parseIntOpt(name, val)` — return `undefined` if val is undefined; else `parseInt(val, 10)`. If NaN or negative, call `err()` and return `null`. Used for `--ttl`, `--max-bytes`, `--max-entries`.

3. **WHOOCACHE_DIR env override (test isolation — locked):**
```js
const cacheDir = process.env.WHOOCACHE_DIR || undefined;
```
Pass `cacheDir` into `createCache` so `test/cli.test.js` and dogfood can isolate to a tmp dir. Mirrors test/helpers/child-writer.js pattern.

4. **createCache invocation:** Wrap in try/catch. On TypeError/Error from createCache (e.g. invalid namespace), call `err(e.message)` and `process.exit(1)` (early bail is acceptable for opt-validation errors before dispatch — same pattern as research §Code Examples).

5. **Subcommand dispatch (CLI-02):** Use `switch (subcommand)`. Five cases plus `default`. Behavior matches research §Output Contract table EXACTLY:

   - **`get`:** if no key → `err('get requires a key argument')` and `process.exit(1)`. Call `cache.get(key)`. If `undefined` → `process.exitCode = 2; break;` (CLI-07: miss = exit 2; NO stdout, NO stderr). Else if value is a Buffer → `process.stdout.write(value); process.stdout.write('\n');` (binary entries from STOR-08). Else → `process.stdout.write(value + '\n')`.

   - **`set`:** if no key → err+exit. Determine value: if `values.stdin` → `value = require('fs').readFileSync(0, 'utf8')` (CLI-05; works cross-platform per research §Stdin Reading). Else if `values.value !== undefined` → use it. Else → `err('set requires --value <str> or --stdin')` and `process.exit(1)`. Parse ttl: if `values.ttl !== undefined` → `ttlMs = parseIntOpt('ttl', values.ttl)`; if `process.exitCode === 1` → `process.exit(1)`. Call `cache.set(key, value, ttlMs !== undefined ? { ttlMs } : undefined)`. **No stdout output on success** (CLI-06).

   - **`delete`:** if no key → err+exit. Call `existed = cache.delete(key)`. Write `existed ? 'deleted\n' : 'not found\n'` to stdout. exitCode 0 in both cases.

   - **`list` (CLI-06):** Call `entries = cache.list({ includeExpired: values['include-expired'] })`. If `values.json` → `process.stdout.write(JSON.stringify(entries, null, 2) + '\n')`. Else (human table): if `entries.length === 0` → `process.stdout.write('(empty)\n'); break;`. Else write tab-separated header `KEY\tSIZE\tEXPIRES_AT\tLAST_ACCESS\n` followed by one row per entry: `${e.key}\t${e.size}\t${exp}\t${la}\n` where `exp = e.expires_at ? new Date(e.expires_at).toISOString() : '(never)'` and `la = new Date(e.last_access).toISOString()`. Tab-separated avoids alignment pitfalls (research §Pitfall 6).

   - **`clear`:** Call `cache.clear()`. Write `'cleared\n'` to stdout.

   - **`default`:** `err(\`unknown subcommand "${subcommand || ''}"\`)`; write usage to stderr: `Usage: whoocache <get|set|delete|list|clear> [key] [options]\nOptions: --namespace, --ttl, --value, --stdin, --json, --max-bytes, --max-entries, --include-expired\n`; `process.exit(1)`.

6. **Exit-code discipline (CLI-07 — CRITICAL):** Use `process.exitCode = N; return;` for hot paths (get-miss, normal success). Use `process.exit(1)` ONLY for early-bail validation errors (missing required arg, invalid opt parse, createCache throw) — these happen BEFORE any stdout write, so flush concern doesn't apply. **Never** call `process.exit()` after `process.stdout.write()` on the success/miss path — research §Pitfall 1 documents stdout truncation on fast machines.

   Concretely: `get` miss path is `process.exitCode = 2; break;` — DO NOT use `process.exit(2)` there.

7. **Imports:** `const { parseArgs } = require('node:util');` and `const { createCache } = require('./cache');`. Use `require('fs')` (NOT `node:fs`) inside `set` for stdin read to match the rest of the codebase. Do not import dogfood files.

8. **Do NOT add `--help` handling** — out of scope for CLI-01..07. Unknown flags are silently accepted (`strict: false`); the user sees usage on unknown subcommands only.

9. **Do NOT implement async wrappers** — entire file is sync. CLI is sync per stack constraint (matches createCache sync API).

Target file size: ~120-180 lines including comments and blank lines. The reference structure in research §Code Examples is the floor — match it closely; deviations only for the binary-Buffer get path noted above.
  </action>
  <verify>
    <automated tier="T2">node -e "
      const { spawnSync } = require('child_process');
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const dir = path.join(os.tmpdir(), 'whoocache-cli-smoke-' + Date.now());
      fs.mkdirSync(dir, { recursive: true });
      const env = { ...process.env, WHOOCACHE_DIR: dir };
      const cli = path.join('src', 'cli.js');
      const setR = spawnSync(process.execPath, [cli, 'set', 'foo', '--namespace', 'test', '--value', 'hello'], { env, encoding: 'utf8' });
      if (setR.status !== 0) { console.error('set failed', setR.stderr); process.exit(1); }
      const getR = spawnSync(process.execPath, [cli, 'get', 'foo', '--namespace', 'test'], { env, encoding: 'utf8' });
      if (getR.status !== 0 || getR.stdout !== 'hello\n') { console.error('get failed', getR); process.exit(1); }
      const missR = spawnSync(process.execPath, [cli, 'get', 'missing', '--namespace', 'test'], { env, encoding: 'utf8' });
      if (missR.status !== 2) { console.error('miss should exit 2, got', missR.status); process.exit(1); }
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('CLI smoke OK');
    "</automated>
  </verify>
  <done>src/cli.js exists with shebang on line 1. Smoke test above prints `CLI smoke OK`. `node src/cli.js set foo --namespace test --value hello && node src/cli.js get foo --namespace test` (with WHOOCACHE_DIR set to a tmp dir) outputs `hello\n` and exits 0; `node src/cli.js get missing --namespace test` exits 2.</done>
</task>

<task type="auto">
  <name>Task 3: Write test/cli.test.js (CLI-08)</name>
  <files>test/cli.test.js</files>
  <action>
Create `test/cli.test.js` covering CLI behavior via `child_process.spawnSync`. Add to the existing `node --test test/*.test.js` glob (no script changes needed — package.json `test` script already matches).

**Required tests (minimum 5 — covers CLI-08 explicitly + safety nets for CLI-07):**

1. **`set --value then get hit`:** spawn `set ns key --value hello` then `get ns key`. Assert get stdout === `'hello\n'` AND status === 0.

2. **`get miss returns exit 2`:** spawn `get ns missing` against a fresh namespace. Assert status === 2 AND stdout === `''` AND stderr === `''` (no output on miss per CLI-06).

3. **`list --json parses to array`:** set two keys, then `list ns --json`. Assert stdout starts with `[`. JSON.parse(stdout) succeeds and length === 2 and entries contain expected keys.

4. **`error exit code on missing arg`:** spawn `get` (no key). Assert status === 1 AND stderr non-empty (contains 'requires').

5. **`stdin --stdin pipe`:** spawn `set ns key --stdin` with `input: 'piped-value'` option to spawnSync. Then spawn `get ns key`. Assert get stdout === `'piped-value\n'`. (Validates CLI-05.)

**Test infrastructure:**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CLI = path.resolve(__dirname, '..', 'src', 'cli.js');

function freshDir(label) {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(os.tmpdir(), `whoocache-cli-${label}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function run(args, opts = {}) {
  const dir = opts.dir;
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, WHOOCACHE_DIR: dir },
    encoding: 'utf8',
    timeout: 5000,
    input: opts.input,
  });
}
```

Each test creates its own dir via `freshDir(label)` for isolation, runs assertions, and `fs.rmSync(dir, { recursive: true, force: true })` in a finally block.

**Critical:** Use a unique namespace per test (e.g., `'cli-test'`, `'miss-test'`, etc.) — keeps cleanup easy and prevents cross-test contamination.

**Why spawnSync, not require:** CLI-08 explicitly requires testing via spawnSync to exercise the full bin → src/cli.js → src/cache.js → filesystem stack (research §CLI Test Strategy). Loading cli.js via require would skip the shebang/parseArgs entry path.

**Why timeout:** 5s ceiling per spawn protects against deadlocks (e.g., a stdin test hanging if stdin is not closed properly).

**Do NOT** test the binary via `npx whoocache` or `node_modules/.bin/whoocache` — those require `npm link` or `npm install`, which is out of scope for unit tests. `node CLI args` is sufficient.
  </action>
  <verify>
    <automated tier="T1">node --test test/cli.test.js</automated>
  </verify>
  <done>test/cli.test.js passes 5+ tests under `node --test test/cli.test.js`. All Phase 1+2 tests still pass under `node --test test/*.test.js` (no regression).</done>
</task>

</tasks>

<verification>
After all tasks complete:

1. **Full test suite still passes:** `node --test test/*.test.js` — Phase 1+2 (test/phase1.test.js, test/phase2.test.js, test/keys.test.js, test/ttl.test.js, test/atomic-write.test.js, test/errors.test.js, test/index-file.test.js) plus new test/cli.test.js. Total ≥17 tests passing.

2. **Manual end-to-end smoke (matches roadmap success criterion #1):**
   ```
   WHOOCACHE_DIR=/tmp/whoo-smoke node src/cli.js set foo --namespace test --value hello
   WHOOCACHE_DIR=/tmp/whoo-smoke node src/cli.js get foo --namespace test
   # → prints 'hello\n', exits 0
   WHOOCACHE_DIR=/tmp/whoo-smoke node src/cli.js get missing --namespace test
   # → exits 2, no output
   ```

3. **`list --json` validity (matches roadmap success criterion #2):**
   ```
   WHOOCACHE_DIR=/tmp/whoo-smoke node src/cli.js list --namespace test --json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"
   # → no error
   ```

4. **package.json bin works under simulated install (smoke):**
   ```
   node -e "console.log(require('./package.json').bin.whoocache)"
   # → './src/cli.js'
   ```

5. **No regression to existing exports:** `node -e "const w = require('./'); if (typeof w.createCache !== 'function') process.exit(1)"` succeeds.
</verification>

<success_criteria>
- [ ] package.json has `"bin": {"whoocache": "./src/cli.js"}` (CLI-01)
- [ ] src/cli.js exists with shebang on line 1 (CLI-01)
- [ ] CLI dispatches all five subcommands: get, set, delete, list, clear (CLI-02)
- [ ] CLI uses `node:util` parseArgs (CLI-03)
- [ ] CLI accepts all required flags: --namespace, --ttl, --stdin, --value, --json, --max-bytes, --max-entries (CLI-04)
- [ ] `set --stdin` reads from fd 0 (CLI-05)
- [ ] `list --json` emits valid JSON; `list` (no flag) emits human-readable table (CLI-06)
- [ ] Exit codes: 0 = success, 1 = error, 2 = cache miss on get (CLI-07)
- [ ] test/cli.test.js with ≥5 spawnSync tests, all passing (CLI-08)
- [ ] Existing Phase 1+2 tests still pass — zero regression
- [ ] Roadmap success criterion #1 verified manually (set then get prints hello, miss exits 2)
- [ ] Roadmap success criterion #2 verified manually (list --json parses)
</success_criteria>

<output>
After completion, create `.planning/phases/03-cli-dogfood/03-01-cli-binary-summary.md` documenting:
- Files created/modified (package.json, src/cli.js, test/cli.test.js)
- Key implementation choices (e.g., binary-Buffer handling in get, exit-code discipline)
- Test count added (5+) and total Phase 1+2+3 test count after this plan
- Any deviations from research recommendations (with reasoning)
- Confirmation: roadmap success criteria #1 and #2 verified end-to-end
</output>
