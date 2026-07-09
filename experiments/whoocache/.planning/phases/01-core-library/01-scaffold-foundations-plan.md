---
phase: 01-core-library
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - .gitignore
  - test/helpers/tmp-namespace.js
  - src/errors.js
  - test/errors.test.js
  - src/keys.js
  - test/keys.test.js
  - src/atomic-write.js
  - test/atomic-write.test.js
autonomous: true
requirements:
  - API-09
  - API-10
  - API-08
  - STOR-07
  - STOR-09
  - ATOM-01
  - ATOM-02
  - ATOM-03
  - PLAT-01
  - PLAT-04
  - ERR-01
  - ERR-02
  - ERR-03

must_haves:
  truths:
    - "`require('whoocache')` works from a CommonJS host (no `\"type\":\"module\"` in package.json)"
    - "`new LockTimeoutError('m','/p').code === 'LOCK_TIMEOUT'` and `.lockfilePath === '/p'`"
    - "`keys.validateKey(123)` throws TypeError; `keys.validateKey('')` throws TypeError; `keys.validateKey('ok')` returns 'ok'"
    - "`keys.keyToFilename('hello')` returns the 64-char sha256 hex of 'hello'"
    - "`atomic-write.writeAtomic(target, Buffer.from('x'), tmpDir)` produces `target` with content 'x' and leaves no leftover .tmp file"
    - "`atomic-write.fsyncDir('/path/that/exists')` does not throw on Linux; swallows EBADF/EINVAL/EISDIR/EPERM/EACCES on any platform"
  artifacts:
    - path: "package.json"
      provides: "CJS package metadata, engines.node>=16.17.0, no type:module"
      contains: "\"engines\""
    - path: ".gitignore"
      provides: "Ignore node_modules, log files, leaked test dirs"
      contains: "node_modules"
    - path: "test/helpers/tmp-namespace.js"
      provides: "createTmpNamespace / cleanupTmpNamespace"
      exports: ["createTmpNamespace", "cleanupTmpNamespace"]
    - path: "src/errors.js"
      provides: "LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError"
      exports: ["LockTimeoutError", "CorruptIndexError", "StaleIndexError", "CachePermissionError"]
    - path: "src/keys.js"
      provides: "keyToFilename(key), validateKey(key)"
      exports: ["keyToFilename", "validateKey"]
    - path: "src/atomic-write.js"
      provides: "writeAtomic(targetPath, data, tmpDir), fsyncDir(dirPath)"
      exports: ["writeAtomic", "fsyncDir"]
    - path: "test/errors.test.js"
      provides: "Unit tests for error class shape (code, payload)"
      min_lines: 20
    - path: "test/keys.test.js"
      provides: "Unit tests for validateKey/keyToFilename"
      min_lines: 20
    - path: "test/atomic-write.test.js"
      provides: "Unit tests for writeAtomic + fsyncDir"
      min_lines: 25
  key_links:
    - from: "src/atomic-write.js"
      to: "node:fs"
      via: "openSync+writeSync+fsyncSync+closeSync+renameSync sequence"
      pattern: "fs\\.openSync.*fs\\.writeSync.*fs\\.fsyncSync.*fs\\.closeSync.*fs\\.renameSync"
    - from: "src/keys.js"
      to: "node:crypto"
      via: "createHash('sha256') for keyToFilename"
      pattern: "createHash\\(['\"]sha256['\"]"
---

<objective>
Stand up the project skeleton (package.json, .gitignore, test helper) and the three foundation modules (`errors.js`, `keys.js`, `atomic-write.js`) plus their micro-tests. These are the leaf-level primitives — every later plan in Phase 1 (and Phase 2) depends on them. They are pure / I/O-leaf and have no inter-dependencies, so this single plan can build them all.

Purpose: Without these, no other Phase 1 module can be authored — `index-file.js` needs `atomic-write` and `errors`; `cache.js` needs `keys`. We also lock the public error-class export surface here so Phase 2 cannot accidentally break it.

Output: A buildable npm package skeleton plus three foundation source files plus three micro-test files, all green under `node --test`.
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
@.planning/phases/01-core-library/01-research.md
@.planning/research/architecture.md
@.planning/research/stack.md
@.planning/research/pitfalls.md

<resolved_open_questions>
The five open questions from `01-research.md` were resolved by the planner before this plan was authored:

