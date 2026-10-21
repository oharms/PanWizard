/**
 * Programs A4 and A6: the autodev failure-class router and dollar governor.
 *
 * A4: a failed unit is classified (compile, assertion, timeout, flake, missing_env,
 * merge_conflict, integrity_violation, scope_violation, budget, unknown) and each class
 * has a policy: a shallow retry with the error tail, a fresh restart, a tier escalation,
 * quarantine, or asking a human. Table-driven tests per class.
 *
 * A6: spend is capped per run (`--max-usd` / `budget.max_usd_run`) and per day
 * (`--max-usd-day` / `budget.max_usd_day`); an unattended run needs a run cap, its
 * approval. The remaining amount goes to Claude as `--max-budget-usd`. A unit that costs
 * more than the P6 p90 forecast stops the run with forecast_exceeded.
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
const FC = require('../pan-wizard-core/bin/lib/failure-class.cjs');
const A = require('../pan-wizard-core/bin/lib/autodev.cjs');

describe('A4: failure classes', () => {
  const CASES = [
    ['compile', { exit: 1, stderr: 'src/a.ts(3,1): error TS2304: Cannot find name x' }],
    ['compile', { exit: 1, stderr: 'SyntaxError: Unexpected token }' }],
    ['assertion', { exit: 1, stderr: 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal' }],
    ['assertion', { exit: 1, stdout: '3 tests failed' }],
    ['timeout', { exit: null, timedOut: true }],
    ['timeout', { exit: 1, stderr: 'Error: ETIMEDOUT' }],
    ['missing_env', { exit: 127, stderr: "'claude' is not recognized as an internal or external command" }],
    ['missing_env', { exit: 1, stderr: 'Invalid API key · Please run /login' }],
    ['merge_conflict', { exit: 1, stdout: 'CONFLICT (content): Merge conflict in src/a.js' }],
    ['integrity_violation', { exit: 2, stderr: "PAN guard: .planning/state.md is PAN's own state." }],
    ['scope_violation', { exit: 1, stderr: 'scope violation: src/x.js is not declared by any plan' }],
    ['budget', { exit: 1, stderr: 'Error: Exceeded --max-budget-usd' }],
    ['budget', { exit: 1, stderr: 'Credit balance is too low' }],
    ['unknown', { exit: 1, stderr: 'something odd' }],
  ];
  for (const [cls, input] of CASES) {
    test(`${cls}: ${(input.stderr || input.stdout || (input.timedOut ? 'timed out' : '')).slice(0, 50)}`, () => assert.equal(FC.classifyFailure(input), cls));
  }

  const POLICY = [
    // [class, attempt, expected action]
    ['compile', 1, 'retry_with_tail'],
    ['compile', 2, 'escalate_tier'],
    ['compile', 3, 'ask'],
    ['assertion', 1, 'retry_with_tail'],
    ['assertion', 2, 'escalate_tier'],
    ['timeout', 1, 'fresh_restart'],
    ['timeout', 2, 'ask'],
    ['flake', 1, 'quarantine'],
    ['missing_env', 1, 'ask'],
    ['merge_conflict', 1, 'ask'],
    ['integrity_violation', 1, 'ask'],
    ['scope_violation', 1, 'ask'],
    ['budget', 1, 'stop_budget'],
    ['unknown', 1, 'fresh_restart'],
    ['unknown', 2, 'ask'],
  ];
  for (const [cls, attempt, action] of POLICY) {
    test(`policy ${cls} attempt ${attempt} → ${action}`, () => assert.equal(FC.routeFailure(cls, attempt).action, action));
  }

  test('every class has a policy, and breadth comes before depth (a retry before an escalation)', () => {
    for (const cls of FC.FAILURE_CLASSES) assert.ok(FC.routeFailure(cls, 1).action, cls);
    const order = ['compile', 'assertion'].map((c) => [1, 2].map((n) => FC.routeFailure(c, n).action));
    for (const o of order) assert.deepEqual(o, ['retry_with_tail', 'escalate_tier']);
  });

  test('an escalation names the tier it climbs to', () => {
    assert.equal(FC.routeFailure('assertion', 2).tier, 'reasoning');
  });
});

describe('A6: the dollar governor (pure)', () => {
  const unit = { action: 'execute', phase: '1', command: '/pan:exec-phase 1' };
  test('the day cap stops the run', () => {
    assert.equal(A.decideStop({ unit, rows: [], limits: { maxUsd: 100, maxUsdDay: 10 }, snapshot: 's', daySpent: 10 }).reason, 'budget_usd');
    assert.equal(A.decideStop({ unit, rows: [], limits: { maxUsd: 100, maxUsdDay: 10 }, snapshot: 's', daySpent: 9 }), null);
  });
  test('a unit past its p90 forecast stops the run', () => {
    const rows = [{ status: 'finished', unit, exit: 0, cost_usd: 9, forecast_p90: 4, snapshot_after: 'x' }];
    const s = A.decideStop({ unit: { ...unit, action: 'verify' }, rows, limits: { maxUsd: 100 }, snapshot: 's' });
    assert.equal(s.reason, 'forecast_exceeded');
    assert.match(s.detail, /9\.00.*4\.00/);
  });
  test('forecast_exceeded is a declared stop reason', () => assert.ok(A.STOP_REASONS.includes('forecast_exceeded')));
  test('the remaining budget is passed to Claude as --max-budget-usd', () => {
    const argv = A.sessionArgv('claude', 'P', { remainingUsd: 3.5 });
    assert.deepEqual(argv.slice(-3), ['--max-budget-usd', '3.50', 'P']);
    assert.ok(!A.sessionArgv('codex', 'P', { remainingUsd: 3.5 }).includes('--max-budget-usd'), 'Claude only');
  });
});

describe('A4 and A6 end to end with a stand-in host', () => {
  const dirs = [];
  let binDir;
  afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gov-bin-'));
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `
const fs = require('fs'), path = require('path');
const prompt = process.argv[process.argv.length - 1];
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
const count = fs.readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\\n').length;
if (process.env.FAKE_FAIL_FIRST && count === 1) { process.stderr.write(process.env.FAKE_FAIL_FIRST + '\\n'); process.exit(1); }
const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)/);
if (m) {
  const n = m[2], pad = '0' + n;
  const phases = path.join(process.cwd(), '.planning', 'phases');
  const dir = path.join(phases, fs.readdirSync(phases).find((d) => d.startsWith(pad + '-')));
  if (m[1] === 'plan') fs.writeFileSync(path.join(dir, pad + '-01-plan.md'), '---\\nphase: ' + pad + '\\n---\\n');
  if (m[1] === 'exec') fs.writeFileSync(path.join(dir, pad + '-01-summary.md'), '# done\\n');
  if (m[1] === 'verify') fs.writeFileSync(path.join(dir, pad + '-verification.md'), '---\\nstatus: passed\\n---\\n');
}
const cost = m && m[1] === 'exec' && process.env.FAKE_EXEC_COST ? Number(process.env.FAKE_EXEC_COST) : 0.1;
process.stdout.write(JSON.stringify({ result: 'ok', total_cost_usd: cost }) + '\\n');
`);
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
  });

  function project(config = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gov-'));
    dirs.push(dir);
    const p = path.join(dir, '.planning');
    fs.mkdirSync(path.join(p, 'phases', '01-p1'), { recursive: true });
    fs.writeFileSync(path.join(p, 'project.md'), '# P\n');
    fs.writeFileSync(path.join(p, 'requirements.md'), '# R\n');
    fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: 'warn' }, ...config }));
    fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n- [ ] **Phase 1: P1**\n\n### Phase 1: P1\n**Goal:** g\n');
    return dir;
  }
  function run(dir, args, env = {}) {
    const log = path.join(dir, 'fake.log');
    const r = spawnSync(process.execPath, [TOOLS, 'autodev', ...args, '--host', 'claude'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, FAKE_LOG: log, ...env } });
    const calls = (() => { try { return fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } })();
    return { json: JSON.parse(r.stdout), calls };
  }

  test('an unattended run needs a spend cap: its approval', () => {
    const dir = project();
    assert.equal(run(dir, ['run']).json.error, 'budget_required');
  });

  test('budget.max_usd_run in config is the cap when no flag is given', () => {
    const dir = project({ budget: { max_usd_run: 0.15 } });
    assert.equal(run(dir, ['run']).json.stop.reason, 'budget_usd');
  });

  test('the remaining budget reaches Claude', () => {
    const dir = project();
    const { calls } = run(dir, ['run', '--max-usd', '1']);
    assert.deepEqual(calls[0].slice(-3, -1), ['--max-budget-usd', '1.00']);
    assert.deepEqual(calls[1].slice(-3, -1), ['--max-budget-usd', '0.90'], 'what is left after the first unit');
  });

  test('a compile failure is retried once with its error tail in the prompt, then the run goes on', () => {
    const dir = project();
    const { json, calls } = run(dir, ['run', '--max-usd', '5'], { FAKE_FAIL_FIRST: 'SyntaxError: Unexpected token }' });
    assert.equal(json.stop.reason, 'done', JSON.stringify(json));
    assert.match(calls[1][calls[1].length - 1], /previous attempt failed/i);
    assert.match(calls[1][calls[1].length - 1], /SyntaxError/);
    const ledger = fs.readFileSync(path.join(dir, json.ledger), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const failed = ledger.find((r) => r.status === 'finished' && r.exit !== 0);
    assert.equal(failed.failure_class, 'compile');
    assert.equal(failed.policy, 'retry_with_tail');
  });

  test('a missing environment stops for a human', () => {
    const dir = project();
    const { json } = run(dir, ['run', '--max-usd', '5'], { FAKE_FAIL_FIRST: 'Invalid API key · Please run /login' });
    assert.equal(json.stop.reason, 'human_needed');
    assert.match(json.stop.detail, /missing_env/);
  });

  test('forecast_exceeded end to end: an execute unit far past the project\'s p90', () => {
    const dir = project();
    const metrics = path.join(dir, '.planning', 'metrics');
    fs.mkdirSync(metrics, { recursive: true });
    const rows = [];
    for (let ph = 2; ph <= 7; ph++) {
      rows.push({ agent: 'pan-executor', tier: 'balanced', phase: String(ph), cost_usd: 1, input_tokens: 10, output_tokens: 10, ts: '2026-10-01T00:00:00Z', v: 4 });
      rows.push({ agent: 'pan-verifier', tier: 'balanced', phase: String(ph), cost_usd: 0.5, input_tokens: 10, output_tokens: 10, ts: '2026-10-01T00:00:00Z', v: 4 });
    }
    fs.writeFileSync(path.join(metrics, 'tokens.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const { json } = run(dir, ['run', '--max-usd', '100'], { FAKE_EXEC_COST: '25' });
    assert.equal(json.stop.reason, 'forecast_exceeded', JSON.stringify(json));
  });
});
