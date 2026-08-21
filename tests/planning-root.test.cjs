/**
 * Tests for planning-root.cjs — WHICH planning tree a command acts on.
 *
 * Regression cover for the "silent wrong target" defect: before this module a
 * repo with several planning trees could address only `.planning/`, and the
 * commands that read the wrong tree reported success rather than an error. The
 * tests below pin both halves of the fix — that a non-default root is
 * reachable, and that every resolution can name itself.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PLANNING_DIR,
  normalizeRoot,
  normalizeTrackName,
  trackRel,
  setPlanningRoot,
  clearPlanningRoot,
  withPlanningRoot,
  resolvePlanningRoot,
  planningRootRel,
  planningRootAbs,
  isPlanningTree,
  discoverTracks,
  planningRoots,
  describePlanningRoot,
} = require('../pan-wizard-core/bin/lib/planning-root.cjs');
const { planningPath, planningRel } = require('../pan-wizard-core/bin/lib/utils.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

/** Reset all resolution inputs — these are process-global. */
function resetRoot() {
  clearPlanningRoot();
  delete process.env.PAN_PLANNING_DIR;
  delete process.env.PAN_TRACK;
}

/** Give a directory a planning spine so it counts as a real tree. */
function makeTree(abs) {
  fs.mkdirSync(path.join(abs, 'phases'), { recursive: true });
  fs.writeFileSync(path.join(abs, 'state.md'), '# State\n');
}

describe('planning-root — path validation', () => {
  afterEach(resetRoot);

  test('rejects absolute paths on both platforms', () => {
    assert.throws(() => normalizeRoot('/etc/passwd', '--planning-dir'), /absolute path/);
    assert.throws(() => normalizeRoot('\\\\server\\share', '--planning-dir'), /absolute path/);
  });

  test('rejects Windows drive-relative paths', () => {
    assert.throws(() => normalizeRoot('C:planning', '--planning-dir'), /drive path/);
    assert.throws(() => normalizeRoot('D:/PanWizard', '--planning-dir'), /drive path/);
  });

  test('rejects traversal out of the project root', () => {
    assert.throws(() => normalizeRoot('../../etc', '--planning-dir'), /inside the project root/);
    assert.throws(() => normalizeRoot('.planning/../../x', '--planning-dir'), /inside the project root/);
  });

  test('rejects an empty value', () => {
    assert.throws(() => normalizeRoot('', '--planning-dir'), /missing value/);
    assert.throws(() => normalizeRoot('   ', '--planning-dir'), /missing value/);
  });

  test('normalizes separators and redundant segments to POSIX', () => {
    assert.equal(normalizeRoot('.planning\\tracks\\core', '--planning-dir'), '.planning/tracks/core');
    assert.equal(normalizeRoot('./.planning//tracks/core/', '--planning-dir'), '.planning/tracks/core');
  });

  test('track names are restricted to a slug alphabet', () => {
    assert.equal(normalizeTrackName('core'), 'core');
    assert.equal(normalizeTrackName('v2_defense-1.0'), 'v2_defense-1.0');
    assert.throws(() => normalizeTrackName('../evil'), /not a valid track name/);
    assert.throws(() => normalizeTrackName('a/b'), /not a valid track name/);
    assert.throws(() => normalizeTrackName(''), /missing value/);
  });

  test('trackRel builds a path under the default root', () => {
    assert.equal(trackRel('verify'), '.planning/tracks/verify');
  });
});

describe('planning-root — resolution precedence', () => {
  beforeEach(resetRoot);
  afterEach(resetRoot);

  test('defaults to .planning and says so', () => {
    const r = resolvePlanningRoot();
    assert.equal(r.rel, DEFAULT_PLANNING_DIR);
    assert.equal(r.source, 'default');
    assert.equal(r.track, null);
  });

  test('PAN_TRACK env selects a track', () => {
    process.env.PAN_TRACK = 'defense';
    const r = resolvePlanningRoot();
    assert.equal(r.rel, '.planning/tracks/defense');
    assert.equal(r.source, 'env:PAN_TRACK');
    assert.equal(r.track, 'defense');
  });

  test('PAN_PLANNING_DIR env outranks PAN_TRACK', () => {
    process.env.PAN_TRACK = 'defense';
    process.env.PAN_PLANNING_DIR = 'planning-alt';
    const r = resolvePlanningRoot();
    assert.equal(r.rel, 'planning-alt');
    assert.equal(r.source, 'env:PAN_PLANNING_DIR');
  });

  test('an explicit flag outranks both env vars', () => {
    process.env.PAN_TRACK = 'defense';
    process.env.PAN_PLANNING_DIR = 'planning-alt';
    setPlanningRoot({ track: 'core' });
    const r = resolvePlanningRoot();
    assert.equal(r.rel, '.planning/tracks/core');
    assert.equal(r.source, 'flag:--track');
  });

  test('--planning-dir and --track together is an error', () => {
    assert.throws(() => setPlanningRoot({ planningDir: 'x', track: 'y' }), /mutually exclusive/);
  });

  test('clearing the override falls back to env, then default', () => {
    setPlanningRoot({ track: 'core' });
    assert.equal(planningRootRel(), '.planning/tracks/core');
    clearPlanningRoot();
    assert.equal(planningRootRel(), DEFAULT_PLANNING_DIR);
  });
});

