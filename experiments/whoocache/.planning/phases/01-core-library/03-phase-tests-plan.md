---
phase: 01-core-library
plan: 03
type: execute
wave: 3
depends_on: ["01-core-library-02"]
files_modified:
  - test/phase1.test.js
autonomous: true
requirements:
  - TEST-02
  - TEST-03
  - TEST-04
  - TEST-10
  - TEST-11
  - TEST-12
  - TEST-13

must_haves:
  truths:
    - "`node --test test/phase1.test.js` exits 0"
    - "Test 1 covers TEST-02: get on a fresh cache returns undefined for any key"
    - "Test 2 covers TEST-03: set/get round-trips a UTF-8 string and includes input-validation assertions (API-07, API-08)"
    - "Test 3 covers TEST-04: TTL boundary at-or-after expires_at (now-1ms expired, now+1ms not — both via pure isExpired and via integration sleep)"
    - "Test 4 covers TEST-10: namespace 'a' and namespace 'b' have isolated state (set in a does not appear in b)"
    - "Test 5 covers TEST-11: Buffer round-trip is byte-exact (set Buffer, get back same bytes)"
    - "Test 6 covers TEST-12: ttlMs=0 expires immediately; ttlMs=Infinity never expires; ttlMs=undefined never expires; ttlMs<0 throws RangeError"
    - "Test 7 covers TEST-13: clear() empties target namespace; entries in another namespace are untouched"
    - "Test 8 (graceful-leftover-tmp): a cache opened with a pre-existing leftover .tmp file in tmp/ does not throw and serves get/set normally (Phase 1 partial coverage of Phase Success Criterion 4)"
    - "Test runner exits 0; full suite (`node --test test/*.test.js`) is green"
  artifacts:
    - path: "test/phase1.test.js"
      provides: "All 7 Phase 1 TEST-XX scenarios + 1 graceful-startup test"
      min_lines: 200
  key_links:
    - from: "test/phase1.test.js"
      to: "src/cache.js"
      via: "createCache(...) is the only entry point exercised"
      pattern: "createCache\\("
    - from: "test/phase1.test.js"
      to: "test/helpers/tmp-namespace.js"
      via: "Every test uses createTmpNamespace + cleanupTmpNamespace for isolation"
      pattern: "createTmpNamespace\\("
---

<objective>
Author the 7 Phase 1 tests required by the phase success criteria (one per `TEST-XX` requirement) plus one extra "graceful startup with leftover tmp" test that gives partial coverage of Phase Success Criterion 4 (crash recovery — full coverage lands in Phase 2). All tests live in a single file `test/phase1.test.js` for simplicity, run via `node --test`.

Purpose: Prove the public API contract built in Plan 02 actually meets every Phase 1 requirement. This plan does NOT modify any `src/` file — if a test fails, the bug is in Plan 02's implementation and that plan must be revised.

Output: One `test/phase1.test.js` file with 7 mandatory TEST-XX tests + 1 supplementary leftover-tmp test, all passing under `node --test`.
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
@.planning/phases/01-core-library/01-scaffold-foundations-summary.md
@.planning/phases/01-core-library/02-composition-summary.md

<interfaces>
<!-- Public surface from Plan 02 — exact contract being tested -->

const { createCache, LockTimeoutError, CorruptIndexError, StaleIndexError, CachePermissionError } = require('whoocache');

createCache(namespace: string, opts?: {
  cacheDir?: string,                    // default ~/.whoocache/<namespace>
  maxBytes?: number,                    // default 50 MB; not enforced in Phase 1
  maxEntries?: number,                  // default 1000; not enforced in Phase 1
  clockSkewToleranceMs?: number,        // default 5000
}) => instance

instance.get(key)                       // → string | Buffer | undefined
instance.set(key, value, {ttlMs?})      // void; throws TypeError on bad value/key, RangeError on negative ttl
instance.delete(key)                    // → boolean (true if entry existed)
instance.list({includeExpired?})        // → Array<{key, size, expires_at, last_access}>
instance.clear()                        // void
instance._internal                      // { cacheDir, indexPath, lockPath, tmpDir, objectsDir, maxBytes, maxEntries, skewMs }

<!-- Test helper from Plan 01 -->

