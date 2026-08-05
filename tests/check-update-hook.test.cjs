/**
 * Tests for hooks/pan-check-update.js — SessionStart background update check.
 *
 * The version-resolution + cache-write logic used to live in an untestable
 * inline `node -e` string (M58). It now lives in exported pure functions:
 *   - resolveInstalledVersion (project VERSION over global VERSION)
 *   - compareVersions / isUpdateAvailable (semver-aware; L38)
 *   - computeUpdateResult (the cache record shape)
 *   - runCheck (reads VERSION, fetches latest via injectable fn, writes cache)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  parseVersion,
  compareVersions,
  isUpdateAvailable,
  computeUpdateResult,
  resolveInstalledVersion,
  runCheck,
} = require('../hooks/pan-check-update.js');

describe('pan-check-update — parseVersion / compareVersions', () => {
  test('parses plain semver', () => {
    assert.deepEqual(parseVersion('3.22.0'), [3, 22, 0]);
  });

  test('strips leading v and pre-release/build metadata', () => {
    assert.deepEqual(parseVersion('v3.22.1-beta.2'), [3, 22, 1]);
    assert.deepEqual(parseVersion('3.22.1+build.9'), [3, 22, 1]);
  });

  test('returns null for unparseable input', () => {
    assert.equal(parseVersion('unknown'), null);
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(null), null);
    assert.equal(parseVersion(undefined), null);
  });

  test('compareVersions orders correctly', () => {
    assert.equal(compareVersions('3.22.0', '3.22.1'), -1);
    assert.equal(compareVersions('3.23.0', '3.22.9'), 1);
    assert.equal(compareVersions('3.22.0', '3.22.0'), 0);
  });

  test('compareVersions handles differing component counts', () => {
    assert.equal(compareVersions('3.22', '3.22.0'), 0);
    assert.equal(compareVersions('3.22.0', '3.22.0.1'), -1);
  });

  test('compareVersions returns null when either side is unparseable', () => {
    assert.equal(compareVersions('unknown', '3.22.0'), null);
    assert.equal(compareVersions('3.22.0', 'latest'), null);
  });
});

describe('pan-check-update — isUpdateAvailable (L38)', () => {
  test('flags update only when installed is strictly older than latest', () => {
    assert.equal(isUpdateAvailable('3.22.0', '3.22.1'), true);
    assert.equal(isUpdateAvailable('3.21.9', '3.22.0'), true);
  });

  test('installed NEWER than latest shows NO update (the L38 regression)', () => {
    // Source checkout ahead of the npm 'latest' dist-tag must not nag a downgrade.
    assert.equal(isUpdateAvailable('3.23.0', '3.22.0'), false);
    assert.equal(isUpdateAvailable('4.0.0', '3.22.9'), false);
  });

  test('installed EQUAL to latest shows no update', () => {
    assert.equal(isUpdateAvailable('3.22.0', '3.22.0'), false);
  });

  test('0.0.0 sentinel (no VERSION found) never flags an update', () => {
    assert.equal(isUpdateAvailable('0.0.0', '3.22.0'), false);
  });

  test('missing/empty latest never flags an update', () => {
    assert.equal(isUpdateAvailable('3.22.0', null), false);
    assert.equal(isUpdateAvailable('3.22.0', ''), false);
  });

  test('unparseable installed tag falls back to strict inequality', () => {
    assert.equal(isUpdateAvailable('nightly', '3.22.0'), true);
    assert.equal(isUpdateAvailable('3.22.0', '3.22.0'), false);
  });
});

describe('pan-check-update — computeUpdateResult (cache record shape)', () => {
  test('produces the {update_available, installed, latest, checked} record', () => {
    const r = computeUpdateResult('3.22.0', '3.22.1', 1000);
    assert.deepEqual(r, {
      update_available: true,
      installed: '3.22.0',
      latest: '3.22.1',
      checked: 1000,
    });
  });

  test('latest falls back to "unknown" when null', () => {
    const r = computeUpdateResult('3.22.0', null, 5);
    assert.equal(r.latest, 'unknown');
    assert.equal(r.update_available, false);
  });

  test('checked defaults to current epoch seconds when omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const r = computeUpdateResult('3.22.0', '3.22.0');
    assert.ok(r.checked >= before);
  });
});

describe('pan-check-update — resolveInstalledVersion', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-checkupd-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  test('project VERSION wins over global VERSION', () => {
    const proj = path.join(tmpDir, 'proj-VERSION');
    const glob = path.join(tmpDir, 'glob-VERSION');
    fs.writeFileSync(proj, '3.22.0\n');
    fs.writeFileSync(glob, '3.10.0\n');
    assert.equal(resolveInstalledVersion(fs, proj, glob), '3.22.0');
  });

  test('falls back to global VERSION when project is absent', () => {
    const proj = path.join(tmpDir, 'missing-VERSION');
    const glob = path.join(tmpDir, 'glob-VERSION');
    fs.writeFileSync(glob, '3.10.0\n');
    assert.equal(resolveInstalledVersion(fs, proj, glob), '3.10.0');
  });

  test('returns 0.0.0 sentinel when neither file exists', () => {
    assert.equal(
      resolveInstalledVersion(fs, path.join(tmpDir, 'a'), path.join(tmpDir, 'b')),
      '0.0.0'
    );
  });
});

describe('pan-check-update — runCheck (end to end, no network)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-checkupd-run-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  test('writes a valid cache record flagging an available update', () => {
    const projVersion = path.join(tmpDir, 'VERSION');
    fs.writeFileSync(projVersion, '3.22.0');
    const cacheFile = path.join(tmpDir, 'cache.json');
    const result = runCheck({
      cacheFile,
      projectVersionFile: projVersion,
      globalVersionFile: path.join(tmpDir, 'global-VERSION'),
      fetchLatest: () => '3.23.0',
      nowSeconds: 1234,
    });
    assert.equal(result.update_available, true);
    const onDisk = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.deepEqual(onDisk, {
      update_available: true,
      installed: '3.22.0',
      latest: '3.23.0',
      checked: 1234,
    });
  });

  test('newer-than-latest install writes update_available:false (L38)', () => {
    const projVersion = path.join(tmpDir, 'VERSION');
    fs.writeFileSync(projVersion, '3.99.0');
    const cacheFile = path.join(tmpDir, 'cache.json');
    const result = runCheck({
      cacheFile,
      projectVersionFile: projVersion,
      globalVersionFile: path.join(tmpDir, 'global-VERSION'),
      fetchLatest: () => '3.22.0',
      nowSeconds: 1,
    });
    assert.equal(result.update_available, false);
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).update_available, false);
  });

  test('network failure (fetchLatest throws) still writes a record, no throw', () => {
    const cacheFile = path.join(tmpDir, 'cache.json');
    const result = runCheck({
      cacheFile,
      projectVersionFile: path.join(tmpDir, 'VERSION'),
      globalVersionFile: path.join(tmpDir, 'global-VERSION'),
      fetchLatest: () => { throw new Error('offline'); },
      nowSeconds: 1,
    });
    assert.equal(result.latest, 'unknown');
    assert.equal(result.update_available, false);
    assert.ok(fs.existsSync(cacheFile));
  });
});
