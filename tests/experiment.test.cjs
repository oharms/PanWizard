// Tests for experiment.cjs — v3.7.0 W1 (self-improvement loop, scaffold layer).
// Spec: docs/specs/self_improvement_loop_featureai.md

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const experiment = require('../pan-wizard-core/bin/lib/experiment.cjs');

const PAN_SOURCE_ROOT = path.resolve(__dirname, '..');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pan-experiment-test-'));
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function writeIdeaFile(dir, content = '# Idea: test\n## Problem\nfoo\n') {
  const p = path.join(dir, 'idea.md');
  fs.writeFileSync(p, content);
  return p;
}

// ── Module shape ────────────────────────────────────────────────────────────

describe('experiment.cjs — module shape', () => {
  test('exports the W1 functions', () => {
    assert.equal(typeof experiment.newExperiment, 'function');
    assert.equal(typeof experiment.listExperiments, 'function');
    assert.equal(typeof experiment.getExperimentManifest, 'function');
    assert.equal(typeof experiment.PAN_EXPERIMENTS_ROOT_DEFAULT, 'string');
  });

  test('PAN_EXPERIMENTS_ROOT_DEFAULT is under home dir, not source repo', () => {
    const def = experiment.PAN_EXPERIMENTS_ROOT_DEFAULT;
    assert.ok(def.length > 0);
    // Must not be inside the source repo
    assert.ok(
      !def.toLowerCase().startsWith(PAN_SOURCE_ROOT.toLowerCase()),
      `default root must not be inside ${PAN_SOURCE_ROOT}, got ${def}`
    );
  });
});

// ── newExperiment ───────────────────────────────────────────────────────────

describe('newExperiment — happy path', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('creates an experiment folder with .planning/ and idea.md', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    const result = experiment.newExperiment('my-test-1', {
      root: tmpRoot,
      ideaPath,
      runtime: 'claude',
      skipInstaller: true, // tests don't run the actual installer
    });

    assert.equal(result.error, undefined, 'should succeed');
    assert.ok(result.path, 'should return path');
    assert.ok(fs.existsSync(result.path), 'experiment folder should exist');
    assert.ok(fs.existsSync(path.join(result.path, '.planning')), '.planning/ should exist');
    assert.ok(fs.existsSync(path.join(result.path, '.planning', 'idea.md')), 'idea.md should be copied');
    assert.equal(result.runtime, 'claude');
    assert.equal(result.experiment_id, 'my-test-1');
  });

  test('writes a manifest with experiment metadata', () => {
    const ideaPath = writeIdeaFile(tmpRoot, '# Idea: manifest-check\n');
    const result = experiment.newExperiment('manifest-check', {
      root: tmpRoot,
      ideaPath,
      runtime: 'codex',
      skipInstaller: true,
    });

    assert.equal(result.error, undefined);
    const manifestPath = path.join(result.path, '.planning', 'experiment.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest should exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.experiment_id, 'manifest-check');
    assert.equal(manifest.runtime, 'codex');
    assert.ok(manifest.created_at, 'should have created_at timestamp');
    assert.match(manifest.created_at, /^\d{4}-\d{2}-\d{2}T/, 'ISO timestamp shape');
  });
});

// ── newExperiment — guards ──────────────────────────────────────────────────

