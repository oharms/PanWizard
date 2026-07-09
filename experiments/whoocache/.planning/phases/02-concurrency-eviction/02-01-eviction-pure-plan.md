---
phase: 02-concurrency-eviction
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/eviction.js
  - test/eviction.test.js
autonomous: true
requirements: [EVIC-01, EVIC-02, EVIC-05, EVIC-06, PERF-03]
change_class: feature

must_haves:
  truths:
    - "evictUntilUnderCap returns the input entries unchanged when projectedBytes <= maxBytes AND projectedCount <= maxEntries"
    - "evictUntilUnderCap removes oldest-by-last_access entries until BOTH caps satisfied (dual-cap discipline)"
    - "evictUntilUnderCap with maxEntries=1000 and currentCount=1000 returns exactly 1 evicted key for a 1-byte newEntry (no off-by-one)"
    - "totalBytes returns 0 for empty entries object and the integer sum of size fields otherwise"
    - "src/eviction.js requires only Node builtins; no fs / no path / no I/O — pure"
    - "Sorting + eviction over 1000 entries completes in < 50ms (PERF-03)"
  artifacts:
    - path: "src/eviction.js"
      provides: "Pure LRU eviction module (evictUntilUnderCap, totalBytes)"
      exports: ["evictUntilUnderCap", "totalBytes"]
      min_lines: 40
    - path: "test/eviction.test.js"
      provides: "Unit tests for EVIC-01, EVIC-02, EVIC-05, PERF-03"
      contains: "evictUntilUnderCap"
      min_lines: 80
  key_links:
    - from: "test/eviction.test.js"
      to: "src/eviction.js"
      via: "require('../src/eviction')"
      pattern: "require.*src/eviction"
    - from: "src/eviction.js"
      to: "[no I/O imports]"
      via: "negative assertion"
      pattern: "^(?!.*require\\(['\"]fs).*$"

### Test Tier Strategy
| Tier | Tests | Rationale |
|------|-------|-----------|
| T1   | 7 unit tests in test/eviction.test.js | Pure functions, no I/O — EVIC-06 enforces this |
---

<objective>
Create `src/eviction.js` as a pure-function module implementing LRU eviction with dual-cap (maxBytes + maxEntries) discipline using the "make room before insert" pattern (EVIC-05). Cover the requirements with unit tests in `test/eviction.test.js` that run without filesystem setup.

Purpose: Phase 2 requires LRU eviction logic, but it must be I/O-free so it can be unit-tested in isolation and reused by `cache.js` inside the lock without I/O reentry. This plan builds the pure-function brick. Plan 03 wires it into `cache.js`.

Output:
- `src/eviction.js` — exports `evictUntilUnderCap(entries, maxBytes, maxEntries, newEntrySize)` and `totalBytes(entries)`
- `test/eviction.test.js` — 6+ unit tests proving EVIC-01, EVIC-02, EVIC-05, EVIC-06, PERF-03
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
@src/ttl.js
@src/index-file.js

<interfaces>
<!-- The shape of an index entry. Phase 1 cache.js writes these fields; eviction.js MUST honor them. -->
<!-- Source: src/cache.js doSet (lines 140-148) and the JSON schema in research/architecture.md. -->

```js
// IndexEntry shape (in idx.entries[key]):
// {
//   file: string,           // 64-hex sha256 filename
//   size: number,           // bytes-on-disk (raw, not base64) — use this for byte-cap math
//   created_at: number,     // ms-since-epoch
//   last_access: number,    // ms-since-epoch — SORT KEY for LRU
//   expires_at: number|null,// ms-since-epoch or null=never
//   encoding: 'utf8'|'binary',
//   tombstone?: boolean,    // Phase 2 PLAT-03 — Plan 03 will introduce; ignore in Plan 01
// }
```

<!-- Pattern from src/ttl.js shows the project convention for pure modules: -->
<!--   - 'use strict' at top -->
<!--   - no Date.now() (caller passes nowMs) -->
<!--   - no fs, no path, no crypto imports -->
<!--   - module.exports = { fnA, fnB } at bottom -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create src/eviction.js pure module</name>
  <files>src/eviction.js</files>
  <action>
Create `src/eviction.js` with `'use strict';` at the top and NO `require('fs')`, NO `require('path')`, NO `require('crypto')` — zero I/O imports (EVIC-06).

Export two pure functions matching the research-locked signatures:

