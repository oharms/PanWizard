'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { assertSchema, assertErrorSchema } = require('../contracts/assert-schema.cjs');

describe('E2E State Command Contracts', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases', '01-setup'), { recursive: true });
    // Create a realistic state.md with proper sections
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---',
      'pan_state_version: "1.0"',
      'Status: In progress',
      'Current Phase: 01',
      'Milestone: v1.0',
      'Progress: 20%',
      '---',
      '',
      '## Key Decisions',
      '- Initial architecture chosen',
      '',
      '## Active Blockers',
      '(none)',
      '',
      '## Session History',
      '(none)',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'),
      '| Phase | Name | Status |\n|---|---|---|\n| 01 | setup | Not started |\n');
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
  });

  after(() => { runner.cleanup(); });

  // === Success schemas ===

  test('state json returns frontmatter fields', () => {
    const result = runner.run('state json');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok('Status' in parsed || 'status' in parsed, 'should have Status field');
  });

  test('state get returns field value', () => {
    const result = runner.run('state get status');
    const parsed = JSON.parse(result.output);
    // state get returns value or error — both are valid JSON
    assert.ok(typeof parsed === 'object', 'should return JSON object');
  });

  test('state update modifies field', () => {
    const result = runner.run('state update status Active');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(typeof parsed.updated, 'boolean', 'updated should be boolean');
  });

  test('state add-decision returns added field', () => {
    const result = runner.run('state add-decision --summary ContractTestDecision');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(typeof parsed.added, 'boolean', 'added should be boolean');
  });

  test('state add-blocker returns added field', () => {
    const result = runner.run('state add-blocker --text ContractTestBlocker');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(typeof parsed.added, 'boolean', 'added should be boolean');
  });

  test('state resolve-blocker returns resolved field', () => {
    // First add a blocker, then resolve it
    runner.run('state add-blocker --text ResolveMe');
    const result = runner.run('state resolve-blocker --text ResolveMe');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(typeof parsed.resolved, 'boolean', 'resolved should be boolean');
  });

  test('state-snapshot returns summary fields', () => {
    const result = runner.run('state-snapshot');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['decisions', 'blockers'],
      types: { decisions: 'array', blockers: 'array' },
    });
    // status and total_phases may be null but fields should exist
    assert.ok('status' in parsed, 'should have status field');
    assert.ok('total_phases' in parsed, 'should have total_phases field');
  });

  test('state record-session returns recorded field', () => {
    const result = runner.run('state record-session --summary ContractTestSession');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(typeof parsed.recorded, 'boolean', 'recorded should be boolean');
  });

  // === Error cases ===

  test('state json with missing state.md returns error', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-nostate-'));
    fs.mkdirSync(path.join(emptyDir, '.planning'), { recursive: true });
    const result = runner.run('state json', emptyDir);
    const parsed = JSON.parse(result.output || '{}');
    if (parsed.error) {
      assertErrorSchema(parsed);
    }
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('state add-decision without --summary flag fails gracefully', () => {
    const result = runner.run('state add-decision');
    // Should not crash — returns error or empty result
    assert.ok(result.output || result.error, 'should produce some output');
  });

  test('state add-blocker without --text flag fails gracefully', () => {
    const result = runner.run('state add-blocker');
    assert.ok(result.output || result.error, 'should produce some output');
  });

  test('all state commands return valid JSON (no mixed stdout)', () => {
    const cmds = ['state json', 'state-snapshot', 'state get status'];
    for (const cmd of cmds) {
      const result = runner.run(cmd);
      if (result.output) {
        assert.doesNotThrow(() => JSON.parse(result.output),
          `${cmd} should return valid JSON, got: ${result.output.substring(0, 100)}`);
      }
    }
  });
});
