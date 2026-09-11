// Reality check RC17 / plan item R15 (2026-09-10).
//
// gsd-core writes .planning/STATE.md, ROADMAP.md, PROJECT.md, REQUIREMENTS.md in
// UPPERCASE — exactly PAN's LEGACY_UPPERCASE_FILES. Before this fix `hygiene scan` on a
// gsd-core project reported legacy-filenames and `hygiene clean --apply` would have
// renamed another tool's state files; `validate health` called the tree broken; `init
// new-project` would have scaffolded into it. These tests pin both directions: a
// gsd-shaped tree is recognised and left alone, a PAN legacy tree still gets its
// legacy-filenames finding. Revert-proof: drop the detectForeignPlanningTree() call in
// scanOneRoot and "performs zero renames" fails on the first STATE.md.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { detectForeignPlanningTree } = require('../pan-wizard-core/bin/lib/foreign-planning.cjs');

const UPPER = ['STATE.md', 'ROADMAP.md', 'PROJECT.md', 'REQUIREMENTS.md'];

function resetPlanning(tmpDir) {
  const dir = path.join(tmpDir, '.planning');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A gsd-core-shaped tree: uppercase core files + HANDOFF.json + flat dotted config. */
function makeGsdTree(tmpDir) {
  const dir = resetPlanning(tmpDir);
  for (const f of UPPER) fs.writeFileSync(path.join(dir, f), `# ${f}\n`);
  fs.writeFileSync(path.join(dir, 'HANDOFF.json'), '{"phase":"01"}\n');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    'workflow.discuss_mode': 'assumptions', 'graphify.enabled': true, model_profile: 'balanced', runtime: 'codex',
  }, null, 2));
  fs.mkdirSync(path.join(dir, 'phases'), { recursive: true });
  return dir;
}

/** A PAN pre-v2.2 tree: the same uppercase files, PAN's NESTED config, no gsd markers. */
function makePanLegacyTree(tmpDir) {
  const dir = resetPlanning(tmpDir);
  for (const f of UPPER) fs.writeFileSync(path.join(dir, f), `# ${f}\n`);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ workflow: { research: true }, model_profile: 'balanced' }, null, 2));
  fs.mkdirSync(path.join(dir, 'phases'), { recursive: true });
  return dir;
}

describe('detectForeignPlanningTree', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('a gsd-core-shaped tree is foreign, with the evidence named', () => {
    const r = detectForeignPlanningTree(makeGsdTree(tmpDir));
    assert.ok(r, 'must detect');
    assert.equal(r.tool, 'gsd-core');
    assert.ok(r.evidence.includes('HANDOFF.json'));
    assert.ok(r.evidence.some(e => e.startsWith('config.json:workflow.discuss_mode')));
  });

  test('a PAN legacy tree (uppercase files, nested config) is NOT foreign', () => {
    assert.equal(detectForeignPlanningTree(makePanLegacyTree(tmpDir)), null);
  });

  test('one marker directory is not enough; two are', () => {
    const dir = resetPlanning(tmpDir);
    fs.mkdirSync(path.join(dir, 'forensics'));
    assert.equal(detectForeignPlanningTree(dir), null, 'a single directory name is too weak');
    fs.mkdirSync(path.join(dir, 'threads'));
    assert.equal(detectForeignPlanningTree(dir).tool, 'gsd-core');
  });

  test('an unreadable config.json is not evidence; a missing tree is null', () => {
    const dir = resetPlanning(tmpDir);
    fs.writeFileSync(path.join(dir, 'config.json'), '{not json');
    assert.equal(detectForeignPlanningTree(dir), null);
    assert.equal(detectForeignPlanningTree(path.join(tmpDir, 'nowhere')), null);
  });
});

describe('hygiene leaves a foreign tree alone (R15)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('scan reports foreign-planning-tree and NOT legacy-filenames on a gsd tree', () => {
    makeGsdTree(tmpDir);
    const r = runPanTools('hygiene scan', tmpDir);
    const data = JSON.parse(r.output);
    const checks = data.findings.map(f => f.check);
    assert.ok(checks.includes('foreign-planning-tree'), `expected the foreign finding, got ${checks.join(', ')}`);
    assert.ok(!checks.includes('legacy-filenames'), 'a gsd tree must not be reported as legacy PAN files');
    const foreign = data.findings.find(f => f.check === 'foreign-planning-tree');
    assert.equal(foreign.fixable, false);
    assert.match(foreign.detail, /gsd-core/);
  });

  test('clean --apply performs zero renames on a gsd tree', () => {
    const dir = makeGsdTree(tmpDir);
    const r = runPanTools('hygiene clean --apply', tmpDir);
    assert.ok(r.output, r.error);
    const names = fs.readdirSync(dir);
    for (const f of UPPER) assert.ok(names.includes(f), `${f} must still exist in uppercase (got ${names.join(', ')})`);
    assert.ok(!names.includes('state.md'), 'no lowercase twin may appear');
    const data = JSON.parse(r.output);
    assert.ok(!(data.applied || []).some(a => a.action === 'rename-lowercase' && a.applied), 'no rename-lowercase may be applied');
  });

  test('a PAN legacy tree still gets legacy-filenames (both directions pinned)', () => {
    makePanLegacyTree(tmpDir);
    const data = JSON.parse(runPanTools('hygiene scan', tmpDir).output);
    const checks = data.findings.map(f => f.check);
    assert.ok(checks.includes('legacy-filenames'), 'PAN legacy layouts must still be offered a rename');
    assert.ok(!checks.includes('foreign-planning-tree'));
  });
});

describe('validate health and init refuse a foreign tree (R15)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('validate health reports E006 and exits non-zero', () => {
    makeGsdTree(tmpDir);
    const r = runPanTools('validate health', tmpDir);
    assert.equal(r.success, false, 'a foreign tree is a broken verdict for PAN');
    const data = JSON.parse(r.output);
    assert.equal(data.status, 'broken');
    assert.ok(data.errors.some(e => e.code === 'E006'), JSON.stringify(data.errors));
    assert.ok(!data.errors.some(e => ['E002', 'E003', 'E004'].includes(e.code)), 'stop before describing a foreign layout as missing PAN files');
  });

  test('validate health --repair writes nothing into a foreign tree', () => {
    const dir = makeGsdTree(tmpDir);
    const before = fs.readdirSync(dir).sort();
    runPanTools('validate health --repair', tmpDir);
    assert.deepEqual(fs.readdirSync(dir).sort(), before, 'repair must not add or rename files in another tool\'s tree');
  });

  test('init new-project refuses with an error payload', () => {
    makeGsdTree(tmpDir);
    const r = runPanTools('init new-project', tmpDir);
    assert.equal(r.success, false);
    const data = JSON.parse(r.output);
    assert.match(String(data.error), /gsd-core/);
    assert.ok(Array.isArray(data.evidence) && data.evidence.length > 0);
  });
});
