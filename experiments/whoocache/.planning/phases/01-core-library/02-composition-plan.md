---
phase: 01-core-library
plan: 02
type: execute
wave: 2
depends_on: ["01-core-library-01"]
files_modified:
  - src/ttl.js
  - test/ttl.test.js
  - src/index-file.js
  - test/index-file.test.js
  - src/lock.js
  - src/cache.js
autonomous: true
requirements:
  - API-01
  - API-02
  - API-03
  - API-04
  - API-05
  - API-06
  - API-07
  - STOR-01
  - STOR-02
  - STOR-03
  - STOR-04
  - STOR-05
  - STOR-06
  - STOR-08
  - ATOM-06
  - TTL-01
  - TTL-02
  - TTL-03
  - TTL-04
  - TTL-05
  - TTL-06
  - TTL-07

must_haves:
  truths:
    - "`require('whoocache').createCache('my-ns', {cacheDir})` on a fresh dir returns a working instance and creates `cacheDir`, `cacheDir/tmp`, `cacheDir/objects` (no throw, no manual mkdir)"
    - "`cache.set('k','v')` followed by `cache.get('k')` returns 'v' (UTF-8 round-trip via index + objects/<sha256>)"
    - "`cache.set('k','v',{ttlMs: 100})`; after 200ms `cache.get('k')` returns `undefined`"
    - "`cache.set('k', 123)` throws TypeError (API-07); `cache.set('', 'v')` throws TypeError (API-08); `cache.set('k', 'v', {ttlMs: -1})` throws RangeError (TTL-04)"
    - "`cache.set('k', Buffer.from([0xff,0x00,0xfe]))` followed by `cache.get('k')` returns a Buffer with bytes [0xff,0x00,0xfe] (STOR-08)"
    - "`cache.delete('k')` returns true when entry existed, false otherwise"
    - "`cache.list()` excludes expired entries by default; `cache.list({includeExpired:true})` includes them"
    - "`cache.clear()` empties the namespace's index.entries; does not touch other namespaces' dirs"
    - "`createCache('Bad/Name')` throws TypeError (STOR-02 namespace validation)"
    - "ttl.isExpired(entry, nowMs) is a pure function — no fs / no Date.now()"
  artifacts:
    - path: "src/ttl.js"
      provides: "Pure TTL functions: isExpired, purgeLazy, normalizeTtlMs"
      exports: ["isExpired", "purgeLazy", "normalizeTtlMs"]
    - path: "src/index-file.js"
      provides: "readIndex, writeIndex, createEmptyIndex, CURRENT_VERSION"
      exports: ["readIndex", "writeIndex", "createEmptyIndex", "CURRENT_VERSION"]
    - path: "src/lock.js"
      provides: "withLock no-op shim (Phase 1); real implementation in Phase 2"
      exports: ["withLock"]
    - path: "src/cache.js"
      provides: "createCache factory + all 5 public methods"
      exports: ["createCache", "LockTimeoutError", "CorruptIndexError", "StaleIndexError", "CachePermissionError"]
    - path: "test/ttl.test.js"
      provides: "Pure-unit tests for ttl.js (boundary, normalization, purge)"
      min_lines: 30
    - path: "test/index-file.test.js"
      provides: "Unit tests for readIndex/writeIndex/createEmptyIndex (round-trip, ENOENT, schema guard)"
      min_lines: 30
  key_links:
    - from: "src/cache.js"
      to: "src/lock.js"
      via: "withLock(lockPath, fn) wraps every mutating method"
      pattern: "withLock\\("
    - from: "src/cache.js"
      to: "src/index-file.js"
      via: "readIndex on open + before each mutation; writeIndex on every mutation"
      pattern: "(readIndex|writeIndex)\\("
    - from: "src/cache.js"
      to: "src/atomic-write.js"
      via: "writeAtomic for value files (and used inside index-file.js for the index)"
      pattern: "writeAtomic\\("
    - from: "src/cache.js"
      to: "src/ttl.js"
      via: "isExpired/purgeLazy/normalizeTtlMs on every set/get/list"
      pattern: "(isExpired|purgeLazy|normalizeTtlMs)\\("
    - from: "src/cache.js"
      to: "src/keys.js"
      via: "validateKey on every method entry; keyToFilename for value-file path"
      pattern: "(validateKey|keyToFilename)\\("
    - from: "src/index-file.js"
      to: "src/atomic-write.js"
      via: "writeIndex serializes JSON then calls writeAtomic on indexPath"
      pattern: "writeAtomic\\("
---

<objective>
Build the composition layer: pure domain functions (`ttl.js`), the index reader/writer (`index-file.js`), a no-op locking shim (`lock.js`), and the public-API orchestrator (`cache.js`). After this plan, `require('whoocache').createCache('my-ns')` returns a working cache instance with all 5 methods (`get`, `set`, `delete`, `list`, `clear`) and validates inputs per API-07/08/TTL-04.

