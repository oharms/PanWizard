#!/usr/bin/env node
/**
 * land.cjs — land a branch on main without a pull request (`npm run land -- <branch>`;
 * local-first plan, phase 3). GitHub stays the mirror: main is pushed there, never forced.
 *
 * Refuses unless:
 *   - a full `npm run ci:local` passed on the branch's current HEAD, from a tree with no
 *     uncommitted changes, with no gate skipped (scripts/local-ci.cjs records the verdict in
 *     the git directory, pan-ci-local/<sha>.json, shared by every worktree);
 *   - the branch contains origin/main, so the squash commit's tree is exactly the tree
 *     ci:local passed (merge or rebase main into the branch and run ci:local again if not);
 *   - the checkout that has main (or a temporary one) is clean and main can fast-forward
 *     to origin/main.
 *
 * Then: fetch origin, fast-forward main to origin/main, `git merge --squash <branch>`, commit
 * with the branch's summary (the title is its first commit's subject, or --title; the body
 * lists every commit), and `git push origin main`. A rejected push leaves the commit on the
 * local main and says so; nothing is forced, and the branch itself is left alone.
 *
 * Usage:
 *   node scripts/land.cjs <branch> [--title "..."] [--dry-run] [--no-push] [--allow-skips]
 *        [--remote origin] [--main main]
 * Exit 0 landed (or the dry run would land), 1 refused or failed, 2 usage.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error ? r.error.message : '') };
}

function parseArgs(argv) {
  const a = { branch: null, title: null, dryRun: false, push: true, allowSkips: false, remote: 'origin', main: 'main' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--title') a.title = argv[++i];
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--no-push') a.push = false;
    else if (k === '--allow-skips') a.allowSkips = true;
    else if (k === '--remote') a.remote = argv[++i];
    else if (k === '--main') a.main = argv[++i];
    else if (k.startsWith('--')) throw new Error(`unknown option: ${k}`);
    else if (!a.branch) a.branch = k;
    else throw new Error(`one branch at a time (got ${a.branch} and ${k})`);
  }
  if (!a.branch) throw new Error('usage: land.cjs <branch> [--title T] [--dry-run] [--no-push] [--allow-skips]');
  return a;
}

/** Why ci:local's verdict does not clear `sha` for landing, or null when it does. Pure. */
function verdictProblem(verdict, sha, { allowSkips = false } = {}) {
  if (!verdict) return `no ci:local verdict for ${sha.slice(0, 9)} — run \`npm run ci:local\` on the branch at that commit`;
  if (verdict.headFull !== sha) return `the verdict is for ${String(verdict.headFull).slice(0, 9)}, not ${sha.slice(0, 9)}`;
  if (verdict.options && (verdict.options.only || verdict.options.fast)) return 'the verdict is from a partial run (--only or --fast); run the full ci:local';
  if (verdict.dirtyAtStart !== false) return 'ci:local ran with uncommitted changes, so it did not test this commit alone; commit or stash them and run it again';
  if (verdict.status !== 'pass') return `ci:local failed on ${sha.slice(0, 9)}: ${(verdict.gates || []).filter(g => g.status === 'fail').map(g => g.id).join(', ') || 'see its report'}`;
  const skipped = (verdict.gates || []).filter(g => g.status === 'skip').map(g => g.id);
  if (skipped.length && !allowSkips) return `ci:local skipped ${skipped.join(', ')}; install what they need, or pass --allow-skips`;
  return null;
}

/** The squash commit's message: a title, and the branch's commits as the body. Pure. */
function commitMessage(branch, subjects, title) {
  const head = title || subjects[0] || `Land ${branch}`;
  const body = subjects.length > 1 || (title && subjects.length) ? `\n\nSquashed from ${branch}:\n${subjects.map(s => `- ${s}`).join('\n')}` : '';
  return `${head}${body}\n`;
}

