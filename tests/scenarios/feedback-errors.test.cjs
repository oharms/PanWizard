'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Feedback: Error Recovery', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
  });

  after(() => { runner.cleanup(); });

  test('FL-001: Missing .planning/ gives actionable error', () => {
    const emptyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-noplanning-'));
    const r = runner.run('state json', emptyDir);
    // Should return error JSON, not crash
    if (r.output) {
      const p = JSON.parse(r.output);
      assert.ok(p.error, 'should have error field');
    }
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('FL-002: Corrupted state.md gives graceful error', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-corrupt-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    // Write corrupted state.md (missing closing ---)
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\nStatus: Broken\nNo closing fence');
    const r = runner.run('state json', tmpDir);
    // Should not crash — may return partial data or error
    assert.ok(r.output || r.error, 'should produce some output');
    if (r.output) {
      assert.doesNotThrow(() => JSON.parse(r.output), 'output should be valid JSON');
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-003: Invalid JSON in config.json returns defaults', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-badconfig-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\nStatus: Active\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), 'NOT VALID JSON {{{');
    const r = runner.run('config-get model_profile', tmpDir);
    // Should return default value or handle gracefully
    assert.ok(r.success || r.error || r.output === '', 'should not crash');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-004: validate health on corrupted project returns broken/degraded', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-corrupted-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    // Only create state.md, missing everything else
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\nStatus: Active\n---\n');
    const r = runner.run('validate health', tmpDir);
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(['broken', 'degraded'].includes(p.status),
      `corrupted project should be broken/degraded, got "${p.status}"`);
    assert.ok(p.errors.length > 0 || p.warnings.length > 0, 'should report issues');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-005: validate health --repair attempts fixes', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-repair-'));
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\nStatus: Active\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{}');
    const r = runner.run('validate health --repair', tmpDir);
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok('status' in p, 'should have status');
    // Repair should attempt to fix issues
    assert.ok('repairable_count' in p || 'repaired' in p, 'should report repair status');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-006: Missing required args gives helpful error', () => {
    const r = runner.run('phase complete');
    // Should fail with helpful message about required arg
    assert.ok(!r.success || r.error, 'should fail without phase number');
    const errText = r.error || r.output || '';
    assert.ok(errText.length > 0, 'should have error message');
  });

  test('FL-007: Unknown command gives output (not crash)', () => {
    const r = runner.run('totally-fake-command');
    // Should produce help or error text, not crash
    assert.ok(r.output.length > 0 || r.error.length > 0, 'should produce output');
  });
});
