#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: what it cost a fresh session to resume and finish (memory
 * optimisation O11). Reads the model step's record from the run's steps/ folder —
 * `<run>/steps/<scenario>-<rep>-<step>.json`, beside `<run>/ws/`, written by
 * persistStepOutput() in harness/src/run.cjs as `{ turns, costUsd, durationMs, … }` —
 * and the workspace, and prints JSON:
 *
 *   { turns, cost_usd, duration_ms, completed, missing[], problems[] }
 *
 * `completed` means plan 01-02's summary and code exist. Exits 1 when the step's
 * output cannot be found, so a missing measurement never reads as a cheap resume.
 *
 *   node resume-cost.cjs <workspace> <model step index>
 */
const fs = require('fs');
const path = require('path');

// The workspace is `ws/<scenario>` on a single-rep run and `ws/<scenario>-<rep>` under
// --repeat, while the record is always `steps/<scenario>-<rep>-<step>.json`: a single
// rep's record is `<scenario>-1-<step>.json`, which the multi-rep name missed.
function stepOutput(ws, step) {
  const steps = path.join(path.dirname(path.dirname(path.resolve(ws))), 'steps');
  const base = path.basename(path.resolve(ws));
  for (const name of [`${base}-1-${step}.json`, `${base}-${step}.json`]) {
    try {
      const raw = fs.readFileSync(path.join(steps, name), 'utf8');
      return JSON.parse(raw.slice(raw.indexOf('{')));
    } catch { /* try the other layout */ }
  }
  return null;
}

function measure(ws, step) {
  const problems = [];
  const out = stepOutput(ws, step);
  if (!out) problems.push(`no saved output for model step ${step}`);
  const need = ['.planning/phases/01-greetings/01-02-summary.md', 'src/farewell.js'];
  const missing = need.filter((rel) => !fs.existsSync(path.join(ws, rel)));
  // The harness's step record (persistStepOutput), not claude's own JSON: the first
  // version read num_turns / total_cost_usd and measured nothing (2026-10-04).
  const num = (v) => (Number.isFinite(v) ? v : null);
  const turns = out ? num(out.turns) : null;
  const cost = out ? num(out.costUsd) : null;
  return {
    turns,
    cost_usd: cost == null ? null : Math.round(cost * 1000) / 1000,
    duration_ms: out ? num(out.durationMs) : null,
    completed: missing.length === 0,
    missing,
    problems,
  };
}

if (require.main === module) {
  const [ws, step] = process.argv.slice(2);
  if (!ws || !/^\d+$/.test(String(step))) { process.stderr.write('usage: resume-cost.cjs <workspace> <model step index>\n'); process.exit(2); }
  const r = measure(ws, Number(step));
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.turns == null ? 1 : 0);
}

module.exports = { stepOutput, measure };
