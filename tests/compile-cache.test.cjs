// pan-tools turns on Node's compile cache (market-ideas queue M37).
//
// Workflows start pan-tools many times per phase. With V8's compile cache a call
// went from 100 to 66 ms median (measured 2026-10-10). Node's default cache
// directory is under the shared system temp directory, where another user could
// plant compiled code, so pan-tools uses a compile-cache folder inside the per-user
// 0700 pan-hooks-<uid> directory and skips the cache when that directory is not safe.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const HAS_API = typeof require('module').enableCompileCache === 'function';
const UID = typeof process.getuid === 'function' ? process.getuid() : (process.env.USERNAME || 'win');

function run(tmp, extraEnv = {}) {
  const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...extraEnv };
  delete env.NODE_COMPILE_CACHE;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [TOOLS, 'version'], { env, encoding: 'utf8' });
}

describe('pan-tools and the compile cache', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-cc-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('writes its cache inside the per-user pan-hooks directory', (t) => {
    if (!HAS_API) return t.skip('Node without module.enableCompileCache (before 22.1)');
    const r = run(tmp);
    assert.equal(r.status, 0, r.stderr);
    const dir = path.join(tmp, `pan-hooks-${UID}`, 'compile-cache');
    assert.ok(fs.existsSync(dir), 'cache directory created');
    assert.ok(fs.readdirSync(dir).length > 0, 'cache written');
  });

  test('the answer is the same with the cache warm', () => {
    const first = run(tmp);
    const second = run(tmp);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.stdout, first.stdout);
  });

  test('NODE_COMPILE_CACHE, when set, is Node\'s choice and PAN adds no directory', (t) => {
    if (!HAS_API) return t.skip('Node without module.enableCompileCache (before 22.1)');
    const own = path.join(tmp, 'own-cache');
    const r = run(tmp, { NODE_COMPILE_CACHE: own });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(tmp, `pan-hooks-${UID}`, 'compile-cache')));
  });

  test('a pan-hooks directory open to other users disables the cache (POSIX)', (t) => {
    if (!HAS_API) return t.skip('Node without module.enableCompileCache (before 22.1)');
    if (typeof process.getuid !== 'function') return t.skip('Windows reports synthetic mode bits');
    const parent = path.join(tmp, `pan-hooks-${UID}`);
    fs.mkdirSync(parent);
    fs.chmodSync(parent, 0o777);
    const r = run(tmp);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(parent, 'compile-cache')), 'no cache in an unsafe directory');
  });
});