describe('newExperiment — safety guards', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('refuses to clobber an existing experiment folder', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    const first = experiment.newExperiment('dup-test', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });
    assert.equal(first.error, undefined);

    const second = experiment.newExperiment('dup-test', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });
    assert.match(second.error || '', /exists|already/i, 'should refuse clobber');
  });

  test('refuses path inside PAN source repo', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    const result = experiment.newExperiment('source-poisoning', {
      root: PAN_SOURCE_ROOT, // attempt to write inside source!
      ideaPath,
      runtime: 'claude',
      skipInstaller: true,
    });
    assert.match(result.error || '', /source.*repo|PAN_SOURCE_ROOT|inside.*source/i,
      'should refuse to write inside source repo');
  });

  test('rejects invalid slug (uppercase)', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    const result = experiment.newExperiment('BadSlug', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });
    assert.match(result.error || '', /slug|invalid|lowercase/i);
  });

  test('rejects slug longer than 40 chars', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    const longSlug = 'a'.repeat(41);
    const result = experiment.newExperiment(longSlug, {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });
    assert.match(result.error || '', /slug|too.long|40/i);
  });

  test('errors when ideaPath does not exist', () => {
    const result = experiment.newExperiment('no-idea', {
      root: tmpRoot,
      ideaPath: path.join(tmpRoot, 'nonexistent.md'),
      runtime: 'claude',
      skipInstaller: true,
    });
    assert.match(result.error || '', /idea.*not.*found|not.*exist|ENOENT/i);
  });
});

// ── listExperiments ──────────────────────────────────────────────────────────

describe('listExperiments', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('returns empty list when root is empty', () => {
    const result = experiment.listExperiments({ root: tmpRoot });
    assert.deepEqual(result.experiments, []);
    assert.equal(result.count, 0);
  });

  test('lists multiple experiments with metadata', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    experiment.newExperiment('exp-a', { root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true });
    experiment.newExperiment('exp-b', { root: tmpRoot, ideaPath, runtime: 'gemini', skipInstaller: true });

    const result = experiment.listExperiments({ root: tmpRoot });
    assert.equal(result.count, 2);
    const ids = result.experiments.map(e => e.experiment_id).sort();
    assert.deepEqual(ids, ['exp-a', 'exp-b']);

    // Each experiment should have minimum metadata
    for (const exp of result.experiments) {
      assert.ok(exp.experiment_id);
      assert.ok(exp.runtime);
      assert.ok(exp.created_at);
      assert.ok(exp.path);
    }
  });

  test('hides soft-pruned (archived) experiments by default; --include-archived returns them', () => {
    // Use a fresh root so prior tests' residue doesn't pollute counts.
    const isolatedRoot = makeTempRoot();
    try {
      const ideaPath = writeIdeaFile(isolatedRoot);
      experiment.newExperiment('alive-1', { root: isolatedRoot, ideaPath, runtime: 'claude', skipInstaller: true });
      experiment.newExperiment('to-archive', { root: isolatedRoot, ideaPath, runtime: 'claude', skipInstaller: true });

      experiment.pruneExperiment('to-archive', { root: isolatedRoot });

      const defaultList = experiment.listExperiments({ root: isolatedRoot });
      assert.equal(defaultList.count, 1, 'archived experiment should be hidden by default');
      assert.equal(defaultList.experiments[0].experiment_id, 'alive-1');

      const allList = experiment.listExperiments({ root: isolatedRoot, includeArchived: true });
      assert.equal(allList.count, 2, 'both experiments visible with includeArchived: true');
    } finally {
      rmrf(isolatedRoot);
    }
  });
});

// ── getExperimentManifest ────────────────────────────────────────────────────

describe('getExperimentManifest', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('reads back the manifest written by newExperiment', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    experiment.newExperiment('manifest-read', {
      root: tmpRoot, ideaPath, runtime: 'opencode', skipInstaller: true,
    });

    const manifest = experiment.getExperimentManifest('manifest-read', { root: tmpRoot });
    assert.equal(manifest.experiment_id, 'manifest-read');
    assert.equal(manifest.runtime, 'opencode');
    assert.ok(manifest.created_at);
  });

  test('returns error for unknown slug', () => {
    const result = experiment.getExperimentManifest('does-not-exist', { root: tmpRoot });
    assert.match(result.error || '', /not.*found|not.*exist/i);
  });
});

// ── harvestExperiment (W3) ──────────────────────────────────────────────────

