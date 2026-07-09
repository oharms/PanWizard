# Phase 3: CLI + Dogfood - Research

**Researched:** 2026-05-02
**Domain:** Node.js CLI entry-point wiring, `node:util parseArgs`, exit codes, stdout/stderr discipline, dogfood integration test structure
**Confidence:** HIGH

> No `context.md` exists for this phase — no upstream user-discussion constraints to surface.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | Binary `whoocache` exposed via `package.json` `bin` field; entry point `src/cli.js` | package.json `bin` + shebang pattern; section "CLI Binary Wiring" |
| CLI-02 | Subcommands `get\|set\|delete\|list\|clear` mirror the library API | `parseArgs` positionals pattern; section "Subcommand Dispatch" |
| CLI-03 | Argv parsing uses `node:util` `parseArgs` (zero-dep) | Already in stack.md; section "parseArgs Contract" |
| CLI-04 | Flags: `--namespace`, `--ttl` (ms), `--stdin`, `--value <str>`, `--json`, `--max-bytes`, `--max-entries` | Exact `parseArgs` options config; section "Flag Schema" |
| CLI-05 | `set` reads value from `--value <str>` or, if `--stdin`, from `process.stdin` | stdin-read pattern on Windows; section "Stdin Reading" |
| CLI-06 | `list --json` emits machine-readable JSON; otherwise emits human-readable table | Section "Output Contract" |
| CLI-07 | Exit codes: 0 = success, 1 = error, 2 = cache miss on `get` | Section "Exit Code Contract" |
| CLI-08 | CLI tested via `child_process.spawnSync` (round-trip set→get; list --json parses) | Section "CLI Test Strategy" |
| DOG-01 | Fork of PAN's `hooks/pan-check-update.js` replaces ad-hoc JSON write with whoocache call | Section "Dogfood Design" — original file analyzed at `D:\PanWizard\hooks\pan-check-update.js` |
| DOG-02 | Dogfood fork reproduces hit/miss semantics (cached within TTL; refresh after expiry) | Section "Dogfood Hit/Miss Semantics" |
| DOG-03 | Post-run audit: parallel-process test (two children, 1000 sets each) leaves consistent index, zero lost writes | Section "Dogfood Parallel Audit" — reuses Phase 2 fixture pattern |
</phase_requirements>

---

## Summary

Phase 3 has two independent deliverables: a thin CLI binary and a dogfood script. Both are straightforward extensions of the already-complete library. The CLI has no novel logic — it is a mapping layer from `process.argv` to `createCache(...).method(...)`. The dogfood script is a small rewrite of an existing PAN hook that replaces an ad-hoc `fs.writeFileSync` cache file with `whoocache`.

The most significant decisions in this phase are: (1) exact stdout/stderr discipline for each subcommand so shell scripts can compose with the CLI reliably, (2) exit code 2 for a cache miss on `get` (non-standard but correct for this use case), (3) stdin-reading on Windows where `/dev/stdin` does not exist, and (4) where the dogfood files live and how the parallel audit test connects to Phase 2's existing `child-writer.js` fixture.

**Primary recommendation:** Build `src/cli.js` as a 150–200 line file that delegates entirely to `createCache`. Place dogfood files under `dogfood/`. Reuse `test/helpers/child-writer.js` for the DOG-03 parallel audit with `WRITES=1000` instead of 50.

---

## Standard Stack

Phase 3 uses only what Phases 1 and 2 already established. See `.planning/research/stack.md` for full stack rationale. Phase-3-specific additions:

### Core (Phase 3 only)
| API | Module | Purpose | Notes |
|-----|--------|---------|-------|
| `util.parseArgs` | `node:util` | Zero-dep CLI arg parsing | Stable since Node 20; experimental on 18.3+/16.17+ — already in engines |
| `process.stdin` | Node builtin | Read value when `--stdin` | Must use `fs.readFileSync('/dev/stdin')` on POSIX or `process.stdin.fd` pattern on Windows |
| `process.exitCode` | Node builtin | Set exit code | Prefer `process.exitCode = N; return` over `process.exit(N)` to allow final sync I/O |
| `child_process.spawnSync` | Node builtin | Test CLI via subprocess | Used in CLI test file (CLI-08) |

**No new npm packages.** Zero-dep constraint is absolute.

---

## Architecture Patterns

### Recommended File Layout (Phase 3 additions only)

