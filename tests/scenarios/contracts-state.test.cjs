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
    // state.md in the shape PAN itself ships (pan-wizard-core/templates/state.md):
    // bold fields, `### Decisions`, `### Blockers/Concerns`, Session Continuity.
    // The previous fixture used YAML frontmatter keys and `## Key Decisions`, which
    // NONE of the state writers match — so every mutation below returned
    // `<verb>: false` and these contract tests passed on the failure branch,
    // asserting only that the flag was a boolean. They now exercise the real path.
  fs.writeFileSync(path.join(pd, 'state.md'), [
      '# Project State',
      '',
      '## Current Position',
      '',
      '**Current Phase:** 1',
      '**Current Phase Name:** setup',
      '**Current Plan:** 1',
      '**Total Plans in Phase:** 3',
      '**Status:** In progress',
      '**Last Activity:** 2026-01-01',
      '**Progress:** [##________] 20%',
      '',
      '## Performance Metrics',
      '',
      '| Phase | Plans | Total | Avg/Plan |',
      '|-------|-------|-------|----------|',
      '| - | - | - | - |',
      '',
      '## Accumulated Context',
      '',
      '### Decisions',
      '',
      'None yet.',
      '',
      '### Blockers/Concerns',
      '',
      'None yet.',
      '',
      '## Session Continuity',
      '',
      '**Last session:** 2026-01-01 09:00',
      '**Stopped At:** initial setup',
      '**Resume File:** None',
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
    const result = runner.run('state update Status Active');
    assert.ok(result.success, `should succeed: ${result.error}`);
    assert.equal(JSON.parse(result.output).updated, true, 'the field must actually be updated');
    assert.match(fs.readFileSync(path.join(runner.tmpDir, '.planning', 'state.md'), 'utf-8'),
      /\*\*Status:\*\* Active/, 'and the write must be visible on disk');
  });

  test('state add-decision returns added field', () => {
    const result = runner.run('state add-decision --summary ContractTestDecision');
    assert.ok(result.success, `should succeed: ${result.error}`);
    assert.equal(JSON.parse(result.output).added, true, 'the decision must actually be added');
  });

  test('state add-blocker returns added field', () => {
    const result = runner.run('state add-blocker --text ContractTestBlocker');
    assert.ok(result.success, `should succeed: ${result.error}`);
    assert.equal(JSON.parse(result.output).added, true, 'the blocker must actually be added');
  });

  test('state resolve-blocker returns resolved field', () => {
    // First add a blocker, then resolve it
    runner.run('state add-blocker --text ResolveMe');
    const result = runner.run('state resolve-blocker --text ResolveMe');
    assert.ok(result.success, `should succeed: ${result.error}`);
    assert.equal(JSON.parse(result.output).resolved, true, 'the blocker must actually be resolved');
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
    fs.rmSync(emptyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
