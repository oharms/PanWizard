/**
 * Programs A1a and A1c: the autodev loop.
 *
 * A1a (pure core): the run ledger, unit selection from `.planning/` (the next-action
 * router), stop reasons decided in code, and resume. Each stop reason is produced from
 * fixture state, and a run killed mid-unit resumes the same unit.
 *
 * A1c (launch): a fresh headless host session per unit, argv from hosts.cjs. Tier 0 with
 * a stand-in `claude` on PATH: a new session per unit, resume after a kill, and every
 * A1a stop reason reached end to end.
 */
'use strict';

const { describe, test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const A = require('../pan-wizard-core/bin/lib/autodev.cjs');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

function project({ phases = [{ n: 1 }], gate = 'warn', requirements = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-autodev-'));
  dirs.push(dir);
  const p = path.join(dir, '.planning');
  fs.mkdirSync(path.join(p, 'phases'), { recursive: true });
  fs.writeFileSync(path.join(p, 'project.md'), '# P\n\n**Core value:** v\n');
  if (requirements) fs.writeFileSync(path.join(p, 'requirements.md'), '# Requirements\n');
  fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: gate } }));
  fs.writeFileSync(path.join(p, 'state.md'), '# Project State\n\n## Current Position\n\n**Current Phase:** 1\n**Status:** Ready to plan\n');
  let roadmap = '# Roadmap\n\n## Phases\n\n';
  for (const ph of phases) roadmap += `- [${ph.ticked ? 'x' : ' '}] **Phase ${ph.n}: P${ph.n}**\n`;
  roadmap += '\n';
  for (const ph of phases) {
    roadmap += `### Phase ${ph.n}: P${ph.n}\n**Goal:** g${ph.n}\n\n`;
    const d = path.join(p, 'phases', `0${ph.n}-p${ph.n}`);
    fs.mkdirSync(d);
    for (let i = 1; i <= (ph.plans || 0); i++) fs.writeFileSync(path.join(d, `0${ph.n}-0${i}-plan.md`), '---\nphase: 0' + ph.n + '\n---\n');
    for (let i = 1; i <= (ph.summaries || 0); i++) fs.writeFileSync(path.join(d, `0${ph.n}-0${i}-summary.md`), '# s\n');
    if (ph.verification) fs.writeFileSync(path.join(d, `0${ph.n}-verification.md`), `---\nstatus: ${ph.verification}\n---\n# V\n`);
  }
  fs.writeFileSync(path.join(p, 'roadmap.md'), roadmap);
  return dir;
}

const unit = (action, phase = '1') => ({ action, phase, command: `/pan:${action}-phase ${phase}` });
const finished = (u, extra = {}) => ({ seq: 1, status: 'finished', unit: u, exit: 0, cost_usd: 0, snapshot_after: 'x', ...extra });

describe('A1a: stop reasons from fixture state', () => {
  test('done: every phase finished, the milestone is next', () => {
    const dir = project({ phases: [{ n: 1, plans: 1, summaries: 1, verification: 'passed', ticked: true }] });
    const u = A.selectUnit(dir);
    assert.equal(u.action, 'audit_milestone');
    assert.equal(A.decideStop({ unit: u, rows: [], limits: {}, snapshot: A.snapshotHash(dir) }).reason, 'done');
  });

  test('human_needed: the verifier asked for a human', () => {
    const dir = project({ phases: [{ n: 1, plans: 1, summaries: 1, verification: 'human_needed' }] });
    const u = A.selectUnit(dir);
    assert.equal(u.human_needed, true);
    assert.equal(A.decideStop({ unit: u, rows: [], limits: {}, snapshot: A.snapshotHash(dir) }).reason, 'human_needed');
  });

  test('human_needed: no roadmap to work from', () => {
    const dir = project();
    fs.rmSync(path.join(dir, '.planning', 'roadmap.md'));
    assert.equal(A.decideStop({ unit: A.selectUnit(dir), rows: [], limits: {}, snapshot: '' }).reason, 'human_needed');
  });

  test('gate_failed: the phase gate refused to complete the phase', () => {
    const dir = project({ phases: [{ n: 1, plans: 1, summaries: 1, verification: 'gaps_found' }] });
    const rows = [finished(unit('complete_phase'), { exit: 1, error: 'phase_gate_refused' })];
    assert.equal(A.decideStop({ unit: A.selectUnit(dir), rows, limits: {}, snapshot: A.snapshotHash(dir) }).reason, 'gate_failed');
  });

  test('budget_usd: spend reached the cap', () => {
    const dir = project();
    const rows = [finished(unit('plan'), { cost_usd: 2.5 }), finished(unit('execute'), { cost_usd: 2.5 })];
    assert.equal(A.decideStop({ unit: A.selectUnit(dir), rows, limits: { maxUsd: 5 }, snapshot: 'new' }).reason, 'budget_usd');
    assert.equal(A.decideStop({ unit: A.selectUnit(dir), rows, limits: { maxUsd: 6 }, snapshot: 'new' }), null);
  });

  test('turns: the unit cap is reached', () => {
    const dir = project();
    const rows = [finished(unit('plan')), finished(unit('execute')), finished(unit('verify'))];
    assert.equal(A.decideStop({ unit: A.selectUnit(dir), rows, limits: { maxTurns: 3 }, snapshot: 'new' }).reason, 'turns');
  });

  test('no_progress: the same unit again, and nothing on disk changed since it ran', () => {
    const dir = project();
    const snap = A.snapshotHash(dir);
    const u = A.selectUnit(dir);
    const rows = [finished(u, { snapshot_after: snap })];
    assert.equal(A.decideStop({ unit: u, rows, limits: {}, snapshot: snap }).reason, 'no_progress');
    assert.equal(A.decideStop({ unit: u, rows, limits: {}, snapshot: 'changed' }), null, 'the disk moved: not stuck');
  });

  test('every stop reason is one of the declared ones', () => {
    assert.deepEqual([...A.STOP_REASONS].sort(), ['budget_usd', 'ci_failed', 'done', 'forecast_exceeded', 'gate_failed', 'human_needed', 'no_progress', 'turns']);
  });
});

