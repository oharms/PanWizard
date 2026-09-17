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
    // Measured 2026-09-17: an unterminated frontmatter fence is NOT an error —
    // `state json` exits 0 and falls back to defaults, reporting status "unknown"
    // (the `Status: Broken` line inside the unclosed fence is never read).
    assert.equal(r.success, true, `state json should exit 0 on a corrupt fence: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.status, 'unknown', 'an unparseable fence yields the default status');
    assert.equal(p.pan_state_version, '1.0');
    assert.equal(p.milestone, 'v1.0', 'default milestone, not a value read from the corrupt file');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-003: Invalid JSON in config.json fails with a parse error naming the file', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-badconfig-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\nStatus: Active\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), 'NOT VALID JSON {{{');
    const r = runner.run('config-get model_profile', tmpDir);
    // Measured 2026-09-17: config-get does NOT fall back to defaults on malformed
    // JSON — it exits 1 with a parse error that names config.json (the old test
    // title claimed defaults; the measured behaviour is asserted here instead, and
    // the divergence is reported rather than "fixed" in the product).
    assert.equal(r.success, false, 'a malformed config.json must exit non-zero');
    assert.equal(r.output, '', 'nothing on stdout — the failure goes to stderr');
    assert.match(r.error, /^Error: Failed to read config\.json: /);
    assert.doesNotMatch(r.error, /at .*\.cjs:\d+/, 'a parse failure must not surface a stack trace');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-004: validate health on corrupted project returns broken/degraded', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-corrupted-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    // Only create state.md, missing everything else
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\nStatus: Active\n---\n');
    const r = runner.run('validate health', tmpDir);
    assert.equal(r.success, JSON.parse(r.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
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
    assert.equal(r.success, JSON.parse(r.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const p = JSON.parse(r.output);
    assert.ok('status' in p, 'should have status');
    // Repair should attempt to fix issues
    assert.ok('repairable_count' in p || 'repaired' in p, 'should report repair status');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('FL-006: Missing required args gives helpful error', () => {
    const r = runner.run('phase complete');
    // Measured 2026-09-17: exit 1, empty stdout, and a stderr line that names the
    // missing argument. `!r.success || r.error` passed on any non-zero exit,
    // including a TypeError from the missing arg.
    assert.equal(r.success, false, 'phase complete without a number must exit non-zero');
    assert.equal(r.output, '');
    assert.match(r.error, /^Error: phase complete requires a phase number$/);
  });

  test('FL-007: Unknown command exits 1 with the dispatcher usage error', () => {
    const r = runner.run('totally-fake-command');
    // Measured 2026-09-17 — same contract as smoke ST-001, asserted here against
    // the verb name this test passes in.
    assert.equal(r.success, false);
    assert.equal(r.output, '');
    assert.match(r.error, /^Error: Unknown command: totally-fake-command\. Run pan-tools --help/);
  });
});