```js
'use strict';

/**
 * Sum of size fields across all entries.
 * Phase 2 Plan 03 may filter tombstoned entries before passing in;
 * this function does NOT filter — it sums every entry it receives.
 * @param {Object<string, {size:number}>} entries
 * @returns {number} total bytes
 */
function totalBytes(entries) {
  let total = 0;
  for (const e of Object.values(entries)) total += e.size;
  return total;
}

/**
 * Make-room-before-insert LRU eviction (EVIC-05).
 * Evicts oldest-by-last_access entries until BOTH caps are satisfied for the
 * projected post-insert state.
 *
 * Caller MUST call purgeLazy() (TTL purge) before calling this so that expired
 * entries don't inflate the LRU sort (EVIC-03 ordering — enforced by Plan 03 cache.js).
 *
 * @param {Object<string, {size:number, last_access:number}>} entries  - already TTL-purged
 * @param {number} maxBytes
 * @param {number} maxEntries
 * @param {number} newEntrySize - bytes the caller is about to add (>= 0)
 * @returns {{ kept: Object, evicted: string[] }}
 *   kept: NEW object containing surviving entries (input entries is NOT mutated)
 *   evicted: array of keys removed (caller deletes their value files AFTER index commit)
 */
function evictUntilUnderCap(entries, maxBytes, maxEntries, newEntrySize) {
  const currentBytes = totalBytes(entries);
  const currentCount = Object.keys(entries).length;

  // EVIC-05: project the post-insert state and evict only if it would exceed a cap.
  let projectedBytes = currentBytes + newEntrySize;
  let projectedCount = currentCount + 1;

  if (projectedBytes <= maxBytes && projectedCount <= maxEntries) {
    return { kept: { ...entries }, evicted: [] };
  }

  // EVIC-01/02: oldest-by-last_access first.
  // Stable sort — entries with identical last_access keep insertion order.
  const sorted = Object.entries(entries)
    .sort(([, a], [, b]) => a.last_access - b.last_access);

  const kept = Object.fromEntries(sorted);
  const evicted = [];

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

Constraints (verified by Plan-checker and tests):
- File must NOT contain `require('fs')`, `require('path')`, `require('node:fs')` — EVIC-06 purity gate.
- Function must NOT mutate the input `entries` object (the test will pass a frozen object and assert no throw).
- `evicted` must be sorted by `last_access` ascending (oldest first).
  </action>
  <verify>
    <automated tier="T1">node -e "const m = require('./src/eviction'); if (typeof m.evictUntilUnderCap !== 'function' || typeof m.totalBytes !== 'function') process.exit(1);"</automated>
    <automated tier="T1">node -e "const fs=require('fs'); const src=fs.readFileSync('./src/eviction.js','utf8'); if (/require\(['\"](node:)?fs['\"]\)/.test(src) || /require\(['\"](node:)?path['\"]\)/.test(src)) { console.error('I/O import in eviction.js violates EVIC-06'); process.exit(1); }"</automated>
  </verify>
  <done>src/eviction.js exists, exports evictUntilUnderCap + totalBytes, contains no I/O imports.</done>
</task>

<task type="auto">
  <name>Task 2: Create test/eviction.test.js with unit tests for EVIC-01/02/05 + PERF-03</name>
  <files>test/eviction.test.js</files>
  <action>
Create `test/eviction.test.js` using `node:test` and `node:assert/strict`. The test file must exercise the pure module ONLY — do NOT require `src/cache.js`, do NOT use `createTmpNamespace`, do NOT touch the filesystem.

Required test cases:

1. **`totalBytes` — empty + sum-of-size**
   - `totalBytes({})` returns 0.
   - `totalBytes({ a: { size: 10 }, b: { size: 25 } })` returns 35.

2. **EVIC-01: maxEntries cap evicts oldest by last_access**
   - Build `entries = { k0: {size:1, last_access:100}, k1: {size:1, last_access:200}, k2: {size:1, last_access:300} }`.
   - Call `evictUntilUnderCap(entries, /*maxBytes*/ 1e9, /*maxEntries*/ 3, /*newEntrySize*/ 1)`.
   - Assert: `evicted.length === 1`, `evicted[0] === 'k0'` (oldest), `Object.keys(kept).length === 2`, `'k0' in kept === false`, `'k1' in kept && 'k2' in kept`.

3. **EVIC-02: maxBytes cap evicts until under cap**
   - `entries = { a: {size:50, last_access:100}, b: {size:30, last_access:200}, c: {size:20, last_access:300} }` (total 100).
   - `evictUntilUnderCap(entries, /*maxBytes*/ 60, 1e9, /*newEntrySize*/ 10)` — projected=110, must drop down to <=60.
   - Assert: `evicted` contains `'a'` first (oldest, 50 bytes drops projected to 60), no further eviction needed. So `evicted === ['a']` and `kept = {b,c}` with `totalBytes(kept) === 50` and `50 + 10 === 60 <= 60`.

4. **EVIC-05: no eviction when projected fits both caps**
   - `entries = { x: {size:5, last_access:100} }`.
   - `evictUntilUnderCap(entries, /*maxBytes*/ 100, /*maxEntries*/ 10, /*newEntrySize*/ 5)` — projected (10 bytes, 2 entries) fits both.
   - Assert: `evicted.length === 0`, `Object.keys(kept).length === 1`.
   - Also: result's `kept` is a NEW object (`kept !== entries`) — verify with `Object.isFrozen(entries)` test below.

5. **EVIC-05: off-by-one boundary at maxEntries=1000**
   - Build 1000 entries `k0..k999` each with `size: 1`, `last_access: i`.
   - Call `evictUntilUnderCap(entries, 1e9, 1000, 1)` — projected count = 1001, must evict 1.
   - Assert: `evicted.length === 1`, `evicted[0] === 'k0'`, `Object.keys(kept).length === 999`.
   - Then call again with `evictUntilUnderCap(entries, 1e9, 1000, 0)` (newEntrySize=0) — projected count = 1000, fits; assert `evicted.length === 0`.

6. **Input is not mutated**
   - Build `entries = { a: {size:10, last_access:1}, b: {size:10, last_access:2} }`.
   - `Object.freeze(entries); Object.freeze(entries.a); Object.freeze(entries.b);`
   - Call `evictUntilUnderCap(entries, 5, 1, 0)` (forces eviction) — must NOT throw.
   - Assert: `entries.a.size === 10` and `entries.b.size === 10` and `Object.keys(entries).length === 2`.

7. **PERF-03: 1000-entry eviction pass < 50ms**
   - Build `entries` with 1000 randomly-ordered `last_access` values, all `size: 1024`.
   - Use `const { performance } = require('node:perf_hooks');` then `const t0 = performance.now();` — call `evictUntilUnderCap(entries, 500_000, 1000, 1024)` (forces ~512 evictions). Time the call.
   - Assert: elapsed `< 50` ms.
   - Run the call 5 times in a loop and assert MEDIAN < 50ms (compute median by sorting the 5 timings) — this guards against single-run jitter on busy CI.

Test harness pattern (matches existing test style):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { evictUntilUnderCap, totalBytes } = require('../src/eviction');

test('totalBytes — empty + sum-of-size', () => { /* ... */ });
test('EVIC-01: maxEntries cap evicts oldest by last_access', () => { /* ... */ });
// etc.
```

