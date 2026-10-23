#!/usr/bin/env node
'use strict';
/**
 * PAN on PAN, the dogfood lane (program S6). Development only.
 *
 * PAN's own loop on PAN's source: a worktree of this repository on a local
 * `bot/dogfood/<id>` branch, PAN installed from the packed tarball with
 * `--global --config-dir <scratch>` (the never-install-into-the-source-repo rule holds:
 * the installer runs from the package, into a scratch config dir), a throwaway
 * `.planning/` scaffold (gitignored), and one finding handed to `/pan:quick --full`. The
 * branch is kept for the owner only when the quick task's verification passed and its
 * diff passes the scope check. It produces PAN's own verdicts, findings and cost data.
 * Nothing here publishes a branch.
 *
 * The login. The session runs with CLAUDE_CONFIG_DIR at the scratch config dir, and on
 * Windows and Linux Claude Code keeps its login in <config dir>/.credentials.json (macOS:
 * the Keychain), so a fresh config dir has none. With ANTHROPIC_API_KEY set, the session
 * uses the key and nothing is copied. Otherwise the `login` step copies only the owner's
 * .credentials.json (from CLAUDE_CONFIG_DIR, else ~/.claude) into the scratch config dir,
 * and the end of the run syncs it back: if the session refreshed the token and the
 * owner's file is unchanged since the copy, the refreshed file replaces it (a refresh can
 * rotate the refresh token, which would otherwise leave the owner's own login stale); if
 * both changed, the owner's file is left alone and the run reports `diverged`. The
 * scratch copy is deleted on every path. The contents are never printed, logged or
 * recorded: only digests are compared, in memory. Installing `--local` into the worktree
 * was rejected: the worktree is a checkout of this repository, and a local install edits
 * its tracked CLAUDE.md and .claude/settings.json.
 *
 * Guard rails: PAN_AUTOPILOT_KILL=1 (or harness/autopilot/state/KILL) refuses the run here
 * as well as in autopilot.cjs, and the session's spend is appended to state/spend.jsonl,
 * which autopilot.cjs's monthly cap reads.
 *
 *   node harness/autopilot/dogfood.cjs                     the plan (dry run)
 *   node harness/autopilot/dogfood.cjs --approve-usd 5     a paid run
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { scopeCheck } = require('./bot-scope-check.cjs');

const REPO = path.join(__dirname, '..', '..');
const STATE = path.join(__dirname, 'state');
// What a dogfood fix may touch: PAN's shipped source and its tests.
const DOGFOOD_PATHS = ['pan-wizard-core/', 'bin/', 'hooks/', 'agents/', 'commands/', 'scripts/', 'tests/', 'docs/', 'README.md', 'CHANGELOG.md'];

function readRows(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** The oldest open harness finding, or null. */
function pickFinding(repo = REPO) {
  const open = readRows(path.join(repo, 'harness', 'ledger.jsonl')).filter((f) => !f.resolved_at)
    .sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)));
  if (!open.length) return null;
  const f = open[0];
  return { id: f.signature, summary: `harness scenario ${f.scenario} step ${f.step ?? '?'}: ${f.detail}${f.why ? ` (${f.why})` : ''}` };
}

/** Where the owner's Claude Code login lives (Windows and Linux; macOS uses the Keychain). */
function ownerCredentials(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
}

const digest = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

/** Copy the owner's credentials file into the scratch config dir; a handle for syncBack(). */
function copyLogin(from, to) {
  if (!fs.existsSync(from)) return { ok: false, reason: `no Claude Code login at ${from}: run claude and /login once, or set ANTHROPIC_API_KEY` };
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  try { fs.chmodSync(to, 0o600); } catch {}
  return { ok: true, from, to, sourceDigest: digest(from), copyDigest: digest(to) };
}

/**
 * After the session: carry a refreshed token back to the owner's file when that file did
 * not change meanwhile, then delete the scratch copy. Returns a status word, never content.
 */
function syncBack(h) {
  if (!h || !h.to) return 'none';
  let status = 'unchanged';
  const now = digest(h.to);
  if (now && now !== h.copyDigest) {
    if (digest(h.from) === h.sourceDigest) {
      const tmp = `${h.from}.pan-dogfood-${process.pid}.tmp`;
      fs.copyFileSync(h.to, tmp);
      try { fs.chmodSync(tmp, 0o600); } catch {}
      fs.renameSync(tmp, h.from);
      status = 'refreshed_synced';
    } else status = 'diverged';
  }
  try { fs.rmSync(h.to, { force: true }); } catch {}
  return status;
}

function killed(env = process.env, state = STATE) {
  return env.PAN_AUTOPILOT_KILL === '1' || fs.existsSync(path.join(state, 'KILL'));
}

