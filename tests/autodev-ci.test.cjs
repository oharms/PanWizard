/**
 * Program A2: the oracle and CI in the autodev loop.
 *
 * ci.cjs reads `gh pr checks` (gh is an optional external CLI), ignores checks that
 * already fail on the base branch, and takes the failing log tail. With `autodev run
 * --ci`, every completed phase is checked against CI: a failure starts a fix round with
 * the log tail as feedback, and a breaker stops the run after N rounds (ci_failed). What
 * a session claims about its tests never decides: the oracle does.
 */
'use strict';

const { describe, test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const CI = require('../pan-wizard-core/bin/lib/ci.cjs');

describe('A2: reading CI (fixture gh output)', () => {
  const fake = (responses) => (args) => {
    const key = args.slice(0, 2).join(' ');
    if (!(key in responses)) return { status: 1, stdout: '', stderr: `no fixture for ${key}` };
    return { status: 0, stdout: typeof responses[key] === 'string' ? responses[key] : JSON.stringify(responses[key]), stderr: '' };
  };

  test('a failing check fails the oracle, with its log tail', () => {
    const exec = fake({
      'pr checks': [{ name: 'test', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/123/job/9', workflow: 'CI' }, { name: 'build', state: 'SUCCESS', bucket: 'pass', link: '', workflow: 'CI' }],
      'run list': [],
      'run view': 'x\nnot ok 3 - parse rejects empty input\n# fail 1\n',
    });
    const r = CI.ciOracle('.', { exec });
    assert.equal(r.status, 'failed');
    assert.deepEqual(r.failed, ['test']);
    assert.match(r.tail, /not ok 3/);
  });

  test('a check that already fails on the base is skipped', () => {
    const exec = fake({
      'pr checks': [{ name: 'lint', state: 'FAILURE', bucket: 'fail', link: '', workflow: 'Lint' }, { name: 'test', state: 'SUCCESS', bucket: 'pass', link: '', workflow: 'CI' }],
      'run list': [{ name: 'lint', workflowName: 'Lint', conclusion: 'failure' }, { name: 'CI', workflowName: 'CI', conclusion: 'success' }],
    });
    const r = CI.ciOracle('.', { exec, base: 'main' });
    assert.equal(r.status, 'passed', JSON.stringify(r));
    assert.deepEqual(r.ignored, ['lint']);
  });

  test('pending checks are pending; no gh is unavailable', () => {
    assert.equal(CI.ciOracle('.', { exec: fake({ 'pr checks': [{ name: 't', state: 'PENDING', bucket: 'pending' }], 'run list': [] }) }).status, 'pending');
    assert.equal(CI.ciOracle('.', { exec: () => ({ status: null, error: new Error('ENOENT'), stdout: '', stderr: '' }) }).status, 'unavailable');
  });

  test('the breaker trips at N rounds', () => {
    assert.equal(CI.breakerTripped(2, 3), false);
    assert.equal(CI.breakerTripped(3, 3), true);
    assert.equal(CI.DEFAULT_CI_ROUNDS, 3);
  });
});

describe('A2: the local oracle (--ci local)', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ci-local-'));
  const pkg = (dir, scripts) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts }));

  test('picks ci:local over test, test without it, and nothing without either', () => {
    const d = tmp();
    assert.equal(CI.localGate(d), null);
    assert.equal(CI.localOracle(d, { exec: () => { throw new Error('must not run'); } }).status, 'unavailable');
    pkg(d, { test: 'x' });
    assert.deepEqual(CI.localGate(d), { name: 'test', args: ['test'] });
    pkg(d, { test: 'x', 'ci:local': 'y' });
    assert.deepEqual(CI.localGate(d), { name: 'ci:local', args: ['run', 'ci:local'] });
    fs.rmSync(d, { recursive: true, force: true });
  });

  test('the exit code decides; a ci:local report names the failing gates', () => {
    const d = tmp();
    pkg(d, { 'ci:local': 'y' });
    let ran;
    const ok = CI.localOracle(d, { exec: (args) => { ran = args; return { status: 0, stdout: 'PASSED', stderr: '' }; } });
    assert.equal(ok.status, 'passed');
    assert.deepEqual(ran, ['run', 'ci:local']);
    assert.equal(CI.localOracle(d, { exec: () => ({ status: 1, stdout: 'FAILED', stderr: '' }) }).failed[0], 'ci:local');
    fs.mkdirSync(path.join(d, '.ci-local'));
    fs.writeFileSync(path.join(d, '.ci-local', 'report.json'), JSON.stringify({ gates: [{ id: 'gitleaks', status: 'fail' }, { id: 'audit', status: 'pass' }, { id: 'linux-node18', status: 'fail' }] }));
    const bad = CI.localOracle(d, { exec: () => ({ status: 1, stdout: 'x\nFAILED', stderr: '' }) });
    assert.equal(bad.status, 'failed');
    assert.deepEqual(bad.failed, ['gitleaks', 'linux-node18']);
    assert.match(bad.tail, /FAILED/);
    assert.equal(CI.localOracle(d, { exec: () => ({ status: null, error: new Error('ENOENT') }) }).status, 'unavailable');
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('A2: CI in the loop, end to end', () => {
  const dirs = [];
  let binDir;
  afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
  after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  before(() => {
    // Not in dirs: afterEach must not delete the stand-ins, or later tests reach the real CLIs.
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ci-bin-'));
    const claude = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(claude, `
const fs = require('fs'), path = require('path');
const prompt = process.argv[process.argv.length - 1];
fs.appendFileSync(process.env.FAKE_LOG, prompt + '\\n');
const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)/);
if (m) {
  const pad = '0' + m[2];
  const phases = path.join(process.cwd(), '.planning', 'phases');
  const dir = path.join(phases, fs.readdirSync(phases).find((d) => d.startsWith(pad + '-')));
  if (m[1] === 'plan') fs.writeFileSync(path.join(dir, pad + '-01-plan.md'), '---\\nphase: ' + pad + '\\n---\\n');
  // The session claims a clean run: a fabricated test count.
  if (m[1] === 'exec') fs.writeFileSync(path.join(dir, pad + '-01-summary.md'), '# done\\nTests: 120 passed, 0 failed\\n');
  if (m[1] === 'verify') fs.writeFileSync(path.join(dir, pad + '-verification.md'), '---\\nstatus: passed\\n---\\nAll 120 tests pass.\\n');
}
if (/CI fix round/.test(prompt)) fs.appendFileSync(process.env.FAKE_FIXES, 'x');
process.stdout.write(JSON.stringify({ result: 'ok', total_cost_usd: 0.1 }) + '\\n');
`);
    const gh = path.join(binDir, 'gh-stand-in.js');
    fs.writeFileSync(gh, `
const fs = require('fs');
const a = process.argv.slice(2);
if (process.env.PAN_FAKE_GH_LOG) fs.appendFileSync(process.env.PAN_FAKE_GH_LOG, a.join(' ') + '\\n');
const fixes = (() => { try { return fs.readFileSync(process.env.FAKE_FIXES, 'utf8').length; } catch { return 0; } })();
const passAfter = Number(process.env.FAKE_PASS_AFTER || 99);
if (a[0] === 'pr' && a[1] === 'checks') {
  const ok = fixes >= passAfter;
  process.stdout.write(JSON.stringify([{ name: 'test', state: ok ? 'SUCCESS' : 'FAILURE', bucket: ok ? 'pass' : 'fail', link: 'https://github.com/o/r/actions/runs/77/job/1', workflow: 'CI' }]));
} else if (a[0] === 'pr' && a[1] === 'view') {
  process.stdout.write(JSON.stringify({ headRefOid: process.env.FAKE_HEAD || '' }));
} else if (a[0] === 'run' && a[1] === 'list') {
  process.stdout.write('[]');
} else if (a[0] === 'run' && a[1] === 'view') {
  process.stdout.write('not ok 1 - login rejects a bad password\\n# fail 1\\n');
} else process.exit(1);
`);
    for (const [name, js] of [['claude', claude], ['gh', gh]]) {
      if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`);
      else { fs.writeFileSync(path.join(binDir, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, name), 0o755); }
    }
  });

  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ci-'));
    dirs.push(dir);
    const p = path.join(dir, '.planning');
    fs.mkdirSync(path.join(p, 'phases', '01-p1'), { recursive: true });
    fs.writeFileSync(path.join(p, 'project.md'), '# P\n');
    fs.writeFileSync(path.join(p, 'requirements.md'), '# R\n');
    fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: 'warn' } }));
    fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n- [ ] **Phase 1: P1**\n\n### Phase 1: P1\n**Goal:** g\n');
    return dir;
  }
  function run(dir, args, env = {}) {
    const log = path.join(dir, 'fake.log');
    const fixes = path.join(dir, 'fixes.txt');
    const r = spawnSync(process.execPath, [TOOLS, 'autodev', 'run', '--host', 'claude', '--max-usd', '10', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, FAKE_LOG: log, FAKE_FIXES: fixes, ...env } });
    return { json: JSON.parse(r.stdout), sessions: fs.readFileSync(log, 'utf8').trim().split('\n') };
  }

  test('the session\'s claimed test count is overridden by CI, fed back as a fix round, and the run goes on once CI passes', () => {
    const dir = project();
    const { json, sessions } = run(dir, ['--ci'], { FAKE_PASS_AFTER: '1' });
    assert.equal(json.stop.reason, 'done', JSON.stringify(json));
    const fix = sessions.find((s) => /CI fix round/.test(s));
    assert.ok(fix, sessions.join('\n'));
    assert.match(fix, /login rejects a bad password/, 'the failing log tail is the feedback');
    const ledger = fs.readFileSync(path.join(dir, json.ledger), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const ci = ledger.filter((r) => r.status === 'ci');
    assert.deepEqual(ci.map((r) => r.ci.status), ['failed', 'passed']);
  });

  test('the breaker stops the run after N failed rounds', () => {
    const dir = project();
    const { json, sessions } = run(dir, ['--ci', '--ci-rounds', '2']);
    assert.equal(json.stop.reason, 'ci_failed');
    assert.equal(sessions.filter((s) => /CI fix round/.test(s)).length, 2);
  });

  test('--ci local: the project\'s own gate is the oracle, with no pull request and no gh', () => {
    const dir = project();
    // The gate fails until a fix round has run, like the stand-in checks above.
    fs.writeFileSync(path.join(dir, 'gate.js'), "const n = (() => { try { return require('fs').readFileSync(process.env.FAKE_FIXES, 'utf8').length; } catch { return 0; } })();\nif (n < 1) { console.log('not ok 1 - totals round half up'); process.exit(1); }\nconsole.log('ok');\n");
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '0.0.0', scripts: { 'ci:local': 'node gate.js', test: 'node -e "process.exit(3)"' } }));
    const ghLog = path.join(dir, 'gh-called.txt');
    const { json, sessions } = run(dir, ['--ci', 'local'], { FAKE_PASS_AFTER: '0', PAN_FAKE_GH_LOG: ghLog });
    assert.equal(json.stop.reason, 'done', JSON.stringify(json));
    const fix = sessions.find((s) => /CI fix round/.test(s));
    assert.ok(fix, sessions.join('\n'));
    assert.match(fix, /Failing checks: ci:local/);
    assert.match(fix, /totals round half up/, 'the gate\'s own output is the feedback');
    const ledger = fs.readFileSync(path.join(dir, json.ledger), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(ledger.filter((r) => r.status === 'ci').map((r) => r.ci.status), ['failed', 'passed']);
    assert.equal(fs.existsSync(ghLog), false, 'gh must not be asked: FAKE_PASS_AFTER=0 would have passed the pull request at once');
  });

  test('ci_failed is a declared stop reason', () => {
    assert.ok(require('../pan-wizard-core/bin/lib/autodev.cjs').STOP_REASONS.includes('ci_failed'));
  });
});