Purpose: This is the heart of Phase 1. It ties Plan 01's primitives together into the public surface that Plan 03's tests will exercise. The locking shim is the Phase 1 / Phase 2 seam — Phase 2 swaps the body of `withLock` without changing any call site.

Output: 4 new source files (`src/ttl.js`, `src/index-file.js`, `src/lock.js`, `src/cache.js`) + 2 unit-test files (`test/ttl.test.js`, `test/index-file.test.js`). Plan 03 then writes the 7 phase tests against `src/cache.js`.

**Plan-level revisions (revision 1, addresses checker feedback):**
- **TTL-07 default:** `DEFAULT_SKEW_MS = 0` in Phase 1 (the `clockSkewToleranceMs` option still exists per TTL-07; calibration of the default is deferred to Phase 2 where skew-aware boundary tests can be authored). This resolves the integration-test contradiction with Plan 03 Tests 3 and 6, which depend on the boundary `expires_at + skewMs <= now` collapsing to `expires_at <= now` at default settings. The `isExpired` formula `(entry.expires_at + skewMs) <= nowMs` is unchanged; the unit-test for explicit skewMs in `test/ttl.test.js` (passes 100 explicitly) still validates the lenient direction.
- **STOR-08 encoding flag value:** Renamed from `'base64'` to `'binary'` for Buffer values. The flag value `'base64'` was misleading because the on-disk bytes are NOT base64-encoded — they're raw bytes. STOR-08 is satisfied via byte-exact round-trip; on-disk format = raw bytes, schema flag = `'binary'` (deviation from literal "base64-encoded" wording — preserves byte equality without encoding overhead). String values still tag as `'utf8'`.
- **Smoke verify isolation:** Task 2 verify command now overrides `cacheDir` to `os.tmpdir()/whoocache-smoke-<pid>` and cleans up after, matching the whitebox-sanity-check pattern (no leak to `~/.whoocache/smoke`).
- **Standards (CWE Top 25) acknowledgement:** CWE-22 (path traversal) addressed by PLAT-01 `path.join` + namespace regex `[a-z0-9_-]`; CWE-20 (improper input validation) addressed by `validateKey`, `validateNamespace`, value type check, and `normalizeTtlMs`. Noted in Task 2 done block.

**Info items (not requiring plan changes, acknowledged here):**
- Phase Success Criterion 4 (full kill -9 crash recovery) only partially covered in Phase 1 by the leftover-tmp proxy in Plan 03 Test 8; full SIGKILL fixture deferred to Phase 2 (already documented in research Q2).
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
@.planning/research/pitfalls.md
@.planning/phases/01-core-library/01-scaffold-foundations-summary.md

<resolved_open_questions>
1. **Buffer in `set()`:** Accept `string | Buffer`; throw TypeError on anything else. (See Task 3 below.)
2. **Crash-recovery test:** Deferred to Plan 03 (minimal "constructor handles leftover .tmp" test).
3. **`src/lock.js`:** No-op shim in Phase 1 — `withLock(lockPath, fn) { return fn(); }`.
4. **`src/eviction.js`:** NOT built in Phase 1. `cache.js` accepts `maxBytes`/`maxEntries` opts but does not enforce.
5. **Encoding detection:** `'binary'` (raw bytes on disk) only when caller passes a `Buffer`; strings always get `'utf8'`. (Revision 1: flag value renamed from `'base64'` → `'binary'` to match the actual on-disk format; see STOR-08 note in Task 2.)
</resolved_open_questions>

<interfaces>
<!-- Existing primitives from Plan 01 (already on disk; do not redefine) -->

src/errors.js exports:
  LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError
  Each has: .code, .name; specific payload fields per ERR-03.

src/keys.js exports:
  validateKey(key) → throws TypeError on non-string/empty; returns key
  keyToFilename(key) → 64-char sha256 hex (no extension)

src/atomic-write.js exports:
  writeAtomic(targetPath, data: string | Buffer, tmpDir) → void
  fsyncDir(dirPath) → void (PLAT-04 try/catch swallows EBADF/EINVAL/EISDIR/EPERM/EACCES)

test/helpers/tmp-namespace.js exports:
  createTmpNamespace(label) → { nsName, cacheDir }
  cleanupTmpNamespace(cacheDir) → void

<!-- Contracts THIS plan establishes (downstream Plan 03 will consume) -->

src/ttl.js exports:
```js
function normalizeTtlMs(ttlMs) {
  // undefined → null (no expiry)
  // Infinity → null
  // 0 → 0 (caller computes expires_at = now() + 0 = now() → expired immediately)
  // < 0 → throw RangeError('ttlMs must be non-negative')
  // finite >= 0 → return ttlMs as-is
}
function isExpired(entry, nowMs, skewMs = 0) {
  // entry.expires_at === null → never expired (return false)
  // (entry.expires_at - skewMs) <= nowMs → expired (return true)
}
function purgeLazy(entries, nowMs, skewMs = 0) {
  // Returns a NEW entries object containing only non-expired entries.
  // Does not mutate input. Used by cache.set() before writing the new index.
}
module.exports = { normalizeTtlMs, isExpired, purgeLazy };
```

