---
phase: 02-concurrency-eviction
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lock.js
  - src/atomic-write.js
  - test/lock.test.js
autonomous: true
requirements: [CONC-01, CONC-02, CONC-03, CONC-04, CONC-05, PLAT-02, TEST-14]
change_class: feature

must_haves:
  truths:
    - "withLock(lockPath, fn) acquires an O_EXCL lockfile at lockPath, runs fn, releases the lockfile"
    - "Lockfile content is JSON.stringify({pid: process.pid, acquired: Date.now()})"
    - "On EEXIST, isLockStale checks the holder's PID via process.kill(pid,0); if dead (ESRCH), the stale lockfile is reclaimed and retry succeeds immediately"
    - "After 10 failed attempts, withLock throws LockTimeoutError carrying the lockfile path"
    - "Retry backoff is jittered exponential (base 10ms + Math.random()*10ms jitter) and uses Atomics.wait for synchronous sleep — no busy-loop, no subprocess spawn"
    - "On Windows, fs.renameSync EPERM triggers a retry loop (5 attempts, 50ms delay); other errors propagate"
    - "test/lock.test.js TEST-14 case: a lockfile written with a fake-dead PID (e.g. 999999) is reclaimed automatically and the next withLock call succeeds"
    - "Existing 37-test suite remains green — Phase 1 cache.js call sites unmodified"
  artifacts:
    - path: "src/lock.js"
      provides: "Real O_EXCL lock with PID-stale reclamation, jittered backoff, Atomics.wait sleep, LockTimeoutError on 10 attempts"
      exports: ["withLock", "isLockStale"]
      min_lines: 60
    - path: "src/atomic-write.js"
      provides: "writeAtomic with Windows EPERM rename retry"
      exports: ["writeAtomic", "fsyncDir"]
      contains: "process.platform"
    - path: "test/lock.test.js"
      provides: "Unit tests covering lock acquire, sequential acquirers, stale-PID reclamation (TEST-14), 10-attempt timeout, isLockStale truth table"
      contains: "TEST-14"
      min_lines: 100
  key_links:
    - from: "src/lock.js"
      to: "src/errors.js"
      via: "require('./errors').LockTimeoutError"
      pattern: "LockTimeoutError"
    - from: "src/lock.js"
      to: "Atomics.wait"
      via: "synchronous sleep primitive"
      pattern: "Atomics\\.wait"
    - from: "src/atomic-write.js"
      to: "process.platform"
      via: "win32 retry guard"
      pattern: "process\\.platform.*win32"

### Test Tier Strategy
| Tier | Tests | Rationale |
|------|-------|-----------|
| T1   | 7 unit tests in test/lock.test.js | Single-process, real fs but no fork |
---

<objective>
Replace the no-op shim in `src/lock.js` with the real O_EXCL lockfile implementation: PID-aware stale reclamation, jittered exponential backoff using `Atomics.wait`, and `LockTimeoutError` after 10 attempts. Also add the Windows EPERM retry wrapper to `src/atomic-write.js` (PLAT-02). Lock down the seam with a dedicated `test/lock.test.js`.

Purpose: Phase 1 left `withLock` as a pass-through. Without real locking, the existing `cache.js` call sites are not multi-process safe. This plan turns the seam from a stub into a real cross-process serializer without touching `cache.js`. Plan 03 then layers integration on top.

