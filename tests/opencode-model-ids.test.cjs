// OpenCode model ids are `provider/model` (reality check R41).
//
// Workflows pass `resolve-model` output straight into a subagent spawn, and
// OpenCode names every model `provider_id/model_id` (its models doc; built-in ids
// from models.dev, both read 2026-09-26). PAN used to hand OpenCode the Claude Code
// aliases `sonnet`/`haiku` or bare API ids like `gpt-6-sol` — neither is an
// OpenCode id. The copy of PAN installed under `.opencode/` now resolves to
// provider-qualified ids; every other copy keeps its ids unchanged.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const core = require('../pan-wizard-core/bin/lib/core.cjs');
const { DEFAULT_RATES } = require('../pan-wizard-core/bin/lib/cost.cjs');
const { installInto, cleanup } = require('./helpers.cjs');

describe('hostRuntime reads the install location', () => {
  test('a project or global OpenCode install is OpenCode', () => {
    assert.equal(core.hostRuntime('/work/app/.opencode/pan-wizard-core/bin/lib'), 'opencode');
    assert.equal(core.hostRuntime('C:\\Users\\me\\.config\\opencode\\pan-wizard-core\\bin\\lib'), 'opencode');
    assert.equal(core.hostRuntime('/home/me/.config/opencode/pan-wizard-core/bin/lib/'), 'opencode');
  });

  test('every other location is not', () => {
    assert.equal(core.hostRuntime('/work/app/.claude/pan-wizard-core/bin/lib'), null);
    assert.equal(core.hostRuntime('/work/app/.codex/pan-wizard-core/bin/lib'), null);
    assert.equal(core.hostRuntime('/work/myopencode/pan-wizard-core/bin/lib'), null);
    assert.equal(core.hostRuntime('/work/.opencode/other/bin/lib'), null);
    assert.equal(core.hostRuntime(), null, 'the source checkout is not an OpenCode install');
  });
});

describe('OPENCODE_MODELS', () => {
  test('mirrors PROVIDER_MODELS tier for tier', () => {
    assert.deepEqual(Object.keys(core.OPENCODE_MODELS).sort(), Object.keys(core.PROVIDER_MODELS).sort());
    for (const [provider, tiers] of Object.entries(core.OPENCODE_MODELS)) {
      assert.deepEqual(Object.keys(tiers).sort(), Object.keys(core.PROVIDER_MODELS[provider]).sort(), provider);
    }
  });

  for (const [provider, tiers] of Object.entries(core.OPENCODE_MODELS)) {
    for (const [tier, id] of Object.entries(tiers)) {
      test(`${provider}.${tier} → "${id}" is inherit or a provider-qualified, priced id`, () => {
        if (id === 'inherit') return;
        const m = /^(anthropic|openai|google)\/([^/]+)$/.exec(id);
        assert.ok(m, `"${id}" is not provider/model`);
        const expectedPrefix = provider === 'default' ? 'anthropic' : provider;
        assert.equal(m[1], expectedPrefix, `${provider} must route to its own provider`);
        assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_RATES, m[2]), `${m[2]} has no DEFAULT_RATES row`);
      });
    }
  }
});

describe('resolveTierToModel and detectProvider take the host into account', () => {
  test('under OpenCode every non-inherit tier is provider-qualified', () => {
    assert.equal(core.resolveTierToModel('mid', 'openai', 'opencode'), 'openai/gpt-6-sol');
    assert.equal(core.resolveTierToModel('haiku', 'anthropic', 'opencode'), 'anthropic/claude-haiku-4-5');
    assert.equal(core.resolveTierToModel('reasoning', 'google', 'opencode'), 'inherit');
  });

  test('elsewhere the ids are unchanged', () => {
    assert.equal(core.resolveTierToModel('mid', 'anthropic', null), 'sonnet');
    assert.equal(core.resolveTierToModel('fast', 'openai', null), 'gpt-6-luna');
  });

  test('under OpenCode the provider follows OpenCode\'s own configured model', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-oc-provider-'));
    try {
      fs.mkdirSync(path.join(dir, '.opencode'));
      assert.equal(core.detectProvider(dir, {}, 'opencode'), 'openai', 'no configured model → directory detection as before');
      fs.writeFileSync(path.join(dir, '.opencode', 'opencode.json'), JSON.stringify({ model: 'google/gemini-3.8-flash' }));
      assert.equal(core.detectProvider(dir, {}, 'opencode'), 'google');
      fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ model: 'anthropic/claude-opus-5-5' }));
      assert.equal(core.detectProvider(dir, {}, 'opencode'), 'anthropic', 'the project-root file is read first');
      assert.equal(core.detectProvider(dir, {}, null), 'openai', 'outside OpenCode the file is not consulted');
      assert.equal(core.detectProvider(dir, { routing: { provider: 'openai' } }, 'opencode'), 'openai', 'explicit config still wins');
      fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ model: 'lmstudio/qwen' }));
      assert.equal(core.detectProvider(dir, {}, 'opencode'), 'google', 'a provider PAN does not route for is skipped');
    } finally {
      cleanup(dir);
    }
  });
});

describe('an installed OpenCode copy resolves provider-qualified ids end to end', () => {
  let dir;
  const resolve = (agent) => JSON.parse(execFileSync(process.execPath,
    [path.join(dir, '.opencode', 'pan-wizard-core', 'bin', 'pan-tools.cjs'), 'resolve-model', agent],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, PAN_PROVIDER: '' } })).model;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-oc-models-'));
    const r = installInto(dir, ['--opencode', '--local']);
    assert.ok(r.success, `install failed: ${r.error}`);
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ model_profile: 'budget' }));
  });

  after(() => cleanup(dir));

  test('a budget-profile project gets OpenCode ids, not Claude aliases or bare ids', () => {
    assert.equal(resolve('pan-executor'), 'openai/gpt-6-sol');
    assert.equal(resolve('pan-verifier'), 'openai/gpt-6-luna');
  });

  test('OpenCode\'s configured model picks the provider', () => {
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ model: 'anthropic/claude-opus-5-5' }));
    try {
      assert.equal(resolve('pan-executor'), 'anthropic/claude-sonnet-5');
    } finally {
      fs.rmSync(path.join(dir, 'opencode.json'));
    }
  });
});