```
whoocache/
├── src/
│   └── cli.js               # NEW — CLI entry point (CLI-01 through CLI-07)
├── dogfood/
│   ├── pan-check-update.js  # NEW — whoocache-based fork of PAN hook (DOG-01/02)
│   └── parallel-test.js     # NEW — two-child 1000-set audit driver (DOG-03)
├── test/
│   └── cli.test.js          # NEW — spawnSync round-trip tests (CLI-08)
└── package.json             # MODIFY — add "bin" field (CLI-01)
```

The `dogfood/` directory is a peer of `src/` and `test/`. It is NOT published to npm (excluded from `files` field in package.json). It is committed to the repo as proof-of-concept and integration evidence.

### CLI Binary Wiring (CLI-01)

`package.json` must add a `bin` entry pointing to `src/cli.js`:

```json
{
  "bin": {
    "whoocache": "./src/cli.js"
  }
}
```

`src/cli.js` must begin with a shebang on line 1:

```js
#!/usr/bin/env node
'use strict';
```

**Why the shebang must be line 1:** npm's `bin` installer sets the execute bit on install. On POSIX, the OS kernel reads line 1 for the interpreter. If the shebang is not exactly line 1 (e.g., a BOM or comment precedes it), the script will run as a shell script and fail.

**Running without install:** `node src/cli.js get ...` always works. `npx whoocache` works after `npm link` or in a consuming project with whoocache installed. `pnpm exec whoocache` works the same way — pnpm uses the same `bin` resolution as npm.

### parseArgs Contract (CLI-03, CLI-04)

The exact `parseArgs` config for `src/cli.js`:

```js
const { parseArgs } = require('node:util');

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    namespace:   { type: 'string',  short: 'n', default: 'default' },
    ttl:         { type: 'string' },            // parsed to int in dispatch
    value:       { type: 'string',  short: 'v' },
    stdin:       { type: 'boolean', short: 's', default: false },
    json:        { type: 'boolean', short: 'j', default: false },
    'max-bytes':   { type: 'string' },          // parsed to int; passed to createCache
    'max-entries': { type: 'string' },          // parsed to int; passed to createCache
    'include-expired': { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: false,   // don't throw on unknown flags — print usage instead
});

const [subcommand, key] = positionals;
```

**Why `strict: false`:** With `strict: true`, an unknown flag (e.g., `--help`) throws before we can print usage. `strict: false` lets us catch unknown flags in the dispatch switch and print a helpful message. The downside is unknown flags are silently accepted — acceptable for a CLI of this simplicity.

**Why `default` on `namespace`:** Allows `whoocache set foo bar` without `--namespace` to work against a sensible default. The stack.md validates `namespace` in `createCache`, so an empty value will throw with a clear message.

**Why `--ttl` as string, not number:** `parseArgs` `type: 'number'` was not always consistent across Node versions (experimental behavior). Parse it with `parseInt(values.ttl, 10)` in the dispatch. Validate: if not a finite integer, print error and exit 1.

**Why `--max-bytes` and `--max-entries` as string:** Same reason — parse to int in dispatch and validate.

### Subcommand Dispatch (CLI-02)

Structure as a simple `switch` on `subcommand`. Each case:
1. Validates required positional args (`key` for get/set/delete)
2. Calls `createCache(values.namespace, { maxBytes, maxEntries })`
3. Calls the appropriate method
4. Writes output
5. Sets `process.exitCode` and returns

```js
switch (subcommand) {
  case 'get':    handleGet(cache, key, values);    break;
  case 'set':    handleSet(cache, key, values);    break;
  case 'delete': handleDelete(cache, key, values); break;
  case 'list':   handleList(cache, values);        break;
  case 'clear':  handleClear(cache, values);       break;
  default:
    process.stderr.write(`whoocache: unknown subcommand "${subcommand || ''}"\n`);
    process.stderr.write('Usage: whoocache <get|set|delete|list|clear> [key] [options]\n');
    process.exitCode = 1;
}
```

**Why not a `Map` or function registry:** The switch is simpler, more readable, and the CLI only has 5 subcommands. A registry adds indirection with no benefit at this scale.

### Exit Code Contract (CLI-07)

| Situation | Exit Code | Output |
|-----------|-----------|--------|
| Success (any subcommand) | 0 | stdout: result |
| Cache miss (`get` key not found or expired) | 2 | no stdout; no stderr |
| Any error (TypeError, LockTimeoutError, etc.) | 1 | stderr: error message |

