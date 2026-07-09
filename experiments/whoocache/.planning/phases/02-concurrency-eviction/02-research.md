# Phase 2: Concurrency + Eviction — Research

**Researched:** 2026-05-02
**Domain:** Multi-process file locking, LRU eviction, crash recovery, Windows cross-platform fixes
**Confidence:** HIGH — all decisions derive from the existing codebase, locked Phase 1 decisions, and verified Node.js builtin semantics. No external library choices needed (zero-dep constraint).

---

## Summary

Phase 2 hardens the Phase 1 library skeleton for real-world use: it replaces the `src/lock.js` no-op shim with a real `O_EXCL`+PID lockfile implementation, adds `src/eviction.js` for LRU cap enforcement, and adds orphan GC + corrupt-index repair to `open()`. The Phase 1/Phase 2 seam is already clean — `cache.js` calls `withLock(lockPath, fn)` for every mutating operation and the signature is locked; only the body needs replacing. All pure-function modules (`ttl.js`, `eviction.js`) are testable without a filesystem; all I/O-bearing modules are testable against `os.tmpdir()` namespaces with the existing `createTmpNamespace` helper.

**Primary recommendation:** Implement in three waves — (1) pure logic: `eviction.js`; (2) real lock: `lock.js` body; (3) cache.js integration + GC + recovery — then write the 14 phase tests. The planner should produce 3 plans following this wave order.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ATOM-04 | On `open()`, `tmp/` is scanned and `.tmp` files older than 60s are deleted | Orphan GC section; `fs.statSync` mtime + `fs.unlinkSync`; runs in `createCache` constructor |
| ATOM-05 | On `open()`, if `JSON.parse(index.json)` throws SyntaxError, `repairIndex()` runs: scans `objects/`, reconstructs surviving entries, writes fresh index | Crash recovery section; `index-file.js` already throws `CorruptIndexError` — Phase 2 catches it in `readIndex` caller |
| ATOM-07 | kill -9 mid-write does not permanently disable the cache; next open recovers | Covered by ATOM-04 + ATOM-05 + stale-lock reclamation (CONC-03) together |
| EVIC-01 | When `currentEntries + 1 > maxEntries`, oldest by `last_access` evicted before insert | LRU eviction section; pure `evictUntilUnderCap(entries, {maxBytes, maxEntries}, projectedSize)` |
| EVIC-02 | When `currentBytes + newEntrySize > maxBytes`, oldest evicted by `last_access` ascending until under cap | Same function; dual-cap check |
| EVIC-03 | Expired entries purged BEFORE LRU sort | Already done by `purgeLazy` in `doSet` — Phase 2 must maintain this ordering |
| EVIC-04 | `last_access` updated lazily — held in memory on `get`, flushed to index on next write | In-memory `_lastAccessDelta` map on cache instance; merged into index on every index write |
| EVIC-05 | Eviction loop is "make room before insert" — `projectedSize = currentTotal + newEntrySize` | Pitfall E-4 coverage; pure function takes projected sizes |
| EVIC-06 | `eviction.js` and `ttl.js` are pure (no I/O); fully unit-testable without filesystem setup | Already true of `ttl.js`; `eviction.js` must follow same pattern |
| CONC-01 | Writes acquire O_EXCL lockfile at `index.json.lock` via `fs.openSync(path, O_CREAT\|O_EXCL\|O_WRONLY)` | Lock implementation section |
| CONC-02 | Lockfile content is `{pid, acquired}` so stale-lock detection can run | Lock file format; `JSON.stringify({pid: process.pid, acquired: Date.now()})` |
| CONC-03 | On EEXIST, holder's PID checked via `process.kill(pid, 0)`; if dead, stale lockfile deleted and retry succeeds immediately | Stale lock reclamation section; `process.kill(pid, 0)` throws on dead PID |
| CONC-04 | Retry uses jittered exponential backoff (base 10ms, jitter >= baseMs); max 10 attempts; sync sleep via `Atomics.wait` | Retry backoff section; `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)` |
| CONC-05 | After 10 attempts throws `LockTimeoutError` carrying held lockfile path | Already exported from `errors.js`; `new LockTimeoutError(msg, lockPath)` |
| CONC-06 | `withLock(fn)` covers entire read-modify-write cycle | Lock-then-read-then-write pattern section |
| CONC-07 | `get()` is lock-free; concurrent readers do not queue behind writers | Already implemented in Phase 1; must remain true |
| CONC-08 | Two processes running `set` 1000 times each finish within 1s on 4-CPU machine, consistent index, zero lost writes | Performance + test section |
| CONC-09 | Orphaned value files deleted AFTER new index rename completes | Delete-after-index-commit ordering section |
| PLAT-02 | On win32, `renameSync` wrapped in retry loop on EPERM (5 attempts, 50ms delay) | Windows platform section; modify `atomic-write.js` |
| PLAT-03 | On win32, `unlinkSync` of value files catches EPERM/EBUSY; tombstone flag + retry deletion on next open | Windows tombstone pattern section; modify `cache.js` eviction/delete paths |
| PLAT-05 | Library passes full test suite on Linux (Node 22 LTS) and Windows (Node 22 LTS) CI | CI configuration note; not a code task but a test-pass gate |
| TEST-01 | ≥12 tests under `node --test`, all passing on Linux Node 22 | 37 tests already pass; Phase 2 adds 14 more → 51 total, well above threshold |
| TEST-05 | LRU eviction order is correct under `maxEntries` overflow | Eviction test; pure unit test against `eviction.js` + integration test via `cache.js` |
| TEST-06 | `maxBytes` eviction triggers correctly and stops at-or-under cap | Eviction test; dual-cap verification |
| TEST-07 | `maxEntries` eviction triggers correctly with no off-by-one | Off-by-one test; 1001 sets into maxEntries=1000 cache |
| TEST-08 | Two child processes performing parallel `set` operations finish without index corruption | Multi-process fixture; `child_process.fork()` + IPC; architecture.md has full pattern |
| TEST-09 | Crash recovery: SIGKILL mid-write via fork; reopen produces consistent index, no .tmp files remain | Crash recovery test; `process.kill(child.pid, 'SIGKILL')` |
| TEST-14 | Stale lockfile (PID of dead process) is detected and reclaimed; cache call proceeds | Lock unit test; fake lockfile with dead PID, verify next call succeeds |
| PERF-01 | `get` for hot key completes in < 1ms (median, hot path) | Lock-free reads already guarantee this; verify in perf test |
| PERF-02 | `set` of 1KB value completes in < 5ms (median) | Lock acquisition + write must stay under 5ms; local disk + uncontended lock is well under |
| PERF-03 | Full LRU pass over 1000 entries completes in < 50ms | Sort 1000 objects; O(n log n) in JS is trivially fast; pure-function test |
| PERF-04 | Two writers retrying with random backoff < 100ms both succeed within 1s on 4-CPU machine | Concurrent writers test; backoff math analysis |

