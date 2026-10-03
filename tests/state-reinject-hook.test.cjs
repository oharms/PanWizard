// pan-state-reinject.js — the planning position, re-injected after a compaction
// (market-ideas queue M10). The e2e driver in tests/hooks-e2e.test.cjs runs the
// installed copy for every runtime that registers it; this file pins the pure
// builder's rules and the process contract from the source.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildReinjectContext } = require('../hooks/pan-state-reinject.js');
const { spawnHook } = require('./helpers.cjs');

const STATE = [
  '# Project State', '',
  '## Current Position', '',
  '**Current Phase:** 3',
  '**Current Phase Name:** Payments',
  '**Current Plan:** 2',
  '**Total Plans in Phase:** 4',
  '**Status:** In progress',
  '**Last Activity Description:** Plan 3-01 summary written', '',
  '## Session Continuity', '',
  '**Stopped At:** Task 2 of plan 3-02',
  '**Resume File:** None', '',
].join('\n');
const ROADMAP = '- [x] **Phase 1: Base**\n- [x] **Phase 2: Auth**\n- [ ] **Phase 3: Payments**\n- [ ] **Phase 4: Ship**\n';

describe('buildReinjectContext', () => {
  test('names the phase, plan, status and stop point in flight', () => {
    const ctx = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP });
    assert.match(ctx, /^PAN project state, re-read from disk after context compaction:/);
    assert.match(ctx, /- Current phase: 3 \(Payments\), plan 2 of 4/);
    assert.match(ctx, /- Status: In progress/);
    assert.match(ctx, /- Stopped at: Task 2 of plan 3-02/);
    assert.match(ctx, /- First unbuilt roadmap phase: Phase 3/);
    assert.match(ctx, /Re-read \.planning\/state\.md/);
    assert.doesNotMatch(ctx, /Resume file/, '"None" is not a resume file');
    assert.doesNotMatch(ctx, /Last activity/, 'the stop point wins over the last-activity line');
  });

  test('silent without a state, a roadmap, a current phase, or unbuilt phases', () => {
    assert.equal(buildReinjectContext({ stateContent: null, roadmapContent: ROADMAP }), null);
    assert.equal(buildReinjectContext({ stateContent: STATE, roadmapContent: null }), null);
    assert.equal(buildReinjectContext({ stateContent: '**Status:** Ready', roadmapContent: ROADMAP }), null);
    assert.equal(buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP.replace(/\[ \]/g, '[x]') }), null);
  });

  test('template placeholders are not a position', () => {
    const template = '**Current Phase:** [X]\n**Status:** [Ready to plan / Planning]\n';
    assert.equal(buildReinjectContext({ stateContent: template, roadmapContent: ROADMAP }), null);
  });

  test('each field and the whole block stay bounded', () => {
    const long = STATE.replace('Task 2 of plan 3-02', 'x'.repeat(5000));
    const ctx = buildReinjectContext({ stateContent: long, roadmapContent: ROADMAP });
    assert.ok(ctx.length < 2000, `block is ${ctx.length} chars`);
    assert.match(ctx, /x…\n/, 'the long field is cut with an ellipsis');
  });

  test('a track names its own planning directory in the pointer line', () => {
    const ctx = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP, planningRel: '.planning/tracks/api' });
    assert.match(ctx, /Re-read \.planning\/tracks\/api\/state\.md/);
  });
});

