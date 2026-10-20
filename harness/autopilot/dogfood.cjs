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

function defaultRoot() {
  if (process.env.PAN_AUTOPILOT_ROOT) return process.env.PAN_AUTOPILOT_ROOT;
  for (const c of ['C:\\Project\\pantesting', 'D:\\pantesting']) if (process.platform === 'win32' && fs.existsSync(c)) return c;
  return os.tmpdir();
}

function planDogfood(o = {}) {
  const repo = o.repo || REPO;
  const root = o.root || defaultRoot();
  const id = o.id || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
  const scratch = path.join(root, 'autopilot', `dogfood-${id}-scratch`);
  const worktree = o.worktree || path.join(root, 'autopilot', `dogfood-${id}`);
  const configDir = path.join(scratch, 'claude-config');
  const installer = path.join(scratch, 'package', 'bin', 'install.js');
  const finding = o.finding || pickFinding(repo);
  const clean = (t) => String(t || '').replace(/[\r\n&|<>%^"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  return {
    lane: 'dogfood', id, branch: `bot/dogfood/${id}`, worktree, scratch, configDir, finding,
    approval: o.approveUsd ? `approved: $${o.approveUsd}` : 'required: --approve-usd <N>',
    pushes: false,
    steps: [
      { step: 'pack', cwd: repo, cmd: 'npm', args: ['pack', '--pack-destination', scratch] },
      { step: 'worktree', cwd: repo, cmd: 'git', args: ['worktree', 'add', '-b', `bot/dogfood/${id}`, worktree, 'HEAD'] },
      { step: 'install', cwd: worktree, installer, cmd: process.execPath, args: [installer, '--claude', '--global', '--config-dir', configDir] },
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
    scaffold: () => {
      const p = path.join(plan.worktree, '.planning');
      fs.mkdirSync(path.join(p, 'phases'), { recursive: true });
      fs.writeFileSync(path.join(p, 'project.md'), '# PAN Wizard\n\n**Core value:** PAN Wizard is a spec-driven development system installed into five AI coding CLIs. Rules: CLAUDE.md at the repository root.\n');
      fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ mode: 'yolo', workflow: { phase_gate: 'enforce' } }, null, 2) + '\n');
      fs.writeFileSync(path.join(p, 'state.md'), '# Project State\n\n## Current Position\n\n**Status:** Dogfood quick task\n');
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
    record: (row) => { fs.mkdirSync(STATE, { recursive: true }); fs.appendFileSync(path.join(STATE, 'bot-runs.jsonl'), JSON.stringify(row) + '\n'); },
  };
}

/** Run the lane. `ops` replaces each external step (the tests pass stand-ins). */
function runDogfood(o = {}) {
  if (!(Number(o.approveUsd) > 0)) return { error: 'approval_required', reason: 'the dogfood lane runs a real model: pass --approve-usd <N> for this run' };
  const plan = planDogfood(o);
  if (!plan.finding) return { ...plan, error: 'no_finding', reason: 'no open harness finding to work on' };
  const ops = { ...defaultOps(plan), ...(o.ops || {}) };
  const result = { lane: 'dogfood', id: plan.id, branch: plan.branch, finding: plan.finding, usd: 0 };
  const finish = (outcome, extra = {}) => {
    const r = { ...result, outcome, ...extra };
    ops.record({ ts: new Date().toISOString(), lane: 'dogfood', branch: plan.branch, outcome: outcome === 'kept' ? 'opened' : 'refused', usd: r.usd, finding: plan.finding.id, reason: r.reason });
    ops.cleanup(outcome === 'kept');
    return r;
  };
  for (const name of ['pack', 'worktree', 'install', 'scaffold']) {
    const r = ops[name]();
    if (!r || !r.ok) return finish('refused', { reason: `${name}_failed`, detail: r && r.reason });
  }
  const s = ops.session();
  result.usd = (s && s.usd) || 0;
  const verification = latestVerification(o.worktree || plan.worktree);
  if (verification !== 'passed') return finish('refused', { reason: 'no_passing_verification', verification });
  const scope = scopeCheck(ops.changedFiles(), { paths: DOGFOOD_PATHS });
  if (!scope.ok) return finish('refused', { reason: 'scope', refused: scope.refused, verification });
  return finish('kept', { verification, scope });
}

module.exports = { planDogfood, runDogfood, pickFinding, latestVerification, DOGFOOD_PATHS };

if (require.main === module) {
  const i = process.argv.indexOf('--approve-usd');
  const approveUsd = i >= 0 ? Number(process.argv[i + 1]) : undefined;
  if (!approveUsd) { console.log(JSON.stringify(planDogfood({}), null, 2)); process.exit(0); }
  console.log(JSON.stringify(runDogfood({ approveUsd }), null, 2));
}
