/**
 * OpenCode permission config must point at the directory PAN actually installs to,
 * honour --config-dir, and be removable again.
 *
 * Regression guard for a High finding from the 2026-08 deployed stability test, which
 * was three defects wearing one coat:
 *
 *  1. The default-location branch emitted `~/.config/opencode/pan-wizard/*` while the
 *     core installs to `pan-wizard-core/`. The grant matched nothing, so PAN's own
 *     files were never allow-listed — external_directory is OpenCode's guard for
 *     reading outside the project.
 *  2. The uninstaller only removed keys containing `pan-wizard-core`, so it could
 *     never match the malformed key it had just written. That is what turned a typo
 *     into permanent residue on the user's machine.
 *  3. configureOpencodePermissions called getOpencodeGlobalDir() directly, ignoring
 *     --config-dir, so a custom-dir install wrote its permissions into
 *     ~/.config/opencode instead — the real install got none, and an unrelated
 *     directory got a stray one.
 *
 * These run the real installer against a fake HOME and assert on the file it writes.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const INSTALLER = path.join(__dirname, '..', 'bin', 'install.js');

let tempRoot;
let fakeHome;
let proj;

function install(flags) {
  const r = spawnSync('node', [INSTALLER, ...flags], {
    cwd: proj,
    encoding: 'utf-8',
    timeout: 120000,
    // os.homedir() follows USERPROFILE on Windows and HOME on POSIX — set both, or
    // a global install writes into the developer's real home.
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/** Every permission key PAN wrote, across both permission types. */
function permissionKeys(configPath) {
  const cfg = readJson(configPath);
  const perm = cfg.permission || {};
  return [...new Set([
    ...Object.keys(perm.read || {}),
    ...Object.keys(perm.external_directory || {}),
  ])];
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-oc-'));
  fakeHome = path.join(tempRoot, 'home');
  proj = path.join(tempRoot, 'proj');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"host","version":"1.0.0"}\n');
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('global OpenCode install grants permission on the real core directory', () => {
  test('the glob names pan-wizard-core, and that directory exists', () => {
    const { code } = install(['--opencode', '--global']);
    assert.equal(code, 0);

    const configPath = path.join(fakeHome, '.config', 'opencode', 'opencode.json');
    const keys = permissionKeys(configPath);

    assert.ok(keys.length > 0, 'PAN must write at least one permission key');
    // REVERT CHECK: the old default branch wrote `.../pan-wizard/*` — this fails.
    for (const k of keys) {
      assert.match(k, /pan-wizard-core/, `permission key must name the real core dir, got ${k}`);
    }
    // The grant is worthless if it points somewhere nothing was installed, so assert
    // the directory it refers to is actually there.
    assert.ok(fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'pan-wizard-core')),
      'the core directory the grant names must exist');
  });

  test('uninstall removes what the install wrote', () => {
    install(['--opencode', '--global']);
    const configPath = path.join(fakeHome, '.config', 'opencode', 'opencode.json');
    assert.ok(fs.existsSync(configPath), 'precondition: install wrote a config');

    const { code, out } = install(['--opencode', '--global', '--uninstall']);

    assert.equal(code, 0);
    assert.match(out, /opencode\.json/, 'uninstall must report what it did');
    // PAN created the file, so once its keys are gone there is nothing left to keep.
    assert.ok(!fs.existsSync(configPath), 'a config containing only PAN keys should be removed');
  });

  test('a stale pan-wizard key from an older install is cleaned, and user keys survive', () => {
    // The residue case: a machine that ran any global OpenCode install before the
    // glob was corrected. The uninstaller must be able to match that key, or the
    // entry lives on the user's disk forever with nothing able to remove it.
    const dir = path.join(fakeHome, '.config', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, 'opencode.json');
    fs.writeFileSync(configPath, JSON.stringify({
      theme: 'mine',
      permission: {
        read: { '~/.config/opencode/pan-wizard/*': 'allow' },
        external_directory: { '~/.config/opencode/pan-wizard/*': 'allow' },
      },
    }, null, 2) + '\n');

    install(['--opencode', '--global', '--uninstall']);

    const cfg = readJson(configPath);
    // REVERT CHECK: matching only `pan-wizard-core` leaves both stale keys behind.
    assert.equal(cfg.permission, undefined, 'the stale PAN permission block must be gone');
    assert.equal(cfg.theme, 'mine', 'the user\'s own settings must survive');
  });
});

describe('--config-dir is honoured on both install and uninstall', () => {
  test('permissions land in the custom dir, not the default one', () => {
    const custom = path.join(tempRoot, 'customcfg');

    const { code } = install(['--opencode', '--global', '--config-dir', custom]);
    assert.equal(code, 0);

    const customConfig = path.join(custom, 'opencode.json');
    // REVERT CHECK: calling getOpencodeGlobalDir() directly puts this file in
    // <fakeHome>/.config/opencode instead, so both assertions below fail.
    assert.ok(fs.existsSync(customConfig), 'the custom config dir must get the permission file');
    assert.ok(!fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'opencode.json')),
      'the default location must NOT get a stray permission file');

    for (const k of permissionKeys(customConfig)) {
      assert.match(k, /pan-wizard-core/, `key must name the real core dir, got ${k}`);
    }
  });

  test('uninstall with the same --config-dir cleans it up', () => {
    const custom = path.join(tempRoot, 'customcfg2');
    install(['--opencode', '--global', '--config-dir', custom]);
    const customConfig = path.join(custom, 'opencode.json');
    assert.ok(fs.existsSync(customConfig), 'precondition: install wrote it');

    install(['--opencode', '--global', '--config-dir', custom, '--uninstall']);

    assert.ok(!fs.existsSync(customConfig),
      'uninstall must look in the same custom dir the install used');
  });
});

describe('local OpenCode install is unaffected', () => {
  test('a local install still writes a working project-level grant', () => {
    const { code } = install(['--opencode', '--local']);
    assert.equal(code, 0);

    const configPath = path.join(proj, '.opencode', 'opencode.json');
    assert.ok(fs.existsSync(configPath), 'local install writes .opencode/opencode.json');
    for (const k of permissionKeys(configPath)) {
      assert.match(k, /pan-wizard-core/, `key must name the real core dir, got ${k}`);
    }
  });
});
