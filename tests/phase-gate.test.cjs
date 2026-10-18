/**
 * phase-gate.cjs — may this phase be marked complete? (program V1)
 *
 * One test per refusal reason, a clean pass, and what the gate could not check
 * (never refused on). Then `phase complete`: `warn` completes and carries the
 * reasons, `enforce` refuses with exit 1 and leaves the roadmap alone, `--force`
 * needs `--reason` and records a decision for every open finding it counted.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const G = require('../pan-wizard-core/bin/lib/phase-gate.cjs');
const F = require('../pan-wizard-core/bin/lib/findings.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const FENCE = '`'.repeat(3);
let dir;
let phaseDir;

const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const codes = (g) => g.reasons.map((r) => r.code).sort();
const pan = (...args) => spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf-8' });

function verification(status, extra = []) {
  write('.planning/phases/03-auth/03-verification.md', ['---', 'phase: 03-auth', `status: ${status}`, ...extra, '---', '', '# Verification', ''].join('\n'));
}

function config(workflow) {
  write('.planning/config.json', JSON.stringify({ workflow }));
}

beforeEach(() => {
  dir = createTempProject();
  phaseDir = path.join(dir, '.planning', 'phases', '03-auth');
  fs.mkdirSync(phaseDir, { recursive: true });
  write('.planning/roadmap.md', '# Roadmap\n\n- [ ] **Phase 3: Auth** - log in\n\n### Phase 3: Auth\n**Goal:** log in\n');
  write('.planning/state.md', '# State\n\n## Current Position\n\nPhase: 3 of 3\nStatus: Executing\n');
  write('.planning/phases/03-auth/03-01-plan.md', '---\nphase: 03-auth\nplan: 01\nwave: 1\nfiles_modified: [src/login.js, tests/login.test.js]\n---\n\n<task>x</task>\n');
  write('.planning/phases/03-auth/03-01-summary.md', '---\nphase: 03-auth\nplan: 01\n---\n\n# Summary\n');
  verification('passed', ['test_gate: passed']);
});
afterEach(() => cleanup(dir));

describe('phase gate — a clean phase passes, and what it cannot check is listed, not refused', () => {
  test('summaries, a passing verification with a passing test gate: ok', () => {
    const g = G.phaseGate(dir, '3');
    assert.equal(g.ok, true, JSON.stringify(g.reasons));
    assert.equal(g.mode, 'enforce', 'enforce is the default since V1E');
    assert.equal(g.facts.plans, '1/1');
    const skipped = g.not_checked.map((n) => n.check).sort();
    assert.deepEqual(skipped, ['freshness', 'stubs', 'test_integrity'], 'no git and no verified_commit here');
  });

  test('a skipped test gate is not checked, never a refusal', () => {
    verification('passed', ['test_gate: skipped']);
    const g = G.phaseGate(dir, '3');
    assert.equal(g.ok, true);
    assert.ok(g.not_checked.some((n) => n.check === 'tests'));
  });

  test('a CRLF verification reads the same', () => {
    const f = path.join(phaseDir, '03-verification.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(/\n/g, '\r\n'));
    assert.equal(G.phaseGate(dir, '3').ok, true);
  });

  test('the verifier switched off: no verification is not checked, not refused', () => {
    fs.rmSync(path.join(phaseDir, '03-verification.md'));
    config({ verifier: false });
    const g = G.phaseGate(dir, '3');
    assert.equal(g.ok, true, JSON.stringify(g.reasons));
    assert.ok(g.not_checked.some((n) => n.check === 'verification'));
  });
});

describe('phase gate — one refusal per reason', () => {
  test('missing_summary', () => {
    fs.rmSync(path.join(phaseDir, '03-01-summary.md'));
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['missing_summary']);
  });

  test('no_verification', () => {
    fs.rmSync(path.join(phaseDir, '03-verification.md'));
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['no_verification']);
  });

  test('verification_failed', () => {
    verification('gaps_found', ['test_gate: passed', 'gaps:', '  - truth: "User can log in"', '    status: failed', '    reason: "no check"']);
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['verification_failed']);
  });

  test('test_failed, with the passed status lowered to gaps (V9)', () => {
    verification('passed', ['test_gate: failed']);
    const g = G.phaseGate(dir, '3');
    assert.deepEqual(codes(g), ['test_failed', 'verification_failed']);
    assert.deepEqual(g.facts.lowered_by, ['test_gate']);
  });

  test('human_needed_unapproved, cleared by a recorded decision', () => {
    verification('human_needed', ['test_gate: passed', 'human_verification:', '  - test: "Log in on a phone"', '    expected: "it works"']);
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['human_needed_unapproved']);
    F.recordVerdict(dir, { phase: '3', text: fs.readFileSync(path.join(phaseDir, '03-verification.md'), 'utf-8') });
    const [human] = F.listFindings(dir, { class: 'human' }).findings;
    F.disposeFindings(dir, { ids: [human.id], as: 'decision', reason: 'logged in on a phone, it works' });
    assert.equal(G.phaseGate(dir, '3').ok, true);
  });

  test('reconcile_contradiction: a claimed pass over a stub artifact', () => {
    write('.planning/phases/03-auth/03-01-plan.md', '---\nphase: 03-auth\nplan: 01\nwave: 1\nmust_haves:\n  truths: []\n  artifacts:\n    - path: "src/login.js"\n      min_lines: 30\n  key_links: []\n---\n\n<task>x</task>\n');
    write('src/login.js', '// one line\n');
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['reconcile_contradiction']);
  });

  test('open_findings: an open high finding, cleared by a disposition', () => {
    const review = `${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '03', verdict: 'NEEDS_FIXES', outcome: 'fail', findings: [{ class: 'defect', severity: 'high', where: 'src/login.js:1', summary: 'login accepts any password' }] })}\n${FENCE}\n`;
    F.recordVerdict(dir, { phase: '3', agent: 'pan-reviewer', text: review });
    const g = G.phaseGate(dir, '3');
    assert.deepEqual(codes(g), ['open_findings']);
    F.disposeFindings(dir, { ids: g.reasons[0].ids, as: 'deferred', reason: 'tracked as ticket 12' });
    assert.equal(G.phaseGate(dir, '3').ok, true);
  });
});

describe('phase gate — the reasons that need git', () => {
  let hasGit = true;
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' }).trim();
  beforeEach(() => {
    try {
      git('init', '-q', '--initial-branch=main');
      git('config', 'user.email', 't@example.com');
      git('config', 'user.name', 'T');
      write('tests/login.test.js', "test('x', () => { assert.equal(f(), 1); });\n");
      write('src/login.js', 'module.exports = () => 1;\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'chore: base');
    } catch { hasGit = false; }
  });

  test('verification_stale: a declared file changed after the verified commit', (t) => {
    if (!hasGit) { t.skip('git unavailable'); return; }
    verification('passed', ['test_gate: passed', `verified_commit: ${git('rev-parse', 'HEAD')}`]);
    write('src/login.js', 'module.exports = () => 2;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'fix: later change');
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['verification_stale']);
  });

  test('stubs_found: a phase commit adds a not-implemented stub', (t) => {
    if (!hasGit) { t.skip('git unavailable'); return; }
    write('src/login.js', "module.exports = () => { throw new Error('not implemented'); };\n");
    git('add', '-A');
    git('commit', '-q', '-m', 'feat(03-01): login');
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['stubs_found']);
  });

  test('integrity_violation: a phase commit deletes a test', (t) => {
    if (!hasGit) { t.skip('git unavailable'); return; }
    git('rm', '-q', 'tests/login.test.js');
    git('commit', '-q', '-m', 'fix(03-01): drop the flaky test');
    assert.deepEqual(codes(G.phaseGate(dir, '3')), ['integrity_violation']);
  });
});

describe('phase complete — the gate decides', () => {
  const roadmapTicked = () => /- \[x\] \*\*Phase 3/.test(fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf-8'));

  test('enforce is the default: with no config, a phase missing a summary is refused', () => {
    fs.rmSync(path.join(phaseDir, '03-01-summary.md'));
    const r = pan('phase', 'complete', '3', '--no-commit');
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'phase_gate_refused');
    assert.equal(roadmapTicked(), false);
    const { buildConfigDefaults } = require('../pan-wizard-core/bin/lib/config.cjs');
    assert.equal(buildConfigDefaults(false, {}).workflow.phase_gate, 'enforce');
    const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'config.json'), 'utf-8'));
    assert.equal(tpl.workflow.phase_gate, 'enforce');
  });

  test('warn (opt-out): completes and carries the reasons', () => {
    config({ phase_gate: 'warn' });
    fs.rmSync(path.join(phaseDir, '03-01-summary.md'));
    const r = pan('phase', 'complete', '3', '--no-commit');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.gate.ok, false);
    assert.equal(out.gate.mode, 'warn');
    assert.deepEqual(out.gate.reasons.map((x) => x.code), ['missing_summary']);
    assert.ok(roadmapTicked());
  });

  test('enforce: refuses with exit 1 and leaves the roadmap alone', () => {
    config({ phase_gate: 'enforce' });
    fs.rmSync(path.join(phaseDir, '03-verification.md'));
    const r = pan('phase', 'complete', '3', '--no-commit');
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error, 'phase_gate_refused');
    assert.match(out.reason, /no_verification/);
    assert.equal(roadmapTicked(), false);
  });

  test('enforce with a clean phase completes', () => {
    config({ phase_gate: 'enforce' });
    const r = pan('phase', 'complete', '3', '--no-commit');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).gate.ok, true);
  });

  test('--force without --reason is refused, even with a clean phase', () => {
    const r = pan('phase', 'complete', '3', '--no-commit', '--force');
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'reason_required');
    assert.equal(roadmapTicked(), false);
  });

  test('--force --reason completes past the gate and records a decision for each open finding', () => {
    config({ phase_gate: 'enforce' });
    const review = `${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '03', verdict: 'NEEDS_FIXES', outcome: 'fail', findings: [{ class: 'risk', severity: 'critical', where: 'src/a.js', summary: 'secrets logged' }] })}\n${FENCE}\n`;
    F.recordVerdict(dir, { phase: '3', agent: 'pan-reviewer', text: review });
    const r = pan('phase', 'complete', '3', '--no-commit', '--force', '--reason', 'hotfix shipped separately');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.gate_override.refused_by, ['open_findings']);
    const [f] = F.listFindings(dir).findings;
    assert.equal(f.status, 'decision');
    assert.match(f.reason, /phase completed past the gate: hotfix shipped separately/);
    assert.ok(roadmapTicked());
  });
});

describe('phase gate — the MCP merge request reports the gate, not the caller', () => {
  const gate = require('../pan-wizard-core/mcp/merge-gate.cjs');

  test('naming a phase: verify_pass is the gate\'s verdict, whatever the caller says', () => {
    fs.rmSync(path.join(phaseDir, '03-verification.md'));
    const refused = gate.requestMerge(dir, { branch: 'pan/phase-3', ci_green: true, verify_pass: true, phase: '3' });
    assert.equal(refused.verify_pass, false, 'the caller claimed a pass; the gate refuses');
    assert.equal(refused.verify_source, 'phase_gate');
    assert.deepEqual(refused.gate.reasons, ['no_verification']);
    verification('passed', ['test_gate: passed']);
    const passed = gate.requestMerge(dir, { branch: 'pan/phase-3', ci_green: true, verify_pass: false, phase: '3' });
    assert.equal(passed.verify_pass, true);
  });

  test('without a phase the caller\'s flag is kept, and labelled as such', () => {
    const r = gate.requestMerge(dir, { branch: 'army/task', ci_green: true, verify_pass: true });
    assert.equal(r.verify_pass, true);
    assert.equal(r.verify_source, 'caller');
  });
});

describe('phase gate — CLI', () => {
  test('exit 0 and "pass" on a clean phase; exit 1 and "refuse" otherwise; --mode overrides config', () => {
    const ok = pan('phase', 'gate', '3', '--raw');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), 'pass');
    fs.rmSync(path.join(phaseDir, '03-verification.md'));
    const bad = pan('phase', 'gate', '3', '--mode', 'enforce');
    assert.equal(bad.status, 1);
    const out = JSON.parse(bad.stdout);
    assert.equal(out.mode, 'enforce');
    assert.deepEqual(out.reasons.map((x) => x.code), ['no_verification']);
  });

  test('an unknown phase is refused', () => {
    assert.equal(G.phaseGate(dir, '9').error, 'phase_not_found');
  });
});

describe('the engine\'s test run is a code fact (V2)', () => {
  const testRun = (status, reason) => write('.planning/phases/03-auth/03-test-run.json', JSON.stringify({ version: 1, kind: 'run', status, reason, command: 'npm test', regressions: status === 'failed' ? ['tests/login.test.js > logs in'] : [] }));

  test('a verification that passes over a failed run is refused: reconcile contradiction, and the pass is lowered', () => {
    testRun('failed', '1 regression(s): failing now, passing at the baseline');
    const g = G.phaseGate(dir, '3');
    assert.equal(g.ok, false);
    assert.ok(codes(g).includes('reconcile_contradiction'), JSON.stringify(g.reasons));
    assert.ok(codes(g).includes('verification_failed'), JSON.stringify(g.reasons));
    assert.equal(g.facts.test_run, 'failed');
    assert.ok(g.facts.lowered_by.includes('test_run'));
  });

  test('a verification that records no test gate takes the run\'s: failed refuses, skipped is not checked', () => {
    verification('passed');
    testRun('failed', 'suite did not run: exit 1');
    assert.ok(codes(G.phaseGate(dir, '3')).includes('test_failed'));
    testRun('skipped', 'no test command');
    const g = G.phaseGate(dir, '3');
    assert.ok(!codes(g).includes('test_failed'));
    assert.ok(g.not_checked.some((n) => n.check === 'tests' && /no test command/.test(n.reason)));
  });

  test('a run that agrees with the verification changes nothing', () => {
    testRun('passed', null);
    const g = G.phaseGate(dir, '3');
    assert.equal(g.ok, true, JSON.stringify(g.reasons));
    assert.equal(g.facts.test_run, 'passed');
  });

  test('the verdict recorder lowers the verifier\'s pass over a failed run', () => {
    testRun('failed', '1 regression(s)');
    const r = F.recordVerdict(dir, { phase: '3', text: fs.readFileSync(path.join(phaseDir, '03-verification.md'), 'utf-8') });
    assert.equal(r.outcome, 'fail');
    assert.deepEqual(r.lowered_by, ['test_run']);
  });
});