1. **Buffer in `set()` API:** Accept `string | Buffer`; throw `TypeError` on anything else. Reconciles API-07 with STOR-08. (Affects Plan 02.)
2. **Crash-recovery test in Phase 1:** Include a minimal "leftover .tmp file in tmp/ does not break createCache" test. (Affects Plan 03.)
3. **`src/lock.js`:** Ship as a no-op shim — `withLock(lockPath, fn) { return fn(); }`. `cache.js` calls through it from day one. (Affects Plan 02.)
4. **`src/eviction.js`:** Do NOT build in Phase 1. `cache.js` accepts `maxBytes`/`maxEntries` opts but does not enforce them. (Affects Plan 02.)
5. **Encoding detection:** `'base64'` only when caller passes a `Buffer`; strings always get `'utf8'`. No invalid-UTF-8 heuristic. (Affects Plan 02.)
</resolved_open_questions>

<interfaces>
<!-- Contracts this plan establishes for downstream plans (Plan 02 and Plan 03). -->
<!-- Executors of this plan must produce these exact signatures. -->

src/errors.js exports:
```js
class LockTimeoutError extends Error {
  constructor(message, lockfilePath) {
    super(message);
    this.name = 'LockTimeoutError';
    this.code = 'LOCK_TIMEOUT';
    this.lockfilePath = lockfilePath;
  }
}
class CorruptIndexError extends Error {
  constructor(message, indexPath) {
    super(message);
    this.name = 'CorruptIndexError';
    this.code = 'CORRUPT_INDEX';
    this.indexPath = indexPath;
  }
}
class StaleIndexError extends Error {
  constructor(message, foundVersion, supportedVersion) {
    super(message);
    this.name = 'StaleIndexError';
    this.code = 'STALE_INDEX';
    this.foundVersion = foundVersion;
    this.supportedVersion = supportedVersion;
  }
}
class CachePermissionError extends Error {
  constructor(message, path) {
    super(message);
    this.name = 'CachePermissionError';
    this.code = 'CACHE_PERMISSION';
    this.path = path;
  }
}
module.exports = { LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError };
```

src/keys.js exports:
```js
function validateKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('key must be a non-empty string');
  }
  return key;
}
function keyToFilename(key) {
  // Validate first; produce 64-char sha256 hex
  validateKey(key);
  return require('crypto').createHash('sha256').update(key).digest('hex');
}
module.exports = { validateKey, keyToFilename };
```

src/atomic-write.js exports:
```js
function writeAtomic(targetPath, data, tmpDir) {
  // data: string | Buffer
  // tmpDir: directory for .tmp staging (must exist)
  // Sequence: openSync('w') → writeSync → fsyncSync → closeSync → renameSync → fsyncDir(dirname)
}
function fsyncDir(dirPath) {
  // try { open(dir,'r') → fsyncSync → close } catch { swallow EBADF/EINVAL/EISDIR/EPERM/EACCES; rethrow others }
}
module.exports = { writeAtomic, fsyncDir };
```

test/helpers/tmp-namespace.js exports:
```js
function createTmpNamespace(label = 'test') { /* returns { nsName, cacheDir } */ }
function cleanupTmpNamespace(cacheDir) { /* fs.rmSync(cacheDir, {recursive:true, force:true}) */ }
module.exports = { createTmpNamespace, cleanupTmpNamespace };
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Project scaffold (package.json, .gitignore, test helper)</name>
  <files>package.json, .gitignore, test/helpers/tmp-namespace.js</files>
  <action>
Create the npm package skeleton and the shared test helper. Three files; no logic beyond what's specified below.

**package.json** — exact shape (do not deviate):
```json
{
  "name": "whoocache",
  "version": "0.1.0",
  "description": "Zero-dep, sync, file-based cache with TTL and LRU for Node.js CLIs",
  "main": "./src/cache.js",
  "exports": {
    ".": "./src/cache.js"
  },
  "engines": {
    "node": ">=16.17.0"
  },
  "files": ["src/", "README.md"],
  "scripts": {
    "test": "node --test test/*.test.js"
  },
  "license": "MIT",
  "dependencies": {}
}
```
**Constraints:**
- DO NOT add `"type": "module"` (API-09 — must remain CommonJS).
- DO NOT add devDependencies (zero-dep is the project ethos; `node:test` is built in).
- DO NOT add `"./cli"` to `exports` yet — CLI is Phase 3.
- `engines.node: ">=16.17.0"` is the tightest correct minimum (API-10). Do not raise to 18+; do not lower below 16.17.

**.gitignore** — minimal:
```
node_modules/
*.log
.DS_Store
whoocache-test/
.planning/run-state.json
```

**test/helpers/tmp-namespace.js** — copy verbatim from research:
```js
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createTmpNamespace(label = 'test') {
  const id = crypto.randomBytes(4).toString('hex');
  const nsName = `${label}-${id}`.toLowerCase();
  const cacheDir = path.join(os.tmpdir(), 'whoocache-test', nsName);
  fs.mkdirSync(cacheDir, { recursive: true });
  return { nsName, cacheDir };
}

