'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Cross-Runtime Parity', () => {
  const runtimes = ['claude', 'copilot'];
  const runners = {};

  before(() => {
    for (const rt of runtimes) {
      const runner = createScenarioRunner(rt);
      const pd = path.join(runner.tmpDir, '.planning');
      fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(pd, 'state.md'), [
        '---', 'Status: In progress', 'Current Phase: 01', '---', '',
        '## Key Decisions', '', '## Active Blockers', '', '## Session History', '',
      ].join('\n'));
      fs.writeFileSync(path.join(pd, 'roadmap.md'), '## Roadmap\n\n| Phase | Name | Status |\n|---|---|---|\n');
      fs.writeFileSync(path.join(pd, 'config.json'), '{}');
      runners[rt] = runner;
    }
  });

  after(() => {
    for (const rt of runtimes) {
      runners[rt].cleanup();
    }
  });

  test('phase add produces identical JSON fields across runtimes', () => {
    const results = {};
    for (const rt of runtimes) {
      const r = runners[rt].run('phase add parity-test');
      assert.ok(r.success, `${rt}: should succeed: ${r.error}`);
      results[rt] = JSON.parse(r.output);
    }
    // Both should have same fields
    const claudeKeys = Object.keys(results.claude).sort();
    const copilotKeys = Object.keys(results.copilot).sort();
    assert.deepStrictEqual(claudeKeys, copilotKeys, 'field names should match across runtimes');
  });

  test('state json produces identical field structure', () => {
    const results = {};
    for (const rt of runtimes) {
      const r = runners[rt].run('state json');
      assert.ok(r.success, `${rt}: should succeed`);
      results[rt] = JSON.parse(r.output);
    }
    const claudeKeys = Object.keys(results.claude).sort();
    const copilotKeys = Object.keys(results.copilot).sort();
    assert.deepStrictEqual(claudeKeys, copilotKeys, 'state json fields should match');
  });

  test('validate health returns same status enum across runtimes', () => {
    for (const rt of runtimes) {
      const r = runners[rt].run('validate health');
      assert.ok(r.success, `${rt}: should succeed`);
      const p = JSON.parse(r.output);
      assert.ok(['healthy', 'degraded', 'broken'].includes(p.status),
        `${rt}: status should be valid enum, got "${p.status}"`);
    }
  });

  test('paths use forward slashes across runtimes', () => {
    for (const rt of runtimes) {
      const r = runners[rt].run('phases list');
      assert.ok(r.success, `${rt}: should succeed`);
      const p = JSON.parse(r.output);
      for (const dir of p.directories) {
        assert.ok(!dir.includes('\\'), `${rt}: path "${dir}" should use forward slashes`);
      }
    }
  });
});
