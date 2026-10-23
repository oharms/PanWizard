/**
 * The paid evidence steps as harness scenarios (V6, P1, R4, H6), proven model-free.
 *
 * Each live scenario spends only on the owner's approval. What can be shown at $0 is shown
 * here: the review seed plus its overlay gives the engine a base and a real diff (a
 * single-commit seed gives a reviewer no `diff --git`); the scripts the scenarios end with
 * read what they claim (question count, quick-task record, lane record); the scenarios have
 * the shape the program asks for; and the run state goes to the test directory this machine has.
 */
'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const SCEN = path.join(ROOT, 'harness', 'scenarios');
const scenario = (id) => JSON.parse(fs.readFileSync(path.join(SCEN, `${id}.json`), 'utf8'));
const { applyOverlay } = require('../harness/scripts/apply-overlay.cjs');
const { questionLines, repOf, countQuestions } = require('../harness/scripts/count-questions.cjs');
const { quickTaskRecord } = require('../harness/scripts/quick-task-recorded.cjs');
const { laneRecord } = require('../harness/scripts/cross-family-lane.cjs');
const { defaultStateDir } = require('../harness/src/run.cjs');

function seededRepo(seed) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `pan-evid-${seed}-`));
  fs.cpSync(path.join(ROOT, 'harness', 'seeds', seed), ws, { recursive: true });
  const git = (args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: ws, encoding: 'utf8' });
  git(['init', '-q']); git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  return ws;
}
const pan = (ws, args) => spawnSync(process.execPath, [TOOLS, ...args, '--cwd', ws], { encoding: 'utf8', env: { ...process.env, PAN_PROJECT_ROOT: '' } });

describe('review-target + its overlay: a phase with a base and a real diff (V6, R4)', () => {
  let ws;
  before(() => { ws = seededRepo('review-target'); });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  test('without the overlay there is nothing to review', () => {
    const r = JSON.parse(pan(ws, ['review', 'cross-family', '1', '--host', 'copilot', '--dry-run']).stdout);
    assert.doesNotMatch(r.prompt, /diff --git/);
  });

  test('the overlay lands as feat(01-01) and docs(01-01) commits, and the lane prompt carries the diff', () => {
    const a = applyOverlay(ws, path.join(ROOT, 'harness', 'overlays', 'review-target-phase1'));
    assert.equal(a.applied, true, JSON.stringify(a));
    assert.deepEqual(a.commits.map((c) => c.subject), ['feat(01-01): add cartTotal with bulk and code discounts', 'docs(01-01): complete cart total plan']);
    const scope = JSON.parse(pan(ws, ['review', 'scope', '1']).stdout);
    assert.match(scope.base || '', /^[0-9a-f]{40}$/);
    assert.ok(scope.files.some((f) => f.path === 'src/cart.js'), JSON.stringify(scope.files));
    const r = JSON.parse(pan(ws, ['review', 'cross-family', '1', '--host', 'copilot', '--dry-run']).stdout);
    assert.equal(r.lane, 'cross-family:copilot');
    assert.match(r.prompt, /diff --git a\/src\/cart\.js/);
    assert.match(r.prompt, /count > BULK_THRESHOLD/, 'the seeded off-by-one is in the diff');
  });

  test("the phase's own tests pass: the seeded defects are a reviewer's job, not the suite's", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync('npm', ['test', '--silent'], { cwd: ws, env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000 });
    assert.equal(r.status, 0, String(r.stdout) + String(r.stderr));
  });

  test('the engine reads a churn figure once reviews are recorded', () => {
    const verdict = (ids) => `# Review\n\n\u0060\u0060\u0060pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '01', verdict: 'NEEDS_FIXES', outcome: 'fail', findings: ids.map((s) => ({ class: 'defect', severity: 'high', where: `src/cart.js:${s.line}`, summary: s.summary })) })}\n\u0060\u0060\u0060\n`;
    const file = path.join(ws, '.planning', 'phases', '01-cart-total', '01-review.md');
    fs.writeFileSync(file, verdict([{ line: 23, summary: 'bulk threshold excludes ten items' }]));
    assert.equal(pan(ws, ['findings', 'record', '--phase', '1', '--agent', 'pan-reviewer', '--file', file]).status, 0);
    fs.writeFileSync(file, verdict([{ line: 23, summary: 'bulk threshold excludes ten items' }, { line: 24, summary: 'unknown code prices the cart as NaN' }]));
    assert.equal(pan(ws, ['findings', 'record', '--phase', '1', '--agent', 'pan-reviewer', '--file', file]).status, 0);
    const list = JSON.parse(pan(ws, ['findings', 'list', '--phase', '1', '--agent', 'pan-reviewer']).stdout);
    assert.equal(list.churn.reports, 2);
    assert.equal(list.churn.transitions, 1);
    assert.equal(typeof list.churn.rate, 'number');
  });
});

