'use strict';
/**
 * Autodev: the deterministic outer loop (programs A1a and A1c).
 *
 * `pan-tools autodev run` is a foreground Node process, not a daemon. Each turn it reads
 * the project's state from disk, asks the next-action router (the MCP orchestrator's
 * state machine) for the next unit, decides in code whether to stop, and otherwise runs
 * the unit: a fresh headless host session per plan, execute or verify unit (argv from
 * hosts.cjs), and `phase complete` in-process for a verified phase. Prose chains drop a
 * phase boundary; this loop has no model in it.
 *
 * The run ledger, `.planning/autodev/<run>/ledger.jsonl`, has a `started` row before a
 * unit and a `finished` row after it (argv, exit, cost, start and end SHA, the disk
 * snapshot after). A run killed mid-unit ends on a `started` row, and `autodev resume`
 * relaunches that unit. The run facts the state machine needs (verified, merged) are
 * persisted in `.planning/autodev/state.json`.
 *
 * Stop reasons, in code: done · human_needed · gate_failed · budget_usd · turns ·
 * no_progress.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { output } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { HOSTS } = require('./hosts.cjs');
const { routeNextAction, diskSnapshot } = require('./next-action.cjs');

const STOP_REASONS = Object.freeze(['done', 'human_needed', 'gate_failed', 'budget_usd', 'turns', 'no_progress']);
const DEFAULT_MAX_TURNS = 20;
const UNIT_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_ACTIONS = { plan: 'plan-phase', execute: 'exec-phase', verify: 'verify-phase', plan_gaps: 'plan-phase' };
const TOOLS = path.join(__dirname, '..', 'pan-tools.cjs');

const autodevDir = (cwd) => planningPath(cwd, 'autodev');
const unitKey = (u) => (u ? `${u.action}:${u.phase == null ? '' : u.phase}` : '');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function readRows(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** A hash of what the units change on disk: the phase directories, roadmap and requirements. */
function snapshotHash(cwd) {
  const h = crypto.createHash('sha1');
  const planning = planningPath(cwd);
  for (const f of ['roadmap.md', 'requirements.md']) {
    try { h.update(f + '\0' + fs.readFileSync(path.join(planning, f), 'utf8')); } catch { h.update(f + '\0-'); }
  }
  const phases = path.join(planning, 'phases');
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, `${rel}/${e.name}`);
      else { try { const st = fs.statSync(p); h.update(`${rel}/${e.name}\0${st.size}\0${fs.readFileSync(p, 'utf8')}`); } catch {} }
    }
  };
  walk(phases, 'phases');
  return h.digest('hex').slice(0, 16);
}

