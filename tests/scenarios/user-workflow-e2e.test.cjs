/**
 * Full User Workflow E2E Tests (ADR-0019: UAT-005)
 *
 * Simulates a realistic multi-step user journey from an installed PAN instance:
 * install → setup project → config → add phases → list → state mutations →
 * snapshot → health check → utility commands.
 *
 * Validates that the entire sequence produces coherent, non-corrupted state.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

/**
 * Set up minimal .planning/ project structure for workflow testing.
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

describe('Full user workflow: install → configure → build → verify', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    setupProject(runner.tmpDir);
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  // Step 1: Ensure config exists
  test('step 1: config-ensure-section creates config.json', () => {
    const result = runner.run('config-ensure-section');
    assert.ok(result.success, `config-ensure-section failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok('created' in parsed || 'exists' in parsed || 'ensured' in parsed,
      'should return config status');
    // Verify file exists on disk
    const configPath = path.join(runner.tmpDir, '.planning', 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should exist on disk');
  });

  // Step 2: Add first phase
  test('step 2: phase add creates first phase (authentication)', () => {
    const result = runner.run('phase add authentication');
    assert.ok(result.success, `phase add failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phase || parsed.added || parsed.directory,
      'should indicate phase was added');
  });

  // Step 3: Add second phase
  test('step 3: phase add creates second phase (api-layer)', () => {
    const result = runner.run('phase add api-layer');
    assert.ok(result.success, `phase add failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phase || parsed.added || parsed.directory,
      'should indicate second phase was added');
  });

  // Step 4: List phases — should show both
  test('step 4: phases list returns both phases', () => {
    const result = runner.run('phases list');
    assert.ok(result.success, `phases list failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.directories, 'should have directories array');
    assert.ok(Array.isArray(parsed.directories), 'directories should be array');
    assert.ok(parsed.directories.length >= 2,
      `should have >= 2 phases, got ${parsed.directories.length}`);
  });

  // Step 5: Add a decision to state
  test('step 5: state add-decision records a decision', () => {
    const result = runner.run('state add-decision --summary use-jwt-for-auth');
    assert.ok(result.success, `add-decision failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.added || parsed.decision,
      'should indicate decision was added');
  });

  // Step 6: Verify state.md wasn't corrupted by the decision
  test('step 6: state.md retains all sections after decision', () => {
    const content = fs.readFileSync(
      path.join(runner.tmpDir, '.planning', 'state.md'), 'utf8');
    assert.ok(content.includes('## Decisions'), 'Decisions section should exist');
    assert.ok(content.includes('## Blockers'), 'Blockers section should exist');
    assert.ok(content.includes('use-jwt-for-auth'), 'Decision should be recorded');
  });

  // Step 7: State snapshot — should reflect all accumulated changes
  test('step 7: state-snapshot reflects accumulated state', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `state-snapshot failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status field');
  });

  // Step 8: Validate health
  test('step 8: validate health passes', () => {
    const result = runner.run('validate health');
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status field');
  });

  // Step 9: Utility command works in workflow context
  test('step 9: generate-slug works after workflow operations', () => {
    const result = runner.run('generate-slug my-feature-name');
    assert.ok(result.success, `generate-slug failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.slug, 'my-feature-name');
  });

  // Step 10: Final state json — complete state dump is valid
  test('step 10: state json returns complete valid state', () => {
    const result = runner.run('state json');
    assert.ok(result.success, `state json failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status');
    assert.ok(parsed.pan_state_version, 'should have pan_state_version');
  });
});

describe('Copilot workflow: install → basic operations', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('copilot');
    setupProject(runner.tmpDir);
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('config-ensure-section works from Copilot install', () => {
    const result = runner.run('config-ensure-section');
    assert.ok(result.success, `config-ensure-section failed: ${result.error}`);
  });

  test('phase add works from Copilot install', () => {
    const result = runner.run('phase add copilot-test');
    assert.ok(result.success, `phase add failed: ${result.error}`);
  });

  test('state-snapshot works from Copilot install', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `state-snapshot failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status');
  });
});
