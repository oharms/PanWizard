/**
 * Right-sized ceremony (sizing.cjs, 2026-10-24). Measured: on precisely specified work PAN
 * spent about 70% of its cost and time on planning ceremony, against a bare host that
 * finished correctly for about a thirtieth of the cost (docs/specs/right-sized-ceremony.md).
 * The engine now sizes each phase and quick task: a small, well-specified one takes the
 * lean path; the `quality` profile, `workflow.ceremony: full` and `--quality` keep the
 * full ceremony.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const S = require('../pan-wizard-core/bin/lib/sizing.cjs');
const { planStructure } = require('../pan-wizard-core/bin/lib/verify.cjs');
const { planCheckStatus } = require('../pan-wizard-core/bin/lib/verify-plan-set.cjs');
const { TOOLS_PATH, cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const dirs = [];
afterEach(() => { while (dirs.length) cleanup(dirs.pop()); });

function seed(name, config) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-sizing-'));
  dirs.push(t);
  fs.cpSync(path.join(ROOT, 'harness', 'seeds', name), t, { recursive: true });
  if (config) {
    const f = path.join(t, '.planning', 'config.json');
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify(config(c), null, 2));
  }
  return t;
}
const cli = (cwd, args) => spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd, encoding: 'utf8' });

describe('what counts as precisely specified', () => {
  test('a requirement with an acceptance criterion, or naming an artifact with enough detail', () => {
    assert.equal(S.requirementSpecified({ text: 'User can sign in', criteria: ['WHEN x THE SYSTEM SHALL y'] }), true);
    assert.equal(S.requirementSpecified({ text: '`src/store.js` exports `createStore(file)` and every change is written to the file at once', criteria: [] }), true);
    assert.equal(S.requirementSpecified({ text: 'Invoice totals, covered by tests. (Done.)', criteria: [] }), false);
    assert.equal(S.requirementSpecified({ text: 'User can log in', criteria: [] }), false);
  });
  test('a quick task names what to build and how to check it', () => {
    assert.equal(S.taskSpecified('add src/shout.js exporting shout(name) that returns the upper-cased greeting HELLO, <NAME>! with a node --test test in tests/shout.test.js').specified, true);
    const vague = S.taskSpecified('make the app faster');
    assert.equal(vague.specified, false);
    assert.ok(vague.reasons.length >= 2, JSON.stringify(vague));
  });
});

describe('sizing a phase', () => {
  test('the H10 roadmap seed: both phases are small and precisely specified, so lean', () => {
    const t = seed('tasks-roadmap');
    assert.equal(S.sizePhase(t, '1').path, 'lean');
    assert.equal(S.sizePhase(t, '2').path, 'lean');
  });
  test('a phase with no mapped requirements, or vague ones, stays full', () => {
    const t = seed('two-plan-phase');
    assert.equal(S.sizePhase(t, '2').path, 'full', 'no requirements mapped');
    const r = S.sizePhase(t, '1');
    assert.equal(r.path, 'full');
    assert.match(r.reasons.join(' '), /not precisely specified/);
  });
  test('more requirements than workflow.lean_max_requirements is full', () => {
    const t = seed('tasks-roadmap', (c) => ({ ...c, workflow: { ...c.workflow, lean_max_requirements: 3 } }));
    assert.equal(S.sizePhase(t, '1').path, 'full');
    assert.equal(S.sizePhase(t, '2').path, 'lean');
  });
  test('the quality profile, workflow.ceremony full and --quality keep the full ceremony', () => {
    assert.equal(S.sizePhase(seed('tasks-roadmap', (c) => ({ ...c, model_profile: 'quality' })), '1').path, 'full');
    assert.equal(S.sizePhase(seed('tasks-roadmap', (c) => ({ ...c, workflow: { ...c.workflow, ceremony: 'full' } })), '1').path, 'full');
    const t = seed('tasks-roadmap');
    const q = S.sizePhase(t, '1', { quality: true });
    assert.deepEqual([q.path, q.mode], ['full', 'full']);
    assert.equal(S.sizePhase(t, '1', { full: true }).path, 'full');
  });
  test('CLI: size phase prints the path; --quality forces full', () => {
    const t = seed('tasks-roadmap');
    assert.deepEqual([cli(t, ['size', 'phase', '1', '--raw']).stdout.trim(), cli(t, ['size', 'phase', '1', '--quality', '--raw']).stdout.trim()], ['lean', 'full']);
    assert.equal(JSON.parse(cli(t, ['size', 'phase', '2']).stdout).metrics.requirements, 3);
  });
});

describe('the lean quick task', () => {
  test('CLI: size task sizes the description; the engine writes a valid one-task plan', () => {
    const t = seed('two-plan-phase');
    const desc = 'add src/shout.js exporting shout(name) that returns the upper-cased greeting HELLO, <NAME>! with a node --test test in tests/shout.test.js';
    assert.equal(cli(t, ['size', 'task', desc, '--raw']).stdout.trim(), 'lean');
    assert.equal(cli(t, ['size', 'task', desc, '--full', '--raw']).stdout.trim(), 'full');
    assert.equal(cli(t, ['size', 'task', 'make it faster', '--raw']).stdout.trim(), 'full');
    const r = cli(t, ['size', 'quick-plan', '--out', '.planning/quick/1-shout/1-plan.md', '--num', '1', desc]);
    assert.equal(r.status, 0, r.stderr);
    const plan = fs.readFileSync(path.join(t, '.planning', 'quick', '1-shout', '1-plan.md'), 'utf8');
    const st = planStructure(plan);
    assert.deepEqual([st.valid, st.task_count], [true, 1], JSON.stringify(st.errors));
    assert.match(plan, /files_modified: \[src\/shout\.js, tests\/shout\.test\.js\]/);
    assert.match(plan, /<name>add src\/shout\.js exporting shout\(name\)/, 'the name is not cut at the dot in a file name');
  });
});

describe('the engine plan check (lean path)', () => {
  test('passing plans are recorded as the phase plan check, so exec-phase accepts them', () => {
    const t = seed('two-plan-phase', (c) => ({ ...c, workflow: { ...c.workflow, plan_check: true } }));
    assert.equal(planCheckStatus(t, '1').status, 'missing');
    const r = cli(t, ['size', 'plan-check', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([JSON.parse(r.stdout).ok, JSON.parse(r.stdout).recorded], [true, true]);
    assert.equal(planCheckStatus(t, '1').status, 'ok');
  });
  test('a broken plan fails the check and records nothing', () => {
    const t = seed('two-plan-phase', (c) => ({ ...c, workflow: { ...c.workflow, plan_check: true } }));
    const dir = path.join(t, '.planning', 'phases', fs.readdirSync(path.join(t, '.planning', 'phases'))[0]);
    const plan = fs.readdirSync(dir).find((f) => /-plan\.md$/.test(f));
    fs.writeFileSync(path.join(dir, plan), fs.readFileSync(path.join(dir, plan), 'utf8').replace(/^wave:.*$/m, ''));
    const r = cli(t, ['size', 'plan-check', '1']);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).ok, false);
    assert.equal(planCheckStatus(t, '1').status, 'missing');
  });
  test('size with no subcommand is a usage error', () => {
    assert.equal(cli(os.tmpdir(), ['size', 'nope']).status, 1);
  });
});

describe('the balanced profile runs the plan-checker and researchers on the mid tier', () => {
  const { MODEL_PROFILES } = require('../pan-wizard-core/bin/lib/core.cjs');
  test('balanced: mid; quality: reasoning (the old behaviour)', () => {
    for (const a of ['pan-plan-checker', 'pan-phase-researcher', 'pan-project-researcher']) {
      assert.deepEqual([MODEL_PROFILES[a].balanced, MODEL_PROFILES[a].quality], ['mid', 'reasoning'], a);
    }
    assert.equal(MODEL_PROFILES['pan-planner'].balanced, 'reasoning', 'the planner and executor stay on the launch model');
    assert.equal(MODEL_PROFILES['pan-executor'].balanced, 'reasoning');
  });
});

describe('autodev passes --quality to every unit', () => {
  const { unitPrompt } = require('../pan-wizard-core/bin/lib/autodev.cjs');
  test('a quality unit names --quality; a default one does not', () => {
    assert.match(unitPrompt('claude', { action: 'plan', phase: '2', quality: true }), /\/pan:plan-phase 2 --quality /);
    assert.doesNotMatch(unitPrompt('claude', { action: 'plan', phase: '2' }), /--quality/);
  });
});

describe('step 2: the engine plans a lean phase (no planner session)', () => {
  function gitSeed(name) {
    const t = seed(name);
    const g = (a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: t, encoding: 'utf8' });
    g(['init', '-q']); g(['config', 'user.name', 't']); g(['config', 'user.email', 't@t']); g(['add', '-A']); g(['commit', '-qm', 'seed']);
    return { t, g };
  }
  test('size phase-plan writes one task per requirement, records the plan check and commits the plan', () => {
    const { t, g } = gitSeed('tasks-roadmap');
    const r = cli(t, ['size', 'phase-plan', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual([out.ok, out.plan_check, out.requirements], [true, 'recorded', ['STORE-01', 'STORE-02', 'STORE-03', 'STORE-04']]);
    const plan = fs.readFileSync(path.join(t, out.path), 'utf8');
    const st = planStructure(plan);
    assert.deepEqual([st.valid, st.task_count], [true, 4], JSON.stringify(st.errors));
    assert.match(plan, /<name>STORE-02: Every change is written/, 'the requirement text, without its leading dash');
    assert.equal(planCheckStatus(t, '1').status, 'ok');
    assert.match(g(['log', '--oneline', '-1']).stdout, /lean plan written by the engine/);
  });
  test('a phase that already has plans, or is not lean, is declined (exit 1) and nothing is written', () => {
    const { t } = gitSeed('tasks-roadmap');
    assert.equal(cli(t, ['size', 'phase-plan', '1']).status, 0);
    const again = cli(t, ['size', 'phase-plan', '1']);
    assert.deepEqual([again.status, JSON.parse(again.stdout).error], [1, 'has_plans']);
    const q = cli(t, ['size', 'phase-plan', '2', '--quality']);
    assert.deepEqual([q.status, JSON.parse(q.stdout).error], [1, 'not_lean']);
    assert.equal(fs.readdirSync(path.join(t, '.planning', 'phases')).length, 1, 'no phase 2 directory');
  });
  test('autodev: a lean plan unit runs in the engine at $0, with no host session', () => {
    const { t } = gitSeed('tasks-roadmap');
    const { executeUnit } = require('../pan-wizard-core/bin/lib/autodev.cjs');
    const res = executeUnit(t, { action: 'plan', phase: '1' }, 'claude', {});
    assert.deepEqual([res.exit, res.cost_usd, res.engine, res.argv], [0, 0, true, ['size', 'phase-plan', '1']]);
    assert.equal(planCheckStatus(t, '1').status, 'ok');
  });
});

describe('a later requirement supersedes earlier tests (2026-10-24 false stop)', () => {
  const A = require('../pan-wizard-core/bin/lib/autodev.cjs');
  test('the engine declares the existing tests a behaviour-changing requirement supersedes', () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-sup-'));
    dirs.push(t);
    fs.cpSync(path.join(ROOT, 'tests', 'fixtures', 'h10-ledger', 'reference'), t, { recursive: true });
    fs.cpSync(path.join(ROOT, 'harness', 'seeds', 'ledger-roadmap', '.planning'), path.join(t, '.planning'), { recursive: true });
    const g = (a) => spawnSync('git', a, { cwd: t, encoding: 'utf8' });
    g(['init', '-q']); g(['config', 'user.name', 't']); g(['config', 'user.email', 't@t']); g(['add', '-A']); g(['commit', '-qm', 'x']);
    const r = cli(t, ['size', 'phase-plan', '5']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.supersedes_tests, ['tests/ledger.test.js']);
    const plan = fs.readFileSync(path.join(t, out.path), 'utf8');
    assert.match(plan, /^files_modified: \[.*tests\/ledger\.test\.js.*\]$/m, 'declared, so the executor may update it');
    assert.match(plan, /^supersedes_requirements: \[CENTS-/m);
    assert.match(plan, /update those expectations to what CENTS-\d+ requires and record each change as a deviation/);
    assert.equal(planStructure(plan).valid, true);
  });
  test('a phase that changes nothing already built declares no superseded tests', () => {
    const t = seed('tasks-roadmap');
    const g = (a) => spawnSync('git', a, { cwd: t, encoding: 'utf8' });
    g(['init', '-q']); g(['config', 'user.name', 't']); g(['config', 'user.email', 't@t']); g(['add', '-A']); g(['commit', '-qm', 'x']);
    const out = JSON.parse(cli(t, ['size', 'phase-plan', '1']).stdout);
    assert.equal(out.supersedes_tests, undefined);
  });
  test('exec-phase hands a plan\'s superseded tests to its executor', () => {
    const s = fs.readFileSync(path.join(ROOT, 'pan-wizard-core', 'workflows', 'exec-phase.md'), 'utf8');
    assert.match(s, /<superseded_tests>[\s\S]*not a spec conflict[\s\S]*<\/superseded_tests>/);
  });
  test('blockedReport reads an executor\'s spec conflict from the session result', () => {
    const json = JSON.stringify({ type: 'result', result: 'Phase 5 is not finished.\n## BLOCKED_SPEC_CONFLICT\n**Test:** tests/a.test.js:3', total_cost_usd: 1 });
    assert.match(A.blockedReport(json), /^BLOCKED_SPEC_CONFLICT/);
    assert.equal(A.blockedReport(JSON.stringify({ result: 'all done', total_cost_usd: 1 })), null);
  });
  test('autodev stops with human_needed, not no_progress, when a unit is blocked on a ruling', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-blk-'));
    dirs.push(dir);
    const p = path.join(dir, '.planning');
    fs.mkdirSync(path.join(p, 'phases', '01-login'), { recursive: true });
    fs.writeFileSync(path.join(p, 'project.md'), '# P\n');
    fs.writeFileSync(path.join(p, 'requirements.md'), '# R\n');
    fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: 'warn' } }));
    fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n- [ ] **Phase 1: Login**\n\n### Phase 1: Login\n**Goal:** users sign in\n**Requirements**: AUTH-01\n');
    const execute = (cwd, unit) => {
      if (unit.action === 'plan') fs.writeFileSync(path.join(p, 'phases', '01-login', '01-01-plan.md'), '---\nphase: 01\n---\n');
      return { exit: 0, cost_usd: 0.1, argv: ['-p', 'sim'], duration_ms: 1, blocked: unit.action === 'execute' ? 'BLOCKED_SPEC_CONFLICT Test: tests/a.test.js' : undefined };
    };
    const r = A.runAutodev(dir, { host: 'claude', execute, maxUsd: 5 });
    assert.equal(r.stop.reason, 'human_needed', JSON.stringify(r.stop));
    assert.match(r.stop.detail, /execute:1 is blocked on a ruling: BLOCKED_SPEC_CONFLICT/);
  });
});