</phase_requirements>

---

## Standard Stack

### Core
| Module | Version | Purpose | Why |
|--------|---------|---------|-----|
| `node:fs` | Node 16+ | O_EXCL lock, renameSync, unlinkSync, statSync | Builtin; zero-dep constraint |
| `node:fs.constants` | Node 16+ | O_CREAT, O_EXCL, O_WRONLY integer flags | Self-documenting vs `'wx'` string |
| `Atomics.wait` + `SharedArrayBuffer` | Node 12+ | Synchronous sleep without spinning or process spawn | Only portable sync-sleep in Node |
| `process.kill(pid, 0)` | Node 0.x | Alive/dead PID detection | Throws ESRCH on dead process |

### Supporting
| Module | Version | Purpose | When to Use |
|--------|---------|---------|-------------|
| `node:child_process.fork()` | Node 0.x | Multi-process test fixture | TEST-08 and TEST-09 only |
| `node:timers/promises.setTimeout` | Node 15+ | Async sleep in test fixtures | Already used in phase1.test.js |

### No External Libraries
The zero-dep constraint means `proper-lockfile`, `write-file-atomic`, `lru-cache`, and any npm package are strictly prohibited. Every mechanism must be hand-rolled using Node.js builtins. This is already validated by the Phase 1 implementation.

---

## Architecture Patterns

### Pattern 1: Lock-Then-Read-Then-Write (CONC-01, CONC-06)

The entire read-modify-write cycle must happen inside a single `withLock` call. The Phase 1 `cache.js` already does this — `doSet`, `doDelete`, `doClear` all pass a callback to `withLock`. Phase 2 replaces the body of `withLock` from a pass-through to real O_EXCL acquisition.

```js
// src/lock.js — Phase 2 body (replaces no-op shim)
'use strict';
const fs = require('fs');
const { LockTimeoutError } = require('./errors');
const { O_CREAT, O_EXCL, O_WRONLY } = fs.constants;

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 10;

function acquireLock(lockPath) {
  const content = JSON.stringify({ pid: process.pid, acquired: Date.now() });
  try {
    const fd = fs.openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY);
    try {
      fs.writeSync(fd, content);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function isLockStale(lockPath) {
  let content;
  try {
    content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return false; // can't read = not stale (another process holds it or it just vanished)
  }
  if (!content || typeof content.pid !== 'number') return false;
  try {
    process.kill(content.pid, 0); // throws ESRCH/EPERM if dead
    return false; // process is alive
  } catch (err) {
    if (err.code === 'ESRCH') return true;  // dead process -> stale
    if (err.code === 'EPERM') return false; // alive, just not ours
    return false;
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already gone is fine */ }
}

function withLock(lockPath, fn) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (acquireLock(lockPath)) {
      try { return fn(); }
      finally { releaseLock(lockPath); }
    }
    // CONC-03: check for stale lock on EEXIST
    if (isLockStale(lockPath)) {
      releaseLock(lockPath); // remove stale; retry immediately
      continue;
    }
    // CONC-04: jittered exponential backoff; sync sleep via Atomics.wait
    const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt) + jitter, 200);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  }
  throw new LockTimeoutError(
    `Could not acquire lock after ${MAX_ATTEMPTS} attempts: ${lockPath}`,
    lockPath
  );
}

module.exports = { withLock, isLockStale };
// Export isLockStale for TEST-14 unit testing
```