describe('A1a: the ledger and resume', () => {
  test('a started unit with no finished row is resumed, the same unit', () => {
    const u = unit('execute');
    assert.deepEqual(A.pendingUnit([{ seq: 1, status: 'started', unit: u }]).unit, u);
    assert.equal(A.pendingUnit([{ seq: 1, status: 'started', unit: u }, { seq: 1, status: 'finished', unit: u }]), null);
  });

  test('the snapshot hash follows the disk', () => {
    const dir = project();
    const a = A.snapshotHash(dir);
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-p1', '01-01-plan.md'), 'x');
    assert.notEqual(A.snapshotHash(dir), a);
  });

  test('the unit prompt names one command and forbids questions and other phases', () => {
    const p = A.unitPrompt('claude', unit('execute', '3'));
    // The command first, so the host expands it instead of the session hunting for the workflow.
    assert.match(p, /^\/pan:exec-phase 3 \(/);
    assert.match(p, /do not ask questions/);
    assert.doesNotMatch(p, /[\r\n&|<>%]/, 'one shell-safe line');
    assert.match(A.unitPrompt('opencode', unit('plan', '2')), /\/pan-plan-phase 2/);
    assert.match(A.unitPrompt('codex', unit('verify', '2')), /\$pan-verify-phase 2/);
  });
});

describe('A1c: end to end with a stand-in host', () => {
  let binDir;
  let fakeLog;
  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-autodev-bin-'));
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `
const fs = require('fs'), path = require('path');
const prompt = process.argv[process.argv.length - 1];
fs.appendFileSync(process.env.FAKE_LOG, prompt + '\\n');
const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)/);
if (m && !process.env.FAKE_NOOP) {
  const n = m[2];
  const phases = path.join(process.cwd(), '.planning', 'phases');
  const dir = path.join(phases, fs.readdirSync(phases).find((d) => d.startsWith('0' + n + '-')));
  const pad = '0' + n;
  if (m[1] === 'plan') fs.writeFileSync(path.join(dir, pad + '-01-plan.md'), '---\\nphase: ' + pad + '\\n---\\n');
  if (m[1] === 'exec') fs.writeFileSync(path.join(dir, pad + '-01-summary.md'), '# done\\n');
  if (m[1] === 'verify') fs.writeFileSync(path.join(dir, pad + '-verification.md'), '---\\nstatus: ' + (process.env.FAKE_VERIFY_STATUS || 'passed') + '\\n---\\n# V\\n');
}
process.stdout.write(JSON.stringify({ result: 'ok', total_cost_usd: Number(process.env.FAKE_COST || 0.1), num_turns: 1 }) + '\\n');
`);
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
  });

  function autodev(dir, args, env = {}) {
    fakeLog = path.join(dir, 'fake.log');
    // An unattended run needs a spend cap (A6); these tests are not about it.
    if (!args.includes('--max-usd') && args[0] !== 'status') args = [...args, '--max-usd', '100'];
    const r = spawnSync(process.execPath, [TOOLS, 'autodev', ...args, '--host', 'claude'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, FAKE_LOG: fakeLog, ...env },
    });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { json, stderr: r.stderr, status: r.status };
  }
  const sessions = () => { try { return fs.readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };

  test('done: plan, execute, verify each in a fresh session, then the phase completes', () => {
    const dir = project();
    const r = autodev(dir, ['run']);
    assert.equal(r.json && r.json.stop && r.json.stop.reason, 'done', r.stderr + JSON.stringify(r.json));
    const s = sessions();
    assert.equal(s.length, 3, s.join('\n'));
    assert.match(s[0], /\/pan:plan-phase 1/);
    assert.match(s[1], /\/pan:exec-phase 1/);
    assert.match(s[2], /\/pan:verify-phase 1/);
    assert.deepEqual(r.json.units.map((u) => u.action), ['plan', 'execute', 'verify', 'complete_phase']);
    const ledger = fs.readFileSync(path.join(dir, r.json.ledger), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const done = ledger.filter((x) => x.status === 'finished');
    assert.equal(done.length, 4);
    assert.ok(done.every((x) => typeof x.cost_usd === 'number'));
    assert.ok(done.slice(0, 3).every((x) => Array.isArray(x.argv) && x.argv.includes('-p')), 'argv from hosts.cjs');
    const st = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'autodev', 'state.json'), 'utf8'));
    assert.deepEqual(st.phases['1'], { verified: true, merged: true }, 'the run facts persisted');
  });

  test('budget_usd end to end', () => {
    const dir = project();
    const r = autodev(dir, ['run', '--max-usd', '0.5'], { FAKE_COST: '0.6' });
    assert.equal(r.json.stop.reason, 'budget_usd');
    assert.equal(sessions().length, 1);
  });

  test('turns end to end', () => {
    const dir = project();
    const r = autodev(dir, ['run', '--max-turns', '2']);
    assert.equal(r.json.stop.reason, 'turns');
    assert.equal(sessions().length, 2);
  });

  test('no_progress end to end', () => {
    const dir = project();
    const r = autodev(dir, ['run'], { FAKE_NOOP: '1' });
    assert.equal(r.json.stop.reason, 'no_progress');
    assert.equal(sessions().length, 1, 'the unit ran once; the second time nothing had changed');
  });

  test('human_needed end to end', () => {
    const dir = project();
    const r = autodev(dir, ['run'], { FAKE_VERIFY_STATUS: 'human_needed' });
    assert.equal(r.json.stop.reason, 'human_needed');
  });

  test('gate_failed end to end', () => {
    const dir = project({ gate: 'enforce' });
    const r = autodev(dir, ['run'], { FAKE_VERIFY_STATUS: 'gaps_found' });
    assert.equal(r.json.stop.reason, 'gate_failed', JSON.stringify(r.json));
  });

  test('resume after a kill relaunches the unit that was in flight', () => {
    const dir = project({ phases: [{ n: 1, plans: 1 }] });
    // A run that died mid-unit: its ledger ends on a started row.
    const run = path.join(dir, '.planning', 'autodev', 'run-killed');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ id: 'run-killed', host: 'claude', limits: {} }));
    fs.writeFileSync(path.join(run, 'ledger.jsonl'), JSON.stringify({ seq: 1, status: 'started', unit: { action: 'execute', phase: '1', command: '/pan:exec-phase 1' } }) + '\n');
    const r = autodev(dir, ['resume']);
    assert.equal(r.json.run, 'run-killed');
    assert.match(sessions()[0], /\/pan:exec-phase 1/, 'the in-flight unit first');
    assert.equal(r.json.stop.reason, 'done');
    const rows = fs.readFileSync(path.join(run, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.filter((x) => x.status === 'finished' && x.seq === 1).length, 1, 'seq 1 finished on resume');
  });

  test('a host with no autonomous adapter is refused', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [TOOLS, 'autodev', 'run', '--host', 'copilot'], { cwd: dir, encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).error, 'unsupported_host');
  });

  test('/pan:autodev runs the loop in the foreground', () => {
    const t = fs.readFileSync(path.join(ROOT, 'commands', 'pan', 'autodev.md'), 'utf8');
    assert.match(t, /pan-tools\.cjs autodev run/);
    assert.match(t, /autodev resume/);
    assert.match(t, /autodev status/);
  });
});

describe('test safety: PAN_STANDIN_DIR', () => {
  test('with the variable set, a host with no stand-in there is refused, never run', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-standin-'));
    dirs.push(empty);
    const prev = process.env.PAN_STANDIN_DIR;
    process.env.PAN_STANDIN_DIR = empty;
    try {
      assert.match(A.standinMissing('claude'), /refusing to run the real CLI/);
      const r = A.executeUnit(empty, { action: 'plan', phase: '1', command: '/pan:plan-phase 1' }, 'claude', {});
      assert.equal(r.exit, 127);
      assert.match(r.error, /PAN_STANDIN_DIR/);
      fs.writeFileSync(path.join(empty, process.platform === 'win32' ? 'claude.cmd' : 'claude'), '');
      assert.equal(A.standinMissing('claude'), null);
    } finally {
      if (prev === undefined) delete process.env.PAN_STANDIN_DIR; else process.env.PAN_STANDIN_DIR = prev;
    }
  });
});
