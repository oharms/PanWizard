/**
 * Multi-Step Workflow Scenario Tests
 *
 * Validates complete user workflow sequences from installed path:
 * install → setup project files → phase add → phases list → state-snapshot
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

/**
 * Set up minimal project structure (roadmap.md, state.md)
 * so that workflow commands can operate.
 */
function setupProject(tmpDir) {
  const planDir = path.join(tmpDir, '.planning');
  fs.mkdirSync(path.join(planDir, 'phases'), { recursive: true });

  fs.writeFileSync(path.join(planDir, 'roadmap.md'), [
    '# Roadmap',
    '',
    '## Phases',
    '',
    '| # | Phase | Status | Progress |',
    '|---|-------|--------|----------|',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(planDir, 'state.md'), [
    '# Project State',
    '',
    '**Status:** Active',
    '**Last Activity:** 2026-01-01',
    '**Last Activity Description:** Initial setup',
    '',
    '## Decisions',
    '',
    '## Blockers',
    '',
  ].join('\n'));
}

describe('Workflow: phase operations from installed path', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    setupProject(runner.tmpDir);
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('config-ensure-section creates config.json', () => {
    const result = runner.run('config-ensure-section');
    assert.ok(result.success, `config-ensure-section failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok('created' in parsed || 'exists' in parsed || 'ensured' in parsed,
      'should return config status');
  });

  test('state-snapshot returns state summary', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `state-snapshot failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status field');
  });

  test('phase add creates a new phase', () => {
    const result = runner.run('phase add test-phase');
    assert.ok(result.success, `phase add failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phase || parsed.added || parsed.directory,
      'should indicate phase was added');
  });

  test('phases list shows the added phase', () => {
    const result = runner.run('phases list');
    assert.ok(result.success, `phases list failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.directories, 'should have directories array');
    assert.ok(Array.isArray(parsed.directories), 'directories should be an array');
    assert.ok(parsed.directories.length >= 1, 'should have at least 1 phase');
  });

  test('state json returns state data', () => {
    const result = runner.run('state json');
    assert.ok(result.success, `state json failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status field');
    assert.ok(parsed.pan_state_version, 'should have pan_state_version');
  });

  test('validate health returns validation result', () => {
    const result = runner.run('validate health');
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status field');
  });
});

describe('Workflow: multi-phase lifecycle', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    setupProject(runner.tmpDir);
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('add multiple phases and list them', () => {
    const r1 = runner.run('phase add auth-module');
    assert.ok(r1.success, `phase add 1 failed: ${r1.error}`);

    const r2 = runner.run('phase add api-layer');
    assert.ok(r2.success, `phase add 2 failed: ${r2.error}`);

    const list = runner.run('phases list');
    assert.ok(list.success, `phases list failed: ${list.error}`);
    const parsed = JSON.parse(list.output);
    assert.ok(parsed.directories.length >= 2, 'should have at least 2 phases');
  });

  test('state add-decision records a decision', () => {
    const result = runner.run('state add-decision --summary new-approach-selected');
    assert.ok(result.success, `add-decision failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.added || parsed.decision,
      'should indicate decision was added');
  });

  test('state-snapshot after decisions', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `state-snapshot failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status field');
  });

  test('generate-slug works in workflow context', () => {
    const result = runner.run('generate-slug my-test-slug');
    assert.ok(result.success, `generate-slug failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.slug, 'my-test-slug');
  });

  test('current-timestamp works in workflow context', () => {
    const result = runner.run('current-timestamp');
    assert.ok(result.success, `current-timestamp failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.timestamp, 'should have timestamp');
  });
});