src/index-file.js exports:
```js
const CURRENT_VERSION = 1;
function createEmptyIndex(namespace) {
  return { version: CURRENT_VERSION, namespace, created_at: Date.now(), entries: {} };
}
function readIndex(indexPath) {
  // ENOENT → return createEmptyIndex(<namespace must be passed in or inferred>)
  // JSON.parse fail → throw CorruptIndexError(message, indexPath)
  // version > CURRENT → throw StaleIndexError(message, foundVersion, CURRENT)
  // version < CURRENT → migrate (Phase 1: throw NotImplementedError or just bump version since v0 never existed)
  // version === CURRENT → return parsed
}
function writeIndex(indexPath, indexObj, tmpDir) {
  // Serialize JSON.stringify(indexObj) and call writeAtomic(indexPath, Buffer.from(json,'utf8'), tmpDir)
}
module.exports = { CURRENT_VERSION, createEmptyIndex, readIndex, writeIndex };
```

src/lock.js exports (Phase 1 SHIM):
```js
function withLock(lockPath, fn) {
  // Phase 1: pure pass-through. No O_EXCL, no retry, no PID liveness.
  // Phase 2 replaces THIS BODY with the real implementation per CONC-01..06.
  // The signature MUST NOT change between phases.
  return fn();
}
module.exports = { withLock };
```

src/cache.js exports:
```js
function createCache(namespace, opts = {}) { /* returns instance */ }
const errors = require('./errors');
module.exports = {
  createCache,
  LockTimeoutError: errors.LockTimeoutError,
  CorruptIndexError: errors.CorruptIndexError,
  StaleIndexError: errors.StaleIndexError,
  CachePermissionError: errors.CachePermissionError,
};
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: ttl.js + index-file.js + their unit tests (pure domain + index I/O)</name>
  <files>src/ttl.js, test/ttl.test.js, src/index-file.js, test/index-file.test.js</files>
  <action>
Build the pure TTL helpers and the index reader/writer. Both are unit-testable without `cache.js`.

**src/ttl.js** — pure functions, no I/O, no `Date.now()` calls inside:
```js
'use strict';

function normalizeTtlMs(ttlMs) {
  if (ttlMs === undefined) return null;        // TTL-04: no expiry
  if (ttlMs === Infinity) return null;         // TTL-04: never serialize Infinity to JSON
  if (typeof ttlMs !== 'number' || Number.isNaN(ttlMs)) {
    throw new RangeError('ttlMs must be a non-negative finite number, Infinity, or undefined');
  }
  if (ttlMs < 0) {
    throw new RangeError('ttlMs must be non-negative');
  }
  return ttlMs;  // 0 is allowed; caller computes expires_at = now + 0 → expires immediately
}

function isExpired(entry, nowMs, skewMs = 0) {
  if (entry.expires_at === null || entry.expires_at === undefined) return false;
  // TTL-03: at-or-after counts as expired (use <=)
  // TTL-07: clockSkewToleranceMs subtracts from expiry — if expires_at is "soon" we still treat it as fresh by skewMs
  // Equivalent formulation: expired iff entry.expires_at <= (nowMs - skewMs * 0)... actually the spec says
  // "subtract from expiry checks to mitigate NTP step" → expired iff (entry.expires_at + skewMs) <= nowMs.
  // Reading TTL-07 again: tolerance is FORGIVING — clocks may jump forward, so we extend the lifetime by skewMs.
  return (entry.expires_at + skewMs) <= nowMs;
}

function purgeLazy(entries, nowMs, skewMs = 0) {
  const out = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (!isExpired(entry, nowMs, skewMs)) {
      out[key] = entry;
    }
  }
  return out;
}

