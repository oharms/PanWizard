// R39 — one run per hook when Claude and Copilot share a project.
//
// Copilot CLI also runs the hooks in a repository's .claude/settings.json and
// .claude/settings.local.json. Measured 2026-09-26 on Copilot CLI 1.0.88 (with
// repository hooks loaded — GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS in `-p` mode, or a
// trusted folder): with both runtimes installed, every PAN hook ran twice under
// Copilot, once per registration. The Copilot project copy (.github/hooks) now defers
// to a Claude registration of the same script. These tests pin the rule, the copies,
// and the behaviour of a real two-runtime install.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installInto, spawnHook, cleanup } = require('./helpers.cjs');

const HOOKS = ['pan-check-update', 'pan-context-monitor', 'pan-cost-logger', 'pan-trace-logger', 'pan-stop-guard'];
const SRC = path.join(__dirname, '..', 'hooks');

function fnText(hook) {
  const src = fs.readFileSync(path.join(SRC, `${hook}.js`), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('// ─── R39: one run per hook');
  const end = src.indexOf('\n}\n', src.indexOf('function deferToClaudeRegistration'));
  assert.ok(start >= 0 && end > start, `${hook}: the R39 block is missing`);
  return src.slice(start, end + 3);
}

describe('deferToClaudeRegistration — the copies', () => {
  test('every hook Copilot registers carries the same function', () => {
    const first = fnText(HOOKS[0]);
    for (const hook of HOOKS.slice(1)) assert.equal(fnText(hook), first, `${hook} drifted from ${HOOKS[0]}`);
  });

  test('every Copilot-registered hook exports it', () => {
    for (const hook of HOOKS) {
      assert.equal(typeof require(path.join(SRC, `${hook}.js`)).deferToClaudeRegistration, 'function', hook);
    }
  });
});

// Each copy is driven on its own — a copy that is textually pinned but never run
// could still break at runtime (and would leave the coverage floor to catch it).
for (const hook of HOOKS) {
  describe(`deferToClaudeRegistration — the rule (${hook})`, () => {
    const { deferToClaudeRegistration: defer } = require(path.join(SRC, `${hook}.js`));
    const script = `${hook}.js`;
    let project;
    const copy = (dir) => path.join(project, dir, 'hooks', script);
    const settings = (name, obj) => {
      fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(project, '.claude', name), typeof obj === 'string' ? obj : JSON.stringify(obj));
    };
    const registered = (s) => ({ hooks: { SomeEvent: [{ hooks: [{ type: 'command', command: `node .claude/hooks/${s}` }] }] } });

    before(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-r39-')); });
    after(() => cleanup(project));

    test('the .github copy runs when no Claude settings exist', () => {
      assert.equal(defer(project, copy('.github')), false);
    });

    test('the .github copy defers to a Claude registration of the same script', () => {
      settings('settings.json', registered(script));
      assert.equal(defer(project, copy('.github')), true);
    });

    test('a registration of a different script does not count', () => {
      settings('settings.json', registered('pan-not-this-hook.js'));
      assert.equal(defer(project, copy('.github')), false);
    });

    test('settings.local.json counts too', () => {
      settings('settings.json', {});
      settings('settings.local.json', registered(script));
      assert.equal(defer(project, copy('.github')), true);
      fs.rmSync(path.join(project, '.claude', 'settings.local.json'));
    });

    test('only the .github project copy ever defers', () => {
      settings('settings.json', registered(script));
      for (const dir of ['.claude', '.gemini', '.codex', '.copilot']) {
        assert.equal(defer(project, copy(dir)), false, `${dir} copy must run`);
      }
    });

    test('unreadable or malformed settings never silence the hook', () => {
      settings('settings.json', '{ not json');
      assert.equal(defer(project, copy('.github')), false);
      settings('settings.json', { hooks: { SomeEvent: 'not an array', Other: [null, { hooks: 'x' }] } });
      assert.equal(defer(project, copy('.github')), false);
      assert.equal(defer('', copy('.github')), false);
      assert.equal(defer(null, copy('.github')), false);
    });
  });
}


describe('a real Claude + Copilot install runs the stop guard once under Copilot', () => {
  let project;
  const payload = () => ({ sessionId: 'r39', cwd: project, stopReason: 'end_turn', stop_hook_active: false });

  before(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-r39-dual-'));
    const r = installInto(project, ['--claude', '--copilot', '--local']);
    assert.ok(r.success, `install failed: ${r.error}`);
    const planning = path.join(project, '.planning');
    fs.mkdirSync(planning, { recursive: true });
    fs.writeFileSync(path.join(planning, 'config.json'), JSON.stringify({ workflow: { auto_advance: true } }));
    fs.writeFileSync(path.join(planning, 'state.md'), '**Status:** Phase 1 complete\n');
    fs.writeFileSync(path.join(planning, 'roadmap.md'), '- [x] **Phase 1: Base**\n- [ ] **Phase 2: Next**\n');
  });
  after(() => cleanup(project));

  test('the .claude copy blocks; the .github copy stands aside', () => {
    const claude = spawnHook(path.join(project, '.claude', 'hooks', 'pan-stop-guard.js'), payload(), project);
    assert.equal(JSON.parse(claude.stdout).decision, 'block');
    const copilot = spawnHook(path.join(project, '.github', 'hooks', 'pan-stop-guard.js'), payload(), project);
    assert.equal(copilot.status, 0);
    assert.equal(copilot.stdout, '', 'the Claude registration already covers this stop under Copilot');
  });

  test('without the Claude registration, the .github copy blocks again', () => {
    const file = path.join(project, '.claude', 'settings.json');
    const saved = fs.readFileSync(file, 'utf8');
    try {
      const s = JSON.parse(saved);
      delete s.hooks;
      fs.writeFileSync(file, JSON.stringify(s));
      const copilot = spawnHook(path.join(project, '.github', 'hooks', 'pan-stop-guard.js'), payload(), project);
      assert.equal(JSON.parse(copilot.stdout).decision, 'block');
    } finally {
      fs.writeFileSync(file, saved);
    }
  });
});