Output:
- `src/lock.js` body replaced (signature unchanged: `withLock(lockPath, fn)` returns `fn()`'s result)
- `src/atomic-write.js` modified: bare `fs.renameSync` → `renameWithRetry` on win32
- `test/lock.test.js` created with at least 6 unit tests including TEST-14
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
@src/lock.js
@src/atomic-write.js
@src/errors.js
@test/helpers/tmp-namespace.js

<interfaces>
<!-- LOCKED: signature was set in Phase 1 Plan 02. cache.js call sites depend on this. -->

```js
// src/lock.js — Phase 1 (no-op shim, to be replaced)
function withLock(lockPath, fn) {
  return fn();
}
module.exports = { withLock };
```

<!-- The error class for lock timeout is already exported from src/errors.js: -->
```js
class LockTimeoutError extends Error {
  constructor(message, lockfilePath) {
    super(message);
    this.name = 'LockTimeoutError';
    this.code = 'LOCK_TIMEOUT';
    this.lockfilePath = lockfilePath;   // <-- carries the held lockfile path (CONC-05/ERR-03)
  }
}
```

<!-- Phase 1 atomic-write.js performs the bare rename. The Phase 2 modification adds a Windows EPERM retry: -->
```js
// src/atomic-write.js — current line 21
fs.renameSync(tmpPath, targetPath);
// ^^ becomes: renameWithRetry(tmpPath, targetPath);
```

<!-- Tmp-namespace test helper (already exists) — use to isolate per-test lockfiles: -->
```js
// test/helpers/tmp-namespace.js
function createTmpNamespace(label) { /* returns { cacheDir, ... } */ }
function cleanupTmpNamespace(cacheDir) { /* fs.rmSync recursive */ }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace src/lock.js body with real O_EXCL lock + PID-stale reclamation + jittered backoff</name>
  <files>src/lock.js</files>
  <action>
Rewrite `src/lock.js` (signature unchanged: `withLock(lockPath, fn) -> T`). Implement exactly the pattern from research.md "Pattern 1: Lock-Then-Read-Then-Write" with the Pitfall-3 staleness enhancement (5-second age heuristic).

Required exports:
- `withLock(lockPath, fn)` — acquire, run, release; throws `LockTimeoutError` after 10 attempts
- `isLockStale(lockPath)` — exported for unit testing (TEST-14)

Required constants (top-of-file):
```js
const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 10;
const STALE_AGE_MS = 5000;
const MAX_DELAY_MS = 200;
```

Implementation (CONC-01 through CONC-05):

```js
'use strict';
const fs = require('fs');
const { LockTimeoutError } = require('./errors');
const { O_CREAT, O_EXCL, O_WRONLY } = fs.constants;

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 10;
const STALE_AGE_MS = 5000;
const MAX_DELAY_MS = 200;

function acquireLock(lockPath) {
  // CONC-02: lockfile content is JSON {pid, acquired}
  const content = JSON.stringify({ pid: process.pid, acquired: Date.now() });
  let fd;
  try {
    // CONC-01: O_CREAT | O_EXCL | O_WRONLY (equivalent to 'wx', self-documenting)
    fd = fs.openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY);
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function isLockStale(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    // File vanished between EEXIST and read — treat as not stale (next acquire will succeed naturally)
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Garbage content — be conservative; reclaim
    return true;
  }
  if (!parsed || typeof parsed.pid !== 'number') return true;
  const ageMs = Date.now() - (typeof parsed.acquired === 'number' ? parsed.acquired : 0);
  try {
    process.kill(parsed.pid, 0);
    // PID exists. Pitfall-3 (Windows zombie heuristic): only call it stale if older than STALE_AGE_MS.
    return ageMs > STALE_AGE_MS;
  } catch (err) {
    if (err.code === 'ESRCH') return true;       // CONC-03: definitively dead
    if (err.code === 'EPERM') return ageMs > STALE_AGE_MS; // alive but not ours; same age guard
    return false;
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already gone is fine */ }
}

function syncSleep(ms) {
  // Atomics.wait on a fresh SharedArrayBuffer: portable synchronous sleep, no spin, no subprocess
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(lockPath, fn) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (acquireLock(lockPath)) {
      try { return fn(); }
      finally { releaseLock(lockPath); }
    }
    // CONC-03: stale-lock reclamation on EEXIST
    if (isLockStale(lockPath)) {
      releaseLock(lockPath);
      continue; // retry immediately, do NOT consume an attempt
    }
    // CONC-04: jittered exponential backoff via Atomics.wait
    const jitter = Math.floor(Math.random() * BASE_DELAY_MS);  // jitter >= baseMs (per research)
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt) + jitter, MAX_DELAY_MS);
    syncSleep(delay);
  }
  // CONC-05: throw LockTimeoutError carrying the lockfile path
  throw new LockTimeoutError(
    `Could not acquire lock after ${MAX_ATTEMPTS} attempts: ${lockPath}`,
    lockPath
  );
}