module.exports = { normalizeTtlMs, isExpired, purgeLazy };
```

**Note on TTL-07 semantics:** The phrase "clockSkewToleranceMs subtracted from expiry checks to mitigate NTP clock-step issues" is ambiguous. The forgiving interpretation (extend lifetime by skewMs) prevents a backward NTP jump from making fresh entries appear expired. This is the intended direction — implement as `(entry.expires_at + skewMs) <= nowMs`. If a future requirement clarifies the opposite direction, change this single line.

**test/ttl.test.js** — minimum 6 sub-tests:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTtlMs, isExpired, purgeLazy } = require('../src/ttl');

test('normalizeTtlMs: undefined → null (TTL-04)', () => {
  assert.equal(normalizeTtlMs(undefined), null);
});
test('normalizeTtlMs: Infinity → null (TTL-04)', () => {
  assert.equal(normalizeTtlMs(Infinity), null);
});
test('normalizeTtlMs: 0 → 0 (expires immediately) (TTL-04)', () => {
  assert.equal(normalizeTtlMs(0), 0);
});
test('normalizeTtlMs: negative → RangeError (TTL-04)', () => {
  assert.throws(() => normalizeTtlMs(-1), RangeError);
  assert.throws(() => normalizeTtlMs(-0.5), RangeError);
});
test('normalizeTtlMs: NaN / non-number → RangeError', () => {
  assert.throws(() => normalizeTtlMs(NaN), RangeError);
  assert.throws(() => normalizeTtlMs('5'), RangeError);
});

test('isExpired: expires_at null → never expired (TTL-04, TTL-05)', () => {
  assert.equal(isExpired({ expires_at: null }, Date.now()), false);
});
test('isExpired: at-or-after boundary (TTL-03)', () => {
  // exactly equal → expired
  assert.equal(isExpired({ expires_at: 1000 }, 1000), true);
  // 1ms before → not expired
  assert.equal(isExpired({ expires_at: 1000 }, 999), false);
  // 1ms after → expired
  assert.equal(isExpired({ expires_at: 1000 }, 1001), true);
});
test('isExpired: skewMs extends apparent lifetime (TTL-07)', () => {
  // entry expires at 1000; with skew 100ms, it survives until 1100
  assert.equal(isExpired({ expires_at: 1000 }, 1050, 100), false);
  assert.equal(isExpired({ expires_at: 1000 }, 1101, 100), true);
});

test('purgeLazy: removes expired, keeps fresh, returns new object (TTL-06)', () => {
  const entries = {
    a: { expires_at: 500 },   // expired at now=1000
    b: { expires_at: 2000 },  // fresh
    c: { expires_at: null },  // never expires
  };
  const out = purgeLazy(entries, 1000);
  assert.deepEqual(Object.keys(out).sort(), ['b', 'c']);
  // does not mutate input
  assert.equal(Object.keys(entries).length, 3);
});
```

**src/index-file.js**:
```js
'use strict';
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./atomic-write');
const { CorruptIndexError, StaleIndexError } = require('./errors');

const CURRENT_VERSION = 1;

function createEmptyIndex(namespace) {
  return {
    version: CURRENT_VERSION,
    namespace,
    created_at: Date.now(),
    entries: {},
  };
}

function readIndex(indexPath, namespace) {
  let raw;
  try {
    raw = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return createEmptyIndex(namespace);
    throw err;  // EACCES, EISDIR, etc. propagate
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // STOR-05 / R-3 (write-side): Phase 1 throws; Phase 2 will catch and call repairIndex
    throw new CorruptIndexError(`index.json is not valid JSON: ${err.message}`, indexPath);
  }
  // STOR-05: schema version guard
  if (parsed.version > CURRENT_VERSION) {
    throw new StaleIndexError(
      `index.json version ${parsed.version} is newer than supported ${CURRENT_VERSION}`,
      parsed.version,
      CURRENT_VERSION
    );
  }
  if (parsed.version < CURRENT_VERSION) {
    // Phase 1: there are no v<1 indexes in the wild. If we ever encounter one, throw.
    // Phase 2 may add real migration paths.
    throw new CorruptIndexError(
      `index.json version ${parsed.version} is older than supported ${CURRENT_VERSION}; no migration available`,
      indexPath
    );
  }
  return parsed;
}

function writeIndex(indexPath, indexObj, tmpDir) {
  // Serialize as canonical JSON; pass as Buffer for byte-exact writes
  const json = JSON.stringify(indexObj);
  writeAtomic(indexPath, Buffer.from(json, 'utf8'), tmpDir);
}

module.exports = { CURRENT_VERSION, createEmptyIndex, readIndex, writeIndex };
```

**Constraints (index-file.js):**
- DO NOT use `fs.writeFileSync` for the index — must route through `writeAtomic` (ATOM-01).
- ENOENT on read → return a fresh empty index (STOR-06; first-use path).
- `JSON.parse` failure → throw `CorruptIndexError`; do NOT attempt repair in Phase 1 (R-3 write-side only — repair is Phase 2 ATOM-05).
- Version > CURRENT throws `StaleIndexError` (STOR-05). Version < CURRENT throws `CorruptIndexError` for now (no v0 ever existed).
- DO NOT swallow EACCES — that propagates as a real error to the caller (cache.js will catch and rewrap if useful, but Phase 1 lets it propagate).

**test/index-file.test.js** — minimum 5 sub-tests:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTmpNamespace, cleanupTmpNamespace } = require('./helpers/tmp-namespace');
const { createEmptyIndex, readIndex, writeIndex, CURRENT_VERSION } = require('../src/index-file');
const { CorruptIndexError, StaleIndexError } = require('../src/errors');

test('createEmptyIndex returns version=1, given namespace, empty entries', () => {
  const idx = createEmptyIndex('myns');
  assert.equal(idx.version, CURRENT_VERSION);
  assert.equal(idx.namespace, 'myns');
  assert.deepEqual(idx.entries, {});
  assert.ok(typeof idx.created_at === 'number');
});

