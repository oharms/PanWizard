/**
 * Regression tests for the /code-review max findings on durable orchestration
 * (spec durable_orchestration_featureai.md, "Review fixes" R1–R6). Each test
 * reproduces a finding's failure and asserts the fixed behaviour.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'pan-wizard-core', 'bin', 'lib');
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const lock = require(path.join(LIB, 'lock.cjs'));
const store = require(path.join(LIB, 'store.cjs'));
const P = require(path.join(LIB, 'pause.cjs'));
const J = require(path.join(LIB, 'journal.cjs'));

let dir;
const planted = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rfix-')); });
afterEach(() => {
  for (const p of planted.splice(0)) { try { fs.unlinkSync(p); } catch { /* released */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});
const write = (rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const plant = (file, content, ageMs = 0) => {
  const p = lock.lockPathFor(file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t); }
  planted.push(p);
  return p;
};
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitInit = () => {
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  write('README.md', 'x\n'); git('add', '-A'); git('commit', '-qm', 'init');
};
const commit = (file) => { write(file, `${file}\n`); git('add', file); git('commit', '-qm', file); return git('rev-parse', '--short', 'HEAD'); };

describe('R1: a lock is stale only when its holder is gone', () => {
  test('an old lock held by a live process is not stolen', () => {
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });
    try {
      const f = path.join(dir, 'auto-run.json');
      plant(f, `${holder.pid}@${os.hostname()}`, 60_000);
      const got = lock.acquireLock(f, { retries: 2, intervalMs: 5 });
      assert.equal(got.acquired, false, 'a live holder keeps its lock, however old');
    } finally { holder.kill(); }
  });

  test('an old lock whose holder is gone is stolen', () => {
    const f = path.join(dir, 'auto-run.json');
    plant(f, `2147483646@${os.hostname()}`, 60_000);
    assert.equal(lock.acquireLock(f, { retries: 2, intervalMs: 5 }).acquired, true);
    lock.releaseLock(lock.lockPathFor(f));
  });

  test('a re-entrant hold whose lock file was taken away re-acquires instead of assuming', () => {
    const f = path.join(dir, 'state.md');
    assert.equal(lock.holdLock(f).acquired, true);
    fs.unlinkSync(lock.lockPathFor(f));                       // lost by hand
    const again = lock.holdLock(f);
    assert.equal(again.acquired, true);
    assert.match(fs.readFileSync(lock.lockPathFor(f), 'utf-8'), new RegExp(`^${process.pid}@`));
    lock.releaseHeld(f); lock.releaseHeld(f);
    assert.equal(lock.isHeld(f), false);
  });

  test('a focus run write built from a stale read fails stale_write instead of undoing a stop', () => {
    const focus = require(path.join(LIB, 'focus.cjs'));
    focus.writeAutoRun(dir, { run_id: 'auto-1', status: 'initialized' });
    const early = focus.readAutoRun(dir);                    // --update reads...
    assert.equal(focus.writeAutoRun(dir, { ...focus.readAutoRun(dir), status: 'stopped', stop_reason: 'user_stop' }), true); // ...a --stop lands...
    const late = focus.writeAutoRun(dir, { ...early, status: 'in_progress' });            // ...--update writes its copy
    assert.equal(late.error, 'stale_write');
    assert.equal(focus.readAutoRun(dir).status, 'stopped', 'the stop is kept');
  });

  test('a strict acquire on a stale lock it cannot move stops at its deadline instead of spinning', () => {
    const f = path.join(dir, 'auto-run.json');
    const lp = plant(f, '2147483646', 60_000);
    const code = `
      const fs = require('fs');
      const real = fs.renameSync;
      fs.renameSync = (a, b) => { if (a === ${JSON.stringify(lp)}) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } return real(a, b); };
      const lock = require(${JSON.stringify(path.join(LIB, 'lock.cjs'))});
      const t0 = Date.now();
      const r = lock.acquireLock(${JSON.stringify(f)}, { strict: true, waitMs: 400 });
      console.log(JSON.stringify({ acquired: r.acquired, ms: Date.now() - t0 }));`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8', timeout: 15000 });
    assert.equal(r.signal, null, 'it returned on its own');
    const out = JSON.parse(r.stdout);
    assert.equal(out.acquired, false);
    assert.ok(out.ms < 5000, `returned after ${out.ms} ms`);
  });
});

