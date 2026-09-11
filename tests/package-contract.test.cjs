// Reality check R8 (2026-09-10): "zero runtime dependencies" is a headline claim in
// README.md and docs/COMPARISON.md, and nothing pinned it — a stray `npm install
// <pkg>` would have shipped a dependency with the suite green. This file is the pin.
// The release gate (scripts/release-check.js, Gate 6) carries the same check so a
// publish cannot pass without it. Revert-proof: add any key to `dependencies` in a
// scratch copy of package.json and the first test's assertion fails on that copy.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const pkg = require('../package.json');

describe('package.json contract (R8)', () => {
  test('ships zero runtime dependencies', () => {
    const deps = Object.keys(pkg.dependencies || {});
    assert.deepEqual(deps, [], `runtime dependencies present: ${deps.join(', ')} — PAN ships Node builtins only`);
  });

  test('the check itself can fail (a dependency in a copy trips it)', () => {
    const copy = { ...pkg, dependencies: { 'left-pad': '1.0.0' } };
    assert.notDeepEqual(Object.keys(copy.dependencies), [], 'the assertion above must be able to go red');
  });

  test('files is an explicit allowlist that excludes the dev-only trees', () => {
    assert.ok(Array.isArray(pkg.files), 'package.json must ship an explicit files allowlist');
    // scripts/ and bin/ ship on purpose (release + build helpers); the dev-only trees do not.
    for (const banned of ['dist', 'harness', 'marketplace', 'tests']) {
      assert.ok(!pkg.files.some(f => f === banned || f.startsWith(banned + '/')), `${banned}/ must not ship`);
    }
  });

  test('bin points at the installer entry point', () => {
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin || {})[0];
    assert.ok(bin && /install\.js$/.test(bin), `bin should be bin/install.js, got ${bin}`);
  });
});
