// The five LOW findings the 3.28.0 code review left open (fixed 2026-09-26).

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const lib = require('../bin/install-lib.cjs');
const { buildPluginInto, buildAgentPluginInto, withFakeHome, cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));

describe('the Agent Plugins bundle explains its root token to Copilot agents', () => {
  let out;
  before(() => { out = buildAgentPluginInto(); });
  after(() => cleanup(out));

  test('every bundled Copilot agent that carries the token carries the agent note', () => {
    const dir = path.join(out, 'com.github.copilot', 'agents');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.agent.md'));
    const withToken = files.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(lib.AGENT_PLUGIN_ROOT_TOKEN));
    assert.ok(withToken.length > 0, 'non-vacuity: some agents reference the core');
    for (const f of withToken) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(text.includes(lib.agentPluginSkillAdapterNote('agent')), `${f} has the token but not the note`);
    }
  });

  test('the skill note is unchanged, and the agent note names an agent', () => {
    assert.match(lib.agentPluginSkillAdapterNote(), /in this skill is .* two levels above this SKILL\.md/);
    assert.match(lib.agentPluginSkillAdapterNote('agent'), /in this agent is .* two levels above this agent file/);
  });
});

describe('the update check knows the version under a plugin host', () => {
  let plugin;
  before(() => { plugin = buildPluginInto(); });
  after(() => cleanup(plugin));

  test('the plugin copy reads the core beside it, not 0.0.0', () => {
    const noNpm = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-no-npm-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-plugin-proj-'));
    try {
      withFakeHome((home) => {
        const r = spawnSync(process.execPath, [path.join(plugin, 'hooks', 'pan-check-update.js'), '--run-check'], {
          cwd: project, encoding: 'utf8', timeout: 60000,
          env: { ...process.env, PATH: noNpm, Path: noNpm },
        });
        assert.equal(r.status, 0, r.stderr);
        const record = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'cache', 'pan-update-check.json'), 'utf8'));
        assert.equal(record.installed, PKG.version);
      });
    } finally {
      cleanup(noNpm);
      cleanup(project);
    }
  });
});

describe('plugin-path.js builds where it prints', () => {
  test('an inherited PAN_PLUGIN_OUT does not redirect the build', () => {
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-stray-out-'));
    try {
      const printed = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'plugin-path.js')], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PAN_PLUGIN_OUT: stray },
      }).trim();
      assert.equal(path.resolve(printed), path.resolve(ROOT, 'dist', 'pan-wizard-plugin'));
      assert.ok(fs.existsSync(path.join(printed, '.claude-plugin', 'plugin.json')), 'the printed directory holds the build');
      assert.deepEqual(fs.readdirSync(stray), [], 'nothing was built into the inherited directory');
    } finally {
      cleanup(stray);
    }
  });
});

describe('dirDigest does not depend on the locale', () => {
  test('entries are ordered by code unit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-digest-'));
    try {
      // localeCompare puts these a, b, B, _x (or similar); code units put them B, _x, a, b.
      for (const name of ['b', 'B2', 'a', '_x']) fs.writeFileSync(path.join(dir, name), name);
      const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
      const expected = sha(['B2', '_x', 'a', 'b'].map((n) => `${n}:${sha(n)}`).join('\n'));
      assert.equal(lib.dirDigest(dir), expected);
    } finally {
      cleanup(dir);
    }
  });
});

describe('the MCP per-call cwd states its trust assumption', () => {
  test('the property description says whose permissions the server acts with', () => {
    const registry = require('../pan-wizard-core/mcp/tool-registry.cjs');
    const tool = registry.TOOLS.find((t) => t.name === 'pan_resolve_model');
    assert.match(tool.inputSchema.properties.cwd.description, /permissions of the user/);
  });
});
