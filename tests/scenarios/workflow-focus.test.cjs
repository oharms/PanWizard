'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Workflow: Focus System', () => {
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

    // Add phases with frontmatter for focus to pick up
    for (let i = 1; i <= 5; i++) {
      runner.run(`phase add task-${i}`);
      const phaseDir = path.join(pd, 'phases', `0${i}-task-${i}`);
      // Add plan.md with frontmatter to create work items
      fs.writeFileSync(path.join(phaseDir, `0${i}-plan.md`), [
        '---', `effort: ${i <= 2 ? 'S' : 'M'}`, `priority: P${Math.min(i, 4)}`,
        'autonomous: true', '---', '', `# Phase ${i} Plan`, '',
        '- [ ] Task A', '- [ ] Task B',
      ].join('\n'));
    }
  });

  after(() => { runner.cleanup(); });

  test('step 1: focus scan returns valid output on project with phases', () => {
    const r = runner.run('focus scan');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok('total' in p, 'should have total field');
    assert.ok(Array.isArray(p.items), 'items should be array');
    // Focus scan may find 0 items if no TODOs in .planning/ markdown — that's valid
    assert.ok('sources' in p, 'should have sources');
  });

  test('step 2: focus plan creates a batch', () => {
    const r = runner.run('focus plan --mode balanced');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    // If items were found, should have a batch; if not, error JSON
    if (p.error) {
      assert.ok(typeof p.error === 'string', 'error should be string');
    } else {
      assert.ok('batch' in p || 'items' in p, 'should have batch or items');
    }
  });

  test('step 3: focus sync checks doc staleness', () => {
    const r = runner.run('focus sync');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(typeof p.needs_sync, 'boolean');
    assert.ok('actuals' in p, 'should have actuals');
    assert.ok('stale' in p, 'should have stale array');
  });

  test('step 4: focus sync with --tests flag includes count', () => {
    const r = runner.run('focus sync --tests 1572');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.equal(typeof p.needs_sync, 'boolean');
  });

  test('step 5: focus auto --init creates auto-run state', () => {
    const r = runner.run('focus auto --category stability --init');
    // Measured 2026-09-17: with no auto-run in flight (steps 1-4 write only
    // .planning/focus/batch-*.json), --init exits 0 and returns the initialized
    // run, and the run file it names exists on disk. A second --init would exit 1
    // with "Auto-run already in progress", so this is a one-shot assertion.
    assert.equal(r.success, true, `focus auto --init should exit 0: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.status, 'initialized');
    assert.equal(p.category, 'stability');
    assert.equal(p.source, 'scan');
    assert.deepEqual(p.cycles, []);
    assert.equal(p.totals.cycles_completed, 0);
    assert.equal(p.stop_reason, null);
    assert.equal(p.run_file, '.planning/focus/auto-run.json');
    assert.equal(fs.existsSync(path.join(pd, 'focus', 'auto-run.json')), true,
      'the run file named in the payload must exist on disk');
  });

  test('step 6: focus scan output has correct structure', () => {
    const r = runner.run('focus scan');
    assert.ok(r.success);
    const p = JSON.parse(r.output);
    assert.ok('sources' in p, 'should have sources');
    if (p.total > 0) {
      assert.ok('priorities' in p, 'should have priorities when items exist');
    }
  });
});