describe('count-questions (P1)', () => {
  test('counts the lines of a reply that end in a question mark', () => {
    assert.equal(questionLines('Phase 1: X\n\n1. **Which delimiter?**\n2. Header row? (recommended: yes)\nDone.\n- Should dates be ISO 8601?').length, 2);
    assert.equal(questionLines('No questions here.').length, 0);
  });
  test('finds the rep from the workspace name', () => {
    assert.equal(repOf('clarify-budget-export', 'clarify-budget-export'), 1);
    assert.equal(repOf('clarify-budget-export-3', 'clarify-budget-export'), 3);
  });
  test('sums the session from the step records, and reports over budget', () => {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evid-run-'));
    try {
      const ws = path.join(run, 'ws', 'clarify-x-2');
      fs.mkdirSync(path.join(ws, '.planning', 'phases', '01-a'), { recursive: true });
      fs.mkdirSync(path.join(run, 'steps'));
      const rec = (step, stdout) => fs.writeFileSync(path.join(run, 'steps', `clarify-x-2-${step}.json`), JSON.stringify({ step, stdout }));
      rec(0, 'Which areas?');
      rec(1, 'Q: tabs or commas?\nQ: header?');
      fs.writeFileSync(path.join(run, 'steps', 'clarify-x-1-0.json'), JSON.stringify({ step: 0, stdout: 'a?\nb?\nc?\nd?\ne?\nf?' }));
      let r = countQuestions(ws, 'clarify-x');
      assert.deepEqual([r.found, r.rep, r.rounds, r.questions, r.within_budget, r.context_written], [true, 2, 2, 3, true, false]);
      fs.writeFileSync(path.join(ws, '.planning', 'phases', '01-a', '01-context.md'), '# c\n');
      rec(2, 'one?\ntwo?\nthree?');
      r = countQuestions(ws, 'clarify-x');
      assert.deepEqual([r.questions, r.max_per_round, r.within_budget, r.context_written], [6, 3, false, true]);
    } finally { fs.rmSync(run, { recursive: true, force: true }); }
  });
});

describe('quick-task-recorded (H6: quick-mode covers quick.md Step 7)', () => {
  test('a row linking the quick directory is a record; a missing table or an unlinked row is not', () => {
    const table = '### Quick Tasks Completed\n\n| # | Description | Date | Commit | Directory |\n|---|---|---|---|---|\n| 1 | add shout | 2026-10-23 | abc1234 | [1-add-shout](./quick/1-add-shout/) |\n';
    assert.equal(quickTaskRecord(`# Project State\n\n${table}`).recorded, true);
    assert.equal(quickTaskRecord('# Project State\n\n## Current Position\n').recorded, false);
    assert.equal(quickTaskRecord(table.replace('[1-add-shout](./quick/1-add-shout/)', 'n/a')).recorded, false);
  });
});

describe('cross-family-lane record (R4)', () => {
  test('lane id, reps, the parseable interval and the majority verdict', () => {
    const r = laneRecord({ lane: 'cross-family:copilot', host: 'copilot', reps: 3, verdict: 'NEEDS_FIXES', file: '.planning/reviews/01/cross-family-copilot.md', runs: [{ verdict: 'NEEDS_FIXES', outcome: 'fail' }, { verdict: null, outcome: null }, { verdict: 'NEEDS_FIXES', outcome: 'fail' }] }, 0);
    assert.equal(r.lane, 'cross-family:copilot');
    assert.equal(r.reps, 3);
    assert.equal(r.parseable, 2);
    assert.ok(r.interval.lower > 0 && r.interval.upper <= 1);
    assert.equal(r.verdict, 'NEEDS_FIXES');
    assert.equal(laneRecord({ error: 'spawn_failed', reason: 'x' }, 1).parseable, 0);
  });
});