**Why exit code 2 for miss, not 1:** Exit code 1 means "an error occurred." A cache miss is not an error — it is an expected result. Exit code 2 is the conventional "no match" code (grep uses it for "no match found"). Shell callers can distinguish: `whoocache get ns key && echo hit || echo miss` will print `miss` on a miss without treating it as an error if the caller checks `$?` explicitly.

**Critical pattern — use `process.exitCode`, not `process.exit()`:**

```js
// CORRECT: allows I/O buffers to flush
process.exitCode = 2;
return;

// WRONG: may truncate buffered output on fast paths
process.exit(2);
```

`process.exit()` calls `process._exit()` immediately, which can truncate unflushed stdout writes on fast machines. Setting `process.exitCode` lets Node's event loop drain normally.

### Output Contract (CLI-06)

| Subcommand | Mode | stdout | stderr |
|------------|------|--------|--------|
| `get` (hit) | any | value string + `\n` | empty |
| `get` (miss) | any | empty | empty |
| `set` | any | empty | empty |
| `delete` (existed) | any | `deleted\n` | empty |
| `delete` (not found) | any | `not found\n` | empty |
| `list` | default | human-readable table (key, size, expires_at, last_access) | empty |
| `list` | `--json` | `JSON.stringify(entries, null, 2) + "\n"` | empty |
| `clear` | any | `cleared\n` | empty |
| any | error | empty | error message + `\n` |

**Why `set` has no stdout output:** Shell callers composing with pipes do not want extra output from set operations. `set` success is indicated by exit code 0.

**Why `delete` prints text:** The boolean return value of `cache.delete()` is useful to shell callers. Printing `deleted` vs `not found` is the standard CLI pattern for destructive operations (e.g., `git rm`).

**Why `list --json` uses `JSON.stringify(entries, null, 2)`:** Pretty-printed JSON is still valid JSON, and it is readable when viewed directly. Compact JSON (`JSON.stringify(entries)`) is harder to debug. The 2-space indent is idiomatic in Node.js CLIs.

**`list` human-readable table format:**

```
KEY         SIZE     EXPIRES_AT                    LAST_ACCESS
my-key      1234     2026-05-02T14:00:00.000Z      2026-05-02T13:00:00.000Z
other-key   512      (never)                       2026-05-02T12:30:00.000Z
```

Convert the `expires_at` and `last_access` ms-timestamps to ISO strings for human display. Show `(never)` when `expires_at` is null.

### Stdin Reading (CLI-05)

When `--stdin` is set for `set`, read value from `process.stdin`:

```js
function readStdin() {
  // Cross-platform sync stdin read
  // On POSIX: /dev/stdin is a character device, readable synchronously
  // On Windows: process.stdin.fd is 0; readFileSync(0) reads stdin fd directly
  const fd = process.platform === 'win32' ? 0 : '/dev/stdin';
  try {
    return require('fs').readFileSync(fd, 'utf8');
  } catch (err) {
    process.stderr.write(`whoocache: failed to read stdin: ${err.message}\n`);
    process.exitCode = 1;
    return null;
  }
}
```

**Why `fs.readFileSync(0, 'utf8')` on Windows:** `/dev/stdin` does not exist as a path on Windows. However, `fs.readFileSync(0)` reads file descriptor 0 (stdin) synchronously on both POSIX and Windows. Using `0` (the fd number) is the correct cross-platform approach. The `process.platform === 'win32'` check can be simplified to always use `0` since `fs.readFileSync(0)` works on POSIX too. Prefer always `fs.readFileSync(0, 'utf8')` — verified to work on Node 16+ cross-platform.

**Simpler unified form:**
```js
const value = require('fs').readFileSync(0, 'utf8'); // fd 0 = stdin, works cross-platform
```

**Caveat:** `readFileSync(0)` blocks until stdin is closed (EOF). In a pipeline (`echo hello | whoocache set foo --stdin`), `echo` closes its write end automatically. In interactive use, the user must type Ctrl+D (POSIX) or Ctrl+Z (Windows) to send EOF. Document this in the help text.

---

## Dogfood Design (DOG-01, DOG-02, DOG-03)

### What the Original `pan-check-update.js` Does

The original (at `D:\PanWizard\hooks\pan-check-update.js`) is a SessionStart hook that:

1. Checks `~/.claude/cache/pan-update-check.json` for a cached result (ad-hoc JSON file)
2. Spawns a detached background child that:
   - Reads the installed PAN version from `VERSION` file
   - Runs `npm view pan-wizard version` to get the latest
   - Writes `{update_available, installed, latest, checked}` to `pan-update-check.json` via `fs.writeFileSync`
