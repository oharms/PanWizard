'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Feedback: Output Safety', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'Status: In progress', 'Current Phase: 01', '---', '',
      '## Key Decisions', '', '## Active Blockers', '', '## Session History', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), '## Roadmap\n\n| Phase | Name | Status |\n|---|---|---|\n| 01 | setup | Not started |\n');
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
  });

  after(() => { runner.cleanup(); });

  test('FL-008: Success outputs parse as valid JSON', () => {
    const cmds = ['state json', 'phases list', 'roadmap analyze', 'validate health', 'state-snapshot'];
    for (const cmd of cmds) {
      const r = runner.run(cmd);
      if (r.success && r.output) {
        assert.doesNotThrow(() => JSON.parse(r.output), `${cmd} should return valid JSON`);
      }
    }
  });

  test('FL-009: No absolute paths leaked in JSON output', () => {
    const cmds = ['state json', 'phases list', 'validate health', 'roadmap analyze'];
    for (const cmd of cmds) {
      const r = runner.run(cmd);
      if (r.success && r.output) {
        // Should not contain absolute paths like C:\ or /tmp/
        assert.ok(!r.output.includes(runner.tmpDir.replace(/\\/g, '\\\\')),
          `${cmd} should not leak absolute paths`);
        // Check for common absolute path patterns
        assert.ok(!r.output.includes('C:\\\\Users\\\\'),
          `${cmd} should not contain Windows absolute paths`);
      }
    }
  });

  test('FL-010: Error outputs have error field (not raw stack traces)', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-errfield-'));
    fs.mkdirSync(path.join(emptyDir, '.planning'), { recursive: true });
    const r = runner.run('state json', emptyDir);
    if (r.output) {
      const p = JSON.parse(r.output);
      if (p.error) {
        assert.equal(typeof p.error, 'string', 'error should be string');
        assert.ok(!p.error.includes('at '), 'error should not contain stack trace');
        assert.ok(!p.error.includes('.cjs:'), 'error should not contain file:line references');
      }
    }
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('FL-011: --raw on state json falls back to the JSON body', () => {
    const r = runner.run('state json --raw');
    // Measured 2026-09-17: `state json` passes an EMPTY raw template to output(),
    // so --raw changes nothing — stdout is the same pretty-printed JSON as without
    // the flag, exit 0. Asserted as measured; the flag's no-op here is reported,
    // not "fixed".
    assert.equal(r.success, true, `state json --raw should exit 0: ${r.error}`);
    const withoutRaw = runner.run('state json');
    assert.equal(r.output, withoutRaw.output, '--raw produces byte-identical output for state json');
    const p = JSON.parse(r.output);
    assert.equal(p.Status, 'In progress', 'the fixture state.md is what was parsed');
  });

  test('FL-012: No console.log leaks mixed into JSON', () => {
    const cmds = ['validate health', 'focus sync', 'state-snapshot'];
    for (const cmd of cmds) {
      const r = runner.run(cmd);
      if (r.success && r.output) {
        const trimmed = r.output.trim();
        // Valid JSON should parse cleanly — any console.log would break parsing
        assert.doesNotThrow(() => JSON.parse(trimmed),
          `${cmd} output should be clean JSON without console.log leaks`);
      }
    }
  });
});
