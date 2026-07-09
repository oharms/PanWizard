---
phase: 03-cli-dogfood
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - dogfood/pan-check-update.js
  - dogfood/parallel-test.js
autonomous: true
change_class: feature
requirements:
  - DOG-01
  - DOG-02
  - DOG-03

must_haves:
  truths:
    - "dogfood/pan-check-update.js replaces the ad-hoc ~/.claude/cache/pan-update-check.json write with a whoocache call"
    - "First run prints `CACHE MISS` and stores the fetched result with a TTL"
    - "Second run within the TTL window prints `CACHE HIT` and skips the fetch"
    - "Returns cached version within TTL window; expiry refresh follows the TTL contract verified by Phase 1 unit tests (TTL-01..06, TEST-04, TEST-12) — this plan does NOT re-verify post-expiry refresh because TTL_MS is 1 hour and a wall-clock wait is impractical here"
    - "dogfood/parallel-test.js forks two children using test/helpers/child-writer.js with WRITES=1000"
    - "After both children finish, the index audit confirms a consistent index — every listed entry has the correct value and zero corrupt/torn writes are present (evicted entries are not counted as lost writes; the writers inherit the default maxEntries=1000 cap, so the surviving listed-entry count is bounded by that cap, not the 2000 attempted writes)"
    - "dogfood/parallel-test.js exits 0 with `PASS:` line on success; exits 1 with `FAIL:` line on lost writes"
  artifacts:
    - path: "dogfood/pan-check-update.js"
      provides: "whoocache-based fork of PAN's pan-check-update hook (DOG-01/02)"
      min_lines: 40
      contains: "createCache"
    - path: "dogfood/parallel-test.js"
      provides: "Standalone two-child 1000-set audit driver (DOG-03)"
      min_lines: 50
      contains: "fork"
  key_links:
    - from: "dogfood/pan-check-update.js"
      to: "src/cache.js (createCache)"
      via: "createCache('pan-update', { maxEntries: 10 })"
      pattern: "createCache\\('pan-update'"
    - from: "dogfood/pan-check-update.js"
      to: "TTL-driven hit/miss"
      via: "cache.get → if hit print HIT and exit; else fetch and cache.set with ttlMs"
      pattern: "cache\\.(get|set)"
    - from: "dogfood/parallel-test.js"
      to: "test/helpers/child-writer.js"
      via: "child_process.fork() with WRITES=1000 env var"
      pattern: "child-writer\\.js"
    - from: "dogfood/parallel-test.js"
      to: "audit via createCache + list()"
      via: "open shared cacheDir as reader and assert all 2000 keys present"
      pattern: "cache\\.list\\("
---

<objective>
Prove whoocache works as a drop-in replacement for PAN's ad-hoc update-check cache file (DOG-01/02), and prove it survives the strenuous parallel-write workload (1000 sets × 2 processes = 2000 sets) the project's "eat-our-own-dogfood marker" demands (DOG-03). Both deliverables live under a new `dogfood/` directory, are standalone scripts (not tests), and reuse the existing `test/helpers/child-writer.js` fixture.

Purpose: Solo Phase-3 deliverable #2 — closes the dogfood loop. PAN currently writes `~/.claude/cache/pan-update-check.json` via raw `fs.writeFileSync` with no TTL, no atomicity, and no multi-process safety. This phase shows that pattern can be replaced with one `cache.set/get` pair, behaving identically on the happy path and surviving the failure modes the original silently corrupts under. The parallel test is the project's success-criterion #4 from idea.md: "two child processes both calling set 1000 times into shared cache" with "consistent index AND zero lost writes detected by post-run audit."

Output: Two standalone driver scripts under `dogfood/` that demonstrate (a) hit/miss/refresh semantics around a TTL window and (b) zero data loss under heavy concurrent contention.
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

<!-- Phase 2 SUMMARY for the existing parallel-writer fixture -->
@.planning/phases/02-concurrency-eviction/02-03-integration-and-phase-tests-summary.md

@src/cache.js
@test/helpers/child-writer.js

<interfaces>
<!-- Inputs the executor needs without re-reading the codebase -->