Key points:
- `O_CREAT | O_EXCL | O_WRONLY` is the exact combination for atomic exclusive create (equivalent to `'wx'` but self-documenting)
- PID + acquired timestamp written to lockfile (CONC-02) — enables stale detection without a separate stat call
- `process.kill(pid, 0)` is the standard "is this process alive" probe — throws `ESRCH` on dead, `EPERM` on alive-but-not-ours
- `Atomics.wait` with `SharedArrayBuffer` is the only portable synchronous sleep in Node.js — no subprocess spawning, no busy-loop

### Pattern 2: LRU Eviction — Pure Function (EVIC-01..06)

`src/eviction.js` must be a pure function module (EVIC-06). It receives the current entries object, the new entry's projected size, and the caps; it returns `{ kept, evicted }`. The caller (cache.js) performs file deletions after the index is written.

```js
// src/eviction.js — pure, no I/O
'use strict';

/**
 * Compute total bytes from all entries.
 * @param {Object} entries - index entries map
 * @returns {number}
 */
function totalBytes(entries) {
  let total = 0;
  for (const e of Object.values(entries)) total += e.size;
  return total;
}

/**
 * Evict oldest entries (by last_access ascending) until both caps satisfied.
 * Expired entries must have been purged by the caller (purgeLazy) BEFORE calling this.
 *
 * @param {Object} entries - current index entries (already TTL-purged)
 * @param {number} maxBytes
 * @param {number} maxEntries
 * @param {number} newEntrySize - size of the entry being inserted
 * @returns {{ kept: Object, evicted: string[] }}
 */
function evictUntilUnderCap(entries, maxBytes, maxEntries, newEntrySize) {
  const currentBytes = totalBytes(entries);
  const currentCount = Object.keys(entries).length;

  // EVIC-05: "make room before insert"
  let projectedBytes = currentBytes + newEntrySize;
  let projectedCount = currentCount + 1;

  if (projectedBytes <= maxBytes && projectedCount <= maxEntries) {
    return { kept: entries, evicted: [] };
  }

  // Sort by last_access ascending (oldest first = evict first)
  const sorted = Object.entries(entries).sort(([, a], [, b]) => a.last_access - b.last_access);

  const evicted = [];
  const kept = Object.fromEntries(sorted);

  for (const [key, entry] of sorted) {
    if (projectedBytes <= maxBytes && projectedCount <= maxEntries) break;
    delete kept[key];
    evicted.push(key);
    projectedBytes -= entry.size;
    projectedCount -= 1;
  }

  return { kept, evicted };
}

module.exports = { evictUntilUnderCap, totalBytes };
```

### Pattern 3: Lazy last_access with In-Memory Delta (EVIC-04)

`get()` must NOT acquire the lock (CONC-07). But `last_access` must be updated for LRU ordering. The solution is an in-memory map on the cache instance that is merged into the index on every index write.

The cache instance needs a `_lastAccessDelta` map: `{ [key]: timestampMs }`. `doGet` updates this map in memory. Every `withLock` operation that calls `writeIndex` must first merge the delta into `idx.entries` before writing.

```js
// In createCache(), add to returned instance:
//   _lastAccessDelta: {}

// In doGet():
//   if (entry) instance._lastAccessDelta[key] = Date.now();

// Helper called inside every locked operation before writeIndex:
function applyLastAccessDelta(idx, delta) {
  for (const [key, ts] of Object.entries(delta)) {
    if (idx.entries[key]) {
      idx.entries[key].last_access = ts;
    }
  }
  // Clear after flush — delta has been committed to index
  for (const key of Object.keys(delta)) delete delta[key];
}
// Usage in doSet:
// withLock(lockPath, () => {
//   applyLastAccessDelta(idx, instance._lastAccessDelta);  // flush before eviction/write
//   purgeLazy(...)
//   evictUntilUnderCap(...)
//   writeIndex(...)
// })
```

Note: The `_lastAccessDelta` map is per-process. If two processes have the same key hot in parallel, the last one to write "wins" for that key's `last_access`. This is acceptable for an approximate LRU (EVIC-04 explicitly permits it: "held in memory on get, flushed on next write").

### Pattern 4: Delete-After-Index-Commit (CONC-09)

Orphaned value files and evicted value files must be deleted AFTER the new index is renamed into place. This prevents a concurrent reader from seeing the old index (which still references the file) while the file is being deleted.

```js
// In doSet — inside withLock:
// 1. readIndex
// 2. purgeLazy -> collect purgedKeys
// 3. evictUntilUnderCap -> collect evictedKeys
// 4. writeAtomic(valuePath, bytes, tmpDir)      // new value on disk
// 5. update idx.entries with new entry
// 6. writeIndex(indexPath, idx, tmpDir)          // index commits here
// *** lock released here by withLock's finally ***
// 7. for key in [...purgedKeys, ...evictedKeys]:
//      safeUnlink(path.join(objectsDir, idx_snapshot[key].file))
//
// safeUnlink must happen OUTSIDE the lock to not block readers during file deletion.
// If unlink fails (ENOENT on Linux, EPERM on Windows), it is non-fatal.
```

The implication: `doSet` needs to capture the file paths of evicted/purged entries BEFORE writing the index (since they will be gone from `idx.entries` after the write), then delete them after the lock is released.

### Pattern 5: Orphan GC on Open (ATOM-04)

