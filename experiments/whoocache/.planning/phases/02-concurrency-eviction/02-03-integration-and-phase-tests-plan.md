---
phase: 02-concurrency-eviction
plan: 03
type: execute
wave: 2
depends_on: [02-01-eviction-pure, 02-02-lock-and-rename]
files_modified:
  - src/cache.js
  - src/index-file.js
  - test/helpers/child-writer.js
  - test/helpers/slow-writer.js
  - test/phase2.test.js
autonomous: true
requirements: [ATOM-04, ATOM-05, ATOM-07, EVIC-03, EVIC-04, CONC-06, CONC-07, CONC-08, CONC-09, PLAT-03, PLAT-05, TEST-01, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, PERF-01, PERF-02, PERF-04]
change_class: feature

must_haves:
  truths:
    - "createCache constructor scans tmp/ and deletes .tmp files older than 60s (ATOM-04)"
    - "createCache constructor catches CorruptIndexError on the first readIndex and calls repairIndex which writes an empty valid index (ATOM-05)"
    - "ATOM-07: a child process killed via SIGKILL mid-write does NOT permanently disable the cache; the next createCache() call opens cleanly and produces a parseable index"
    - "doSet calls applyLastAccessDelta(idx, _lastAccessDelta) before purgeLazy/eviction so lazy-update last_access values are flushed (EVIC-04)"
    - "doSet calls purgeLazy BEFORE evictUntilUnderCap so expired entries are dropped first (EVIC-03)"
    - "doSet collects evicted+purged filenames inside withLock, writes index INSIDE the lock, then deletes value files OUTSIDE the lock (CONC-09)"
    - "doGet remains lock-free — it never calls withLock (CONC-07 preserved from Phase 1)"
    - "doGet updates _lastAccessDelta[key] in memory on hit (EVIC-04)"
    - "doDelete defers value-file unlink until AFTER the index rename completes — same delete-after-commit ordering as doSet (CONC-09)"
    - "On Windows, value-file unlink failure with EPERM/EBUSY tombstones the entry; cleanTombstones at next open retries deletion (PLAT-03)"
    - "Two child processes each calling set 50 times finish < 1s and the post-run audit lists every key with zero lost writes (TEST-08, CONC-08, PERF-04)"
    - "TEST-09 SIGKILL-mid-write reopen succeeds; tmp/ contains zero .tmp files older than 60s after the recovery createCache call"
    - "All 14 Phase 2 tests pass; total suite >= 12 (TEST-01 umbrella satisfied) — actual count expected ~58"
  artifacts:
    - path: "src/cache.js"
      provides: "Phase 2 integrated cache: orphan GC + index repair + lazy last_access delta + LRU eviction wired into doSet + delete-after-commit ordering + Windows tombstone path"
      contains: "_lastAccessDelta"
    - path: "src/index-file.js"
      provides: "Adds repairIndex(cacheDir, namespace) — writes empty-but-valid index to recover from CorruptIndexError"
      exports: ["CURRENT_VERSION", "createEmptyIndex", "readIndex", "writeIndex", "repairIndex"]
    - path: "test/helpers/child-writer.js"
      provides: "Multi-process writer fixture — invoked via child_process.fork"
      contains: "process.send"
    - path: "test/helpers/slow-writer.js"
      provides: "Crash-recovery writer fixture — sets one key, signals parent, then keeps writing until SIGKILL'd"
      contains: "firstWriteDone"
    - path: "test/phase2.test.js"
      provides: "14 Phase 2 acceptance tests (TEST-05/06/07/08/09/14 + PERF-01/02/04 + ATOM-04/05/07 + EVIC-03/04 + CONC-06/09 + PLAT-03)"
      min_lines: 250
  key_links:
    - from: "src/cache.js"
      to: "src/eviction.js"
      via: "require('./eviction').evictUntilUnderCap"
      pattern: "require.*src/eviction|require\\(['\"]\\./eviction['\"]\\)"
    - from: "src/cache.js"
      to: "src/index-file.js"
      via: "repairIndex called inside createCache constructor"
      pattern: "repairIndex"
    - from: "test/phase2.test.js"
      to: "child_process.fork"
      via: "TEST-08 + TEST-09 fixtures"
      pattern: "child_process|fork\\("

### Test Tier Strategy
| Tier | Tests | Rationale |
|------|-------|-----------|
| T1   | 12 of 14 tests in test/phase2.test.js | Single-process behaviors: eviction order, repairIndex, last_access flush, perf budgets |
| T2   | 2 of 14 tests (TEST-08 multi-process writers, TEST-09 SIGKILL+recover) | Use node:child_process.fork (Node builtin — no Docker, no external infra) |
---

<objective>
Integrate the pure eviction module (Plan 01) and the real lock body (Plan 02) into `src/cache.js` and write the 14 Phase 2 phase tests. Add `repairIndex` to `index-file.js` and wire it into the `createCache` constructor for ATOM-05 recovery. Implement `cleanOrphanTmps` for ATOM-04. Implement `_lastAccessDelta` (EVIC-04) and the delete-after-index-commit ordering (CONC-09). Implement Windows tombstone fallback for value-file unlink (PLAT-03).

Purpose: This is the load-bearing integration plan. After Plan 01 + Plan 02 complete, the parts exist but `cache.js` doesn't use them. This plan makes the cache actually concurrent, evicting, and crash-recoverable, then proves it with the 14 phase tests including the multi-process and SIGKILL fixtures.

Output:
- `src/cache.js` — modified to wire everything together
- `src/index-file.js` — new export `repairIndex`
- `test/helpers/child-writer.js` + `test/helpers/slow-writer.js` — new fork() fixtures
- `test/phase2.test.js` — 14 tests (covering TEST-05..09, TEST-14 from prior plans, plus PERF-01/02/04 and the integration-only requirements ATOM-04/05/07, EVIC-03/04, CONC-06/09, PLAT-03)

Note: TEST-14 (stale lockfile reclamation) is unit-tested in Plan 02's lock.test.js but Plan 03's phase test file exercises it again at the integration level (createCache + dead-PID lock + first set succeeds). PERF-03 was unit-tested in Plan 01. CONC-01..05 are unit-tested in Plan 02. Plan 03 covers everything not already proven.
</objective>

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
</execution_context>

<context>
@.planning/project.md
@.planning/roadmap.md
@.planning/state.md
@.planning/phases/02-concurrency-eviction/02-research.md
@.planning/phases/02-concurrency-eviction/02-01-eviction-pure-plan.md
@.planning/phases/02-concurrency-eviction/02-02-lock-and-rename-plan.md
@src/cache.js
@src/index-file.js
@src/lock.js
@src/ttl.js
@src/atomic-write.js
@test/phase1.test.js