function cleanupTmpNamespace(cacheDir) {
  fs.rmSync(cacheDir, { recursive: true, force: true });
}

module.exports = { createTmpNamespace, cleanupTmpNamespace };
```

Note: `'use strict';` directive is required at the top of every src/ and test/ JS file in this project — the codebase is CommonJS and we want strict-mode semantics throughout.
  </action>
  <verify>
    <automated>node -e "const p=require('./package.json'); if(p.engines.node!=='>=16.17.0')process.exit(1); if(p.type)process.exit(2); if(p.main!=='./src/cache.js')process.exit(3); console.log('ok')"</automated>
    Also: `node -e "const h=require('./test/helpers/tmp-namespace.js'); const {nsName,cacheDir}=h.createTmpNamespace('smoke'); require('fs').statSync(cacheDir); h.cleanupTmpNamespace(cacheDir); console.log('ok')"` prints `ok`.
  </verify>
  <done>
- `package.json` exists with `engines.node: ">=16.17.0"`, `main: ./src/cache.js`, no `type` field, empty `dependencies`.
- `.gitignore` exists and lists `node_modules/`, `whoocache-test/`.
- `test/helpers/tmp-namespace.js` exports `createTmpNamespace` and `cleanupTmpNamespace`; the smoke command above prints `ok`.
  </done>
</task>

<task type="auto">
  <name>Task 2: errors.js + errors.test.js (4 typed error classes, locked surface)</name>
  <files>src/errors.js, test/errors.test.js</files>
  <action>
Create the four typed error classes specified in the `<interfaces>` block above. Implementation rules:

1. Each class extends `Error` directly. Modern V8 (Node 16.17+) supports `extends Error` natively — DO NOT use `Object.setPrototypeOf` or hand-rolled prototype hacks.
2. Each class sets `this.name = '<ClassName>'` in the constructor (so `err.name` matches). Standard JS errors do this and tooling (node:test, console.log) rely on it.
3. Each class sets a stable `this.code` property: `LOCK_TIMEOUT`, `CORRUPT_INDEX`, `STALE_INDEX`, `CACHE_PERMISSION` (ERR-02).
4. Per ERR-03: `LockTimeoutError(message, lockfilePath)` carries `this.lockfilePath`. `CachePermissionError(message, path)` carries `this.path`. The message passed to the parent constructor IS the actionable message — do not auto-prepend.
5. `CorruptIndexError(message, indexPath)` carries `this.indexPath`. `StaleIndexError(message, foundVersion, supportedVersion)` carries both version fields (used by `index-file.js` in Plan 02 to throw with full context).
6. Single `module.exports = { LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError };` line at the bottom.
7. Even though `LockTimeoutError` is not THROWN until Phase 2, the export contract is locked HERE so Phase 2's lock.js can import it and callers can `instanceof`-check against a stable surface.

**test/errors.test.js** — minimum 4 sub-tests, all using `node:test` + `node:assert/strict`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError } = require('../src/errors');

test('LockTimeoutError carries code and lockfilePath (ERR-02, ERR-03)', () => {
  const err = new LockTimeoutError('lock timed out', '/tmp/x.lock');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'LockTimeoutError');
  assert.equal(err.code, 'LOCK_TIMEOUT');
  assert.equal(err.lockfilePath, '/tmp/x.lock');
  assert.equal(err.message, 'lock timed out');
});

test('CorruptIndexError carries code and indexPath', () => {
  const err = new CorruptIndexError('bad json', '/tmp/index.json');
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'CORRUPT_INDEX');
  assert.equal(err.indexPath, '/tmp/index.json');
});

test('StaleIndexError carries version fields', () => {
  const err = new StaleIndexError('too new', 2, 1);
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'STALE_INDEX');
  assert.equal(err.foundVersion, 2);
  assert.equal(err.supportedVersion, 1);
});

test('CachePermissionError carries actionable path (ERR-03)', () => {
  const err = new CachePermissionError('cannot write to /etc/whoocache', '/etc/whoocache');
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'CACHE_PERMISSION');
  assert.equal(err.path, '/etc/whoocache');
  assert.match(err.message, /\/etc\/whoocache/);
});
```
  </action>
  <verify>
    <automated>node --test test/errors.test.js</automated>
  </verify>
  <done>
