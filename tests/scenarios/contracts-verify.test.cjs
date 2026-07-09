'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { assertSchema, assertErrorSchema } = require('../contracts/assert-schema.cjs');

describe('E2E Validation/Verify Contracts', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'Status: In progress', 'Current Phase: 01', '---', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), [
      '## Roadmap', '', '| Phase | Name | Status |', '|---|---|---|',
      '| 01 | setup | Not started |',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
    fs.writeFileSync(path.join(pd, 'project.md'), [
      '## What This Is', 'A test project',
      '## Core Value', 'Testing', '## Requirements', 'None',
    ].join('\n'));
  });

  after(() => { runner.cleanup(); });

  // === validate commands ===

  test('validate health returns status enum and error/warning arrays', () => {
    const result = runner.run('validate health');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['status', 'errors', 'warnings'],
      types: { status: 'string', errors: 'array', warnings: 'array' },
      enum_values: { status: ['healthy', 'degraded', 'broken'] },
    });
  });

  test('validate health includes info and repairable_count', () => {
    const result = runner.run('validate health');
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    assert.ok('info' in parsed, 'should have info field');
    assert.ok('repairable_count' in parsed, 'should have repairable_count field');
    assert.equal(typeof parsed.repairable_count, 'number');
  });

  test('validate consistency returns passed boolean and warnings', () => {
    const result = runner.run('validate consistency');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['passed', 'errors', 'warnings'],
      types: { passed: 'boolean', errors: 'array', warnings: 'array' },
    });
  });

  // === verify commands ===

  test('verify phase-completeness returns completion details', () => {
    const result = runner.run('verify phase-completeness 01');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['complete', 'phase'],
      types: { complete: 'boolean', phase: 'string' },
    });
    assert.ok('plan_count' in parsed, 'should have plan_count');
    assert.ok('summary_count' in parsed, 'should have summary_count');
  });

  test('verify plan-structure returns error for missing file', () => {
    const result = runner.run('verify plan-structure 01');
    assert.ok(result.success, 'should succeed (returns error JSON, not crash)');
    const parsed = JSON.parse(result.output);
    assertErrorSchema(parsed);
  });

  test('verify references returns error for missing file', () => {
    const result = runner.run('verify references 01');
    assert.ok(result.success, 'should succeed (returns error JSON, not crash)');
    const parsed = JSON.parse(result.output);
    assertErrorSchema(parsed);
  });

  // === Error / edge cases ===

  test('validate health on broken project returns broken status', () => {
    const brokenDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-broken-'));
    // Just create .planning with nothing in it
    fs.mkdirSync(path.join(brokenDir, '.planning'), { recursive: true });
    const result = runner.run('validate health', brokenDir);
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(['broken', 'degraded'].includes(parsed.status),
      `broken project should be broken/degraded, got "${parsed.status}"`);
    fs.rmSync(brokenDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('validate health on missing .planning returns broken', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-empty-'));
    const result = runner.run('validate health', emptyDir);
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.status, 'broken', 'missing .planning should be broken');
    assert.ok(parsed.errors.length > 0, 'should have errors');
    fs.rmSync(emptyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('verify key-links without args returns error', () => {
    const result = runner.run('verify key-links');
    assert.ok(!result.success || (result.output && JSON.parse(result.output).error),
      'should return error without required arg');
  });

  test('all validate commands return valid JSON', () => {
    const cmds = ['validate health', 'validate consistency'];
    for (const cmd of cmds) {
      const result = runner.run(cmd);
      assert.ok(result.output, `${cmd} should produce output`);
      assert.doesNotThrow(() => JSON.parse(result.output),
        `${cmd} should return valid JSON`);
    }
  });

  // === drift-check commands ===

  test('drift-check returns valid contract shape', () => {
    const { execFileSync } = require('child_process');
    const tmpDir = runner.tmpDir;
    // Ensure git repo exists (scenario runner may not have one)
    try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: tmpDir, stdio: 'pipe' }); }
    catch {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
    }
    const result = runner.run('drift-check');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    const { SCHEMAS } = require('../contracts/schemas.cjs');
    assertSchema(parsed, SCHEMAS['drift-check']);
  });

  test('drift-check --files with violations returns violations array', () => {
    fs.writeFileSync(path.join(runner.tmpDir, 'drifty.cjs'), 'console.log("bad");\n');
    const result = runner.run('drift-check --files drifty.cjs');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.violation_count > 0, 'should have violations');
    assert.ok(Array.isArray(parsed.violations));
    assert.ok(parsed.violations[0].file);
    assert.ok(parsed.violations[0].rule);
    assert.ok(parsed.violations[0].severity);
    // Clean up
    fs.unlinkSync(path.join(runner.tmpDir, 'drifty.cjs'));
  });
});
