'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { assertSchema } = require('../contracts/assert-schema.cjs');

describe('E2E Phase Command Contracts', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'pan_state_version: "1.0"', 'Status: In progress',
      'Current Phase: 01', 'Milestone: v1.0', '---', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), [
      '## Roadmap', '', '| Phase | Name | Status |', '|---|---|---|',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: true }));
  });

  after(() => { runner.cleanup(); });

  // === Success schemas ===

  test('phase add returns phase_number, name, directory', () => {
    const result = runner.run('phase add auth-system');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['phase_number', 'name', 'slug', 'directory'],
      types: { name: 'string', slug: 'string', directory: 'string' },
    });
    assert.ok(parsed.directory.includes('01'), 'directory should contain phase number');
  });

  test('phase add second phase increments number', () => {
    const result = runner.run('phase add api-endpoints');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.directory.includes('02'), 'second phase should be 02');
    assert.equal(parsed.name, 'api-endpoints');
  });

  test('phases list returns directories array and count', () => {
    const result = runner.run('phases list');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['directories', 'count'],
      types: { directories: 'array', count: 'number' },
    });
    assert.ok(parsed.count >= 2, `should have at least 2 phases, got ${parsed.count}`);
  });

  test('phase next-decimal returns next decimal string', () => {
    const result = runner.run('phase next-decimal 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['found', 'next'],
      types: { found: 'boolean', next: 'string' },
    });
    assert.ok(parsed.next.startsWith('01.'), `should start with "01.", got "${parsed.next}"`);
  });

  test('phase insert creates decimal phase', () => {
    const result = runner.run('phase insert 01 urgent-fix');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['phase_number', 'name', 'directory'],
      types: { name: 'string', directory: 'string' },
    });
    assert.ok(parsed.directory.includes('01.'), 'directory should contain decimal number');
  });

  test('phase complete returns completion details', () => {
    const result = runner.run('phase complete 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['completed_phase', 'roadmap_updated', 'state_updated'],
      types: { completed_phase: 'string', roadmap_updated: 'boolean', state_updated: 'boolean' },
    });
  });

  // === Error / edge cases ===

  test('phase add duplicate name succeeds with unique number', () => {
    const result = runner.run('phase add auth-system');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok('phase_number' in parsed, 'should have phase_number');
    assert.ok('directory' in parsed, 'should have directory');
  });

  test('phase remove nonexistent phase returns graceful result', () => {
    const result = runner.run('phase remove 99');
    assert.ok(result.output || result.error, 'should produce some output');
    if (result.success && result.output) {
      const parsed = JSON.parse(result.output);
      assert.ok('removed' in parsed, 'should have removed field');
    }
  });

  test('phase complete already-done phase handles gracefully', () => {
    const result = runner.run('phase complete 01');
    // Should not crash regardless of result
    assert.ok(result.output || result.error, 'should produce output');
  });

  test('phases list on empty project returns zero count', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-nophase-'));
    const epd = path.join(emptyDir, '.planning', 'phases');
    fs.mkdirSync(epd, { recursive: true });
    fs.writeFileSync(path.join(emptyDir, '.planning', 'state.md'), '---\nStatus: New\n---\n');
    fs.writeFileSync(path.join(emptyDir, '.planning', 'roadmap.md'), '## Roadmap\n');
    fs.writeFileSync(path.join(emptyDir, '.planning', 'config.json'), '{}');
    const result = runner.run('phases list', emptyDir);
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.count, 0, 'empty project should have 0 phases');
    assert.ok(Array.isArray(parsed.directories), 'directories should be array');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
