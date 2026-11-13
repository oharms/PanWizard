#!/usr/bin/env node
'use strict';
/**
 * Does this test catch the bug it was written for?
 *
 * A new test that passes proves little: it may pass with the fix and without it. This
 * check runs the named tests twice. First on the working tree, where they must pass.
 * Then in a throwaway `git worktree` of the base, with every changed file brought over
 * EXCEPT the source under test, so the tests are new and the code is old. There they
 * must fail. Market-ideas M65 (MI-162), after GBrain's `check-test-discriminates.sh`.
 *
 *   node scripts/check-test-discriminates.cjs tests/foo.test.cjs
 *   node scripts/check-test-discriminates.cjs tests/foo.test.cjs --src pan-wizard-core/bin/lib/foo.cjs
 *   node scripts/check-test-discriminates.cjs tests/foo.test.cjs --base origin/main --json
 *
 * Base: `--base <ref>`; else HEAD when the working tree has changes (an uncommitted fix),
 * else HEAD~1 (the fix is the last commit). Source under test: `--src <path>` (repeatable);
 * else every changed file outside `tests/`. Exit 0 the tests discriminate, 1 they pass
 * without the fix too, 2 the check could not be made (bad arguments, nothing to revert,
 * or the tests fail on the working tree).
 *
 * Never edits the checkout: the worktree is removed at the end, including after a crash.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const USAGE = 'node scripts/check-test-discriminates.cjs <test-file>... [--base <ref>] [--src <path>]... [--timeout ms] [--json]';

function parseArgs(argv) {
  const a = { tests: [], src: [], base: null, json: false, timeoutMs: 600000, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--base') { if (!v) throw new Error('--base needs a ref'); a.base = v; i++; }
    else if (k === '--src') { if (!v) throw new Error('--src needs a path'); a.src.push(v); i++; }
    else if (k === '--timeout') { a.timeoutMs = Math.max(10000, Number(v) || 10000); i++; }
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else if (k.startsWith('--')) throw new Error(`unknown argument: ${k}`);
    else a.tests.push(k);
  }
  return a;
}

const posix = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Files that differ between `base` and the working tree, untracked ones included.
 * @returns {Array<{path: string, deleted: boolean}>}
 */
function changedFiles(root, base) {
  const out = new Map();
  for (const line of git(root, ['diff', '--name-status', '--no-renames', base]).split('\n')) {
    const m = line.match(/^([A-Z])\d*\t(.+)$/);
    if (m) out.set(posix(m[2]), { path: posix(m[2]), deleted: m[1] === 'D' });
  }
  for (const line of git(root, ['ls-files', '--others', '--exclude-standard']).split('\n')) {
    if (line.trim()) out.set(posix(line.trim()), { path: posix(line.trim()), deleted: false });
  }
  return [...out.values()].sort((x, y) => x.path.localeCompare(y.path));
}

/**
 * Which changed files keep their working-tree version in the reverted run, and which go
 * back to the base. Pure, so the rule is testable without git.
 * @returns {{revert: string[], overlay: Array<{path: string, deleted: boolean}>}}
 */
function planOverlay(changed, tests, src) {
  const wanted = src.map(posix);
  const isSrc = wanted.length
    ? (p) => wanted.includes(p)
    : (p) => !p.startsWith('tests/') && !tests.map(posix).includes(p);
  return {
    revert: changed.filter((c) => isSrc(c.path)).map((c) => c.path),
    overlay: changed.filter((c) => !isSrc(c.path)),
  };
}

/** Run the tests in `cwd`; returns {passed, failed, timedOut}. */
function runTests(cwd, tests, timeoutMs) {
  // A parent `node --test` sets NODE_TEST_CONTEXT, which turns a nested `node --test`
  // into a reporting child whose exit status no longer says whether its tests passed.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  const r = spawnSync(process.execPath, ['--test', ...tests], {
    cwd, env, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    passed: r.status === 0,
    timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'),
    fail: num(/^[ℹ#] fail (\d+)/m),
    pass: num(/^[ℹ#] pass (\d+)/m),
  };
}

function check(args, cwd = process.cwd()) {
  // Real paths on both sides: git prints the long form of a path that the cwd may hold in
  // its Windows 8.3 short form, and a relative path between the two spellings walks out of
  // the repository, so the reverted run would load the checkout's own copy of the test.
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const root = real(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  const tests = [];
  for (const t of args.tests) {
    const abs = path.resolve(cwd, t);
    if (!fs.existsSync(abs)) return { verdict: 'error', reason: `no such test file: ${t}` };
    const rel = posix(path.relative(root, real(abs)));
    if (rel.startsWith('../') || path.isAbsolute(rel)) return { verdict: 'error', reason: `test file is outside the repository: ${t}` };
    tests.push(rel);
  }
  const dirty = git(root, ['status', '--porcelain']).trim() !== '';
  const base = args.base || (dirty ? 'HEAD' : 'HEAD~1');
  try { git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); } catch {
    return { verdict: 'error', reason: `base ${base} is not a commit` };
  }
  const changed = changedFiles(root, base);
  const plan = planOverlay(changed, tests, args.src);
  if (!plan.revert.length) {
    return { verdict: 'error', base, reason: args.src.length ? `none of --src differs from ${base}` : `no source file outside tests/ differs from ${base}` };
  }

  const current = runTests(root, tests, args.timeoutMs);
  if (!current.passed) {
    return { verdict: 'error', base, revert: plan.revert, current, reason: 'the tests fail on the working tree; fix them before asking whether they discriminate' };
  }

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-discriminate-'));
  let created = false;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', wt, base], { cwd: root, stdio: 'ignore' });
    created = true;
    for (const f of plan.overlay) {
      const dest = path.join(wt, f.path);
      if (f.deleted) { fs.rmSync(dest, { force: true }); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, f.path), dest);
    }
    // Tests that spawn the built hooks need hooks/dist in the worktree (this repository).
    if (fs.existsSync(path.join(wt, 'scripts', 'build-hooks.js'))) {
      spawnSync(process.execPath, ['scripts/build-hooks.js'], { cwd: wt, stdio: 'ignore' });
    }
    const reverted = runTests(wt, tests, args.timeoutMs);
    return {
      verdict: reverted.passed ? 'does-not-discriminate' : 'discriminates',
      base, revert: plan.revert, overlaid: plan.overlay.map((f) => f.path), current, reverted,
    };
  } finally {
    if (created) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root, stdio: 'ignore' }); } catch { /* fall through */ }
    }
    fs.rmSync(wt, { recursive: true, force: true });
    try { execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'ignore' }); } catch { /* best effort */ }
  }
}

function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(`${e.message}\n${USAGE}\n`); return 2; }
  if (args.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  if (!args.tests.length) { process.stderr.write(`name at least one test file\n${USAGE}\n`); return 2; }
  const r = check(args);
  const code = r.verdict === 'discriminates' ? 0 : r.verdict === 'does-not-discriminate' ? 1 : 2;
  if (args.json) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    return code;
  }
  if (r.verdict === 'error') {
    process.stderr.write(`cannot check: ${r.reason}\n`);
    return code;
  }
  const lines = [
    `base ${r.base}; reverted to it: ${r.revert.join(', ')}`,
    r.verdict === 'discriminates'
      ? `DISCRIMINATES: the tests pass on the working tree and fail with the source reverted (${r.reverted.fail ?? '?'} failing)`
      : 'DOES NOT DISCRIMINATE: the tests pass with the source reverted too, so they do not pin the fix',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return code;
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, planOverlay, changedFiles, check, main };