describe('R2: where lock files live', () => {
  test('locks live in a per-user directory', () => {
    assert.match(path.basename(lock.lockDir()), /^pan-locks-[A-Za-z0-9._-]+$/);
    assert.equal(path.dirname(lock.lockDir()), os.tmpdir());
  });

  test('two spellings of one file meet at one lock (the directory is resolved through realpath)', () => {
    const real = fs.realpathSync.native(dir);
    assert.equal(lock.lockPathFor(path.join(dir, 'state.md')), lock.lockPathFor(path.join(real, 'state.md')));
  });

  test('on POSIX a directory this user cannot write is not contention: the acquire gives up at once', { skip: process.platform === 'win32' }, () => {
    const code = `
      const fs = require('fs');
      const real = fs.writeFileSync;
      fs.writeFileSync = (p, d, o) => { if (o && o.flag === 'wx') { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } return real(p, d, o); };
      const lock = require(${JSON.stringify(path.join(LIB, 'lock.cjs'))});
      const t0 = Date.now();
      const r = lock.acquireLock(${JSON.stringify(path.join(dir, 'x.json'))}, { strict: true, waitMs: 6000 });
      console.log(JSON.stringify({ acquired: r.acquired, ms: Date.now() - t0 }));`;
    const out = JSON.parse(spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8', timeout: 15000 }).stdout);
    assert.equal(out.acquired, false);
    assert.ok(out.ms < 3000, `gave up after ${out.ms} ms, not at the 6 s deadline`);
  });
});

describe('R3: planning-markdown writers lock their own read', () => {
  test('focus close\'s state.md row and a concurrent locked state command both survive', async () => {
    write('.planning/state.md', '# Project State\n\n**Status:** Ready\n\n### Blockers/Concerns\n\nNone\n');
    const sw = require(path.join(LIB, 'state-write.cjs'));
    const holder = spawn(process.execPath, ['-e', `
      const store = require(${JSON.stringify(path.join(LIB, 'store.cjs'))});
      const sw = require(${JSON.stringify(path.join(LIB, 'state-write.cjs'))});
      store.lockCommand(${JSON.stringify(dir)}, 'state', 'update', []);
      console.log('held');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
      const r = sw.stateApply(${JSON.stringify(dir)}, { fields: { Status: 'B-UPDATE' } });
      console.log(JSON.stringify(r));`], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve) => holder.stdout.once('data', resolve));
    const row = sw.stateQuickTask(dir, { description: 'focus cycle', status: 'verified', directory: '[1](./quick/1/)' });
    await new Promise((resolve) => holder.on('close', resolve));
    assert.equal(row.written, true);
    const text = fs.readFileSync(path.join(dir, '.planning', 'state.md'), 'utf-8');
    assert.match(text, /B-UPDATE/, 'the other command\'s write is kept');
    assert.match(text, /focus cycle/, 'focus close\'s row is kept');
  });

  test('roadmap compact writes roadmap.md under its lock and atomically', () => {
    const src = fs.readFileSync(path.join(LIB, 'roadmap-compact.cjs'), 'utf-8');
    assert.match(src, /locked\(planningPath\(cwd, ROADMAP_FILE\), \(\) => compactRoadmapLocked\(cwd, opts\)/);
    assert.doesNotMatch(src, /fs\.writeFileSync\(roadmapPath/);
  });
});

describe('R4: pauses close their step; ids stay inside .planning/pauses', () => {
  test('a pause id with a path in it is refused before any file is touched', () => {
    fs.mkdirSync(path.join(dir, '.planning'));
    for (const id of ['../../../b/.planning/pauses/y', 'p-x/../../z', 'P-UPPER', '']) {
      const r = P.answerPause(dir, id, { value: 'done' });
      assert.ok(['invalid_id', 'id_required'].includes(r.error), `${id} → ${r.error}`);
    }
    assert.equal(P.cancelPause(dir, '../evil', 'x').error, 'invalid_id');
    assert.deepEqual(fs.readdirSync(path.join(dir, '.planning')), [], 'nothing was created');
  });

  test('an approved checkpoint completes its step, so resume moves past it', () => {
    gitInit();
    write('.planning/phases/01-a/01-01-plan.md', '<task type="auto">a</task>\n<task type="checkpoint:human-verify">b</task>\n<task type="auto">c</task>\n');
    J.journalStep(dir, { plan: '01-01', step: 'task-1', event: 'completed', commit: commit('one.txt') });
    const o = P.openPause(dir, { kind: 'human-verify', run: '01-01', step: 'task-2', question: 'Does it render?' });
    P.answerPause(dir, o.pause.id, { value: 'approved' });
    J.journalStep(dir, { plan: '01-01', step: 'task-3', event: 'completed', commit: commit('three.txt') });
    const r = J.resumePoint(dir, '01-01');
    assert.equal(r.all_done, true, JSON.stringify(r));
  });

  test('an "issues" answer resumes the step without completing it', () => {
    gitInit();
    write('.planning/phases/01-a/01-01-plan.md', '<task type="checkpoint:human-verify">b</task>\n');
    const o = P.openPause(dir, { kind: 'human-verify', run: '01-01', step: 'task-1', question: 'Q' });
    P.answerPause(dir, o.pause.id, { value: 'issues', note: 'misaligned' });
    assert.equal(J.resumePoint(dir, '01-01').resume_at, 'task-1');
  });

  test('a cancelled pause does not strand its step: the task can still be recorded done', () => {
    gitInit();
    write('.planning/phases/01-a/01-01-plan.md', '<task type="auto">a</task>\n');
    const o = P.openPause(dir, { kind: 'human-action', run: '01-01', step: 'task-1', question: 'Log in' });
    P.cancelPause(dir, o.pause.id, 'done another way');
    const r = J.journalStep(dir, { plan: '01-01', step: 'task-1', event: 'completed', commit: commit('a.txt') });
    assert.equal(r.recorded, true, JSON.stringify(r));
  });

  test('every human_needed stop opens the autodev pause, including a session blocked on a ruling', () => {
    write('.planning/project.md', '# P\n\n**Core value:** v\n');
    write('.planning/requirements.md', '# Requirements\n');
    write('.planning/config.json', JSON.stringify({ workflow: { phase_gate: 'warn' } }));
    write('.planning/state.md', '# Project State\n\n## Current Position\n\n**Current Phase:** 1\n**Status:** Ready to execute\n');
    write('.planning/roadmap.md', '# Roadmap\n\n## Phases\n\n- [ ] **Phase 1: P1**\n\n### Phase 1: P1\n**Goal:** g1\n\n');
    write('.planning/phases/01-p1/01-01-plan.md', '---\nphase: 01\n---\n');
    const autodev = require(path.join(LIB, 'autodev.cjs'));
    const r = autodev.runAutodev(dir, { host: 'claude', maxUsd: 5, execute: () => ({ exit: 0, cost_usd: 0, blocked: 'spec conflict on the login test' }) });
    assert.equal(r.stop && r.stop.reason, 'human_needed', JSON.stringify(r));
    assert.equal(P.listPauses(dir, { open: true }).filter((p) => p.kind === 'autodev-human').length, 1);
    const again = autodev.runAutodev(dir, { host: 'claude', maxUsd: 5, execute: () => ({ exit: 0, cost_usd: 0 }) });
    assert.equal(again.error, 'pause_open');
  });

  test('a fresh autodev run refuses run_busy beside a run another live process drives', () => {
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });
    try {
      write('.planning/autodev/run-live/run.json', JSON.stringify({ id: 'run-live', status: 'running', owner: { pid: holder.pid, since: 'now' } }));
      const r = require(path.join(LIB, 'autodev.cjs')).runAutodev(dir, { host: 'claude', maxUsd: 1 });
      assert.equal(r.error, 'run_busy');
      assert.equal(r.run, 'run-live');
    } finally { holder.kill(); }
  });

  test('orchestration TTLs that do not parse fall back instead of turning expiry off', () => {
    assert.equal(P.ttlHours('72h', 72), 72);
    assert.equal(P.ttlHours('', 72), 72);
    assert.equal(P.ttlHours(false, 72), 0 || null, 'false is 0: never expires, as documented');
    assert.equal(P.ttlHours(3e9, 72), 24 * 365 * 10, 'capped');
    write('.planning/config.json', JSON.stringify({ orchestration: { approval_ttl_hours: '3d' } }));
    const gate = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'merge-gate.cjs'));
    const rec = gate.requestMerge(dir, { branch: 'army/x', ci_green: true, verify_pass: true, now: '2026-11-02T00:00:00.000Z' });
    assert.equal(rec.expires_at, '2026-11-05T00:00:00.000Z');
  });
});

