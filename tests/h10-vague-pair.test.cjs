/**
 * Program H10, the vague-goal pair (pair-vague-live): model-free validation.
 *
 * Both arms get a vague goal ("Finance needs an export of expenses"); the real constraints
 * are only in the seed's own documents (meeting notes, data dictionary, ops runbook), so an
 * implementer that investigates before coding should meet them and one that codes from the
 * request should miss some. Before any paid run this proves the hidden check
 * (harness/scripts/check-vague-export.cjs) tells right from wrong: a reference passes every
 * case, and each plausible "coded from the request only" version fails exactly the cases of
 * the constraint it misses. It also proves every constraint the check judges is written in
 * the seed and none is in the requirement text, that the phase sizes to the full ceremony
 * (so autodev runs a planning session rather than the engine's lean plan), and that the
 * pair is consistent.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'harness', 'scripts', 'check-vague-export.cjs');
const SEED = path.join(ROOT, 'harness', 'seeds', 'vague-export');
const FIX = path.join(__dirname, 'fixtures', 'h10-vague');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

function seedCopy() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10v-'));
  dirs.push(ws);
  fs.cpSync(SEED, ws, { recursive: true });
  return ws;
}

function check(variant) {
  const ws = seedCopy();
  if (variant) fs.copyFileSync(path.join(FIX, variant, 'export.js'), path.join(ws, 'src', 'export.js'));
  const r = spawnSync(process.execPath, [CHECK, ws], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  return { ...out, exit: r.status, failedNames: out.cases.filter((c) => !c.ok).map((c) => c.name), ws };
}

const CONSTRAINTS = ['api', 'range', 'delimiter', 'amount', 'columns', 'cost-centre', 'soft-delete', 'file'];

describe('H10 vague pair: the hidden acceptance check tells right from wrong', () => {
  test('the reference passes every case, one or more per constraint', () => {
    const r = check('reference');
    assert.equal(r.passed, true, JSON.stringify(r.cases));
    assert.equal(r.exit, 0);
    assert.equal(r.failed, 0);
    assert.ok(r.cases.length >= 12, `non-vacuity: ${r.cases.length} cases`);
    assert.deepEqual([...new Set(r.cases.map((c) => c.constraint))].sort(), [...CONSTRAINTS].sort());
  });

  test('the check leaves no exports folder in the workspace', () => {
    const r = check('reference');
    assert.equal(fs.existsSync(path.join(r.ws, 'exports')), false);
  });

  test('the bare seed (no export yet) fails every case and exits 1', () => {
    const r = check(null);
    assert.equal(r.exit, 1);
    assert.equal(r.failed, r.cases.length);
    assert.ok(r.cases.length >= 12);
  });

  const MISTAKES = {
    'comma-delimiter': ['fields are separated by semicolons', 'a description with a semicolon and quotes is quoted, quotes doubled'],
    'float-amounts': ['1250 cents is 12.50', '125000 cents is 1250.00, no thousands separator'],
    'includes-deleted': ['a soft-deleted claim in the range is not exported'],
    'wrong-column-order': ['the header is id, date, cost_centre, description, amount, submitted_by in that order'],
    'no-cost-centre': ['the header is id, date, cost_centre, description, amount, submitted_by in that order', 'the cost_centre column holds the code', 'a claim with no cost centre is UNALLOCATED'],
  };
  for (const [variant, names] of Object.entries(MISTAKES)) {
    test(`${variant} fails exactly the cases of the constraint it misses`, () => {
      const r = check(variant);
      assert.equal(r.passed, false);
      assert.equal(r.exit, 1);
      assert.deepEqual(r.failedNames, names);
    });
  }
});

describe('H10 vague pair: the seed and the pair', () => {
  test('the seed\'s own tests pass as committed', () => {
    const r = spawnSync(process.execPath, ['--test'], { cwd: SEED, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('every constraint is written in the seed\'s docs, and none in the requirement text', () => {
    const read = (p) => fs.readFileSync(path.join(SEED, p), 'utf8');
    const docs = ['docs/finance-meeting-2026-09.md', 'docs/data-dictionary.md', 'docs/ops.md'].map(read).join('\n');
    const facts = ['exportExpenses(store, { from, to })', 'writeMonthlyExport(store, month, dir)', '**both ends are included**', 'oldest first', '**semicolon**', 'exactly two decimal places', '`-0.05`', '`cost_centre`', '`UNALLOCATED`', 'must never appear', '`expenses-YYYY-MM.csv`', '<dir>/exports/'];
    for (const f of facts) assert.ok(docs.includes(f), `the docs state: ${f}`);
    const req = read('.planning/requirements.md') + read('.planning/roadmap.md');
    for (const f of ['semicolon', 'cents', 'cost', 'deleted', 'export.js', 'exportExpenses', 'csv', 'CSV', 'Excel']) {
      assert.ok(!req.includes(f), `the requirement text does not give away: ${f}`);
    }
  });

  test('the phase sizes to the full ceremony, so autodev plans it in a session', () => {
    const ws = seedCopy();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs'), 'size', 'phase', '1'], { cwd: ws, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.path, 'full', JSON.stringify(out));
    assert.deepEqual(out.metrics.unspecified, ['EXP-01', 'EXP-02']);
  });

  test('the pair is consistent; PAN runs autodev, the stock arm one session with the goal', () => {
    const S = require('../harness/src/scenario.cjs');
    const all = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
    const pan = all.find((s) => s.id === 'pair-vague-live');
    const stock = all.find((s) => s.id === 'pair-vague-live-stock');
    assert.ok(pan && stock);
    assert.deepEqual(S.validatePairs([pan, stock]), []);
    assert.equal(pan.seed, 'vague-export');
    assert.equal(pan.steps[0].script, 'autodev-run.cjs');
    assert.equal(pan.steps[0].spends, true);
    assert.equal(stock.steps[0].kind, 'model');
    assert.equal(stock.steps[0].prompt, `${stock.pair.goal} Do not ask questions.`);
    for (const s of [pan, stock]) {
      assert.ok(s.steps.some((st) => st.script === 'seed-tests.cjs'), `${s.id} runs the seed tests`);
      assert.ok(s.steps.some((st) => st.script === 'check-vague-export.cjs'), `${s.id} runs the hidden check`);
    }
  });

  test('the acceptance check and its fixtures are not in the seed, so no arm can read them', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
    const names = walk(SEED);
    assert.ok(!names.some((n) => /check-vague|h10-vague/.test(n)));
    assert.ok(!names.includes('export.js'), 'the seed has no export yet');
  });
});
