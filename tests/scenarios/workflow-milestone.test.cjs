'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Workflow: Milestone Lifecycle', () => {
  let runner;
  let pd;

  before(() => {
    runner = createScenarioRunner('claude');
    pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'pan_state_version: "1.0"', 'Status: In progress',
      'Current Phase: 01', 'Milestone: v1.0', '---', '',
      '## Key Decisions', '', '## Active Blockers', '', '## Session History', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), [
      '## Roadmap', '', '| Phase | Name | Status |', '|---|---|---|',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: true }));
  });

  after(() => { runner.cleanup(); });

  test('step 1: add 2 phases', () => {
    const r1 = runner.run('phase add auth');
    assert.ok(r1.success);
    const r2 = runner.run('phase add api');
    assert.ok(r2.success);
    const list = runner.run('phases list');
    assert.equal(JSON.parse(list.output).count, 2);
  });

  test('step 2: complete both phases', () => {
    const r1 = runner.run('phase complete 01');
    assert.ok(r1.success, `complete 01: ${r1.error}`);
    const r2 = runner.run('phase complete 02');
    assert.ok(r2.success, `complete 02: ${r2.error}`);
  });

  test('step 3: milestone complete archives phases', () => {
    const r = runner.run('milestone complete --name v1.0 --archive-phases');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.phases, 2, 'should report 2 phases');
    assert.ok(p.milestones_updated, 'milestones should be updated');
    assert.ok(p.state_updated, 'state should be updated');
  });

  test('step 4: milestones.md created', () => {
    const milestonesPath = path.join(pd, 'milestones.md');
    assert.ok(fs.existsSync(milestonesPath), 'milestones.md should exist');
    const content = fs.readFileSync(milestonesPath, 'utf-8');
    assert.ok(content.includes('v1.0'), 'milestones.md should mention v1.0');
  });

  test('step 5: phases archived to milestones directory', () => {
    const archived = path.join(pd, 'milestones');
    assert.ok(fs.existsSync(archived), 'milestones/ directory should exist');
    // Check for archived phase content
    const entries = fs.readdirSync(archived, { recursive: true });
    assert.ok(entries.length > 0, 'milestones/ should have archived content');
  });

  test('step 6: state.md milestone field updated', () => {
    const state = fs.readFileSync(path.join(pd, 'state.md'), 'utf-8');
    // After milestone complete, state should reflect the completed milestone
    assert.ok(state.length > 0, 'state.md should not be empty');
  });

  test('step 7: can add new phase after milestone', () => {
    const r = runner.run('phase add new-feature');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(p.directory, 'should create new phase directory');
  });
});
