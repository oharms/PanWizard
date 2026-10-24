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
 * Stop reasons, in code: done · human_needed · gate_failed · forecast_exceeded ·
 * budget_usd · turns · no_progress.
 *
 * A failed session unit goes through the failure-class router (A4, failure-class.cjs):
 * a retry with the error tail, a fresh restart, a tier escalation, quarantine, or a stop
 * for a human. Spend is governed between units (A6): a run cap (`--max-usd` or
 * `budget.max_usd_run`, required: it is the run's approval) and a day cap (`--max-usd-day`
 * or `budget.max_usd_day`) over every run's ledger; Claude gets the remainder as
 * `--max-budget-usd`; an execute unit that costs more than the P6 p90 forecast stops the run.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { output } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { HOSTS } = require('./hosts.cjs');
const { routeNextAction, diskSnapshot } = require('./next-action.cjs');

const STOP_REASONS = Object.freeze(['done', 'human_needed', 'gate_failed', 'ci_failed', 'forecast_exceeded', 'budget_usd', 'turns', 'no_progress']);
const FC = require('./failure-class.cjs');
// The tier an escalation climbs to, as the alias Claude Code's --model takes.
const CLAUDE_MODEL_FOR_TIER = { reasoning: 'opus', mid: 'sonnet', fast: 'haiku' };
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
      else { try { const body = fs.readFileSync(p); h.update(`${rel}/${e.name}\0${body.length}\0`); h.update(body); } catch {} }
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
function decideStop({ unit, rows = [], limits = {}, snapshot, daySpent = 0 }) {
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
  if (last && last.forecast_p90 != null && Number(last.cost_usd) > last.forecast_p90) {
    return stop('forecast_exceeded', `${unitKey(last.unit)} cost $${Number(last.cost_usd).toFixed(2)}, past the p90 forecast of $${Number(last.forecast_p90).toFixed(2)}`);
  }
  const spent = done.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
  if (limits.maxUsd != null && spent >= limits.maxUsd) return stop('budget_usd', `spent $${spent.toFixed(2)} of $${Number(limits.maxUsd).toFixed(2)}`);
  if (limits.maxUsdDay != null && daySpent >= limits.maxUsdDay) return stop('budget_usd', `spent $${Number(daySpent).toFixed(2)} today, the day cap is $${Number(limits.maxUsdDay).toFixed(2)}`);
  const maxTurns = limits.maxTurns == null ? DEFAULT_MAX_TURNS : limits.maxTurns;
  if (done.length >= maxTurns) return stop('turns', `${done.length} units run (max ${maxTurns})`);
  if (last && unitKey(last.unit) === unitKey(unit) && last.snapshot_after === snapshot) {
    return stop('no_progress', `${unitKey(unit)} ran and changed nothing on disk`);
  }
  return null;
}

