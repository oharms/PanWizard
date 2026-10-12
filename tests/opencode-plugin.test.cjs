// PAN's OpenCode plugin (memory optimisation O12): OpenCode was the last host
// without PAN's state re-injection. It runs no command hooks, but a plugin's
// `experimental.session.compacting` can add context to the prompt OpenCode
// compacts a session with. The plugin pushes PAN's position, read from disk, onto
// `output.context`. These tests pin its module shape, its parity with the state
// re-injection hook the other hosts run, that it is inert outside PAN work, and that
// the installer places, tracks and removes it for OpenCode only.

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'pan-wizard-core', 'opencode', 'pan-wizard.js');
const plugin = require(PLUGIN);
const { buildReinjectContext } = require(path.join(ROOT, 'hooks', 'pan-state-reinject.js'));

const STATE = '# Project State\n\n**Current Phase:** 2\n**Current Phase Name:** Exports\n**Current Plan:** 02\n**Total Plans in Phase:** 3\n**Status:** Executing\n**Stopped At:** Task 2 of 03-02 — wiring the export route\n';
const ROADMAP = '# Roadmap\n\n- [x] **Phase 1: Base** — done\n- [ ] **Phase 2: Exports** — CSV\n';

function project(state = STATE, roadmap = ROADMAP, rel = '.planning') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ocplugin-'));
  if (state !== null) {
    fs.mkdirSync(path.join(d, ...rel.split('/')), { recursive: true });
    fs.writeFileSync(path.join(d, ...rel.split('/'), 'state.md'), state);
    if (roadmap !== null) fs.writeFileSync(path.join(d, ...rel.split('/'), 'roadmap.md'), roadmap);
  }
  return d;
}
async function compact(directory) {
  const hooks = await plugin.server({ directory });
  const output = { context: [] };
  await hooks['experimental.session.compacting']({ sessionID: 's1' }, output);
  return output.context;
}
const positionLines = (block) => block.split('\n').filter((l) => l.startsWith('- '));

describe('the plugin module', () => {
  test('is the CommonJS shape both loaders accept: { id, server, setup }, nothing else (R45)', () => {
    assert.deepEqual(Object.keys(plugin).sort(), ['id', 'server', 'setup']);
    assert.equal(plugin.id, 'pan-wizard');
    assert.equal(typeof plugin.server, 'function', 'OpenCode 1 calls server()');
    assert.equal(typeof plugin.setup, 'function', 'OpenCode 2 calls setup()');
  });

  test('adds one block with PAN\'s position to the compaction prompt — the same position the re-injection hook gives', async () => {
    const d = project();
    try {
      const ctx = await compact(d);
      assert.equal(ctx.length, 1);
      assert.match(ctx[0], /^PAN project state at this compaction — keep it in the summary/);
      const hook = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP });
      assert.deepEqual(positionLines(ctx[0]), positionLines(hook), 'one position, whatever the host');
      assert.match(ctx[0], /- Stopped at: Task 2 of 03-02 — wiring the export route/);
      assert.match(ctx[0], /re-read \.planning\/state\.md and the current phase's plan/);
    } finally { cleanup(d); }
  });

  test('parity holds without a stopping point and with a resume file', async () => {
    const state = STATE.replace(/\*\*Stopped At:\*\*.*\n/, '**Last Activity Description:** planned\n**Resume File:** .planning/phases/02-exports/.continue-here.md\n');
    const d = project(state);
    try {
      const ctx = await compact(d);
      assert.deepEqual(positionLines(ctx[0]), positionLines(buildReinjectContext({ stateContent: state, roadmapContent: ROADMAP })));
    } finally { cleanup(d); }
  });

  test('follows PAN_TRACK to a track\'s planning tree', async () => {
    const d = project(STATE, ROADMAP, '.planning/tracks/api');
    const saved = process.env.PAN_TRACK;
    process.env.PAN_TRACK = 'api';
    try {
      const ctx = await compact(d);
      assert.match(ctx[0], /re-read \.planning\/tracks\/api\/state\.md/);
    } finally {
      if (saved === undefined) delete process.env.PAN_TRACK; else process.env.PAN_TRACK = saved;
      cleanup(d);
    }
  });

  test('inert outside PAN work in flight, and never throws into a compaction', async () => {
    const none = project(null);
    const done = project(STATE, ROADMAP.replace('- [ ] **Phase 2', '- [x] **Phase 2'));
    try {
      assert.deepEqual(await compact(none), [], 'no planning tree');
      assert.deepEqual(await compact(done), [], 'every phase built');
      const hooks = await plugin.server({ directory: done });
      await hooks['experimental.session.compacting']({}, null);
      await hooks['experimental.session.compacting']({}, { context: 'not an array' });
    } finally { cleanup(none); cleanup(done); }
  });

  test('never writes into the project', async () => {
    const d = project();
    try {
      const list = () => fs.readdirSync(d, { recursive: true }).sort();
      const before = list();
      await compact(d);
      assert.deepEqual(list(), before);
    } finally { cleanup(d); }
  });
});

// OpenCode 2's loader needs `setup` (or `effect`) and registers hooks through
// `ctx.session.hook(name, fn)`; the compaction event carries `system` (read from the
// 2.0 binary) or `context`. One object serves both loaders (R45).
function fakeCtx(directory, { hook } = {}) {
  const hooks = [];
  return {
    hooks,
    ctx: { directory, session: { hook: hook || ((name, fn) => hooks.push({ name, fn })) } },
  };
}