function verificationStatus(cwd, phase) {
  if (phase == null) return null;
  const root = planningPath(cwd, 'phases');
  const num = String(phase);
  const padded = num.includes('.') ? num : num.padStart(2, '0');
  try {
    const d = fs.readdirSync(root).find((n) => n === padded || n.startsWith(`${padded}-`) || n.startsWith(`${num}-`));
    if (!d) return null;
    const f = fs.readdirSync(path.join(root, d)).find((n) => n === 'verification.md' || n.endsWith('-verification.md'));
    if (!f) return null;
    const m = fs.readFileSync(path.join(root, d, f), 'utf8').match(/^status:\s*["']?([a-z_]+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}

/** The next unit, from the router, with whether a human is needed for it. */
function selectUnit(cwd) {
  const r = routeNextAction(cwd);
  const status = verificationStatus(cwd, r.phase);
  return { action: r.action, phase: r.phase, command: r.command, reason: r.reason, human_needed: status === 'human_needed' };
}

/** The last started unit with no finished row after it, or null. */
function pendingUnit(rows) {
  const last = rows.filter((r) => r.status === 'started' || r.status === 'finished').pop();
  return last && last.status === 'started' ? last : null;
}

/**
 * Whether to stop before running `unit`. Pure: the unit, the ledger rows so far, the
 * limits and the current disk snapshot decide it.
 * @returns {{reason: string, detail: string}|null}
 */
function decideStop({ unit, rows = [], limits = {}, snapshot }) {
  const done = rows.filter((r) => r.status === 'finished');
  const stop = (reason, detail) => ({ reason, detail });
  if (!unit) return stop('human_needed', 'no unit could be selected');
  if (unit.action === 'audit_milestone' || unit.action === 'new_milestone') return stop('done', `every phase is finished; next: ${unit.command}`);
  if (unit.action === 'stop') return unit.reason === 'all_complete' ? stop('done', 'all phases complete') : stop('human_needed', `the state machine stopped: ${unit.reason}`);
  if (unit.action === 'new_project') return stop('human_needed', 'no roadmap: start the project with /pan:new-project');
  if (unit.human_needed) return stop('human_needed', `phase ${unit.phase}: the verifier asked for a human check`);
  const last = done[done.length - 1];
  if (last && last.unit && last.unit.action === 'complete_phase' && last.exit !== 0) {
    return stop('gate_failed', `phase ${last.unit.phase}: ${last.error || 'phase complete refused'}${last.reason ? ` (${last.reason})` : ''}`);
  }
  const spent = done.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
  if (limits.maxUsd != null && spent >= limits.maxUsd) return stop('budget_usd', `spent $${spent.toFixed(2)} of $${Number(limits.maxUsd).toFixed(2)}`);
  const maxTurns = limits.maxTurns == null ? DEFAULT_MAX_TURNS : limits.maxTurns;
  if (done.length >= maxTurns) return stop('turns', `${done.length} units run (max ${maxTurns})`);
  if (last && unitKey(last.unit) === unitKey(unit) && last.snapshot_after === snapshot) {
    return stop('no_progress', `${unitKey(unit)} ran and changed nothing on disk`);
  }
  return null;
}

/** One shell-safe line: the command to run, unattended, and nothing else. */
function unitPrompt(host, unit) {
  const name = SESSION_ACTIONS[unit.action];
  const args = `${unit.phase}${unit.action === 'plan_gaps' ? ' --gaps' : ''}`;
  const cmd = host === 'codex' ? `$pan-${name} ${args}` : host === 'opencode' ? `/pan-${name} ${args}` : `/pan:${name} ${args}`;
  return `PAN autodev unit: run ${cmd} unattended. Do not ask questions: take the recommended default and record what you assumed. Do not start another phase or command when it ends.`;
}

function gitHead(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

function parseCost(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim().startsWith('{')) continue;
    try { const o = JSON.parse(lines.slice(i).join('\n')); if (o && o.total_cost_usd != null) return Number(o.total_cost_usd); } catch {}
  }
  return null;
}

/** Run one unit. A session unit spawns the host; complete_phase runs pan-tools. */
function executeUnit(cwd, unit, host, opts = {}) {
  const t0 = Date.now();
  if (unit.action === 'complete_phase') {
    const r = spawnSync(process.execPath, [TOOLS, 'phase', 'complete', String(unit.phase)], { cwd, encoding: 'utf8' });
    let res = null;
    try { res = JSON.parse(r.stdout); } catch {}
    const failed = r.status !== 0 || !res || res.error;
    return { exit: failed ? (r.status || 1) : 0, cost_usd: 0, argv: ['phase', 'complete', String(unit.phase)], error: failed ? ((res && res.error) || 'phase_complete_failed') : null, reason: res && res.reason ? String(res.reason).slice(0, 300) : null, duration_ms: Date.now() - t0 };
  }
  const h = HOSTS[host];
  const prompt = unitPrompt(host, unit);
  const argv = h.runner.buildArgs(prompt, { captureMetrics: host === 'claude' });
  const useShell = h.runner.shell === 'win32' && process.platform === 'win32';
  const quoted = useShell ? argv.map((a) => (/\s/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)) : argv;
  const r = spawnSync(h.runner.bin, quoted, {
    cwd, encoding: 'utf8', shell: useShell, stdio: ['inherit', 'pipe', 'pipe'],
    timeout: opts.timeoutMs || UNIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { exit: 127, cost_usd: 0, argv, error: `spawn_failed: ${r.error.message}`, duration_ms: Date.now() - t0 };
  return { exit: r.status == null ? 1 : r.status, cost_usd: parseCost(r.stdout) || 0, argv, duration_ms: Date.now() - t0, stderr_tail: (r.stderr || '').slice(-500) || undefined };
}

function persistRunFacts(cwd) {
  const p = path.join(autodevDir(cwd), 'state.json');
  const st = readJson(p, { phases: {} });
  for (const ph of diskSnapshot(cwd).phases) st.phases[String(ph.number)] = { verified: !!ph.verified, merged: !!ph.merged };
  st.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(st, null, 2) + '\n');
}

function newRunId() {
  const d = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `run-${d}-${crypto.randomBytes(3).toString('hex')}`;
}

function latestRun(cwd) {
  try {
    const runs = fs.readdirSync(autodevDir(cwd)).filter((n) => n.startsWith('run-') && fs.existsSync(path.join(autodevDir(cwd), n, 'run.json')));
    return runs.sort((a, b) => fs.statSync(path.join(autodevDir(cwd), b)).mtimeMs - fs.statSync(path.join(autodevDir(cwd), a)).mtimeMs)[0] || null;
  } catch { return null; }
}

/**
 * The loop. opts: { host, maxUsd, maxTurns, runId (resume), resume }
 * @returns {{run, ledger, stop, units}}
 */
function runAutodev(cwd, opts = {}) {
  let runId = opts.runId || (opts.resume ? latestRun(cwd) : null);
  if (opts.resume && !runId) return { error: 'no_run', reason: 'no autodev run to resume' };
  const runDir = path.join(autodevDir(cwd), runId || (runId = newRunId()));
  const runFile = path.join(runDir, 'run.json');
  const ledger = path.join(runDir, 'ledger.jsonl');
  let run = readJson(runFile, null);
  if (!run) {
    run = { id: runId, started: new Date().toISOString(), host: opts.host, limits: { maxUsd: opts.maxUsd ?? null, maxTurns: opts.maxTurns ?? null } };
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify(run, null, 2) + '\n');
  }
  const host = opts.host || run.host;
  if (!HOSTS[host] || !HOSTS[host].runner) return { error: 'unsupported_host', reason: `no autonomous adapter for host "${host}"`, hosts: Object.keys(HOSTS).filter((k) => HOSTS[k].runner) };
  const limits = { maxUsd: opts.maxUsd ?? run.limits.maxUsd, maxTurns: opts.maxTurns ?? run.limits.maxTurns };
  const append = (row) => fs.appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
  const units = [];

  for (;;) {
    const rows = readRows(ledger);
    const pending = pendingUnit(rows);
    const unit = pending ? pending.unit : selectUnit(cwd);
    const snapshot = snapshotHash(cwd);
    const stop = pending ? null : decideStop({ unit, rows, limits, snapshot });
    if (stop) {
      append({ status: 'stopped', ...stop });
      persistRunFacts(cwd);
      return { run: runId, ledger: path.relative(cwd, ledger).replace(/\\/g, '/'), host, stop, units: units.map((u) => ({ action: u.action, phase: u.phase })), spent_usd: readRows(ledger).filter((r) => r.status === 'finished').reduce((n, r) => n + (Number(r.cost_usd) || 0), 0) };
    }
    const seq = pending ? pending.seq : rows.filter((r) => r.status === 'started').length + 1;
    if (!pending) append({ seq, status: 'started', unit: { action: unit.action, phase: unit.phase, command: unit.command }, host, start_sha: gitHead(cwd) });
    const res = executeUnit(cwd, unit, host, opts);
    append({ seq, status: 'finished', unit: { action: unit.action, phase: unit.phase, command: unit.command }, host, ...res, end_sha: gitHead(cwd), snapshot_after: snapshotHash(cwd), resumed: pending ? true : undefined });
    persistRunFacts(cwd);
    units.push(unit);
  }
}

function runStatus(cwd, runId) {
  const id = runId || latestRun(cwd);
  if (!id) return { error: 'no_run', reason: 'no autodev run yet' };
  const dir = path.join(autodevDir(cwd), id);
  const rows = readRows(path.join(dir, 'ledger.jsonl'));
  const stopped = rows.filter((r) => r.status === 'stopped').pop() || null;
  const pending = pendingUnit(rows);
  return {
    run: id, ...readJson(path.join(dir, 'run.json'), {}),
    units: rows.filter((r) => r.status === 'finished').length,
    spent_usd: rows.filter((r) => r.status === 'finished').reduce((n, r) => n + (Number(r.cost_usd) || 0), 0),
    in_flight: pending ? pending.unit : null,
    stop: stopped ? { reason: stopped.reason, detail: stopped.detail } : null,
  };
}

function numOrNull(v) {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function cmdAutodev(cwd, sub, flags, raw) {
  if (sub === 'status') { const r = runStatus(cwd, flags.run); output(r, raw, r.stop ? r.stop.reason : r.error); return; }
  if (sub !== 'run' && sub !== 'resume') { output({ error: 'unknown_subcommand', reason: 'Usage: autodev run|resume|status [--host H] [--max-usd N] [--max-turns N] [--run ID]' }, raw); return; }
  const r = runAutodev(cwd, {
    host: flags.host || (sub === 'run' ? 'claude' : undefined), maxUsd: numOrNull(flags.maxUsd), maxTurns: numOrNull(flags.maxTurns),
    runId: flags.run, resume: sub === 'resume',
  });
  output(r, raw, r.stop ? r.stop.reason : r.error);
}

module.exports = { STOP_REASONS, selectUnit, decideStop, pendingUnit, snapshotHash, unitPrompt, executeUnit, runAutodev, runStatus, cmdAutodev, verificationStatus };