const { createTmpNamespace, cleanupTmpNamespace } = require('./helpers/tmp-namespace');
createTmpNamespace(label) → { nsName, cacheDir }
cleanupTmpNamespace(cacheDir) → void
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author all 8 Phase 1 tests in test/phase1.test.js</name>
  <files>test/phase1.test.js</files>
  <action>
Create the single Phase 1 test file containing 8 tests. Use `node:test` and `node:assert/strict`. Every test creates a fresh tmp namespace and cleans up at the end — even on assertion failure, by passing the cacheDir into a `t.after(...)` hook OR by wrapping in try/finally.

**Boilerplate at the top:**
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createCache, LockTimeoutError } = require('../src/cache');
const { createTmpNamespace, cleanupTmpNamespace } = require('./helpers/tmp-namespace');

// Helper: build a fresh cache instance against an isolated tmp cacheDir.
// Returns { cache, cacheDir, nsName } — caller is responsible for cleanupTmpNamespace.
function freshCache(label = 'phase1', opts = {}) {
  const { nsName, cacheDir } = createTmpNamespace(label);
  const cache = createCache(nsName, { cacheDir, ...opts });
  return { cache, cacheDir, nsName };
}
```

**Test 1 — TEST-02: get-miss returns undefined (also covers basic API-08 input validation):**
```js
test('TEST-02: get on a fresh cache returns undefined for any key', () => {
  const { cache, cacheDir } = freshCache('miss');
  try {
    assert.strictEqual(cache.get('does-not-exist'), undefined);
    assert.strictEqual(cache.get('also-not-here'), undefined);
    // API-08: invalid key types throw
    assert.throws(() => cache.get(''), TypeError);
    assert.throws(() => cache.get(null), TypeError);
    assert.throws(() => cache.get(42), TypeError);
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

**Test 2 — TEST-03: set/get round-trip + input validation (API-07/08):**
```js
test('TEST-03: set-then-get round-trips a UTF-8 string; rejects invalid inputs', () => {
  const { cache, cacheDir } = freshCache('roundtrip');
  try {
    cache.set('greeting', 'hello world');
    assert.strictEqual(cache.get('greeting'), 'hello world');
    // Idempotent reads
    assert.strictEqual(cache.get('greeting'), 'hello world');
    // Multi-byte UTF-8
    cache.set('jp', 'こんにちは');
    assert.strictEqual(cache.get('jp'), 'こんにちは');

    // API-07: non-string-non-Buffer values throw TypeError
    assert.throws(() => cache.set('k', 123), TypeError);
    assert.throws(() => cache.set('k', { a: 1 }), TypeError);
    assert.throws(() => cache.set('k', null), TypeError);
    assert.throws(() => cache.set('k', undefined), TypeError);
    // API-08: empty/non-string key
    assert.throws(() => cache.set('', 'v'), TypeError);
    assert.throws(() => cache.set(null, 'v'), TypeError);
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

**Test 3 — TEST-04: TTL boundary (pure-function check + integration sleep):**
```js
test('TEST-04: TTL boundary — at-or-after expires_at is expired', async () => {
  const { isExpired } = require('../src/ttl');
  // Pure-function boundary check (deterministic, no sleep)
  assert.strictEqual(isExpired({ expires_at: 1000 }, 999), false);   // before → fresh
  assert.strictEqual(isExpired({ expires_at: 1000 }, 1000), true);   // exact → expired
  assert.strictEqual(isExpired({ expires_at: 1000 }, 1001), true);   // after → expired

  // Integration check: set with short TTL, sleep, verify miss
  const { cache, cacheDir } = freshCache('ttl-boundary');
  try {
    cache.set('eph', 'soon-gone', { ttlMs: 50 });
    assert.strictEqual(cache.get('eph'), 'soon-gone');  // within window
    await sleep(120);                                    // safely past expiry
    assert.strictEqual(cache.get('eph'), undefined);     // after → undefined
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

**Test 4 — TEST-10: namespace isolation:**
```js
test('TEST-10: namespace isolation — set in A does not affect B', () => {
  const a = createTmpNamespace('iso-a');
  const b = createTmpNamespace('iso-b');
  const cacheA = createCache(a.nsName, { cacheDir: a.cacheDir });
  const cacheB = createCache(b.nsName, { cacheDir: b.cacheDir });
  try {
    cacheA.set('shared-key', 'value-from-a');
    assert.strictEqual(cacheA.get('shared-key'), 'value-from-a');
    assert.strictEqual(cacheB.get('shared-key'), undefined);
    cacheB.set('shared-key', 'value-from-b');
    assert.strictEqual(cacheA.get('shared-key'), 'value-from-a');
    assert.strictEqual(cacheB.get('shared-key'), 'value-from-b');
  } finally {
    cleanupTmpNamespace(a.cacheDir);
    cleanupTmpNamespace(b.cacheDir);
  }
});
```

**Test 5 — TEST-11: binary value byte-exact round-trip:**
```js
test('TEST-11: binary value (Buffer) round-trip is byte-exact', () => {
  const { cache, cacheDir } = freshCache('binary');
  try {
    const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x01, 0x80, 0x7f, 0xc0, 0x00, 0x42]);
    cache.set('blob', bytes);
    const out = cache.get('blob');
    assert.ok(Buffer.isBuffer(out), 'expected Buffer return when stored as Buffer');
    assert.deepStrictEqual(Array.from(out), Array.from(bytes));
    assert.strictEqual(out.length, bytes.length);
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

**Test 6 — TEST-12: TTL edge values (0, Infinity, undefined, negative):**
```js
test('TEST-12: ttlMs=0 expires immediately; Infinity/undefined never; negative throws', async () => {
  const { cache, cacheDir } = freshCache('ttl-edges');
  try {
    // ttlMs=0 → expires_at = now + 0 = now → at-or-after now → expired immediately
    cache.set('zero', 'gone', { ttlMs: 0 });
    assert.strictEqual(cache.get('zero'), undefined);

    // ttlMs=Infinity → expires_at: null → never expires
    cache.set('inf', 'forever', { ttlMs: Infinity });
    assert.strictEqual(cache.get('inf'), 'forever');

    // ttlMs=undefined → expires_at: null → never expires
    cache.set('none', 'forever-too');
    assert.strictEqual(cache.get('none'), 'forever-too');

    // ttlMs=-1 → RangeError
    assert.throws(() => cache.set('bad', 'x', { ttlMs: -1 }), RangeError);
    assert.throws(() => cache.set('bad', 'x', { ttlMs: -0.5 }), RangeError);
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

**Test 7 — TEST-13: clear() removes all entries from target namespace, no others:**
```js
test('TEST-13: clear() empties target namespace; other namespaces untouched', () => {
  const a = createTmpNamespace('clear-a');
  const b = createTmpNamespace('clear-b');
  const cacheA = createCache(a.nsName, { cacheDir: a.cacheDir });
  const cacheB = createCache(b.nsName, { cacheDir: b.cacheDir });
  try {
    cacheA.set('k1', 'v1');
    cacheA.set('k2', 'v2');
    cacheB.set('k3', 'v3');
    assert.strictEqual(cacheA.get('k1'), 'v1');
    assert.strictEqual(cacheA.get('k2'), 'v2');
    assert.strictEqual(cacheB.get('k3'), 'v3');

    cacheA.clear();

    assert.strictEqual(cacheA.get('k1'), undefined);
    assert.strictEqual(cacheA.get('k2'), undefined);
    assert.deepStrictEqual(cacheA.list(), []);
    // B is untouched
    assert.strictEqual(cacheB.get('k3'), 'v3');
    assert.strictEqual(cacheB.list().length, 1);
  } finally {
    cleanupTmpNamespace(a.cacheDir);
    cleanupTmpNamespace(b.cacheDir);
  }
});
```

**Test 8 — Graceful startup with leftover .tmp file (Phase Success Criterion 4 partial):**
```js
test('Phase SC-4 partial: createCache survives a leftover .tmp file in tmp/', () => {
  const { nsName, cacheDir } = createTmpNamespace('leftover');
  // Pre-populate cacheDir/tmp/ with a fake leftover .tmp file (simulates a prior crashed write)
  const tmpDir = path.join(cacheDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const leftover = path.join(tmpDir, 'deadbeefdeadbeef.tmp');
  fs.writeFileSync(leftover, 'partial garbage from a crashed prior process');

  // Constructor must NOT throw, and the cache must work normally afterward.
  // Phase 2 will add real cleanup of the leftover (orphan GC); Phase 1 only requires "no throw".
  let cache;
  try {
    assert.doesNotThrow(() => {
      cache = createCache(nsName, { cacheDir });
    });
    cache.set('k', 'v');
    assert.strictEqual(cache.get('k'), 'v');
  } finally {
    cleanupTmpNamespace(cacheDir);
  }
});
```

**Test count: 8** (7 mandated TEST-XX + 1 graceful-startup). The phase success criterion says "All 7 Phase 1 tests pass" — this is satisfied; the 8th is supplementary.

**Constraints:**
- DO NOT modify any `src/` file from this plan. If a test fails, the bug is in Plan 02 and a revision plan or gap-closure plan must fix it there.
- DO NOT skip cleanup — every test cleans its tmp namespace via try/finally. Test isolation matters: leaked tmp dirs accumulate under `os.tmpdir()/whoocache-test/` and pollute future test runs.
- DO NOT use `setTimeout(fn, ms)` callbacks in async tests — use `await sleep(ms)` from `node:timers/promises` (the `sleep` import shown above).
- DO NOT add a "performance" test (PERF-01..04 are Phase 2). DO NOT add a multi-process test (TEST-08 / CONC-08 are Phase 2).
- DO use `assert.strictEqual` for primitives and `assert.deepStrictEqual` for arrays/objects/Buffers (per node:assert/strict semantics).
- DO order tests roughly in dependency order: simpler invariants first (TEST-02, TEST-03), then time-dependent (TEST-04, TEST-12), then multi-namespace (TEST-10, TEST-13), then crash-leftover (Test 8).

**Note on STOR-08 / Test 5 implementation choice:**
Plan 02 stores raw bytes on disk and tracks via the `encoding` flag (`'utf8'` for strings, `'binary'` for Buffers — revision 1 renamed from `'base64'` to match the actual on-disk format) what type to return. Test 5 verifies byte-exact round-trip — it does NOT verify the on-disk format or the encoding flag value. If the executor implements Plan 02 with literal base64-string-on-disk (an alternate interpretation), Test 5 still passes. The only requirement is `Buffer.isBuffer(cache.get(key))` and the bytes match.
  </action>
  <verify>
    <automated>node --test test/phase1.test.js</automated>
    Expected: 8 tests pass, 0 fail. Output should include `# pass 8` near the end.
  </verify>
  <done>
- `test/phase1.test.js` exists with 8 tests (7 mandated TEST-XX + 1 graceful-leftover).
- Each test uses `createTmpNamespace` for isolation and cleans up via try/finally.
- `node --test test/phase1.test.js` exits 0 with `# pass 8`.
- Each requirement TEST-02, TEST-03, TEST-04, TEST-10, TEST-11, TEST-12, TEST-13 is covered by exactly one test (cross-reference via test name prefix).
  </done>
</task>

<task type="auto">
  <name>Task 2: Run the full Phase 1 test suite — gate green</name>
  <files>(none modified — verification gate only)</files>
  <action>
Run the full Phase 1 test suite (foundation micro-tests + composition unit tests + 8 phase tests). Confirm everything passes together. This is the Phase 1 success criterion 5: "All 7 Phase 1 tests pass under `node --test` on Linux Node 22."

Run command:
```bash
node --test test/*.test.js
```

Expected output (approximate):
```
✔ test/atomic-write.test.js
✔ test/errors.test.js
✔ test/index-file.test.js
✔ test/keys.test.js
✔ test/phase1.test.js
✔ test/ttl.test.js
# tests <total>
# suites 0
# pass <total>
# fail 0
```

Total tests across all files: ~30+ (ttl ~10, index-file ~6, keys ~5, atomic-write ~5, errors ~4, phase1 8). The exact count is not load-bearing — what matters is `# fail 0`.

If any test fails:
1. Read the failure output carefully — `node --test` prints the failing assertion + stack.
2. The bug is almost certainly in Plan 02's implementation (Plan 03 only writes tests against the documented contract).
3. Open a gap-closure plan or revision against Plan 02. Do NOT silently weaken the test to make it pass.

If everything green: this plan is done. Phase 1 is complete; the orchestrator can move to verification (`/pan:verify-phase`) and then Phase 2.

**Optional: also confirm `require('whoocache')` works from a sibling CommonJS file (API-09 sanity):**
```bash
node -e "const w = require('./'); const c = w.createCache('cjs-smoke', {cacheDir: require('os').tmpdir() + '/cjs-smoke-' + process.pid}); c.set('k','v'); console.log(c.get('k') === 'v' ? 'API-09 ok' : 'FAIL'); require('fs').rmSync(c._internal.cacheDir, {recursive:true, force:true});"
```
Expected output: `API-09 ok`. This proves the package's `main` field resolves correctly.
  </action>
  <verify>
    <automated>node --test test/*.test.js</automated>
    AND
    <automated>node -e "const w = require('./'); if (typeof w.createCache !== 'function') process.exit(1); console.log('CJS export ok')"</automated>
  </verify>
  <done>
- `node --test test/*.test.js` exits 0 with zero failures.
- `require('./')` from the repo root returns an object with `createCache` as a function (API-09 verified).
- All Phase 1 success criteria met:
  1. `createCache('my-ns')` on a new machine returns instance without throwing — Test 1, Test 2, Test 8
  2. `set` with TTL → `get` returns value within window, undefined after — Test 3, Test 6
  3. Non-string value → TypeError; non-string/empty key → TypeError; ttlMs<0 → RangeError — Test 2, Test 6
  4. After simulated crash (leftover .tmp), next createCache opens cleanly — Test 8
  5. All 7 Phase 1 tests pass — confirmed by Task 1 and this gate
  </done>
</task>

</tasks>

<verification>
The whole-phase verification command:

```bash
node --test test/*.test.js
```

Must exit 0 with zero failures. This is the Phase 1 gate — without it, Phase 2 cannot start (per the roadmap's correctness gate).

Per-test mapping back to requirements (cross-reference for the checker):

| TEST-XX requirement | Phase 1 test name (Test #) |
|---------------------|----------------------------|
| TEST-02 | Test 1: `TEST-02: get on a fresh cache returns undefined for any key` |
| TEST-03 | Test 2: `TEST-03: set-then-get round-trips a UTF-8 string; rejects invalid inputs` |
| TEST-04 | Test 3: `TEST-04: TTL boundary — at-or-after expires_at is expired` |
| TEST-10 | Test 4: `TEST-10: namespace isolation — set in A does not affect B` |
| TEST-11 | Test 5: `TEST-11: binary value (Buffer) round-trip is byte-exact` |
| TEST-12 | Test 6: `TEST-12: ttlMs=0 expires immediately; Infinity/undefined never; negative throws` |
| TEST-13 | Test 7: `TEST-13: clear() empties target namespace; other namespaces untouched` |

Phase Success Criteria → Test:
- SC-1 (createCache works on fresh machine) — covered by every test (`createTmpNamespace` always produces a fresh dir) and explicitly by Test 8
- SC-2 (TTL within window/after) — Test 3
- SC-3 (input validation) — Tests 1, 2, 6
- SC-4 (post-crash open works) — Test 8 (partial; full crash test is Phase 2)
- SC-5 (all 7 tests pass) — Tests 1–7
</verification>

<success_criteria>
- `test/phase1.test.js` exists with 8 tests covering TEST-02, TEST-03, TEST-04, TEST-10, TEST-11, TEST-12, TEST-13 + a graceful-leftover-tmp test.
- Every test uses `createTmpNamespace` for isolation and cleans up via try/finally.
- `node --test test/*.test.js` exits 0 with zero failures (full Phase 1 suite green).
- `require('./')` returns the public surface (`createCache` + 4 error classes) — API-09 confirmed.
- All 5 Phase 1 success criteria observable as TRUE.
</success_criteria>

<output>
After completion, create `.planning/phases/01-core-library/03-phase-tests-summary.md` documenting:
- Final test count (per file) and total
- Mapping table (TEST-XX → test name)
- Any test that was tricky to author or revealed a Plan 02 bug
- Confirmation Phase 1 is complete and ready for `/pan:verify-phase`
</output>