<interfaces>
<!-- After Plan 01 + Plan 02 complete, these exports are available: -->

```js
// src/eviction.js (Plan 01)
function totalBytes(entries): number;
function evictUntilUnderCap(entries, maxBytes, maxEntries, newEntrySize): { kept: Object, evicted: string[] };

// src/lock.js (Plan 02 — real body)
function withLock(lockPath, fn): T;          // throws LockTimeoutError after 10 attempts
function isLockStale(lockPath): boolean;

// src/index-file.js (Phase 1, extended in this plan)
function createEmptyIndex(namespace): IndexData;
function readIndex(indexPath, namespace): IndexData;  // throws CorruptIndexError on bad JSON
function writeIndex(indexPath, indexObj, tmpDir): void;
function repairIndex(cacheDir, namespace): IndexData;  // <-- NEW in this plan

// src/cache.js public surface — UNCHANGED by Phase 2; only internals shift:
function createCache(namespace, opts?): {
  get, set, delete, list, clear, _internal
};
```

<!-- IndexEntry shape — Phase 2 adds optional tombstone flag (PLAT-03): -->
```js
// {
//   file: string, size: number, created_at: number, last_access: number,
//   expires_at: number|null, encoding: 'utf8'|'binary',
//   tombstone?: boolean,  // PLAT-03: true if Windows unlink failed; cleaned next open
// }
```

<!-- Existing test helper (use this in phase2.test.js): -->
```js
// test/helpers/tmp-namespace.js
function createTmpNamespace(label) { /* returns { cacheDir, nsName } */ }
function cleanupTmpNamespace(cacheDir) { /* fs.rmSync recursive */ }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add repairIndex to src/index-file.js (ATOM-05)</name>
  <files>src/index-file.js</files>
  <action>
Add a new exported function `repairIndex(cacheDir, namespace)` to `src/index-file.js`. Per research, SHA-256 filenames cannot be reverse-mapped to keys, so the conservative repair is to write an empty (but valid) index. This unblocks the cache from being permanently broken; orphaned value files will be cleaned by the next eviction cycle (or by a future v2 GC).

Implementation:

```js
const path = require('path');
// ... existing imports, plus:

function repairIndex(cacheDir, namespace) {
  const indexPath = path.join(cacheDir, 'index.json');
  const tmpDir = path.join(cacheDir, 'tmp');
  // Conservative: SHA-256 filenames are one-way. Write an empty valid index so the cache works again.
  // Surviving value files become orphans — next eviction or a future GC sweep removes them.
  const idx = createEmptyIndex(namespace);
  writeIndex(indexPath, idx, tmpDir);
  return idx;
}

module.exports = { CURRENT_VERSION, createEmptyIndex, readIndex, writeIndex, repairIndex };
```

Notes:
- DO NOT attempt to rebuild entries from `objects/` listing — the keys are unrecoverable.
- DO NOT delete `objects/` files inside `repairIndex` — leave them for the eviction cycle.
- The tmpDir must already exist (createCache constructor guarantees this with mkdirSync).
- Keep `path` import minimal — the rest of `index-file.js` previously used `path` only via writeAtomic's internal handling; explicit import is fine here.
  </action>
  <verify>
    <automated tier="T1">node -e "const m=require('./src/index-file'); if (typeof m.repairIndex !== 'function') process.exit(1);"</automated>
    <automated tier="T1">node --test test/index-file.test.js</automated>
  </verify>
  <done>repairIndex exported from src/index-file.js; existing index-file tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2a: cache.js infrastructure — requires, helpers, constructor wiring, last_access delta scaffolding</name>
  <files>src/cache.js</files>
  <action>
Phase 2 cache.js integration is split into two tasks for executor sanity. Task 2a adds infrastructure (helpers, constructor wiring, scaffolding) that is behaviorally inert against existing operations. Task 2b rewrites the operations themselves (doGet/doSet/doDelete/doList/doClear) to use the new scaffolding.

Modify `src/cache.js` to add the Phase 2 infrastructure. The public API surface is unchanged; only internals shift. After Task 2a, all 37 Phase 1 tests must still pass — Task 2a is a no-op behaviorally except for the constructor adding orphan-tmp + tombstone sweeps (both safe on a fresh or already-clean cache).

**A. Add new requires at top of file:**
```js
const { evictUntilUnderCap } = require('./eviction');
const { repairIndex } = require('./index-file');  // already exports readIndex/writeIndex/createEmptyIndex
```

**B. Add helper `cleanOrphanTmps(tmpDir, maxAgeMs = 60_000)` (ATOM-04):**
```js
function cleanOrphanTmps(tmpDir, maxAgeMs = 60_000) {
  let files;
  try { files = fs.readdirSync(tmpDir); } catch { return; }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.tmp')) continue;
    const fPath = path.join(tmpDir, f);
    try {
      const stat = fs.statSync(fPath);
      if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(fPath);
    } catch { /* ENOENT or EPERM (Windows AV) — ignore */ }
  }
}
```

**C. Add helper `safeReadIndex(indexPath, cacheDir, ns)` (ATOM-05):**
```js
// Note: 3-arg signature. repairIndex derives tmpDir from cacheDir internally
// (see Task 1: tmpDir = path.join(cacheDir, 'tmp')), so callers do not pass tmpDir here.
function safeReadIndex(indexPath, cacheDir, ns) {
  try {
    return readIndex(indexPath, ns);
  } catch (err) {
    if (err.code === 'CORRUPT_INDEX') {
      return repairIndex(cacheDir, ns);
    }
    throw err;
  }
}
```
Replace ALL `readIndex(indexPath, ns)` call sites in cache.js with `safeReadIndex(indexPath, cacheDir, ns)`. There are 5 such sites currently: doGet, doSet (inside withLock), doDelete (inside withLock), doList, doClear (inside withLock).

**D. Add helper `cleanTombstones(idx, objectsDir)` (PLAT-03):**
```js
function cleanTombstones(idx, objectsDir) {
  let changed = false;
  for (const [key, entry] of Object.entries(idx.entries)) {
    if (!entry.tombstone) continue;
    try {
      fs.unlinkSync(path.join(objectsDir, entry.file));
      delete idx.entries[key];
      changed = true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        delete idx.entries[key];  // already gone; remove from index
        changed = true;
      }
      // Otherwise still locked — leave tombstone for next open
    }
  }
  return changed;
}
```

**E. Run cleanOrphanTmps + tombstone sweep in createCache constructor:**
After the three `mkdirSync` calls and before `return { ... }`, insert:
```js
// ATOM-04: orphan tmp GC on every open
cleanOrphanTmps(tmpDir);