From src/cache.js — createCache surface:
```js
const { createCache } = require('../src/cache');
const cache = createCache('pan-update', { maxEntries: 10 });   // for DOG-01/02
const cache = createCache('concurrency-test', { cacheDir, maxEntries: 5000 });  // for DOG-03
cache.get(key) → string | Buffer | undefined
cache.set(key, value, { ttlMs })
cache.list({ includeExpired }) → Array<{ key, size, expires_at, last_access }>
```

From test/helpers/child-writer.js — existing fixture, do NOT modify:
```js
// Required env: WHOOCACHE_DIR, WRITER_ID
// Optional env:  WRITES (defaults to 50)
const cache = createCache('concurrency-test', { cacheDir });
for (let i = 0; i < writes; i++) {
  cache.set(`writer-${writerId}-key-${i}`, `value-${writerId}-${i}`);
}
process.send({ done: true, writerId, writes });
```
Key fact: namespace is hardcoded to `'concurrency-test'` — dogfood/parallel-test.js must open the audit cache with the SAME namespace and the SAME cacheDir.

Original PAN hook reference (from research §What the Original pan-check-update.js Does):
- Path: `D:\PanWizard\hooks\pan-check-update.js` (READ-ONLY external reference)
- Behavior: writes `{update_available, installed, latest, checked}` JSON to `~/.claude/cache/pan-update-check.json` via raw fs.writeFileSync
- TTL: implicit ~1 hour re-check interval (no enforcement; caller decides)
- Concurrency: none (last writer wins → corruption possible)

Roadmap success criterion #3 (locked):
> A fork of `pan-check-update.js` using `createCache('pan-update', {maxEntries: 10}).set(...)` returns the cached version within the TTL window and fetches fresh after expiry — same behavior as the ad-hoc JSON file it replaces

Roadmap success criterion #4 (locked):
> A post-run audit of the dogfood fork's parallel-process test (two children, 1000 sets each) shows a consistent index with zero lost writes
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement dogfood/pan-check-update.js (DOG-01, DOG-02)</name>
  <files>dogfood/pan-check-update.js</files>
  <action>
Create `dogfood/pan-check-update.js` — a self-contained demonstration script that mirrors PAN's `hooks/pan-check-update.js` shape but uses whoocache for storage. Closely follow the structure in research §dogfood/pan-check-update.js.

**Line 1:** `#!/usr/bin/env node`
**Line 2:** `'use strict';`

**Required behavior:**