/** C:\Project\pantesting (this machine's test dir), then D:\pantesting, then a private temp dir. */
function defaultRoot(env = process.env, exists = fs.existsSync, platform = process.platform) {
  if (env.PAN_AUTOPILOT_ROOT) return env.PAN_AUTOPILOT_ROOT;
  for (const c of ['C:\\Project\\pantesting', 'D:\\pantesting']) if (platform === 'win32' && exists(c)) return c;
  // A private directory, never a shared path in the temp dir another user could plant.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pan-autopilot-'));
}

function planDogfood(o = {}) {
  const repo = o.repo || REPO;
  const env = o.env || process.env;
  const root = o.root || defaultRoot(env);
  const id = o.id || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
  const scratch = path.join(root, 'autopilot', `dogfood-${id}-scratch`);
  const worktree = o.worktree || path.join(root, 'autopilot', `dogfood-${id}`);
  const configDir = path.join(scratch, 'claude-config');
  const installer = path.join(scratch, 'package', 'bin', 'install.js');
  const finding = o.finding || pickFinding(repo);
  const login = env.ANTHROPIC_API_KEY ? { mode: 'api-key' } : { mode: 'copy-credentials', from: ownerCredentials(env), to: path.join(configDir, '.credentials.json') };
  const clean = (t) => String(t || '').replace(/[\r\n&|<>%^"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  return {
    lane: 'dogfood', id, branch: `bot/dogfood/${id}`, worktree, scratch, configDir, finding, login: login.mode,
    approval: o.approveUsd ? `approved: $${o.approveUsd}` : 'required: --approve-usd <N>',
    pushes: false,
    steps: [
      { step: 'pack', cwd: repo, cmd: 'npm', args: ['pack', '--pack-destination', scratch] },
      { step: 'worktree', cwd: repo, cmd: 'git', args: ['worktree', 'add', '-b', `bot/dogfood/${id}`, worktree, 'HEAD'] },
      { step: 'install', cwd: worktree, installer, cmd: process.execPath, args: [installer, '--claude', '--global', '--config-dir', configDir] },
      { step: 'login', ...login },
      { step: 'scaffold', cwd: worktree, files: ['.planning/project.md', '.planning/config.json', '.planning/state.md'] },
      { step: 'session', cwd: worktree, env: { CLAUDE_CONFIG_DIR: configDir }, cmd: 'claude', args: ['-p', '--dangerously-skip-permissions', '--output-format', 'json', '--max-budget-usd', String(o.approveUsd ?? '<approved>'), `/pan:quick --full Fix this PAN finding and add a test that fails without the fix: ${clean(finding && finding.summary)}`] },
      { step: 'verify', cwd: worktree, reads: '.planning/quick/*/*-verification.md' },
      { step: 'scope', cwd: worktree, paths: DOGFOOD_PATHS },
    ],
  };
}

function latestVerification(worktree) {
  const q = path.join(worktree, '.planning', 'quick');
  let best = null;
  try {
    for (const d of fs.readdirSync(q)) {
      for (const f of fs.readdirSync(path.join(q, d)).filter((n) => n.endsWith('-verification.md'))) {
        const p = path.join(q, d, f);
        const m = fs.readFileSync(p, 'utf8').match(/^status:\s*["']?([a-z_]+)/m);
        const t = fs.statSync(p).mtimeMs;
        if (!best || t > best.t) best = { t, status: m ? m[1] : null };
      }
    }
  } catch {}
  return best ? best.status : null;
}

function defaultOps(plan) {
  const step = (name) => plan.steps.find((s) => s.step === name);
  const run = (s, extra = {}) => spawnSync(s.cmd, s.args, { cwd: s.cwd, encoding: 'utf8', shell: process.platform === 'win32' && s.cmd !== process.execPath, timeout: 60 * 60 * 1000, ...extra });
  let loginHandle = null;
  return {
    pack: () => {
      fs.mkdirSync(plan.scratch, { recursive: true });
      const r = run(step('pack'));
      const tgz = (r.stdout || '').trim().split(/\r?\n/).pop();
      if (r.status !== 0 || !tgz) return { ok: false, reason: r.stderr };
      const x = spawnSync('tar', ['-xzf', tgz], { cwd: plan.scratch, encoding: 'utf8' });
      return { ok: x.status === 0, packageDir: path.join(plan.scratch, 'package'), reason: x.stderr };
    },
    worktree: () => { const r = run(step('worktree')); return { ok: r.status === 0, reason: r.stderr }; },
    install: () => { const r = run(step('install')); return { ok: r.status === 0, reason: r.stderr }; },
    login: () => {
      const s = step('login');
      if (s.mode === 'api-key') return { ok: true };
      loginHandle = copyLogin(s.from, s.to);
      return loginHandle.ok ? { ok: true } : { ok: false, reason: loginHandle.reason };
    },
    logout: () => syncBack(loginHandle && loginHandle.ok ? loginHandle : null),
    scaffold: () => {
      const p = path.join(plan.worktree, '.planning');
      fs.mkdirSync(path.join(p, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(p, 'project.md'), '# PAN Wizard\n\n**Core value:** PAN Wizard is a spec-driven development system installed into five AI coding CLIs. Rules: CLAUDE.md at the repository root.\n', { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ mode: 'yolo', workflow: { phase_gate: 'enforce' } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(path.join(p, 'state.md'), '# Project State\n\n## Current Position\n\n**Status:** Dogfood quick task\n', { flag: 'wx', mode: 0o600 });
      return { ok: true };
    },
    session: () => {
      const s = step('session');
      const r = run(s, { env: { ...process.env, ...s.env } });
      let usd = 0;
      try { usd = Number(JSON.parse(r.stdout.trim().split('\n').pop()).total_cost_usd) || 0; } catch {}
      return { ok: r.status === 0, usd, reason: (r.stderr || '').slice(-400) };
    },
    changedFiles: () => {
      const g = (a) => spawnSync('git', a, { cwd: plan.worktree, encoding: 'utf8' }).stdout.split('\n').map((x) => x.trim()).filter(Boolean);
      return [...new Set([...g(['diff', '--name-only', 'HEAD']), ...g(['ls-files', '--others', '--exclude-standard']), ...g(['diff', '--name-only', 'HEAD@{1}', 'HEAD'])])];
    },
    cleanup: (kept) => {
      try { fs.rmSync(plan.scratch, { recursive: true, force: true }); } catch {}
      if (!kept) { spawnSync('git', ['worktree', 'remove', '--force', plan.worktree], { cwd: REPO }); spawnSync('git', ['branch', '-D', plan.branch], { cwd: REPO }); }
    },
    record: (row) => {
      fs.mkdirSync(STATE, { recursive: true });
      fs.appendFileSync(path.join(STATE, 'bot-runs.jsonl'), JSON.stringify(row) + '\n');
      // autopilot.cjs's monthly cap reads spend.jsonl.
      fs.appendFileSync(path.join(STATE, 'spend.jsonl'), JSON.stringify({ ts: row.ts, lane: 'dogfood', usd: row.usd || 0 }) + '\n');
    },
  };
}

/** Run the lane. `ops` replaces each external step (the tests pass stand-ins). */
function runDogfood(o = {}) {
  if (killed(o.env || process.env, o.state || STATE)) return { error: 'killed', reason: 'the autopilot kill switch is set' };
  if (!(Number(o.approveUsd) > 0)) return { error: 'approval_required', reason: 'the dogfood lane runs a real model: pass --approve-usd <N> for this run' };
  const plan = planDogfood(o);
  if (!plan.finding) return { ...plan, error: 'no_finding', reason: 'no open harness finding to work on' };
  const ops = { ...defaultOps(plan), ...(o.ops || {}) };
  const result = { lane: 'dogfood', id: plan.id, branch: plan.branch, finding: plan.finding, usd: 0 };
  const finish = (outcome, extra = {}) => {
    // The login copy is synced back and deleted first, on every path.
    const credentials = ops.logout ? ops.logout() : 'none';
    const r = { ...result, outcome, credentials, ...extra };
    ops.record({ ts: new Date().toISOString(), lane: 'dogfood', branch: plan.branch, outcome: outcome === 'kept' ? 'opened' : 'refused', usd: r.usd, finding: plan.finding.id, reason: r.reason, credentials });
    ops.cleanup(outcome === 'kept');
    return r;
  };
  for (const name of ['pack', 'worktree', 'install', 'login', 'scaffold']) {
    const r = ops[name]();
    if (!r || !r.ok) return finish('refused', { reason: `${name}_failed`, detail: r && r.reason });
  }
  let s;
  try { s = ops.session(); } catch (e) { return finish('refused', { reason: 'session_failed', detail: e.message }); }
  result.usd = (s && s.usd) || 0;
  const verification = latestVerification(o.worktree || plan.worktree);
  if (verification !== 'passed') return finish('refused', { reason: 'no_passing_verification', verification });
  const scope = scopeCheck(ops.changedFiles(), { paths: DOGFOOD_PATHS });
  if (!scope.ok) return finish('refused', { reason: 'scope', refused: scope.refused, verification });
  return finish('kept', { verification, scope });
}

module.exports = { planDogfood, runDogfood, pickFinding, latestVerification, ownerCredentials, copyLogin, syncBack, defaultRoot, DOGFOOD_PATHS };

if (require.main === module) {
  const i = process.argv.indexOf('--approve-usd');
  const approveUsd = i >= 0 ? Number(process.argv[i + 1]) : undefined;
  if (!approveUsd) { console.log(JSON.stringify(planDogfood({}), null, 2)); process.exit(0); }
  console.log(JSON.stringify(runDogfood({ approveUsd }), null, 2));
}
