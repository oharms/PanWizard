/**
 * E-5 scenario test: verify native Claude skill shims are installed correctly.
 *
 * The installer generates `.claude/skills/pan-<cmd>.md` for each command in
 * `commands/pan/*.md` when runtime === 'claude'. This test installs into a
 * temp dir and asserts:
 *   - shim count matches source command count
 *   - shims have the expected frontmatter (name, description, source)
 *   - shim names are prefixed with "pan-"
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E-5 scenario: Claude skill shims installed', () => {
  let runner;
  beforeEach(() => {
    runner = createScenarioRunner('claude');
  });
  afterEach(() => {
    runner.cleanup();
  });

  test('skills/ directory exists with pan-* shim files', () => {
    const skillsDir = path.join(runner.tmpDir, '.claude', 'skills');
    assert.ok(fs.existsSync(skillsDir), `${skillsDir} should exist`);

    const shims = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
    assert.ok(shims.length > 0, 'at least one pan-* shim should be installed');
  });

  test('shim count matches source command count', () => {
    const srcCmdDir = path.join(__dirname, '..', '..', 'commands', 'pan');
    const srcCount = fs.readdirSync(srcCmdDir).filter(f => f.endsWith('.md')).length;

    const skillsDir = path.join(runner.tmpDir, '.claude', 'skills');
    const shimCount = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md')).length;

    assert.equal(shimCount, srcCount, `expected ${srcCount} shims, got ${shimCount}`);
  });

  test('each shim has valid frontmatter with name + description + source', () => {
    const skillsDir = path.join(runner.tmpDir, '.claude', 'skills');
    const shims = fs.readdirSync(skillsDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));

    for (const shim of shims) {
      const content = fs.readFileSync(path.join(skillsDir, shim), 'utf-8');
      assert.match(content, /^---\n/, `${shim} should start with frontmatter`);
      assert.match(content, /\nname: pan-/, `${shim} should have name: pan-`);
      assert.match(content, /\ndescription:/, `${shim} should have description`);
      assert.match(content, /\nsource: pan-wizard/, `${shim} should have source: pan-wizard`);
    }
  });

  test('shim body references the source command path and slash form', () => {
    const skillsDir = path.join(runner.tmpDir, '.claude', 'skills');
    const shim = fs.readFileSync(path.join(skillsDir, 'pan-focus-scan.md'), 'utf-8');
    assert.ok(shim.includes('.claude/commands/pan/focus-scan.md'));
    assert.ok(shim.includes('/pan:focus-scan'));
  });

  test('skill names mirror command filenames exactly', () => {
    const srcCmdDir = path.join(__dirname, '..', '..', 'commands', 'pan');
    const srcNames = fs.readdirSync(srcCmdDir)
      .filter(f => f.endsWith('.md'))
      .map(f => `pan-${f}`)
      .sort();

    const skillsDir = path.join(runner.tmpDir, '.claude', 'skills');
    const shimNames = fs.readdirSync(skillsDir)
      .filter(f => f.startsWith('pan-') && f.endsWith('.md'))
      .sort();

    assert.deepEqual(shimNames, srcNames);
  });
});

describe('E-5 scenario: Copilot runtime keeps existing skills/ pipeline', () => {
  let runner;
  beforeEach(() => {
    runner = createScenarioRunner('copilot');
  });
  afterEach(() => {
    runner.cleanup();
  });

  test('copilot runtime installs skills in its own format (directory per skill)', () => {
    const skillsDir = path.join(runner.tmpDir, '.github', 'skills');
    assert.ok(fs.existsSync(skillsDir));
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('pan-'));
    assert.ok(skillDirs.length > 0, 'copilot should install at least one skill directory');

    // Each skill dir contains SKILL.md (not the flat .md shims we use for Claude).
    const sample = skillDirs[0];
    const skillMd = path.join(skillsDir, sample.name, 'SKILL.md');
    assert.ok(fs.existsSync(skillMd), `${sample.name}/SKILL.md should exist`);
  });
});