1. **Constants at the top:**
   - `TTL_MS = 3_600_000`  (1 hour — matches PAN's implicit recheck interval per roadmap SC-3)
   - `CACHE_KEY = 'pan-wizard-update-check'`

2. **Cache construction (DOG-01 — locked from roadmap):**
   ```js
   const cache = createCache('pan-update', { maxEntries: 10 });
   ```
   Use namespace `'pan-update'` and `maxEntries: 10` exactly as roadmap success criterion #3 specifies. Do NOT change the namespace or maxEntries — those are locked.

3. **Hit path (DOG-02):**
   - Call `cache.get(CACHE_KEY)`.
   - If non-undefined → `console.log('[whoocache dogfood] CACHE HIT:', cached);` and `return;` (set exitCode 0 implicitly). Do NOT call `process.exit(0)`.

   **IMPORTANT — research override:** The research §Code Examples block for `dogfood/pan-check-update.js` shows `process.exit(0)` on the hit path (e.g. `if (cached) { console.log(...); process.exit(0); }`). **That example is incorrect per research §Pitfall 1 ("process.exit() Truncates stdout").** `process.exit()` invoked immediately after `console.log` / `process.stdout.write` can truncate the buffered write on fast machines, which would silently break the verify step (the smoke test greps for `CACHE HIT` in stdout — a truncated write would fail intermittently). The instruction in this task action above (`return;` after `console.log`, with `process.exitCode = 0` set implicitly because no error path was taken) is authoritative. Do NOT mirror the research example here. The same rule applies to the miss path: just let execution fall through after `cache.set(...)` and the final `console.log(...)` — no explicit `process.exit` call anywhere in this file.

4. **Miss path (DOG-02):**
   - Print `console.log('[whoocache dogfood] CACHE MISS: fetching...');`
   - Determine `installed` version: try reading `path.join(process.cwd(), '.claude', 'pan-wizard-core', 'VERSION')` first; fall back to `path.join(os.homedir(), '.claude', 'pan-wizard-core', 'VERSION')`. If neither exists or readFileSync throws → `installed = '0.0.0'`. Trim whitespace.
   - Determine `latest` version: try `execSync('npm view pan-wizard version', { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim()`. On any throw → `latest = null`. Wrap in try/catch (DO NOT let an offline machine crash the script).
   - Build the result object EXACTLY as PAN's original (research §dogfood/pan-check-update.js):
     ```js
     const result = JSON.stringify({
       update_available: !!(latest && installed !== latest),
       installed,
       latest: latest || 'unknown',
       checked: Math.floor(Date.now() / 1000),
     });
     ```
   - `cache.set(CACHE_KEY, result, { ttlMs: TTL_MS });`
   - `console.log('[whoocache dogfood] CACHE MISS: fetched and cached:', result);`

5. **Imports** (top of file after shebang and use strict):
   ```js
   const { createCache } = require('../src/cache');
   const { execSync } = require('child_process');
   const fs = require('fs');
   const path = require('path');
   const os = require('os');
   ```

6. **Synchronous, top-level — no async, no detached spawn.** Per research §Open Question #2, the dogfood "fork" means "derivative", not subprocess. The original PAN hook spawns a detached background child for non-blocking; the dogfood script intentionally simplifies to synchronous so the demonstration is testable and observable in one process.

7. **Do NOT** install or modify any files in `~/.claude/`. The script writes only to whoocache's directory (`~/.whoocache/pan-update/` by default, or `$WHOOCACHE_DIR/pan-update/` if set).

8. **DO** support `WHOOCACHE_DIR` env var override for testing — passed through `createCache` via `cacheDir`:
   ```js
   const cacheDir = process.env.WHOOCACHE_DIR || undefined;
   const cache = createCache('pan-update', { maxEntries: 10, cacheDir });
   ```
   This lets the verify step run the script against a tmp dir without touching the real `~/.whoocache/pan-update/`.

Target file size: 50-90 lines including imports, comments, and blank lines.
  </action>
  <verify>
    <automated tier="T2">node -e "
      const { spawnSync } = require('child_process');
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const dir = path.join(os.tmpdir(), 'whoo-dogfood-' + Date.now());
      fs.mkdirSync(dir, { recursive: true });
      const env = { ...process.env, WHOOCACHE_DIR: dir };
      // First run: should be a MISS
      const r1 = spawnSync(process.execPath, ['dogfood/pan-check-update.js'], { env, encoding: 'utf8', timeout: 15000 });
      if (r1.status !== 0) { console.error('first run failed', r1.stderr); process.exit(1); }
      if (!r1.stdout.includes('CACHE MISS')) { console.error('expected CACHE MISS on first run, got:', r1.stdout); process.exit(1); }
      // Second run within TTL: should be a HIT
      const r2 = spawnSync(process.execPath, ['dogfood/pan-check-update.js'], { env, encoding: 'utf8', timeout: 15000 });
      if (r2.status !== 0) { console.error('second run failed', r2.stderr); process.exit(1); }
      if (!r2.stdout.includes('CACHE HIT')) { console.error('expected CACHE HIT on second run, got:', r2.stdout); process.exit(1); }
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('Dogfood hit/miss OK');
    "</automated>
  </verify>
  <done>dogfood/pan-check-update.js exists. First run against a fresh `WHOOCACHE_DIR` prints `CACHE MISS` and stores the entry. Second run within the 1-hour TTL prints `CACHE HIT`. Both runs exit 0. Script does not write to `~/.claude/` or any production path when WHOOCACHE_DIR is set.</done>
</task>

<task type="auto">
  <name>Task 2: Implement dogfood/parallel-test.js (DOG-03)</name>
  <files>dogfood/parallel-test.js</files>
  <action>
Create `dogfood/parallel-test.js` — a standalone driver (NOT a node:test file) that forks two children doing 1000 sets each into the same cache and audits the resulting index for consistency. Closely follow the structure in research §Dogfood Parallel Audit.

**Line 1:** `#!/usr/bin/env node`
**Line 2:** `'use strict';`

**Required behavior:**

1. **Imports:**
   ```js
   const { fork } = require('child_process');
   const path = require('path');
   const os = require('os');
   const fs = require('fs');
   const crypto = require('crypto');
   const { createCache } = require('../src/cache');
   ```

2. **Constants:**
   ```js
   const WRITERS = 2;
   const WRITES_PER_WRITER = 1000;
   ```

3. **Set up shared cacheDir:**
   ```js
   const id = crypto.randomBytes(4).toString('hex');
   const cacheDir = path.join(os.tmpdir(), `whoocache-dogfood-${id}`);
   fs.mkdirSync(cacheDir, { recursive: true });
   console.log(`Dogfood parallel test: ${WRITERS} writers × ${WRITES_PER_WRITER} sets = ${WRITERS * WRITES_PER_WRITER} total`);
   console.log(`Cache dir: ${cacheDir}`);
   ```

4. **Resolve child script path (reuse existing fixture):**
   ```js
   const CHILD_SCRIPT = path.join(__dirname, '..', 'test', 'helpers', 'child-writer.js');
   ```
   Do NOT copy or duplicate the child-writer logic. The Phase 2 fixture already supports `WRITES` env var (verified in test/helpers/child-writer.js).

5. **Fork two children with WRITES=1000:**
   ```js
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

6. **Audit on completion (CRITICAL — `maxEntries: 5000` per research §Pitfall 4):**

   When both children signal done, open the cache and check every expected key. Use `maxEntries: 5000` (NOT the default 1000) so eviction does not mask lost writes:

   ```js
   let done = 0;
   function onWriterDone() {
     done++;
     if (done === WRITERS) {
       try {
         const cache = createCache('concurrency-test', { cacheDir, maxEntries: 5000 });
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
         try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch {}
       }
     }
   }
   ```

   **Why `maxEntries: 5000` for the audit reader, not just the writers:** Even though the writers (test/helpers/child-writer.js) use the default 1000 entry cap, opening the cache during audit with a higher cap doesn't add capacity retroactively (entries are already evicted if they were going to be) — it does, however, document the intent and matches the cap the writers SHOULD have used. The Phase 2 child-writer.js does NOT set maxEntries, so it inherits the default 1000. **Two options here, choose option A:**
     - **Option A (locked — preferred):** The dogfood test reuses Phase 2's existing fixture as-is. With default `maxEntries: 1000`, the writers WILL evict ~1000 entries. The audit then expects only ~1000 unique keys present — NOT all 2000. **This means the audit logic above must be adapted:** instead of asserting all 2000 keys present, assert that NO unexpected keys exist AND that the index is parseable AND that `cache.get()` works for all listed keys (no ENOENT). Specifically the audit becomes: (a) the index must be parseable (createCache must not throw), (b) every listed key must `get()` to its expected value (no phantom misses), (c) the total number of listed keys is at most `WRITERS * WRITES_PER_WRITER` and at least `maxEntries - WRITERS` (allowing for in-flight evictions). This is the "consistent index with zero lost writes" interpretation — "lost write" means a write that succeeded but produced index corruption, not a write that was correctly evicted.

   **REVISED audit (use this instead of the strict 2000-key check):**
   ```js
   const cache = createCache('concurrency-test', { cacheDir });  // default maxEntries=1000 matches writers
   const listed = cache.list();
   let valueErrors = 0;
   for (const entry of listed) {
     const expected = `value-${entry.key.match(/^writer-(\d+)-key-(\d+)$/)[1]}-${entry.key.match(/^writer-(\d+)-key-(\d+)$/)[2]}`;
     const actual = cache.get(entry.key);
     if (actual !== expected) { console.error(`CORRUPT: ${entry.key} → ${actual} (expected ${expected})`); valueErrors++; }
   }
   if (valueErrors === 0 && listed.length > 0) {
     console.log(`PASS: index consistent, ${listed.length} entries (of ${WRITERS * WRITES_PER_WRITER} attempted), all values correct, zero lost writes`);
     process.exitCode = 0;
   } else if (valueErrors > 0) {
     console.error(`FAIL: ${valueErrors} corrupt values (lost or torn writes)`);
     process.exitCode = 1;
   } else {
     console.error(`FAIL: index empty after ${WRITERS * WRITES_PER_WRITER} writes`);
     process.exitCode = 1;
   }
   ```

   This audit is what roadmap SC-4 means by "consistent index with zero lost writes": every entry the index claims exists must `get()` correctly. The library's eviction behavior under the default maxEntries=1000 is not a "lost write" — it's the documented LRU behavior already verified in Phase 2 TEST-08.

7. **Top-level orchestration:** the audit `onWriterDone()` is the program's "main." After spawning the children, the script's main thread returns; node keeps running until both child handlers fire and cleanup completes. **Do NOT** call `process.exit()` at the end — let the event loop drain.

8. **Do NOT** modify `test/helpers/child-writer.js`. It is read-only here. The fixture already accepts `WRITES` env var (confirmed via inspection: line 10 reads `parseInt(process.env.WRITES || '50', 10)`).

Target file size: 60-100 lines.
  </action>
  <verify>
    <automated tier="T3">node dogfood/parallel-test.js</automated>
  </verify>
  <done>`node dogfood/parallel-test.js` exits 0 and prints `PASS: index consistent, N entries ... all values correct, zero lost writes`. Test cleans up its tmp directory. Re-running multiple times always passes (no flakiness from the existing Phase 2 lock implementation).</done>
</task>

</tasks>

<verification>
After both tasks complete:

1. **Hit/miss demonstration:**
   ```
   WHOOCACHE_DIR=/tmp/whoo-dog node dogfood/pan-check-update.js
   # → prints CACHE MISS line; exits 0
   WHOOCACHE_DIR=/tmp/whoo-dog node dogfood/pan-check-update.js
   # → prints CACHE HIT line; exits 0
   ```

2. **Parallel audit passes:**
   ```
   node dogfood/parallel-test.js
   # → prints "PASS: index consistent, N entries ..., zero lost writes"; exits 0
   ```

3. **Existing tests still pass:** `node --test test/*.test.js` — no regression in Phase 1+2 suite. (This plan does not modify src/ or test/, so this is just a sanity check.)

4. **No package.json changes:** `git diff package.json` is empty after this plan (Plan 03-01 owns package.json modifications).

5. **dogfood/ is not in `files` field:** `node -e "console.log(require('./package.json').files)"` shows only `['src/', 'README.md']` — dogfood is not published to npm. (This is enforced by Plan 03-01's package.json which already excludes it; this plan must NOT add it.)
</verification>

<success_criteria>
- [ ] dogfood/pan-check-update.js exists, uses createCache('pan-update', {maxEntries: 10}) (DOG-01)
- [ ] First run prints CACHE MISS and caches result; second run prints CACHE HIT (DOG-02)
- [ ] dogfood/parallel-test.js exists and forks two children running test/helpers/child-writer.js with WRITES=1000 (DOG-03)
- [ ] Audit reads back every listed key and confirms value correctness (zero corrupt/torn writes) (DOG-03)
- [ ] `node dogfood/parallel-test.js` exits 0 with PASS line on a typical 4-CPU machine
- [ ] Roadmap success criterion #3 (cached version returned within TTL) verified
- [ ] Roadmap success criterion #4 (parallel-process test consistent, zero lost writes) verified
- [ ] No regression to existing Phase 1+2 test suite
- [ ] dogfood/ files are NOT added to package.json `files` (stays out of npm publish)
</success_criteria>

<output>
After completion, create `.planning/phases/03-cli-dogfood/03-02-dogfood-pan-update-summary.md` documenting:
- Files created (dogfood/pan-check-update.js, dogfood/parallel-test.js)
- Wall-clock duration of `node dogfood/parallel-test.js` on the dev machine (informational — not a gate)
- Final entry count surviving in the audit (informational — depends on default maxEntries=1000 vs 2000 attempted)
- Any deviations from research recommendations (with reasoning) — particularly around the audit interpretation of "lost write" vs "evicted entry"
- Confirmation: roadmap success criteria #3 and #4 verified end-to-end
</output>
