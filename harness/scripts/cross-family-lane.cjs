#!/usr/bin/env node
'use strict';
/**
 * Harness step (program R4's evidence run): one cross-family reviewer lane run, through the
 * INSTALLED engine, summarised as the record the superplan asks for: lane id, reps, interval,
 * verdict.
 *
 *   node cross-family-lane.cjs <workspace> <host> <reps> [<runtime dir, default .claude>]
 *
 * Runs `pan-tools review cross-family 1 --host <host> --reps <reps>` in the workspace and
 * prints JSON `{ lane, host, reps, verdict, verdicts, parseable, interval, file, exit }`:
 * `parseable` is how many reps returned a valid pan-verdict block, `interval` its 95% Wilson
 * interval over the reps, `verdict` the majority. Exits 0 when the lane ran and at least one
 * rep was parseable. The host's CLI spends its own credits (Copilot: premium requests), not
 * USD the harness can count, so a scenario runs this as a `cli` step marked `paid: true`.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { wilson } = require('../src/stats.cjs');

/** Pure: the lane record from the engine's JSON result. */
function laneRecord(result, exit) {
  const r = result || {};
  const runs = Array.isArray(r.runs) ? r.runs : [];
  const parseable = runs.filter((x) => x && x.outcome).length;
  const iv = runs.length ? wilson(parseable, runs.length) : null;
  return {
    lane: r.lane || null, host: r.host || null, reps: r.reps || runs.length, verdict: r.verdict || null,
    verdicts: runs.map((x) => x.verdict), parseable,
    interval: iv ? { lower: Math.round(iv.lower * 1000) / 1000, upper: Math.round(iv.upper * 1000) / 1000 } : null,
    file: r.file || null, exit, ...(r.error ? { error: r.error, reason: r.reason } : {}),
  };
}

if (require.main === module) {
  const [ws, host, reps, runtimeDir = '.claude'] = process.argv.slice(2);
  if (!ws || !host) { console.log(JSON.stringify({ error: 'usage: cross-family-lane.cjs <workspace> <host> <reps>' })); process.exit(1); }
  const tools = path.join(path.resolve(ws), runtimeDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
  const r = spawnSync(process.execPath, [tools, 'review', 'cross-family', '1', '--host', host, '--reps', String(reps || 1)], { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  let parsed = null;
  try { parsed = JSON.parse(String(r.stdout || '').trim()); } catch { parsed = { error: 'unparseable_engine_output', reason: String(r.stdout || r.stderr || '').slice(0, 400) }; }
  const rec = laneRecord(parsed, r.status);
  console.log(JSON.stringify(rec));
  process.exit(r.status === 0 && rec.parseable > 0 ? 0 : 1);
}

module.exports = { laneRecord };