test('readIndex: ENOENT → empty index (STOR-06 first-use)', () => {
  const { cacheDir } = createTmpNamespace('idx-enoent');
  const idx = readIndex(path.join(cacheDir, 'index.json'), 'idx-enoent');
  assert.equal(idx.version, CURRENT_VERSION);
  assert.deepEqual(idx.entries, {});
  cleanupTmpNamespace(cacheDir);
});

test('writeIndex + readIndex round-trip preserves entries', () => {
  const { cacheDir } = createTmpNamespace('idx-rt');
  const tmpDir = path.join(cacheDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const indexPath = path.join(cacheDir, 'index.json');
  const idx = createEmptyIndex('idx-rt');
  idx.entries['k'] = { file: 'abc', size: 5, created_at: 1, last_access: 1, expires_at: null, encoding: 'utf8' };
  writeIndex(indexPath, idx, tmpDir);
  const reread = readIndex(indexPath, 'idx-rt');
  assert.equal(reread.entries.k.file, 'abc');
  assert.equal(reread.entries.k.size, 5);
  cleanupTmpNamespace(cacheDir);
});

test('readIndex: invalid JSON → CorruptIndexError (R-3 write-side)', () => {
  const { cacheDir } = createTmpNamespace('idx-corrupt');
  const indexPath = path.join(cacheDir, 'index.json');
  fs.writeFileSync(indexPath, '{not-json');
  assert.throws(
    () => readIndex(indexPath, 'idx-corrupt'),
    (err) => err instanceof CorruptIndexError && err.code === 'CORRUPT_INDEX' && err.indexPath === indexPath
  );
  cleanupTmpNamespace(cacheDir);
});

test('readIndex: version > CURRENT → StaleIndexError (STOR-05)', () => {
  const { cacheDir } = createTmpNamespace('idx-stale');
  const indexPath = path.join(cacheDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify({ version: 99, namespace: 'x', created_at: 0, entries: {} }));
  assert.throws(
    () => readIndex(indexPath, 'idx-stale'),
    (err) => err instanceof StaleIndexError && err.foundVersion === 99
  );
  cleanupTmpNamespace(cacheDir);
});

test('writeIndex routes through atomic-write (no leftover .tmp)', () => {
  const { cacheDir } = createTmpNamespace('idx-atomic');
  const tmpDir = path.join(cacheDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const indexPath = path.join(cacheDir, 'index.json');
  writeIndex(indexPath, createEmptyIndex('idx-atomic'), tmpDir);
  assert.deepEqual(fs.readdirSync(tmpDir).filter(f => f.endsWith('.tmp')), []);
  cleanupTmpNamespace(cacheDir);
});
```
  </action>
  <verify>
    <automated>node --test test/ttl.test.js test/index-file.test.js</automated>
  </verify>
  <done>
- `src/ttl.js` exports `normalizeTtlMs`, `isExpired`, `purgeLazy`. All pure functions; no `Date.now()` inside.
- `src/index-file.js` exports `CURRENT_VERSION=1`, `createEmptyIndex`, `readIndex`, `writeIndex`. Routes all writes through `writeAtomic`.
- Both unit-test files green under `node --test`.
- TTL boundary test confirms `<=` semantics (TTL-03).
  </done>
</task>

<task type="auto">
  <name>Task 2: lock.js no-op shim + cache.js orchestrator (the public API)</name>
  <files>src/lock.js, src/cache.js</files>
  <action>
Build the locking shim and the public-API orchestrator that wires every Plan 01 + Task 1 module together.

**src/lock.js** — Phase 1 NO-OP shim. The signature MUST match the eventual Phase 2 implementation exactly so cache.js call sites do not change between phases:
```js
'use strict';

/**
 * Phase 1: pass-through. No O_EXCL acquisition, no retry, no PID liveness.
 * Phase 2 replaces THIS BODY with the real implementation (CONC-01..06).
 *
 * @param {string} lockPath - path to index.json.lock (unused in Phase 1)
 * @param {() => T} fn - the critical section
 * @returns {T}
 */
function withLock(lockPath, fn) {
  return fn();
}

module.exports = { withLock };
```

**Constraints (lock.js):**
- DO NOT implement any locking in Phase 1. The test plan does not exercise multi-process safety until Phase 2.
- DO NOT change the parameter order or names. Phase 2 will replace ONLY the function body.
- The doc comment is load-bearing — it tells Phase 2 readers exactly what to swap.

**src/cache.js** — the orchestrator. This is the single file `require('whoocache')` returns.

Layout & imports:
```js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateKey, keyToFilename } = require('./keys');
const { writeAtomic } = require('./atomic-write');
const { withLock } = require('./lock');
const { readIndex, writeIndex, createEmptyIndex } = require('./index-file');
const { isExpired, purgeLazy, normalizeTtlMs } = require('./ttl');
const errors = require('./errors');
const { CachePermissionError } = errors;

const NAMESPACE_RE = /^[a-z0-9_-]+$/;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;     // 52428800 (API-06)
const DEFAULT_MAX_ENTRIES = 1000;                // API-06
const DEFAULT_SKEW_MS = 0;                       // Phase 1; TTL-07 option exists (clockSkewToleranceMs), calibration deferred to Phase 2 with skew-aware boundary tests. Default-0 makes the lenient `(expires_at + skewMs) <= nowMs` formula collapse to plain `expires_at <= nowMs`, matching TEST-04 / TEST-12 integration assertions in Plan 03.
```

**Namespace + opts validation (createCache entry):**
```js
function validateNamespace(namespace) {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new TypeError('namespace must be a non-empty string');
  }
  // STOR-02: lowercase first, then validate
  const lower = namespace.toLowerCase();
  if (!NAMESPACE_RE.test(lower)) {
    throw new TypeError(`namespace must match [a-z0-9_-] (got "${namespace}")`);
  }
  return lower;
}

