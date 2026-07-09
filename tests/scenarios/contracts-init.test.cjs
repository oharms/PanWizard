'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { assertSchema } = require('../contracts/assert-schema.cjs');

describe('E2E Init Workflow Contracts', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    // Set up a project with phases for init commands
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), '---\nStatus: In progress\nCurrent Phase: 01\n---\n');
    fs.writeFileSync(path.join(pd, 'roadmap.md'),
      '| Phase | Name | Status |\n|---|---|---|\n| 01 | setup | Not started |\n');
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: true }));
  });

  after(() => { runner.cleanup(); });

  test('init new-project returns project analysis JSON', () => {
    const result = runner.run('init new-project --name InitTest');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['project_exists', 'planning_exists', 'has_git', 'commit_docs'],
      types: { project_exists: 'boolean', planning_exists: 'boolean', commit_docs: 'boolean' },
    });
  });

  test('init execute-phase returns phase execution context', () => {
    const result = runner.run('init execute-phase 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['executor_model', 'commit_docs'],
      types: { executor_model: 'string', commit_docs: 'boolean' },
    });
  });

  test('init plan-phase returns planning context', () => {
    const result = runner.run('init plan-phase 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['researcher_model', 'phase_found', 'commit_docs'],
      types: { researcher_model: 'string', phase_found: 'boolean', commit_docs: 'boolean' },
    });
  });

  test('init verify-work returns verification context', () => {
    const result = runner.run('init verify-work 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['phase_found', 'commit_docs'],
      types: { phase_found: 'boolean', commit_docs: 'boolean' },
    });
  });

  test('init quick returns quick-task context', () => {
    const result = runner.run('init quick');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['executor_model', 'commit_docs'],
      types: { executor_model: 'string', commit_docs: 'boolean' },
    });
  });

  test('init resume returns session resume context', () => {
    const result = runner.run('init resume');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['state_exists', 'roadmap_exists', 'planning_exists'],
      types: { state_exists: 'boolean', roadmap_exists: 'boolean', planning_exists: 'boolean' },
    });
  });

  test('init execute-phase without phase number returns error', () => {
    const result = runner.run('init execute-phase');
    assert.ok(!result.success, 'should fail without phase number');
    assert.ok(result.error.includes('phase required') || result.error.includes('required'),
      'error should mention phase requirement');
  });

  test('init plan-phase without phase number returns error', () => {
    const result = runner.run('init plan-phase');
    assert.ok(!result.success, 'should fail without phase number');
    assert.ok(result.error.includes('phase required') || result.error.includes('required'),
      'error should mention phase requirement');
  });
});
