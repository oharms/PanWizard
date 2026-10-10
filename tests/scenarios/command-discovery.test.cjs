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

// A bare `pan-tools <verb>` cannot run: no runtime puts a `pan-tools` bin on PATH.
// Codex and Copilot content was rewritten to `node <core>/bin/pan-tools.cjs`, but the
// Claude, Gemini and OpenCode copies kept it in fourteen commands and agents
// (doc audit 2026-10-05).
describe('installed content invokes pan-tools by path on every runtime', () => {
  const { createScenarioRunner } = require('../helpers.cjs');
  const BARE = /\bpan-tools(?=\s+[a-z])/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    // CHANGELOG.md ships as release notes, copied verbatim: history, not instructions.
    return /\.(md|toml)$/.test(e.name) && e.name !== 'CHANGELOG.md' ? [p] : [];
  });
  // "First, read ~/.claude/agents/pan-planner.md for your role": after the prefix
  // rewrite that is `./.codex/agents/pan-planner.md`, but Codex installs agents as
  // `.toml` and Copilot as `.agent.md`, so the spawned agent read nothing and ran with
  // no role (doc audit 2026-10-05).
  const AGENT_REF = /\.\/(\.(?:claude|codex|gemini|opencode|github))\/agents\/(pan-[a-z0-9_-]+(?:\.agent)?\.(?:md|toml))\b/g;
  const RUNTIME_DIRS = { claude: '.claude', codex: '.codex', gemini: '.gemini', opencode: '.opencode', copilot: '.github' };
  for (const runtime of Object.keys(RUNTIME_DIRS)) {
    test(`${runtime}: every agent file an installed prompt names exists in the install`, () => {
      const runner = createScenarioRunner(runtime);
      try {
        const roots = [RUNTIME_DIRS[runtime], '.agents'].map((d) => path.join(runner.tmpDir, d)).filter((d) => fs.existsSync(d));
        const files = roots.flatMap(walk);
        const missing = new Set();
        let seen = 0;
        for (const f of files) {
          for (const [ref, dir, file] of fs.readFileSync(f, 'utf8').matchAll(AGENT_REF)) {
            seen++;
            if (!fs.existsSync(path.join(runner.tmpDir, dir, 'agents', file))) missing.add(`${path.relative(runner.tmpDir, f)} → ${ref}`);
          }
        }
        assert.ok(seen > 0, 'no installed prompt names an agent file, so this check proves nothing');
        assert.deepEqual([...missing], []);
      } finally { runner.cleanup(); }
    });
  }

  for (const runtime of ['claude', 'gemini', 'opencode']) {
    test(`${runtime}: no installed command, agent or workflow calls a bare pan-tools`, () => {
      const runner = createScenarioRunner(runtime);
      try {
        const dirName = { claude: '.claude', gemini: '.gemini', opencode: '.opencode' }[runtime];
        const files = walk(path.join(runner.tmpDir, dirName));
        assert.ok(files.length > 0);
        const bare = files.filter((f) => BARE.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(runner.tmpDir, f));
        assert.deepEqual(bare, []);
      } finally { runner.cleanup(); }
    });
  }
});