describe('OpenCode 2: setup() registers the same compaction hand-off (R45)', () => {
  test('registers exactly one compaction hook', () => {
    const d = project();
    try {
      const { ctx, hooks } = fakeCtx(d);
      plugin.setup(ctx);
      assert.deepEqual(hooks.map((h) => h.name), ['compaction']);
    } finally { cleanup(d); }
  });

  test('pushes onto `system` the same block server() pushes onto `context`', async () => {
    const d = project();
    try {
      const { ctx, hooks } = fakeCtx(d);
      plugin.setup(ctx);
      const event = { system: [] };
      await hooks[0].fn(event);
      assert.equal(event.system.length, 1);
      assert.deepEqual(event.system, await compact(d));
    } finally { cleanup(d); }
  });

  test('falls back to `context` when the event has no `system` array; neither: no write, no throw', async () => {
    const d = project();
    try {
      const { ctx, hooks } = fakeCtx(d);
      plugin.setup(ctx);
      const withContext = { context: [] };
      await hooks[0].fn(withContext);
      assert.equal(withContext.context.length, 1);
      const neither = { other: 1 };
      await hooks[0].fn(neither);
      assert.deepEqual(neither, { other: 1 });
      await hooks[0].fn(undefined);
    } finally { cleanup(d); }
  });

  test('follows PAN_TRACK through setup too', async () => {
    const d = project(STATE, ROADMAP, '.planning/tracks/api');
    const saved = process.env.PAN_TRACK;
    process.env.PAN_TRACK = 'api';
    try {
      const { ctx, hooks } = fakeCtx(d);
      plugin.setup(ctx);
      const event = { system: [] };
      await hooks[0].fn(event);
      assert.match(event.system[0], /re-read \.planning\/tracks\/api\/state\.md/);
    } finally {
      if (saved === undefined) delete process.env.PAN_TRACK; else process.env.PAN_TRACK = saved;
      cleanup(d);
    }
  });

  test('no work in flight: nothing pushed', async () => {
    const done = project(STATE, ROADMAP.replace('- [ ] **Phase 2', '- [x] **Phase 2'));
    try {
      const { ctx, hooks } = fakeCtx(done);
      plugin.setup(ctx);
      const event = { system: [] };
      await hooks[0].fn(event);
      assert.deepEqual(event.system, []);
    } finally { cleanup(done); }
  });

  test('the block is capped at the same length on both paths', async () => {
    const long = STATE.replace(/\*\*Stopped At:\*\*.*\n/, `**Stopped At:** ${'x'.repeat(5000)}\n**Resume File:** ${'y'.repeat(5000)}\n`);
    const d = project(long);
    try {
      const { ctx, hooks } = fakeCtx(d);
      plugin.setup(ctx);
      const event = { system: [] };
      await hooks[0].fn(event);
      assert.ok(event.system[0].length <= 2000);
      assert.deepEqual(event.system, await compact(d));
    } finally { cleanup(d); }
  });

  test('no session, no hook function, or a throwing hook: setup returns without throwing', () => {
    assert.doesNotThrow(() => plugin.setup(undefined));
    assert.doesNotThrow(() => plugin.setup({ directory: os.tmpdir() }));
    assert.doesNotThrow(() => plugin.setup({ directory: os.tmpdir(), session: { hook: 'not a function' } }));
    assert.doesNotThrow(() => plugin.setup({ directory: os.tmpdir(), session: { hook: () => { throw new Error('host refused'); } } }));
  });

  test('an unreadable planning tree inside the handler is swallowed', async () => {
    const d = project();
    try {
      // state.md as a directory: the read throws EISDIR inside the handler.
      fs.rmSync(path.join(d, '.planning', 'state.md'));
      fs.mkdirSync(path.join(d, '.planning', 'state.md'));
      const { ctx, hooks } = fakeCtx(d);
      plugin.setup(ctx);
      const event = { system: [] };
      await hooks[0].fn(event);
      assert.deepEqual(event.system, []);
    } finally { cleanup(d); }
  });
});

describe('the installer places it for OpenCode only', () => {
  const INSTALLER = path.join(ROOT, 'bin', 'install.js');
  let oc;
  let claude;
  const install = (dir, flags) => execFileSync(process.execPath, [INSTALLER, ...flags], { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  before(() => {
    oc = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ocplugin-install-'));
    claude = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ocplugin-claude-'));
    install(oc, ['--opencode', '--local']);
    install(claude, ['--claude', '--local']);
  });
  after(() => { cleanup(oc); cleanup(claude); });

  test('an OpenCode install carries the plugin byte for byte, beside the CommonJS package.json, and tracks it', () => {
    const installed = path.join(oc, '.opencode', 'plugins', 'pan-wizard.js');
    assert.ok(fs.readFileSync(installed).equals(fs.readFileSync(PLUGIN)));
    assert.equal(fs.readFileSync(path.join(oc, '.opencode', 'package.json'), 'utf8').trim(), '{"type":"commonjs"}');
    const manifest = JSON.parse(fs.readFileSync(path.join(oc, '.opencode', 'pan-file-manifest.json'), 'utf8'));
    assert.ok(manifest.files['plugins/pan-wizard.js'], 'the manifest tracks the plugin');
    assert.equal(fs.existsSync(path.join(oc, '.opencode', 'hooks')), false, 'still no hooks directory: the plugin is not a hook');
  });

  test('another runtime gets no plugins directory', () => {
    assert.equal(fs.existsSync(path.join(claude, '.claude', 'plugins')), false);
  });

  test('uninstall removes the plugin and keeps the user\'s own plugins', () => {
    fs.writeFileSync(path.join(oc, '.opencode', 'plugins', 'mine.js'), 'module.exports = {};\n');
    install(oc, ['--opencode', '--local', '--uninstall']);
    assert.equal(fs.existsSync(path.join(oc, '.opencode', 'plugins', 'pan-wizard.js')), false);
    assert.ok(fs.existsSync(path.join(oc, '.opencode', 'plugins', 'mine.js')), 'a plugin PAN did not write stays');
  });
});