3. The parent script does NOT read the cache — it only triggers the background update check

**Key observation:** The original writes a JSON file directly with no TTL, no multi-process safety, no atomic write, and no LRU. The entire file is replaced on every write. The whoocache fork must preserve the same observable behavior (check → fetch → cache) while using whoocache for storage.

**What DOG-01/02 require:**
- Replace `pan-update-check.json` write with `cache.set('check', JSON.stringify(result), { ttlMs: 3_600_000 })` (1-hour TTL)
- Add a read path: if `cache.get('check')` returns a value and the TTL has not expired, skip the npm check (cache hit)
- After TTL expires, re-fetch and re-set (cache miss → refresh)

### Dogfood File: `dogfood/pan-check-update.js`

This is not a hook replacement — it is a **demonstration script** that shows the same pattern in a self-contained testable form. It should:

1. Create `createCache('pan-update', { maxEntries: 10 })` (as specified in roadmap SC-3)
2. Attempt `cache.get('latest-version')`
3. If hit: print "CACHE HIT: [value]" and exit
4. If miss: "fetch" a value (a stub or actual npm check), cache it with `{ ttlMs: 60_000 }` (1-minute TTL for demo), print "CACHE MISS: fetched and cached [value]"

The "fetch" can be a simple stub (`'1.2.3'`) for the dogfood test — the test just needs to demonstrate the TTL window behavior, not actually hit npm.

### Dogfood Parallel Audit: `dogfood/parallel-test.js` (DOG-03)

This is a standalone driver that:
1. Creates a shared `cacheDir` in a temp location
2. Forks two child processes — both reusing `test/helpers/child-writer.js` with `WRITES=1000`
3. Waits for both to complete
4. Opens the cache as a reader and audits:
   - All expected keys are present (2000 keys total)
   - No index corruption (no exception from `createCache`)
   - Zero lost writes

**The key insight:** The same fixture that Phase 2 uses for TEST-08 (`test/helpers/child-writer.js`) can be reused directly for DOG-03 by passing `WRITES=1000` and `WRITERS=2`. The only difference is this runs as a standalone script, not inside `node --test`.

```js
// dogfood/parallel-test.js
'use strict';
const { fork } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { createCache } = require('../src/cache');

const WRITERS = 2;
const WRITES_PER_WRITER = 1000;

const id = crypto.randomBytes(4).toString('hex');
const cacheDir = path.join(os.tmpdir(), `whoocache-dogfood-${id}`);
fs.mkdirSync(cacheDir, { recursive: true });

console.log(`Dogfood parallel test: ${WRITERS} writers × ${WRITES_PER_WRITER} sets = ${WRITERS * WRITES_PER_WRITER} total`);
console.log(`Cache dir: ${cacheDir}`);

const CHILD_SCRIPT = path.join(__dirname, '..', 'test', 'helpers', 'child-writer.js');

let done = 0;
let failed = false;

function onWriterDone() {
  done++;
  if (done === WRITERS) {
    // Audit
    try {
      const cache = createCache('concurrency-test', { cacheDir });
      const listed = cache.list();
      const keySet = new Set(listed.map(e => e.key));
      let missing = 0;
      for (let w = 0; w < WRITERS; w++) {
        for (let k = 0; k < WRITES_PER_WRITER; k++) {
          const key = `writer-${w}-key-${k}`;
          if (!keySet.has(key)) { console.error(`MISSING: ${key}`); missing++; }
        }
      }
      if (missing === 0) {
        console.log(`PASS: all ${WRITERS * WRITES_PER_WRITER} keys present, index consistent`);
        process.exitCode = 0;
      } else {
        console.error(`FAIL: ${missing} lost writes`);
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`FAIL: audit threw: ${err.message}`);
      process.exitCode = 1;
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }
}

for (let i = 0; i < WRITERS; i++) {
  const child = fork(CHILD_SCRIPT, [], {
    env: {
      ...process.env,
      WHOOCACHE_DIR: cacheDir,
      WRITER_ID: String(i),
      WRITES: String(WRITES_PER_WRITER),
    }
  });
  child.on('message', (msg) => { if (msg.done) onWriterDone(); });
  child.on('error', (err) => { console.error(`Child ${i} error: ${err.message}`); process.exitCode = 1; });
  child.on('exit', (code) => {
    if (code !== 0) { console.error(`Child ${i} exited with code ${code}`); process.exitCode = 1; }
  });
}
```

