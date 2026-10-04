#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: what it cost a fresh session to resume and finish (memory
 * optimisation O11). Reads the model step's saved `claude -p` output from the run's
 * steps/ folder — `<run>/steps/<scenario>-<rep>-<step>.json`, beside `<run>/ws/` —
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

function stepOutput(ws, step) {
  const file = path.join(path.dirname(path.dirname(path.resolve(ws))), 'steps', `${path.basename(path.resolve(ws))}-${step}.json`);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw.slice(raw.indexOf('{')));
  } catch { return null; }
}

function measure(ws, step) {
  const problems = [];
  const out = stepOutput(ws, step);
  if (!out) problems.push(`no saved output for model step ${step}`);
  const need = ['.planning/phases/01-greetings/01-02-summary.md', 'src/farewell.js'];
  const missing = need.filter((rel) => !fs.existsSync(path.join(ws, rel)));
  return {
    turns: out && Number.isFinite(out.num_turns) ? out.num_turns : null,
    cost_usd: out && Number.isFinite(out.total_cost_usd) ? Math.round(out.total_cost_usd * 1000) / 1000 : null,
    duration_ms: out && Number.isFinite(out.duration_ms) ? out.duration_ms : null,
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
