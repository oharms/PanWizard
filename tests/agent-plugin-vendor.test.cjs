/**
 * Agent Plugins bundle — vendor directories, hooks and distribution manifests
 * (ADR-0045 D5/D7; plan items 4c, 4d, 4f).
 *
 * The portable core (manifest, skills, mcp.json) is covered by
 * agent-plugin-build.test.cjs. This file pins the parts that are CLIENT-specific
 * and therefore each carry their own verification status:
 *
 *   hooks/hooks.json                Codex default plugin-hooks location; matcher-group
 *                                   shape with `${PLUGIN_ROOT}` — from the Codex plugin
 *                                   reference (developers.openai.com, read 2026-09-10)
 *   com.github.copilot/agents/      Copilot `.agent.md` agents — namespace from VS Code's
 *   com.github.copilot/hooks/       agent-plugins doc; flat PascalCase hooks with
 *                                   `${CLAUDE_PLUGIN_ROOT}`. VS-Code-verified; the Copilot
 *                                   CLI live install is the remaining gate
 *   .agents/plugins/marketplace.json Codex repo-scoped marketplace pointing at the build
 *
 * Every path either hooks file names must exist inside the bundle: a hook that
 * points at a script the bundle does not carry looks fine on disk and never runs.
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const lib = require('../bin/install-lib.cjs');
const { buildAgentPluginInto, cleanup } = require('./helpers.cjs');
const { escapeRegex } = require('../pan-wizard-core/bin/lib/core.cjs');

const ROOT = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const NS = lib.COPILOT_PLUGIN_NAMESPACE;

// Resolve a `${VAR}/...` hook command's script path inside the bundle.
function scriptOf(command, rootVar) {
  const m = command.match(/^node \$\{([A-Z_]+)\}\/(hooks\/pan-[a-z-]+\.js)$/);
  assert.ok(m, `hook command has an unexpected shape: ${command}`);
  assert.equal(m[1], rootVar, `hook command must anchor at \${${rootVar}}: ${command}`);
  return m[2];
}

describe('Agent Plugins bundle: hooks and vendor directories', () => {
  const OUT = buildAgentPluginInto();
  after(() => cleanup(OUT));

  test('non-vacuity: hook scripts, a Codex hooks.json and the Copilot namespace are all present', () => {
    assert.ok(fs.readdirSync(path.join(OUT, 'hooks')).some(f => /^pan-.*\.js$/.test(f)), 'no hook scripts');
    assert.ok(fs.existsSync(path.join(OUT, 'hooks', 'hooks.json')), 'no Codex hooks.json');
    assert.ok(fs.existsSync(path.join(OUT, NS, 'hooks', 'hooks.json')), 'no Copilot hooks.json');
    assert.ok(fs.readdirSync(path.join(OUT, NS, 'agents')).length > 0, 'no Copilot agents');
  });

  test('hook scripts in the bundle are exactly the PAN hook scripts this repo ships', () => {
    const shipped = fs.readdirSync(path.join(ROOT, 'hooks')).filter(f => /^pan-[a-z-]+\.js$/.test(f)).sort();
    const bundled = fs.readdirSync(path.join(OUT, 'hooks')).filter(f => f.endsWith('.js')).sort();
    assert.deepEqual(bundled, shipped);
  });

  test('Codex hooks.json: documented default location, matcher-group shape, ${PLUGIN_ROOT} paths that resolve, observers async', () => {
    const cfg = readJson(path.join(OUT, 'hooks', 'hooks.json'));
    assert.deepEqual(Object.keys(cfg), ['hooks'], 'top level is the hooks map only');
    for (const ev of ['SessionStart', 'PostToolUse', 'SubagentStop']) assert.ok(Array.isArray(cfg.hooks[ev]), `${ev} registered`);
    const handlers = Object.values(cfg.hooks).flat().flatMap(g => g.hooks || []);
    assert.ok(handlers.length >= 4, 'all four PAN hooks registered');
    for (const h of handlers) {
      assert.equal(h.type, 'command');
      const rel = scriptOf(h.command, 'PLUGIN_ROOT');
      assert.ok(fs.existsSync(path.join(OUT, rel)), `hook points at a script the bundle lacks: ${rel}`);
    }
    const byMarker = (m) => handlers.find(h => h.command.includes(m));
    for (const observer of ['pan-check-update', 'pan-cost-logger', 'pan-trace-logger']) {
      assert.equal(byMarker(observer)?.async, true, `${observer} is a pure observer → async`);
    }
    assert.equal(byMarker('pan-context-monitor')?.async, undefined, 'the context monitor injects context and must stay synchronous');
  });

  test('Copilot hooks.json: flat PascalCase format with ${CLAUDE_PLUGIN_ROOT} paths that resolve', () => {
    const cfg = readJson(path.join(OUT, NS, 'hooks', 'hooks.json'));
    assert.deepEqual(Object.keys(cfg), ['hooks']);
    for (const [ev, entries] of Object.entries(cfg.hooks)) {
      assert.match(ev, /^[A-Z][A-Za-z]+$/, `plugin hook events are PascalCase: ${ev}`);
      assert.ok(Array.isArray(entries) && entries.length > 0, `${ev} has entries`);
      for (const e of entries) {
        assert.equal(e.type, 'command');
        assert.equal(e.hooks, undefined, 'flat format — no nested matcher groups');
        const rel = scriptOf(e.command, 'CLAUDE_PLUGIN_ROOT');
        assert.ok(fs.existsSync(path.join(OUT, rel)), `hook points at a script the bundle lacks: ${rel}`);
      }
    }
    assert.ok(cfg.hooks.SubagentStop.length >= 2, 'cost and trace loggers both ride SubagentStop');
  });

  test('Copilot agents: one .agent.md per source agent, Copilot frontmatter, bundle-token core references that resolve, no install paths', () => {
    const src = fs.readdirSync(path.join(ROOT, 'agents')).filter(f => f.endsWith('.md')).sort();
    const out = fs.readdirSync(path.join(OUT, NS, 'agents')).sort();
    assert.deepEqual(out, src.map(f => f.replace(/\.md$/, '.agent.md')));
    const token = escapeRegex(lib.AGENT_PLUGIN_ROOT_TOKEN);
    const refRe = new RegExp(`${token}/([A-Za-z0-9_./-]*[A-Za-z0-9_/-])`, 'g');
    const problems = [];
    for (const f of out) {
      const text = fs.readFileSync(path.join(OUT, NS, 'agents', f), 'utf8');
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) { problems.push(`${f}: no frontmatter`); continue; }
      if (!/^name:\s*\S/m.test(fm[1]) || !/^description:\s*\S/m.test(fm[1])) problems.push(`${f}: name/description missing`);
      if (/^(effort|thinking|thinking_budget):/m.test(fm[1])) problems.push(`${f}: Claude-only frontmatter survived`);
      for (const bad of [/~\/\.claude\//, /\.\/\.claude\//, /\.claude\/pan-wizard-core/, /\$\{CLAUDE_PLUGIN_ROOT\}/]) {
        if (bad.test(text)) problems.push(`${f}: leaked install path ${bad}`);
      }
      for (const m of text.matchAll(refRe)) {
        if (!fs.existsSync(path.join(OUT, m[1]))) problems.push(`${f}: dangling reference ${m[1]}`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('the manifest stays closed-schema clean with the vendor directory present (no extensions key needed)', () => {
    const manifest = readJson(path.join(OUT, 'plugin.json'));
    assert.equal(manifest.extensions, undefined, 'Codex discovers hooks/hooks.json by default and Copilot is file-based — nothing to declare');
  });
});

describe('Agent Plugins bundle: Codex repo-scoped marketplace (.agents/plugins/marketplace.json)', () => {
  // Shape from developers.openai.com/plugins/build/plugins (read 2026-09-10):
  // name, interface.displayName, plugins[{name, source{source:'local', path}, policy}].
  // Local paths must be `./`-relative and stay inside the marketplace root.
  const file = path.join(ROOT, '.agents', 'plugins', 'marketplace.json');

  test('exists at the documented repo-scoped location and parses', () => {
    assert.ok(fs.existsSync(file), 'missing .agents/plugins/marketplace.json');
    const m = readJson(file);
    assert.ok(typeof m.name === 'string' && m.name, 'marketplace needs a name');
    assert.ok(Array.isArray(m.plugins) && m.plugins.length === 1, 'exactly one plugin entry: PAN');
  });

  test('the entry names the bundle the builder emits, by a relative path inside the repo', () => {
    const m = readJson(file);
    const entry = m.plugins[0];
    assert.equal(entry.name, lib.buildAgentPluginManifest(readJson(path.join(ROOT, 'package.json'))).name,
      'marketplace plugin name must equal the bundle manifest name');
    assert.equal(entry.source.source, 'local');
    assert.ok(entry.source.path.startsWith('./'), 'local sources must be ./-relative');
    assert.ok(!entry.source.path.includes('..'), 'must stay inside the marketplace root');
    assert.equal(entry.source.path, './dist/pan-agent-plugin', 'must point at build-agent-plugin.js\'s default output');
    assert.ok(['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE'].includes(entry.policy.installation));
  });

  test('buildCopilotPluginHooksConfig registers the stop guard under Copilot\'s Stop alias (M14)', () => {
    const cfg = lib.buildCopilotPluginHooksConfig({ stopGuardCommand: 'node x/pan-stop-guard.js' });
    assert.deepEqual(cfg, { hooks: { Stop: [{ type: 'command', command: 'node x/pan-stop-guard.js' }] } });
  });

  test('buildCopilotPluginHooksConfig omits events whose command is absent and never nests matcher groups', () => {
    const cfg = lib.buildCopilotPluginHooksConfig({ costLoggerCommand: 'node x/pan-cost-logger.js' });
    assert.deepEqual(cfg, { hooks: { SubagentStop: [{ type: 'command', command: 'node x/pan-cost-logger.js' }] } });
    assert.deepEqual(lib.buildCopilotPluginHooksConfig({}), { hooks: {} });
  });
});

describe('Agent Plugins bundle: Copilot marketplace (.github/plugin/marketplace.json)', () => {
  // Shape from docs.github.com (plugins-marketplace, read 2026-09-10): name,
  // owner{name,email}, metadata{description,version}, plugins[{name, description,
  // version, source}] — `source` is a repo-root-relative path; `./` is optional.
  // Added with `copilot plugin marketplace add <owner/repo>`.
  const file = path.join(ROOT, '.github', 'plugin', 'marketplace.json');

  test('exists at the documented location and carries the documented fields', () => {
    assert.ok(fs.existsSync(file), 'missing .github/plugin/marketplace.json');
    const m = readJson(file);
    assert.ok(m.name && m.owner && m.owner.name && m.metadata && m.metadata.description, 'name/owner/metadata required');
    assert.ok(Array.isArray(m.plugins) && m.plugins.length === 1);
  });

  test('the entry mirrors the bundle manifest and points at the builder\'s default output', () => {
    const pkg = readJson(path.join(ROOT, 'package.json'));
    const manifest = lib.buildAgentPluginManifest(pkg);
    const entry = readJson(file).plugins[0];
    assert.equal(entry.name, manifest.name);
    assert.equal(entry.description, manifest.description, 'description must mirror the manifest (which mirrors package.json)');
    assert.equal(entry.version, pkg.version, 'version must track package.json — a stale marketplace advertises a release that is not the build');
    assert.equal(entry.source.replace(/^\.\//, ''), 'dist/pan-agent-plugin');
    assert.ok(!entry.source.includes('..'));
  });
});