// The worktree that has `main` checked out, if any.
function mainCheckout(cwd, main) {
  const list = git(cwd, ['worktree', 'list', '--porcelain']).out;
  for (const block of list.split(/\n\n+/)) {
    const wt = (block.match(/^worktree (.+)$/m) || [])[1];
    if (wt && new RegExp(`^branch refs/heads/${main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(block)) return path.resolve(wt);
  }
  return null;
}

function land(argv, cwd = process.cwd(), log = console.log) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(`land: ${e.message}`); return 2; }
  const refuse = (why) => { log(`land: refused — ${why}`); return 1; };

  const sha = git(cwd, ['rev-parse', '--verify', `refs/heads/${o.branch}^{commit}`]);
  if (!sha.ok) return refuse(`no local branch ${o.branch}`);
  if (o.branch === o.main) return refuse(`${o.branch} is the branch it would land on`);

  const common = path.resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).out);
  let verdict = null;
  try { verdict = JSON.parse(fs.readFileSync(path.join(common, 'pan-ci-local', `${sha.out}.json`), 'utf8')); } catch { /* none */ }
  const problem = verdictProblem(verdict, sha.out, o);
  if (problem) return refuse(problem);

  const fetched = git(cwd, ['fetch', o.remote, o.main]);
  if (!fetched.ok) return refuse(`git fetch ${o.remote} ${o.main}: ${fetched.err}`);
  const upstream = `refs/remotes/${o.remote}/${o.main}`;
  if (!git(cwd, ['merge-base', '--is-ancestor', upstream, sha.out]).ok) {
    return refuse(`${o.branch} does not contain ${o.remote}/${o.main}; merge or rebase it onto ${o.remote}/${o.main}, then run ci:local again`);
  }
  const subjects = git(cwd, ['log', '--reverse', '--format=%s', `${upstream}..${sha.out}`]).out.split('\n').filter(Boolean);
  if (!subjects.length) return refuse(`${o.branch} has nothing that ${o.remote}/${o.main} lacks`);
  const message = commitMessage(o.branch, subjects, o.title);

  let where = mainCheckout(cwd, o.main);
  if (where && git(where, ['status', '--porcelain']).out) return refuse(`the checkout with ${o.main} (${where}) has uncommitted changes`);
  if (o.dryRun) {
    log(`land: would squash ${subjects.length} commit(s) of ${o.branch} (${sha.out.slice(0, 9)}) onto ${o.remote}/${o.main} in ${where || 'a temporary worktree'}${o.push ? ` and push ${o.main} to ${o.remote}` : ''}:\n\n${message}`);
    return 0;
  }

  let temp = null;
  if (!where) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-land-'));
    const hasMain = git(cwd, ['rev-parse', '--verify', `refs/heads/${o.main}`]).ok;
    const add = git(cwd, hasMain ? ['worktree', 'add', temp, o.main] : ['worktree', 'add', '-b', o.main, temp, upstream]);
    if (!add.ok) { fs.rmSync(temp, { recursive: true, force: true }); return refuse(`could not check out ${o.main}: ${add.err}`); }
    where = temp;
  }
  try {
    const ff = git(where, ['merge', '--ff-only', upstream]);
    if (!ff.ok) return refuse(`local ${o.main} cannot fast-forward to ${o.remote}/${o.main} (it has commits ${o.remote} lacks): ${ff.err}`);
    const sq = git(where, ['merge', '--squash', sha.out]);
    if (!sq.ok) { git(where, ['reset', '--merge']); return refuse(`the squash merge failed: ${sq.err}`); }
    // The branch contains main, so the result is the branch's tree: anything else is a bug here.
    const tree = git(where, ['write-tree']).out;
    const want = git(cwd, ['rev-parse', `${sha.out}^{tree}`]).out;
    if (tree !== want) { git(where, ['reset', '--hard', upstream]); return refuse(`the squashed tree ${tree.slice(0, 9)} is not the tree ci:local passed (${want.slice(0, 9)})`); }
    const commit = git(where, ['commit', '--no-verify', '-F', '-'], { input: message });
    if (!commit.ok) { git(where, ['reset', '--merge']); return refuse(`git commit: ${commit.err}`); }
    const landed = git(where, ['rev-parse', 'HEAD']).out;
    log(`land: ${o.branch} squashed onto ${o.main} as ${landed.slice(0, 9)}`);
    if (!o.push) { log(`land: not pushed (--no-push); push with \`git push ${o.remote} ${o.main}\``); return 0; }
    // Never forced: a push the remote rejects (it moved, or branch protection) stops here.
    const push = git(where, ['push', o.remote, `refs/heads/${o.main}:refs/heads/${o.main}`]);
    if (!push.ok) { log(`land: the push to ${o.remote} was rejected; ${landed.slice(0, 9)} is on the local ${o.main} only:\n${push.err}`); return 1; }
    log(`land: pushed ${o.main} to ${o.remote}`);
    return 0;
  } finally {
    if (temp) { git(cwd, ['worktree', 'remove', '--force', temp]); fs.rmSync(temp, { recursive: true, force: true }); }
  }
}

module.exports = { parseArgs, verdictProblem, commitMessage, mainCheckout, land };

if (require.main === module) process.exit(land(process.argv.slice(2)));
