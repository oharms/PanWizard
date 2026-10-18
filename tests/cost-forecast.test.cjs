/**
 * cost.cjs — cost forecast p10/p50/p90 per plan and phase (program P6).
 *
 * A plan's cost is forecast from the observed cost of each pan-executor call at the
 * tier the project runs it at; a phase's from that plus the phase's other agents
 * (planner, checkers, verifier, reviewer), resampled per plan count. Fewer than five
 * observations is no forecast: the result says so instead of guessing.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../pan-wizard-core/bin/lib/cost.cjs');
const { buildPhasePreview } = require('../pan-wizard-core/bin/lib/preview.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

let dir;
beforeEach(() => { dir = createTempProject(); });
afterEach(() => cleanup(dir));

function ledger(rows) {
  const d = path.join(dir, '.planning', 'metrics');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'tokens.jsonl'), rows.map((r, i) => JSON.stringify({ ts: `2026-10-${String(1 + i).padStart(2, '0')}T10:00:00Z`, output_tokens: 1, model: 'm', ...r })).join('\n') + '\n');
}

/** Ten executor calls at mid costing 1..10, two per phase over five phases; each phase also ran a planner (1) and a verifier (2). */
function fixture(extra = []) {
  const rows = [];
  for (let p = 1; p <= 5; p++) {
    const phase = String(p).padStart(2, '0');
    rows.push({ agent: 'pan-planner', tier: 'reasoning', phase, cost_usd: 1 });
    rows.push({ agent: 'pan-executor', tier: 'mid', phase, cost_usd: 2 * p - 1 });
    rows.push({ agent: 'pan-executor', tier: 'mid', phase, cost_usd: 2 * p });
    rows.push({ agent: 'pan-verifier', tier: 'mid', phase, cost_usd: 2 });
  }
  ledger([...rows, ...extra]);
}

describe('cost forecast (P6)', () => {
  test('quantiles interpolate between the sorted observations', () => {
    assert.deepEqual(C.quantiles([10, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { p10: 1.9, p50: 5.5, p90: 9.1 });
  });

  test('per plan: p10/p50/p90 of the executor calls at the current tier', () => {
    fixture();
    const f = C.costForecast(dir, { plans: 2 });
    assert.equal(f.tier, 'mid', 'the tier the latest executor call ran at');
    assert.deepEqual(f.per_plan, { status: 'ok', n: 10, p10: 1.9, p50: 5.5, p90: 9.1 });
  });

  test('fewer than five observations at the tier is refused, not guessed', () => {
    fixture([
      { agent: 'pan-executor', tier: 'reasoning', phase: '06', cost_usd: 30 },
      { agent: 'pan-executor', tier: 'reasoning', phase: '06', cost_usd: 40 },
    ]);
    const f = C.costForecast(dir, { plans: 1 });
    assert.equal(f.tier, 'reasoning');
    assert.deepEqual(f.per_plan, { status: 'insufficient', n: 2, needed: 5 });
    assert.equal(f.phase.status, 'insufficient');
    assert.equal(C.costForecast(dir, { plans: 1, tier: 'mid' }).per_plan.status, 'ok', 'an explicit tier is honoured');
  });

  test('per phase: the other agents plus one executor draw per plan, seeded and bounded', () => {
    fixture();
    const a = C.costForecast(dir, { plans: 2, seed: 7 });
    const b = C.costForecast(dir, { plans: 2, seed: 7 });
    assert.deepEqual(a.phase, b.phase, 'same seed, same forecast');
    assert.equal(a.phase.status, 'ok');
    assert.equal(a.phase.n_phases, 5);
    assert.ok(a.phase.p10 >= 3 + 2 && a.phase.p90 <= 3 + 20, JSON.stringify(a.phase));
    assert.ok(a.phase.p10 < a.phase.p50 && a.phase.p50 < a.phase.p90, JSON.stringify(a.phase));
    assert.ok(C.costForecast(dir, { plans: 4, seed: 7 }).phase.p50 > a.phase.p50, 'more plans cost more');
  });

  test('the phase being forecast is left out of its own samples; under five phases is refused', () => {
    fixture();
    const f = C.costForecast(dir, { plans: 2, excludePhase: '03' });
    assert.deepEqual([f.per_plan.n, f.phase.status, f.phase.n_phases], [8, 'insufficient', 4]);
  });

  test('suspect and empty rows are not observations', () => {
    fixture([
      { agent: 'pan-executor', tier: 'mid', phase: '05', cost_usd: 999, output_tokens: 2e7 },
      { agent: 'pan-executor', tier: 'mid', phase: '05', model: null, output_tokens: 0, cost_usd: 0 },
    ]);
    assert.equal(C.costForecast(dir, { plans: 1 }).per_plan.n, 10);
  });

  test('preview phase carries the forecast for its plan count', () => {
    fixture();
    const pd = path.join(dir, '.planning', 'phases', '07-next');
    fs.mkdirSync(pd, { recursive: true });
    for (const id of ['01', '02', '03']) fs.writeFileSync(path.join(pd, `07-${id}-plan.md`), `---\nphase: 07-next\nplan: ${id}\n---\nbody\n`);
    const p = buildPhasePreview(dir, '7');
    assert.equal(p.cost_forecast.plans, 3);
    assert.equal(p.cost_forecast.per_plan.status, 'ok');
    assert.equal(p.cost_forecast.phase.status, 'ok');
  });
});