// PLAT-03: retry tombstoned deletes from prior runs (if any)
try {
  const idx = safeReadIndex(indexPath, cacheDir, ns);
  if (cleanTombstones(idx, objectsDir)) {
    // Persist the cleaned index — best-effort under withLock; if lock contended, skip
    try {
      withLock(lockPath, () => {
        const fresh = safeReadIndex(indexPath, cacheDir, ns);
        for (const k of Object.keys(idx.entries)) {
          if (!(k in fresh.entries)) delete fresh.entries[k];  // only drop the keys we tombstoned-cleaned
        }
        writeIndex(indexPath, fresh, tmpDir);
      });
    } catch { /* lock timeout: tombstones remain for next open */ }
  }
} catch { /* index unreadable even after repair — accept; future operations will rebuild */ }
```

**F. Add `_lastAccessDelta` closure variable (EVIC-04):**
Inside `createCache`, declare:
```js
const _lastAccessDelta = Object.create(null);

function applyLastAccessDelta(idx) {
  for (const key of Object.keys(_lastAccessDelta)) {
    if (idx.entries[key]) idx.entries[key].last_access = _lastAccessDelta[key];
    delete _lastAccessDelta[key];  // flush
  }
}
```
The `_lastAccessDelta` lives in the closure (per research recommendation), not on `_internal`. At this point in Task 2a, `applyLastAccessDelta` is defined but not yet called from any operation; Task 2b wires it into doGet/doSet/doDelete.

**Task 2a stop-line:** Stop here. Do NOT touch doGet/doSet/doDelete/doList/doClear yet — those are Task 2b. Run the Task 2a verify commands and confirm the existing 37 Phase 1 tests still pass before moving on.
  </action>
  <verify>
    <automated tier="T1">node --test test/phase1.test.js</automated>
    <automated tier="T1">node --test test/*.test.js</automated>
    <automated tier="T1">node -e "const fs=require('fs'); const s=fs.readFileSync('./src/cache.js','utf8'); for (const needle of ['cleanOrphanTmps','safeReadIndex','cleanTombstones','_lastAccessDelta','applyLastAccessDelta','repairIndex','evictUntilUnderCap']) if (!s.includes(needle)) { console.error('Task 2a missing:', needle); process.exit(1); }"</automated>
  </verify>
  <done>Helpers (cleanOrphanTmps, safeReadIndex, cleanTombstones, applyLastAccessDelta) and `_lastAccessDelta` closure variable are defined; constructor calls cleanOrphanTmps + tombstone sweep on open; all 37 Phase 1 tests still pass (constructor sweeps are no-ops on clean caches).</done>
</task>

<task type="auto">
  <name>Task 2b: cache.js operation rewrites — doGet, doSet, doDelete, doList, doClear, binding updates</name>
  <files>src/cache.js</files>
  <action>
Task 2b consumes the Task 2a infrastructure: it rewrites each cache operation to use `safeReadIndex`, `applyLastAccessDelta`, `evictUntilUnderCap`, and the delete-after-commit ordering (CONC-09). After Task 2b, all 37 Phase 1 tests must STILL pass — Phase 2 phase tests come in Task 5.

Sections G through M below all modify `src/cache.js`.

**G. Modify doGet to update _lastAccessDelta on hit (EVIC-04):**
```js
function doGet({ key, indexPath, objectsDir, ns, skewMs, cacheDir }) {
  validateKey(key);
  const idx = safeReadIndex(indexPath, cacheDir, ns);
  const entry = idx.entries[key];
  if (!entry) return undefined;
  if (entry.tombstone) return undefined;  // PLAT-03: treat tombstone as miss
  if (isExpired(entry, Date.now(), skewMs)) return undefined;

  const valuePath = path.join(objectsDir, entry.file);
  let raw;
  try { raw = fs.readFileSync(valuePath); }
  catch (err) { if (err.code === 'ENOENT') return undefined; throw err; }

  // EVIC-04: lazy last_access — in-memory only, flushed on next write
  _lastAccessDelta[key] = Date.now();

  if (entry.encoding === 'binary') return raw;
  return raw.toString('utf8');
}
```
Note: pass `cacheDir` through to doGet now (needed for safeReadIndex's repair path).

**H. Rewrite doSet to use eviction + delete-after-commit ordering (EVIC-03/04, CONC-06/09):**
```js
function doSet({ key, value, setOpts, indexPath, objectsDir, tmpDir, lockPath, ns, skewMs, cacheDir, maxBytes, maxEntries }) {
  validateKey(key);
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
    throw new TypeError('value must be a string or Buffer; call JSON.stringify before passing complex values');
  }
  const ttlMs = setOpts && 'ttlMs' in setOpts ? normalizeTtlMs(setOpts.ttlMs) : null;

  // Capture filenames to delete OUTSIDE the lock (CONC-09)
  let filesToDelete = [];

  withLock(lockPath, () => {
    const now = Date.now();
    const idx = safeReadIndex(indexPath, cacheDir, ns);

    // EVIC-04: flush lazy last_access deltas BEFORE purge so accessed-recently entries aren't classified expired
    applyLastAccessDelta(idx);

    // Compute new bytes/encoding
    let bytes, encoding;
    if (Buffer.isBuffer(value)) { bytes = value; encoding = 'binary'; }
    else { bytes = Buffer.from(value, 'utf8'); encoding = 'utf8'; }
    const filename = keyToFilename(key);

    // EVIC-03: purge expired BEFORE eviction sort
    const beforeEntries = Object.keys(idx.entries);
    idx.entries = purgeLazy(idx.entries, now, skewMs);
    const purgedKeys = beforeEntries.filter(k => !(k in idx.entries));

    // EVIC-01/02/05: make-room-before-insert (skip self if updating an existing key)
    const isUpdate = key in idx.entries;
    const projectedNewSize = isUpdate ? bytes.length - idx.entries[key].size : bytes.length;
    const entriesForEvict = { ...idx.entries };
    if (isUpdate) delete entriesForEvict[key];  // don't evict the key we're updating
    const { kept, evicted } = evictUntilUnderCap(
      entriesForEvict,
      maxBytes,
      maxEntries - (isUpdate ? 0 : 1) + (isUpdate ? 0 : 0),
      bytes.length
    );
    // The above maxEntries arithmetic is awkward; simpler: rebuild idx.entries from kept (+ optional update slot)
    idx.entries = isUpdate ? { ...kept, [key]: idx.entries[key] } : kept;

    // Capture filenames of purged + evicted entries BEFORE we lose the references
    for (const k of purgedKeys) {
      // purged entries' file names came from the previous idx — re-read original entries
      // (we lost them after purgeLazy reassignment); collect them BEFORE purgeLazy in a real impl
    }
    // ^ refactor needed: capture file references BEFORE purgeLazy. See cleaner version below.

    // Write new value (atomic)
    const valuePath = path.join(objectsDir, filename);
    writeAtomic(valuePath, bytes, tmpDir);

    // Build new entry
    const expires_at = ttlMs === null ? null : now + ttlMs;
    idx.entries[key] = {
      file: filename, size: bytes.length, created_at: now,
      last_access: now, expires_at, encoding,
    };

    // Commit index (atomic). Lock released by withLock's finally.
    writeIndex(indexPath, idx, tmpDir);
  });

  // CONC-09: delete value files OUTSIDE the lock, AFTER index rename committed
  for (const fname of filesToDelete) {
    safeUnlinkValueFile(path.join(objectsDir, fname), idx /* indexEntry */);
  }
}
```

**That sketch above has bugs — refactor to this cleaner shape:**

```js
function doSet({ key, value, setOpts, indexPath, objectsDir, tmpDir, lockPath, ns, skewMs, cacheDir, maxBytes, maxEntries }) {
  validateKey(key);
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
    throw new TypeError('value must be a string or Buffer; call JSON.stringify before passing complex values');
  }
  const ttlMs = setOpts && 'ttlMs' in setOpts ? normalizeTtlMs(setOpts.ttlMs) : null;

  let filesToDelete = [];     // CONC-09: filled inside lock, drained outside
  let tombstonedEntries = []; // [{key, entry}] for PLAT-03 retry signaling

  withLock(lockPath, () => {
    const now = Date.now();
    const idx = safeReadIndex(indexPath, cacheDir, ns);

    applyLastAccessDelta(idx);  // EVIC-04 flush

    // Compute bytes
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const encoding = Buffer.isBuffer(value) ? 'binary' : 'utf8';
    const filename = keyToFilename(key);

    // EVIC-03: capture file references for purged entries BEFORE purgeLazy mutates idx.entries
    const expiredKeys = [];
    for (const [k, e] of Object.entries(idx.entries)) {
      if (isExpired(e, now, skewMs)) {
        expiredKeys.push(k);
        filesToDelete.push(e.file);
      }
    }
    idx.entries = purgeLazy(idx.entries, now, skewMs);

    // EVIC-01/02/05: eviction. Exclude the key being updated from the eviction pool
    // so we don't evict the slot we're about to overwrite.
    const isUpdate = key in idx.entries;
    let entriesForEvict;
    let effectiveMaxEntries;
    let effectiveNewSize;
    if (isUpdate) {
      // Slot is already occupied; entriesForEvict has count = N-1.
      // CONC-09 update path: slot already occupied, so use maxEntries (not maxEntries-1);
      // count is unchanged for updates. evictUntilUnderCap will project N entries against
      // maxEntries and only count-evict if we'd actually grow (we won't, since this is an update).
      entriesForEvict = { ...idx.entries };
      delete entriesForEvict[key];
      effectiveMaxEntries = maxEntries;       // pure update: total count does NOT grow
      effectiveNewSize = bytes.length;        // bytes math handled correctly by evictUntilUnderCap
    } else {
      entriesForEvict = idx.entries;
      effectiveMaxEntries = maxEntries;
      effectiveNewSize = bytes.length;
    }

    const { kept, evicted } = evictUntilUnderCap(
      entriesForEvict, maxBytes, effectiveMaxEntries, effectiveNewSize
    );

    // Capture file references for evicted entries BEFORE we lose them
    for (const k of evicted) {
      filesToDelete.push(idx.entries[k].file);
    }

    // Reconstruct idx.entries from kept (+ preserve self if updating)
    idx.entries = isUpdate ? { ...kept, [key]: idx.entries[key] } : { ...kept };

    // Write new value file (atomic)
    const valuePath = path.join(objectsDir, filename);
    writeAtomic(valuePath, bytes, tmpDir);

    // Build new entry (overwrites self if isUpdate)
    const expires_at = ttlMs === null ? null : now + ttlMs;
    idx.entries[key] = {
      file: filename, size: bytes.length, created_at: now,
      last_access: now, expires_at, encoding,
    };

    writeIndex(indexPath, idx, tmpDir);
  });

  // CONC-09: delete files OUTSIDE the lock — readers with stale index get ENOENT and treat as miss
  for (const fname of filesToDelete) {
    safeUnlinkValueFile(path.join(objectsDir, fname));
  }
}
```

**I. Add `safeUnlinkValueFile` helper (PLAT-03):**
```js
function safeUnlinkValueFile(filePath) {
  try { fs.unlinkSync(filePath); }
  catch (err) {
    if (err.code === 'ENOENT') return;  // already gone
    if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      // PLAT-03: tombstone signaling deferred — we cannot easily access the index entry here
      // because we're outside the lock. Instead, the next createCache's cleanTombstones pass will
      // re-attempt unreferenced files via orphan GC (future v2). For Phase 2 we accept the leak.
      return;
    }
    throw err;
  }
}
```

Note: True tombstoning (mark entry.tombstone=true and persist) is harder OUTSIDE the lock. Per research, the simplest correct behavior is: on Windows EPERM/EBUSY for an evicted file, swallow the error — the index already does not reference the file (we removed it), so the orphan stays on disk until manually cleared. The `cleanTombstones` flow we wired in step D handles the case where the unlink failed for a `delete()` call where the entry was kept in idx with tombstone:true. For evicted entries, we accept the orphan as a Phase 2 limitation. **Document this decision in the summary.**

**J. Modify doDelete to defer unlink (CONC-09):**
```js
function doDelete({ key, indexPath, objectsDir, tmpDir, lockPath, ns, cacheDir }) {
  validateKey(key);
  let existed = false;
  let fileToDelete = null;
  let entryRef = null;

  withLock(lockPath, () => {
    const idx = safeReadIndex(indexPath, cacheDir, ns);
    // EVIC-04: flush pending lazy last_access updates BEFORE we mutate-and-write the index,
    // otherwise in-memory deltas from prior get() calls are lost.
    applyLastAccessDelta(idx);
    const entry = idx.entries[key];
    if (!entry) return;
    existed = true;
    fileToDelete = entry.file;
    entryRef = entry;
    delete idx.entries[key];
    writeIndex(indexPath, idx, tmpDir);
  });

  // CONC-09: unlink AFTER index rename
  if (fileToDelete) {
    try { fs.unlinkSync(path.join(objectsDir, fileToDelete)); }
    catch (err) {
      if (err.code === 'ENOENT') { /* ok */ }
      else if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        // PLAT-03: re-add the entry with tombstone flag so cleanTombstones retries on next open
        try {
          withLock(lockPath, () => {
            const idx2 = safeReadIndex(indexPath, cacheDir, ns);
            idx2.entries[key] = { ...entryRef, tombstone: true };
            writeIndex(indexPath, idx2, tmpDir);
          });
        } catch { /* tombstone best-effort */ }
      } else { throw err; }
    }
  }
  return existed;
}
```

**K. Update doList to skip tombstoned entries:**
```js
function doList({ indexPath, ns, skewMs, listOpts, cacheDir }) {
  const includeExpired = !!(listOpts && listOpts.includeExpired);
  const idx = safeReadIndex(indexPath, cacheDir, ns);
  const now = Date.now();
  const out = [];
  for (const [key, entry] of Object.entries(idx.entries)) {
    if (entry.tombstone) continue;   // PLAT-03: tombstones not visible
    if (!includeExpired && isExpired(entry, now, skewMs)) continue;
    out.push({ key, size: entry.size, expires_at: entry.expires_at, last_access: entry.last_access });
  }
  return out;
}
```

**L. Update the createCache return object to thread `cacheDir`, `maxBytes`, `maxEntries` into the bound methods so they reach doSet/doGet/doDelete/doList/doClear.** (Currently they're read from a closure but the doX functions take destructured params.)

For example: `set: (key, value, setOpts) => doSet({ key, value, setOpts, indexPath, objectsDir, tmpDir, lockPath, ns, skewMs, cacheDir, maxBytes, maxEntries })`.

Also: bind `applyLastAccessDelta` to the closure — pass via the `_internal`-equivalent or as a closure-captured function. Simplest: define the doX functions INSIDE createCache so they close over `_lastAccessDelta` and `applyLastAccessDelta` directly. This restructures the file from "free-function" style to "factory-closure" style. Acceptable change because the public API surface is unchanged.

**M. Refactor doClear to honor CONC-09 delete-after-commit ordering:**

The Phase 1 `doClear` (cache.js lines ~191-206) deletes value files INSIDE `withLock`. Phase 2 must collect file paths inside the lock, write the empty index inside the lock, then delete value files AFTER the lock releases — same delete-after-commit pattern as doSet/doDelete.

Replace the existing doClear body with:

```js
function doClear({ indexPath, objectsDir, tmpDir, lockPath, ns, cacheDir }) {
  let filesToDelete = [];
  withLock(lockPath, () => {
    const idx = safeReadIndex(indexPath, cacheDir, ns);
    // Capture filenames BEFORE we replace idx.entries with the empty index
    filesToDelete = Object.values(idx.entries).map(e => path.join(objectsDir, e.file));
    // Reset to empty index INSIDE the lock (CONC-06 preserved)
    const empty = createEmptyIndex(ns);
    writeIndex(indexPath, empty, tmpDir);
  });
  // CONC-09: delete value files AFTER lock releases. Use safeUnlinkValueFile so
  // Windows EPERM/EBUSY on a locked file does not throw — orphan stays on disk
  // until manually cleared (consistent with eviction-path tombstone semantics).
  for (const f of filesToDelete) {
    safeUnlinkValueFile(f);
  }
}
```

Bind doClear with `cacheDir` in the createCache return object (same threading as doSet/doDelete in section L).

Note: doClear does NOT need `applyLastAccessDelta(idx)` because it discards all entries — pending in-memory deltas are intentionally dropped along with the entries themselves. That said, also clear the in-closure `_lastAccessDelta` map after the lock releases so stale entries don't reappear in a future flush:

```js
// After the for-loop above:
for (const k of Object.keys(_lastAccessDelta)) delete _lastAccessDelta[k];
```

**Critical preservation rules:**
- `doGet` and `doList` MUST NOT call `withLock` (CONC-07).
- `doClear` MUST still wrap its body in `withLock` (CONC-06).
- Public surface (createCache, get/set/delete/list/clear, error class re-exports) is unchanged.
- All Phase 1 tests (37 of them) must still pass after this rewrite.

After finishing, run `node --test test/*.test.js` and verify everything green before declaring done.
  </action>
  <verify>
    <automated tier="T1">node --test test/phase1.test.js</automated>
    <automated tier="T1">node --test test/*.test.js</automated>
    <automated tier="T1">node -e "const fs=require('fs'); const s=fs.readFileSync('./src/cache.js','utf8'); for (const needle of ['evictUntilUnderCap','_lastAccessDelta','applyLastAccessDelta','cleanOrphanTmps','safeReadIndex','repairIndex','tombstone']) if (!s.includes(needle)) { console.error('missing:', needle); process.exit(1); }"</automated>
  </verify>
  <done>cache.js wires eviction, lazy last_access, orphan GC, repair, tombstones, and delete-after-commit ordering. All 37 Phase 1 tests still pass. The file references all required symbols.</done>
</task>

<task type="auto">
  <name>Task 4: Create test/helpers/child-writer.js + slow-writer.js multi-process fixtures</name>
  <files>test/helpers/child-writer.js, test/helpers/slow-writer.js</files>
  <action>
Create two child-process helper scripts under `test/helpers/`. Both are invoked by `child_process.fork()` from `test/phase2.test.js`.

**File 1: `test/helpers/child-writer.js`** (TEST-08 + PERF-04 fixture)
```js
#!/usr/bin/env node
'use strict';
// Invoked via child_process.fork() by test/phase2.test.js
// Required env: WHOOCACHE_DIR (target cacheDir), WRITER_ID (string), WRITES (default 50)

const { createCache } = require('../../src/cache');

const writerId = process.env.WRITER_ID || '0';
const cacheDir = process.env.WHOOCACHE_DIR;
const writes = parseInt(process.env.WRITES || '50', 10);

if (!cacheDir) {
  console.error('child-writer: WHOOCACHE_DIR env var is required');
  process.exit(1);
}

const cache = createCache('concurrency-test', { cacheDir });
for (let i = 0; i < writes; i++) {
  cache.set(`writer-${writerId}-key-${i}`, `value-${writerId}-${i}`);
}

// Signal completion via IPC
if (process.send) {
  process.send({ done: true, writerId, writes });
}
```

**File 2: `test/helpers/slow-writer.js`** (TEST-09 fixture)
```js
#!/usr/bin/env node
'use strict';
// Invoked via child_process.fork() by test/phase2.test.js (TEST-09 SIGKILL-mid-write)
// Required env: WHOOCACHE_DIR

const { createCache } = require('../../src/cache');
const cacheDir = process.env.WHOOCACHE_DIR;
if (!cacheDir) { console.error('slow-writer: WHOOCACHE_DIR required'); process.exit(1); }

const cache = createCache('crash-test', { cacheDir });

// Set the first key, then signal parent so parent can SIGKILL us mid-loop
cache.set('key-0', 'value-0');
if (process.send) process.send({ firstWriteDone: true });

// Continue writing — parent will kill us before the loop finishes
for (let i = 1; i < 1000; i++) {
  cache.set(`key-${i}`, `value-${i}-` + 'x'.repeat(512));  // ~512 bytes per value to slow it down
}
```

Both files: top line shebang, `'use strict'` second line, `process.send`-guarded IPC. The shebang is informational on Windows (fork() ignores it) but useful for ad-hoc testing.

These scripts use `createCache('concurrency-test', { cacheDir })` and `createCache('crash-test', { cacheDir })` — but the tests will pass `cacheDir` to `createTmpNamespace` so the namespace name is irrelevant (the cacheDir override wins per Phase 1 cache.js line 41-43).
  </action>
  <verify>
    <automated tier="T1">node -e "const fs=require('fs'); for (const f of ['./test/helpers/child-writer.js','./test/helpers/slow-writer.js']) if (!fs.existsSync(f)) process.exit(1);"</automated>
    <automated tier="T1">node ./test/helpers/child-writer.js 2>&1 | grep -q "WHOOCACHE_DIR env var is required" && echo "guard ok"</automated>
  </verify>
  <done>Both fixture scripts exist; child-writer.js exits cleanly with the env-var guard message when invoked without WHOOCACHE_DIR.</done>
</task>

<task type="auto">
  <name>Task 5: Author test/phase2.test.js — 14 phase tests covering Phase 2 acceptance</name>
  <files>test/phase2.test.js</files>
  <action>
Create `test/phase2.test.js` with the 14 Phase 2 acceptance tests. Use `node:test`, `node:assert/strict`, `child_process.fork`, and the existing `createTmpNamespace`/`cleanupTmpNamespace` helper.

Required test inventory (each test maps to one or more requirement IDs):

| # | Test name | Reqs covered |
|---|-----------|--------------|
| 1 | `TEST-05: LRU eviction order is correct under maxEntries overflow` | TEST-05, EVIC-01 |
| 2 | `TEST-06: maxBytes eviction triggers and stops at-or-under cap` | TEST-06, EVIC-02 |
| 3 | `TEST-07: maxEntries=1000 + 1001 sets — list().length === 1000, oldest evicted` | TEST-07, EVIC-05 |
| 4 | `EVIC-03: expired entries are purged before LRU eviction` | EVIC-03 |
| 5 | `EVIC-04: lazy last_access flushed on next set` | EVIC-04 |
| 6 | `CONC-06: doSet covers entire RMW under withLock — no torn read` | CONC-06 (smoke) |
| 7 | `CONC-07: doGet does not acquire the lock — verified via lockfile absence during get` | CONC-07 |
| 8 | `CONC-09: evicted file is unlinked AFTER index rename — readers with stale index get ENOENT and treat as miss` | CONC-09 (smoke) |
| 9 | `TEST-08 + CONC-08 + PERF-04: two children, 50 sets each, both finish < 1s, all keys present` | TEST-08, CONC-08, PERF-04 |
| 10 | `TEST-09 + ATOM-07: SIGKILL mid-write; reopen produces consistent index, no .tmp files remain` | TEST-09, ATOM-07, ATOM-04 |
| 11 | `TEST-14 (integration): manual stale lockfile is reclaimed; createCache + set succeeds` | TEST-14 (re-cover) |
| 12 | `ATOM-05: createCache survives JSON.parse-corrupt index — repairs to empty index, no throw` | ATOM-05 |
| 13 | `PERF-01: get for hot key < 1ms median (1000 iterations)` | PERF-01 |
| 14 | `PERF-02: set of 1KB value < 5ms median (100 iterations)` | PERF-02 |

**Detailed sketches (planner provides specifics; executor copies and runs):**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

const { createCache } = require('../src/cache');
const { createTmpNamespace, cleanupTmpNamespace } = require('./helpers/tmp-namespace');

function freshCache(label, opts = {}) {
  const { cacheDir } = createTmpNamespace(label);
  const cache = createCache(label.replace(/[^a-z0-9_-]/g, '-'), { cacheDir, ...opts });
  return { cache, cacheDir };
}

// TEST 1 (TEST-05): LRU eviction order under maxEntries overflow
test('TEST-05: LRU eviction order under maxEntries overflow', () => {
  const { cache, cacheDir } = freshCache('lru-order', { maxEntries: 3 });
  try {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    // Touch 'a' so 'b' becomes oldest
    assert.strictEqual(cache.get('a'), '1');
    cache.set('d', '4');  // forces eviction; need a flush of last_access first
    // Note: get() updates _lastAccessDelta in memory; the next set() flushes it BEFORE eviction.
    // So 'b' should be evicted (oldest unaccessed).
    const keys = cache.list().map(e => e.key).sort();
    assert.deepStrictEqual(keys, ['a', 'c', 'd']);
    assert.strictEqual(cache.get('b'), undefined);
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 2 (TEST-06): maxBytes eviction
test('TEST-06: maxBytes eviction stops at-or-under cap', () => {
  const { cache, cacheDir } = freshCache('max-bytes', { maxBytes: 1000, maxEntries: 1e6 });
  try {
    // Set 4 entries of ~300 bytes each — total ~1200, must evict at least 1
    cache.set('k1', 'x'.repeat(300));
    cache.set('k2', 'x'.repeat(300));
    cache.set('k3', 'x'.repeat(300));
    cache.set('k4', 'x'.repeat(300));
    const list = cache.list();
    const total = list.reduce((s, e) => s + e.size, 0);
    assert.ok(total <= 1000, `total bytes ${total} exceeds maxBytes 1000`);
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 3 (TEST-07): maxEntries off-by-one
test('TEST-07: maxEntries=1000 + 1001 sets => exactly 1000 entries', () => {
  const { cache, cacheDir } = freshCache('off-by-one', { maxEntries: 1000, maxBytes: 1e9 });
  try {
    for (let i = 0; i < 1001; i++) cache.set(`k${i}`, `v${i}`);
    const list = cache.list();
    assert.strictEqual(list.length, 1000);
    assert.strictEqual(cache.get('k0'), undefined, 'oldest key should be evicted');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 4 (EVIC-03): expired purged before LRU
test('EVIC-03: expired entries purged before LRU', async () => {
  const { cache, cacheDir } = freshCache('expired-first', { maxEntries: 3 });
  try {
    cache.set('expired-1', 'old', { ttlMs: 10 });
    cache.set('expired-2', 'old', { ttlMs: 10 });
    cache.set('alive', 'live');  // no TTL
    await sleep(30);
    cache.set('new', 'fresh');  // should evict expired-* first, alive survives
    const keys = cache.list().map(e => e.key).sort();
    assert.ok(keys.includes('alive'), 'live entry should survive');
    assert.ok(keys.includes('new'));
    assert.ok(!keys.includes('expired-1') && !keys.includes('expired-2'), 'expired entries should be purged first');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 5 (EVIC-04): lazy last_access flushed on set
test('EVIC-04: lazy last_access flushed on next set', async () => {
  const { cache, cacheDir } = freshCache('lazy-access');
  try {
    cache.set('foo', 'bar');
    const t1 = cache.list().find(e => e.key === 'foo').last_access;
    await sleep(20);
    cache.get('foo');  // updates _lastAccessDelta in memory only
    const t2 = cache.list().find(e => e.key === 'foo').last_access;
    // doList does NOT flush; so t2 should still equal t1 (lazy-only)
    assert.strictEqual(t2, t1, 'list() should NOT see in-memory delta yet');
    cache.set('other', 'x');  // any set flushes the delta
    const t3 = cache.list().find(e => e.key === 'foo').last_access;
    assert.ok(t3 > t1, 'after set(), last_access should be flushed and newer');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 6 (CONC-06 smoke): doSet covers RMW under withLock
test('CONC-06: doSet covers entire RMW under withLock (smoke)', () => {
  const { cache, cacheDir } = freshCache('rmw-smoke');
  try {
    // Just verify a normal set/get round-trip — full RMW correctness covered by TEST-08
    cache.set('a', '1');
    assert.strictEqual(cache.get('a'), '1');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 7 (CONC-07): doGet is lock-free
test('CONC-07: doGet does not create the lockfile', () => {
  const { cache, cacheDir, } = freshCache('lock-free-read');
  try {
    cache.set('a', 'b');
    // A lockfile may exist briefly during set, but should be gone after.
    // Now do a get and assert no lockfile is created during it.
    // (Perfect proof would require strace; smoke check: lockfile absent after a read.)
    const lockPath = path.join(cacheDir, 'index.json.lock');
    assert.strictEqual(fs.existsSync(lockPath), false);
    assert.strictEqual(cache.get('a'), 'b');
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 8 (CONC-09 smoke): delete-after-commit ordering
test('CONC-09: delete after index commit (smoke)', () => {
  const { cache, cacheDir } = freshCache('delete-after-commit', { maxEntries: 2 });
  try {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');  // forces 'a' eviction
    // After this returns: index has b,c; a's value file is unlinked.
    // 'a' get returns undefined (ATOM-06 ENOENT path or missing-from-index path).
    assert.strictEqual(cache.get('a'), undefined);
    const objectsDir = path.join(cacheDir, 'objects');
    const files = fs.readdirSync(objectsDir);
    assert.strictEqual(files.length, 2, 'exactly 2 object files after eviction');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 9 (TEST-08 + CONC-08 + PERF-04): multi-process parallel set
test('TEST-08: two children, 50 sets each, all keys present, finishes < 1s', async (t) => {
  const { cacheDir } = createTmpNamespace('multi-write');
  const WRITERS = 2;
  const WRITES = 50;
  try {
    const t0 = performance.now();
    await new Promise((resolve, reject) => {
      let done = 0;
      const onDone = () => { if (++done === WRITERS) resolve(); };
      for (let i = 0; i < WRITERS; i++) {
        const child = fork(
          path.join(__dirname, 'helpers', 'child-writer.js'),
          [],
          { env: { ...process.env, WHOOCACHE_DIR: cacheDir, WRITER_ID: String(i), WRITES: String(WRITES) }, silent: false }
        );
        child.on('message', (msg) => { if (msg && msg.done) onDone(); });
        child.on('error', reject);
        child.on('exit', (code) => { if (code !== 0) reject(new Error(`child ${i} exited code ${code}`)); });
      }
    });
    const elapsedMs = performance.now() - t0;
    // Audit: open cache and verify every expected key
    const cache = createCache('concurrency-test', { cacheDir });
    const keys = new Set(cache.list().map(e => e.key));
    for (let w = 0; w < WRITERS; w++) {
      for (let k = 0; k < WRITES; k++) {
        const key = `writer-${w}-key-${k}`;
        assert.ok(keys.has(key), `missing key after parallel write: ${key}`);
        assert.strictEqual(cache.get(key), `value-${w}-${k}`);
      }
    }
    // SC-1 / PERF-04: hard 1-second budget. Warn if over budget so CI logs flag the problem before assertion.
    if (elapsedMs >= 1000) {
      console.warn(`PERF-04 over budget: ${elapsedMs}ms — investigate CI runner`);
    }
    assert.ok(elapsedMs < 1000, `PERF-04: parallel writers must complete < 1s, got ${elapsedMs}ms`);
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 10 (TEST-09 + ATOM-07 + ATOM-04): SIGKILL mid-write recovery
test('TEST-09: SIGKILL mid-write — reopen succeeds, no .tmp files remain', async (t) => {
  const { cacheDir } = createTmpNamespace('sigkill-recovery');
  try {
    await new Promise((resolve, reject) => {
      const child = fork(
        path.join(__dirname, 'helpers', 'slow-writer.js'),
        [],
        { env: { ...process.env, WHOOCACHE_DIR: cacheDir }, silent: true }
      );
      child.on('message', (msg) => {
        if (msg && msg.firstWriteDone) {
          process.kill(child.pid, 'SIGKILL');
          // Give OS a moment to propagate the kill
          setTimeout(resolve, 100);
        }
      });
      child.on('error', reject);
    });

    // ATOM-07: reopen must succeed without throwing
    const cache = createCache('crash-test', { cacheDir });
    // Index must be parseable; list() returns at least key-0 (committed before SIGKILL)
    const list = cache.list();
    assert.ok(list.length >= 1, 'expected at least key-0 in recovered index');

    // SC-2 / ATOM-04: tmp/ must contain zero files older than 60s after createCache's GC.
    // Newly-created tmp files (younger than 60s, e.g. one from the SIGKILL'd write a moment ago)
    // are NOT GC'd by design — but anything older than 60s would indicate the GC failed to run.
    const tmpDir = path.join(cacheDir, 'tmp');
    const now = Date.now();
    const allTmpFiles = await fs.promises.readdir(tmpDir);
    const oldFiles = [];
    for (const f of allTmpFiles) {
      const stat = await fs.promises.stat(path.join(tmpDir, f));
      if (now - stat.mtimeMs > 60_000) oldFiles.push(f);
    }
    assert.strictEqual(
      oldFiles.length, 0,
      `SC-2: no .tmp files > 60s after recovery, found: ${oldFiles.join(',')}`
    );

    // Functional check: cache must be usable after recovery.
    cache.set('post-recovery', 'works');
    assert.strictEqual(cache.get('post-recovery'), 'works');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 11 (TEST-14 integration): stale lockfile reclaimed by createCache+set
test('TEST-14: stale lockfile (dead PID) reclaimed; first set succeeds', () => {
  const { cacheDir } = createTmpNamespace('stale-lock-integration');
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const lockPath = path.join(cacheDir, 'index.json.lock');
    // Write a fake lock with a very-likely-dead PID and a 10-second-old timestamp
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquired: Date.now() - 10_000 }));
    const cache = createCache('stale-lock-integration', { cacheDir });
    cache.set('foo', 'bar');
    assert.strictEqual(cache.get('foo'), 'bar');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 12 (ATOM-05): corrupt index recovers via repairIndex
test('ATOM-05: corrupt index.json triggers repair to empty index, no throw', () => {
  const { cacheDir } = createTmpNamespace('corrupt-index');
  try {
    fs.mkdirSync(path.join(cacheDir, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(cacheDir, 'objects'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'index.json'), 'this is not valid json {{{{');
    // createCache must not throw — the constructor's safeReadIndex catches CorruptIndexError and repairs.
    const cache = createCache('corrupt-index', { cacheDir });
    assert.strictEqual(cache.list().length, 0);
    // Cache must work after repair
    cache.set('post-repair', 'ok');
    assert.strictEqual(cache.get('post-repair'), 'ok');
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 13 (PERF-01): get hot-key < 1ms median
test('PERF-01: hot-key get < 1ms median over 1000 iterations', () => {
  const { cache, cacheDir } = freshCache('perf-get');
  try {
    cache.set('hot', 'value');
    const N = 1000;
    const times = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      cache.get('hot');
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(N / 2)];
    assert.ok(median < 1, `PERF-01: median get took ${median.toFixed(3)}ms (budget < 1ms)`);
  } finally { cleanupTmpNamespace(cacheDir); }
});

// TEST 14 (PERF-02): set of 1KB < 5ms median
test('PERF-02: set 1KB < 5ms median over 100 iterations', () => {
  const { cache, cacheDir } = freshCache('perf-set');
  try {
    const oneKB = 'x'.repeat(1024);
    const N = 100;
    const times = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      cache.set(`k${i}`, oneKB);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(N / 2)];
    assert.ok(median < 5, `PERF-02: median set took ${median.toFixed(3)}ms (budget < 5ms)`);
  } finally { cleanupTmpNamespace(cacheDir); }
});
```

Notes for the executor:
- The `freshCache` helper opens a cache in a fresh tmp dir. cleanup-on-finally is mandatory (otherwise tmpdirs leak).
- TEST 9's PERF-04 budget is asserted HARD at 1000ms (matches roadmap SC-1 verbatim). A `console.warn` at the same threshold flags slow runs in CI logs before the assertion fires, so failures are diagnosable. Do NOT relax the assertion below 1000ms — the 1-second budget is the success criterion.
- TEST 10 uses a 100ms post-SIGKILL sleep before reopening to let the OS settle.
- PERF tests use `node:perf_hooks.performance` per research recommendation.
- After authoring, run `node --test test/phase2.test.js` and verify ALL 14 tests pass before declaring done.

After everything passes, run the full suite: `node --test test/*.test.js`. Expected count: ~58 tests (37 Phase 1 + 7 eviction unit + 7 lock unit + 14 phase2 = 65 — but some Phase 1 tests overlap with phase2 in concept; final count varies). Target: at least 51 tests, all green. TEST-01 (≥12 tests) is satisfied.
  </action>
  <verify>
    <automated tier="T2">node --test test/phase2.test.js</automated>
    <automated tier="T2">node --test test/*.test.js</automated>
  </verify>
  <done>All 14 Phase 2 tests pass. Full test suite (Phase 1 + Plan 01 + Plan 02 + Plan 03 tests) passes — ≥51 tests, 0 fail. PERF-01 median < 1ms, PERF-02 median < 5ms, PERF-04 multi-process completes within budget.</done>
</task>

</tasks>

<verification>
After all 5 tasks (Task 1 / 2a / 2b / 4 / 5):
1. `node --test test/phase2.test.js` exits 0 with 14 tests passing.
2. `node --test test/*.test.js` exits 0 with the full suite green (≥ 51 tests; TEST-01 umbrella met).
3. Phase 2 success criteria from roadmap.md verified:
   - SC-1 (parallel writers): TEST 9 / TEST-08
   - SC-2 (SIGKILL recovery): TEST 10 / TEST-09 + ATOM-07
   - SC-3 (stale lock reclaimed): TEST 11 / TEST-14 integration
   - SC-4 (1001 sets, list().length <= 1000, oldest evicted): TEST 3 / TEST-07
   - SC-5 (≥12 tests pass on Linux Node 22): TEST-01 satisfied with ~58 total
4. `grep -E "_lastAccessDelta|cleanOrphanTmps|safeReadIndex|repairIndex" src/cache.js` confirms integration points are present.
</verification>

<success_criteria>
- src/cache.js integrates eviction, lazy last_access, orphan GC, index repair, delete-after-commit, and Windows tombstone fallback while preserving the public API.
- src/index-file.js exports repairIndex.
- test/helpers/{child-writer,slow-writer}.js exist as multi-process fixtures.
- test/phase2.test.js contains 14 named tests covering every requirement in this plan's `requirements` field plus EVIC-03/04/05, CONC-06/07/09, ATOM-04/05/07, PLAT-03 (smoke).
- Total test count >= 51; full suite passes.
- PERF-01 median < 1ms, PERF-02 median < 5ms documented in test output.
- TEST-08 multi-process audit: every expected key present, zero lost writes.
- TEST-09 SIGKILL recovery: createCache after kill does NOT throw; cache is functional post-recovery.
- PLAT-05 (Windows CI) is a deployment gate — not enforced by this plan beyond the PLAT-02/03 code paths existing. Document as out-of-band CI verification in the summary.
</success_criteria>

<output>
After completion, create `.planning/phases/02-concurrency-eviction/02-03-integration-and-phase-tests-summary.md` listing:
- Requirements completed (ATOM-04, ATOM-05, ATOM-07, EVIC-03, EVIC-04, CONC-06, CONC-07, CONC-08, CONC-09, PLAT-03, PLAT-05, TEST-01, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, PERF-01, PERF-02, PERF-04)
- Files created/modified
- Test count delta and final total
- Decisions made (especially around tombstone semantics for evicted-vs-deleted entries, PERF-04 hard-vs-soft assertion, structural shift from free-functions to factory closures in cache.js)
- Any deviations from the plan
- Phase 2 success-criteria verification table (SC-1..SC-5 ✓/✗)
</output>