describe('harvestExperiment — W3', () => {
  let tmpRoot;
  let tmpHarvestRoot;

  before(() => {
    tmpRoot = makeTempRoot();
    tmpHarvestRoot = makeTempRoot();
  });
  after(() => {
    rmrf(tmpRoot);
    rmrf(tmpHarvestRoot);
  });

  test('exports harvestExperiment and pruneExperiment', () => {
    assert.equal(typeof experiment.harvestExperiment, 'function');
    assert.equal(typeof experiment.pruneExperiment, 'function');
  });

  test('copies idea + manifest + state.md to harvest dir and writes harvest.json', () => {
    const ideaPath = writeIdeaFile(tmpRoot, '# Idea: harvest-test\n## Problem\nfoo\n');
    experiment.newExperiment('harvest-1', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });

    // Simulate the external session having written some state
    const expPlanning = path.join(tmpRoot, 'harvest-1', '.planning');
    fs.writeFileSync(path.join(expPlanning, 'state.md'), '# State\nstatus: done\n');
    fs.writeFileSync(path.join(expPlanning, 'agent-history.json'),
      JSON.stringify({ version: '1.0', entries: [{ agent_id: 'a1', status: 'completed' }] }));

    const result = experiment.harvestExperiment('harvest-1', {
      root: tmpRoot,
      sourceRoot: tmpHarvestRoot,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.experiment_id, 'harvest-1');
    assert.ok(result.harvest_path);
    assert.ok(Array.isArray(result.harvested_paths));
    assert.ok(result.harvested_paths.length > 0, 'should harvest at least the idea + manifest');
    assert.ok(typeof result.total_bytes === 'number');
    assert.ok(result.harvested_at, 'should record harvest timestamp');

    // Verify files exist at harvest location
    const harvestDir = path.join(tmpHarvestRoot, 'experiments', 'harvest-1');
    assert.ok(fs.existsSync(path.join(harvestDir, 'harvest.json')), 'harvest.json should exist');
    assert.ok(fs.existsSync(path.join(harvestDir, '.planning', 'idea.md')), 'idea.md harvested');
    assert.ok(fs.existsSync(path.join(harvestDir, '.planning', 'experiment.json')), 'manifest harvested');
    assert.ok(fs.existsSync(path.join(harvestDir, '.planning', 'state.md')), 'state.md harvested');
  });

  test('handles experiments with no .planning/optimization/ gracefully', () => {
    const ideaPath = writeIdeaFile(tmpRoot, '# Idea: no-trace\n');
    experiment.newExperiment('no-trace', {
      root: tmpRoot, ideaPath, runtime: 'codex', skipInstaller: true,
    });

    const result = experiment.harvestExperiment('no-trace', {
      root: tmpRoot,
      sourceRoot: tmpHarvestRoot,
    });
    assert.equal(result.error, undefined,
      'should succeed even if optional sources (optimization/) are absent');
  });

  test('returns error when experiment does not exist', () => {
    const result = experiment.harvestExperiment('nonexistent', {
      root: tmpRoot,
      sourceRoot: tmpHarvestRoot,
    });
    assert.match(result.error || '', /not.*found|not.*exist/i);
  });

  test('refuses to overwrite existing harvest without --force', () => {
    const ideaPath = writeIdeaFile(tmpRoot, '# Idea: overwrite-test\n');
    experiment.newExperiment('overwrite-test', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });

    // First harvest
    const first = experiment.harvestExperiment('overwrite-test', {
      root: tmpRoot, sourceRoot: tmpHarvestRoot,
    });
    assert.equal(first.error, undefined);

    // Second harvest without force — should refuse
    const second = experiment.harvestExperiment('overwrite-test', {
      root: tmpRoot, sourceRoot: tmpHarvestRoot,
    });
    assert.match(second.error || '', /exists|already|force/i);

    // Second with force — should succeed
    const third = experiment.harvestExperiment('overwrite-test', {
      root: tmpRoot, sourceRoot: tmpHarvestRoot, force: true,
    });
    assert.equal(third.error, undefined);
  });
});

// ── pruneExperiment (W3) ────────────────────────────────────────────────────

