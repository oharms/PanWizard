'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Workflow: Phase Lifecycle', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
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

  test('step 1: phase add "auth" creates phase 01', () => {
    const r = runner.run('phase add auth');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(p.directory.includes('01'), 'first phase should be 01');
    assert.equal(p.name, 'auth');
  });

  test('step 2: phase add "api" creates phase 02', () => {
    const r = runner.run('phase add api');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.ok(p.directory.includes('02'), 'second phase should be 02');
  });

  test('step 3: phase add "ui" creates phase 03', () => {
    const r = runner.run('phase add ui');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.ok(p.directory.includes('03'));
  });

  test('step 4: phase insert 01 "setup" creates 01.1', () => {
    const r = runner.run('phase insert 01 setup');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(p.directory.includes('01.1'), `should create 01.1, got ${p.directory}`);
  });

  test('step 5: phases list shows 4 phases', () => {
    const r = runner.run('phases list');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.equal(p.count, 4, `should have 4 phases (01, 01.1, 02, 03), got ${p.count}`);
  });

  test('step 6: phase complete 01 marks it done in roadmap', () => {
    const r = runner.run('phase complete 01');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.completed_phase, '01');
    assert.ok(p.roadmap_updated, 'roadmap should be updated');
  });

  test('step 7: phase remove 02 succeeds', () => {
    const r = runner.run('phase remove 02');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(p.roadmap_updated, 'roadmap should be updated');
  });

  test('step 8: final state is consistent — phases list reflects changes', () => {
    const r = runner.run('phases list');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    // After removing 02, we should have 01, 01.1, and renumbered remaining
    assert.ok(p.count >= 2, `should have at least 2 phases remaining, got ${p.count}`);
    // Verify no corrupted roadmap
    const roadmap = fs.readFileSync(path.join(runner.tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(!roadmap.includes('undefined'), 'roadmap should not contain "undefined"');
    assert.ok(!roadmap.includes('null'), 'roadmap should not contain "null"');
  });
});
