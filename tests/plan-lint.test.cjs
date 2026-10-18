/**
 * plan-lint.cjs — plan intent checked in code.
 *
 * `verify review-focus` (program P4, M41): every plan carries a `## Review Focus`
 * section naming at most five inputs or failure modes the requirements imply and no
 * test covers yet, each pinned to the task that owns the code and the test it adds,
 * or one `None —` line with the reason.
 *
 * `verify decisions` (program P2): the design's decisions carry ids (`DD-N`); a plan
 * citing an id the design does not record, and a decision no plan cites, are errors.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../pan-wizard-core/bin/lib/plan-lint.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
let phaseDir;

const TASKS = '<tasks>\n<task type="auto">\n  <name>Task 1: Parse input</name>\n</task>\n<task type="auto">\n  <name>Task 2: Store result</name>\n</task>\n</tasks>\n';

function plan(id, body) {
  const fm = ['---', 'phase: 03-auth', `plan: ${id}`, 'wave: 1', 'depends_on: []', 'files_modified: []', 'requirements: []', '---', '', `<objective>plan ${id}</objective>`, ''];
  fs.writeFileSync(path.join(phaseDir, `03-${id}-plan.md`), fm.join('\n') + body + '\n' + TASKS);
}

function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '').trim() };
  }
}

const codes = (r) => r.errors.map((e) => e.code).sort();

beforeEach(() => {
  dir = createTempProject();
  phaseDir = path.join(dir, '.planning', 'phases', '03-auth');
  fs.mkdirSync(phaseDir, { recursive: true });
});
afterEach(() => cleanup(dir));

describe('verify review-focus (P4)', () => {
  test('a plan without the section is refused', () => {
    plan('01', '## Plan Decisions\n\nNo decisions worth documenting.\n');
    const r = L.checkReviewFocus(dir, '3');
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r), ['review_focus_missing']);
    assert.equal(r.errors[0].plan, '03-01');
  });

  test('items pinned to a task and a test pass; the None line with a reason passes', () => {
    plan('01', '## Review Focus\n\n- RF-1: an empty body. Test: Task 1 adds `rejects an empty body`.\n- RF-2: a duplicate id on store. Test: Task 2 adds `refuses a duplicate`.\n');
    plan('02', '## Review Focus\n\nNone — every input the requirements imply already has a test in Task 1.\n');
    const r = L.checkReviewFocus(dir, '3');
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.plans.map((p) => [p.plan, p.status, p.items]), [['03-01', 'ok', 2], ['03-02', 'none', 0]]);
  });

  test('an item with no owning task, a task the plan does not have, or no test is an error', () => {
    plan('01', '## Review Focus\n\n- RF-1: an empty body. Test: rejects an empty body.\n- RF-2: unicode names. Test: Task 7 adds a case.\n- RF-3: a slow disk. Owned by Task 2.\n');
    const r = L.checkReviewFocus(dir, '3');
    assert.deepEqual(codes(r), ['review_focus_no_task', 'review_focus_no_test', 'review_focus_unknown_task']);
  });

  test('more than five items, an empty section and a bare None are errors', () => {
    const six = Array.from({ length: 6 }, (_, i) => `- RF-${i + 1}: case ${i}. Test: Task 1 adds it.`).join('\n');
    plan('01', `## Review Focus\n\n${six}\n`);
    plan('02', '## Review Focus\n\n<!-- nothing yet -->\n');
    plan('03', '## Review Focus\n\nNone\n');
    assert.deepEqual(codes(L.checkReviewFocus(dir, '3')), ['review_focus_empty', 'review_focus_empty', 'review_focus_too_many']);
  });

  test('comments are stripped whole: one that re-forms after a pass, or never closes, hides what it holds', () => {
    plan('01', '## Review Focus\n\n<!<!-- a -->-- - RF-1: hidden. Test: Task 1 adds it. -->\n');
    plan('02', '## Review Focus\n\n<!-- left open\n- RF-1: hidden. Test: Task 1 adds it.\n');
    const r = L.checkReviewFocus(dir, '3');
    assert.deepEqual(r.plans.map((p) => [p.plan, p.status]), [['03-01', 'invalid'], ['03-02', 'invalid']]);
    assert.deepEqual(codes(r), ['review_focus_empty', 'review_focus_empty']);
  });

  test('CLI: exit 1 and `invalid` on a refused set, exit 0 and `valid` on a good one', () => {
    plan('01', '');
    const bad = cli(['verify', 'review-focus', '3', '--raw']);
    assert.deepEqual([bad.code, bad.out], [1, 'invalid']);
    plan('01', '## Review Focus\n\nNone — the plan only renames a constant; existing tests cover it.\n');
    const good = cli(['verify', 'review-focus', '3']);
    assert.equal(good.code, 0, good.out);
    assert.equal(JSON.parse(good.out).ok, true);
    assert.equal(JSON.parse(cli(['verify', 'review-focus', '9']).out).error, 'phase_not_found');
  });
});

describe('verify decisions (P2)', () => {
  function design(rows) {
    const table = ['| ID | Decision | Chosen | Alternative rejected | Rationale |', '|----|----------|--------|----------------------|-----------|', ...rows.map((id) => `| ${id} | point | what | alt | why |`)];
    fs.writeFileSync(path.join(phaseDir, '03-design.md'), `# Phase 3: Auth — Design\n\n**Design decisions:**\n${table.join('\n')}\n`);
  }

  test('no design is nothing to check', () => {
    plan('01', '');
    const r = L.checkDecisions(dir, '3');
    assert.deepEqual([r.ok, r.status], [true, 'no_design']);
  });

  test('a design whose decisions carry no ids is legacy: a warning, never a refusal', () => {
    fs.writeFileSync(path.join(phaseDir, '03-design.md'), '| Decision | Chosen |\n|---|---|\n| store | sqlite |\n');
    plan('01', '');
    const r = L.checkDecisions(dir, '3');
    assert.deepEqual([r.ok, r.status, r.warnings.length], [true, 'legacy', 1]);
  });

  test('every decision cited and every citation recorded passes', () => {
    design(['DD-1', 'DD-2']);
    plan('01', '## Plan Decisions\n\n### Locked\n- D-1: use sqlite. Source: design DD-1.\n');
    plan('02', 'Implements DD-2 and DD-1.\n');
    const r = L.checkDecisions(dir, '3');
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.decisions, ['DD-1', 'DD-2']);
    assert.deepEqual(r.cited, { 'DD-1': ['03-01', '03-02'], 'DD-2': ['03-02'] });
  });

  test('a plan citing a missing decision id is flagged', () => {
    design(['DD-1']);
    plan('01', 'Source: DD-1 and DD-4.\n');
    const r = L.checkDecisions(dir, '3');
    assert.deepEqual(codes(r), ['decision_unrecorded']);
    assert.deepEqual([r.errors[0].plan, r.errors[0].id], ['03-01', 'DD-4']);
  });

  test('a decision no plan cites is flagged, and so is an id recorded twice', () => {
    design(['DD-1', 'DD-2', 'DD-2']);
    plan('01', 'Source: DD-1.\n');
    const r = L.checkDecisions(dir, '3');
    assert.deepEqual(codes(r), ['decision_duplicate', 'decision_uncited']);
    assert.equal(r.errors.find((e) => e.code === 'decision_uncited').id, 'DD-2');
  });

  test('CLI: exit 1 and `invalid` on a flagged set', () => {
    design(['DD-1']);
    plan('01', 'nothing cited\n');
    const r = cli(['verify', 'decisions', '3', '--raw']);
    assert.deepEqual([r.code, r.out], [1, 'invalid']);
  });
});
