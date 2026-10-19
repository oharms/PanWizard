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

describe('platform + registry edge cases (both were real bugs)', () => {
  test('the message is shell-quotable — no double quotes', () => {
    // On Windows npm can only be launched through a shell, and node CONCATENATES
    // rather than escapes args there, so a message containing a double quote would
    // emit a broken command line. The guard refuses rather than mangling.
    assert.doesNotThrow(() => dep.assertQuotable(dep.buildMessage('3.26.0')));
    assert.throws(() => dep.assertQuotable('say "hi"'), /double quote/);
  });

  test('the message contains spaces — so quoting is REQUIRED, not incidental', () => {
    // If someone shortens the message to one word, the quoting path stops being
    // exercised and the next multi-word message breaks silently on Windows.
    assert.ok(/\s/.test(dep.buildMessage('3.26.0')),
      'the message must contain a space, which is what makes quoting load-bearing');
  });

  test('the script shells npm ONLY on win32', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deprecate-old-versions.js'), 'utf8');
    assert.match(src, /shell: win/, 'npm must be shelled on win32 — the .cmd shim cannot be execFile\'d');
    assert.match(src, /process\.platform === 'win32'/, 'and only there');
  });

  test('empty npm output is treated as ABSENT, not as a failure', () => {
    // `npm view <pkg> deprecated --json` prints NOTHING when nothing is deprecated
    // — the healthy starting state. JSON.parse('') threw, and the fail-open handler
    // then reported "could not read the registry", making the normal case look broken.
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deprecate-old-versions.js'), 'utf8');
    assert.match(src, /if \(!out \|\| !out\.trim\(\)\) return fallback/,
      'npmJson must return the fallback on empty output rather than parsing it');
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

describe('npm failure reporting — the real error, not the first stderr line', () => {
  // Captured shape of what the 3.35.0 and 3.36.0 release runs got back from
  // `npm deprecate`. The script printed only the first stderr line, which is
  // setup-node's harmless `always-auth` warning, so 69 failures across two
  // releases all said the same unrelated thing and the cause stayed hidden.
  const WARN = 'npm warn Unknown user config "always-auth". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.';
  const LOG = 'npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-19T07_20_27_000Z-debug-0.log';
  const E401 = [WARN,
    'npm error code E401',
    'npm error 401 Unauthorized - PUT https://registry.npmjs.org/pan-wizard - unauthenticated: User cannot be authenticated with the token provided.',
    LOG, ''].join('\n');
  const EOTP = [WARN,
    'npm error code EOTP',
    'npm error This operation requires a one-time password from your authenticator.',
    'npm error You can provide a one-time password by passing --otp=<code> to the command you ran.',
    LOG, ''].join('\n');
  const E403 = [WARN,
    'npm error code E403',
    'npm error 403 403 Forbidden - PUT https://registry.npmjs.org/pan-wizard - You do not have permission to publish "pan-wizard". Are you logged in as the correct user?',
    LOG, ''].join('\n');

  test('skips npm warn lines and reports the code and the first real error line', () => {
    const s = dep.summarizeNpmError(E401);
    assert.equal(s.code, 'E401');
    assert.match(s.detail, /^401 Unauthorized - PUT .* User cannot be authenticated/);
    const text = dep.formatNpmError(E401);
    assert.ok(!/always-auth/.test(text), `the warning must not be reported as the error: ${text}`);
    assert.match(text, /^E401: 401 Unauthorized/);
  });

  test('CRLF output and the trailing log-location line do not leak in', () => {
    const s = dep.summarizeNpmError(EOTP.replace(/\n/g, '\r\n'));
    assert.equal(s.code, 'EOTP');
    assert.equal(s.detail, 'This operation requires a one-time password from your authenticator.');
  });

  test('each auth failure carries a hint saying what the owner must change', () => {
    assert.match(dep.formatNpmError(E401), /NPM_TOKEN.*(missing|expired|revoked)/i);
    assert.match(dep.formatNpmError(EOTP), /bypass 2FA/i);
    assert.match(dep.formatNpmError(E403), /write access to pan-wizard/i);
  });

  test('auth failures are recognised so the sweep stops after the first one', () => {
    for (const c of ['E401', 'E403', 'EOTP', 'ENEEDAUTH']) assert.equal(dep.isAuthFailure(c), true, c);
    for (const c of ['E404', 'E500', 'ETIMEDOUT', null]) assert.equal(dep.isAuthFailure(c), false, String(c));
  });

  test('output with no `npm error` line falls back to the first non-warning line', () => {
    assert.equal(dep.formatNpmError(`${WARN}\nspawn npm ENOENT\n`), 'spawn npm ENOENT');
    assert.equal(dep.formatNpmError('', 'Command failed: npm deprecate'), 'Command failed: npm deprecate');
  });
});

describe('the release workflow step', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const step = (yml.split('- name: Deprecate superseded versions')[1] || '').split('\n      - name:')[0];

  test('still never fails a release and still applies only in CI', () => {
    assert.match(step, /continue-on-error: true/);
    assert.match(step, /node scripts\/deprecate-old-versions\.js --apply/);
  });

  test('authenticates with the NPM_TOKEN secret, since OIDC cannot deprecate', () => {
    assert.match(step, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  });

  test('logs which npm identity the token resolves to before sweeping', () => {
    // Read-only, and the one line that tells an expired token from a scoped one.
    assert.match(step, /npm whoami/);
  });

  test('a failed sweep raises a GitHub annotation instead of hiding in the log', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deprecate-old-versions.js'), 'utf8');
    assert.match(src, /::warning title=Deprecation sweep failed::/);
  });
});