describe('the hook process', () => {
  const HOOK = path.join(__dirname, '..', 'hooks', 'pan-state-reinject.js');

  test('a project with no planning tree gets nothing, and no directory is created', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-bare-'));
    try {
      const r = spawnHook(HOOK, { hook_event_name: 'SessionStart', source: 'compact', cwd: dir }, dir);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.deepEqual(fs.readdirSync(dir), [], 'the hook must never scaffold .planning/');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads the tree the payload cwd names, not the process cwd', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-proj-'));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-else-'));
    try {
      fs.mkdirSync(path.join(project, '.planning'));
      fs.writeFileSync(path.join(project, '.planning', 'state.md'), STATE);
      fs.writeFileSync(path.join(project, '.planning', 'roadmap.md'), ROADMAP);
      const r = spawnHook(HOOK, { hook_event_name: 'SessionStart', source: 'compact', cwd: project }, elsewhere);
      assert.equal(r.status, 0);
      assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Current phase: 3/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

// ─── After a compaction on Gemini CLI and Copilot CLI (market-ideas M33) ───────
// Neither host restarts a session after compacting, and neither lets a
// pre-compaction hook add context. So `--mark` (PreCompress / preCompact) leaves a
// per-session marker in the per-user hook directory under the OS temp directory, and
// `--inject <host>` on the next tool result (AfterTool / postToolUse) takes it and
// returns the block once. Each test points TEMP/TMP/TMPDIR at its own directory, so
// markers never touch the real one.

describe('the marker modes (Gemini, Copilot)', () => {
  const HOOK = path.join(__dirname, '..', 'hooks', 'pan-state-reinject.js');
  const { spawnSync } = require('child_process');
  const { markerName, hookDirName } = require('../hooks/pan-state-reinject.js');
  let project;
  let tmp;

  function run(args, payload) {
    const r = spawnSync(process.execPath, [HOOK, ...args], {
      cwd: project, input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  }
  // The per-user directory the stop guard and the context monitor share.
  const hookDir = () => path.join(tmp, hookDirName());
  const markers = () => (fs.existsSync(hookDir()) ? fs.readdirSync(hookDir()).filter((f) => f.startsWith('state-reinject-')) : []);

  function inFlight() {
    fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(project, '.planning', 'state.md'), STATE);
    fs.writeFileSync(path.join(project, '.planning', 'roadmap.md'), ROADMAP);
  }

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-m33-'));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-tmp-'));
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('Gemini: the marker before the compaction, the block on the next tool result, once', () => {
    inFlight();
    assert.equal(run(['--inject', 'gemini'], { session_id: 's1', cwd: project, tool_name: 'read_file' }), '', 'no marker yet: nothing');
    assert.equal(run(['--mark'], { session_id: 's1', cwd: project, trigger: 'auto' }), '', 'the marker step prints nothing');
    assert.equal(markers().length, 1);
    const out = JSON.parse(run(['--inject', 'gemini'], { session_id: 's1', cwd: project, tool_name: 'read_file' }));
    assert.equal(out.hookSpecificOutput.hookEventName, 'AfterTool');
    assert.match(out.hookSpecificOutput.additionalContext, /Current phase: 3 \(Payments\), plan 2 of 4/);
    assert.equal(run(['--inject', 'gemini'], { session_id: 's1', cwd: project, tool_name: 'read_file' }), '', 'taken once');
    assert.deepEqual(markers(), []);
  });

  test('Copilot: camelCase payloads, and the block as a top-level additionalContext', () => {
    inFlight();
    run(['--mark'], { sessionId: 'c1', cwd: project, trigger: 'auto', customInstructions: '' });
    const out = JSON.parse(run(['--inject', 'copilot'], { sessionId: 'c1', cwd: project, toolName: 'bash' }));
    assert.deepEqual(Object.keys(out), ['additionalContext']);
    assert.match(out.additionalContext, /PAN project state, re-read from disk after context compaction/);
  });

  test('no PAN phase in flight, or no session id: no marker, and nothing is ever written into the project', () => {
    run(['--mark'], { session_id: 's1', cwd: project });
    assert.deepEqual(markers(), [], 'a project with no planning tree');
    assert.deepEqual(fs.readdirSync(project), [], 'the hook must never scaffold .planning/');
    inFlight();
    run(['--mark'], { cwd: project });
    assert.deepEqual(markers(), [], 'without a session id there is nothing to key the marker on');
    run(['--mark'], { session_id: 's1', cwd: project });
    assert.deepEqual(fs.readdirSync(project), ['.planning'], 'the marker lives in the temp directory, not the project');
  });

  test('a marker belongs to one session and one project', () => {
    inFlight();
    run(['--mark'], { session_id: 'mine', cwd: project });
    assert.equal(run(['--inject', 'gemini'], { session_id: 'other', cwd: project }), '', 'another session does not take it');
    assert.equal(markers().length, 1);
    const name = markerName('mine', project);
    assert.ok(markers().includes(name), 'the marker is where markerName says');
    assert.ok(!name.includes('mine') && !name.includes(path.basename(project)), 'neither the session id nor the path leaks into the file name');
  });

  test('a stale marker is not injected, and is removed', () => {
    inFlight();
    fs.mkdirSync(hookDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(hookDir(), markerName('old', project)), JSON.stringify({ at: Date.now() - 7 * 60 * 60 * 1000 }), { mode: 0o600 });
    assert.equal(run(['--inject', 'copilot'], { sessionId: 'old', cwd: project }), '');
    assert.deepEqual(markers(), []);
  });

  test('an unknown host leaves the marker for a host that can use it', () => {
    inFlight();
    run(['--mark'], { session_id: 's1', cwd: project });
    assert.equal(run(['--inject', 'cursor'], { session_id: 's1', cwd: project }), '');
    assert.equal(markers().length, 1);
  });

  test('the marker shares the per-user hook directory, and its sweep touches only its own files', () => {
    inFlight();
    fs.mkdirSync(hookDir(), { recursive: true, mode: 0o700 });
    const old = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
    const plant = (name) => {
      const f = path.join(hookDir(), name);
      fs.writeFileSync(f, '{}', { mode: 0o600 });
      fs.utimesSync(f, old, old);
      return name;
    };
    const bridge = plant('claude-ctx-abc.json'); // the statusline's bridge file
    const guard = plant(`stop-guard-${'a'.repeat(32)}.json`); // the stop guard's marker
    plant(`state-reinject-${'b'.repeat(32)}.json`); // a session that never came back
    plant(`state-reinject-${'c'.repeat(32)}.json.4242.taken`); // a take a crash interrupted
    run(['--mark'], { session_id: 's1', cwd: project });
    assert.deepEqual(fs.readdirSync(hookDir()).sort(), [bridge, guard, markerName('s1', project)].sort(),
      "this hook's stale files are swept; the other hooks' files are left alone, however old");
  });

  test('the marker is written 0600 in a 0700 directory (POSIX)', (t) => {
    if (process.platform === 'win32') { t.skip('Windows has no POSIX mode bits'); return; }
    inFlight();
    run(['--mark'], { session_id: 's1', cwd: project });
    assert.equal(fs.statSync(hookDir()).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(hookDir(), markerName('s1', project))).mode & 0o777, 0o600);
  });

  test('a hook directory other users can open gets no marker (POSIX, fail closed)', (t) => {
    if (process.platform === 'win32') { t.skip('Windows has no POSIX mode bits'); return; }
    inFlight();
    fs.mkdirSync(hookDir());
    fs.chmodSync(hookDir(), 0o777);
    run(['--mark'], { session_id: 's1', cwd: project });
    assert.deepEqual(markers(), [], 'a directory that is not provably this user\'s is not used');
  });

  test('a hook directory that is a link gets no marker, and one planted behind it never injects (fail closed)', (t) => {
    inFlight();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-link-'));
    try {
      try { fs.symlinkSync(target, hookDir(), 'junction'); } catch (e) { t.skip(`links not permitted here: ${e.code}`); return; }
      run(['--mark'], { session_id: 's1', cwd: project });
      assert.deepEqual(fs.readdirSync(target), [], 'nothing is written through the link');
      fs.writeFileSync(path.join(target, markerName('s1', project)), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
      assert.equal(run(['--inject', 'copilot'], { sessionId: 's1', cwd: project }), '', 'a planted marker is not injected');
      assert.equal(fs.readdirSync(target).length, 1, 'nor taken');
    } finally {
      try { fs.unlinkSync(hookDir()); } catch { try { fs.rmdirSync(hookDir()); } catch { /* removed with tmp */ } }
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});
