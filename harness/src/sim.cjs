#!/usr/bin/env node
'use strict';
/**
 * Deterministic simulation of the autonomy loop (program H8).
 *
 * Runs the real autodev loop (autodev.cjs: unit selection, stop reasons, the failure-class
 * router, the dollar governor) and the real phase gate against a simulated host. The host
 * acts on a throwaway project the way the real sessions would (a plan, a summary, a
 * verification) unless the seeded fault schedule says otherwise:
 *
 *   noop        the session changes nothing
 *   compile     the session fails with a compile error
 *   cost_spike  the session costs five times as much
 *   human       the verification asks for a human
 *   gaps        the verification finds gaps (the phase gate must then refuse)
 *
 * After each run the invariants are checked: the loop stopped, with a declared reason,
 * within its unit cap, within its spend cap plus at most one unit, and no phase was
 * completed while its verification found gaps. A sim is a JSON file in harness/sims/.
 *
 *   node harness/src/sim.cjs [--sim <id>] [--seeds N] [--no-stop-guard]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const A = require('../../pan-wizard-core/bin/lib/autodev.cjs');

const SIMS_DIR = path.join(__dirname, '..', 'sims');
const BASE_COST = 0.1;
const MAX_ITERATIONS = 60;

/** mulberry32 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded schedule: next() is the fault for the next session, or null. */
function faultSchedule(rates, seed) {
  const rnd = prng(seed);
  const entries = Object.entries(rates || {});
  return {
    next() {
      const x = rnd();
      let acc = 0;
      for (const [fault, p] of entries) { acc += p; if (x < acc) return fault; }
      return null;
    },
  };
}

function makeProject(sim) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pan-${sim.id}-`));
  const p = path.join(dir, '.planning');
  fs.mkdirSync(path.join(p, 'phases'), { recursive: true });
  fs.writeFileSync(path.join(p, 'project.md'), '# Sim\n');
  fs.writeFileSync(path.join(p, 'requirements.md'), '# Requirements\n');
  fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: sim.gate || 'enforce' } }));
  let roadmap = '# Roadmap\n\n## Phases\n\n';
  for (let n = 1; n <= sim.phases; n++) roadmap += `- [ ] **Phase ${n}: P${n}**\n`;
  roadmap += '\n';
  for (let n = 1; n <= sim.phases; n++) {
    roadmap += `### Phase ${n}: P${n}\n**Goal:** g${n}\n\n`;
    fs.mkdirSync(path.join(p, 'phases', `0${n}-p${n}`));
  }
  fs.writeFileSync(path.join(p, 'roadmap.md'), roadmap);
  return dir;
}

function phaseDir(cwd, n) {
  const root = path.join(cwd, '.planning', 'phases');
  return path.join(root, fs.readdirSync(root).find((d) => d.startsWith(`0${n}-`)));
}

/** Run one simulation. Returns the stop, the trace, the faults that fired and any invariant violations. */
function runSim(sim, { seed = 1, stopGuard = true } = {}) {
  const dir = makeProject(sim);
  const schedule = faultSchedule(sim.faults, seed);
  const faults = [];
  const trace = [];
  const execute = (cwd, unit, host, opts) => {
    if (unit.action === 'complete_phase') {
      const r = A.executeUnit(cwd, unit, host, {});
      trace.push(`${unit.action}:${unit.phase}:${r.exit}`);
      return r;
    }
    const fault = ['plan', 'execute', 'verify', 'plan_gaps'].includes(unit.action) ? schedule.next() : null;
    if (fault) faults.push(`${unit.action}:${unit.phase}:${fault}`);
    trace.push(`${unit.action}:${unit.phase}:${fault || 'ok'}${opts && opts.note ? ':retry' : ''}`);
    if (fault === 'compile') return { exit: 1, cost_usd: BASE_COST, argv: ['sim'], stderr_tail: 'SyntaxError: Unexpected token }', duration_ms: 0 };
    const cost = fault === 'cost_spike' ? BASE_COST * 5 : BASE_COST;
    if (fault !== 'noop' && unit.phase != null) {
      const d = phaseDir(cwd, unit.phase);
      const pad = `0${unit.phase}`;
      if (unit.action === 'plan' || unit.action === 'plan_gaps') fs.writeFileSync(path.join(d, `${pad}-01-plan.md`), `---\nphase: ${pad}\n---\n`);
      if (unit.action === 'execute') fs.writeFileSync(path.join(d, `${pad}-01-summary.md`), '# done\n');
      if (unit.action === 'verify') {
        const status = fault === 'human' ? 'human_needed' : fault === 'gaps' ? 'gaps_found' : 'passed';
        fs.writeFileSync(path.join(d, `${pad}-verification.md`), `---\nstatus: ${status}\n---\n# V\n`);
      }
    }
    return { exit: 0, cost_usd: cost, argv: ['sim'], duration_ms: 0 };
  };

  let result;
  try {
    result = A.runAutodev(dir, { host: 'claude', execute, maxUsd: sim.limits.maxUsd, maxTurns: sim.limits.maxTurns, stopGuard, maxIterations: MAX_ITERATIONS });
    const ledger = fs.readFileSync(path.join(dir, result.ledger), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const finished = ledger.filter((r) => r.status === 'finished');
    const units = new Set(finished.map((r) => r.seq)).size;
    const spent = finished.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
    const maxUnitCost = Math.max(0, ...finished.map((r) => Number(r.cost_usd) || 0));
    const violations = [];
    if (!A.STOP_REASONS.includes(result.stop.reason)) violations.push(`stopped with an undeclared reason: ${result.stop.reason}`);
    if (units > sim.limits.maxTurns) violations.push(`ran ${units} units past the cap of ${sim.limits.maxTurns}`);
    if (spent > sim.limits.maxUsd + maxUnitCost + 1e-9) violations.push(`spent $${spent.toFixed(2)}, more than the $${sim.limits.maxUsd} cap plus one unit`);
    const roadmap = fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8');
    for (let n = 1; n <= sim.phases; n++) {
      if (!new RegExp(`-\\s*\\[x\\]\\s*\\*\\*Phase ${n}:`).test(roadmap)) continue;
      let v = '';
      try { v = fs.readFileSync(path.join(phaseDir(dir, n), `0${n}-verification.md`), 'utf8'); } catch {}
      if (!/status:\s*passed/.test(v)) violations.push(`phase ${n} completed without a passed verification`);
    }
    return { sim: sim.id, seed, stop: result.stop, units, spent: Math.round(spent * 100) / 100, faults, trace, violations };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function loadSims() {
  return fs.readdirSync(SIMS_DIR).filter((f) => /^sim-.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(SIMS_DIR, f), 'utf8')));
}

module.exports = { runSim, faultSchedule, loadSims, prng };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const seeds = Number(val('--seeds')) || 20;
  const only = val('--sim');
  const stopGuard = !argv.includes('--no-stop-guard');
  let failed = 0;
  for (const sim of loadSims().filter((x) => !only || x.id === only)) {
    const reasons = {};
    for (let seed = 1; seed <= seeds; seed++) {
      const r = runSim(sim, { seed, stopGuard });
      reasons[r.stop.reason] = (reasons[r.stop.reason] || 0) + 1;
      if (r.violations.length) { failed++; console.log(`${sim.id} seed ${seed}: ${r.violations.join('; ')}`); }
    }
    console.log(`${sim.id}: ${seeds} seeds, stops ${JSON.stringify(reasons)}`);
  }
  process.exit(failed ? 1 : 0);
}