- `src/errors.js` exports all 4 classes; each has correct `code`; `LockTimeoutError.lockfilePath` and `CachePermissionError.path` are accessible.
- `test/errors.test.js` has ≥4 passing tests under `node --test`.
- `instanceof Error` is true for all four (ERR-02 implies all extend Error).
  </done>
</task>

<task type="auto">
  <name>Task 3: keys.js + atomic-write.js + their micro-tests</name>
  <files>src/keys.js, test/keys.test.js, src/atomic-write.js, test/atomic-write.test.js</files>
  <action>
Build the two leaf primitives. Both are pure or I/O-leaf — no other src/ module imports yet exist.

**src/keys.js** (per `<interfaces>` block):
```js
'use strict';
const crypto = require('crypto');

function validateKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('key must be a non-empty string');
  }
  return key;
}

function keyToFilename(key) {
  validateKey(key);
  return crypto.createHash('sha256').update(key).digest('hex'); // 64 hex chars per STOR-07
}

module.exports = { validateKey, keyToFilename };
```

**Constraints (keys.js):**
- Full 64-char sha256 hex per STOR-07. DO NOT truncate to 32 chars (research.md notes this conflict — STOR-07 wins).
- DO NOT add file extension to the filename — research.md and STOR-07 both call for "no extension".
- `validateKey` rejects empty string AND non-string types (covers API-08).

**test/keys.test.js** — minimum 4 sub-tests:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { validateKey, keyToFilename } = require('../src/keys');

test('validateKey rejects non-string types (API-08)', () => {
  assert.throws(() => validateKey(123), TypeError);
  assert.throws(() => validateKey(null), TypeError);
  assert.throws(() => validateKey(undefined), TypeError);
  assert.throws(() => validateKey({}), TypeError);
  assert.throws(() => validateKey(Buffer.from('x')), TypeError);
});

test('validateKey rejects empty string (API-08)', () => {
  assert.throws(() => validateKey(''), TypeError);
});

test('validateKey returns the key unchanged for valid strings', () => {
  assert.equal(validateKey('hello'), 'hello');
});

test('keyToFilename produces 64-char sha256 hex (STOR-07)', () => {
  const fn = keyToFilename('hello');
  assert.equal(fn.length, 64);
  assert.match(fn, /^[0-9a-f]{64}$/);
  // Verify it equals the canonical sha256 of 'hello'
  const expected = crypto.createHash('sha256').update('hello').digest('hex');
  assert.equal(fn, expected);
});

test('keyToFilename validates input (delegates to validateKey)', () => {
  assert.throws(() => keyToFilename(''), TypeError);
  assert.throws(() => keyToFilename(42), TypeError);
});
```

**src/atomic-write.js** (per `<interfaces>` block, expanded):
```js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function writeAtomic(targetPath, data, tmpDir) {
  // data must be string or Buffer; tmpDir must exist (caller's responsibility)
  const tmpName = crypto.randomBytes(8).toString('hex') + '.tmp';
  const tmpPath = path.join(tmpDir, tmpName);

  // ATOM-01: explicit fd sequence, NEVER fs.writeFileSync
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // POSIX atomic swap (Phase 2 will add Windows EPERM retry per PLAT-02)
  fs.renameSync(tmpPath, targetPath);

  // ATOM-03: durability — fsync the directory; PLAT-04 try/catch
  fsyncDir(path.dirname(targetPath));
}

