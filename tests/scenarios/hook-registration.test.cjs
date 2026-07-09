/**
 * Hook Registration Integrity Tests (ADR-0019: UAT-003)
 *
 * Validates that hook entries in settings.json (Claude) and config.json (Copilot)
 * reference files that actually exist on disk, contain the expected 3 hooks,
 * and have no duplicate entries.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

const EXPECTED_HOOKS = ['pan-check-update.js', 'pan-context-monitor.js', 'pan-statusline.js'];

/**
 * Extract hook command paths from Claude settings.json nested structure.
 * Structure: { hooks: { EventName: [{ hooks: [{ command: "..." }] }] } }
 */
function extractClaudeHookCommands(settings) {
  const commands = [];
  if (!settings.hooks) return commands;
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.hooks && Array.isArray(entry.hooks)) {
        for (const hook of entry.hooks) {
          if (hook.command) commands.push(hook.command);
        }
      }
    }
  }
  if (settings.statusLine && settings.statusLine.command) {
    commands.push(settings.statusLine.command);
  }
  return commands;
}

/**
 * Extract hook command paths from Copilot config.json flat structure.
 * Structure: { hooks: { eventName: [{ command: "..." }] } }
 */
function extractCopilotHookCommands(config) {
  const commands = [];
  if (!config.hooks) return commands;
  for (const entries of Object.values(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.command) commands.push(entry.command);
    }
  }
  if (config.statusLine && config.statusLine.command) {
    commands.push(config.statusLine.command);
  }
  return commands;
}

/**
 * Extract the .js filename from a hook command string.
 * e.g., "node .claude/hooks/pan-check-update.js" → "pan-check-update.js"
 */
function extractHookFilename(command) {
  const parts = command.split(/[\\/]/);
  return parts[parts.length - 1];
}

describe('Claude hook registration integrity', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('all 3 expected hook files exist in hooks/ directory', () => {
    const hooksDir = path.join(runner.tmpDir, '.claude', 'hooks');
    assert.ok(fs.existsSync(hooksDir), 'hooks/ directory should exist');
    for (const hookFile of EXPECTED_HOOKS) {
      const hookPath = path.join(hooksDir, hookFile);
      assert.ok(fs.existsSync(hookPath),
        `Expected hook file ${hookFile} should exist`);
    }
  });

  test('hook files are non-empty (> 100 bytes)', () => {
    const hooksDir = path.join(runner.tmpDir, '.claude', 'hooks');
    for (const hookFile of EXPECTED_HOOKS) {
      const stat = fs.statSync(path.join(hooksDir, hookFile));
      assert.ok(stat.size > 100,
        `${hookFile} should be > 100 bytes (not a stub), got ${stat.size}`);
    }
  });

  test('hook commands in settings.json reference existing files', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    const commands = extractClaudeHookCommands(settings);
    assert.ok(commands.length >= 3,
      `Expected >= 3 hook commands, found ${commands.length}`);
    for (const cmd of commands) {
      const filename = extractHookFilename(cmd);
      const hookPath = path.join(runner.tmpDir, '.claude', 'hooks', filename);
      assert.ok(fs.existsSync(hookPath),
        `Hook command references "${filename}" which should exist at ${hookPath}`);
    }
  });

  test('no duplicate hook entries in SessionStart', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    const commands = [];
    for (const entry of (settings.hooks.SessionStart || [])) {
      if (entry.hooks) {
        for (const hook of entry.hooks) {
          commands.push(hook.command);
        }
      }
    }
    const unique = new Set(commands);
    assert.equal(commands.length, unique.size,
      `SessionStart has duplicate hook entries: ${commands.join(', ')}`);
  });

  test('no duplicate hook entries in PostToolUse', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.claude', 'settings.json'), 'utf8'));
    const commands = [];
    for (const entry of (settings.hooks.PostToolUse || [])) {
      if (entry.hooks) {
        for (const hook of entry.hooks) {
          commands.push(hook.command);
        }
      }
    }
    const unique = new Set(commands);
    assert.equal(commands.length, unique.size,
      `PostToolUse has duplicate hook entries: ${commands.join(', ')}`);
  });
});

describe('Copilot hook registration integrity', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('copilot');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('all 3 expected hook files exist in hooks/ directory', () => {
    const hooksDir = path.join(runner.tmpDir, '.github', 'hooks');
    assert.ok(fs.existsSync(hooksDir), 'hooks/ directory should exist');
    for (const hookFile of EXPECTED_HOOKS) {
      const hookPath = path.join(hooksDir, hookFile);
      assert.ok(fs.existsSync(hookPath),
        `Expected hook file ${hookFile} should exist`);
    }
  });

  // Copilot CLI reads hook config from .github/hooks/*.json (version:1), not
  // config.json — migrated 2026-06.
  test('hook commands in .github/hooks/pan.json reference existing files', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    const commands = extractCopilotHookCommands(config);
    assert.ok(commands.length >= 2,
      `Expected >= 2 hook commands, found ${commands.length}`);
    for (const cmd of commands) {
      const filename = extractHookFilename(cmd);
      const hookPath = path.join(runner.tmpDir, '.github', 'hooks', filename);
      assert.ok(fs.existsSync(hookPath),
        `Hook command references "${filename}" which should exist`);
    }
  });

  test('hooks config declares version:1 and type:command', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    assert.equal(config.version, 1);
    for (const entries of Object.values(config.hooks)) {
      for (const entry of entries) assert.equal(entry.type, 'command');
    }
  });

  test('no duplicate hook entries in sessionStart', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    const commands = (config.hooks.sessionStart || []).map(e => e.command);
    const unique = new Set(commands);
    assert.equal(commands.length, unique.size,
      `sessionStart has duplicate entries: ${commands.join(', ')}`);
  });

  test('no duplicate hook entries in postToolUse', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(runner.tmpDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    const commands = (config.hooks.postToolUse || []).map(e => e.command);
    const unique = new Set(commands);
    assert.equal(commands.length, unique.size,
      `postToolUse has duplicate entries: ${commands.join(', ')}`);
  });
});
