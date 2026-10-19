/**
 * usage.cjs — the local usage census (program L9).
 *
 * `pan-tools usage` reads this project's own cost ledger and trace sessions and
 * reports, against the installed commands and agents: what was used (calls, last
 * use), what was never used, and commands that were started but never finished.
 * Local files only; nothing is sent anywhere.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../pan-wizard-core/bin/lib/usage.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

let dir;
let inv;
beforeEach(() => {
  dir = createTempProject();
  inv = path.join(dir, 'inventory');
  fs.mkdirSync(path.join(inv, 'commands', 'pan'), { recursive: true });
  fs.mkdirSync(path.join(inv, 'agents'), { recursive: true });
  for (const c of ['plan-phase', 'exec-phase', 'quick', 'army']) fs.writeFileSync(path.join(inv, 'commands', 'pan', `${c}.md`), '---\n---\n');
  for (const a of ['pan-planner', 'pan-executor', 'pan-hardener']) fs.writeFileSync(path.join(inv, 'agents', `${a}.md`), '---\n---\n');
});
afterEach(() => cleanup(dir));

function ledger(rows) {
  const d = path.join(dir, '.planning', 'metrics');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'tokens.jsonl'), rows.map((r) => JSON.stringify({ model: 'm', output_tokens: 1, ...r })).join('\n') + '\n');
}
function session(id, meta) {
  const d = path.join(dir, '.planning', 'optimization', 'traces', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify({ session_id: id, ...meta }));
  fs.writeFileSync(path.join(d, 'trace.jsonl'), '');
}

describe('usage census (L9)', () => {
  test('used, never used, with calls and last use, from the cost ledger', () => {
    ledger([
      { ts: '2026-10-10T10:00:00Z', command: 'plan-phase', agent: 'pan-planner' },
      { ts: '2026-10-12T10:00:00Z', command: 'plan-phase', agent: 'pan-planner' },
      { ts: '2026-10-11T10:00:00Z', command: 'exec-phase', agent: 'pan-executor' },
      { ts: '2026-10-11T11:00:00Z', command: 'not-a-pan-command', agent: 'general-purpose' },
    ]);
    const r = U.usageCensus(dir, { inventory: inv, now: '2026-10-18T00:00:00Z' });
    assert.deepEqual(r.commands.used.map((c) => [c.name, c.calls, c.last_used]), [['plan-phase', 2, '2026-10-12T10:00:00Z'], ['exec-phase', 1, '2026-10-11T10:00:00Z']]);
    assert.deepEqual(r.commands.never_used, ['army', 'quick']);
    assert.deepEqual(r.agents.used.map((a) => [a.name, a.calls]), [['pan-planner', 2], ['pan-executor', 1]]);
    assert.deepEqual(r.agents.never_used, ['pan-hardener']);
    assert.equal(r.local_only, true);
  });

  test('a command whose trace sessions all stopped without ending is unfinished; a recent open one is still running', () => {
    session('sess_a', { command: 'quick', started_at: '2026-10-10T10:00:00Z', ended_at: null });
    session('sess_b', { command: 'exec-phase', started_at: '2026-10-11T10:00:00Z', ended_at: '2026-10-11T11:00:00Z' });
    session('sess_c', { command: 'exec-phase', started_at: '2026-10-12T10:00:00Z', ended_at: null });
    session('sess_d', { command: 'plan-phase', started_at: '2026-10-17T23:30:00Z', ended_at: null });
    const r = U.usageCensus(dir, { inventory: inv, now: '2026-10-18T00:00:00Z' });
    assert.deepEqual(r.commands.unfinished.map((c) => [c.name, c.sessions, c.finished]), [['quick', 1, 0]]);
    const exec = r.commands.used.find((c) => c.name === 'exec-phase');
    assert.deepEqual([exec.sessions, exec.finished], [2, 1], 'one ended, one not: used and finished at least once');
    assert.ok(!r.commands.unfinished.some((c) => c.name === 'plan-phase'), 'a session open for half an hour may still be running');
  });

  test('commands are named with or without the /pan: prefix; an empty project reports everything unused', () => {
    ledger([{ ts: '2026-10-10T10:00:00Z', command: '/pan:quick' }, { ts: '2026-10-10T11:00:00Z', command: 'pan-army' }]);
    const r = U.usageCensus(dir, { inventory: inv });
    assert.deepEqual(r.commands.used.map((c) => c.name).sort(), ['army', 'quick']);
    const empty = createTempProject();
    try {
      const e = U.usageCensus(empty, { inventory: inv });
      assert.deepEqual([e.commands.used.length, e.commands.never_used.length, e.sources.cost_rows, e.sources.trace_sessions], [0, 4, 0, 0]);
    } finally { cleanup(empty); }
  });

  test('CLI: pan-tools usage reads the install it ships in; --raw prints a one-line summary', () => {
    ledger([{ ts: '2026-10-10T10:00:00Z', command: 'quick', agent: 'pan-executor' }]);
    const r = runPanTools('usage', dir);
    assert.equal(r.success, true, r.error);
    const out = JSON.parse(r.output);
    assert.ok(out.commands.used.some((c) => c.name === 'quick'));
    assert.ok(out.commands.never_used.includes('exec-phase'), 'the inventory is the shipped command set');
    assert.match(runPanTools('usage --raw', dir).output, /^\d+ of \d+ commands used, \d+ unfinished; \d+ of \d+ agents used$/);
  });
});
