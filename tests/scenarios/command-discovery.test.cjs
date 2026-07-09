/**
 * Command Discoverability Tests (ADR-0019: UAT-002)
 *
 * Validates that command files are placed at the correct paths for each runtime,
 * with sufficient count and non-empty content. This is what the host AI tool
 * reads to discover available slash commands.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

const CRITICAL_COMMANDS = ['plan-phase', 'exec-phase', 'verify-phase', 'new-project', 'quick'];
const MIN_COMMAND_COUNT = 30;

describe('Claude command discoverability', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('commands/pan/ directory exists', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    assert.ok(fs.existsSync(cmdDir), 'commands/pan/ directory should exist');
  });

  test('has >= 30 command .md files', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length >= MIN_COMMAND_COUNT,
      `Expected >= ${MIN_COMMAND_COUNT} commands, found ${files.length}`);
  });

  test('critical commands exist', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    const files = fs.readdirSync(cmdDir);
    for (const cmd of CRITICAL_COMMANDS) {
      assert.ok(files.includes(`${cmd}.md`),
        `Critical command ${cmd}.md should exist`);
    }
  });

  test('command files are non-empty (> 100 bytes)', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const stat = fs.statSync(path.join(cmdDir, file));
      assert.ok(stat.size > 100,
        `${file} should be > 100 bytes, got ${stat.size}`);
    }
  });
});

describe('Copilot command discoverability', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('copilot');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('skills/ directory exists', () => {
    const skillsDir = path.join(runner.tmpDir, '.github', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills/ directory should exist');
  });

  test('has >= 30 skill directories', () => {
    const skillsDir = path.join(runner.tmpDir, '.github', 'skills');
    const dirs = fs.readdirSync(skillsDir).filter(d =>
      d.startsWith('pan-') && fs.statSync(path.join(skillsDir, d)).isDirectory());
    assert.ok(dirs.length >= MIN_COMMAND_COUNT,
      `Expected >= ${MIN_COMMAND_COUNT} skill dirs, found ${dirs.length}`);
  });

  test('each skill directory has SKILL.md', () => {
    const skillsDir = path.join(runner.tmpDir, '.github', 'skills');
    const dirs = fs.readdirSync(skillsDir).filter(d =>
      d.startsWith('pan-') && fs.statSync(path.join(skillsDir, d)).isDirectory());
    for (const dir of dirs) {
      const skillFile = path.join(skillsDir, dir, 'SKILL.md');
      assert.ok(fs.existsSync(skillFile),
        `${dir}/SKILL.md should exist`);
    }
  });

  test('SKILL.md files are non-empty', () => {
    const skillsDir = path.join(runner.tmpDir, '.github', 'skills');
    const dirs = fs.readdirSync(skillsDir).filter(d =>
      d.startsWith('pan-') && fs.statSync(path.join(skillsDir, d)).isDirectory());
    for (const dir of dirs) {
      const skillFile = path.join(skillsDir, dir, 'SKILL.md');
      const stat = fs.statSync(skillFile);
      assert.ok(stat.size > 100,
        `${dir}/SKILL.md should be > 100 bytes, got ${stat.size}`);
    }
  });
});

describe('Codex command discoverability', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('codex');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('skills/ directory exists', () => {
    const skillsDir = path.join(runner.tmpDir, '.agents', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills/ directory should exist');
  });

  test('has >= 30 skill directories', () => {
    const skillsDir = path.join(runner.tmpDir, '.agents', 'skills');
    const dirs = fs.readdirSync(skillsDir).filter(d =>
      d.startsWith('pan-') && fs.statSync(path.join(skillsDir, d)).isDirectory());
    assert.ok(dirs.length >= MIN_COMMAND_COUNT,
      `Expected >= ${MIN_COMMAND_COUNT} skill dirs, found ${dirs.length}`);
  });
});