**Performance note:** 2000 sets with lock contention at `maxEntries: 1000` (default) will trigger eviction. To avoid eviction masking lost-write detection, set `maxEntries: 3000` in the dogfood parallel test. This ensures all 2000 keys survive in the index. The CONC-08 spec requires both succeed within 1s on a 4-CPU machine — 1000 sets per writer is a more demanding test than Phase 2's 50. Expect 2–5 seconds on a typical dev machine due to lock contention.

---

## CLI Test Strategy (CLI-08)

### Test File: `test/cli.test.js`

Uses `child_process.spawnSync` to invoke the CLI binary as a subprocess. This exercises the full stack: `package.json` bin → `src/cli.js` → `src/cache.js` → filesystem.

**Test runner integration:** Add `test/cli.test.js` to the existing `node --test test/*.test.js` glob. No new test infrastructure needed.

**Helper for spawnSync:**

```js
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

function run(args, cacheDir) {
  // Pass WHOOCACHE_TEST_DIR so the CLI can use a tmp dir for its namespace
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, HOME: cacheDir },
    encoding: 'utf8',
    timeout: 5000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}
```

**Important:** The `HOME` env override causes `os.homedir()` on POSIX to return the test-specific dir, so `createCache` writes to an isolated location. On Windows, `os.homedir()` reads from `USERPROFILE` or `HOMEDRIVE`+`HOMEPATH`, not `HOME`. Use `USERPROFILE` for Windows override. **Cross-platform workaround:** Pass `--namespace` explicitly AND an isolated namespace per test, then clean up `~/.whoocache/<test-ns>` after the test. Or — simpler — accept that CLI tests write to the real `~/.whoocache/` with a unique test namespace that is cleaned up in `after()`.

**Alternative (cleaner):** Add an undocumented `WHOOCACHE_DIR` env var to `src/cli.js` that overrides the `cacheDir`. The CLI reads it before resolving the default path:

```js
// In createCache call inside cli.js:
const cacheDir = process.env.WHOOCACHE_DIR || undefined;
createCache(values.namespace, { cacheDir, maxBytes, maxEntries });
```

This is already what Phase 2 fixtures do for `child-writer.js`. Consistent approach.

**Required CLI tests (CLI-08):**

| Test | Command | Expected |
|------|---------|----------|
| set then get hit | `set ns key --value hello` then `get ns key` | stdout=`hello\n`, status=0 |
| get miss | `get ns missing` | stdout=``, status=2 |
| list --json parses | `set ns k1 --value a; list ns --json` | JSON.parse succeeds, array contains `{key:'k1'}` |
| delete existing | `set ns k --value v; delete ns k` | stdout=`deleted\n`, status=0 |
| delete missing | `delete ns missing` | stdout=`not found\n`, status=0 |
| clear | `set ns k --value v; clear ns` | stdout=`cleared\n` then `get ns k` → status=2 |
| error exit code | `get` (no key) | status=1, stderr non-empty |
| stdin set | `echo hello | node cli.js set ns key --stdin` | get returns `hello\n` |

**Minimum tests needed for CLI-08 coverage:** 4 (set→get, get miss, list --json, error). The full table above is a comprehensive but not exhaustive set. Use the minimum 4 for the test file; extra tests are welcome.

---

## Common Pitfalls (Phase 3 specific)

### Pitfall 1: process.exit() Truncates stdout

**What goes wrong:** `process.exit(0)` called immediately after `process.stdout.write(result)` can truncate the write on fast systems because stdout is buffered and the exit happens before the buffer drains.

**How to avoid:** Use `process.exitCode = N;` and return. Node drains stdout before the process exits naturally.

**Warning signs:** CLI test using `spawnSync` sees empty stdout even though `process.stdout.write` was called. Most common in very fast paths (cache hit on hot key).

---

### Pitfall 2: Windows HOME vs USERPROFILE for Test Isolation

**What goes wrong:** CLI tests override `HOME` to isolate the cache dir. `os.homedir()` on Windows reads `USERPROFILE` (or `HOMEDRIVE`+`HOMEPATH`), NOT `HOME`. Setting `HOME` in the spawnSync env has no effect on Windows, so the test writes to the real user's `~/.whoocache`.

**How to avoid:** Use the `WHOOCACHE_DIR` env var override in `cli.js` (pass as `--cacheDir` option or read from env). This is the cleanest cross-platform isolation mechanism and is already established by the Phase 2 `child-writer.js` fixture.

