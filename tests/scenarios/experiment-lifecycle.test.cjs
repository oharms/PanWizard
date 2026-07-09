/**
 * Scenario: end-to-end experiment lifecycle (mocked external subprocess).
 *
 * Spec: docs/specs/self_improvement_loop_featureai.md §3.9
 * v3.7.0 W1-W3 — verifies new -> manifest -> run (mocked) -> status -> harvest -> prune.
 *
 * Uses node as a fake external runtime via runtimeOverride. No real Claude Code
 * subprocess is spawned. The integration test in tests/integration/ (gated by
 * PAN_REAL_EXPERIMENT=1) covers real subprocess behavior.
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const experiment = require('../../pan-wizard-core/bin/lib/experiment.cjs');
const runner = require('../../pan-wizard-core/bin/lib/runner.cjs');

describe('experiment lifecycle: new -> run -> status -> harvest -> prune', () => {
  let tmpExpRoot;
  let tmpHarvestRoot;

  before(() => {
    tmpExpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lifecycle-exp-'));
    tmpHarvestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lifecycle-harvest-'));
  });
  after(() => {
    if (fs.existsSync(tmpExpRoot)) fs.rmSync(tmpExpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (fs.existsSync(tmpHarvestRoot)) fs.rmSync(tmpHarvestRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('step 1: scaffold experiment from idea doc', () => {
    const ideaPath = path.join(tmpExpRoot, 'lifecycle-idea.md');
    fs.writeFileSync(ideaPath, '# Idea: lifecycle\n## Problem\nverify e2e\n## Success\nharvest manifest exists\n');

    const result = experiment.newExperiment('lifecycle', {
      root: tmpExpRoot,
      ideaPath,
      runtime: 'claude',
      skipInstaller: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.experiment_id, 'lifecycle');
    assert.ok(fs.existsSync(path.join(result.path, '.planning', 'idea.md')));
  });

  test('step 2: read manifest and verify metadata', () => {
    const manifest = experiment.getExperimentManifest('lifecycle', { root: tmpExpRoot });
    assert.equal(manifest.error, undefined);
    assert.equal(manifest.experiment_id, 'lifecycle');
    assert.equal(manifest.runtime, 'claude');
    assert.equal(manifest.status, 'scaffolded');
  });

  test('step 3: run experiment with mocked subprocess (success path)', () => {
    const result = runner.runExperiment('lifecycle', {
      root: tmpExpRoot,
      runtimeOverride: {
        bin: 'node',
        buildArgs: () => ['-e', 'process.stdout.write("mock build done\\n"); process.exit(0)'],
      },
      timeoutMs: 5000,
      prompt: '/pan:new-project --auto',
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 'done');
    assert.equal(result.stop_reason, 'success');
    assert.equal(result.exit_code, 0);
  });

  test('step 4: status reflects the completed run', () => {
    const state = runner.tailExperimentState('lifecycle', { root: tmpExpRoot });
    assert.equal(state.error, undefined);
    assert.equal(state.status, 'done');
    assert.equal(state.exit_code, 0);
    assert.ok(state.events.length >= 2,
      `should have at least started + completed events, got ${state.events.length}`);
  });

  test('step 5: simulate external session output then harvest', () => {
    // Pretend the external session wrote some state files
    const expPlanning = path.join(tmpExpRoot, 'lifecycle', '.planning');
    fs.writeFileSync(path.join(expPlanning, 'state.md'), '# State\nstatus: done\n');

    const harvest = experiment.harvestExperiment('lifecycle', {
      root: tmpExpRoot,
      sourceRoot: tmpHarvestRoot,
    });
    assert.equal(harvest.error, undefined);
    assert.equal(harvest.experiment_id, 'lifecycle');
    assert.ok(harvest.harvested_paths.length >= 4,
      `should harvest >= 4 paths (idea, manifest, state, run-state), got ${harvest.harvested_paths.length}`);

    // Harvest manifest exists at destination
    const harvestManifestPath = path.join(tmpHarvestRoot, 'experiments', 'lifecycle', 'harvest.json');
    assert.ok(fs.existsSync(harvestManifestPath), 'harvest.json should exist');

    // Idea is preserved
    const harvestedIdea = path.join(tmpHarvestRoot, 'experiments', 'lifecycle', '.planning', 'idea.md');
    assert.ok(fs.existsSync(harvestedIdea), 'idea.md should be in harvest');
    const ideaContent = fs.readFileSync(harvestedIdea, 'utf-8');
    assert.match(ideaContent, /lifecycle/);

    // Run-state is preserved (proves W2 + W3 integration)
    const harvestedRunState = path.join(tmpHarvestRoot, 'experiments', 'lifecycle', '.planning', 'run-state.json');
    assert.ok(fs.existsSync(harvestedRunState), 'run-state.json should be in harvest');
  });

  test('step 6: prune (soft) archives the experiment folder', () => {
    const result = experiment.pruneExperiment('lifecycle', { root: tmpExpRoot });
    assert.equal(result.error, undefined);
    assert.equal(result.mode, 'soft');
    assert.ok(result.archive_path);
    assert.ok(fs.existsSync(result.archive_path), 'archive folder should exist');
    assert.ok(!fs.existsSync(path.join(tmpExpRoot, 'lifecycle')),
      'original experiment folder should be renamed away');
  });
});
