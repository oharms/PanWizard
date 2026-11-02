/**
 * Tests for transitions.cjs — the declared state machine of every entity PAN
 * writes a status for (durable orchestration Stage B), and its enforcement at
 * the writers and in next-action.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'pan-wizard-core', 'bin', 'lib');
const T = require(path.join(LIB, 'transitions.cjs'));
const store = require(path.join(LIB, 'store.cjs'));
const focus = require(path.join(LIB, 'focus.cjs'));
const { AUTORUN_STATUSES } = require(path.join(LIB, 'constants.cjs'));
const { nextAction } = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'orchestrator.cjs'));
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-trans-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the tables', () => {
  test('every edge leads to a state of the same table, and every initial state is a state', () => {
    for (const [entity, t] of Object.entries(T.TABLES)) {
      const states = Object.keys(t.edges);
      for (const s of t.initial) assert.ok(states.includes(s), `${entity}: initial ${s}`);
      for (const [from, tos] of Object.entries(t.edges)) {
        for (const to of tos) assert.ok(states.includes(to), `${entity}: ${from} -> ${to}`);
      }
    }
  });

  test('focus.run covers every AUTORUN_STATUSES value', () => {
    assert.deepEqual(T.statesOf('focus.run').sort(), Object.values(AUTORUN_STATUSES).sort());
  });

  test('phase covers every status classifyPhaseStatus can return', () => {
    const src = fs.readFileSync(path.join(LIB, 'utils.cjs'), 'utf-8');
    const body = src.slice(src.indexOf('function classifyPhaseStatus'), src.indexOf('\nfunction ', src.indexOf('function classifyPhaseStatus') + 1));
    const returned = [...body.matchAll(/return '([a-z]+)'/g)].map((m) => m[1]);
    assert.ok(returned.length >= 5, 'found the statuses');
    for (const s of returned) assert.ok(T.isState('phase', s), `phase table lacks ${s}`);
  });

  test('a completed focus run is final; a stopped one may continue', () => {
    assert.deepEqual(T.allowedFrom('focus.run', 'completed'), []);
    assert.equal(T.checkTransition('focus.run', 'stopped', 'in_progress'), null);
    const r = T.checkTransition('focus.run', 'completed', 'in_progress');
    assert.equal(r.error, 'illegal_transition');
    assert.deepEqual(r.allowed, []);
    assert.match(r.reason, /final/);
  });

  test('a status no table names is unknown_state, as source or as target', () => {
    assert.equal(T.checkTransition('focus.run', 'in_progress', 'paused').error, 'unknown_state');
    assert.equal(T.checkTransition('focus.run', 'hand-edited', 'stopped').error, 'unknown_state');
  });

  test('checkRecord: same status, no status, or a new identity are not refused', () => {
    assert.equal(T.checkRecord('focus.run', { run_id: 'a', status: 'completed' }, { run_id: 'a', status: 'completed', current_cycle: 'x' }), null);
    assert.equal(T.checkRecord('focus.run', { run_id: 'a', status: 'completed' }, { run_id: 'a' }), null);
    assert.equal(T.checkRecord('focus.run', { run_id: 'a', status: 'completed' }, { run_id: 'b', status: 'initialized' }), null);
    assert.equal(T.checkRecord('focus.run', null, { run_id: 'b', status: 'stopped' }).error, 'illegal_transition', 'a new run starts initialized');
  });

  test('a merged request may be staged again; a pending one may merge', () => {
    assert.equal(T.checkTransition('merge.request', 'merged', 'awaiting_approval'), null);
    assert.equal(T.checkTransition('merge.request', 'awaiting_approval', 'merged'), null);
    assert.equal(T.checkTransition('merge.request', null, 'merged').error, 'illegal_transition');
  });
});

describe('store.updateRecord with a transition', () => {
  test('refuses an illegal status change inside the lock and writes nothing; force skips the check', () => {
    const f = path.join(dir, 'auto-run.json');
    store.updateRecord(f, () => ({ run_id: 'r1', status: 'completed' }));
    const before = fs.readFileSync(f, 'utf-8');
    const r = store.updateRecord(f, (cur) => ({ ...cur, status: 'in_progress' }), { transition: 'focus.run' });
    assert.equal(r.error, 'illegal_transition');
    assert.equal(r.file, f);
    assert.equal(fs.readFileSync(f, 'utf-8'), before);
    const forced = store.updateRecord(f, (cur) => ({ ...cur, status: 'in_progress' }), { transition: 'focus.run', force: true });
    assert.equal(forced.ok, true);
  });
});

describe('enforcement at the writers', () => {
  test('writeAutoRun returns the refusal for a completed run being restarted', () => {
    focus.writeAutoRun(dir, { run_id: 'auto-1', status: 'initialized' });
    assert.equal(focus.writeAutoRun(dir, { run_id: 'auto-1', status: 'completed' }), true);
    const r = focus.writeAutoRun(dir, { run_id: 'auto-1', status: 'in_progress' });
    assert.equal(r.error, 'illegal_transition');
    assert.equal(focus.readAutoRun(dir).status, 'completed');
  });

  test('`focus auto --stop` on a run another session completed is refused, not overwritten', () => {
    fs.mkdirSync(path.join(dir, '.planning', 'focus'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'focus', 'auto-run.json'), JSON.stringify({ run_id: 'auto-1', status: 'completed', max_cycles: 3 }));
    const r = spawnSync(process.execPath, [TOOLS, 'focus', 'auto', '--stop'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'focus', 'auto-run.json'), 'utf-8')).status, 'completed');
  });

  test('state quick-task refuses a status outside the recorded values, in any case it accepts them', () => {
    fs.mkdirSync(path.join(dir, '.planning'));
    fs.writeFileSync(path.join(dir, '.planning', 'state.md'), '# Project State\n\n### Blockers/Concerns\n\nNone\n');
    const bad = spawnSync(process.execPath, [TOOLS, 'state', 'quick-task', '--description', 'x', '--status', 'shipped-ish'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(bad.status, 1);
    const out = JSON.parse(bad.stdout);
    assert.equal(out.error, 'invalid_status');
    assert.ok(out.allowed.includes('verified'));
    const good = spawnSync(process.execPath, [TOOLS, 'state', 'quick-task', '--description', 'x', '--status', 'Needs Review'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(good.status, 0, good.stdout);
  });

  test('autodev marks its run running while driven and stopped when released', () => {
    const autodev = require(path.join(LIB, 'autodev.cjs'));
    const runDir = path.join(dir, '.planning', 'autodev', 'run-z');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ id: 'run-z', started: new Date().toISOString(), host: 'nohost', limits: {} }));
    const r = autodev.runAutodev(dir, { runId: 'run-z', host: 'nohost', maxUsd: 1 });
    assert.equal(r.error, 'unsupported_host');
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
    assert.equal(run.status, 'stopped');
    assert.equal(run.owner, null);
  });
});

describe('next-action', () => {
  test('an unknown phase status stops with unknown_state instead of re-planning', () => {
    const r = nextAction({ phases: [{ number: '01', status: 'weird-new-status' }] });
    assert.equal(r.action, 'stop');
    assert.equal(r.error, 'unknown_state');
    assert.equal(r.state, 'weird-new-status');
    assert.equal(r.done, false);
    assert.ok(r.known.includes('planned'));
  });

  test('a routed action reports the transitions open from the phase\'s status', () => {
    assert.deepEqual(nextAction({ phases: [{ number: '01', status: 'planned' }] }).allowed, ['partial', 'complete']);
    assert.deepEqual(nextAction({ phases: [{ number: '01', status: 'complete' }] }).allowed, []);
  });
});
