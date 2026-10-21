/**
 * verify-plan-set.cjs — plan checks in code (program V7).
 *
 * Each seeded defect class is caught and a clean set passes: requirement coverage,
 * same-wave file overlap, missing, self and future references, cycles, wave gaps.
 * A plan check is bound to the plans it checked: edited plans read `stale`, a check
 * recorded before hashing reads `legacy` (a warning), no check reads `missing`.
 * Drift lists the planned files that changed since a plan's `planned_commit`.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const P = require('../pan-wizard-core/bin/lib/verify-plan-set.cjs');
const F = require('../pan-wizard-core/bin/lib/findings.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const FENCE = '`'.repeat(3);
let dir;
let phaseDir;

function roadmap(reqs) {
  fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'),
    `# Roadmap\n\n### Phase 3: Auth\n**Goal:** users log in\n**Requirements:** ${reqs.join(', ')}\n`);
}

function plan(id, { wave = 1, deps = [], files = [], reqs = [], planned = null } = {}) {
  const fm = ['---', `phase: 03-auth`, `plan: ${id}`, `wave: ${wave}`, `depends_on: [${deps.map((d) => `"${d}"`).join(', ')}]`,
    `files_modified: [${files.join(', ')}]`, `requirements: [${reqs.join(', ')}]`];
  if (planned) fm.push(`planned_commit: ${planned}`);
  fm.push('---', '', `<objective>plan ${id}</objective>`, '', '<task>do it</task>', '');
  fs.writeFileSync(path.join(phaseDir, `03-${id}-plan.md`), fm.join('\n'));
}

const codes = (r) => r.errors.map((e) => e.code).sort();

function checkerReport(verdict, outcome) {
  return `## VERIFICATION PASSED\n\n${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-plan-checker', phase: '03', verdict, outcome, findings: outcome === 'fail' ? [{ class: 'missing', severity: 'high', where: '03-01-plan.md', summary: 'AUTH-02 has no task' }] : [] })}\n${FENCE}\n`;
}

beforeEach(() => {
  dir = createTempProject();
  phaseDir = path.join(dir, '.planning', 'phases', '03-auth');
  fs.mkdirSync(phaseDir, { recursive: true });
  roadmap(['AUTH-01', 'AUTH-02']);
});
afterEach(() => cleanup(dir));

describe('verify plan-set — each defect class is caught', () => {
  test('a clean set passes', () => {
    plan('01', { files: ['src/login.ts'], reqs: ['AUTH-01'] });
    plan('02', { files: ['src/session.ts'], reqs: ['AUTH-02'] });
    plan('03', { wave: 2, deps: ['01', '02'], files: ['src/login.ts'] });
    const r = P.checkPlanSet(dir, '3');
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.warnings, []);
    assert.equal(r.plans, 3);
  });

  test('a roadmap requirement no plan lists', () => {
    plan('01', { files: ['src/login.ts'], reqs: ['AUTH-01'] });
    const r = P.checkPlanSet(dir, '3');
    assert.deepEqual(codes(r), ['uncovered_requirement']);
    assert.equal(r.errors[0].requirement, 'AUTH-02');
  });

  test('a plan requirement the roadmap does not give the phase is a warning', () => {
    plan('01', { reqs: ['AUTH-01', 'AUTH-02', 'BILL-01'] });
    const r = P.checkPlanSet(dir, '3');
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings.map((w) => w.code), ['unknown_requirement']);
  });

  test('two plans in one wave editing one file, with no dependency', () => {
    plan('01', { files: ['src/login.ts', 'src/a.ts'], reqs: ['AUTH-01'] });
    plan('02', { files: ['./src/login.ts'], reqs: ['AUTH-02'] });
    const r = P.checkPlanSet(dir, '3');
    assert.deepEqual(codes(r), ['same_wave_overlap']);
    assert.deepEqual(r.errors[0].files, ['src/login.ts']);
  });

  test('the same file across waves with a dependency is allowed', () => {
    plan('01', { files: ['src/login.ts'], reqs: ['AUTH-01', 'AUTH-02'] });
    plan('02', { wave: 2, deps: ['01'], files: ['src/login.ts'] });
    assert.equal(P.checkPlanSet(dir, '3').ok, true);
  });

  test('a dependency that names no plan, and a plan that depends on itself', () => {
    plan('01', { reqs: ['AUTH-01', 'AUTH-02'], deps: ['07'] });
    plan('02', { wave: 2, deps: ['02'] });
    assert.deepEqual(codes(P.checkPlanSet(dir, '3')), ['missing_reference', 'self_reference']);
  });

  test('a dependency in the same or a later wave', () => {
    plan('01', { reqs: ['AUTH-01', 'AUTH-02'], deps: ['02'] });
    plan('02', { wave: 1 });
    const r = P.checkPlanSet(dir, '3');
    assert.deepEqual(codes(r), ['future_reference']);
  });

  test('a dependency cycle is reported once', () => {
    plan('01', { wave: 1, reqs: ['AUTH-01', 'AUTH-02'], deps: ['03'] });
    plan('02', { wave: 2, deps: ['01'] });
    plan('03', { wave: 3, deps: ['02'] });
    const r = P.checkPlanSet(dir, '3');
    assert.equal(r.errors.filter((e) => e.code === 'cycle').length, 1);
    assert.ok(codes(r).includes('future_reference'), 'the back edge is also an earlier-wave violation');
  });

  test('a wave later than its dependencies need is a warning', () => {
    plan('01', { reqs: ['AUTH-01', 'AUTH-02'] });
    plan('02', { wave: 3, deps: ['01'] });
    const r = P.checkPlanSet(dir, '3');
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings.map((w) => w.code), ['wave_gap']);
  });

  test('a dependency on another phase\'s plan is not this set\'s to check', () => {
    plan('01', { reqs: ['AUTH-01', 'AUTH-02'], deps: ['02-04'] });
    assert.equal(P.checkPlanSet(dir, '3').ok, true);
  });

  test('refusals: unknown phase, no plans', () => {
    assert.equal(P.checkPlanSet(dir, '9').error, 'phase_not_found');
    assert.equal(P.checkPlanSet(dir, '3').error, 'no_plans');
  });
});

describe('verify plan-set — the plan check is bound to the plans it checked', () => {
  beforeEach(() => {
    plan('01', { files: ['src/login.ts'], reqs: ['AUTH-01', 'AUTH-02'] });
  });

  test('no check at all reads missing; a failed check reads failed', () => {
    assert.equal(P.planCheckStatus(dir, '3').status, 'missing');
    F.recordVerdict(dir, { phase: '3', agent: 'pan-plan-checker', text: checkerReport('issues_found', 'fail') });
    assert.equal(P.planCheckStatus(dir, '3').status, 'failed');
  });

  test('a passing check records the plans hash and reads ok until a plan is edited', () => {
    F.recordVerdict(dir, { phase: '3', agent: 'pan-plan-checker', text: checkerReport('passed', 'pass') });
    const row = F.readLedger(dir).rows.find((r) => r.kind === 'verdict');
    assert.match(row.plans_sha, /^[0-9a-f]{16}$/);
    assert.equal(P.planCheckStatus(dir, '3').status, 'ok');
    plan('01', { files: ['src/login.ts', 'src/extra.ts'], reqs: ['AUTH-01', 'AUTH-02'] });
    const s = P.planCheckStatus(dir, '3');
    assert.equal(s.status, 'stale');
    assert.notEqual(s.checked_sha, s.plans_sha);
  });

  test('a line-ending change alone is not an edit', () => {
    F.recordVerdict(dir, { phase: '3', agent: 'pan-plan-checker', text: checkerReport('passed', 'pass') });
    const f = path.join(phaseDir, '03-01-plan.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(/\n/g, '\r\n'));
    assert.equal(P.planCheckStatus(dir, '3').status, 'ok');
  });

  test('a check recorded before plans were hashed reads legacy, a warning', () => {
    F.recordVerdict(dir, { phase: '3', agent: 'pan-plan-checker', text: checkerReport('passed', 'pass') });
    const ledger = path.join(dir, '.planning', F.FINDINGS_FILE);
    const rows = fs.readFileSync(ledger, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    for (const r of rows) delete r.plans_sha;
    fs.writeFileSync(ledger, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    assert.equal(P.planCheckStatus(dir, '3').status, 'legacy');
  });

  test('plan checking switched off reads disabled', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ workflow: { plan_check: false } }));
    assert.equal(P.planCheckStatus(dir, '3').status, 'disabled');
  });

  test('init execute-phase carries the plan check status', () => {
    const r = spawnSync(process.execPath, [TOOLS_PATH, 'init', 'execute-phase', '3'], { cwd: dir, encoding: 'utf-8' });
    const init = JSON.parse(r.stdout);
    assert.equal(init.plan_check.status, 'missing');
    assert.deepEqual(init.plan_drift, []);
  });
});

describe('verify plan-set — drift since planned_commit', () => {
  test('lists the planned files that changed on the branch since the plan was written', (t) => {
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' }).trim();
    try {
      git('init', '-q', '--initial-branch=main');
      git('config', 'user.email', 't@example.com');
      git('config', 'user.name', 'T');
    } catch { t.skip('git unavailable'); return; }
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'login.ts'), 'v1');
    fs.writeFileSync(path.join(dir, 'src', 'other.ts'), 'v1');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    plan('01', { files: ['src/login.ts', 'src/other.ts'], reqs: ['AUTH-01', 'AUTH-02'], planned: base });
    fs.writeFileSync(path.join(dir, 'src', 'login.ts'), 'v2');
    git('add', 'src/login.ts');
    git('commit', '-q', '-m', 'someone changed login');
    assert.deepEqual(P.planDrift(dir, '3'), [{ plan: '03-01', planned_commit: base, files: ['src/login.ts'] }]);
  });
});

describe('verify plan-set — CLI', () => {
  test('exit 1 with the errors on a broken set, exit 0 on a clean one', () => {
    plan('01', { files: ['src/login.ts'], reqs: ['AUTH-01'] });
    const bad = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'plan-set', '3'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(bad.status, 1, bad.stderr);
    assert.deepEqual(JSON.parse(bad.stdout).errors.map((e) => e.code), ['uncovered_requirement']);
    plan('02', { files: ['src/s.ts'], reqs: ['AUTH-02'] });
    const good = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'plan-set', '3', '--raw'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stdout.trim(), 'valid');
  });
});

// ── Property tasks for validation-rule truths (program V10) ─────────────────────
// An EARS criterion that is a validation rule (IF … THEN … SHALL, or a "for any /
// every / all / never" claim) is a claim over many inputs: one example test cannot
// show it. The plan that covers such a requirement must carry a property-test task.
describe('verify plan-set: a validation-rule truth needs a property task (V10)', () => {
  const reqs = (criterion) => fs.writeFileSync(path.join(dir, '.planning', 'requirements.md'),
    `# Requirements\n\n## v1 Requirements\n\n- [ ] **AUTH-01**: Passwords are validated\n  - ${criterion}\n- [ ] **AUTH-02**: User can log out\n  - WHEN a user logs out THE SYSTEM SHALL end the session\n`);
  const planWith = (id, task) => {
    const fm = ['---', 'phase: 03-auth', `plan: ${id}`, 'wave: 1', 'depends_on: []', 'files_modified: [src/a.ts]', 'requirements: [AUTH-01, AUTH-02]', '---', '', `<objective>plan ${id}</objective>`, '', task, ''];
    fs.writeFileSync(path.join(phaseDir, `03-${id}-plan.md`), fm.join('\n'));
  };

  test('a validation rule with no property task is an error naming the requirement', () => {
    roadmap(['AUTH-01', 'AUTH-02']);
    reqs('IF a password is shorter than 12 characters THEN THE SYSTEM SHALL reject it');
    planWith('01', '<task type="auto"><name>Validate passwords</name><action>add the check</action></task>');
    const r = P.checkPlanSet(dir, '3');
    assert.deepEqual(r.errors.filter((e) => e.code === 'missing_property_task').map((e) => e.requirement), ['AUTH-01']);
  });

  test('a property task covers it; an event criterion (WHEN … SHALL) needs none', () => {
    roadmap(['AUTH-01', 'AUTH-02']);
    reqs('THE SYSTEM SHALL reject every password shorter than 12 characters');
    planWith('01', '<task type="auto" property="true"><name>Property test: any short password is rejected</name><action>generate passwords of length 0-11 with the project\'s property library</action></task>');
    assert.deepEqual(codes(P.checkPlanSet(dir, '3')).filter((c) => c === 'missing_property_task'), []);
  });

  test('no requirements file, or no validation rule, adds nothing', () => {
    roadmap(['AUTH-01']);
    planWith('01', '<task><name>x</name></task>');
    assert.deepEqual(codes(P.checkPlanSet(dir, '3')).filter((c) => c === 'missing_property_task'), []);
  });
});
