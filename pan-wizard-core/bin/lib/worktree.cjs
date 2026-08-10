/**
 * Worktree — branch-per-agent isolation for the bot army (ADR-0033).
 *
 * The Build squad parallelizes by giving each builder its own git worktree
 * on its own `army/<task>` branch, so concurrent agents never touch the same
 * working tree or the same file. Generalizes the worktree primitive proven in
 * whatif.cjs; the army campaign command drives it. Zero deps, synchronous,
 * cross-platform (delegates to execGit).
 */

'use strict';

const path = require('path');
const { execGit, isGitRepo, toPosix, generateSlugInternal, output, error } = require('./core.cjs');

const ARMY_BRANCH_PREFIX = 'army/';

/**
 * Create an isolated worktree + branch for one army task.
 * @param {string} cwd - main project root
 * @param {string} task - free-text task name (slugified for branch/path)
 * @param {Object} [opts] - { base: ref (default 'HEAD'), worktree_root }
 * @returns {{worktree_path, branch, base}|{error}}
 */
function createTaskWorktree(cwd, task, opts) {
  if (!task || !String(task).trim()) return { error: 'task name required' };
  if (!isGitRepo(cwd)) return { error: 'Not a git repo — branch-per-agent requires git worktree support' };

  const slug = generateSlugInternal(String(task)).slice(0, 40);
  const branch = `${ARMY_BRANCH_PREFIX}${slug}`;
  const worktreeRoot = opts?.worktree_root
    || path.join(path.dirname(path.resolve(cwd)), `pan-army-${slug}`);
  const base = opts?.base || 'HEAD';

  const result = execGit(cwd, ['worktree', 'add', '-b', branch, worktreeRoot, base]);
  if (result.exitCode !== 0) {
    return { error: `git worktree add failed: ${result.stderr}` };
  }
  return { worktree_path: toPosix(worktreeRoot), branch, base };
}

/**
 * Remove an army worktree + its branch. Best-effort; warnings surfaced.
 * @returns {{removed: true, warnings: string[]}|{error}}
 */
function removeTaskWorktree(cwd, worktreePath, branch, opts) {
  if (!isGitRepo(cwd)) return { error: 'Not a git repo' };
  const warnings = [];
  const rmArgs = ['worktree', 'remove'];
  if (opts?.force === true) rmArgs.push('--force');
  rmArgs.push(worktreePath);
  const rm = execGit(cwd, rmArgs);
  if (rm.exitCode !== 0) warnings.push(`worktree remove: ${rm.stderr.trim()}`);

  if (branch) {
    // Only delete branches we created (army/ prefix), and only if not checked out.
    if (branch.startsWith(ARMY_BRANCH_PREFIX)) {
      const del = execGit(cwd, ['branch', '-D', branch]);
      if (del.exitCode !== 0) warnings.push(`branch -D ${branch}: ${del.stderr.trim()}`);
    } else {
      warnings.push(`refused to delete non-army branch ${branch}`);
    }
  }
  return { removed: true, warnings };
}

/**
 * List the army worktrees currently registered (army/ branches only).
 * Parses `git worktree list --porcelain`.
 * @returns {Array<{worktree, branch}>}
 */
function listArmyWorktrees(cwd) {
  if (!isGitRepo(cwd)) return [];
  const r = execGit(cwd, ['worktree', 'list', '--porcelain']);
  if (r.exitCode !== 0) return [];
  const out = [];
  let current = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { worktree: toPosix(line.slice('worktree '.length).trim()) };
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim().replace('refs/heads/', '');
      current.branch = ref;
      if (ref.startsWith(ARMY_BRANCH_PREFIX)) out.push({ ...current });
    } else if (line === '') {
      current = {};
    }
  }
  return out;
}

/**
 * Sweep every army worktree and orphaned army/ branch (P-1815, PanLoop
 * finding 13). The what-if subsystem always had this (`whatif cleanup`); the
 * army path created worktrees that nothing removed — sibling `pan-army-*`
 * directories and `army/*` branches accumulated after every campaign.
 *
 * Safety posture (the L3 lesson — never trade clutter for silent data loss):
 * - A DIRTY worktree is kept unless `force` — git refuses, we surface why.
 * - A branch is deleted only when its tip is reachable from HEAD (truly
 *   integrated). Squash-merged and aborted branches are NOT reachable and may
 *   hold the only copy of real work, so by default they are KEPT and listed
 *   with the exact command to delete them; `force` sweeps them too.
 *   (The per-task Phase 5 teardown — `worktree remove --branch` right after
 *   the merge lands — deletes unconditionally; at that moment the deletion is
 *   the documented intent. The sweeper is the abort/orphan tool, so it errs
 *   the other way.)
 * @param {string} cwd - main project root
 * @param {Object} [opts] - { force: boolean }
 * @returns {{removed_worktrees, deleted_branches, kept, pruned, clean}|{error}}
 */
