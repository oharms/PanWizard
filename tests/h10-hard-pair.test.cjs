/**
 * Program H10, the hard pair (pair-discounts-live): model-free validation.
 *
 * The easy pair showed only PAN's overhead because the bare host never failed. This pair
 * asks for six precise rules on top of working code and judges them with an acceptance
 * check neither arm can see (harness/scripts/check-discounts.cjs). Before any paid run
 * this proves the check can tell right from wrong: a reference implementation passes
 * every case, and each plausible mistake fails the rule it breaks. The seed's own tests
 * pass, and the pair is consistent (same seed, host, tier and goal; the goal has no
 * double quote that would break the PAN arm's quoted /pan:quick argument).
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'harness', 'scripts', 'check-discounts.cjs');
const FIX = path.join(__dirname, 'fixtures', 'h10-discounts');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

function check(variant) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10-'));
  dirs.push(ws);
  fs.mkdirSync(path.join(ws, 'src'));
  fs.copyFileSync(path.join(FIX, variant, 'invoice.js'), path.join(ws, 'src', 'invoice.js'));
  const r = spawnSync(process.execPath, [CHECK, ws], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  return { ...out, exit: r.status, failedNames: out.cases.filter((c) => !c.ok).map((c) => c.name) };
}

describe('H10 hard pair: the hidden acceptance check tells right from wrong', () => {
  test('a reference implementation passes every case', () => {
    const r = check('reference');
    assert.equal(r.passed, true, JSON.stringify(r.cases));
    assert.equal(r.exit, 0);
    assert.ok(r.cases.length >= 9, 'non-vacuity: one case or more per rule');
  });

  const MISTAKES = {
    'tax-before-discount': ['tax on the discounted subtotal'],
    'floor-rounding': ['a half cent rounds away from zero', 'a percent discount rounds to the nearest cent'],
    'no-clamp': ['a fixed discount never goes below zero'],
    'expiry-exclusive': ['valid on its expiry day'],
    'case-sensitive': ['case and surrounding spaces ignored'],
  };
  for (const [variant, names] of Object.entries(MISTAKES)) {
    test(`${variant} fails exactly the rule it breaks`, () => {
      const r = check(variant);
      assert.equal(r.passed, false);
      assert.equal(r.exit, 1);
      assert.deepEqual(r.failedNames, names);
    });
  }

  test('the check restores a codes.json the session wrote', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10-'));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, 'src'));
    fs.copyFileSync(path.join(FIX, 'reference', 'invoice.js'), path.join(ws, 'src', 'invoice.js'));
    fs.writeFileSync(path.join(ws, 'src', 'codes.json'), '{"MINE":{"type":"fixed","value":1,"expires":"2030-01-01"}}');
    spawnSync(process.execPath, [CHECK, ws], { encoding: 'utf8' });
    assert.match(fs.readFileSync(path.join(ws, 'src', 'codes.json'), 'utf8'), /MINE/);
  });
});

describe('H10 hard pair: the seed and the pair', () => {
  test('the seed\'s own tests pass as committed', () => {
    const seed = path.join(ROOT, 'harness', 'seeds', 'invoice-discounts');
    const r = spawnSync(process.execPath, ['--test'], { cwd: seed, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('the pair is consistent, and the PAN arm\'s quoted argument is intact', () => {
    const S = require('../harness/src/scenario.cjs');
    const all = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
    const pan = all.find((s) => s.id === 'pair-discounts-live');
    const stock = all.find((s) => s.id === 'pair-discounts-live-stock');
    assert.ok(pan && stock);
    assert.deepEqual(S.validatePairs([pan, stock]), []);
    assert.doesNotMatch(pan.pair.goal, /"/);
    assert.equal(pan.steps[0].prompt, `/pan:quick --full "${pan.pair.goal}"`);
    assert.equal(stock.steps[0].prompt, stock.pair.goal);
    for (const s of [pan, stock]) assert.ok(s.steps.some((st) => st.script === 'check-discounts.cjs'), `${s.id} runs the hidden check`);
  });

  test('the acceptance check is not in the seed, so no arm can read it', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
    assert.ok(!walk(path.join(ROOT, 'harness', 'seeds', 'invoice-discounts')).some((n) => /check-discounts/.test(n)));
  });
});