module.exports = { withLock, isLockStale };
```

Critical contract notes (do NOT skip):
- `continue` after `isLockStale → release` MUST NOT increment the attempt counter (the reclamation should not consume one of the 10 retries). The `for` loop's `attempt++` runs anyway — to avoid that consuming an attempt, decrement: `attempt--; continue;` OR keep current loop and accept that stale-reclamation costs one attempt. Per research's pattern, the simpler `continue` is fine because the next iteration's `acquireLock` will succeed; it costs one of 10 attempts but only when stale. **Use `continue` (not `attempt--`)** — simpler, and TEST-14 will verify reclamation succeeds within 10 attempts.
- DO NOT release the lockfile before `fn()` runs. `try/finally` is mandatory to guarantee release on exception.
- `isLockStale` returns `true` on parse-failure (garbage content) — defensive; the next reclaim+retry is safe.
- Use `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)` — verbatim. Do not optimize to a module-level shared buffer (this is a sync library; per-call allocation cost is negligible vs. the sleep itself).
  </action>
  <verify>
    <automated tier="T1">node -e "const m = require('./src/lock'); if (typeof m.withLock !== 'function' || typeof m.isLockStale !== 'function') process.exit(1); m.withLock(require('os').tmpdir() + '/whoocache-lock-smoke-' + Date.now() + '.lock', () => 42) === 42 || process.exit(2);"</automated>
    <automated tier="T1">node --test test/*.test.js</automated>
  </verify>
  <done>src/lock.js exports withLock + isLockStale; smoke test acquires and releases without error; existing 37-test suite still green (cache.js calls through the new lock body without changes).</done>
</task>

<task type="auto">
  <name>Task 2: Add Windows EPERM rename retry to src/atomic-write.js (PLAT-02)</name>
  <files>src/atomic-write.js</files>
  <action>
Modify `src/atomic-write.js` to wrap the bare `fs.renameSync(tmpPath, targetPath)` call (line 21 currently) with a `renameWithRetry` helper that retries on EPERM ONLY on `process.platform === 'win32'`. Other errors (and EPERM on non-Windows) must propagate immediately to preserve Phase 1 behavior on Linux/macOS.

Required helper (add near `fsyncDir`):

```js
function renameWithRetry(src, dst, maxRetries = 5, delayMs = 50) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      fs.renameSync(src, dst);
      return;
    } catch (err) {
      const isWinEperm = err.code === 'EPERM' && process.platform === 'win32';
      if (isWinEperm && i < maxRetries) {
        // Use the same Atomics.wait pattern as lock.js for sync sleep
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        continue;
      }
      throw err;
    }
  }
}
```

In `writeAtomic`, replace `fs.renameSync(tmpPath, targetPath);` with `renameWithRetry(tmpPath, targetPath);`. Do NOT change anything else in `writeAtomic` (the OWFCRD sequence — Open, Write, Fsync, Close, Rename, Dirfsync — must be preserved exactly).

Update module.exports if you want to export `renameWithRetry` for testing — but keep the public surface minimal: only `writeAtomic` and `fsyncDir` need to be exported. The retry helper can be private (no test required for the Windows-only path on a Linux CI runner; PLAT-05 is a CI gate, not a code task).

Add a comment above `renameWithRetry` referencing PLAT-02 + Pitfall X-1.
  </action>
  <verify>
    <automated tier="T1">node -e "const fs=require('fs'); const src=fs.readFileSync('./src/atomic-write.js','utf8'); if (!/process\.platform\s*===\s*['\"]win32['\"]/.test(src)) { console.error('PLAT-02 win32 guard missing'); process.exit(1); } if (!/renameWithRetry/.test(src)) { console.error('renameWithRetry helper missing'); process.exit(2); }"</automated>
    <automated tier="T1">node --test test/atomic-write.test.js</automated>
    <automated tier="T1">node --test test/*.test.js</automated>
  </verify>
  <done>renameWithRetry exists in atomic-write.js with a `process.platform === 'win32'` guard. The 5 existing atomic-write tests still pass. Full suite still green.</done>
</task>

<task type="auto">
  <name>Task 3: Create test/lock.test.js with unit tests for CONC-01..05 + TEST-14</name>
  <files>test/lock.test.js</files>
  <action>
Create `test/lock.test.js` using `node:test` and `node:assert/strict`. Use `createTmpNamespace`/`cleanupTmpNamespace` from `test/helpers/tmp-namespace.js` to isolate each test's lockfile inside a fresh tmp dir.

Required test cases:

1. **withLock acquires and releases (happy path, CONC-01)**
   - Create tmp namespace, compute `lockPath = path.join(cacheDir, 'index.json.lock')`.
   - Assert `fs.existsSync(lockPath) === false` before.
   - Call `withLock(lockPath, () => { assert.strictEqual(fs.existsSync(lockPath), true); return 42; })`.
   - Assert return value is 42.
   - Assert `fs.existsSync(lockPath) === false` after (released in finally).

2. **withLock releases on throw**
   - Call `withLock(lockPath, () => { throw new Error('boom'); })` inside `assert.throws(...)`.
   - Verify lockfile is gone after.

3. **Sequential acquires both succeed**
   - Two back-to-back `withLock` calls; both return their fn()'s value; lockfile not present after.

4. **Lockfile content is JSON {pid, acquired} (CONC-02)**
   - Inside the fn, assert `JSON.parse(fs.readFileSync(lockPath,'utf8'))` returns `{pid: process.pid, acquired: <number>}`.

5. **TEST-14: stale-PID reclamation**
   - BEFORE calling withLock, manually `fs.writeFileSync(lockPath, JSON.stringify({pid: 999999, acquired: Date.now() - 10_000}))`.
     (PID 999999 is essentially guaranteed dead on any machine; the 10-second age also satisfies the STALE_AGE_MS heuristic for Windows zombie defense.)
   - Call `withLock(lockPath, () => 'reclaimed')`.
   - Assert it returns `'reclaimed'` (the dead lock was reclaimed within the 10-attempt budget).
   - This test directly satisfies TEST-14 + CONC-03.

6. **isLockStale truth table**
   - Stale: write lockfile with `pid: 999999` (any age) → assert `isLockStale(lockPath) === true`.
   - Stale: write lockfile with garbage `'not json'` → assert `true` (parse-failure path).
   - Not stale: write lockfile with `pid: process.pid` and `acquired: Date.now()` → assert `false`.
   - File missing → assert `false`.

7. **LockTimeoutError after 10 attempts (CONC-05)**
   - Manually write a lockfile with the CURRENT process's pid AND a fresh `acquired: Date.now()` timestamp:
     `fs.writeFileSync(lockPath, JSON.stringify({pid: process.pid, acquired: Date.now()}))`.
   - Because `process.kill(process.pid, 0)` succeeds and age < STALE_AGE_MS, isLockStale returns false; withLock will retry 10 times.
   - Wrap in `assert.throws(() => withLock(lockPath, () => {}), (err) => err.code === 'LOCK_TIMEOUT' && err.lockfilePath === lockPath)`.
   - This test will sleep ~10ms * (1+2+4+...+512) ≈ ~1 second total — acceptable for a one-off timeout assertion. Mark with `{ timeout: 5000 }` on the test if `node:test` syntax requires.

Test harness skeleton (matches existing test style):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withLock, isLockStale } = require('../src/lock');
const { createTmpNamespace, cleanupTmpNamespace } = require('./helpers/tmp-namespace');

test('withLock acquires and releases', () => {
  const { cacheDir } = createTmpNamespace('lock-happy');
  try {
    const lockPath = path.join(cacheDir, 'index.json.lock');
    /* ... */
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

After authoring all 7 tests, run `node --test test/lock.test.js` and verify they all pass before declaring done.

Important: the LockTimeoutError test (case 7) MUST clean up the manually-written lockfile in `finally` (otherwise other test runs may see a stale lock and behave oddly).
  </action>
  <verify>
    <automated tier="T1">node --test test/lock.test.js</automated>
    <automated tier="T1">node --test test/*.test.js</automated>
  </verify>
  <done>All 7 tests in test/lock.test.js pass. The full test suite (Phase 1's 37 + Plan 02-01's 7 + this plan's 7) passes — at least 51 tests total green.</done>
</task>

</tasks>

<verification>
After all 3 tasks:
1. `node --test test/lock.test.js` exits 0 with 7+ tests passing — TEST-14 stale-PID reclamation explicitly verified.
2. `node --test test/*.test.js` exits 0 — every prior test still green; the lock body swap did not break Phase 1 cache.js call sites.
3. `node -e "const m=require('./src/lock'); console.log(Object.keys(m).sort().join(','))"` prints `isLockStale,withLock`.
4. `grep -E "process\.platform.*win32" src/atomic-write.js` (via Bash) finds the PLAT-02 guard.
</verification>

<success_criteria>
- src/lock.js implements real O_EXCL acquisition with PID-aware stale reclamation, jittered backoff via Atomics.wait, and LockTimeoutError after 10 attempts.
- src/atomic-write.js has renameWithRetry guarded by `process.platform === 'win32'` (PLAT-02).
- test/lock.test.js covers CONC-01, CONC-02, CONC-03, CONC-05, and TEST-14 explicitly. CONC-04 is exercised implicitly by the timeout test (which sleeps via Atomics.wait).
- The full project test suite remains green; cache.js was not modified.
</success_criteria>

<output>
After completion, create `.planning/phases/02-concurrency-eviction/02-02-lock-and-rename-summary.md` listing requirements completed (CONC-01, CONC-02, CONC-03, CONC-04, CONC-05, PLAT-02, TEST-14), files modified vs. created, decisions made, and the test count delta.
</output>
