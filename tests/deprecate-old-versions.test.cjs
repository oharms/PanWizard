/**
 * Release-time deprecation of versions that have fallen behind.
 *
 * The selection rule is PURE, so it is tested here without touching a registry.
 * That matters more than usual: the IO half performs an irreversible-feeling
 * public action, so the decision about WHICH versions it touches must be provable
 * offline before it ever runs with `--apply`.
 *
 * The invariant these exist to protect: **the sweep must never deprecate a version
 * people are meant to be installing.** Everything else is housekeeping.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const dep = require('../scripts/deprecate-old-versions.js');

const REAL = ['3.13.1', '3.20.0', '3.21.0', '3.21.1', '3.22.0', '3.24.0', '3.25.0'];

describe('selectVersionsToDeprecate — the keep window', () => {
  test('keeps the newest N stable releases and deprecates the rest', () => {
    const r = dep.selectVersionsToDeprecate([...REAL, '3.26.0'], '3.26.0', 3);
    assert.deepEqual(r.keep, ['3.24.0', '3.25.0', '3.26.0']);
    assert.deepEqual(r.deprecate, ['3.13.1', '3.20.0', '3.21.0', '3.21.1', '3.22.0']);
  });

  test('the keep window is honoured exactly, not approximately', () => {
    const two = dep.selectVersionsToDeprecate([...REAL, '3.26.0'], '3.26.0', 2);
    assert.deepEqual(two.keep, ['3.25.0', '3.26.0']);
    assert.ok(two.deprecate.includes('3.24.0'), 'keep=2 must release 3.24.0 for deprecation');
    const five = dep.selectVersionsToDeprecate([...REAL, '3.26.0'], '3.26.0', 5);
    assert.equal(five.keep.length, 5);
  });

  test('every deprecated version carries a stated reason', () => {
    const r = dep.selectVersionsToDeprecate([...REAL, '3.26.0'], '3.26.0', 3);
    for (const v of r.deprecate) {
      assert.ok(r.reason[v] && r.reason[v].length > 5, `${v} deprecated with no reason`);
    }
  });
});

describe('selectVersionsToDeprecate — what it must NEVER touch', () => {
  test('never deprecates the version being released', () => {
    // Belt and braces: even with keep=1 and the current version somehow not the
    // newest, it stays protected. Deprecating the release you just shipped would
    // tell every user the thing they were pointed at is dead.
    const r = dep.selectVersionsToDeprecate([...REAL, '3.26.0'], '3.26.0', 1);
    assert.ok(!r.deprecate.includes('3.26.0'));
    assert.ok(r.keep.includes('3.26.0'));

    const odd = dep.selectVersionsToDeprecate(['3.24.0', '3.25.0', '3.26.0'], '3.24.0', 1);
    assert.ok(!odd.deprecate.includes('3.24.0'), 'the current version is protected unconditionally');
  });

  test('is idempotent — an already-deprecated version is not re-issued', () => {
    const already = ['3.13.1', '3.20.0'];
    const r = dep.selectVersionsToDeprecate([...REAL, '3.26.0'], '3.26.0', 3, already);
    for (const v of already) assert.ok(!r.deprecate.includes(v), `${v} should be skipped`);
    assert.deepEqual(r.deprecate, ['3.21.0', '3.21.1', '3.22.0']);
  });

  test('a registry with fewer versions than the window deprecates nothing', () => {
    const r = dep.selectVersionsToDeprecate(['3.25.0', '3.26.0'], '3.26.0', 3);
    assert.deepEqual(r.deprecate, []);
  });

  test('junk versions are ignored rather than throwing or being deprecated', () => {
    const r = dep.selectVersionsToDeprecate(['not-a-version', '', null, '3.25.0', '3.26.0'], '3.26.0', 3);
    assert.deepEqual(r.deprecate, []);
    assert.ok(!r.deprecate.includes('not-a-version'));
  });
});

describe('prerelease handling', () => {
  test('prereleases never occupy a slot in the keep window', () => {
    // If an rc counted as "kept", publishing 3.26.0 after two rcs would protect
    // the rcs and deprecate real releases instead.
    const r = dep.selectVersionsToDeprecate(
      ['3.24.0', '3.25.0', '3.26.0-rc.1', '3.26.0-rc.2', '3.26.0'], '3.26.0', 3);
    assert.deepEqual(r.keep, ['3.24.0', '3.25.0', '3.26.0']);
    assert.ok(r.deprecate.includes('3.26.0-rc.1'));
    assert.ok(r.deprecate.includes('3.26.0-rc.2'));
  });

  test('a prerelease sorts BELOW its release (not equal)', () => {
    // The update-check hook's comparator deliberately ignores the suffix, which
    // would make 3.26.0-rc.1 and 3.26.0 indistinguishable here and could protect
    // an rc while deprecating the release. This comparator must differ.
    const a = dep.parse('3.26.0-rc.1');
    const b = dep.parse('3.26.0');
    assert.ok(dep.compare(a, b) < 0, 'rc must sort below its release');
    assert.ok(dep.compare(dep.parse('3.26.0-rc.1'), dep.parse('3.26.0-rc.2')) < 0);
  });
});

describe('the message', () => {
  test('names a concrete version to move to, not just "upgrade"', () => {
    const m = dep.buildMessage('3.26.0');
    assert.match(m, /3\.26\.0/);
    assert.match(m, /pan-wizard@latest|npm i/, 'should give a runnable instruction');
  });
});

describe('the script itself', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deprecate-old-versions.js'), 'utf8');

  test('CONTAINS NO UNPUBLISH PATH', () => {
    // The one line in this file that must never change. Deprecation is additive
    // and reversible; unpublish removes a tarball other people may depend on and
    // cannot be undone. If someone "improves" this into an unpublish, this fails.
    assert.ok(!/unpublish/i.test(src.replace(/^\s*\*.*$/gm, '')),
      'this script must never gain an unpublish path — only deprecate');
  });

  test('dry run is the DEFAULT — acting requires --apply', () => {
    assert.match(src, /const apply = args\.includes\('--apply'\)/);
    assert.match(src, /if \(!apply\) return;/, 'must return before any mutation without --apply');
  });

  test('a deprecation failure does not fail the build', () => {
    // The publish has already succeeded by the time this runs; a red build here
    // would imply the release failed, which is false.
    assert.ok(!/process\.exit\(1\)[\s\S]{0,200}deprecate:/.test(src) || /release is unaffected/.test(src),
      'failures must be reported, not fatal');
    assert.match(src, /never fail the build|release is unaffected/);
  });

  test('refuses to sweep when the current version is a prerelease', () => {
    assert.match(src, /is a prerelease — skipping/,
      'a prerelease must not trigger a sweep — it would deprecate the current stable release');
  });
});
