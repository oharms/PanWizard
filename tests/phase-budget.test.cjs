/**
 * cost.cjs — the per-phase spend budget (`cost.phase_budget_usd`).
 *
 * Every project has a budget per phase: $20 unless config says otherwise, `0` turns it
 * off. It only warns: `near` from 80% of the budget, `over` once spend reaches it.
 * Nothing stops on it. Spend is the phase's priced rows in the cost ledger, with
 * suspect and empty rows left out, as everywhere else.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../pan-wizard-core/bin/lib/cost.cjs');
const { buildConfigDefaults } = require('../pan-wizard-core/bin/lib/config.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

let dir;
beforeEach(() => { dir = createTempProject(); });
afterEach(() => cleanup(dir));

function ledger(rows) {
  const d = path.join(dir, '.planning', 'metrics');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'tokens.jsonl'), rows.map((r) => JSON.stringify({ ts: '2026-10-18T10:00:00Z', model: 'm', output_tokens: 1, ...r })).join('\n') + '\n');
}
const config = (cost) => fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ cost }));

describe('phase budget', () => {
  test('the default is $20 per phase, warn only, and new configs carry it', () => {
    assert.equal(C.DEFAULT_PHASE_BUDGET_USD, 20);
    assert.equal(buildConfigDefaults(false, {}).cost.phase_budget_usd, 20);
    const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'config.json'), 'utf-8'));
    assert.equal(tpl.cost.phase_budget_usd, 20);
    const b = C.phaseBudget(dir, '3');
    assert.deepEqual([b.budget_usd, b.spent_usd, b.status, b.mode, b.warn_at_pct], [20, 0, 'ok', 'warn', 80]);
  });

  test('spend is the phase\'s own priced rows; near from 80%, over at the budget', () => {
    ledger([
      { phase: '03', agent: 'pan-executor', cost_usd: 10 },
      { phase: '3', agent: 'pan-verifier', cost_usd: 6.5 },
      { phase: '04', agent: 'pan-executor', cost_usd: 50 },
    ]);
    const b = C.phaseBudget(dir, '03');
    assert.deepEqual([b.spent_usd, b.pct, b.status], [16.5, 82.5, 'near']);
    ledger([{ phase: '03', cost_usd: 20 }]);
    assert.equal(C.phaseBudget(dir, '3').status, 'over');
    ledger([{ phase: '03', cost_usd: 15.9 }]);
    assert.equal(C.phaseBudget(dir, '3').status, 'ok');
  });

  test('suspect and empty rows are not spend; unpriced rows are counted, not guessed', () => {
    ledger([
      { phase: '03', cost_usd: 5 },
      { phase: '03', cost_usd: 900, output_tokens: 2e7 },
      { phase: '03', model: null, output_tokens: 0 },
      { phase: '03', model: 'no-such-model', tier: null, cost_usd: null, output_tokens: 100 },
    ]);
    const b = C.phaseBudget(dir, '3');
    assert.deepEqual([b.spent_usd, b.unpriced], [5, 1]);
  });

  test('config sets the budget; 0 or false turns it off; a bad value falls back to $20', () => {
    ledger([{ phase: '03', cost_usd: 30 }]);
    config({ phase_budget_usd: 50 });
    assert.deepEqual([C.phaseBudget(dir, '3').budget_usd, C.phaseBudget(dir, '3').status], [50, 'ok']);
    config({ phase_budget_usd: 0 });
    assert.equal(C.phaseBudget(dir, '3').status, 'off');
    config({ phase_budget_usd: false });
    assert.equal(C.phaseBudget(dir, '3').status, 'off');
    config({ phase_budget_usd: 'lots' });
    assert.equal(C.phaseBudget(dir, '3').budget_usd, 20);
    config({ phase_budget_usd: -5 });
    assert.equal(C.phaseBudget(dir, '3').budget_usd, 20);
  });

  test('CLI: cost budget --phase N; --raw prints the status; it never exits 1 for spend', () => {
    ledger([{ phase: '03', cost_usd: 25 }]);
    const r = runPanTools('cost budget --phase 3', dir);
    assert.equal(r.success, true, r.error);
    assert.equal(JSON.parse(r.output).status, 'over');
    assert.equal(runPanTools('cost budget 3 --raw', dir).output, 'over');
    assert.equal(runPanTools('cost budget --raw', dir).success, false, 'a phase is required');
  });
});
