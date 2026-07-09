/**
 * Agent Structure Validation Tests (ADR-0019: UAT-004)
 *
 * Validates that installed agent .md files have valid structure:
 * frontmatter with 'name' field, body with <objective> XML tag,
 * sufficient count, and non-empty content.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

const MIN_AGENT_COUNT = 10;

describe('Claude agent structure validation', () => {
  let runner;
  let agentDir;
  let agentFiles;

  before(() => {
    runner = createScenarioRunner('claude');
    agentDir = path.join(runner.tmpDir, '.claude', 'agents');
    agentFiles = fs.existsSync(agentDir)
      ? fs.readdirSync(agentDir).filter(f => f.endsWith('.md'))
      : [];
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('agents/ directory exists', () => {
    assert.ok(fs.existsSync(agentDir), 'agents/ directory should exist');
  });

  test('has >= 10 agent .md files', () => {
    assert.ok(agentFiles.length >= MIN_AGENT_COUNT,
      `Expected >= ${MIN_AGENT_COUNT} agents, found ${agentFiles.length}`);
  });

  test('agent files are non-empty', () => {
    for (const file of agentFiles) {
      const stat = fs.statSync(path.join(agentDir, file));
      assert.ok(stat.size > 100,
        `Agent ${file} should be > 100 bytes, got ${stat.size}`);
    }
  });

  test('each agent has name in frontmatter', () => {
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
      // Frontmatter is between --- markers at the start of the file
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fmMatch,
        `Agent ${file} should have frontmatter (--- delimited block at start)`);
      const frontmatter = fmMatch[1];
      assert.ok(/^name\s*:/m.test(frontmatter),
        `Agent ${file} frontmatter should contain 'name:' field`);
    }
  });

  test('each agent has <role> tag in body', () => {
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
      // Body is after the second --- marker
      const bodyStart = content.indexOf('---', content.indexOf('---') + 3);
      const body = bodyStart >= 0 ? content.slice(bodyStart + 3) : content;
      assert.ok(body.includes('<role>'),
        `Agent ${file} body should contain <role> tag`);
    }
  });

  test('each agent has description in frontmatter', () => {
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const frontmatter = fmMatch[1];
        assert.ok(/^description\s*:/m.test(frontmatter),
          `Agent ${file} frontmatter should contain 'description:' field`);
      }
    }
  });

  test('agent filenames follow pan-* naming convention', () => {
    for (const file of agentFiles) {
      assert.ok(file.startsWith('pan-'),
        `Agent file ${file} should start with 'pan-' prefix`);
    }
  });

  test('no duplicate agent names', () => {
    const names = [];
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
      const nameMatch = content.match(/^name\s*:\s*(.+)$/m);
      if (nameMatch) {
        names.push(nameMatch[1].trim());
      }
    }
    const unique = new Set(names);
    assert.equal(names.length, unique.size,
      `Agent names should be unique. Duplicates found in: ${names.join(', ')}`);
  });
});