After authoring, run `node --test test/eviction.test.js` and verify all 7 tests pass before declaring done.
  </action>
  <verify>
    <automated tier="T1">node --test test/eviction.test.js</automated>
  </verify>
  <done>All 7 unit tests pass. PERF-03 timing test reports median < 50ms in stdout.</done>
</task>

</tasks>

<verification>
After both tasks:
1. `node --test test/eviction.test.js` exits 0 with all tests passing.
2. `node --test test/*.test.js` exits 0 — full suite still green (Phase 1 tests unaffected).
3. `node -e "const fs=require('fs'); const s=fs.readFileSync('./src/eviction.js','utf8'); console.log(/require\(['\"](node:)?fs['\"]\)/.test(s) ? 'FAIL: fs imported' : 'OK: pure');"` prints `OK: pure`.
</verification>

<success_criteria>
- src/eviction.js exists with the two exported functions.
- test/eviction.test.js exists with 7 tests covering EVIC-01, EVIC-02, EVIC-05, EVIC-06, PERF-03 plus mutation safety.
- The full test suite still passes (37 existing + 7 new = 44 tests, all green).
- Eviction module contains no I/O imports — purity gate (EVIC-06) holds.
</success_criteria>

<output>
After completion, create `.planning/phases/02-concurrency-eviction/02-01-eviction-pure-summary.md` listing requirements completed (EVIC-01, EVIC-02, EVIC-05, EVIC-06, PERF-03), files created, decisions made, and the test count delta.
</output>
