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

  test('phase remove nonexistent phase fails with a not-found error', () => {
    const result = runner.run('phase remove 99');
    // Measured 2026-09-17 on this fixture (phases 01, 01.1, 02 exist): exit 1,
    // empty stdout, and a stderr line naming both misses. The `if (result.success
    // && result.output)` branch never ran, so the old assert only proved stderr
    // was non-empty — which a stack trace also is.
    assert.equal(result.success, false, 'removing a missing phase must exit non-zero');
    assert.equal(result.output, '');
    assert.match(result.error, /^Error: Phase 99 not found — no phase directory and no roadmap entry$/);
  });

  test('phase complete on an already-completed phase is idempotent', () => {
    const result = runner.run('phase complete 01');
    // Measured 2026-09-17: phase 01 was completed by the test above, and running
    // it again exits 0 with the same payload (same next_phase, both updates
    // reported true) rather than erroring.
    assert.equal(result.success, true, `re-completing a phase should exit 0: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.completed_phase, '01');
    assert.equal(parsed.phase_name, 'auth-system');
    assert.equal(parsed.next_phase, '01.1');
    assert.equal(parsed.roadmap_updated, true);
    assert.equal(parsed.state_updated, true);
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
    fs.rmSync(emptyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});
