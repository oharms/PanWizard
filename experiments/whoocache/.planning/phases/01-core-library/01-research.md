# Phase 1: Core Library — Research

**Researched:** 2026-05-02
**Domain:** Synchronous, single-process file-based cache primitives (Node.js builtins, zero deps)
**Confidence:** HIGH (Phase 1 only touches well-defined Node.js fs/crypto/path APIs whose semantics are deterministic; concurrency and Windows-specific behavior is deferred to Phase 2 by scope)

---

## Summary

Phase 1 builds the single-process correctness foundation that every later phase rests on. It delivers six of the eight planned source files (`errors.js`, `keys.js`, `atomic-write.js`, `index-file.js` partial, `ttl.js`, `cache.js`) plus the seven Phase 1 tests. The hard parts (concurrency, eviction, crash-repair, Windows fixes) are explicitly deferred to Phase 2 by the requirement IDs assigned. What Phase 1 must get right: the atomic-write primitive, the index schema (so Phase 2's repair logic can read what Phase 1 wrote), TTL semantics, and the public API contract — including the input-validation error types.

Project-level research already establishes the standard stack, on-disk layout, full API surface, and pitfall catalog. This Phase 1 research consumes those documents as ground truth and answers the four planning-relevant questions specific to Phase 1: (1) which subset of modules ships in Phase 1; (2) what stub/seam each module must expose so Phase 2 can extend without rewriting; (3) which 7 tests cover all 7 Phase 1 TEST-XX requirements; and (4) which Wave 0 gaps (test infra, package.json) must close before implementation can begin.

**Primary recommendation:** Build in three waves inside Phase 1 — Wave 0 (project scaffolding: `package.json`, test runner config, test helpers), Wave 1 (foundations: `errors.js`, `keys.js`, `atomic-write.js`), Wave 2 (composition: `index-file.js` minimal read/write, `ttl.js` pure functions, `cache.js` orchestrator wired to a no-op locking shim, plus all 7 tests).

---

## References to Project-Level Research (Do Not Re-Derive)

This Phase 1 research is **delta-only**. The planner should treat the following as authoritative and read them directly rather than expecting this file to repeat their content:

- `.planning/research/architecture.md` — full system structure, all 8 modules, on-disk layout, data flow diagrams for `set`/`get`/`delete`, build wave sequence, public API surface, package.json shape, test fixture architecture
- `.planning/research/stack.md` — exact Node.js builtin signatures, version compatibility matrix, atomic-write pattern, package.json `exports` block, what NOT to use (jest, mocha, proper-lockfile, BLAKE3, `"type":"module"`, etc.)
- `.planning/research/features.md` — table-stakes vs differentiators vs anti-features, decided behavioral coin-flips (hard expiry, ms-since-epoch, lazy `last_access`)
- `.planning/research/pitfalls.md` — full 30-pitfall catalog by dimension; this Phase 1 file maps only the Phase 1-relevant subset (C-4, R-3 prevention, T-1, T-2, T-3, T-4, X-4 path construction, X-6 case-insensitive, M-1, M-3) — Phase 2 will address the rest
- `.planning/research/summary.md` — synthesized executive summary; the "Plan 01" section there matches this phase's scope exactly

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | `cache.get(key)` returns `string \| undefined` (undefined for misses AND expired) | architecture.md §`get(key)` data flow; pitfalls R-4 (defensive ENOENT); summary.md §3 public API |
| API-02 | `cache.set(key, value, {ttlMs?})` stores string with optional TTL | architecture.md §`set` data flow; features.md §table stakes; pitfalls T-2/T-4 normalization |
| API-03 | `cache.delete(key)` returns boolean (true if existed) | architecture.md §`delete` data flow; Phase 1 single-process scope (no lock yet — direct read/write OK) |
| API-04 | `cache.list({includeExpired?})` returns Array<{key, size, expires_at, last_access}> excluding expired by default | architecture.md §index schema; ttl.js purgeLazy filter; features.md §table stakes |
| API-05 | `cache.clear()` wipes namespace without crossing namespace boundaries | architecture.md §directory layout — operations bounded by `path.join(cacheDir, ...)`; never escape namespace dir |
| API-06 | `createCache(namespace, opts?)` factory; `opts.cacheDir`, `opts.maxBytes` (default 50MB), `opts.maxEntries` (default 1000) | architecture.md §public API surface; stack.md §package.json |
| API-07 | Non-string `value` to `set()` → `TypeError` | pitfalls M-3 (silent JSON.stringify data loss); enforce in `cache.js` set() entry point |
| API-08 | Non-string or empty `key` → `TypeError` | architecture.md §`keys.validateKey(key)` — pure function in keys.js |
| API-09 | Consumed via `require('whoocache')` from CommonJS hosts (no `"type":"module"`) | stack.md §project layout — explicit "do not add type:module" |
| API-10 | `engines.node: ">=16.17.0"`; works on Node 16.17+, 18, 20, 22 | stack.md §engines.node — tightest correct minimum for `node:test`/`parseArgs` |
| STOR-01 | Files under `~/.whoocache/<namespace>/` by default; `cacheDir` opt overrides | architecture.md §directory layout; `path.join(os.homedir(), '.whoocache', namespace)` |
| STOR-02 | Namespace lowercased and validated to `[a-z0-9_-]`; invalid throws | pitfalls X-6 (macOS case-insensitive); validate in `cache.js` constructor |
| STOR-03 | Layout: `index.json`, `index.json.lock`, `tmp/`, `objects/<sha256-hex>` (flat) | architecture.md §directory layout — flat objects, dedicated tmp/ |
| STOR-04 | `index.json` schema: `version`, `namespace`, `created_at`, `entries` map; per entry: `file`, `size`, `created_at`, `last_access`, `expires_at`, encoding flag | architecture.md §index file schema (extend with `encoding` field for binary support) |
| STOR-05 | Schema version check: `version > CURRENT` → `StaleIndexError`; `version < CURRENT` → migrate | architecture.md §schema versioning strategy; `index-file.js` exports `CURRENT_VERSION = 1` |
| STOR-06 | `mkdirSync({recursive:true})` runs in constructor before first index access; first-use never throws | pitfalls M-1 — auto-create dir on construct; constructor creates `cacheDir`, `cacheDir/tmp`, `cacheDir/objects` |
| STOR-07 | Keys mapped to filenames via `crypto.createHash('sha256').update(key).digest('hex')` (64 hex chars, no extension) | architecture.md §key-to-filename mapping; **note:** stack.md mentions truncating to 32 chars but STOR-07 spec says 64 — follow STOR-07 (64 chars, full sha256 hex) |
| STOR-08 | Binary (non-UTF-8) values base64-encoded on write; encoding flag in entry; round-trip byte-exact | features.md §table stakes "binary value safety"; entry needs `encoding: 'utf8' \| 'base64'` field |
| STOR-09 | `size` field stores bytes-on-disk (post-encoding) | pitfalls E-3 — `Buffer.byteLength(dataWrittenToFile)` as the canonical metric |
| ATOM-01 | All writes use `openSync + writeSync + fsyncSync + closeSync + renameSync` (never `writeFileSync`) | stack.md §atomic write pattern; pitfalls C-4 |
| ATOM-02 | `.tmp` files under dedicated `tmp/` subdir, named with `crypto.randomBytes(8).toString('hex') + '.tmp'` | architecture.md §tmp file location |
| ATOM-03 | After rename, `fsyncDir(dirname)` called (try/catch — Windows may no-op or throw) | architecture.md §`atomic-write.js` `fsyncDir`; pitfalls C-4 |
| ATOM-06 | `get` catches `ENOENT` on value-file read and returns `undefined` | pitfalls R-4 — defensive read; never throws on missing value file |
| TTL-01 | TTL is hard expiry: `expires_at` set at write time, never updated on read | features.md §coin-flips; pitfalls T-3 |
| TTL-02 | `expires_at` stored as ms-since-epoch integer (not ISO string) | pitfalls T-3 |
| TTL-03 | Entry expired when `expires_at <= Date.now()` (at-or-after counts as expired) | pitfalls T-2 — boundary semantics |
| TTL-04 | Normalization: `undefined` → `null`; `Infinity` → `null`; `0` → expires immediately; negative → `RangeError` | pitfalls T-4 — explicit normalization rules |
| TTL-05 | Expired entries are misses for `get()` and excluded from `list()` by default | architecture.md §`get` data flow; `list()` filters by `!isExpired(entry, now)` unless `includeExpired:true` |
| TTL-06 | Lazy purge: expired entries removed from index on next `set` (no timer) | architecture.md §`set` data flow step "ttl.purgeLazy"; pitfalls E-5 |
| TTL-07 | Optional `clockSkewToleranceMs` opt (default 5000ms) subtracted from expiry checks | pitfalls T-1 — NTP skew mitigation; passed through to `ttl.isExpired(entry, nowMs, skewMs)` |
| PLAT-01 | All paths via `path.join` and `os.homedir()` — no string concat, no `~` expansion | pitfalls X-4 — path construction discipline |
| PLAT-04 | `fsyncSync` on directory fd wrapped in try/catch (Windows may no-op or throw) | architecture.md §`fsyncDir`; pitfalls C-4 / X-4 |
| ERR-01 | Typed error classes exported: `LockTimeoutError`, `CorruptIndexError`, `StaleIndexError`, `CachePermissionError` | architecture.md §`errors.js`; **all four declared in Phase 1**, even though `LockTimeoutError` is not thrown until Phase 2 (the export contract is locked here so Phase 2 doesn't break callers) |
| ERR-02 | All errors extend `Error` and carry stable `code` property | architecture.md §`errors.js` — code values: `LOCK_TIMEOUT`, `CORRUPT_INDEX`, `STALE_INDEX`, `CACHE_PERMISSION` |
| ERR-03 | `LockTimeoutError` carries lockfile path; `CachePermissionError` carries actionable message including failing path | architecture.md §`errors.js`; constructors accept `(message, path)` |
| TEST-02 | get-miss returns undefined | Test 1 below |
| TEST-03 | set-then-get round-trips a UTF-8 string | Test 2 below |
| TEST-04 | TTL boundary: `now-1ms` is expired, `now+1ms` is not | Test 3 below; pitfalls T-2 |
| TEST-10 | Namespace isolation: `set('k','v',{namespace:'a'})` does not affect namespace `b` | Test 4 below; API-05 — `clear()` and reads bounded to namespace dir |
| TEST-11 | Binary value round-trip is byte-exact | Test 5 below; STOR-08 — base64 path |
| TEST-12 | `ttlMs=0` expires immediately; `ttlMs=Infinity` never expires; `ttlMs=undefined` never expires; `ttlMs<0` throws RangeError | Test 6 below; TTL-04 |
| TEST-13 | `clear()` removes all entries from target namespace and no others | Test 7 below; API-05 |
</phase_requirements>

---

## Phase 1 Scope Boundary

### What Phase 1 BUILDS

| Module | Phase 1 Coverage | Phase 2 Adds |
|--------|------------------|--------------|
| `src/errors.js` | All 4 error classes fully exported (`LockTimeoutError`, `CorruptIndexError`, `StaleIndexError`, `CachePermissionError`) | Nothing new — locked surface |
| `src/keys.js` | `keyToFilename(key)` (full sha256 hex, 64 chars per STOR-07), `validateKey(key)` | Nothing new |
| `src/atomic-write.js` | `writeAtomic(targetPath, data, tmpDir)`, `fsyncDir(dirPath)` with PLAT-04 try/catch | Windows rename retry (PLAT-02 — Phase 2) |
| `src/index-file.js` | `readIndex`, `writeIndex`, `createEmptyIndex`, `CURRENT_VERSION=1`, schema version guard (STOR-05) | `repairIndex` (ATOM-05, Phase 2), migration functions, orphan-file GC (Phase 2) |
| `src/ttl.js` | `isExpired(entry, nowMs, skewMs)` (TTL-03, TTL-07), `purgeLazy(entries, nowMs, skewMs)` (TTL-06) — pure | Nothing new |
| `src/cache.js` | `createCache(namespace, opts)`, all 5 public methods, **NO LOCK acquisition** (Phase 1 single-process) | `withLock(...)` wrapping for all mutating ops; LRU eviction integration; orphan tmp/ cleanup on open |
| `src/lock.js` | **NOT BUILT in Phase 1.** Cache.js calls a no-op shim or directly invokes operations without locking. | Full implementation in Phase 2 |
| `src/eviction.js` | **NOT BUILT in Phase 1.** maxBytes/maxEntries options accepted but not enforced. | Full implementation in Phase 2 |
| `src/cli.js` | **NOT BUILT in Phase 1.** | Full implementation in Phase 3 |

### Critical Phase 1 / Phase 2 Seam

**The single most important design decision for Phase 1 is the locking seam.** Phase 1 ships without `src/lock.js`. Two options:

1. **No-op shim** (`src/lock.js` exists with `withLock(path, fn) { return fn() }`): Phase 1 wires `cache.js` through `withLock` from day one, so Phase 2's swap-in of real locking is purely internal to `lock.js`. **Recommended** — keeps the call site stable.

2. **Direct invocation**: Phase 1 calls operations inline; Phase 2 introduces `lock.js` and refactors all call sites in `cache.js`. **Not recommended** — refactor risk in Phase 2.

**Recommendation: build `src/lock.js` as a no-op shim in Phase 1** so the `cache.js` orchestrator already calls `withLock(lockPath, () => { ... })` for every mutating method. The shim signature must match the eventual real signature exactly. Phase 2 replaces the shim body without touching `cache.js`.

### Required Index Schema Extension (STOR-08)

The schema in architecture.md does not include the `encoding` field needed for STOR-08 (binary value safety). Extend each entry:

```json
{
  "file": "<64-hex>",
  "size": 1234,
  "created_at": 1746172800000,
  "last_access": 1746172900000,
  "expires_at": 1746259200000,
  "encoding": "utf8"
}
```

`encoding` is `"utf8"` for string values written directly, or `"base64"` when the value contains non-UTF-8 bytes (the caller passed a `Buffer` or a string with invalid UTF-8 sequences).

**Detection rule (Phase 1 implementation):** `set(key, value)` accepts `string` only (API-07). For binary support in Phase 1, the API surface must be: `set(key, value: string | Buffer, opts)`. If `Buffer.isBuffer(value)`, encode as base64 string and write that to disk; mark `encoding: 'base64'` in entry. On `get`, if entry has `encoding: 'base64'`, decode and return as `Buffer`; else return `string`.

**Open question:** API-07 says "non-string value throws TypeError" — does `Buffer` count as non-string? Resolution: the API contract should accept `string` OR `Buffer` and throw TypeError on anything else (number, object, undefined, function). This satisfies API-07's intent (catch JSON serialization mistakes) and STOR-08 (binary safety).

---

## Phase 1 Public API — Exact Signatures

```js
// src/cache.js exports
const { createCache } = require('whoocache');

createCache(namespace: string, opts?: {
  cacheDir?: string,                  // default: path.join(os.homedir(), '.whoocache', namespace)
  maxBytes?: number,                  // default 52428800 (Phase 1 stores but doesn't enforce)
  maxEntries?: number,                // default 1000 (Phase 1 stores but doesn't enforce)
  clockSkewToleranceMs?: number,      // default 5000 (TTL-07)
}) => WhooCacheInstance

// Instance methods
cache.get(key: string): string | Buffer | undefined
cache.set(key: string, value: string | Buffer, opts?: { ttlMs?: number }): void
cache.delete(key: string): boolean
cache.list(opts?: { includeExpired?: boolean }): Array<{
  key: string,
  size: number,
  expires_at: number | null,
  last_access: number,
}>
cache.clear(): void
```

### Input validation rules (Phase 1)

| Input | Validation | Error |
|-------|------------|-------|
| `namespace` (in `createCache`) | non-empty string, after `toLowerCase()` matches `^[a-z0-9_-]+$` | `TypeError` (STOR-02) |
| `key` (any method) | non-empty string | `TypeError` (API-08) — message: `"key must be a non-empty string"` |
| `value` (in `set`) | string OR Buffer | `TypeError` (API-07) — message: `"value must be a string or Buffer; call JSON.stringify before passing complex values"` |
| `ttlMs` (in `set` opts) | undefined OR Infinity OR non-negative finite number | `RangeError` (TTL-04) — message: `"ttlMs must be non-negative"` for negatives; silent-accept for undefined/Infinity (normalize to null) |

---

## Atomic Write — Exact Sequence (Phase 1)

This is the load-bearing primitive. Implementation in `src/atomic-write.js`:

```js
function writeAtomic(targetPath, data, tmpDir) {
  // Generate unique tmp filename in dedicated tmp/ subdir (ATOM-02)
  const tmpName = crypto.randomBytes(8).toString('hex') + '.tmp';
  const tmpPath = path.join(tmpDir, tmpName);

  // Open + write + fsync + close (ATOM-01)
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // Atomic swap (POSIX guaranteed; Phase 1 doesn't handle Windows EPERM — that's PLAT-02 Phase 2)
  fs.renameSync(tmpPath, targetPath);

  // Durability: fsync the directory (ATOM-03, PLAT-04)
  fsyncDir(path.dirname(targetPath));
}

function fsyncDir(dirPath) {
  try {
    const dirFd = fs.openSync(dirPath, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (err) {
    // PLAT-04: Windows may not support directory fsync; swallow EBADF/EINVAL/EISDIR/EPERM
    if (['EBADF', 'EINVAL', 'EISDIR', 'EPERM', 'EACCES'].includes(err.code)) return;
    throw err;
  }
}
```

**Why `data` should accept string OR Buffer:** `fs.writeSync(fd, buffer)` is preferred over `fs.writeSync(fd, string)` because the Buffer overload guarantees byte-exact writes (no encoding inference). The `index-file.js` writer should pass `Buffer.from(JSON.stringify(index), 'utf8')`.

---

## Index File Layout (Phase 1)

```
~/.whoocache/<namespace>/
├── index.json              # {version: 1, namespace, created_at, entries: {...}}
├── tmp/                    # created by mkdirSync in constructor
└── objects/                # created by mkdirSync in constructor
    └── <64-hex-sha256>     # value file, no extension
```

**index.json.lock is NOT created in Phase 1** (no locking). The file appears in Phase 2.

### Read path

```js
function readIndex(indexPath) {
  let raw;
  try {
    raw = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return createEmptyIndex(/* namespace */);
    throw err;  // EACCES etc. propagate
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Phase 1: throw CorruptIndexError (Phase 2 adds repairIndex fallback per ATOM-05)
    throw new CorruptIndexError(`index.json is not valid JSON: ${err.message}`, indexPath);
  }
  // STOR-05: schema version check
  if (parsed.version > CURRENT_VERSION) {
    throw new StaleIndexError(
      `index.json version ${parsed.version} is newer than supported ${CURRENT_VERSION}`,
      parsed.version,
      CURRENT_VERSION
    );
  }
  if (parsed.version < CURRENT_VERSION) {
    parsed = migrateIndex(parsed);  // Phase 1: throw "no migrations defined" — only matters if v0 ever existed
  }
  return parsed;
}
```

### Empty index factory

```js
function createEmptyIndex(namespace) {
  return {
    version: CURRENT_VERSION,  // 1
    namespace,
    created_at: Date.now(),
    entries: {},
  };
}
```

---

## Test Plan — Exactly 7 Tests for Phase 1

The phase success criteria say "All 7 Phase 1 tests pass under `node --test`". Mapping the 7 Phase 1 TEST-XX requirements to test cases:

### Test File Structure

```
test/
├── helpers/
│   └── tmp-namespace.js        # createTmpNamespace() / cleanupTmpNamespace() — see architecture.md §test fixtures
└── phase1.test.js              # All 7 Phase 1 tests in one file (or split into:)
    ├── api.test.js             # tests 1-2, 6 (basic API + TTL semantics)
    ├── ttl-boundary.test.js    # test 3 (the boundary edge case)
    ├── namespace.test.js       # tests 4, 7 (isolation + clear)
    └── binary.test.js          # test 5 (binary round-trip)
```

**Recommendation:** Single `test/phase1.test.js` is acceptable for 7 tests. Splitting helps if the planner wants per-wave parallelization.

### The 7 Tests

| # | Test name | Requirement | Pseudocode |
|---|-----------|-------------|------------|
| 1 | `get-miss returns undefined` | TEST-02 | `const c = createCache('t', {cacheDir}); assert.strictEqual(c.get('nope'), undefined)` |
| 2 | `set-then-get round-trips a UTF-8 string` | TEST-03 | `c.set('k', 'hello world'); assert.strictEqual(c.get('k'), 'hello world')` — also verify `c.get('k')` again still returns the value (idempotent reads) |
| 3 | `TTL boundary: now-1ms expired, now+1ms not` | TEST-04 | Two ways: (a) inject `nowMs` into `ttl.isExpired` directly (pure-function test); (b) `c.set('k','v',{ttlMs:1}); await sleep(2); assert.strictEqual(c.get('k'), undefined)`. **Recommended: both** — pure unit test for boundary, integration test for end-to-end. |
| 4 | `namespace isolation` | TEST-10 | `const a = createCache('alpha', {cacheDir: cacheDirA}); const b = createCache('beta', {cacheDir: cacheDirB}); a.set('shared','from-a'); assert.strictEqual(b.get('shared'), undefined)` |
| 5 | `binary value round-trip is byte-exact` | TEST-11 | `const buf = Buffer.from([0xff, 0x00, 0xfe, 0x01, 0x80]); c.set('bin', buf); const out = c.get('bin'); assert.ok(Buffer.isBuffer(out)); assert.deepStrictEqual(out, buf)` |
| 6 | `TTL edge values` | TEST-12 | Four sub-assertions in one test (or split): `set('a','x',{ttlMs:0})` then `get('a')` returns undefined immediately; `set('b','x',{ttlMs:Infinity})` survives a `now()+1day` future check; `set('c','x')` (omitted) same; `assert.throws(() => c.set('d','x',{ttlMs:-1}), RangeError)` |
| 7 | `clear() removes namespace entries only` | TEST-13 | `a.set('k1','v1'); a.set('k2','v2'); b.set('k3','v3'); a.clear(); assert.strictEqual(a.get('k1'), undefined); assert.strictEqual(a.get('k2'), undefined); assert.strictEqual(b.get('k3'), 'v3')` |

### Phase 1 Success Criteria Coverage (sanity check)

| SC | Covered by |
|----|------------|
| SC-1 (createCache on new machine creates dir, returns instance, no throw) | Implicit in every test — `createTmpNamespace()` produces a fresh dir each time |
| SC-2 (TTL within window returns value, after returns undefined) | Test 3 |
| SC-3 (non-string value → TypeError; non-string/empty key → TypeError; ttlMs<0 → RangeError) | Test 6 (RangeError); add input validation assertions to Test 1 or a dedicated Test 1b: `assert.throws(() => c.set('k', 123), TypeError); assert.throws(() => c.set('', 'v'), TypeError); assert.throws(() => c.set(null, 'v'), TypeError)` — **decision needed:** include in Test 1 or split. Recommendation: include in Test 1 to keep total at 7. |
| SC-4 (after simulated crash, next createCache opens cleanly) | **Phase 1 cannot fully simulate kill -9 mid-write** because `lock.js` doesn't exist yet. Phase 1's coverage: write a test that pre-populates `tmp/<random>.tmp` to simulate a leftover from a prior crash, then `createCache(...)` opens cleanly (does not throw). The `tmp/` cleanup is technically Phase 2 (orphan GC), so for Phase 1 the test verifies "constructor handles a tmp dir with leftover .tmp files without throwing" — even if it doesn't clean them up. **Decision needed:** is this test required for Phase 1, or deferred to Phase 2? Recommendation: include a minimal version (constructor doesn't throw on unexpected files in cacheDir). |
| SC-5 (all 7 tests pass on Linux Node 22) | All 7 tests above |

**Net test count: 7** (matches phase success criterion 5). Tests 1, 6, 7 each verify multiple sub-assertions; this is conventional for `node:test`.

### Test Helper Requirements (Wave 0 gap)

`test/helpers/tmp-namespace.js` must exist before any test runs. From architecture.md §test fixture architecture — verbatim:

```js
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

---

## Don't Hand-Roll (Phase 1 Specific)

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Argv parsing in tests | Manual `process.argv` loop | `node:test` runner only — Phase 1 has no CLI | CLI is Phase 3 |
| Async test orchestration | `setTimeout` + Promise wrappers in TTL tests | Inject `nowMs` parameter into `ttl.isExpired` for pure tests; use `node:timers/promises setTimeout` (sync via `await`) for the integration TTL test | Pure-function tests are deterministic; one short-sleep integration test is acceptable |
| Atomic file writing | Roll your own buffer/fsync logic | `src/atomic-write.js` exposes `writeAtomic` — Phase 1 builds it once, all writers (index, value files) use it | Single primitive, single point to verify |
| Hash function | md5 / hand-rolled fnv / etc. | `crypto.createHash('sha256').update(key).digest('hex')` (full 64 chars per STOR-07) | STOR-07 mandates sha256; full hex output |
| Error class boilerplate | Manual Error subclass with `Object.setPrototypeOf` | `class LockTimeoutError extends Error { constructor(msg, lockfilePath) { super(msg); this.code = 'LOCK_TIMEOUT'; this.lockfilePath = lockfilePath; } }` — modern V8 supports `extends Error` natively | Node 16.17+ supports class-extends-Error fully |
| Path sanitization | Manual `..` filtering | `path.join(cacheDir, ...)` — for `clear()` and value-file deletion, never accept user paths; only operate on filenames known from the index | All filesystem ops in Phase 1 derive paths from index entries (sha256 hashes — not user input) |

---

## Phase 1 Pitfall Subset (from pitfalls.md)

These are the pitfalls that Phase 1 MUST address. The remainder are deferred to Phase 2/3 by scope.

| ID | Pitfall | Phase 1 Action |
|----|---------|----------------|
| C-4 | `writeFileSync` doesn't fsync | Use the explicit fd sequence in `atomic-write.js`; never call `fs.writeFileSync` for index or value writes. **Verification:** all writes route through `writeAtomic`. |
| R-3 (write side) | Truncated/corrupt index after crash | Phase 1 ensures the WRITE side is correct (atomic via `.tmp` + fsync + rename). The READ-side recovery (`repairIndex`) is Phase 2 (ATOM-05). Phase 1's `readIndex` throws `CorruptIndexError` on `JSON.parse` failure — Phase 2 will catch and repair. |
| R-4 | Index references missing value file | `cache.get()` MUST catch ENOENT on value-file read and return undefined (ATOM-06). |
| T-1 | NTP clock skew | Implement `clockSkewToleranceMs` opt (TTL-07); subtract from comparisons in `ttl.isExpired`. |
| T-2 | `expires_at === now()` boundary | Use `<=` (at-or-after = expired). Test 3 verifies. |
| T-3 | ISO string vs ms-epoch | Store as integer (TTL-02). |
| T-4 | TTL=0/Infinity/undefined edge cases | Normalize in `cache.set()` before storing; never serialize Infinity to JSON; throw RangeError on negative. Test 6 verifies. |
| X-4 | Path separator / `os.homedir()` | Use `path.join(os.homedir(), '.whoocache', namespace, ...)` exclusively (PLAT-01). Never string-concat. Never expand `~`. |
| X-6 | macOS case-insensitive FS | Lowercase namespace before path construction (STOR-02 enforces). |
| M-1 | Cache dir doesn't exist on first call | `mkdirSync({recursive:true})` for `cacheDir`, `cacheDir/tmp`, `cacheDir/objects` in constructor (STOR-06). |
| M-3 | `JSON.stringify` of non-string values | `cache.set` throws TypeError on non-string-non-Buffer values (API-07). Test 6/Test 1b verifies. |

### Pitfalls explicitly DEFERRED to Phase 2 (do not address in Phase 1)

C-1 (TOCTOU on lock), C-2 (stale lockfile), C-3 (livelock backoff), C-5 (eviction race), R-1 (orphaned tmp), R-2 (orphaned value files), X-1 (Windows rename retry), X-2 (Windows O_EXCL), X-3 (Windows delete lock), X-5 (AV interference), E-1 through E-5 (eviction races), M-2 (ENOSPC mid-write — Phase 1 can ignore; Phase 2 hardens), M-4 (symlink), M-5 (sudo permissions).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, stable on Node 20+) |
| Config file | None — pure CLI runner |
| Quick run command | `node --test test/phase1.test.js` (or `node --test test/*.test.js` if split) |
| Full suite command | `node --test test/*.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TEST-02 | get-miss returns undefined | unit | `node --test test/phase1.test.js` (test 1) | Wave 0 |
| TEST-03 | set-then-get round-trips UTF-8 string | unit | `node --test test/phase1.test.js` (test 2) | Wave 0 |
| TEST-04 | TTL boundary at-or-after | unit | `node --test test/phase1.test.js` (test 3) | Wave 0 |
| TEST-10 | Namespace isolation | unit (single-process; multiple instances) | `node --test test/phase1.test.js` (test 4) | Wave 0 |
| TEST-11 | Binary round-trip byte-exact | unit | `node --test test/phase1.test.js` (test 5) | Wave 0 |
| TEST-12 | TTL=0/Infinity/undefined/negative semantics | unit | `node --test test/phase1.test.js` (test 6) | Wave 0 |
| TEST-13 | clear() removes target namespace only | unit | `node --test test/phase1.test.js` (test 7) | Wave 0 |
| API-01 to API-08 (input validation) | type/value checks | unit | folded into tests 1/6 | Wave 0 |
| API-09, API-10 | CommonJS, engines.node | scaffolding | manual: `require('whoocache')` from a CJS file; `node -e "console.log(process.version)"` against `engines` | Wave 0 |
| STOR-04 to STOR-09 (schema, mkdir, sha256, base64, size field) | schema/format checks | unit | folded into tests 2/5; pure-unit tests for `keys.js` and `index-file.js` recommended (3-4 extra micro-tests) | Wave 0 |
| ATOM-01 to ATOM-03, ATOM-06 | atomic write semantics | unit | folded into test 5 (binary forces non-trivial bytes through atomic-write); pure-unit test for `atomic-write.js` recommended (verify tmp file is gone after rename) | Wave 0 |
| TTL-01 to TTL-07 | hard expiry, ms-integer, boundary, normalization, lazy purge, skew | unit | folded into tests 3/6; pure-unit tests for `ttl.js` recommended | Wave 0 |
| PLAT-01, PLAT-04 | path.join, fsyncDir try/catch | unit | folded into all tests (paths) + a `fsyncDir` smoke test (call on cacheDir, verify no throw on Linux) | Wave 0 |
| ERR-01 to ERR-03 | error classes exported, code property, payload | unit | tiny `errors.test.js`: `assert.ok(new LockTimeoutError('m','/p').code === 'LOCK_TIMEOUT'); assert.ok(new LockTimeoutError('m','/p').lockfilePath === '/p')` | Wave 0 |

**Recommended micro-test files (additional to the 7 Phase 1 tests):** `test/atomic-write.test.js`, `test/keys.test.js`, `test/ttl.test.js`, `test/errors.test.js`. These are unit tests for pure modules and don't count toward TEST-01's "≥12 tests" total (that's Phase 2 success criterion). Adding them improves Phase 1 confidence without changing the TEST-XX requirement count.

### Sampling Rate

- **Per task commit:** `node --test test/<changed-module>.test.js` (fast, ~100ms per file)
- **Per wave merge:** `node --test test/*.test.js` (all Phase 1 tests, ~2s)
- **Phase gate:** Full suite green before `/pan:verify-phase`

### Wave 0 Gaps

Wave 0 is the prerequisite scaffolding before any Phase 1 implementation can start.

- [ ] `package.json` — `name: whoocache`, `version: 0.1.0`, `main: ./src/cache.js`, `engines.node: ">=16.17.0"`, `exports: {".":"./src/cache.js"}`, `dependencies: {}`. **Do NOT** include `"type":"module"`.
- [ ] `test/helpers/tmp-namespace.js` — exact code from architecture.md §test fixture (above).
- [ ] `.gitignore` — `node_modules/`, `*.log`, `.DS_Store`, `whoocache-test/` (in case tests leak)
- [ ] (optional but recommended) `test/atomic-write.test.js`, `test/keys.test.js`, `test/ttl.test.js`, `test/errors.test.js` — micro-tests for pure modules; can be co-built with each module in Wave 1.

---

## Open Questions for the Planner

1. **Buffer in `set()` API.** API-07 says "non-string value throws TypeError" but STOR-08 says "binary values base64-encoded." Resolution proposed: accept `string | Buffer`, throw TypeError on anything else. **Planner: confirm or override.** If the resolution is "string only and the caller does base64 themselves," then the encoding flag is set based on a heuristic (e.g., a leading `data:` prefix or a separate `encoding` opt to `set()`). Recommendation: accept `Buffer` directly — it's the cleanest API.

2. **Crash-recovery test in Phase 1.** Phase 1 success criterion 4 says "after a simulated crash, the next createCache call opens cleanly." With `lock.js` deferred, a true `kill -9` test cannot be authored. Two options:
   - (a) Defer the crash test entirely to Phase 2 (write a placeholder test that asserts `createCache` works with a leftover `tmp/foo.tmp` file — counts as Phase 1's "graceful handling of leftover state").
   - (b) Fold the crash-recovery requirement into TEST-13 or extend tests to 8.
   **Recommendation:** option (a) — a 30-line test that pre-populates `cacheDir/tmp/abc.tmp` then calls `createCache` and asserts no throw. Phase 2's repair logic will extend this test.

3. **Is `src/lock.js` no-op shim or omit entirely?** If shim: `cache.js` always calls `withLock(path, fn)` — Phase 2 internalizes the change. If omit: Phase 2 introduces `lock.js` and refactors `cache.js`. **Recommendation: ship the shim in Phase 1.** Lower Phase 2 risk; harmless in single-process Phase 1.

4. **Does Phase 1 ship `src/eviction.js` as a stub?** The constructor accepts `maxBytes` and `maxEntries` but Phase 1 doesn't enforce them. Two options:
   - (a) Add `eviction.js` with a stub `evictUntilUnderCap` that returns `{kept: entries, evicted: []}` — Phase 2 fills in real logic.
   - (b) Don't import `eviction.js` from `cache.js` in Phase 1; add the import in Phase 2.
   **Recommendation:** option (b) — keeps Phase 1 narrow. The eviction stub adds noise to Phase 1 tests (every test would need to verify "eviction didn't happen"). Phase 2 introduces the import as part of EVIC-01 work.

5. **Encoding detection for STOR-08 / Test 5.** When `set` is called with a `Buffer`, encoding is `'base64'`. When called with a string, encoding is `'utf8'`. Is there a case where a string contains invalid UTF-8 (lone surrogates) and needs base64? **Recommendation: no.** JavaScript strings are UTF-16; serializing as UTF-8 always succeeds (lone surrogates produce replacement chars, but the round-trip is consistent). Reserve base64 for explicit `Buffer` input.

---

## Sources

### Primary (HIGH confidence)
- `.planning/research/architecture.md` (project-level, this repo) — module breakdown, data flow, schema, test fixtures
- `.planning/research/stack.md` (project-level, this repo) — Node.js builtin APIs, version matrix, package.json shape
- `.planning/research/features.md` (project-level, this repo) — table-stakes features, anti-features, behavioral coin-flips
- `.planning/research/pitfalls.md` (project-level, this repo) — full pitfall catalog; Phase 1 subset extracted above
- `.planning/research/summary.md` (project-level, this repo) — executive synthesis
- `.planning/requirements.md` (this repo) — exact requirement IDs and acceptance criteria
- `.planning/roadmap.md` (this repo) — Phase 1 success criteria and scope

### Secondary (MEDIUM confidence)
- Project-level research cites Node.js v16/v20/v25.9 official docs, POSIX `rename(2)`/`open(2)` man pages, and PAN source patterns. This Phase 1 research consumes those findings as ground truth.

### Tertiary (LOW confidence)
- None — Phase 1 scope is fully covered by HIGH-confidence sources.

---

## Infrastructure Dependencies

None. Phase 1 is pure unit tests against the local filesystem (`os.tmpdir()`). No Docker, no external services, no network. The only requirement is a writable `os.tmpdir()` directory — universally available.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked by project-level stack.md; Node.js builtin APIs are deterministic
- Architecture: HIGH — Phase 1 implements 6 of 8 modules from architecture.md verbatim; only adjustment is Phase 2 seam (no-op lock shim) and the `encoding` schema field for STOR-08
- Pitfalls: HIGH — Phase 1 subset is the well-defined "single-process correctness" cluster; Phase 2 inherits the harder pitfalls
- Test plan: HIGH — 7 tests map 1:1 to 7 TEST-XX requirements; success criterion 5 enforces the count
- Open questions: 5 questions raised, all with recommended resolutions; planner should confirm before writing plan.md

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (30 days — Node.js stable APIs, slow-moving domain)
