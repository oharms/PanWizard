/**
 * Installing must strip internal topics from learnings/index.json, not just from disk.
 *
 * Medium finding from the 2026-08 deployed stability test. The installer deleted
 * learnings/internal/ but left the index listing those topics, so every install
 * shipped file paths that do not exist — dangling references for anything that
 * resolves them — along with the internal topic names, their pattern ids, and totals
 * counting content the package deliberately withholds. The strip was half done.
 *
 * These run the real installer and read the file it produced, because the defect was
 * in what shipped rather than in any function's return value.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');
const SOURCE_INDEX = path.join(PROJECT_ROOT, 'pan-wizard-core', 'learnings', 'index.json');

let tempRoot;
let proj;
let installed = false;

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lidx-'));
  proj = path.join(tempRoot, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"host","version":"1.0.0"}\n');
  const r = spawnSync('node', [INSTALLER, '--claude', '--local'], {
    cwd: proj,
    encoding: 'utf-8',
    timeout: 120000,
    env: { ...process.env, HOME: path.join(tempRoot, 'home'), USERPROFILE: path.join(tempRoot, 'home') },
  });
  installed = r.status === 0;
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

function installedIndex() {
  return JSON.parse(fs.readFileSync(
    path.join(proj, '.claude', 'pan-wizard-core', 'learnings', 'index.json'), 'utf-8'));
}

describe('the installed learnings index matches what actually shipped', () => {
  test('the source index still carries internal topics — otherwise this proves nothing', () => {
    const src = JSON.parse(fs.readFileSync(SOURCE_INDEX, 'utf-8'));
    assert.ok(src.topics.some(t => t.scope === 'internal'),
      'the source must have internal topics for the strip to be meaningful');
  });

  test('no internal-scoped topic is listed', () => {
    assert.ok(installed, 'installer must have succeeded');
    const idx = installedIndex();
    assert.deepEqual(idx.topics.filter(t => t.scope === 'internal'), [],
      'internal topic names and pattern ids must not ship');
  });

  test('every listed topic file actually exists on disk', () => {
    const idx = installedIndex();
    const root = path.join(proj, '.claude');
    const dangling = idx.topics
      .map(t => t.file)
      .filter(f => !fs.existsSync(path.join(root, f)));
    assert.deepEqual(dangling, [], 'an index entry pointing at a stripped file is a dangling reference');
  });

  test('totals are recomputed, not left describing the unstripped store', () => {
    const idx = installedIndex();
    const expectedPatterns = idx.topics.reduce((n, t) => n + (t.patterns ? t.patterns.length : 0), 0);
    const expectedBytes = idx.topics.reduce((n, t) => n + (t.size_bytes || 0), 0);

    assert.equal(idx.totals.topics, idx.topics.length);
    assert.equal(idx.totals.patterns, expectedPatterns);
    assert.equal(idx.totals.size_bytes, expectedBytes,
      'each topic carries its own size, so totals are exact rather than estimated');
  });

  test('universal topics are all still present — the strip must not overreach', () => {
    const src = JSON.parse(fs.readFileSync(SOURCE_INDEX, 'utf-8'));
    const srcUniversal = src.topics.filter(t => t.scope !== 'internal').map(t => t.name).sort();
    const gotUniversal = installedIndex().topics.map(t => t.name).sort();
    assert.deepEqual(gotUniversal, srcUniversal, 'every non-internal topic must survive');
  });
});