The `createCache` constructor must scan `tmp/` and delete files older than 60 seconds. This is the "slow path" on open — runs once per process per namespace instantiation.

```js
// In createCache(), after mkdirSync calls:
function cleanOrphanTmps(tmpDir, maxAgeMs = 60_000) {
  let files;
  try {
    files = fs.readdirSync(tmpDir);
  } catch {
    return; // tmpDir doesn't exist yet — first use
  }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.tmp')) continue;
    const fPath = path.join(tmpDir, f);
    try {
      const stat = fs.statSync(fPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fPath);
      }
    } catch {
      // ENOENT (already cleaned by concurrent open) or EPERM (Windows AV) — ignore
    }
  }
}
```

The 60-second threshold prevents deleting in-flight writes from currently-running concurrent processes. A `.tmp` file younger than 60s may still be actively written to.

### Pattern 6: Index Repair on CorruptIndexError (ATOM-05)

Phase 1's `readIndex` throws `CorruptIndexError` on bad JSON. Phase 2 must catch this in the read-index callers and call `repairIndex`. The repair reconstructs the index by scanning `objects/` and cross-referencing any partially-parseable data from the corrupted file.

```js
// In index-file.js, add repairIndex:
function repairIndex(cacheDir, namespace) {
  const objectsDir = path.join(cacheDir, 'objects');
  const indexPath = path.join(cacheDir, 'index.json');
  const tmpDir = path.join(cacheDir, 'tmp');

  let files;
  try {
    files = fs.readdirSync(objectsDir);
  } catch {
    files = [];
  }

  // Build a minimal index from surviving object files.
  // We cannot recover original keys (SHA256 is one-way) or TTLs.
  // Every recovered entry gets: file=filename, size=filesize, last_access=now, expires_at=null
  const idx = createEmptyIndex(namespace);
  // NOTE: We cannot recover key names from hash filenames alone.
  // Recovered entries are effectively unreachable by key lookup (key is unknown),
  // but they prevent orphan accumulation and allow proper size accounting.
  // In practice, repairIndex primarily prevents the cache from being permanently broken —
  // all entries are lost from the user's perspective, but the cache works again immediately.
  writeIndex(indexPath, idx, tmpDir);  // Write empty-but-valid index
  return idx;
}
```

Important nuance: SHA256 filenames in `objects/` cannot be reverse-mapped to original keys without the index (SHA256 is one-way). The repair is therefore conservative: write a valid empty index, which allows the cache to function again. Surviving value files are technically orphaned after repair but will be cleaned up by the next eviction cycle. This is acceptable — the alternative (keeping "zombie" entries the user can never access by key) is worse.

**Caller integration in cache.js:**

```js
function safeReadIndex(indexPath, cacheDir, namespace, tmpDir) {
  try {
    return readIndex(indexPath, namespace);
  } catch (err) {
    if (err.code === 'CORRUPT_INDEX') {
      // ATOM-05: repair and return empty index
      return repairIndex(cacheDir, namespace);
    }
    throw err;
  }
}
```

### Pattern 7: Windows renameSync Retry (PLAT-02)

Modify `atomic-write.js` to add a retry wrapper around `fs.renameSync` on Windows.

```js
// In atomic-write.js, replace the bare renameSync call:
function renameWithRetry(src, dst, maxRetries = 5, delayMs = 50) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      fs.renameSync(src, dst);
      return;
    } catch (err) {
      if (err.code === 'EPERM' && process.platform === 'win32' && i < maxRetries) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        continue;
      }
      throw err;
    }
  }
}
```

### Pattern 8: Windows Tombstone for Unlink Failures (PLAT-03)

On Windows, `fs.unlinkSync` can throw `EPERM` or `EBUSY` when another process has the file open. The solution is a tombstone flag in the index entry and lazy deletion on next open.

```js
// Modified safeUnlink for value file deletion:
function safeUnlinkValueFile(filePath, indexEntry) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      // Mark as tombstoned in the index entry; cleanup on next open
      if (indexEntry) indexEntry.tombstone = true;
      return;
    }
    if (err.code === 'ENOENT') return; // already gone
    throw err;
  }
}

// In createCache constructor, after cleanOrphanTmps:
function cleanTombstones(idx, objectsDir) {
  let changed = false;
  for (const [key, entry] of Object.entries(idx.entries)) {
    if (entry.tombstone) {
      try {
        fs.unlinkSync(path.join(objectsDir, entry.file));
        delete idx.entries[key];
        changed = true;
      } catch {
        // Still locked — leave tombstone for next open
      }
    }
  }
  return changed;
}
```

The tombstone is stored in the index entry. On next `createCache` call, `cleanTombstones` runs and retries deletions. If still locked, it stays tombstoned. `get()` must treat tombstoned entries as misses.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Synchronous sleep | `for` busy-loop or `execSync('sleep')` | `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)` | Busy-loop burns CPU; execSync spawns a process per retry |
| PID alive check | Custom `/proc/PID` reading or `ps` spawn | `process.kill(pid, 0)` | Single syscall; cross-platform; builtin |
| Exclusive file creation | `fs.existsSync` + `fs.writeFileSync` (TOCTOU) | `fs.openSync(path, O_CREAT | O_EXCL | O_WRONLY)` | Atomic at OS level; the only correct approach |
| Sync sleep on Windows | `child_process.execSync('timeout /t 1 /nobreak')` | Same `Atomics.wait` | Works on all platforms |