/** One shell-safe line: the command to run, unattended, and nothing else. */
function unitPrompt(host, unit, note) {
  const clean = (t) => String(t || '').replace(/[\r\n&|<>%^"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (unit.action === 'ci_fix') {
    return `PAN autodev CI fix round ${unit.round} for phase ${unit.phase}: the pull request checks failed. ${clean(note)} Fix the code so they pass and commit the fix. Do not ask questions. Do not start another phase or command.`;
  }
  const name = SESSION_ACTIONS[unit.action];
  // --quality (the full ceremony, sizing.cjs) is passed to every phase command the loop runs.
  const args = `${unit.phase}${unit.action === 'plan_gaps' ? ' --gaps' : ''}${unit.plan ? ` --plan ${unit.plan}` : ''}${unit.quality ? ' --quality' : ''}`;
  const cmd = host === 'codex' ? `$pan-${name} ${args}` : host === 'opencode' ? `/pan-${name} ${args}` : `/pan:${name} ${args}`;
  const base = `PAN autodev unit: run ${cmd} unattended. Do not ask questions: take the recommended default and record what you assumed. Do not start another phase or command when it ends.`;
  return note ? `${base} ${String(note).replace(/[\r\n&|<>%^"]/g, ' ').replace(/\s+/g, ' ').trim()}` : base;
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

/**
 * Test safety: with PAN_STANDIN_DIR set, a host CLI must be a stand-in in that directory.
 * A test whose stand-in went missing would otherwise reach the real CLI, and spend.
 */
function standinMissing(bin) {
  const dir = process.env.PAN_STANDIN_DIR;
  if (!dir) return null;
  const names = process.platform === 'win32' ? [`${bin}.cmd`, `${bin}.exe`, bin] : [bin];
  return names.some((n) => fs.existsSync(path.join(dir, n))) ? null : `PAN_STANDIN_DIR is set and has no stand-in for ${bin}: refusing to run the real CLI`;
}

/** The host argv for a session: hosts.cjs's, plus Claude's spend ceiling and an escalated model. */
function sessionArgv(host, prompt, opts = {}) {
  const argv = HOSTS[host].runner.buildArgs(prompt, { captureMetrics: host === 'claude' });
  if (host !== 'claude') return argv;
  const extra = [];
  if (opts.model) extra.push('--model', opts.model);
  if (opts.remainingUsd != null && Number.isFinite(opts.remainingUsd)) extra.push('--max-budget-usd', Math.max(0, opts.remainingUsd).toFixed(2));
  return [...argv.slice(0, -1), ...extra, argv[argv.length - 1]];
}

/** Run one unit. A session unit spawns the host; complete_phase runs pan-tools. */
function executeUnit(cwd, unit, host, opts = {}) {
  if (typeof opts.execute === 'function') return opts.execute(cwd, unit, host, opts);
  const t0 = Date.now();
  if (unit.action === 'complete_phase') {
    const r = spawnSync(process.execPath, [TOOLS, 'phase', 'complete', String(unit.phase)], { cwd, encoding: 'utf8' });
    let res = null;
    try { res = JSON.parse(r.stdout); } catch {}
    const failed = r.status !== 0 || !res || res.error;
    return { exit: failed ? (r.status || 1) : 0, cost_usd: 0, argv: ['phase', 'complete', String(unit.phase)], error: failed ? ((res && res.error) || 'phase_complete_failed') : null, reason: res && res.reason ? String(res.reason).slice(0, 300) : null, duration_ms: Date.now() - t0 };
  }
  const h = HOSTS[host];
  const refused = standinMissing(h.runner.bin);
  if (refused) return { exit: 127, cost_usd: 0, argv: [], error: refused, stderr_tail: refused, duration_ms: 0 };
  const prompt = unitPrompt(host, unit, opts.note);
  const argv = sessionArgv(host, prompt, { remainingUsd: opts.remainingUsd, model: opts.model });
  const useShell = h.runner.shell === 'win32' && process.platform === 'win32';
  const quoted = useShell ? argv.map((a) => (/\s/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)) : argv;
  const r = spawnSync(h.runner.bin, quoted, {
    cwd, encoding: 'utf8', shell: useShell, stdio: ['inherit', 'pipe', 'pipe'],
    timeout: opts.timeoutMs || UNIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT') || r.signal === 'SIGTERM';
  if (r.error && !timedOut) return { exit: 127, cost_usd: 0, argv, error: `spawn_failed: ${r.error.message}`, stderr_tail: r.error.message, duration_ms: Date.now() - t0 };
  return {
    exit: timedOut ? 124 : (r.status == null ? 1 : r.status), cost_usd: parseCost(r.stdout) || 0, argv, duration_ms: Date.now() - t0,
    timed_out: timedOut || undefined, stderr_tail: (r.stderr || '').slice(-500) || undefined, stdout_tail: r.status ? (r.stdout || '').slice(-500) || undefined : undefined,
  };
}

function persistRunFacts(cwd) {
  const p = path.join(autodevDir(cwd), 'state.json');
  const st = readJson(p, { phases: {} });
  for (const ph of diskSnapshot(cwd).phases) st.phases[String(ph.number)] = { verified: !!ph.verified, merged: !!ph.merged };
  st.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(st, null, 2) + '\n');
}

/** Spend recorded today (UTC) across every run's ledger. */
function daySpend(cwd, day = new Date().toISOString().slice(0, 10)) {
  let total = 0;
  let runs = [];
  try { runs = fs.readdirSync(autodevDir(cwd)).filter((n) => n.startsWith('run-')); } catch { return 0; }
  for (const r of runs) {
    for (const row of readRows(path.join(autodevDir(cwd), r, 'ledger.jsonl'))) {
      if (row.status === 'finished' && String(row.ts || '').startsWith(day)) total += Number(row.cost_usd) || 0;
    }
  }
  return total;
}

/** The p90 forecast for an execute unit (per-plan p90 × the phase's plans), or null. */
function unitForecast(cwd, unit) {
  if (unit.action !== 'execute') return null;
  const plans = diskSnapshot(cwd).phases.length ? countPlans(cwd, unit.phase) : 0;
  try {
    const f = require('./cost.cjs').costForecast(cwd, { plans: plans || 1, excludePhase: unit.phase });
    return f && f.per_plan && f.per_plan.status === 'ok' ? Math.round(f.per_plan.p90 * (plans || 1) * 10000) / 10000 : null;
  } catch { return null; }
}

function countPlans(cwd, phase) {
  const root = planningPath(cwd, 'phases');
  const num = String(phase);
  const padded = num.includes('.') ? num : num.padStart(2, '0');
  try {
    const d = fs.readdirSync(root).find((n) => n === padded || n.startsWith(`${padded}-`) || n.startsWith(`${num}-`));
    return d ? fs.readdirSync(path.join(root, d)).filter((n) => /-plan\.md$/i.test(n)).length : 0;
  } catch { return 0; }
}

/** The fields of a finished row the stop logic reads. */
function recorded(r) {
  const out = { status: r.status, unit: r.unit, exit: r.exit, cost_usd: r.cost_usd, snapshot_after: r.snapshot_after };
  for (const k of ['error', 'reason', 'forecast_p90']) if (r[k] != null) out[k] = r[k];
  return out;
}

// ─── Worktrees (program A3) ────────────────────────────────────────────────
// With --worktrees, an execute unit whose phase has two or more pending plans runs each
// plan in its own git worktree and session (`exec-phase N --plan <id>`), sub-wave by
// sub-wave (plans of a wave that share a file are in different sub-waves). After each
// sub-wave its branches are shadow-merged onto HEAD and the oracle run (worktree
// preflight); only then are they merged into the checkout.

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=PAN autodev', '-c', 'user.email=autodev@pan.local', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function pendingPlanGroups(cwd, phase) {
  const r = spawnSync(process.execPath, [TOOLS, 'phase-plan-index', String(phase)], { cwd, encoding: 'utf8' });
  let idx = null;
  try { idx = JSON.parse(r.stdout); } catch { return []; }
  const pending = (idx.plans || []).filter((p) => !p.has_summary);
  const groups = [];
  for (const w of [...new Set(pending.map((p) => p.wave))].sort((a, b) => a - b)) {
    const inWave = pending.filter((p) => p.wave === w);
    for (const sw of [...new Set(inWave.map((p) => p.sub_wave || 0))].sort((a, b) => a - b)) groups.push(inWave.filter((p) => (p.sub_wave || 0) === sw).map((p) => p.id));
  }
  return groups;
}

/** @returns {{stop?: {reason, detail}}} */
function runPlansInWorktrees(cwd, unit, host, groups, ctx) {
  const os = require('os');
  const { shadowMergePreflight } = require('./worktree.cjs');
  for (const group of groups) {
    const made = [];
    try {
      for (const plan of group) {
        const branch = `pan/autodev-p${unit.phase}-${plan}-${crypto.randomBytes(2).toString('hex')}`;
        const dir = path.join(os.tmpdir(), `pan-autodev-wt-${crypto.randomBytes(4).toString('hex')}`);
        const add = git(cwd, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
        if (!add.ok) return { stop: { reason: 'human_needed', detail: `could not create a worktree for plan ${plan}: ${add.err}` } };
        made.push({ plan, branch, dir });
        const u = { action: 'execute', phase: unit.phase, plan, command: `/pan:exec-phase ${unit.phase} --plan ${plan}`, quality: !!ctx.opts.quality };
        const seq = ctx.nextSeq();
        ctx.append({ seq, attempt: 1, status: 'started', unit: u, host, worktree: branch, start_sha: gitHead(dir) });
        const res = executeUnit(dir, u, host, ctx.opts);
        // Whatever the session left uncommitted belongs to its plan.
        if (git(dir, ['status', '--porcelain']).out) { git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', `autodev: plan ${plan} (uncommitted work)`]); }
        ctx.append({ seq, attempt: 1, status: 'finished', unit: u, host, worktree: branch, ...res, end_sha: gitHead(dir), snapshot_after: snapshotHash(dir) });
        if (res.exit !== 0) return { stop: { reason: 'human_needed', detail: `plan ${plan} failed in its worktree (exit ${res.exit}); the branch ${branch} keeps its work` }, keep: branch };
      }
      const pf = shadowMergePreflight(cwd, { base: 'HEAD', branches: made.map((m) => m.branch) });
      if (pf.verdict && !['clean', 'no_test'].includes(pf.verdict)) {
        return { stop: { reason: 'human_needed', detail: `the merge preflight for plans ${group.join(', ')} says ${pf.verdict}${pf.conflict ? ` (${pf.conflict.files.join(', ')})` : ''}` } };
      }
      for (const m of made) {
        const merged = git(cwd, ['merge', '--no-ff', '--no-edit', m.branch]);
        if (!merged.ok) { git(cwd, ['merge', '--abort']); return { stop: { reason: 'human_needed', detail: `merging plan ${m.plan} back conflicted: ${merged.err.slice(0, 200)}` } }; }
      }
    } finally {
      for (const m of made) {
        git(cwd, ['worktree', 'remove', '--force', m.dir]);
        try { fs.rmSync(m.dir, { recursive: true, force: true }); } catch {}
        git(cwd, ['branch', '-D', m.branch]);
      }
      git(cwd, ['worktree', 'prune']);
    }
  }
  return {};
}

// ─── CI in the loop (program A2) ────────────────────────────────────────────
// With --ci, each completed phase is checked against the pull request's checks (ci.cjs);
// with --ci local, against the project's own gate run here (`npm run ci:local`, else its
// test script), with no pull request and no push.
// A failure starts a fix round, a fresh session given the failing names and log tail;
// the breaker stops the run after --ci-rounds rounds (3). The session's own account of
// its tests never decides: the checks do.

function ciBase(cwd, opts) {
  if (opts.ciBase) return opts.ciBase;
  const r = git(cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  return r.ok && r.out ? r.out.replace(/^origin\//, '') : 'main';
}

function runCiRounds(cwd, unit, host, ctx) {
  const { waitForCi, localOracle, breakerTripped, DEFAULT_CI_ROUNDS } = require('./ci.cjs');
  const local = ctx.opts.ci === 'local';
  const max = Number(ctx.opts.ciRounds) > 0 ? Number(ctx.opts.ciRounds) : DEFAULT_CI_ROUNDS;
  for (let round = 0; ; round++) {
    if (ctx.opts.ciPush) {
      const p = git(cwd, ['push']);
      if (!p.ok) return { stop: { reason: 'human_needed', detail: `--ci-push: git push failed: ${p.err.slice(0, 200)}` } };
    }
    const ci = local
      ? localOracle(cwd, { timeoutMs: ctx.opts.ciTimeoutMs })
      : waitForCi(cwd, { head: gitHead(cwd) || undefined, base: ciBase(cwd, ctx.opts), timeoutMs: ctx.opts.ciTimeoutMs, pollMs: ctx.opts.ciPollMs });
    ctx.append({ status: 'ci', phase: unit.phase, round, ci: { status: ci.status, failed: ci.failed, ignored: ci.ignored, reason: ci.reason } });
    if (ci.status === 'passed') return {};
    if (ci.status !== 'failed') return { stop: { reason: 'human_needed', detail: `CI for phase ${unit.phase} is ${ci.status}${ci.reason ? `: ${ci.reason}` : ''}` } };
    if (breakerTripped(round, max)) return { stop: { reason: 'ci_failed', detail: `phase ${unit.phase}: CI still fails after ${round} fix round(s): ${ci.failed.join(', ')}` } };
    const u = { action: 'ci_fix', phase: unit.phase, round: round + 1, command: `CI fix round ${round + 1}` };
    const seq = ctx.nextSeq();
    ctx.append({ seq, attempt: 1, status: 'started', unit: u, host, start_sha: gitHead(cwd) });
    const note = `Failing checks: ${ci.failed.join(', ')}. Failing log: ${String(ci.tail || '').split(/\r?\n/).slice(-6).join(' / ').slice(-600)}`;
    const res = executeUnit(cwd, u, host, { ...ctx.opts, note });
    ctx.append({ seq, attempt: 1, status: 'finished', unit: u, host, ...res, end_sha: gitHead(cwd), snapshot_after: snapshotHash(cwd) });
  }
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
    run = { id: runId, started: new Date().toISOString(), host: opts.host, limits: { maxUsd: opts.maxUsd ?? null, maxUsdDay: opts.maxUsdDay ?? null, maxTurns: opts.maxTurns ?? null } };
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify(run, null, 2) + '\n');
  }
  const host = opts.host || run.host;
  if (!HOSTS[host] || !HOSTS[host].runner) return { error: 'unsupported_host', reason: `no autonomous adapter for host "${host}"`, hosts: Object.keys(HOSTS).filter((k) => HOSTS[k].runner) };
  const budgetCfg = (readJson(planningPath(cwd, 'config.json'), {}).budget) || {};
  const cfgNum = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const limits = {
    maxUsd: opts.maxUsd ?? run.limits.maxUsd ?? cfgNum(budgetCfg.max_usd_run),
    maxUsdDay: opts.maxUsdDay ?? run.limits.maxUsdDay ?? cfgNum(budgetCfg.max_usd_day),
    maxTurns: opts.maxTurns ?? run.limits.maxTurns,
  };
  if (limits.maxUsd == null && !opts.execute) {
    return { error: 'budget_required', reason: 'an unattended run spends on the host: pass --max-usd <N> or set budget.max_usd_run in .planning/config.json' };
  }
  if (opts.maxUsd != null || opts.maxUsdDay != null) {
    run.limits = { ...run.limits, maxUsd: limits.maxUsd, maxUsdDay: limits.maxUsdDay, maxTurns: limits.maxTurns };
    fs.writeFileSync(runFile, JSON.stringify(run, null, 2) + '\n');
  }
  const append = (row) => fs.appendFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
  const units = [];
  let iterations = 0;

  for (;;) {
    // Simulation only (H8): a hard cap, so a loop with its stop guard disabled ends.
    if (opts.maxIterations && ++iterations > opts.maxIterations) {
      append({ status: 'stopped', reason: 'hard_cap', detail: `${opts.maxIterations} iterations without a stop` });
      return finish();
    }
    const rows = readRows(ledger);
    const pending = pendingUnit(rows);
    const unit = pending ? pending.unit : selectUnit(cwd);
    const snapshot = snapshotHash(cwd);
    const spentDay = opts.execute ? 0 : daySpend(cwd);
    const inputs = { unit, rows: rows.filter((r) => r.status === 'finished').map(recorded), limits, snapshot, daySpent: spentDay };
    const stop = pending || opts.stopGuard === false ? null : decideStop(inputs);
    // A5: the flight recorder. Every decision with exactly the inputs it was made from,
    // so `autodev replay` can re-run the stop logic and show it decides the same.
    if (!pending) fs.appendFileSync(path.join(runDir, 'blackbox.jsonl'), JSON.stringify({ ts: new Date().toISOString(), inputs, decision: stop }) + '\n');
    if (stop) {
      append({ status: 'stopped', ...stop });
      persistRunFacts(cwd);
      return { run: runId, ledger: path.relative(cwd, ledger).replace(/\\/g, '/'), host, stop, units: units.map((u) => ({ action: u.action, phase: u.phase })), spent_usd: readRows(ledger).filter((r) => r.status === 'finished').reduce((n, r) => n + (Number(r.cost_usd) || 0), 0) };
    }
    if (opts.worktrees && !pending && unit.action === 'execute') {
      const groups = pendingPlanGroups(cwd, unit.phase);
      if (groups.flat().length >= 2) {
        let next = new Set(rows.filter((r) => r.status === 'started').map((r) => r.seq)).size;
        const wt = runPlansInWorktrees(cwd, unit, host, groups, { append, opts, nextSeq: () => ++next });
        if (wt.stop) { append({ status: 'stopped', ...wt.stop }); persistRunFacts(cwd); return finish(); }
        persistRunFacts(cwd);
        units.push(unit);
        continue;
      }
    }
    const seq = pending ? pending.seq : new Set(rows.filter((r) => r.status === 'started').map((r) => r.seq)).size + 1;
    const u = { action: unit.action, phase: unit.phase, command: unit.command, quality: !!opts.quality };
    let note = null;
    let model = null;
    let routed = null;
    for (let attempt = 1; ; attempt++) {
      const spentRun = readRows(ledger).filter((r) => r.status === 'finished').reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
      const remainingUsd = Math.min(limits.maxUsd != null ? limits.maxUsd - spentRun : Infinity, limits.maxUsdDay != null ? limits.maxUsdDay - daySpend(cwd) : Infinity);
      // A retry can find the cap already spent (the first attempt is gated by decideStop):
      // stop here rather than start a session with
      // --max-budget-usd 0.00, which Claude Code refuses (2026-10-24).
      if (attempt > 1 && remainingUsd < 0.01) {
        append({ status: 'stopped', reason: 'budget_usd', detail: `the cap was spent before ${unitKey(unit)} attempt ${attempt}` });
        persistRunFacts(cwd);
        return finish('budget_usd');
      }
      if (!(pending && attempt === 1)) append({ seq, attempt, status: 'started', unit: u, host, start_sha: gitHead(cwd) });
      const res = executeUnit(cwd, unit, host, { ...opts, note, model, remainingUsd: Number.isFinite(remainingUsd) ? remainingUsd : undefined });
      const row = { seq, attempt, status: 'finished', unit: u, host, ...res, end_sha: gitHead(cwd), snapshot_after: snapshotHash(cwd), resumed: pending && attempt === 1 ? true : undefined };
      if (res.exit === 0) {
        row.forecast_p90 = unitForecast(cwd, unit);
        if (routed) row.recovered_from = routed.cls;
        append(row);
        if (opts.ci && unit.action === 'complete_phase') {
          const ci = runCiRounds(cwd, unit, host, { append, opts, nextSeq: () => new Set(readRows(ledger).filter((r) => r.status === 'started').map((r) => r.seq)).size + 1 });
          if (ci.stop) { append({ status: 'stopped', ...ci.stop }); persistRunFacts(cwd); return finish(); }
        }
        break;
      }
      if (unit.action === 'complete_phase') { append(row); break; }
      // A4: classify the failure and follow its class's policy.
      const failure = { exit: res.exit, stderr: res.stderr_tail || res.error, stdout: res.stdout_tail, timedOut: res.timed_out };
      const cls = FC.classifyFailure(failure);
      const policy = FC.routeFailure(cls, attempt);
      routed = { cls, policy: policy.action };
      append({ ...row, failure_class: cls, policy: policy.action, ...(policy.tier ? { tier: policy.tier } : {}) });
      if (policy.action === 'ask') {
        append({ status: 'stopped', reason: 'human_needed', detail: `${unitKey(unit)} failed (${cls}): ${FC.errorTail(failure, 200)}` });
        persistRunFacts(cwd);
        return finish('human_needed');
      }
      if (policy.action === 'stop_budget') {
        append({ status: 'stopped', reason: 'budget_usd', detail: `${unitKey(unit)} hit the host's budget: ${FC.errorTail(failure, 200)}` });
        persistRunFacts(cwd);
        return finish('budget_usd');
      }
      if (policy.action === 'quarantine') break;
      note = policy.action === 'retry_with_tail' ? `The previous attempt failed: ${FC.errorTail(failure)}. Fix that first.`
        : policy.action === 'escalate_tier' ? `Earlier attempts failed (${cls}): ${FC.errorTail(failure, 160)}. Work more carefully.`
          : null;
      model = policy.action === 'escalate_tier' && host === 'claude' ? CLAUDE_MODEL_FOR_TIER[policy.tier] || null : model;
    }
    persistRunFacts(cwd);
    units.push(unit);
  }

  function finish() {
    const rows = readRows(ledger);
    const stopped = rows.filter((r) => r.status === 'stopped').pop();
    return { run: runId, ledger: path.relative(cwd, ledger).replace(/\\/g, '/'), host, stop: { reason: stopped.reason, detail: stopped.detail }, units: units.map((x) => ({ action: x.action, phase: x.phase })), spent_usd: rows.filter((r) => r.status === 'finished').reduce((n, r) => n + (Number(r.cost_usd) || 0), 0) };
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
  if (sub === 'report') { require('./autodev-report.cjs').cmdAutodevReport(cwd, flags.run, raw); return; }
  if (sub === 'replay') { require('./autodev-report.cjs').cmdAutodevReplay(cwd, flags.run, raw); return; }
  if (sub !== 'run' && sub !== 'resume') { output({ error: 'unknown_subcommand', reason: 'Usage: autodev run|resume|status|report|replay [--host H] [--max-usd N] [--max-usd-day N] [--max-turns N] [--run ID]' }, raw); return; }
  const r = runAutodev(cwd, {
    host: flags.host || (sub === 'run' ? 'claude' : undefined), maxUsd: numOrNull(flags.maxUsd), maxUsdDay: numOrNull(flags.maxUsdDay), maxTurns: numOrNull(flags.maxTurns),
    runId: flags.run, resume: sub === 'resume', worktrees: !!flags.worktrees, quality: !!flags.quality,
    ci: flags.ci === 'local' ? 'local' : !!flags.ci, ciRounds: numOrNull(flags.ciRounds), ciPush: !!flags.ciPush, ciBase: flags.ciBase || undefined,
  });
  output(r, raw, r.stop ? r.stop.reason : r.error);
}

module.exports = { standinMissing, STOP_REASONS, selectUnit, decideStop, pendingUnit, snapshotHash, unitPrompt, sessionArgv, executeUnit, runAutodev, runStatus, cmdAutodev, verificationStatus, daySpend, unitForecast };