---

### Pitfall 3: parseArgs Throws on --help Before Usage Prints

**What goes wrong:** With `strict: true`, `parseArgs` throws `TypeError` if the user passes `--help` (not a declared option). The uncaught exception prints a stack trace instead of usage text.

**How to avoid:** Set `strict: false` and handle unknown positionals/flags in the dispatch switch. For `--help`, check `process.argv.includes('--help')` before `parseArgs`.

---

### Pitfall 4: Dogfood Parallel Test Misses Keys Due to maxEntries Eviction

**What goes wrong:** `dogfood/parallel-test.js` runs 2000 sets with default `maxEntries: 1000`. After eviction, only 1000 keys survive. The audit then reports 1000 "lost" writes — but they were evicted, not lost.

**How to avoid:** Set `maxEntries: 5000` (or a value > WRITERS × WRITES_PER_WRITER) in the dogfood parallel test. The audit checks for correctness of concurrency, not eviction behavior. Eviction in a concurrent scenario is a separate concern already validated in Phase 2.

---

### Pitfall 5: `readFileSync(0)` Hangs if stdin is a TTY

**What goes wrong:** When `--stdin` is used interactively (no piped input), `fs.readFileSync(0, 'utf8')` blocks forever waiting for EOF. Users pressing Enter do not close stdin — they must press Ctrl+D (POSIX) or Ctrl+Z (Windows).

**How to avoid:** Document this behavior in the CLI help text. It is expected behavior for synchronous stdin reading and cannot be worked around without async I/O. Since the CLI is zero-dep sync, accept this limitation.

---

### Pitfall 6: `list` Human Table Misaligned on Long Keys

**What goes wrong:** The human-readable table uses fixed-width columns that overflow for long keys (e.g., a 64-char sha256 key, or a URL used as a cache key).

**How to avoid:** Compute column widths dynamically from the data before rendering. Or simply left-justify with tab separation: `key\tsize\texpires_at\tlast_access\n`. Tab-separated is less pretty but immune to overflow. For Phase 3, prefer tab-separated as the simplest correct approach.

---

## Code Examples

### src/cli.js — Complete Structure

```js
#!/usr/bin/env node
'use strict';

// CLI-03: zero-dep arg parsing
const { parseArgs } = require('node:util');
const { createCache } = require('./cache');

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

function err(msg) {
  process.stderr.write(`whoocache: ${msg}\n`);
  process.exitCode = 1;
}

function parseIntOpt(name, val) {
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 0) { err(`--${name} must be a non-negative integer`); return null; }
  return n;
}

const maxBytes   = parseIntOpt('max-bytes',   values['max-bytes']);
const maxEntries = parseIntOpt('max-entries', values['max-entries']);
if (process.exitCode === 1) process.exit(1); // bail if opt parsing failed

// WHOOCACHE_DIR env override for test isolation (same as child-writer.js)
const cacheDir = process.env.WHOOCACHE_DIR || undefined;

let cache;
try {
  cache = createCache(values.namespace, {
    cacheDir,
    ...(maxBytes   !== undefined && { maxBytes }),
    ...(maxEntries !== undefined && { maxEntries }),
  });
} catch (e) {
  err(e.message); process.exit(1);
}

switch (subcommand) {

  case 'get': {
    if (!key) { err('get requires a key argument'); process.exit(1); }
    const result = cache.get(key);
    if (result === undefined) {
      process.exitCode = 2;  // CLI-07: miss = exit 2
    } else {
      process.stdout.write(result + '\n');
    }
    break;
  }

  case 'set': {
    if (!key) { err('set requires a key argument'); process.exit(1); }
    let val;
    if (values.stdin) {
      val = require('fs').readFileSync(0, 'utf8');  // CLI-05: stdin
    } else if (values.value !== undefined) {
      val = values.value;
    } else {
      err('set requires --value <str> or --stdin'); process.exit(1);
    }
    const ttlMs = values.ttl !== undefined ? parseIntOpt('ttl', values.ttl) : undefined;
    if (process.exitCode === 1) process.exit(1);
    cache.set(key, val, ttlMs !== undefined ? { ttlMs } : undefined);
    // No stdout on success (CLI-06: set has no stdout)
    break;
  }

  case 'delete': {
    if (!key) { err('delete requires a key argument'); process.exit(1); }
    const existed = cache.delete(key);
    process.stdout.write(existed ? 'deleted\n' : 'not found\n');
    break;
  }

  case 'list': {
    const entries = cache.list({ includeExpired: values['include-expired'] });
    if (values.json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');  // CLI-06: --json
    } else {
      if (entries.length === 0) { process.stdout.write('(empty)\n'); break; }
      process.stdout.write('KEY\tSIZE\tEXPIRES_AT\tLAST_ACCESS\n');
      for (const e of entries) {
        const exp = e.expires_at ? new Date(e.expires_at).toISOString() : '(never)';
        const la  = new Date(e.last_access).toISOString();
        process.stdout.write(`${e.key}\t${e.size}\t${exp}\t${la}\n`);
      }
    }
    break;
  }

  case 'clear': {
    cache.clear();
    process.stdout.write('cleared\n');
    break;
  }

  default: {
    err(`unknown subcommand "${subcommand || ''}"`);
    process.stderr.write('Usage: whoocache <get|set|delete|list|clear> [key] [options]\n');
    process.stderr.write('Options: --namespace, --ttl, --value, --stdin, --json, --max-bytes, --max-entries\n');
    process.exit(1);
  }
}
```