describe('planning-root — withPlanningRoot scoping', () => {
  beforeEach(resetRoot);
  afterEach(resetRoot);

  test('pins the root for the callback and restores afterwards', () => {
    const inside = withPlanningRoot('.planning/tracks/verify', () => planningRootRel());
    assert.equal(inside, '.planning/tracks/verify');
    assert.equal(planningRootRel(), DEFAULT_PLANNING_DIR);
  });

  test('restores the previous root even when the callback throws', () => {
    setPlanningRoot({ track: 'core' });
    assert.throws(() => withPlanningRoot('.planning/tracks/verify', () => { throw new Error('boom'); }), /boom/);
    assert.equal(planningRootRel(), '.planning/tracks/core', 'scope leaked after a throw');
  });

  test('nests without losing the outer scope', () => {
    withPlanningRoot('.planning/tracks/a', () => {
      withPlanningRoot('.planning/tracks/b', () => {
        assert.equal(planningRootRel(), '.planning/tracks/b');
      });
      assert.equal(planningRootRel(), '.planning/tracks/a');
    });
    assert.equal(planningRootRel(), DEFAULT_PLANNING_DIR);
  });
});

describe('planning-root — path builders follow the active root', () => {
  beforeEach(resetRoot);
  afterEach(resetRoot);

  test('planningPath and planningRel move together', () => {
    setPlanningRoot({ track: 'verify' });
    assert.equal(planningRel('state.md'), '.planning/tracks/verify/state.md');
    assert.equal(
      planningPath('/proj', 'optimization', 'traces'),
      path.join('/proj', '.planning', 'tracks', 'verify', 'optimization', 'traces')
    );
  });

  test('planningRel splits embedded separators into POSIX segments', () => {
    assert.equal(planningRel('todos/pending', 'a.md'), '.planning/todos/pending/a.md');
    assert.equal(planningRel('todos\\pending'), '.planning/todos/pending');
  });

  test('planningRel with no segments is the bare root', () => {
    assert.equal(planningRel(), '.planning');
  });

  test('planningRootAbs joins onto the project root', () => {
    setPlanningRoot({ planningDir: 'alt/planning' });
    assert.equal(planningRootAbs('/proj'), path.join('/proj', 'alt', 'planning'));
  });
});

describe('planning-root — track discovery', () => {
  let tmpDir;
  beforeEach(() => { resetRoot(); tmpDir = createTempProject(); });
  afterEach(() => { resetRoot(); cleanup(tmpDir); });

  test('finds every planning tree under .planning/tracks/', () => {
    for (const t of ['core', 'defense', 'verify']) {
      makeTree(path.join(tmpDir, '.planning', 'tracks', t));
    }
    const names = discoverTracks(tmpDir).map(t => t.name);
    assert.deepEqual(names, ['core', 'defense', 'verify'], 'sorted by name');
  });

  test('a directory without a planning spine is not a track', () => {
    makeTree(path.join(tmpDir, '.planning', 'tracks', 'real'));
    const decoy = path.join(tmpDir, '.planning', 'tracks', 'notes');
    fs.mkdirSync(decoy, { recursive: true });
    fs.writeFileSync(path.join(decoy, 'scratch.txt'), 'hi');

    assert.deepEqual(discoverTracks(tmpDir).map(t => t.name), ['real']);
    assert.equal(isPlanningTree(decoy), false);
  });

  test('returns empty when there is no tracks directory', () => {
    assert.deepEqual(discoverTracks(tmpDir), []);
  });

  test('files under tracks/ are ignored', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'tracks'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'tracks', 'README.md'), '# tracks\n');
    assert.deepEqual(discoverTracks(tmpDir), []);
  });
});

describe('planning-root — planningRoots()', () => {
  let tmpDir;
  beforeEach(() => { resetRoot(); tmpDir = createTempProject(); });
  afterEach(() => { resetRoot(); cleanup(tmpDir); });

  test('without allTracks returns exactly the resolved root', () => {
    makeTree(path.join(tmpDir, '.planning', 'tracks', 'core'));
    setPlanningRoot({ track: 'core' });
    const roots = planningRoots(tmpDir);
    assert.equal(roots.length, 1);
    assert.equal(roots[0].rel, '.planning/tracks/core');
    assert.equal(roots[0].name, 'core');
  });

  test('with allTracks returns the root tree plus every track', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '# State\n');
    makeTree(path.join(tmpDir, '.planning', 'tracks', 'core'));
    makeTree(path.join(tmpDir, '.planning', 'tracks', 'verify'));

    const roots = planningRoots(tmpDir, { allTracks: true });
    assert.deepEqual(roots.map(r => r.name), [null, 'core', 'verify']);
    assert.deepEqual(roots.map(r => r.rel),
      ['.planning', '.planning/tracks/core', '.planning/tracks/verify']);
  });

  test('allTracks on a project with no trees still yields one root', () => {
    const bare = createTempProject();
    try {
      const roots = planningRoots(bare, { allTracks: true });
      assert.equal(roots.length, 1, '--all-tracks must never silently act on nothing');
      assert.equal(roots[0].rel, '.planning');
    } finally {
      cleanup(bare);
    }
  });
});

describe('planning-root — describePlanningRoot()', () => {
  let tmpDir;
  beforeEach(() => { resetRoot(); tmpDir = createTempProject(); });
  afterEach(() => { resetRoot(); cleanup(tmpDir); });

  test('reports the root, its source, and whether it exists', () => {
    const d = describePlanningRoot(tmpDir);
    assert.equal(d.planning_root, '.planning');
    assert.equal(d.planning_root_source, 'default');
    assert.equal(d.track, null);
    assert.equal(d.planning_root_exists, true);
  });

  test('a targeted root that does not exist is reported as missing, not silently empty', () => {
    setPlanningRoot({ track: 'nonexistent' });
    const d = describePlanningRoot(tmpDir);
    assert.equal(d.planning_root, '.planning/tracks/nonexistent');
    assert.equal(d.track, 'nonexistent');
    assert.equal(d.planning_root_source, 'flag:--track');
    assert.equal(d.planning_root_exists, false,
      'a wrong --track must be visible in the output, not indistinguishable from a clean tree');
  });
});
