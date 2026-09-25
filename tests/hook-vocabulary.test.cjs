/**
 * Every hook event key PAN emits is one its runtime documents (reality check
 * 2026-09-22, R30).
 *
 * From v3.4 until 2026-09-23 PAN wrote Claude's event names — PostToolUse,
 * SubagentStop, Stop — into Gemini CLI's settings.json. Gemini's hook registry
 * skips any key outside its own vocabulary with an "Invalid hook event name"
 * warning, so three of PAN's four Gemini hooks never ran. The suite had tests for
 * those registrations, and every one passed: they were derived from the
 * installer's own table, so they agreed with it. This file checks the other
 * direction — the emitted keys against each runtime's documented list in
 * tests/fixtures/hook-vocabulary.json — for the table, for a real five-runtime
 * install, and for both plugin bundles.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../bin/install-lib.cjs');
const { installInto, cleanup, buildPluginInto, buildAgentPluginInto, RUNTIME_DIR } = require('./helpers.cjs');

const VOCAB = require(path.join(__dirname, 'fixtures', 'hook-vocabulary.json')).runtimes;
const vocabularyOf = (runtime) => new Set([...(VOCAB[runtime].events || []), ...(VOCAB[runtime].pascal_aliases || [])]);

/** The event keys of a parsed hooks config, and the keys outside the runtime's vocabulary. */
function checkKeys(config, runtime) {
  const keys = Object.keys((config && config.hooks) || {});
  const allowed = vocabularyOf(runtime);
  return { keys, unknown: keys.filter((k) => !allowed.has(k)) };
}

describe('the vocabulary fixture carries its evidence', () => {
  test('every runtime with a hook surface has a sourced, dated, non-empty list', () => {
    for (const runtime of ['claude', 'gemini', 'codex', 'copilot']) {
      const v = VOCAB[runtime];
      assert.ok(v, `${runtime}: missing from the fixture`);
      assert.match(String(v.source), /^https:\/\//, `${runtime}: cite the primary source`);
      assert.match(String(v.read), /^\d{4}-\d{2}-\d{2}$/, `${runtime}: date the read`);
      assert.ok(Array.isArray(v.events) && v.events.length > 0, `${runtime}: the event list is empty`);
    }
  });
});

describe('HOOK_EVENT_MAP names only documented events (R30)', () => {
  for (const [runtime, spec] of Object.entries(lib.HOOK_EVENT_MAP)) {
    if (!spec) continue; // OpenCode: no hook system, asserted in installer-functions.test.cjs
    test(`${runtime}: every non-null slot is an event ${runtime} documents`, () => {
      const allowed = vocabularyOf(runtime);
      const named = Object.entries(spec).filter(([slot, ev]) => slot !== 'surface' && ev !== null);
      assert.ok(named.length > 0, `${runtime}: the table names no event at all`);
      for (const [slot, event] of named) {
        assert.ok(allowed.has(event), `${runtime}.${slot} = "${event}" is not in ${runtime}'s documented vocabulary (${VOCAB[runtime].source})`);
      }
    });
  }
});

describe('a five-runtime install writes only documented event keys (R30)', () => {
  let projectDir;
  const surfaces = {
    claude: ['settings.json'],
    gemini: ['settings.json'],
    codex: ['hooks.json'],
    copilot: ['hooks', 'pan.json'],
  };
  const parsed = {};

  before(() => {
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-hook-vocab-')));
    const r = installInto(projectDir, ['--claude', '--codex', '--gemini', '--opencode', '--copilot', '--local', '--skip-warnings']);
    if (!r.success) throw new Error(`five-runtime install failed: ${r.error || r.output}`);
    for (const [runtime, rel] of Object.entries(surfaces)) {
      parsed[runtime] = JSON.parse(fs.readFileSync(path.join(projectDir, RUNTIME_DIR[runtime], ...rel), 'utf8'));
    }
  });

  after(() => { if (projectDir) cleanup(projectDir); });

  for (const runtime of Object.keys(surfaces)) {
    test(`${runtime}: every hooks key in ${surfaces[runtime].join('/')} is in ${runtime}'s vocabulary`, () => {
      const { keys, unknown } = checkKeys(parsed[runtime], runtime);
      assert.ok(keys.length > 0, `${runtime}: no hook keys written — the check below would pass vacuously`);
      assert.deepEqual(unknown, [], `${runtime}: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not ${runtime} events — the runtime will not run ${unknown.length === 1 ? 'it' : 'them'}`);
    });
  }

  test('codex: the file carries no top-level key Codex would reject', () => {
    // Codex parses hooks.json with deny_unknown_fields: one extra key fails the file.
    const allowed = new Set(VOCAB.codex.top_level_keys);
    assert.deepEqual(Object.keys(parsed.codex).filter((k) => !allowed.has(k)), []);
  });

  test('copilot: the file is the version-1 schema with no unknown top-level key', () => {
    const allowed = new Set(VOCAB.copilot.top_level_keys);
    assert.deepEqual(Object.keys(parsed.copilot).filter((k) => !allowed.has(k)), []);
    assert.equal(parsed.copilot.version, 1);
  });
});

describe('the plugin bundles emit only documented event keys (R30)', () => {
  let claudePlugin;
  let agentPlugin;

  before(() => {
    claudePlugin = buildPluginInto();
    agentPlugin = buildAgentPluginInto();
  });

  after(() => {
    for (const dir of [claudePlugin, agentPlugin]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const cases = [
    { label: 'Claude plugin hooks/hooks.json', runtime: 'claude', root: () => claudePlugin, rel: ['hooks', 'hooks.json'] },
    { label: 'Agent Plugins bundle hooks/hooks.json (Codex)', runtime: 'codex', root: () => agentPlugin, rel: ['hooks', 'hooks.json'] },
    { label: 'Agent Plugins bundle com.github.copilot/hooks/hooks.json', runtime: 'copilot', root: () => agentPlugin, rel: [lib.COPILOT_PLUGIN_NAMESPACE || 'com.github.copilot', 'hooks', 'hooks.json'] },
  ];

  for (const c of cases) {
    test(`${c.label}: every event key is a documented ${c.runtime} event`, () => {
      const file = path.join(c.root(), ...c.rel);
      assert.equal(fs.existsSync(file), true, `${c.label} was not built at ${file}`);
      const { keys, unknown } = checkKeys(JSON.parse(fs.readFileSync(file, 'utf8')), c.runtime);
      assert.ok(keys.length > 0, `${c.label}: no hook keys — the check would pass vacuously`);
      assert.deepEqual(unknown, [], `${c.label}: ${unknown.join(', ')} not in the ${c.runtime} vocabulary`);
    });
  }
});
