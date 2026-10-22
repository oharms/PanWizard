'use strict';
/**
 * CI as an oracle for the autodev loop (program A2).
 *
 * The loop never takes a session's word for its tests. Locally the oracle is the phase
 * gate and the test-run engine (V1, V2); with `autodev run --ci` it is also the pull
 * request's checks, read through GitHub's `gh` CLI (optional: without it the CI oracle
 * is `unavailable`). A check that already fails on the base branch is not this change's
 * doing and is ignored. The failing log tail is what a fix round gets as feedback, and a
 * breaker stops after N rounds.
 *
 * `autodev run --ci local` needs no pull request: the oracle is the project's own gate,
 * run here — `npm run ci:local` when package.json has that script, else `npm test`.
 */

const { spawnSync } = require('child_process');

const DEFAULT_CI_ROUNDS = 3;

function defaultExec(cwd) {
  const refused = require('./autodev.cjs').standinMissing('gh');
  if (refused) return () => ({ status: null, error: new Error(refused), stdout: '', stderr: refused });
  return (args) => spawnSync('gh', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000 });
}

function parseJson(r) {
  if (!r || r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

const BUCKET = { pass: 'pass', fail: 'fail', pending: 'pending', skipping: 'skip', cancel: 'fail' };
function bucketOf(c) {
  if (c.bucket && BUCKET[c.bucket]) return BUCKET[c.bucket];
  const s = String(c.state || c.conclusion || '').toUpperCase();
  if (['SUCCESS', 'NEUTRAL'].includes(s)) return 'pass';
  if (['SKIPPED'].includes(s)) return 'skip';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s)) return 'fail';
  return 'pending';
}

/** Names (check and workflow) whose latest run on the base branch failed. */
function baseFailing(exec, base) {
  if (!base) return new Set();
  const runs = parseJson(exec(['run', 'list', '--branch', base, '--limit', '30', '--json', 'name,workflowName,conclusion']));
  const latest = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    const key = r.workflowName || r.name;
    if (!latest.has(key)) latest.set(key, r);
  }
  const out = new Set();
  for (const [key, r] of latest) if (String(r.conclusion).toLowerCase() === 'failure') { out.add(key); if (r.name) out.add(r.name); }
  return out;
}

function logTail(exec, checks) {
  for (const c of checks) {
    const m = String(c.link || '').match(/\/actions\/runs\/(\d+)/);
    if (!m) continue;
    const r = exec(['run', 'view', m[1], '--log-failed']);
    if (r && r.status === 0 && r.stdout) return r.stdout.trim().split(/\r?\n/).slice(-40).join('\n');
  }
  return '';
}

/**
 * The CI oracle for the current branch's pull request.
 * @param {string} cwd
 * @param {{exec?: Function, ref?: string, base?: string, head?: string}} opts
 * @returns {{status: 'passed'|'failed'|'pending'|'unavailable'|'stale', failed: string[], ignored: string[], tail: string, reason?: string}}
 */
function ciOracle(cwd, opts = {}) {
  const exec = opts.exec || defaultExec(cwd);
  const res = { status: 'unavailable', failed: [], ignored: [], tail: '' };
  const checksRaw = exec(['pr', 'checks', ...(opts.ref ? [opts.ref] : []), '--json', 'name,state,bucket,link,workflow']);
  if (!checksRaw || checksRaw.error || checksRaw.status == null) return { ...res, reason: 'gh is not available' };
  const checks = parseJson(checksRaw);
  if (!Array.isArray(checks)) return { ...res, reason: (checksRaw.stderr || 'no pull request checks').trim().slice(0, 200) };
  if (opts.head) {
    const pr = parseJson(exec(['pr', 'view', ...(opts.ref ? [opts.ref] : []), '--json', 'headRefOid']));
    if (pr && pr.headRefOid && pr.headRefOid !== opts.head) return { ...res, status: 'stale', reason: `the checks are for ${pr.headRefOid.slice(0, 9)}, HEAD is ${opts.head.slice(0, 9)}: push the branch` };
  }
  const onBase = baseFailing(exec, opts.base);
  const failing = checks.filter((c) => bucketOf(c) === 'fail');
  const ignored = failing.filter((c) => onBase.has(c.name) || onBase.has(c.workflow));
  const counted = failing.filter((c) => !ignored.includes(c));
  res.ignored = ignored.map((c) => c.name);
  res.failed = counted.map((c) => c.name);
  if (counted.length) return { ...res, status: 'failed', tail: logTail(exec, counted) };
  if (checks.some((c) => bucketOf(c) === 'pending')) return { ...res, status: 'pending' };
  return { ...res, status: 'passed' };
}

/** Wait for pending checks, up to `timeoutMs`. */
function waitForCi(cwd, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs || 30 * 60 * 1000);
  for (;;) {
    const r = ciOracle(cwd, opts);
    if (r.status !== 'pending' || Date.now() >= deadline) return r;
    spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${Math.min(opts.pollMs || 30000, Math.max(0, deadline - Date.now()))})`]);
  }
}

/** The project's own gate: its `ci:local` script, else its `test` script, else none. */
function localGate(cwd) {
  let scripts = {};
  try { scripts = JSON.parse(require('fs').readFileSync(require('path').join(cwd, 'package.json'), 'utf8')).scripts || {}; } catch { /* no package.json */ }
  if (scripts['ci:local']) return { name: 'ci:local', args: ['run', 'ci:local'] };
  if (scripts.test) return { name: 'test', args: ['test'] };
  return null;
}

/**
 * The local CI oracle: run the project's gate in `cwd` and judge it by its exit code.
 * With ci:local, the failing gate ids come from .ci-local/report.json.
 * @param {string} cwd
 * @param {{exec?: Function, timeoutMs?: number}} opts
 * @returns {{status: 'passed'|'failed'|'unavailable', failed: string[], ignored: string[], tail: string, reason?: string}}
 */
function localOracle(cwd, opts = {}) {
  const res = { status: 'unavailable', failed: [], ignored: [], tail: '' };
  const gate = localGate(cwd);
  if (!gate) return { ...res, reason: 'package.json has neither a ci:local nor a test script' };
  const exec = opts.exec || ((args) => spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout: opts.timeoutMs || 60 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 }));
  const r = exec(gate.args);
  if (!r || r.error || r.status == null) return { ...res, reason: `npm ${gate.args.join(' ')} did not run${r && r.error ? `: ${r.error.message}` : ''}` };
  const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(-40).join('\n');
  if (r.status === 0) return { ...res, status: 'passed', tail };
  let failed = [gate.name];
  if (gate.name === 'ci:local') {
    try {
      const report = JSON.parse(require('fs').readFileSync(require('path').join(cwd, '.ci-local', 'report.json'), 'utf8'));
      const ids = (report.gates || []).filter((g) => g.status === 'fail').map((g) => g.id);
      if (ids.length) failed = ids;
    } catch { /* the exit code is the verdict; the gate names are a courtesy */ }
  }
  return { ...res, status: 'failed', failed, tail };
}

function breakerTripped(rounds, max = DEFAULT_CI_ROUNDS) {
  return rounds >= max;
}

module.exports = { ciOracle, waitForCi, localOracle, localGate, breakerTripped, baseFailing, bucketOf, DEFAULT_CI_ROUNDS };
