/**
 * State Integrity Scenario Tests
 *
 * Install → setup → add-decision → add-blocker → state-snapshot
 * → verify all fields present and consistent.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('State integrity: multi-command sequence', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const planDir = path.join(runner.tmpDir, '.planning');
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
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('initial state-snapshot is valid JSON', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `state-snapshot failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status');
  });

  test('add-decision writes to state.md without corruption', () => {
    const result = runner.run('state add-decision --summary architecture-chosen');
    assert.ok(result.success, `add-decision failed: ${result.error}`);

    // Verify state.md is still readable
    const stateContent = fs.readFileSync(
      path.join(runner.tmpDir, '.planning', 'state.md'), 'utf8');
    assert.ok(stateContent.includes('architecture-chosen'),
      'state.md should contain the decision');
    assert.ok(stateContent.includes('## Decisions'),
      'state.md should still have Decisions section');
    assert.ok(stateContent.includes('## Blockers'),
      'state.md should still have Blockers section');
  });

  test('add-blocker writes to state.md without corruption', () => {
    const result = runner.run('state add-blocker --text dependency-missing');
    assert.ok(result.success, `add-blocker failed: ${result.error}`);

    const stateContent = fs.readFileSync(
      path.join(runner.tmpDir, '.planning', 'state.md'), 'utf8');
    assert.ok(stateContent.includes('dependency-missing'),
      'state.md should contain the blocker');
    assert.ok(stateContent.includes('## Decisions'),
      'state.md should still have Decisions section');
    assert.ok(stateContent.includes('architecture-chosen'),
      'state.md should still have the previous decision');
  });

  test('state json reflects all accumulated data', () => {
    const result = runner.run('state json');
    assert.ok(result.success, `state json failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status');
    assert.ok(parsed.pan_state_version, 'should have version');
  });

  test('state-snapshot after mutations is still valid', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `state-snapshot failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.status, 'should have status');
    assert.ok(parsed.decision_count >= 1 || parsed.decisions !== undefined,
      'should reflect decisions');
  });

  test('phase add after state mutations does not corrupt state', () => {
    const addResult = runner.run('phase add integrity-test');
    assert.ok(addResult.success, `phase add failed: ${addResult.error}`);

    // Re-check state.md is intact
    const stateContent = fs.readFileSync(
      path.join(runner.tmpDir, '.planning', 'state.md'), 'utf8');
    assert.ok(stateContent.includes('## Decisions'), 'Decisions section intact');
    assert.ok(stateContent.includes('## Blockers'), 'Blockers section intact');
    assert.ok(stateContent.includes('architecture-chosen'), 'decision still present');
  });
});