describe('R5: records PAN cannot parse', () => {
  test('a new focus run replaces a conflict-marked auto-run.json, keeping the old bytes aside', () => {
    write('.planning/focus/auto-run.json', '<<<<<<< HEAD\n{"status":"in_progress"}\n=======\n');
    const r = spawnSync(process.execPath, [TOOLS, 'focus', 'auto', '--category', 'security'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stdout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'focus', 'auto-run.json'), 'utf-8')).status, 'initialized');
    assert.ok(fs.readdirSync(path.join(dir, '.planning', 'focus')).some((n) => n.startsWith('auto-run.json.unreadable-')));
  });

  test('a merge request replaces a torn approval record; a refusal never prints a next step', () => {
    write('.planning/orchestration/approvals/feat-x.json', '{"status": "awaiting');
    const gate = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'merge-gate.cjs'));
    const rec = gate.requestMerge(dir, { branch: 'feat-x', ci_green: true, verify_pass: true });
    assert.equal(rec.status, 'awaiting_approval');
    const merge = fs.readFileSync(path.join(LIB, 'merge.cjs'), 'utf-8');
    assert.match(merge, /if \(rec\.error\) \{ output\(rec, raw, 'error', 1\); return; \}/);
    const { NATIVE_TOOLS } = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'native-tools.cjs'));
    const tool = NATIVE_TOOLS.find((t) => t.name === 'pan_request_merge');
    fs.writeFileSync(path.join(dir, '.planning', 'orchestration', 'approvals', 'feat-x.json'), JSON.stringify({ status: 'hand-edited' }));
    const refused = tool.handler({ cwd: dir, input: { branch: 'feat-x' } });
    assert.equal(refused.json.error, 'unknown_state');
    assert.equal(refused.isError, true);
  });
});