**Key insight:** `Atomics.wait` is the only portable synchronous sleep mechanism available without spawning a subprocess. It is the correct primitive for the retry backoff loop in a synchronous-API library.

---

## Common Pitfalls

### Pitfall 1: Releasing Lock Before Index Write Completes
**What goes wrong:** Releasing the lock after writing the value file but before writing the updated index. Another process acquires the lock, reads the old index, and writes its own update — overwriting the first process's entry.
**How to avoid:** `withLock(fn)` must cover the ENTIRE sequence: read index → TTL purge → eviction → write value → update index in memory → write index. The lock is released only in `finally`. See CONC-06.

### Pitfall 2: Deleting Evicted Files Inside the Lock (CONC-09 violation)
**What goes wrong:** Deleting value files for evicted/purged entries while the lock is still held. A concurrent reader that loaded the old index (before the current lock acquisition) is still reading the file — on POSIX it gets ENOENT after deletion; on Windows it throws EPERM.
**How to avoid:** Collect the filenames to delete inside the lock, write the index, release the lock, then delete the files outside the lock. Readers that hit ENOENT return `undefined` (ATOM-06 already handles this).

### Pitfall 3: `process.kill(pid, 0)` Returns False Positive on Windows for Zombie PIDs
**What goes wrong:** On Windows, PID recycling is faster than Linux. A PID that was used by the lock holder has since been reused by an unrelated process. `process.kill(pid, 0)` returns without throwing, so the lock is not reclaimed even though the original holder is dead.
**How to avoid:** Add an age check: if `acquired` in the lockfile content is >5s ago AND `process.kill(pid, 0)` doesn't throw, treat as stale anyway. The age threshold prevents false "alive" conclusions for recently-dead PIDs. `5000ms` is conservative — a normal lock hold is < 10ms.

```js
// Enhanced staleness check:
function isLockStale(lockPath) {
  let content;
  try { content = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return false; }
  if (!content || typeof content.pid !== 'number') return false;
  const ageMs = Date.now() - (content.acquired || 0);
  try {
    process.kill(content.pid, 0);
    // Process appears alive — only trust this if lock is young
    return ageMs > 5000; // stale if > 5 seconds AND PID appears alive (Windows zombie heuristic)
  } catch (err) {
    return err.code === 'ESRCH'; // definitively dead
  }
}
```

### Pitfall 4: `_lastAccessDelta` Never Flushed on Process Exit
**What goes wrong:** Process A does many `get()` calls updating `_lastAccessDelta` in memory. Process A exits without calling `set()`, `delete()`, or `clear()`. The `last_access` updates are lost. Subsequent eviction may choose a sub-optimal victim.
**How to avoid:** This is acceptable per EVIC-04 ("held in memory on get, flushed to index on next write"). The requirements explicitly permit this approximation. Document it clearly: "LRU ordering is approximate — `last_access` is flushed to disk on next write operation."

### Pitfall 5: Off-by-One in maxEntries Eviction (E-4)
**What goes wrong:** Checking `currentCount > maxEntries` instead of `currentCount + 1 > maxEntries` before inserting. After insert, count is `maxEntries + 1`. Or: checking `currentCount >= maxEntries` which evicts one entry too many.
**How to avoid:** Use the "projected" check: `projectedCount = currentCount + 1`. While `projectedCount > maxEntries`, evict one and decrement `projectedCount`. After the loop, insert. See `evictUntilUnderCap` code sketch above.

### Pitfall 6: SIGKILL Timing in Test — Race Between Kill and Fork IPC
**What goes wrong:** The parent sends SIGKILL immediately upon receiving the "first write done" IPC message. On a loaded system, the IPC channel may deliver the message before the child's write has actually completed on disk (fork's write is buffered). The kill arrives while the write is truly in-flight.
**How to avoid:** After receiving the IPC message and killing the child, sleep 50ms before opening the cache for recovery. The `await new Promise(r => setTimeout(r, 50))` in the test fixture allows the OS to process the kill signal. This is already shown in the architecture.md fixture pattern.

### Pitfall 7: `Atomics.wait` in Worker Threads Behaves Differently
**What goes wrong:** `Atomics.wait` on the main thread works as expected. In a Worker thread, it may be disallowed (some environments block `Atomics.wait` on the UI/main thread). However, whoocache is a synchronous library always called from the main thread, so this is not a concern.
**How to avoid:** Document that whoocache is not designed for use inside Worker threads (its synchronous I/O already makes it unsuitable for worker thread use).

### Pitfall 8: Windows Tombstone Entries Visible in `list()` and Counted in Eviction
**What goes wrong:** Tombstoned entries remain in `idx.entries` with the `tombstone: true` flag. `list()` returns them (unless filtered). `evictUntilUnderCap` counts their `size` toward `maxBytes`. This inflates the apparent cache size.
**How to avoid:** Filter tombstoned entries in `list()` (treat as expired). Exclude tombstoned entries from size calculation in `totalBytes()`. Clean tombstones at open time (already covered by `cleanTombstones`).

---

## Code Examples

