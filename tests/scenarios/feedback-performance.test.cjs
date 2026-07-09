'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Feedback: Performance Sanity', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'Status: In progress', 'Current Phase: 01', '---', '',
      '## Key Decisions', '', '## Active Blockers', '', '## Session History', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), '## Roadmap\n\n| Phase | Name | Status |\n|---|---|---|\n');
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
    // Create 10 phases for performance test
    for (let i = 1; i <= 10; i++) {
      const num = i.toString().padStart(2, '0');
      runner.run(`phase add perf-${num}`);
    }
  });

  after(() => { runner.cleanup(); });

  // Thresholds are a regression-canary, not a benchmark. Each runner.run()
  // spawns `node pan-tools.cjs <cmd>` — that's ~300-500ms of node startup
  // overhead on Windows before the command logic runs at all. Pre-2026-05
  // thresholds (500/1000) flaked under any CPU contention. The current values
  // still catch genuine O(n²) regressions (which push elapsed into 10s+)
  // while tolerating a busy dev machine.

  test('state json completes in < 2000ms', () => {
    const start = Date.now();
    const r = runner.run('state json');
    const elapsed = Date.now() - start;
    assert.ok(r.success, `should succeed: ${r.error}`);
    assert.ok(elapsed < 2000, `state json took ${elapsed}ms, should be < 2000ms`);
  });

  test('phases list (10 phases) completes in < 3000ms', () => {
    const start = Date.now();
    const r = runner.run('phases list');
    const elapsed = Date.now() - start;
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.count, 10, 'should have 10 phases');
    assert.ok(elapsed < 3000, `phases list took ${elapsed}ms, should be < 3000ms`);
  });

  test('focus scan (10 phases) completes in < 5000ms', () => {
    const start = Date.now();
    const r = runner.run('focus scan');
    const elapsed = Date.now() - start;
    assert.ok(r.success, `should succeed: ${r.error}`);
    assert.ok(elapsed < 5000, `focus scan took ${elapsed}ms, should be < 5000ms`);
  });

  test('validate health completes in < 3000ms', () => {
    const start = Date.now();
    const r = runner.run('validate health');
    const elapsed = Date.now() - start;
    assert.ok(r.success, `should succeed: ${r.error}`);
    assert.ok(elapsed < 3000, `validate health took ${elapsed}ms, should be < 3000ms`);
  });
});