describe('pruneExperiment — W3', () => {
  let tmpRoot;

  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  test('soft-prune renames experiment to <slug>-archived-<ts>', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    experiment.newExperiment('prune-soft', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });

    const result = experiment.pruneExperiment('prune-soft', { root: tmpRoot });
    assert.equal(result.error, undefined);
    assert.equal(result.mode, 'soft');
    assert.ok(result.archive_path);
    assert.ok(fs.existsSync(result.archive_path), 'archive folder should exist');
    assert.ok(!fs.existsSync(path.join(tmpRoot, 'prune-soft')),
      'original folder should be renamed away');
  });

  test('hard-prune removes the folder entirely', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    experiment.newExperiment('prune-hard', {
      root: tmpRoot, ideaPath, runtime: 'claude', skipInstaller: true,
    });
    const expPath = path.join(tmpRoot, 'prune-hard');
    assert.ok(fs.existsSync(expPath));

    const result = experiment.pruneExperiment('prune-hard', { root: tmpRoot, hard: true });
    assert.equal(result.error, undefined);
    assert.equal(result.mode, 'hard');
    assert.ok(!fs.existsSync(expPath), 'experiment folder should be deleted');
  });

  test('returns error when experiment does not exist', () => {
    const result = experiment.pruneExperiment('does-not-exist', { root: tmpRoot });
    assert.match(result.error || '', /not.*found|not.*exist/i);
  });
});

// ── initExperimentGit (P-EXP-001 fix, v3.7.9) ──────────────────────────────
//
// newExperiment must produce a git-initialized folder with local user.email
// and user.name configured, so the autonomous loop's pan-tools commit calls
// don't silently fail with `commit_failed`. whoocache hit this exactly —
// 24 min of work, no commits, exit code 0 throughout.

describe('newExperiment — git initialization (P-EXP-001 fix)', () => {
  let tmpRoot;
  before(() => { tmpRoot = makeTempRoot(); });
  after(() => { rmrf(tmpRoot); });

  function readGitConfig(repoPath, key) {
    const { execFileSync } = require('child_process');
    try {
      return execFileSync('git', ['config', '--local', '--get', key], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      }).trim();
    } catch { return ''; }
  }

  function isGitRepo(repoPath) {
    return fs.existsSync(path.join(repoPath, '.git'));
  }

  test('initializes a git repo in the experiment folder', () => {
    const ideaPath = writeIdeaFile(tmpRoot);
    const result = experiment.newExperiment('git-init-test', {
      root: tmpRoot,
      ideaPath,
      runtime: 'claude',
      skipInstaller: true,
    });
    assert.equal(result.error, undefined);
    assert.ok(isGitRepo(result.path), 'experiment folder should be a git repo');
  });

  test('configures local user.email and user.name', () => {
    const ideaPath = writeIdeaFile(tmpRoot, '# Idea: identity-check\n');
    const result = experiment.newExperiment('identity-check', {
      root: tmpRoot,
      ideaPath,
      runtime: 'claude',
      skipInstaller: true,
    });
    assert.equal(result.error, undefined);
    const email = readGitConfig(result.path, 'user.email');
    const name = readGitConfig(result.path, 'user.name');
    assert.ok(email.length > 0, 'user.email should be set');
    assert.ok(name.length > 0, 'user.name should be set');
  });

  test('produces a folder where `git commit` actually succeeds', () => {
    const { execFileSync } = require('child_process');
    const ideaPath = writeIdeaFile(tmpRoot, '# Idea: commit-test\n');
    const result = experiment.newExperiment('commit-test', {
      root: tmpRoot,
      ideaPath,
      runtime: 'claude',
      skipInstaller: true,
    });
    assert.equal(result.error, undefined);

    // Stage and commit something. With identity unconfigured this throws.
    fs.writeFileSync(path.join(result.path, 'sentinel.txt'), 'hello\n');
    const run = (args) => execFileSync('git', args, {
      cwd: result.path,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });

    run(['add', 'sentinel.txt']);
    run(['commit', '-m', 'test: sentinel commit']);
    const log = run(['log', '--oneline']).trim();
    assert.match(log, /sentinel commit/, 'commit should land');
  });
});
