/**
 * Program H10: PAN versus the bare host, paired, per host.
 *
 * A pair is two scenarios with the same `pair.id` and `pair.goal`, one per arm: `pan`
 * (PAN installed) and `stock` (`install: null`, the host alone), on the same seed and
 * host. The harness reports each pair's paired deltas (completion, cost, duration) with
 * an interval (stats.cjs pairedDelta). Code gate: the pairs validate, and replay from
 * their committed cassettes at tier 0. The evidence run (one host, paired reps against a
 * real model) spends.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const S = require('../harness/src/scenario.cjs');
const ST = require('../harness/src/stats.cjs');
const RUN = require('../harness/src/run.cjs');

const base = (id, arm, extra = {}) => ({
  id, tier: 0, description: 'd', why: 'w', seed: 'empty', requires: { cli: 'claude' },
  install: arm === 'pan' ? ['--claude'] : null,
  pair: { id: 'p1', arm, goal: 'add a function' },
  steps: [{ kind: 'model', prompt: 'x', double: { script: { rules: [{ turns: [{ text: 'ok' }] }] } }, expect: ['exit:0'], why: 'w' }],
  ...extra,
});

describe('H10: pair validation', () => {
  test('a well-formed pair validates', () => {
    assert.deepEqual(S.validatePairs([base('a', 'pan'), base('a-stock', 'stock')]), []);
  });
  test('a pair needs both arms', () => {
    assert.match(S.validatePairs([base('a', 'pan')]).join(), /p1.*stock/);
  });
  test('the stock arm installs nothing; the pan arm installs PAN', () => {
    assert.match(S.validatePairs([base('a', 'pan'), base('a-stock', 'stock', { install: ['--claude'] })]).join(), /stock arm.*install/);
    assert.match(S.validatePairs([base('a', 'pan', { install: null }), base('a-stock', 'stock')]).join(), /pan arm.*install/);
  });
  test('the arms share seed, host, tier and goal', () => {
    assert.match(S.validatePairs([base('a', 'pan'), base('a-stock', 'stock', { seed: 'other' })]).join(), /seed/);
    assert.match(S.validatePairs([base('a', 'pan'), base('a-stock', 'stock', { pair: { id: 'p1', arm: 'stock', goal: 'something else' } })]).join(), /goal/);
    assert.match(S.validatePairs([base('a', 'pan'), base('a-stock', 'stock', { requires: { cli: 'codex' } })]).join(), /host/);
  });

  test('the committed pairs validate, and each arm replays from a committed cassette', () => {
    const all = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
    const paired = all.filter((s) => s.pair);
    assert.ok(paired.length >= 2, 'non-vacuity: at least one pair is committed');
    assert.deepEqual(S.validatePairs(all), []);
    for (const s of paired) {
      const replays = s.steps.filter((st) => st.double && st.double.cassette);
      assert.ok(replays.length, `${s.id}: replays from a cassette`);
      for (const st of replays) {
        const file = st.double.cassette.replace('<repo>', ROOT);
        assert.ok(fs.existsSync(file), `${s.id}: cassette ${file} is committed`);
        assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).length > 0);
      }
      assert.equal(s.tier, 0, `${s.id}: a replay is tier 0`);
    }
  });
});

describe('H10: paired deltas', () => {
  test('mean difference with an interval', () => {
    const d = ST.pairedDelta([{ pan: 1, stock: 0 }, { pan: 1, stock: 0 }, { pan: 1, stock: 1 }, { pan: 0, stock: 0 }]);
    assert.equal(d.n, 4);
    assert.equal(d.mean, 0.5);
    assert.ok(d.lower < 0.5 && d.upper > 0.5);
    assert.ok(d.lower >= -1 && d.upper <= 1.5);
  });
  test('identical arms give a zero delta; one pair gives no interval', () => {
    const z = ST.pairedDelta([{ pan: 2, stock: 2 }, { pan: 3, stock: 3 }]);
    assert.equal(z.mean, 0); assert.equal(z.lower, 0); assert.equal(z.upper, 0);
    const one = ST.pairedDelta([{ pan: 1, stock: 0 }]);
    assert.equal(one.lower, null);
  });
  test('the run report pairs reps by arm and computes each delta', () => {
    const scenarios = [base('a', 'pan'), base('a-stock', 'stock')];
    const results = [
      { scenario: 'a', rep: 1, status: 'passed', durationMs: 100, steps: [{ costUsd: 0.5 }] },
      { scenario: 'a-stock', rep: 1, status: 'failed', durationMs: 80, steps: [{ costUsd: 0.2 }] },
      { scenario: 'a', rep: 2, status: 'passed', durationMs: 120, steps: [{ costUsd: 0.4 }] },
      { scenario: 'a-stock', rep: 2, status: 'passed', durationMs: 90, steps: [{ costUsd: 0.3 }] },
    ];
    const [p] = RUN.pairSummary(results, scenarios);
    assert.equal(p.pair, 'p1');
    assert.equal(p.n, 2);
    assert.equal(p.completion.mean, 0.5);
    assert.equal(Math.round(p.cost_usd.mean * 100) / 100, 0.2);
    assert.equal(p.duration_ms.mean, 25);
  });
});