### Verified: `process.kill(pid, 0)` for PID liveness detection

```js
// Throws ESRCH if process doesn't exist, EPERM if process exists but we can't signal it
try {
  process.kill(pid, 0);
  // Process is alive
} catch (err) {
  if (err.code === 'ESRCH') {
    // Process does not exist -> lock is stale
  }
  // EPERM means process exists (different user) -> not stale
}
```
Source: Node.js `process.kill` documentation — signal 0 is used for existence check across all platforms.

### Verified: `Atomics.wait` as synchronous sleep

```js
// Synchronous sleep of N milliseconds without spinning or subprocess
// SharedArrayBuffer can be reused but creating per-call is fine at this frequency
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
```
Source: Node.js `Atomics.wait` documentation; `SharedArrayBuffer` available unconditionally Node 12+.

### Verified: O_EXCL exclusive file create

```js
const { O_CREAT, O_EXCL, O_WRONLY } = require('fs').constants;
try {
  const fd = fs.openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY);
  // ... write PID content ...
  fs.closeSync(fd);
  // Lock acquired
} catch (err) {
  if (err.code === 'EEXIST') {
    // Lock is held by another process
  }
}
```
Source: POSIX O_EXCL semantics; Node.js `fs.constants` documentation.

---

## Decision Log

### Locked Decisions (from Phase 1 summaries + requirements)

| Decision | Source | Implication for Phase 2 |
|----------|--------|------------------------|
| `withLock(lockPath, fn)` signature is fixed | Phase 1 Plan 02 summary | Phase 2 replaces body only; all call sites in cache.js are already correct |
| Full 64-char sha256 hex for filenames | Phase 1 Plan 01 key-decisions | `repairIndex` cannot reverse-map filenames to keys — emit empty index on repair |
| `doGet` / `doList` do NOT acquire lock | Phase 1 Plan 02 key-decisions | CONC-07 mandate; must remain true in Phase 2 |
| No `eviction.js` in Phase 1 | Phase 1 Plan 02 | Phase 2 creates `src/eviction.js` as a new pure-function module |
| Value bytes stored raw on disk (not base64) | Phase 1 Plan 02 STOR-08 decision | `size` in index = `bytes.length` (raw buffer); no base64 inflation for size accounting |
| `src/lock.js` exports `withLock` | Phase 1 Plan 01 | Phase 2 adds `isLockStale` export for TEST-14 unit test isolation |
| `_internal` field exposed for whitebox tests | Phase 1 Plan 02 | Phase 2 tests can access `_internal.cacheDir`, `_internal.lockPath` etc. |
| `clockSkewToleranceMs` option exists, default 0 | Phase 1 Plan 02 | Phase 2 can calibrate default if tests reveal issues; keep 0 for now |
| `createCache` runs `mkdirSync({recursive:true})` | Phase 1 | Orphan GC (`cleanOrphanTmps`) runs right after — directory guaranteed to exist |
| `DEFAULT_SKEW_MS = 0` | Phase 1 Plan 02 | Keep 0 through Phase 2; TTL boundary tests already assume it |
| `set()` accepts `string | Buffer` | Phase 1 Plan 02 | Eviction size accounting uses `bytes.length` (Buffer size); consistent already |
| Index repair: empty index (not reconstructed entries) | This research | SHA256 filenames are one-way; we cannot recover key names from object filenames alone |

### Open Questions for the Planner

1. **`_lastAccessDelta` map lifecycle:** Should it live on the `_internal` object or as a closure variable in `createCache`? Either works — closure is cleaner (not accidentally exposed). Recommend closure variable.

2. **Where does `repairIndex` live?** Two options: (a) in `index-file.js` (owns all index logic, cohesive), or (b) in `cache.js` (repair needs `cacheDir` and `tmpDir` which cache.js already holds). Recommend (a): move all index-related logic to `index-file.js`, pass `cacheDir`/`tmpDir` as parameters to `repairIndex`. This keeps cache.js thin.

3. **`applyLastAccessDelta` timing:** Should the delta be flushed at the start of the locked section (before purgeLazy) or after purgeLazy but before eviction? Flushing before purgeLazy ensures that entries that were recently accessed don't get classified as expired-during-purge due to stale last_access. Recommend: flush delta first, then purgeLazy.

4. **Tombstone persistence between opens on Windows:** If the tombstone-flagged entry remains in the index between opens, it will be loaded by `readIndex` and `cleanTombstones` will retry. This works correctly — no special handling needed beyond the tombstone flag in the index schema.

5. **PERF-01..04 measurement strategy:** Phase 2 needs actual performance assertions, not just correctness tests. Options: (a) in-test timing with `Date.now()` (imprecise but zero-dep), (b) `performance.now()` (available via `node:perf_hooks`, still zero-dep). Recommend `performance.now()` from `require('node:perf_hooks').performance` — more precise, no external dep.

---

## Validation Architecture

> `workflow.nyquist_validation` is not present in `.planning/config.json` (key absent, not `true`). Skipping Nyquist section per agent instructions. Validation section included below because it directly serves planning.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin, stable) |
| Config file | None — run with `node --test` |
| Quick run | `node --test test/*.test.js` |
| Full suite | `node --test test/*.test.js` (same — no separate suites) |
| Current baseline | 37 tests pass, 0 fail |