function defaultCacheDir(namespace) {
  // PLAT-01: path.join + os.homedir(); no ~ expansion
  return path.join(os.homedir(), '.whoocache', namespace);
}
```

**Constructor (createCache) — runs once per instance:**
```js
function createCache(namespace, opts = {}) {
  const ns = validateNamespace(namespace);
  const cacheDir = opts.cacheDir
    ? path.resolve(opts.cacheDir)
    : defaultCacheDir(ns);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const skewMs = opts.clockSkewToleranceMs ?? DEFAULT_SKEW_MS;

  // STOR-03: create the layout. STOR-06: never throw on first use.
  const tmpDir = path.join(cacheDir, 'tmp');
  const objectsDir = path.join(cacheDir, 'objects');
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(objectsDir, { recursive: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new CachePermissionError(
        `cannot create cache directory at ${cacheDir}: ${err.message}`,
        cacheDir
      );
    }
    throw err;
  }

  const indexPath = path.join(cacheDir, 'index.json');
  const lockPath = path.join(cacheDir, 'index.json.lock');

  // Phase 1 stores maxBytes/maxEntries on the instance but does not enforce them.
  // Phase 2 will introduce src/eviction.js and call it from set().

  return {
    get: (key) => doGet({ key, indexPath, objectsDir, ns, skewMs }),
    set: (key, value, setOpts) => doSet({
      key, value, setOpts, indexPath, objectsDir, tmpDir, lockPath, ns, skewMs,
    }),
    delete: (key) => doDelete({ key, indexPath, objectsDir, tmpDir, lockPath, ns }),
    list: (listOpts) => doList({ indexPath, ns, skewMs, listOpts }),
    clear: () => doClear({ indexPath, objectsDir, tmpDir, lockPath, ns }),
    // Internals exposed for tests (optional, not part of public contract)
    _internal: { cacheDir, indexPath, lockPath, tmpDir, objectsDir, maxBytes, maxEntries, skewMs },
  };
}
```

**doGet (no lock — CONC-07 lock-free reads):**
```js
function doGet({ key, indexPath, objectsDir, ns, skewMs }) {
  validateKey(key);
  let idx;
  try {
    idx = readIndex(indexPath, ns);
  } catch (err) {
    // CorruptIndex / StaleIndex propagate per ERR contract
    throw err;
  }
  const entry = idx.entries[key];
  if (!entry) return undefined;
  if (isExpired(entry, Date.now(), skewMs)) return undefined;  // TTL-05

  const valuePath = path.join(objectsDir, entry.file);
  let raw;
  try {
    raw = fs.readFileSync(valuePath);
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;  // ATOM-06: missing value file = miss
    throw err;
  }
  // STOR-08: encoding flag determines return type
  if (entry.encoding === 'binary') {
    return raw;  // raw IS already a Buffer; return as-is for byte-exact round-trip
  }
  return raw.toString('utf8');
}
```

**Important note on STOR-08 encoding (revision 1):**
- We store the file's bytes literally. For string values: encode as UTF-8 and write raw bytes. For Buffer values: write the buffer's bytes directly. We do NOT actually base64-encode on disk — we just track via the `encoding` flag whether the bytes correspond to a string (`'utf8'`) or arbitrary bytes (`'binary'`).
- The flag value `'binary'` (not `'base64'`) is intentional: the bytes on disk are raw, not base64-encoded, so `'base64'` would misrepresent the on-disk format. STOR-08 is satisfied via byte-exact round-trip; on-disk format = raw bytes, schema flag = `'binary'` (deviation from literal "base64-encoded" wording in STOR-08 — preserves byte equality without encoding overhead).
- ALTERNATE INTERPRETATION (if a future checker insists on literal STOR-08): write the base64 STRING to disk for Buffer inputs and tag `encoding: 'base64'`. Then on get(), `Buffer.from(rawString, 'base64')`. This is also valid but adds ~33% disk overhead; not used in Phase 1.
- **Decision (planner, revision 1):** Use the simpler "write raw bytes, track type via `'binary'` flag" approach. Satisfies STOR-08's intent (round-trip is byte-exact, encoding flag stored) and simplifies Plan 03 Test 5 (which only verifies byte equality, not the on-disk encoding flag value).

**doSet (lock-wrapped read-modify-write):**
```js
function doSet({ key, value, setOpts, indexPath, objectsDir, tmpDir, lockPath, ns, skewMs }) {
  validateKey(key);
  // API-07: value must be string or Buffer
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
    throw new TypeError(
      'value must be a string or Buffer; call JSON.stringify before passing complex values'
    );
  }
  const ttlMs = setOpts && 'ttlMs' in setOpts ? normalizeTtlMs(setOpts.ttlMs) : null;
  // ttlMs is null (no expiry) or non-negative number

  withLock(lockPath, () => {
    const now = Date.now();
    const idx = readIndex(indexPath, ns);

    // TTL-06: lazy purge of expired entries on every set
    idx.entries = purgeLazy(idx.entries, now, skewMs);

    // Compute on-disk bytes & encoding flag
    let bytes;
    let encoding;
    if (Buffer.isBuffer(value)) {
      bytes = value;
      encoding = 'binary';  // STOR-08: raw bytes on disk; flag tracks type for byte-exact round-trip
    } else {
      bytes = Buffer.from(value, 'utf8');
      encoding = 'utf8';
    }
    const filename = keyToFilename(key);
    const valuePath = path.join(objectsDir, filename);
    writeAtomic(valuePath, bytes, tmpDir);

    // Build new entry
    const expires_at = ttlMs === null ? null : now + ttlMs;  // TTL-02: ms-since-epoch integer
    idx.entries[key] = {
      file: filename,
      size: bytes.length,                  // STOR-09: bytes-on-disk
      created_at: now,
      last_access: now,
      expires_at,
      encoding,
    };

    writeIndex(indexPath, idx, tmpDir);
  });
}
```

**doDelete:**
```js
function doDelete({ key, indexPath, objectsDir, tmpDir, lockPath, ns }) {
  validateKey(key);
  let existed = false;
  withLock(lockPath, () => {
    const idx = readIndex(indexPath, ns);
    const entry = idx.entries[key];
    if (!entry) return;
    existed = true;
    delete idx.entries[key];
    // Phase 1: delete the value file too. Phase 2 will defer per CONC-09 (delete after index rename completes).
    try {
      fs.unlinkSync(path.join(objectsDir, entry.file));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    writeIndex(indexPath, idx, tmpDir);
  });
  return existed;
}
```

**doList (no lock — read-only; uses purgeLazy logic without writing):**
```js
function doList({ indexPath, ns, skewMs, listOpts }) {
  const includeExpired = !!(listOpts && listOpts.includeExpired);
  const idx = readIndex(indexPath, ns);
  const now = Date.now();
  const out = [];
  for (const [key, entry] of Object.entries(idx.entries)) {
    if (!includeExpired && isExpired(entry, now, skewMs)) continue;
    out.push({
      key,
      size: entry.size,
      expires_at: entry.expires_at,
      last_access: entry.last_access,
    });
  }
  return out;
}
```

**doClear (API-05 — bounded to namespace dir; never escape):**
```js
function doClear({ indexPath, objectsDir, tmpDir, lockPath, ns }) {
  withLock(lockPath, () => {
    const idx = readIndex(indexPath, ns);
    // Delete every value file referenced by the index — bounded by entries we own
    for (const entry of Object.values(idx.entries)) {
      try {
        fs.unlinkSync(path.join(objectsDir, entry.file));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    // Reset the index to empty
    const fresh = createEmptyIndex(ns);
    writeIndex(indexPath, fresh, tmpDir);
  });
}
```

**Module exports — re-export error classes per the contract Plan 01 locked:**
```js
module.exports = {
  createCache,
  LockTimeoutError: errors.LockTimeoutError,
  CorruptIndexError: errors.CorruptIndexError,
  StaleIndexError: errors.StaleIndexError,
  CachePermissionError: errors.CachePermissionError,
};
```

**Constraints (cache.js):**
- DO NOT call `withLock` from `get` or `list` (CONC-07: lock-free reads). It would still work in Phase 1 (shim) but Phase 2 must NOT acquire on read paths.
- DO NOT enforce `maxBytes` or `maxEntries` — Phase 2 introduces eviction. Stash the values on `_internal` so Phase 2 can read them.
- DO NOT mutate the input options object.
- DO NOT use `~` expansion or string concatenation for paths. PLAT-01 — every path constructed via `path.join`.
- DO NOT JSON.stringify the value yourself. The caller is responsible (M-3 — the contract is "string or Buffer in").
- DO NOT add a `setWithTtl` method. The TTL goes in the `set` opts bag per API-02. (idea.md mentions `setWithTtl`; requirements.md does not.)
- The `_internal` field is for tests only — document it as not part of the public API in a comment. Plan 03 tests may inspect it for whitebox assertions.
  </action>
  <verify>
    <automated>node -e "const path=require('path'); const os=require('os'); const fs=require('fs'); const {createCache} = require('./src/cache'); const dir=path.join(os.tmpdir(),'whoocache-smoke-'+process.pid); try { const c = createCache('smoke',{cacheDir:dir}); c.set('k','v'); if(c.get('k')!=='v') process.exit(1); if(c.delete('k')!==true) process.exit(2); if(c.delete('k')!==false) process.exit(3); console.log('ok'); } finally { fs.rmSync(dir,{recursive:true,force:true}); }"</automated>
    Smoke test: exercises `createCache` + `set` + `get` + `delete` against an isolated `os.tmpdir()/whoocache-smoke-<pid>` directory. Cleans up via `fs.rmSync` in a `finally` block. Matches the whitebox-sanity-check pattern in this same plan — no leak to `~/.whoocache/`.
    Also re-run prior test files to confirm no regression: `node --test test/errors.test.js test/keys.test.js test/atomic-write.test.js test/ttl.test.js test/index-file.test.js`
  </verify>
  <done>
- `src/lock.js` exports `withLock` as a pass-through shim.
- `src/cache.js` exports `createCache` plus the four error classes.
- `createCache('valid-name')` does NOT throw on a fresh machine; creates `cacheDir`, `cacheDir/tmp`, `cacheDir/objects`.
- All five public methods (`get`, `set`, `delete`, `list`, `clear`) work for happy-path strings.
- Validation: `set('', 'v')` throws TypeError; `set('k', 123)` throws TypeError; `set('k', 'v', {ttlMs: -1})` throws RangeError.
- `DEFAULT_SKEW_MS = 0` (revision 1): the lenient `(expires_at + skewMs) <= nowMs` formula collapses to plain `expires_at <= nowMs` at default settings, matching Plan 03's TEST-04 / TEST-12 integration assertions.
- Buffer `set` tags entry with `encoding: 'binary'` (revision 1, was `'base64'`); strings tag `'utf8'`. Bytes on disk are always raw (no base64 encoding).
- Standards (CWE Top 25): CWE-22 (path traversal) addressed via PLAT-01 `path.join`/`path.resolve` + namespace regex `[a-z0-9_-]`; CWE-20 (improper input validation) addressed via `validateKey`, `validateNamespace`, value type check (`string | Buffer`), and `normalizeTtlMs`.
- All Plan 01 + Task 1 unit tests still green.
  </done>
</task>

</tasks>

<verification>
After both tasks complete:

```bash
node --test test/errors.test.js test/keys.test.js test/atomic-write.test.js test/ttl.test.js test/index-file.test.js
```

All micro-tests still green. The smoke test for cache.js passes. Plan 03 will write the 7 phase tests against the now-complete public API.

Whitebox sanity-check (optional, executor's discretion):
```bash
node -e "
const {createCache} = require('./src/cache');
const c = createCache('audit', {cacheDir: require('os').tmpdir() + '/whoocache-audit-' + process.pid});
console.log('internal:', c._internal);
c.set('k','v',{ttlMs: 100});
const idx = require('fs').readFileSync(c._internal.indexPath, 'utf8');
console.log('index:', idx);
require('fs').rmSync(c._internal.cacheDir, {recursive:true, force:true});
"
```
Confirms the index file is well-formed JSON with the expected schema fields.
</verification>

<success_criteria>
- All 6 source files exist: `src/errors.js`, `src/keys.js`, `src/atomic-write.js`, `src/ttl.js`, `src/index-file.js`, `src/lock.js`, `src/cache.js`. (Adding ttl, index-file, lock, cache in this plan.)
- `require('whoocache').createCache('ns', {cacheDir})` returns an instance with all 5 methods + 4 error classes.
- Constructor does NOT throw on first use of a namespace (STOR-06).
- Input validation works: API-07 (TypeError on non-string/Buffer value), API-08 (TypeError on non-string/empty key), TTL-04 (RangeError on negative ttlMs).
- Namespace validation works: STOR-02 lowercases + validates `[a-z0-9_-]`.
- `cache.js` calls `withLock(lockPath, ...)` for every mutating method (set, delete, clear) — Phase 2 seam in place.
- `get` and `list` do NOT call `withLock` (CONC-07 lock-free reads).
- All unit tests from Plan 01 + Task 1 still green.
</success_criteria>

<output>
After completion, create `.planning/phases/01-core-library/02-composition-summary.md` documenting:
- Final list of files + line counts
- Confirmation of the Phase 1/Phase 2 seam (lock.js shim signature)
- The STOR-08 implementation choice (raw bytes + `encoding: 'utf8' | 'binary'` flag, NOT base64-string-on-disk)
- The TTL-07 default-skew choice (`DEFAULT_SKEW_MS = 0` in Phase 1; option exists; calibration deferred to Phase 2)
- Standards coverage note: CWE-22 + CWE-20 mitigations in place (path.join + input validation gates)
- Any deviations from this plan
</output>
