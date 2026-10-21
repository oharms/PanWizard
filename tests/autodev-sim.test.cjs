/**
 * Program H8: deterministic simulation of the autonomy loop with seeded faults.
 *
 * harness/src/sim.cjs runs the real autodev loop (A1, A4, A6) and the real phase gate
 * against a simulated host whose faults come from a seeded schedule: sessions that do
 * nothing, compile failures, cost spikes, verifications that need a human or find gaps.
 * Each simulation checks the loop's invariants: it stops with a declared reason, within
 * its unit and spend caps, and never completes a phase the gate should refuse.
 * Code gate: a sim fails with the stop guard disabled, and passes on 20 seeds.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SIM = require('../harness/src/sim.cjs');
const SIMS_DIR = path.join(__dirname, '..', 'harness', 'sims');

describe('H8: seeded simulation of the autodev loop', () => {
  const sims = fs.readdirSync(SIMS_DIR).filter((f) => /^sim-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(SIMS_DIR, f), 'utf8')));

  test('non-vacuity: sims are declared, and their faults fire', () => {
    assert.ok(sims.length >= 1);
    const r = SIM.runSim(sims[0], { seed: 3 });
    assert.ok(r.faults.length > 0 || r.stop.reason === 'done', JSON.stringify(r));
  });

  for (const sim of sims) {
    test(`${sim.id}: the invariants hold on 20 seeds`, () => {
      const failures = [];
      const reasons = new Set();
      for (let seed = 1; seed <= 20; seed++) {
        const r = SIM.runSim(sim, { seed });
        reasons.add(r.stop.reason);
        if (r.violations.length) failures.push(`seed ${seed}: ${r.violations.join('; ')}`);
      }
      assert.deepEqual(failures, []);
      assert.ok(reasons.size >= 2, `the faults should reach more than one stop reason: ${[...reasons]}`);
    });

    test(`${sim.id}: with the stop guard disabled, the sim fails`, () => {
      const r = SIM.runSim(sim, { seed: 1, stopGuard: false });
      assert.ok(r.violations.length > 0, JSON.stringify(r));
    });
  }

  test('the same seed gives the same run', () => {
    const a = SIM.runSim(sims[0], { seed: 7 });
    const b = SIM.runSim(sims[0], { seed: 7 });
    assert.deepEqual(a.trace, b.trace);
    assert.deepEqual(a.stop, b.stop);
  });

  test('the fault schedule is seeded and reproducible', () => {
    const s1 = SIM.faultSchedule({ compile: 0.5, noop: 0.2 }, 42);
    const s2 = SIM.faultSchedule({ compile: 0.5, noop: 0.2 }, 42);
    const draws = (s) => Array.from({ length: 30 }, () => s.next());
    assert.deepEqual(draws(s1), draws(s2));
  });
});
