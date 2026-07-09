'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Smoke Tests — Layer 4', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
  });

  after(() => {
    runner.cleanup();
  });

  test('ST-001: pan-tools responds to unknown command without crash', () => {
    const result = runner.run('nonexistent-command');
    // Should not crash — returns output (help text or error JSON)
    assert.ok(result.output.length > 0 || result.error.length > 0, 'should produce some output');
  });

  test('ST-002: All 38+ commands discoverable after Claude install', () => {
    const commandsDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    assert.ok(fs.existsSync(commandsDir), '.claude/commands/pan/ should exist');
    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length >= 38, `Expected 38+ command files, got ${files.length}`);
  });

  test('ST-003: Hook files are valid JavaScript', () => {
    const hooksDir = path.join(runner.tmpDir, '.claude', 'hooks');
    if (!fs.existsSync(hooksDir)) return; // hooks may not be installed in all configs
    const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));
    for (const file of hookFiles) {
      const hookPath = path.join(hooksDir, file);
      const src = fs.readFileSync(hookPath, 'utf-8');
      // Syntax-only check — do NOT require() hooks that attach stdin listeners
      assert.doesNotThrow(() => {
        new vm.Script(src, { filename: file });
      }, `Hook ${file} should be valid JavaScript`);
    }
  });

  test('ST-004: Clean install + init new-project returns valid analysis', () => {
    const result = runner.run('init new-project --name SmokeTest');
    assert.ok(result.success, `init should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    // init returns project analysis with key fields
    assert.ok('project_exists' in parsed, 'should have project_exists field');
    assert.ok('planning_exists' in parsed, 'should have planning_exists field');
    assert.ok('has_git' in parsed, 'should have has_git field');
    assert.ok('project_path' in parsed, 'should have project_path field');
  });

  test('ST-005: validate health returns valid JSON with status field', () => {
    // ST-004 already initialized, so health check should work
    const result = runner.run('validate health');
    assert.ok(result.success, `validate health should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok('status' in parsed, 'output should have status field');
    assert.ok(['healthy', 'degraded', 'broken'].includes(parsed.status),
      `status should be healthy/degraded/broken, got "${parsed.status}"`);
  });
});
