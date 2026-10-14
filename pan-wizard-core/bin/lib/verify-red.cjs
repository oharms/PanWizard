'use strict';
/**
 * RED and catch proof (program V4): does each test this phase wrote actually test what
 * the phase built?
 *
 * A test that passes before the phase's code exists cannot have caught anything: it is
 * tautological, or it tests something the phase did not change. So, independent of the
 * order the commits landed in (Meta's "weak catch"):
 *
 *   base    the parent of the phase's oldest plan commit (`{type}({phase}-{plan}):`)
 *   tests   the test files the phase's plan commits added or changed, as they are now
 *   red     in a throwaway worktree at the base, with the test file copied in from HEAD,
 *           the test must FAIL (a crash on a missing module counts: the code is not there)
 *   green   at HEAD it must PASS
 *
 *   caught       red at the base, green at HEAD
 *   not_red      passes without the phase's code: it cannot have caught a regression
 *   not_green    fails at HEAD: the test gate reports that, not this check
 *   not_checked  no command can run that one file (cargo, Maven, Gradle, make), with why
 *
 * Each file runs on its own (`workflow.test_file_command`, else derived from the suite's
 * runner: test-gate.cjs `fileCommand`). The worktree links the project's node_modules,
 * which git does not track, so a JS runner resolves the same at the base as at HEAD.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execGit, findPhaseInternal, output, error } = require('./core.cjs');
const { committedFiles } = require('./verify-scope.cjs');
const { isTestFile } = require('./verify-integrity.cjs');
const TG = require('./test-gate.cjs');

const DEFAULT_FILE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The commit the phase started from: the parent of its oldest plan commit.
 * @returns {{base: string, files: Set<string>, commits: number}|{base: null, reason: string}}
 */
function phaseBase(cwd, phase) {
  const c = committedFiles(cwd, phase);
  if (!c.git) return { base: null, reason: 'git is unavailable' };
  if (!c.commits) return { base: null, reason: 'the phase has no plan commits (subjects like feat(03-01): …)' };
  const oldest = c.hashes[c.hashes.length - 1];
  const r = execGit(cwd, ['rev-parse', '--verify', '-q', `${oldest}^`]);
  if (r.exitCode !== 0 || !r.stdout) return { base: null, reason: 'the phase starts at the first commit of the repository: there is no base to run against' };
  return { base: r.stdout.trim(), files: c.files, commits: c.commits };
}

/** Remove a directory link (a junction or a symlink) without touching what it points to. */
function unlinkDir(p) {
  try { fs.unlinkSync(p); } catch { try { fs.rmdirSync(p); } catch { /* already gone */ } }
}

/**
 * Run `fn(dir)` in a detached worktree at `rev`, then remove the worktree. The project's
 * node_modules is linked in (and unlinked before git removes the worktree, so the removal
 * can never reach the real one).
 * @returns {{value?: *, error?: string}}
 */
function withWorktree(cwd, rev, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-wt-'));
  const dir = path.join(root, 'wt');
  const add = execGit(cwd, ['worktree', 'add', '--detach', '-q', dir, rev]);
  if (add.exitCode !== 0) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    return { error: `git worktree add failed: ${add.stderr || add.stdout}` };
  }
  const link = path.join(dir, 'node_modules');
  let linked = false;
  try {
    const modules = path.join(cwd, 'node_modules');
    if (fs.existsSync(modules) && !fs.existsSync(link)) {
      try { fs.symlinkSync(modules, link, 'junction'); linked = true; } catch { /* runs without it */ }
    }
    return { value: fn(dir) };
  } finally {
    if (linked) unlinkDir(link);
    execGit(cwd, ['worktree', 'remove', '--force', dir]);
    execGit(cwd, ['worktree', 'prune']);
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const tail = (s) => TG.stripAnsi(String(s || '')).replace(/\r\n?/g, '\n').trim().split('\n').slice(-6).join('\n');

/**
 * The RED/catch proof for one phase.
 * @param {string} cwd
 * @param {string} phase
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Object} `{phase, checked, ok, base, files: [{file, verdict, command, base_exit, head_exit, detail}], reason?}` or `{error, reason}`
 */
function checkRed(cwd, phase, opts = {}) {
  const info = findPhaseInternal(cwd, phase);
  if (!info) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const phaseNumber = info.phase_number || String(phase);
  const b = phaseBase(cwd, phaseNumber);
  if (!b.base) return { phase: phaseNumber, checked: false, ok: true, files: [], reason: b.reason };
  const tests = [...b.files].filter((f) => isTestFile(f) && fs.existsSync(path.join(cwd, f))).sort();
  if (!tests.length) return { phase: phaseNumber, checked: false, ok: true, base: b.base, files: [], reason: 'the phase changed no test file' };
  const timeoutMs = opts.timeoutMs || DEFAULT_FILE_TIMEOUT_MS;
  const files = [];
  const wt = withWorktree(cwd, b.base, (dir) => {
    for (const file of tests) {
      const fc = TG.fileCommand(cwd, file);
      if (!fc.command) { files.push({ file, verdict: 'not_checked', detail: fc.reason }); continue; }
      const dest = path.join(dir, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(cwd, file), dest);
      const atBase = TG.runCommand(dir, fc.command, timeoutMs);
      const atHead = TG.runCommand(cwd, fc.command, timeoutMs);
      const red = atBase.exit !== 0;
      const green = atHead.exit === 0;
      const verdict = red && green ? 'caught' : (!red ? 'not_red' : 'not_green');
      const detail = verdict === 'not_red'
        ? 'passes without the phase\'s code: it is tautological, or tests something the phase did not change'
        : verdict === 'not_green' ? `fails at HEAD: ${tail(atHead.output)}` : null;
      files.push({ file, verdict, command: fc.command, base_exit: atBase.exit, head_exit: atHead.exit, ...(detail ? { detail } : {}) });
    }
  });
  if (wt.error) return { phase: phaseNumber, checked: false, ok: true, base: b.base, files: [], reason: wt.error };
  const ran = files.filter((f) => f.verdict !== 'not_checked');
  return {
    phase: phaseNumber, checked: ran.length > 0, ok: ran.every((f) => f.verdict === 'caught'), base: b.base,
    caught: ran.filter((f) => f.verdict === 'caught').length, files,
    ...(ran.length ? {} : { reason: 'no changed test file could be run on its own' }),
  };
}

/** `pan-tools verify red <phase> [--timeout <ms>]`: exit 1 when a test is not_red or not_green. */
function cmdVerifyRed(cwd, phase, raw, opts = {}) {
  if (!phase) error('Usage: verify red <phase> [--timeout <ms>]');
  const r = checkRed(cwd, phase, { timeoutMs: opts.timeout ? Number(opts.timeout) : undefined });
  if (r.error) error(r.reason);
  output(r, raw, !r.checked ? 'not_checked' : (r.ok ? 'caught' : 'not_caught'), r.ok ? 0 : 1);
}

module.exports = { checkRed, cmdVerifyRed, phaseBase, withWorktree };
