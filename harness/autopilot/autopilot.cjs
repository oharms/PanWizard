#!/usr/bin/env node
'use strict';
/**
 * The autopilot spine (program S2). Development only: nothing under harness/ ships.
 *
 *   node harness/autopilot/autopilot.cjs <lane>                 a dry-run plan (the default)
 *   node harness/autopilot/autopilot.cjs <lane> --run            run a model-free lane
 *   node harness/autopilot/autopilot.cjs <lane> --run --approve-usd 2   run a model lane
 *
 * Lanes are declared in harness/autopilot/lanes.json. A model-free lane (the market
 * watcher, the State of PAN) just runs. A model lane runs only with --approve-usd for that
 * run: in a worktree under the test directory, on a local branch `bot/<lane>/<id>`, with
 * `claude -p --max-budget-usd`. Its changes must pass the scope check (its own paths, no
 * evaluator file) and leave every canary mutant red; otherwise the branch is deleted. A
 * branch that passes is left for a human to review. The autopilot never publishes
 * anything: there is no code path here that sends a branch anywhere.
 *
 * Guard rails: PAN_AUTOPILOT_KILL=1 (or harness/autopilot/state/KILL) stops every lane;
 * a monthly cap (PAN_AUTOPILOT_MONTHLY_USD, 25) over harness/autopilot/state/spend.jsonl.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { scopeCheck, canaryCheck } = require('./bot-scope-check.cjs');

const ROOT = path.join(__dirname, '..', '..');
const STATE = path.join(__dirname, 'state');
const DEFAULT_MONTHLY_USD = 25;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function readRows(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

function defaultRoot() {
  if (process.env.PAN_AUTOPILOT_ROOT) return process.env.PAN_AUTOPILOT_ROOT;
  for (const c of ['C:\\Project\\pantesting', 'D:\\pantesting']) if (process.platform === 'win32' && fs.existsSync(c)) return c;
  return os.tmpdir();
}

function planLane(lanes, laneId, o = {}) {
  const lane = lanes.find((l) => l.id === laneId);
  if (!lane) return { error: 'unknown_lane', lanes: lanes.map((l) => l.id) };
  const id = o.id || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
  if (!lane.model) return { lane: lane.id, model: false, dry_run: !o.run, command: lane.command, pushes: false };
  return {
    lane: lane.id, model: true, dry_run: !o.run, id,
    worktree: path.join(o.root || defaultRoot(), 'autopilot', `${lane.id}-${id}`),
    branch: `bot/${lane.id}/${id}`,
    command: ['claude', '-p', '--output-format', 'json', '--max-budget-usd', o.approveUsd != null ? String(o.approveUsd) : '<approved amount>', lane.prompt],
    paths: lane.paths || [],
    approval: o.approveUsd ? `approved: $${o.approveUsd}` : 'required: --approve-usd <N>',
    pushes: false,
  };
}

function monthSpend(spend, now) {
  const month = String(now).slice(0, 7);
  return spend.filter((r) => String(r.ts || '').startsWith(month)).reduce((n, r) => n + (Number(r.usd) || 0), 0);
}

function checkRun(lanes, laneId, o = {}) {
  const env = o.env || process.env;
  if (env.PAN_AUTOPILOT_KILL === '1' || fs.existsSync(path.join(STATE, 'KILL'))) return { error: 'killed', reason: 'the autopilot kill switch is set' };
  const lane = lanes.find((l) => l.id === laneId);
  if (!lane) return { error: 'unknown_lane' };
  if (!lane.model) return { ok: true };
  if (!(Number(o.approveUsd) > 0)) return { error: 'approval_required', reason: 'a model lane spends: pass --approve-usd <N> for this run' };
  const cap = o.monthlyCapUsd ?? (Number(env.PAN_AUTOPILOT_MONTHLY_USD) || DEFAULT_MONTHLY_USD);
  const spent = monthSpend(o.spend || readRows(path.join(STATE, 'spend.jsonl')), o.now || new Date().toISOString());
  if (spent + Number(o.approveUsd) > cap) return { error: 'monthly_cap', reason: `$${spent.toFixed(2)} spent this month; $${o.approveUsd} more passes the $${cap} cap` };
  return { ok: true };
}

function canaryResults(cwd) {
  const out = {};
  for (const c of readJson(path.join(__dirname, 'canaries.json'), [])) {
    const r = spawnSync(c.command, { cwd, shell: true, encoding: 'utf8', timeout: 10 * 60 * 1000 });
    out[c.id] = r.status === 0 ? 'green' : 'red';
  }
  return out;
}

function runModelLane(plan) {
  const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  fs.mkdirSync(path.dirname(plan.worktree), { recursive: true });
  const add = git(ROOT, ['worktree', 'add', '-b', plan.branch, plan.worktree, 'HEAD']);
  if (add.status !== 0) return { error: 'worktree_failed', reason: add.stderr.trim() };
  const before = canaryResults(plan.worktree);
  const r = spawnSync(plan.command[0], plan.command.slice(1).map((a) => (/\s/.test(a) && process.platform === 'win32' ? `"${a.replace(/"/g, '""')}"` : a)), { cwd: plan.worktree, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60 * 60 * 1000 });
  let usd = 0;
  try { usd = Number(JSON.parse(r.stdout.trim().split('\n').pop()).total_cost_usd) || 0; } catch {}
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(path.join(STATE, 'spend.jsonl'), JSON.stringify({ ts: new Date().toISOString(), lane: plan.lane, usd }) + '\n');
  const changed = [
    ...git(plan.worktree, ['diff', '--name-only', 'HEAD']).stdout.split('\n'),
    ...git(plan.worktree, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n'),
    ...git(plan.worktree, ['diff', '--name-only', 'HEAD@{0}', `${plan.branch}@{1}`]).stdout.split('\n'),
  ].map((s) => s.trim()).filter(Boolean);
  const scope = scopeCheck([...new Set(changed)], { paths: plan.paths });
  const canary = canaryCheck(before, canaryResults(plan.worktree));
  const outcome = scope.ok && canary.ok ? 'opened' : 'refused';
  if (outcome === 'refused') {
    git(ROOT, ['worktree', 'remove', '--force', plan.worktree]);
    git(ROOT, ['branch', '-D', plan.branch]);
  }
  fs.appendFileSync(path.join(STATE, 'bot-runs.jsonl'), JSON.stringify({ ts: new Date().toISOString(), lane: plan.lane, branch: plan.branch, outcome, usd, refused: scope.refused, gamed: canary.gamed }) + '\n');
  return { ...plan, dry_run: false, outcome, usd, scope, canary };
}

module.exports = { planLane, checkRun, monthSpend, defaultRoot };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const lanes = readJson(path.join(__dirname, 'lanes.json'), []);
  const laneId = argv.find((a) => !a.startsWith('--') && a !== val('--approve-usd') && a !== val('--root'));
  const opts = { run: argv.includes('--run'), approveUsd: val('--approve-usd') != null ? Number(val('--approve-usd')) : undefined, root: val('--root') };
  const plan = planLane(lanes, laneId, opts);
  if (plan.error || !opts.run) { console.log(JSON.stringify(plan, null, 2)); process.exit(plan.error ? 1 : 0); }
  const ok = checkRun(lanes, laneId, opts);
  if (ok.error) { console.log(JSON.stringify(ok, null, 2)); process.exit(1); }
  if (!plan.model) {
    const r = spawnSync(plan.command[0], plan.command.slice(1), { cwd: ROOT, stdio: 'inherit' });
    process.exit(r.status || 0);
  }
  console.log(JSON.stringify(runModelLane(plan), null, 2));
}
