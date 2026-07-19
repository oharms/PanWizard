/**
 * PAN-Z M3/M4 — content port (agent/command conversion) and the ZCode bundle
 * assembler (install-zcode buildBundle), including the source-repo write guard.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const conv = require('../pan-zcode/lib/convert-agent.cjs');
const { buildBundle, assertNotInSourceRepo, mcpServerConfig } = require('../pan-zcode/bin/install-zcode.js');
const { cleanup } = require('./helpers.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pan-zcode-'));

describe('convert-agent (M3)', () => {
  const SAMPLE = [
    '---',
    'name: pan-reviewer',
    'description: Reviews code changes for correctness.',
    'model: opus',
    'color: cyan',
    'tools: Read, Grep, Glob, Task, mcp__foo__bar, Bash',
    '---',
    '# Reviewer',
    'Body content here.',
  ].join('\n');

  test('maps model→inherit (with tier hint), drops Task + mcp__ tools, preserves body', () => {
    const out = conv.convertClaudeToZcodeAgent(SAMPLE);
    assert.match(out, /name: pan-reviewer/);
    assert.match(out, /description: Reviews code changes/);
    assert.match(out, /model: inherit/);
    assert.match(out, /pan-tier: opus/);
    assert.match(out, /color: cyan/);
    // Task (no nesting) and mcp__ (host-specific) are removed; the rest stay.
    assert.match(out, /tools: Read, Grep, Glob, Bash/);
    assert.ok(!/Task/.test(out.split('---')[2] || out), 'Task not in tools line');
    assert.ok(!out.includes('mcp__foo'));
    assert.match(out, /Body content here\./);
  });

  test('remapTools returns null when nothing survives', () => {
    assert.equal(conv.remapTools('Task, mcp__x'), null);
    assert.equal(conv.remapTools(''), null);
  });

  test('convertAgentsDir converts the real agents/ tree into subagent files', () => {
    const dest = tmp();
    try {
      const out = conv.convertAgentsDir(path.join(REPO_ROOT, 'agents'), path.join(dest, 'agents'));
      assert.ok(out.length >= 1, 'converted at least one agent');
      for (const a of out) {
        assert.ok(fs.existsSync(a.dest));
        const text = fs.readFileSync(a.dest, 'utf8');
        assert.match(text, /^---\nname: /, 'has ZCode frontmatter');
        assert.match(text, /model: inherit/);
        assert.ok(!/\bmodel: opus\b/.test(text), 'PAN tier never leaks as a ZCode model id');
      }
    } finally { cleanup(dest); }
  });

  test('command → skill wrapper notes the MCP mapping', () => {
    const skill = conv.convertClaudeCommandToZcodeSkill('---\nname: x\n---\nDo the thing.', 'exec-phase');
    assert.match(skill, /name: pan-exec-phase/);
    assert.match(skill, /pan-mcp/);
    assert.match(skill, /Do the thing\./);
  });
});

describe('install-zcode buildBundle (M4)', () => {
  test('assembles agents + a valid pan-mcp.json + manifest + instructions', () => {
    const dest = tmp();
    try {
      const res = buildBundle({ repoRoot: REPO_ROOT, destDir: dest, projectRoot: '/my/project' });
      assert.ok(res.agents >= 1);
      // MCP config shape ZCode reads
      const mcp = JSON.parse(fs.readFileSync(path.join(dest, 'pan-mcp.json'), 'utf8'));
      const srv = mcp.mcpServers['pan-mcp'];
      assert.equal(srv.command, 'node');
      assert.match(srv.args[0], /pan-zcode[\\/]mcp[\\/]server\.cjs$/);
      assert.match(srv.env.PAN_TOOLS_PATH, /pan-tools\.cjs$/);
      assert.equal(srv.env.PAN_PROJECT_ROOT, '/my/project');
      // manifest + instructions
      const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'pan-zcode-manifest.json'), 'utf8'));
      assert.equal(manifest.subsystem, 'pan-zcode');
      assert.ok(manifest.agents.length >= 1);
      assert.ok(fs.existsSync(path.join(dest, 'INSTALL-ZCODE.md')));
      assert.ok(fs.existsSync(path.join(dest, 'agents')));
    } finally { cleanup(dest); }
  });

  test('refuses to write the bundle inside the PAN source repo', () => {
    assert.throws(() => buildBundle({ repoRoot: REPO_ROOT, destDir: path.join(REPO_ROOT, 'pan-zcode', 'out') }), /source repo/);
    assert.throws(() => assertNotInSourceRepo(REPO_ROOT, REPO_ROOT), /source repo/);
    // a sibling outside the repo is fine
    assert.doesNotThrow(() => assertNotInSourceRepo(path.join(os.tmpdir(), 'x'), REPO_ROOT));
  });

  test('the source-repo guard is case-insensitive on case-folding filesystems', () => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return; // case-sensitive FS: N/A
    // A case-variant of the repo path pointing back inside the repo must still be refused.
    const variant = path.join(REPO_ROOT.toUpperCase(), 'pan-zcode', 'out');
    assert.throws(() => assertNotInSourceRepo(variant, REPO_ROOT), /source repo/);
  });

  test('mcpServerConfig is pure and stable', () => {
    const c = mcpServerConfig('/p/pan-tools.cjs', '/s/server.cjs', '/proj');
    assert.deepEqual(c.mcpServers['pan-mcp'].args, ['/s/server.cjs']);
    assert.equal(c.mcpServers['pan-mcp'].env.PAN_PROJECT_ROOT, '/proj');
  });
});
