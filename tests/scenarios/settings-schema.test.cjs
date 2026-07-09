/**
 * Settings/Config Schema Validation Tests (ADR-0019: UAT-001)
 *
 * Validates that the installed settings.json (Claude) and config.json (Copilot)
 * have correct structure, hook key casing, and required fields for the host tool
 * to consume.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('Claude settings.json schema', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('settings.json exists and is valid JSON', () => {
    const settingsPath = path.join(runner.tmpDir, '.claude', 'settings.json');
    const content = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(content);
    assert.ok(typeof settings === 'object', 'settings should be an object');
  });

  test('hooks object exists with PascalCase keys', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.hooks, 'hooks key should exist');
    assert.ok(settings.hooks.SessionStart, 'SessionStart (PascalCase) should exist');
    assert.ok(settings.hooks.PostToolUse, 'PostToolUse (PascalCase) should exist');
  });

  test('no camelCase hook keys present', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.hooks.sessionStart, undefined,
      'camelCase sessionStart should NOT exist in Claude settings');
    assert.equal(settings.hooks.postToolUse, undefined,
      'camelCase postToolUse should NOT exist in Claude settings');
  });

  test('SessionStart hooks are array with nested structure', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(Array.isArray(settings.hooks.SessionStart),
      'SessionStart should be an array');
    assert.ok(settings.hooks.SessionStart.length >= 1,
      'SessionStart should have at least 1 entry');
    const entry = settings.hooks.SessionStart[0];
    assert.ok(entry.hooks, 'entry should have nested hooks array');
    assert.ok(Array.isArray(entry.hooks), 'nested hooks should be array');
    assert.ok(entry.hooks[0].type, 'hook entry should have type field');
    assert.ok(entry.hooks[0].command, 'hook entry should have command field');
  });

  test('PostToolUse hooks are array with nested structure', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(Array.isArray(settings.hooks.PostToolUse),
      'PostToolUse should be an array');
    assert.ok(settings.hooks.PostToolUse.length >= 1,
      'PostToolUse should have at least 1 entry');
    const entry = settings.hooks.PostToolUse[0];
    assert.ok(entry.hooks, 'entry should have nested hooks array');
    assert.ok(entry.hooks[0].command, 'hook entry should have command field');
  });

  test('statusLine key exists with type and command', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.statusLine, 'statusLine should exist');
    assert.equal(settings.statusLine.type, 'command', 'statusLine type should be "command"');
    assert.ok(settings.statusLine.command, 'statusLine should have command field');
    assert.ok(settings.statusLine.command.length > 0, 'statusLine command should be non-empty');
  });

  test('hook command strings are non-empty', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    for (const [key, entries] of Object.entries(settings.hooks)) {
      for (const entry of entries) {
        if (entry.hooks) {
          for (const hook of entry.hooks) {
            assert.ok(hook.command && hook.command.length > 0,
              `Hook command in ${key} should be non-empty`);
          }
        }
      }
    }
  });
});

describe('Copilot settings schema', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('copilot');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  // User-editable settings live in .github/copilot/settings.json (documented
  // repo-level read path); .github/config.json is not a Copilot read path and
  // is no longer created by fresh installs — migrated 2026-06.
  test('copilot/settings.json exists and is valid JSON', () => {
    const settingsPath = path.join(runner.tmpDir, '.github', 'copilot', 'settings.json');
    const content = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(content);
    assert.ok(typeof settings === 'object', 'settings should be an object');
  });

  test('fresh install does not create legacy .github/config.json', () => {
    const configPath = path.join(runner.tmpDir, '.github', 'config.json');
    assert.ok(!fs.existsSync(configPath),
      'fresh installs should not write the legacy config.json');
  });

  // Hooks moved to .github/hooks/pan.json (version:1) — migrated 2026-06.
  test('hooks config exists with camelCase event keys', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    assert.ok(config.hooks, 'hooks key should exist');
    assert.ok(config.hooks.sessionStart, 'sessionStart (camelCase) should exist');
    assert.ok(config.hooks.postToolUse, 'postToolUse (camelCase) should exist');
  });

  test('no PascalCase hook keys present', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    assert.equal(config.hooks.SessionStart, undefined,
      'PascalCase SessionStart should NOT exist in Copilot hooks config');
    assert.equal(config.hooks.PostToolUse, undefined,
      'PascalCase PostToolUse should NOT exist in Copilot hooks config');
  });

  test('sessionStart hooks declare type:command (Copilot CLI schema)', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    assert.equal(config.version, 1, 'config should declare version: 1');
    assert.ok(Array.isArray(config.hooks.sessionStart),
      'sessionStart should be an array');
    assert.ok(config.hooks.sessionStart.length >= 1,
      'sessionStart should have at least 1 entry');
    const entry = config.hooks.sessionStart[0];
    assert.equal(entry.type, 'command', 'entry should declare type: command');
    assert.ok(entry.command, 'entry should have a command field');
  });

  test('statusLine key exists with type and command', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'copilot', 'settings.json'), 'utf8'));
    assert.ok(settings.statusLine, 'statusLine should exist');
    assert.equal(settings.statusLine.type, 'command', 'statusLine type should be "command"');
    assert.ok(settings.statusLine.command, 'statusLine should have command field');
    assert.ok(settings.statusLine.command.length > 0, 'statusLine command should be non-empty');
  });
});
