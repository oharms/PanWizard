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

// Market item M3 / MI-028 (planning-with-files README, read 2026-09-28 at v3.21.0).
// planning-with-files writes INTO .planning/ beside PAN: `.active_plan`, `.attestation`,
// `sessions/`, `ledger-<agent>.jsonl`, and one dated `YYYY-MM-DD-slug/` task directory
// holding task_plan.md. Unlike gsd-core it SHARES the tree, so PAN names it and keeps
// working instead of refusing. It also gitignores .planning/ by default, which silently
// defeats commit_docs: that is I005.

/** A PAN phase-model tree with planning-with-files' files beside it. */
function makeSharedTree(tmpDir, { marker = 'active_plan' } = {}) {
  const dir = resetPlanning(tmpDir);
  fs.writeFileSync(path.join(dir, 'project.md'), '# Project\n');
  fs.writeFileSync(path.join(dir, 'roadmap.md'), '# Roadmap\n');
  fs.writeFileSync(path.join(dir, 'state.md'), '---\ncurrent_phase: 1\n---\n# State\n');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
  fs.mkdirSync(path.join(dir, 'phases', '01-alpha'), { recursive: true });
  if (marker === 'active_plan') fs.writeFileSync(path.join(dir, '.active_plan'), '2026-09-28-auth\n');
  const task = path.join(dir, '2026-09-28-auth');
  fs.mkdirSync(task, { recursive: true });
  fs.writeFileSync(path.join(task, 'task_plan.md'), '# Task plan\n- [ ] step\n');
  return dir;
}

describe('planning-with-files shares the tree (M3)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('its markers are recognised as a coexisting tool, with the evidence named', () => {
    const r = detectForeignPlanningTree(makeSharedTree(tmpDir));
    assert.equal(r.tool, 'planning-with-files');
    assert.equal(r.coexists, true);
    assert.deepEqual(r.evidence, ['.active_plan', '2026-09-28-auth/']);
    assert.equal(detectForeignPlanningTree(makeGsdTree(tmpDir)).coexists, false, 'gsd-core owns its tree');
  });

  test('a dated task directory counts only with its task_plan.md; sessions/ plus a bare dated directory is two directories', () => {
    const dir = resetPlanning(tmpDir);
    fs.mkdirSync(path.join(dir, '2026-09-28-auth'));
    assert.equal(detectForeignPlanningTree(dir), null, 'a dated directory alone is too weak');
    fs.mkdirSync(path.join(dir, 'sessions'));
    assert.equal(detectForeignPlanningTree(dir).tool, 'planning-with-files');
    const withPlan = resetPlanning(tmpDir);
    fs.mkdirSync(path.join(withPlan, '2026-09-28-auth'));
    fs.writeFileSync(path.join(withPlan, '2026-09-28-auth', 'task_plan.md'), '# plan\n');
    assert.deepEqual(detectForeignPlanningTree(withPlan).evidence, ['2026-09-28-auth/']);
  });

  test('its per-agent ledger file is evidence; PAN\'s own findings ledger is not', () => {
    const dir = resetPlanning(tmpDir);
    fs.writeFileSync(path.join(dir, 'findings.jsonl'), '');
    assert.equal(detectForeignPlanningTree(dir), null, 'findings.jsonl is PAN\'s evidence-loop ledger');
    fs.writeFileSync(path.join(dir, 'ledger-claude.jsonl'), '');
    assert.deepEqual(detectForeignPlanningTree(dir).evidence, ['ledger-claude.jsonl']);
  });

  test('validate health reports I004 and runs PAN\'s own checks, instead of E006', () => {
    makeSharedTree(tmpDir);
    const data = JSON.parse(runPanTools('validate health', tmpDir).output);
    assert.ok(!data.errors.some(e => e.code === 'E006'), JSON.stringify(data.errors));
    const i004 = data.info.find(i => i.code === 'I004');
    assert.ok(i004, JSON.stringify(data.info));
    assert.match(i004.message, /planning-with-files also writes into this planning tree: \.active_plan, 2026-09-28-auth\//);
    assert.notEqual(data.status, 'broken', 'a shared tree is not a broken one');
  });

  test('hygiene scan names the shared tree and still checks PAN\'s files', () => {
    const dir = makeSharedTree(tmpDir);
    // Remove first: on a case-insensitive filesystem writing STATE.md over state.md keeps the lowercase name.
    fs.rmSync(path.join(dir, 'state.md'));
    fs.writeFileSync(path.join(dir, 'STATE.md'), '# legacy\n');
    const checks = JSON.parse(runPanTools('hygiene scan', tmpDir).output).findings.map(f => f.check);
    assert.ok(checks.includes('shared-planning-tree'), checks.join(', '));
    assert.ok(checks.includes('legacy-filenames'), 'PAN\'s own legacy file is still offered its rename');
    assert.ok(!checks.includes('foreign-planning-tree'));
  });

  test('init new-project proceeds in a shared tree and reports who shares it', () => {
    makeSharedTree(tmpDir);
    const r = runPanTools('init new-project', tmpDir);
    assert.equal(r.success, true, r.output);
    const data = JSON.parse(r.output);
    assert.deepEqual(data.shared_planning_tree, { tool: 'planning-with-files', evidence: ['.active_plan', '2026-09-28-auth/'] });
  });
});

describe('I005: a gitignored planning tree with commit_docs on (M3)', () => {
  let tmpDir;
  const git = (...args) => require('child_process').execFileSync('git', args, { cwd: tmpDir, stdio: 'pipe' });
  beforeEach(() => {
    tmpDir = createTempProject();
    makeSharedTree(tmpDir, { marker: 'none' });
    git('init', '-q');
  });
  afterEach(() => { cleanup(tmpDir); });
  const infoCodes = () => JSON.parse(runPanTools('validate health', tmpDir).output).info.map(i => i.code);

  test('.planning/ in .gitignore while commit_docs is on reports I005 with the fix', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.planning/\n');
    const data = JSON.parse(runPanTools('validate health', tmpDir).output);
    const i005 = data.info.find(i => i.code === 'I005');
    assert.ok(i005, JSON.stringify(data.info));
    assert.match(i005.fix, /Remove \.planning\/ from \.gitignore .* config-set commit_docs false/);
  });

  test('no I005 when the tree is committed, when commit_docs is off, or outside git', () => {
    assert.ok(!infoCodes().includes('I005'), 'not ignored');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.planning/\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: false }));
    assert.ok(!infoCodes().includes('I005'), 'keeping docs out of git on purpose is not a finding');
    fs.rmSync(path.join(tmpDir, '.git'), { recursive: true, force: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
    assert.ok(!infoCodes().includes('I005'), 'no git, no finding');
  });
});
