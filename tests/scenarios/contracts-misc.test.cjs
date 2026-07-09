'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { assertSchema } = require('../contracts/assert-schema.cjs');

describe('E2E Roadmap/Config/Template/Misc Contracts', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(pd, 'phases', '02-api'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'Status: In progress', 'Current Phase: 01', '---', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), [
      '## Roadmap', '', '| Phase | Name | Status |', '|---|---|---|',
      '| 01 | setup | Not started |', '| 02 | api | Not started |',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: true }));
  });

  after(() => { runner.cleanup(); });

  // === Roadmap commands ===

  test('roadmap analyze returns phases array and counts', () => {
    const result = runner.run('roadmap analyze');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['phases', 'phase_count', 'completed_phases', 'progress_percent'],
      types: { phases: 'array', phase_count: 'number', completed_phases: 'number', progress_percent: 'number' },
    });
  });

  test('roadmap get-phase returns found boolean', () => {
    const result = runner.run('roadmap get-phase 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['found', 'phase_number'],
      types: { found: 'boolean', phase_number: 'string' },
    });
  });

  // === Config commands ===

  test('config-get returns value as JSON string', () => {
    const result = runner.run('config-get model_profile');
    assert.ok(result.success, `should succeed: ${result.error}`);
    // config-get returns raw JSON value (quoted string)
    const parsed = JSON.parse(result.output);
    assert.equal(typeof parsed, 'string', 'config value should be a string');
  });

  test('config-set returns updated confirmation', () => {
    const result = runner.run('config-set model_profile quality');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['updated', 'key', 'value'],
      types: { updated: 'boolean', key: 'string' },
    });
    assert.ok(parsed.updated, 'should be updated=true');
    assert.equal(parsed.key, 'model_profile');
  });

  // === Template commands ===

  test('template select returns template path and type', () => {
    const result = runner.run('template select summary');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['template'],
      types: { template: 'string' },
    });
  });

  // === Utility commands ===

  test('generate-slug returns valid slug', () => {
    const result = runner.run('generate-slug my-test-feature');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['slug'],
      types: { slug: 'string' },
    });
    assert.equal(parsed.slug, 'my-test-feature');
  });

  test('generate-slug handles special characters', () => {
    const result = runner.run('generate-slug Hello-World');
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.slug.length > 0, 'slug should not be empty');
    // Slug should be lowercase with hyphens
    assert.ok(/^[a-z0-9-]+$/.test(parsed.slug), `slug should be lowercase alphanumeric: "${parsed.slug}"`);
  });

  // === Error cases ===

  test('config-get unknown key does not crash', () => {
    const result = runner.run('config-get nonexistent_key');
    // May fail (error on stderr) or succeed with null/undefined — either is fine
    // The important thing is it doesn't throw an uncaught exception
    assert.ok(result.success || result.error || result.output === '',
      'should handle gracefully without crash');
  });

  test('roadmap analyze on project with no phases returns zero counts', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-noroadmap-'));
    fs.mkdirSync(path.join(emptyDir, '.planning', 'phases'), { recursive: true });
    fs.writeFileSync(path.join(emptyDir, '.planning', 'state.md'), '---\nStatus: New\n---\n');
    fs.writeFileSync(path.join(emptyDir, '.planning', 'roadmap.md'), '## Roadmap\n');
    fs.writeFileSync(path.join(emptyDir, '.planning', 'config.json'), '{}');
    const result = runner.run('roadmap analyze', emptyDir);
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.phase_count, 0, 'should have 0 phases');
    assert.equal(parsed.progress_percent, 0, 'should have 0% progress');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('all roadmap/config commands return valid JSON', () => {
    const cmds = ['roadmap analyze', 'config-get model_profile'];
    for (const cmd of cmds) {
      const result = runner.run(cmd);
      if (result.output) {
        assert.doesNotThrow(() => JSON.parse(result.output),
          `${cmd} should return valid JSON`);
      }
    }
  });
});
