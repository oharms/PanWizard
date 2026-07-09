'use strict';

/**
 * Workflow Command Structure Tests
 *
 * Validates workflow-only commands (no pan-tools dispatcher entry) are:
 * 1. Delivered by the installer to all runtimes
 * 2. Have valid frontmatter with required fields
 * 3. Reference valid allowed-tools
 * 4. Contain expected structural elements
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

// Commands that are workflow-only (no pan-tools dispatcher route)
const WORKFLOW_COMMANDS = [
  'audit-deployment',
  'focus-drift-walking',
  'focus-doc-audit',
  'focus-design',
  'focus-plan',
  'profile',
];

// Valid tools that can appear in allowed-tools frontmatter
const VALID_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob',
  'Agent', 'AskUserQuestion', 'WebFetch', 'WebSearch',
];

function isValidTool(tool) {
  // Built-in tools
  if (VALID_TOOLS.includes(tool)) return true;
  // MCP tools (mcp__server__method)
  if (tool.startsWith('mcp__')) return true;
  return false;
}

function parseFrontmatter(content) {
  // Normalize line endings to LF for consistent parsing
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const fields = {};
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  // Parse allowed-tools list
  const toolsMatch = yaml.match(/allowed-tools:\n((?:\s+-\s+\S+\n?)+)/);
  if (toolsMatch) {
    fields['allowed-tools'] = toolsMatch[1]
      .split('\n')
      .map(l => l.replace(/^\s+-\s+/, '').trim())
      .filter(Boolean);
  }
  return fields;
}

describe('Workflow command delivery — Claude', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  for (const cmd of WORKFLOW_COMMANDS) {
    test(`${cmd}.md is installed`, () => {
      const cmdPath = path.join(runner.tmpDir, '.claude', 'commands', 'pan', `${cmd}.md`);
      assert.ok(fs.existsSync(cmdPath), `${cmd}.md should exist after install`);
    });
  }

  test('workflow commands have valid frontmatter', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    for (const cmd of WORKFLOW_COMMANDS) {
      const content = fs.readFileSync(path.join(cmdDir, `${cmd}.md`), 'utf8');
      const fm = parseFrontmatter(content);
      assert.ok(fm, `${cmd}.md should have YAML frontmatter`);
      assert.ok(fm.name, `${cmd}.md should have name field`);
      assert.ok(fm.description, `${cmd}.md should have description field`);
    }
  });

  test('workflow commands reference only valid tools', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    for (const cmd of WORKFLOW_COMMANDS) {
      const content = fs.readFileSync(path.join(cmdDir, `${cmd}.md`), 'utf8');
      const fm = parseFrontmatter(content);
      if (fm && fm['allowed-tools']) {
        for (const tool of fm['allowed-tools']) {
          assert.ok(isValidTool(tool),
            `${cmd}.md references invalid tool "${tool}"`);
        }
      }
    }
  });

  test('workflow commands are non-trivial (> 500 bytes)', () => {
    const cmdDir = path.join(runner.tmpDir, '.claude', 'commands', 'pan');
    for (const cmd of WORKFLOW_COMMANDS) {
      const stat = fs.statSync(path.join(cmdDir, `${cmd}.md`));
      assert.ok(stat.size > 500,
        `${cmd}.md should be > 500 bytes (workflow), got ${stat.size}`);
    }
  });
});

describe('Workflow command delivery — Codex (skills format)', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('codex');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  for (const cmd of WORKFLOW_COMMANDS) {
    test(`pan-${cmd} skill exists`, () => {
      const skillDir = path.join(runner.tmpDir, '.agents', 'skills', `pan-${cmd}`);
      assert.ok(fs.existsSync(skillDir), `pan-${cmd}/ skill dir should exist`);
      const skillFile = path.join(skillDir, 'SKILL.md');
      assert.ok(fs.existsSync(skillFile), `pan-${cmd}/SKILL.md should exist`);
    });
  }
});

describe('Workflow command delivery — Copilot (skills format)', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('copilot');
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  for (const cmd of WORKFLOW_COMMANDS) {
    test(`pan-${cmd} skill exists`, () => {
      const skillDir = path.join(runner.tmpDir, '.github', 'skills', `pan-${cmd}`);
      assert.ok(fs.existsSync(skillDir), `pan-${cmd}/ skill dir should exist`);
      const skillFile = path.join(skillDir, 'SKILL.md');
      assert.ok(fs.existsSync(skillFile), `pan-${cmd}/SKILL.md should exist`);
    });
  }
});