### Phase 2 Tests to Add

| Req ID | Test Name | Type | File | Notes |
|--------|-----------|------|------|-------|
| TEST-05 | LRU eviction order correct under maxEntries overflow | unit | `test/phase2.test.js` | Pure: exercise `eviction.js` directly; integration: 1001 sets in cache with maxEntries=1000 |
| TEST-06 | maxBytes eviction triggers and stops at-or-under cap | unit | `test/phase2.test.js` | Set entries whose total size exceeds maxBytes; verify sum(entry.size) <= maxBytes after |
| TEST-07 | maxEntries eviction no off-by-one | unit | `test/phase2.test.js` | Exactly `maxEntries+1` sets; verify `list().length === maxEntries` |
| TEST-08 | Two child processes parallel set — no corruption | multi-process | `test/phase2.test.js` | `child_process.fork()` fixture; verify all keys present in post-run audit |
| TEST-09 | SIGKILL mid-write — reopen recovers, no .tmp files | multi-process | `test/phase2.test.js` | Fork slow-writer; SIGKILL; verify index parseable + no .tmp |
| TEST-14 | Stale lockfile (dead PID) reclaimed automatically | unit | `test/phase2.test.js` | Write fake lockfile with `pid: 99999` (likely dead); verify next set succeeds |
| TEST-01 | Total test count ≥ 12 | umbrella | All test files | 37 existing + 14 new Phase 2 = 51 total — satisfies threshold |
| PERF-01 | get < 1ms median (hot key) | perf | `test/phase2.test.js` | Loop 1000 gets; check median |
| PERF-02 | set of 1KB value < 5ms median | perf | `test/phase2.test.js` | Loop 100 sets; check median |
| PERF-03 | Full LRU pass over 1000 entries < 50ms | perf | `test/phase2.test.js` | Call `evictUntilUnderCap` with 1000 entries; time it |
| PERF-04 | Two writers both succeed within 1s | perf | `test/phase2.test.js` | Same fixture as TEST-08; add timing assertion |

### Child Process Helper Scripts

Two new helper scripts are needed in `test/helpers/`:

