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

module.exports = {
  ARMY_BRANCH_PREFIX,
  createTaskWorktree,
  removeTaskWorktree,
  listArmyWorktrees,
  cmdWorktreeList,
  cmdWorktreeCreate,
  cmdWorktreeRemove,
};
