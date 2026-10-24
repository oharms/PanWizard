#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (spends): run PAN's autodev loop on the workspace's roadmap, from the
 * PAN install in the workspace, and print {stop, units, cost_usd, ledger}. Exit 0 only when
 * the loop stopped with `done`. The harness passes the budget left for this step as
 * PAN_HARNESS_STEP_MAX_USD; autodev gets the smaller of that and --max-usd.
 *
 *   node harness/scripts/autodev-run.cjs <workspace> [--max-usd N] [--max-turns N] [--host claude] [--timeout-minutes N] [--quality]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const ws = path.resolve(argv[0] || process.cwd());
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const host = val('--host', 'claude');
const capArg = Number(val('--max-usd', 'Infinity'));
const capEnv = Number(process.env.PAN_HARNESS_STEP_MAX_USD || 'Infinity');
const maxUsd = Math.min(capArg, capEnv);
const dir = { claude: '.claude', codex: '.codex', gemini: '.gemini', opencode: '.opencode' }[host] || '.claude';
const tools = path.join(ws, dir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
if (!fs.existsSync(tools)) { console.log(JSON.stringify({ stop: null, error: 'pan_not_installed', cost_usd: 0 })); process.exit(1); }
if (!Number.isFinite(maxUsd)) { console.log(JSON.stringify({ stop: null, error: 'no_spend_cap', cost_usd: 0 })); process.exit(1); }
const args = [tools, 'autodev', 'run', '--host', host, '--max-usd', maxUsd.toFixed(2), '--max-turns', String(val('--max-turns', '12')), ...(process.argv.includes('--quality') ? ['--quality'] : [])];
// The loop's own time bound (default 4 h); a long roadmap (pair-ledger-live) passes more.
const timeoutMs = (Number(val('--timeout-minutes', '240')) || 240) * 60 * 1000;
const r = spawnSync(process.execPath, args, { cwd: ws, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
let res = null;
try { res = JSON.parse(r.stdout); } catch {}
const out = res
  ? { stop: res.stop ? res.stop.reason : null, detail: res.stop ? res.stop.detail : (res.reason || res.error), units: (res.units || []).map((u) => `${u.action}:${u.phase}`), cost_usd: Number(res.spent_usd) || 0, ledger: res.ledger }
  : { stop: null, error: 'no_result', stderr: String(r.stderr || '').slice(-400), cost_usd: 0 };
console.log(JSON.stringify(out));
process.exit(out.stop === 'done' ? 0 : 1);
