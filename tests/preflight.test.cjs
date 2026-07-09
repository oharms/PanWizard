/**
 * PAN Tools Tests - Preflight Checks
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('preflight command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passes when state.md exists with no blockers', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Executing\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, true, 'should be ready when state exists and no blockers');
    assert.strictEqual(output.blockers.length, 0, 'should have no blockers');
    assert.ok(output.passed > 0, 'should have passing checks');
    assert.ok(output.total > 0, 'should have total checks');
  });

  test('fails when state.md is missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false, 'should not be ready without state.md');
    assert.ok(output.blockers.some(b => b.includes('state.md')), 'should mention state.md in blockers');
  });

  test('detects active blockers in state.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Blocked\n\n## Blockers\n- API key expired\n- Waiting on approval\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false, 'should not be ready with blockers');
    const blockerCheck = output.checks.find(c => c.name === 'no_blockers');
    assert.ok(blockerCheck, 'should have no_blockers check');
    assert.strictEqual(blockerCheck.passed, false, 'no_blockers should fail');
    assert.ok(blockerCheck.detail.includes('2'), 'should detect 2 blockers');
    assert.ok(output.blockers.some(b => b.includes('API key expired')), 'should list specific blocker');
  });

  test('ignores None placeholder in blockers section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Executing\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const blockerCheck = output.checks.find(c => c.name === 'no_blockers');
    assert.ok(blockerCheck, 'should have no_blockers check');
    assert.strictEqual(blockerCheck.passed, true, 'None should not count as a blocker');
  });

  test('detects missing config.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const configCheck = output.checks.find(c => c.name === 'config_exists');
    assert.ok(configCheck, 'should have config_exists check');
    assert.strictEqual(configCheck.passed, false, 'config check should fail when missing');
  });

  test('reports error patterns count', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'patterns.md'),
      '# Error Patterns\n\n### PAT-001: Test failure\n**Wrong:** bad\n**Right:** good\n\n### PAT-002: Import error\n**Wrong:** old\n**Right:** new\n'
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const patternCheck = output.checks.find(c => c.name === 'error_patterns');
    assert.ok(patternCheck, 'should have error_patterns check');
    assert.strictEqual(patternCheck.passed, true, 'patterns check should pass');
    assert.ok(patternCheck.detail.includes('2'), 'should detect 2 patterns');
  });

  test('checks target batch existence', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'focus'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'focus', 'batch-2026-01-01.json'),
      JSON.stringify({ items: [] })
    );

    const result = runPanTools('preflight batch', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const batchCheck = output.checks.find(c => c.name === 'batch_exists');
    assert.ok(batchCheck, 'should have batch_exists check');
    assert.strictEqual(batchCheck.passed, true, 'batch should be found');
    assert.ok(batchCheck.detail.includes('batch-2026-01-01.json'), 'should show batch filename');
  });

  test('fails when target batch directory missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight batch', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false, 'should not be ready without batch');
    assert.ok(output.blockers.some(b => b.includes('focus')), 'should mention focus directory');
  });

  test('checks target phase existence', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runPanTools('preflight 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const phaseCheck = output.checks.find(c => c.name === 'target_phase');
    assert.ok(phaseCheck, 'should have target_phase check');
    assert.strictEqual(phaseCheck.passed, true, 'phase 01 should be found');
  });

  test('fails when target phase not found', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight 99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false, 'should not be ready when phase missing');
    assert.ok(output.blockers.some(b => b.includes('Phase 99')), 'should mention missing phase');
  });

  test('output has all expected fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n\n## Blockers\n- None\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.ready, 'boolean', 'ready should be boolean');
    assert.ok(Array.isArray(output.checks), 'checks should be array');
    assert.ok(Array.isArray(output.blockers), 'blockers should be array');
    assert.strictEqual(typeof output.passed, 'number', 'passed should be number');
    assert.strictEqual(typeof output.total, 'number', 'total should be number');
  });

  test('handles missing .planning/ directory', () => {
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false, 'should not be ready without .planning/');
    assert.ok(output.blockers.some(b => b.includes('.planning')), 'should mention .planning/');
  });
});
