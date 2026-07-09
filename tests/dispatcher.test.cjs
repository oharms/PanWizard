const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTempProject, cleanup, runPanTools } = require('./helpers.cjs');
const fs = require('fs');
const path = require('path');

let tmpDir;
beforeEach(() => { tmpDir = createTempProject(); });
afterEach(() => { cleanup(tmpDir); });

// ─── Dispatcher argument validation ─────────────────────────────────────────
// Tests that missing required arguments produce error JSON instead of crashing.

describe('dispatcher argument validation', () => {
  test('find-phase errors on missing phase number', () => {
    const result = runPanTools('find-phase', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });

  test('roadmap get-phase errors on missing phase number', () => {
    const result = runPanTools('roadmap get-phase', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });

  test('roadmap update-plan-progress errors on missing phase number', () => {
    const result = runPanTools('roadmap update-plan-progress', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });

  test('phase next-decimal errors on missing phase number', () => {
    const result = runPanTools('phase next-decimal', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });

  test('phase insert errors on missing phase number', () => {
    const result = runPanTools('phase insert', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });

  test('phase remove errors on missing phase number', () => {
    const result = runPanTools('phase remove', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });

  test('phase complete errors on missing phase number', () => {
    const result = runPanTools('phase complete', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('requires'), 'error mentions requirement');
  });
});

// ─── getArgValue helper tests ───────────────────────────────────────────────
// Tests for the dispatcher's getArgValue helper via CLI invocations.

describe('getArgValue behavior via CLI', () => {
  test('verify-summary uses default check-count of 2 when not provided', () => {
    // Create a minimal summary file to test
    const summaryPath = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(summaryPath, { recursive: true });
    fs.writeFileSync(path.join(summaryPath, '01-summary.md'), '# Summary\n\nDone.\n');
    const result = runPanTools('verify-summary .planning/phases/01-test/01-summary.md', tmpDir);
    assert.ok(result.success, `verify-summary should succeed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.passed, 'boolean', 'should have a passed field');
    assert.ok(Array.isArray(output.errors), 'should have an errors array');
  });

  test('websearch uses default limit when --limit not provided', () => {
    // websearch requires network so just verify it parses args without crashing on missing --limit
    const result = runPanTools('websearch test-query', tmpDir);
    // Should succeed with JSON output (returns available=false when no API key)
    assert.ok(result.success, `websearch should not crash: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.available, false, 'should report API not available');
    assert.ok(output.reason, 'should include a reason');
  });

  test('template fill uses defaults for optional flags', () => {
    // Without --phase, --plan etc., should not crash with TypeError
    const result = runPanTools('template fill summary', tmpDir);
    // Should fail with a proper error about missing phase/plan, not TypeError
    assert.ok(!result.success || result.output, 'should produce output or proper error');
    if (!result.success) {
      assert.ok(!result.error.includes('TypeError'), 'should not crash with TypeError');
    }
  });
});