describe('the evidence scenarios have the shape the program asks for', () => {
  test('V6: five recorded pan-reviewer reviews of the same diff, then the churn figure', () => {
    const s = scenario('review-churn-live');
    assert.equal(s.seed, 'review-target');
    const reviews = s.steps.filter((st) => st.kind === 'model');
    assert.equal(reviews.length, 5);
    for (const st of reviews) { assert.match(st.prompt, /pan-reviewer/); assert.match(st.prompt, /findings record --phase 1 --agent pan-reviewer/); assert.ok(!st.double); }
    const last = s.steps[s.steps.length - 1];
    assert.deepEqual(last.argv, ['findings', 'list', '--phase', '1', '--agent', 'pan-reviewer']);
    assert.ok(last.expect.includes('json:churn.rate'));
    assert.ok(s.budget.maxUsd > 0, 'a per-step cap');
  });

  test('P1: three live seeds, a real model, at most five questions', () => {
    const ids = ['clarify-budget-greeting', 'clarify-budget-export', 'clarify-budget-ratelimit'];
    const seeds = new Set();
    for (const id of ids) {
      const s = scenario(id);
      seeds.add(s.seed);
      assert.ok(fs.existsSync(path.join(ROOT, 'harness', 'seeds', s.seed)), s.seed);
      assert.ok(s.tier >= 1 && s.steps.every((st) => !st.double), `${id}: live`);
      assert.equal(s.steps[0].prompt, '/pan:discuss-phase 1');
      assert.ok(s.steps.filter((st) => st.kind === 'user').every((st) => st.answers[st.answers.length - 1].match === '.'), `${id}: every user step has a fallback answer`);
      const count = s.steps[s.steps.length - 1];
      assert.deepEqual(count.args, ['<ws>', id]);
      assert.ok(count.expect.includes('json:within_budget=true'));
    }
    assert.equal(seeds.size, 3);
  });

  test('R4: one Copilot lane run, three reps, spending no USD', () => {
    const s = scenario('review-cross-family-copilot');
    assert.equal(s.requires.cli, 'copilot');
    assert.ok(!s.steps.some((st) => st.kind === 'model' || st.spends), 'nothing parses a USD cost');
    const lane = s.steps.find((st) => st.paid);
    assert.equal(lane.kind, 'cli');
    assert.deepEqual(lane.args.slice(1), ['<ws>', 'copilot', '3']);
  });

  test('H6: quick-mode claims a quick.md rule and checks what the rule asks for', () => {
    const s = scenario('quick-mode');
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'prompt-rules.json'), 'utf8')).rules;
    assert.ok(Array.isArray(s.covers) && s.covers.length >= 1);
    for (const id of s.covers) assert.ok(reg.some((r) => r.id === id && r.file === 'pan-wizard-core/workflows/quick.md'), id);
    assert.ok(s.steps.some((st) => st.kind === 'sh' && st.script === 'quick-task-recorded.cjs'));
    const PR = require('../scripts/prompt-rules.cjs');
    const all = require('../harness/src/scenario.cjs').loadScenarios(SCEN);
    assert.deepEqual(PR.coveringScenarios(all, s.covers[0]).map((x) => x.id), ['quick-mode'], 'a --prompt-mutant run finds its scenario');
  });

  test('covers must hold prompt-rule ids', () => {
    const { validateScenario } = require('../harness/src/scenario.cjs');
    const s = scenario('quick-mode');
    assert.deepEqual(validateScenario(s), []);
    assert.match(validateScenario({ ...s, covers: 'pan-wizard-core/workflows/quick:4387c189' }).join(), /covers/);
    assert.match(validateScenario({ ...s, covers: ['quick step 7'] }).join(), /covers/);
  });
});

describe('run state goes to the test directory this machine has', () => {
  const none = () => false;
  test('PAN_HARNESS_STATE wins', () => {
    assert.equal(defaultStateDir({ PAN_HARNESS_STATE: 'X' }, 'win32', () => true), 'X');
  });
  test('Windows: C:\\Project\\pantesting, then D:\\pantesting, then the OS temp', () => {
    assert.equal(defaultStateDir({}, 'win32', () => true), 'C:\\Project\\pantesting\\harness-runs');
    assert.equal(defaultStateDir({}, 'win32', (p) => p === 'D:\\pantesting'), 'D:\\pantesting\\harness-runs');
    assert.equal(defaultStateDir({}, 'win32', none), path.join(os.tmpdir(), 'pan-harness-runs'));
  });
  test('elsewhere: the OS temp, whatever exists', () => {
    assert.equal(defaultStateDir({}, 'linux', () => true), path.join(os.tmpdir(), 'pan-harness-runs'));
  });
});