function cleanupArmyWorktrees(cwd, opts) {
  if (!isGitRepo(cwd)) return { error: 'Not a git repo' };
  const force = opts?.force === true;
  const removedWorktrees = [];
  const deletedBranches = [];
  const kept = [];

  const branchIsIntegrated = (branch) =>
    execGit(cwd, ['merge-base', '--is-ancestor', branch, 'HEAD']).exitCode === 0;

  const deleteBranch = (branch, hadWorktree) => {
    if (force || branchIsIntegrated(branch)) {
      const del = execGit(cwd, ['branch', '-D', branch]);
      if (del.exitCode === 0) deletedBranches.push(branch);
      else kept.push({ branch, reason: `branch -D failed: ${del.stderr.trim()}` });
    } else {
      kept.push({
        branch,
        reason: `carries commits not reachable from HEAD (squash-merged or aborted work${hadWorktree ? '' : '; no worktree attached'}) — rerun with --force, or: git branch -D ${branch}`,
      });
    }
  };

  // 1. Registered army worktrees. Track every branch step 1 has already
  //    decided on — deleted OR deliberately kept — so the orphan scan below
  //    does not re-process (and double-report) it.
  const handledBranches = new Set();
  for (const t of listArmyWorktrees(cwd)) {
    const rmArgs = ['worktree', 'remove'];
    if (force) rmArgs.push('--force');
    rmArgs.push(t.worktree);
    const rm = execGit(cwd, rmArgs);
    if (rm.exitCode !== 0) {
      kept.push({ worktree: t.worktree, branch: t.branch, reason: `worktree remove refused: ${rm.stderr.trim()} — pass --force to discard uncommitted changes` });
      if (t.branch) handledBranches.add(t.branch);
      continue;
    }
    removedWorktrees.push(t.worktree);
    if (t.branch) {
      handledBranches.add(t.branch);
      deleteBranch(t.branch, true);
    }
  }

  // 2. Drop stale registrations (a manually deleted directory leaves one).
  const pruned = execGit(cwd, ['worktree', 'prune']).exitCode === 0;

  // 3. Orphaned army/ branches — a worktree removed without its branch.
  const stillAttached = new Set(listArmyWorktrees(cwd).map(t => t.branch));
  const ls = execGit(cwd, ['branch', '--list', `${ARMY_BRANCH_PREFIX}*`, '--format=%(refname:short)']);
  if (ls.exitCode === 0) {
    for (const branch of ls.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      if (!stillAttached.has(branch) && !handledBranches.has(branch)) deleteBranch(branch, false);
    }
  }

  return {
    removed_worktrees: removedWorktrees,
    deleted_branches: deletedBranches,
    kept,
    pruned,
    clean: kept.length === 0,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function cmdWorktreeList(cwd, raw) {
  const trees = listArmyWorktrees(cwd);
  const human = trees.length
    ? trees.map(t => `${t.branch}  →  ${t.worktree}`).join('\n')
    : 'No army worktrees';
  output({ worktrees: trees, count: trees.length }, raw, human);
}

function cmdWorktreeCreate(cwd, task, raw, opts) {
  const r = createTaskWorktree(cwd, task, opts);
  if (r.error) return error(r.error);
  output(r, raw, `${r.branch} → ${r.worktree_path}`);
}

function cmdWorktreeRemove(cwd, worktreePath, branch, raw, opts) {
  if (!worktreePath) return error('worktree path required');
  const r = removeTaskWorktree(cwd, worktreePath, branch, opts);
  if (r.error) return error(r.error);
  output(r, raw, r.warnings.length ? r.warnings.join('\n') : 'removed');
}

function cmdWorktreeCleanup(cwd, raw, opts) {
  const r = cleanupArmyWorktrees(cwd, opts);
  if (r.error) return error(r.error);
  const lines = [
    ...r.removed_worktrees.map(w => `removed worktree ${w}`),
    ...r.deleted_branches.map(b => `deleted branch ${b}`),
    ...r.kept.map(k => `KEPT ${k.worktree || k.branch}: ${k.reason}`),
  ];
  output(r, raw, lines.length ? lines.join('\n') : 'nothing to clean');
}

module.exports = {
  ARMY_BRANCH_PREFIX,
  createTaskWorktree,
  removeTaskWorktree,
  listArmyWorktrees,
  cleanupArmyWorktrees,
  cmdWorktreeList,
  cmdWorktreeCreate,
  cmdWorktreeRemove,
  cmdWorktreeCleanup,
};