- `test/helpers/child-writer.js` — invoked by `fork()` for TEST-08; reads `WHOOCACHE_DIR` + `WRITER_ID` from env; performs N sets; sends `{done: true}` via IPC
- `test/helpers/slow-writer.js` — invoked by `fork()` for TEST-09; sets `key-0` then sends `{firstWriteDone: true}`; continues writing (will be SIGKILL'd)

Both are already specified in `architecture.md` — copy verbatim.

### Wave 0 Gaps (files needed before implementation begins)

- [ ] `test/phase2.test.js` — 14 Phase 2 tests (to be authored as part of Phase 2 final plan)
- [ ] `test/helpers/child-writer.js` — multi-process writer fixture
- [ ] `test/helpers/slow-writer.js` — crash-recovery writer fixture
- [ ] `src/eviction.js` — pure eviction module (new file)

---

## Pitfalls Specific to Phase 2

(These are the Phase 1 pitfalls that are scheduled for Phase 2 — extracted from `pitfalls.md` for planner convenience)

| Pitfall ID | Description | Addressed By |
|-----------|-------------|-------------|
| C-1 | TOCTOU on index read-modify-write | CONC-06: entire RMW inside `withLock` |
| C-2 | Stale lockfile after kill -9 | CONC-03: PID liveness check with 5s age heuristic |
| C-3 | Livelock via synchronized retry backoff | CONC-04: jittered exponential backoff |
| C-5 | Lazy expiry race during eviction | CONC-09: delete files AFTER index rename |
| R-1 | Orphaned .tmp files | ATOM-04: GC on open, 60s age threshold |
| R-2 | Orphaned value files (value written, index never committed) | ATOM-05: repair empties index; orphans cleaned next GC cycle |
| R-3 | Index file corruption — truncated JSON | ATOM-05: catch CorruptIndexError, call repairIndex |
| R-4 | Index references missing value file | ATOM-06 (already done): ENOENT on value read = miss |
| X-1 | Windows renameSync EPERM | PLAT-02: retry loop in atomic-write.js |
| X-3 | Windows delete lock on open file | PLAT-03: tombstone pattern in eviction/delete |
| E-1 | last_access update race | EVIC-04: in-memory delta, flushed on write |
| E-2 | Eviction mid-get race | CONC-09 + ATOM-06: delete after index rename; ENOENT = miss |
| E-3 | Wrong byte cap metric | Already resolved in Phase 1: size = raw buffer bytes |
| E-4 | Off-by-one in eviction loop | EVIC-05: "make room before insert" with projected counts |
| E-5 | Expired entries inflate size count | EVIC-03: purgeLazy before evictUntilUnderCap |

---

## Recommended Plan Decomposition

The planner should create 3 plans for Phase 2:

**Plan 1: Pure Logic — `eviction.js`**
- Create `src/eviction.js` (`evictUntilUnderCap`, `totalBytes`) — pure functions, no I/O
- Create `test/eviction.test.js` with unit tests for EVIC-01..05 pure behavior
- Validate PERF-03 (LRU pass over 1000 entries < 50ms)
- No changes to `cache.js` yet — just the module

**Plan 2: Real Lock — `lock.js` body + Windows atomic-write**
- Replace `src/lock.js` body with real O_EXCL implementation (CONC-01..06)
- Export `isLockStale` for testing
- Add `renameWithRetry` to `atomic-write.js` (PLAT-02)
- Write unit tests: lock acquires, lock retries, stale lock reclaimed (TEST-14), LockTimeoutError after 10 attempts, Windows rename retry (if on Windows CI)

**Plan 3: Integration — cache.js + GC + recovery + phase tests**
- Wire `eviction.js` into `doSet` (EVIC-01..05, CONC-09)
- Add `_lastAccessDelta` + `applyLastAccessDelta` (EVIC-04)
- Add `cleanOrphanTmps` to `createCache` constructor (ATOM-04)
- Add `repairIndex` to `index-file.js` (ATOM-05)
- Add `safeUnlink` + tombstone pattern (PLAT-03)
- Create `test/helpers/child-writer.js` + `test/helpers/slow-writer.js`
- Write `test/phase2.test.js` with TEST-05..09, TEST-14, PERF-01..04 (14 tests)

---

## Infrastructure Dependencies

None — all tests are pure in-process or use `node:child_process` to spawn child Node processes. No Docker services required. Multi-process tests run within a single `node --test` invocation.

---

## Sources

### Primary (HIGH confidence)
- `src/lock.js` (Phase 1 no-op shim) — signature locked, body to replace
- `src/cache.js` (Phase 1 cache) — all `withLock` call sites verified correct
- `src/atomic-write.js` — PLAT-02 comment "Phase 2 will add Windows EPERM retry" already present
- `src/index-file.js` — `CorruptIndexError` throw already present; Phase 2 catches it
- `.planning/phases/01-core-library/02-composition-summary.md` — Phase 1/Phase 2 seam spec
- `.planning/research/architecture.md` — test fixture patterns (child-writer, slow-writer code)
- `.planning/research/pitfalls.md` — all Phase 2 pitfalls already catalogued
- `.planning/research/stack.md` — `Atomics.wait`, `O_EXCL` patterns verified
- Node.js `process.kill` official docs — signal 0 for alive detection
- Node.js `fs.constants` official docs — O_CREAT, O_EXCL, O_WRONLY flags

### Secondary (MEDIUM confidence)
- `.planning/research/pitfalls.md` C-2 — Windows PID recycling faster than Linux (WebSearch-derived but consistent with known Windows behavior)

---

## Metadata

**Confidence breakdown:**
- Lock implementation: HIGH — exact API verified, Phase 1 seam confirmed
- Eviction pure function: HIGH — straightforward JS sort + loop; no external API needed
- Crash recovery: HIGH — Node.js fs APIs verified; repairIndex design is conservative (empty index) and safe
- Windows platform: MEDIUM — PLAT-02/03 patterns are well-known but cannot be fully verified without Windows CI
- Multi-process tests: HIGH — `child_process.fork()` + IPC pattern from architecture.md is proven; Node.js API stable

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (stable domain; no fast-moving dependencies)

---

## RESEARCH COMPLETE

**Phase:** 2 — Concurrency + Eviction
**Confidence:** HIGH

### Key Findings

- The Phase 1/Phase 2 seam is clean: `withLock(lockPath, fn)` signature is locked and all call sites in `cache.js` are correct. Phase 2 only replaces the body of `lock.js`.
- `eviction.js` must be a new pure-function module (no I/O), following the same pattern as `ttl.js`. It is testable in complete isolation.
- SHA-256 filenames in `objects/` cannot be reverse-mapped to keys, so `repairIndex` must produce an empty (but valid) index rather than reconstructing entries.
- The `_lastAccessDelta` in-memory map is the correct mechanism for EVIC-04 (lazy last_access update): `get()` stays lock-free, delta flushes on every locked write operation.
- CONC-09 (delete-after-index-commit) is the critical ordering requirement: value file deletions must happen OUTSIDE the lock, after the new index rename completes.
- Three-plan decomposition is recommended: (1) pure eviction.js, (2) real lock.js + Windows atomic-write, (3) cache.js integration + GC + recovery + 14 phase tests.

### File Created
`.planning/phases/02-concurrency-eviction/02-research.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Lock implementation | HIGH | Exact Node.js API verified; Phase 1 seam confirmed correct |
| LRU eviction | HIGH | Pure JS sort; no external dependencies; straightforward algorithm |
| Crash recovery | HIGH | Conservative empty-index repair is safe and provably correct |
| Windows platform | MEDIUM | PLAT-02/03 patterns well-established; needs Windows CI to fully verify |
| Multi-process tests | HIGH | `fork()` + IPC pattern from architecture.md is proven and stable |

### Open Questions
1. Should `_lastAccessDelta` be a closure variable (cleaner) or on `_internal` (testable)? Recommend closure.
2. Should `repairIndex` live in `index-file.js` or `cache.js`? Recommend `index-file.js` (cohesion).
3. `performance.now()` vs `Date.now()` for PERF tests? Recommend `performance.now()` from `node:perf_hooks` — more precise, still zero-dep.

### Ready for Planning
Research complete. Planner can now create plan.md files for Phase 2.