describe('R6: smaller fixes', () => {
  test('next-action routes the statuses PAN\'s own snapshot sources emit', () => {
    const { nextAction } = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'orchestrator.cjs'));
    assert.equal(nextAction({ phases: [{ number: '1', status: 'no_directory' }] }).action, 'plan');
    assert.equal(nextAction({ phases: [{ number: '1', status: 'Pending' }] }).action, 'plan');
    assert.equal(nextAction({ phases: [{ number: '1', status: 'In Progress' }] }).action, 'execute');
    assert.equal(nextAction({ phases: [{ number: '1', status: 'bogus' }] }).error, 'unknown_state');
  });

  test('the journal resolves plans of multi-level decimal phases and counts legacy "## Task N" plans', () => {
    gitInit();
    write('.planning/phases/02.1.1-deeper/02.1.1-01-plan.md', '## Task 1\nx\n## Task 2\ny\n');
    const a = commit('a.txt');
    assert.equal(J.journalStep(dir, { plan: '02.1.1-01', step: 'task-1', event: 'completed', commit: a }).recorded, true);
    const r = J.resumePoint(dir, '02.1.1-01');
    assert.equal(r.tasks, 2);
    assert.equal(r.resume_at, 'task-2');
  });

  test('open_work does not re-check the journal of a finished plan', () => {
    write('.planning/phases/01-a/01-01-plan.md', '<task>a</task>\n');
    write('.planning/phases/01-a/01-01-summary.md', 'done\n');
    write('.planning/phases/01-a/01-01-journal.jsonl', JSON.stringify({ seq: 1, step: 'task-1', event: 'completed', artifact: { commit: 'deadbeef' } }) + '\n');
    assert.deepEqual(J.journalsIn(dir, path.join(dir, '.planning', 'phases', '01-a')), {});
  });

  test('a refused store call creates no directory', () => {
    const r = P.answerPause(dir, 'p-nope', { value: 'x' });
    assert.equal(r.error, 'pause_not_found');
    assert.equal(fs.existsSync(path.join(dir, '.planning')), false);
  });

  test('appendLine starts a new line when the file does not end in one, and seq never repeats', () => {
    const f = path.join(dir, 'journal.jsonl');
    fs.writeFileSync(f, '{"seq":1,"step":"task-1"}\n{"seq":2,"step":"task-2"}');
    assert.equal(store.appendLine(f, { step: 'task-3' }).seq, 3);
    assert.deepEqual(J.readJournal(f).map((r) => r.step), ['task-1', 'task-2', 'task-3']);
    fs.appendFileSync(f, '{"seq":4,"st');
    assert.equal(store.appendLine(f, { step: 'task-5' }).seq, 4, 'the torn line is skipped; seq continues from the highest');
    assert.deepEqual(J.readJournal(f).map((r) => r.step), ['task-1', 'task-2', 'task-3', 'task-5']);
  });

  test('init quick claims its directory, so a focus cycle opened next takes another number', () => {
    write('.planning/state.md', '# Project State\n');
    const r = JSON.parse(spawnSync(process.execPath, [TOOLS, 'init', 'quick', 'fix login bug'], { cwd: dir, encoding: 'utf-8' }).stdout);
    assert.ok(fs.existsSync(path.join(dir, r.task_dir)), 'the directory is made');
    const focus = require(path.join(LIB, 'focus.cjs'));
    write('.planning/focus/batch-2026-11-02.json', JSON.stringify({ date: '2026-11-02', batch: [{ id: 'P1', title: 't', file: 'a.js' }] }));
    const opened = focus.focusOpen(dir, { kind: 'docs', batch: '.planning/focus/batch-2026-11-02.json' });
    assert.notEqual(opened.num, r.next_num);
  });

  test('bus: concurrent consumers never receive one message twice, and none is lost', async () => {
    const bus = require(path.join(LIB, 'bus.cjs'));
    fs.mkdirSync(path.join(dir, '.planning'));
    for (let i = 0; i < 40; i++) bus.publish(dir, 'work', { n: i }, { source: 'test' });
    const code = `
      const bus = require(${JSON.stringify(path.join(LIB, 'bus.cjs'))});
      const got = [];
      for (let k = 0; k < 10; k++) { const r = bus.drain(${JSON.stringify(dir)}, 'work', { mode: 'consume', limit: 3 }); for (const e of r.entries || []) got.push(e.payload.n); }
      console.log(JSON.stringify(got));`;
    const runs = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve) => {
      const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('close', () => resolve(JSON.parse(out)));
    })));
    const all = runs.flat().sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: 40 }, (_, i) => i));
  });
});