### dogfood/pan-check-update.js — Structure

```js
#!/usr/bin/env node
'use strict';
// DOG-01/02: whoocache-based replacement for PAN's ad-hoc pan-update-check.json
// Usage: node dogfood/pan-check-update.js

const { createCache } = require('../src/cache');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TTL_MS = 3_600_000; // 1 hour — matches PAN's implicit re-check interval
const CACHE_KEY = 'pan-wizard-update-check';

const cache = createCache('pan-update', { maxEntries: 10 });

// DOG-02: hit/miss semantics
const cached = cache.get(CACHE_KEY);
if (cached) {
  console.log('[whoocache dogfood] CACHE HIT:', cached);
  process.exit(0);
}

// Cache miss: fetch fresh data
console.log('[whoocache dogfood] CACHE MISS: fetching...');

const homeDir = os.homedir();
const cwd = process.cwd();
const projectVersionFile = path.join(cwd, '.claude', 'pan-wizard-core', 'VERSION');
const globalVersionFile  = path.join(homeDir, '.claude', 'pan-wizard-core', 'VERSION');

let installed = '0.0.0';
try {
  if (fs.existsSync(projectVersionFile))      installed = fs.readFileSync(projectVersionFile, 'utf8').trim();
  else if (fs.existsSync(globalVersionFile))  installed = fs.readFileSync(globalVersionFile,  'utf8').trim();
} catch {}

let latest = null;
try {
  latest = execSync('npm view pan-wizard version', { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
} catch {}

const result = JSON.stringify({
  update_available: !!(latest && installed !== latest),
  installed,
  latest: latest || 'unknown',
  checked: Math.floor(Date.now() / 1000),
});

cache.set(CACHE_KEY, result, { ttlMs: TTL_MS });
console.log('[whoocache dogfood] CACHE MISS: fetched and cached:', result);
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI arg parsing | Custom argv loop | `node:util parseArgs` | Handles `--no-*`, quoted values, `--` end-of-opts; already in stack |
| Synchronous sleep in tests | `setTimeout(fn, n)` | `node:timers/promises` `setTimeout` (already used in phase2.test.js) | Already established pattern in test suite |
| New multi-process fixture | New child script | Reuse `test/helpers/child-writer.js` with `WRITES=1000` | Child-writer already supports `WRITES` env var |
| Exit code management | `process.exit(N)` | `process.exitCode = N; return` | Prevents stdout truncation |

---

## Open Questions

1. **Should `src/cli.js` accept `--cacheDir` explicitly?**
   - What we know: the `WHOOCACHE_DIR` env var approach works for tests and is consistent with `child-writer.js`.
   - What's unclear: whether end-users want to override `cacheDir` via a flag (vs. just relying on `--namespace` scoping under `~/.whoocache/`).
   - Recommendation: Skip `--cacheDir` flag for now (not in requirements). `WHOOCACHE_DIR` env var for test isolation is sufficient. If users need it, add in v1.x.

2. **Does the dogfood `pan-check-update.js` need to run in the background (detached child like the original)?**
   - What we know: the original spawns a detached background child. The dogfood fork is a demonstration script, not a hook replacement.
   - What's unclear: whether DOG-01 means "make it a real hook replacement" or "show it can work the same way."
   - Recommendation: Make `dogfood/pan-check-update.js` synchronous (no detached spawn) for simplicity. The dogfood script demonstrates the API pattern; it doesn't need to replicate the hook's background-spawn pattern. The requirements say "fork" meaning "derivative", not subprocess `fork()`.

3. **What namespace should `dogfood/pan-check-update.js` use?**
   - Roadmap SC-3 says `createCache('pan-update', {maxEntries: 10})`. Use `'pan-update'`.
   - No ambiguity; confirmed by roadmap.

---

## Planner Hand-off

### Recommended Plan Structure

Phase 3 fits cleanly into 2 plans:

#### Plan 03-01: CLI Binary
**Scope:** `src/cli.js`, `package.json` (add `bin` field), `test/cli.test.js`
**Wave:** Single wave (no dependencies within phase)
**Tasks:**
1. Add `"bin": {"whoocache": "./src/cli.js"}` to `package.json`
2. Write `src/cli.js` with `parseArgs`, subcommand dispatch, exit codes (CLI-01 through CLI-07)
3. Write `test/cli.test.js` with spawnSync round-trip tests (CLI-08)
**Verification:** `node --test test/cli.test.js` passes; manual `node src/cli.js set --namespace test --value hello foo && node src/cli.js get --namespace test foo` prints `hello` and exits 0; `node src/cli.js get --namespace test missing` exits 2

#### Plan 03-02: Dogfood
**Scope:** `dogfood/pan-check-update.js`, `dogfood/parallel-test.js`
**Depends on:** Plan 03-01 (needs working CLI and cache for verification)
**Tasks:**
1. Write `dogfood/pan-check-update.js` — whoocache-based version of PAN hook (DOG-01/02)
2. Write `dogfood/parallel-test.js` — two-child 1000-set audit driver (DOG-03) reusing `test/helpers/child-writer.js`
3. Run `node dogfood/parallel-test.js` and verify PASS output
**Verification:** `node dogfood/pan-check-update.js` (first run: miss; second run within 1h: hit); `node dogfood/parallel-test.js` prints `PASS: all 2000 keys present`

### File Scope by Requirement

| Requirement | Files to Touch |
|-------------|---------------|
| CLI-01 | `package.json`, `src/cli.js` (create) |
| CLI-02 | `src/cli.js` |
| CLI-03 | `src/cli.js` |
| CLI-04 | `src/cli.js` |
| CLI-05 | `src/cli.js` |
| CLI-06 | `src/cli.js` |
| CLI-07 | `src/cli.js` |
| CLI-08 | `test/cli.test.js` (create) |
| DOG-01 | `dogfood/pan-check-update.js` (create) |
| DOG-02 | `dogfood/pan-check-update.js` |
| DOG-03 | `dogfood/parallel-test.js` (create); references `test/helpers/child-writer.js` (read-only) |

---

## Sources

### Primary (HIGH confidence)
- `D:\PanWizard\hooks\pan-check-update.js` — original hook analyzed directly; ad-hoc cache pattern confirmed
- `~\pan-experiments\whoocache\src\cache.js` — Phase 2 implementation; public API surface confirmed
- `~\pan-experiments\whoocache\test\helpers\child-writer.js` — existing fixture; `WRITES` env var confirmed
- `~\pan-experiments\whoocache\package.json` — current `bin` field absent, confirmed add required
- `.planning/research/stack.md` — `parseArgs` signature, `node:util`, stdin cross-platform pattern (HIGH)
- Node.js `process.exitCode` docs — prefer over `process.exit()` for sync I/O safety (HIGH)

### Secondary (MEDIUM confidence)
- Node.js `fs.readFileSync(0)` cross-platform behavior — stdin fd 0 works on both POSIX and Windows (MEDIUM — known pattern, not explicitly re-verified against official docs for this session)

### Tertiary (LOW confidence)
- None — all findings derive from direct source inspection or previously researched stack

---

## Infrastructure Dependencies

None — Phase 3 requires only T1 tests (unit + process-spawn). No Docker services, no external databases, no network services. The dogfood parallel test (`dogfood/parallel-test.js`) is a standalone script, not part of `node --test`.

---

## Metadata

**Confidence breakdown:**
- CLI stack (parseArgs, exit codes, stdout discipline): HIGH — all from verified project stack.md + source analysis
- Dogfood design: HIGH — original PAN hook read directly; architecture follows same pattern as Phase 2 concurrency fixtures
- Cross-platform stdin: MEDIUM — `readFileSync(0)` pattern is well-known but not re-verified against official docs this session

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (stable APIs; 30-day window appropriate)