function fsyncDir(dirPath) {
  let dirFd;
  try {
    dirFd = fs.openSync(dirPath, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (err) {
    // PLAT-04: Windows / certain filesystems may not support directory fsync
    if (['EBADF', 'EINVAL', 'EISDIR', 'EPERM', 'EACCES'].includes(err.code)) return;
    throw err;
  }
}

module.exports = { writeAtomic, fsyncDir };
```

**Constraints (atomic-write.js):**
- DO NOT use `fs.writeFileSync` — it does not return an fd, so we cannot fsync (pitfall C-4, ATOM-01).
- The fd-write-fsync-close-rename-fsyncDir sequence MUST appear in this order. The ESLint-style mnemonic: "OWFCRD" (Open Write Fsync Close Rename Dirfsync).
- `tmpDir` is passed in (caller manages its existence) — DO NOT mkdir inside writeAtomic. The Phase 2 cache.js constructor creates `tmp/` once.
- The `.tmp` filename uses `crypto.randomBytes(8)` per ATOM-02 — 16 hex chars + `.tmp` extension. DO NOT use `Date.now()` or PID-based naming (collision-prone).
- `fsyncDir` swallows the documented set of cross-platform errors. DO NOT swallow `ENOENT` (real bug — directory doesn't exist) or `ENOSPC`.

**test/atomic-write.test.js** — minimum 4 sub-tests:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTmpNamespace, cleanupTmpNamespace } = require('./helpers/tmp-namespace');
const { writeAtomic, fsyncDir } = require('../src/atomic-write');

test('writeAtomic writes the data to targetPath', () => {
  const { cacheDir } = createTmpNamespace('atomic');
  const tmpDir = path.join(cacheDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const target = path.join(cacheDir, 'out.bin');
  writeAtomic(target, Buffer.from('hello world'), tmpDir);
  assert.equal(fs.readFileSync(target, 'utf8'), 'hello world');
  cleanupTmpNamespace(cacheDir);
});

test('writeAtomic leaves no .tmp files behind in tmpDir after success', () => {
  const { cacheDir } = createTmpNamespace('atomic');
  const tmpDir = path.join(cacheDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const target = path.join(cacheDir, 'out.bin');
  writeAtomic(target, 'string-data', tmpDir);
  const leftover = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftover, []);
  cleanupTmpNamespace(cacheDir);
});

test('writeAtomic accepts string and Buffer payloads', () => {
  const { cacheDir } = createTmpNamespace('atomic');
  const tmpDir = path.join(cacheDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  writeAtomic(path.join(cacheDir, 'a'), 'plain', tmpDir);
  writeAtomic(path.join(cacheDir, 'b'), Buffer.from([0xff, 0x00, 0xfe]), tmpDir);
  assert.equal(fs.readFileSync(path.join(cacheDir, 'a'), 'utf8'), 'plain');
  assert.deepEqual(Array.from(fs.readFileSync(path.join(cacheDir, 'b'))), [0xff, 0x00, 0xfe]);
  cleanupTmpNamespace(cacheDir);
});

test('fsyncDir does not throw on a real directory (Linux)', () => {
  const { cacheDir } = createTmpNamespace('fsyncdir');
  assert.doesNotThrow(() => fsyncDir(cacheDir));
  cleanupTmpNamespace(cacheDir);
});

test('fsyncDir swallows expected cross-platform errors but rethrows ENOENT', () => {
  // ENOENT must propagate (real bug) — call with a path that does not exist
  assert.throws(() => fsyncDir('/this/path/should/not/exist/xyz'), { code: 'ENOENT' });
});
```

Note: the ENOENT test is environment-dependent — on Windows the path must use a Windows-shaped non-existent path. Use a path constructed with `path.join` to be safe:
```js
const ghost = path.join(cacheDir, 'this-subdir-does-not-exist');
assert.throws(() => fsyncDir(ghost));
```
(Don't pin to `code === 'ENOENT'` since a different code may be raised on Windows; just assert it throws.)
  </action>
  <verify>
    <automated>node --test test/keys.test.js test/atomic-write.test.js</automated>
  </verify>
  <done>
- `src/keys.js` exports `validateKey` and `keyToFilename`; sha256 hex is full 64 chars.
- `src/atomic-write.js` exports `writeAtomic` and `fsyncDir`; uses the explicit fd sequence; swallows the PLAT-04 error set in `fsyncDir`.
- Both micro-test files green under `node --test`.
- No leftover .tmp files in tmp/ after a successful writeAtomic call.
  </done>
</task>

</tasks>

<verification>
After all 3 tasks complete, run the combined check:

```bash
node --test test/errors.test.js test/keys.test.js test/atomic-write.test.js
```

All micro-tests green. The package skeleton + foundations are now in place for Plan 02 (composition: ttl.js, index-file.js, lock.js shim, cache.js).
</verification>

<success_criteria>
- `package.json`, `.gitignore`, `test/helpers/tmp-namespace.js` exist with the exact shapes specified.
- `src/errors.js` exports the 4 typed error classes; each carries the documented `code` and payload fields.
- `src/keys.js` exports `validateKey` (rejects non-string + empty) and `keyToFilename` (full 64-char sha256 hex).
- `src/atomic-write.js` exports `writeAtomic` (open+write+fsync+close+rename+fsyncDir sequence; never `writeFileSync`) and `fsyncDir` (PLAT-04 try/catch).
- All three micro-test files (`test/errors.test.js`, `test/keys.test.js`, `test/atomic-write.test.js`) pass under `node --test`.
</success_criteria>

<output>
After completion, create `.planning/phases/01-core-library/01-scaffold-foundations-summary.md` documenting:
- Final file list and line counts
- Key design notes for downstream plans (e.g. "writeAtomic accepts string OR Buffer; tmpDir caller-managed")
- Any deviations from this plan and why
</output>
