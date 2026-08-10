/**
 * Tests for worktree.cjs — branch-per-agent isolation for the army (ADR-0033).
 * Uses a real temp git repo (worktrees require git).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const wt = require('../pan-wizard-core/bin/lib/worktree.cjs');

let tmpDir;

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-wt-'));
  git(['init'], tmpDir);
  git(['config', 'user.email', 't@t.dev'], tmpDir);
  git(['config', 'user.name', 'T'], tmpDir);
  git(['config', 'commit.gpgsign', 'false'], tmpDir);
  fs.writeFileSync(path.join(tmpDir, 'seed.txt'), 'seed');
  git(['add', '.'], tmpDir);
  git(['commit', '-m', 'init'], tmpDir);
});

afterEach(() => {
  // Best-effort: remove any army worktrees, then the repo.
  for (const t of wt.listArmyWorktrees(tmpDir)) {
    wt.removeTaskWorktree(tmpDir, t.worktree, t.branch, { force: true });
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  // Sibling worktree dirs live next to tmpDir; clean any we created.
  try {
    const parent = path.dirname(tmpDir);
    for (const e of fs.readdirSync(parent)) {
      if (e.startsWith('pan-army-')) {
        try { fs.rmSync(path.join(parent, e), { recursive: true, force: true }); } catch { /* */ }
      }
    }
  } catch { /* */ }
});

describe('worktree — create/list/remove lifecycle', () => {
  test('createTaskWorktree makes an army/ branch + isolated tree', () => {
    const r = wt.createTaskWorktree(tmpDir, 'API endpoints');
    assert.ok(!r.error, r.error);
    assert.ok(r.branch.startsWith('army/'), `branch should be army/-prefixed, got ${r.branch}`);
    assert.equal(r.branch, 'army/api-endpoints');
    assert.ok(fs.existsSync(r.worktree_path), 'worktree dir should exist');
    assert.ok(fs.existsSync(path.join(r.worktree_path, 'seed.txt')), 'tree should contain the base commit');
  });

  test('listArmyWorktrees returns only army/ branches', () => {
    wt.createTaskWorktree(tmpDir, 'task one');
    wt.createTaskWorktree(tmpDir, 'task two');
    const list = wt.listArmyWorktrees(tmpDir);
    assert.equal(list.length, 2);
    assert.ok(list.every(t => t.branch.startsWith('army/')));
  });

  test('removeTaskWorktree cleans tree + branch', () => {
    const r = wt.createTaskWorktree(tmpDir, 'temp work');
    const rm = wt.removeTaskWorktree(tmpDir, r.worktree_path, r.branch, { force: true });
    assert.ok(!rm.error, rm.error);
    assert.ok(!fs.existsSync(r.worktree_path), 'worktree dir should be gone');
    assert.equal(wt.listArmyWorktrees(tmpDir).length, 0);
  });

  test('removeTaskWorktree refuses to delete a non-army branch', () => {
    const r = wt.createTaskWorktree(tmpDir, 'careful');
    const rm = wt.removeTaskWorktree(tmpDir, r.worktree_path, 'main', { force: true });
    assert.ok(rm.warnings.some(w => /refused to delete non-army/.test(w)));
  });

  test('createTaskWorktree errors without a task name', () => {
    assert.ok(wt.createTaskWorktree(tmpDir, '').error);
  });

  test('createTaskWorktree errors outside a git repo', () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-nogit-'));
    try {
      assert.match(wt.createTaskWorktree(nonGit, 'x').error, /git/i);
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });
});

describe('worktree cleanup — the campaign teardown sweep (P-1815, PanLoop finding 13)', () => {
  // REVERT CHECK: /pan:army created sibling pan-army-* worktrees and army/*
  // branches that NOTHING removed — `worktree remove` existed but was invoked
  // from nowhere in the army path. The sweeper is the abort/orphan half of the
  // fix; the Phase 5 per-task teardown is prose in army.md.

  function commitIn(dir, name) {
    fs.writeFileSync(path.join(dir, name), name);
    git(['add', '.'], dir);
    git(['commit', '-m', `add ${name}`], dir);
  }

  test('fresh worktrees (tip == HEAD) are fully swept by default', () => {
    wt.createTaskWorktree(tmpDir, 'task one');
    wt.createTaskWorktree(tmpDir, 'task two');

    const r = wt.cleanupArmyWorktrees(tmpDir);

    assert.equal(r.removed_worktrees.length, 2, JSON.stringify(r));
    assert.deepEqual(r.deleted_branches.sort(), ['army/task-one', 'army/task-two']);
    assert.equal(r.clean, true);
    assert.equal(wt.listArmyWorktrees(tmpDir).length, 0);
  });

  test('an integrated branch is deleted; an aborted branch is KEPT with the delete command', () => {
    const merged = wt.createTaskWorktree(tmpDir, 'merged task');
    commitIn(merged.worktree_path, 'merged.txt');
    git(['merge', '--no-ff', merged.branch, '-m', 'integrate'], tmpDir);

    const aborted = wt.createTaskWorktree(tmpDir, 'aborted task');
    commitIn(aborted.worktree_path, 'orphan-work.txt');

    const r = wt.cleanupArmyWorktrees(tmpDir);

    // Both worktrees were clean → both removed.
    assert.equal(r.removed_worktrees.length, 2, JSON.stringify(r));
    // Only the integrated branch dies; the aborted one holds the only copy of
    // its commit — the L3 lesson: never trade clutter for silent data loss.
    assert.deepEqual(r.deleted_branches, ['army/merged-task']);
    assert.equal(r.kept.length, 1);
    assert.equal(r.kept[0].branch, 'army/aborted-task');
    assert.match(r.kept[0].reason, /not reachable from HEAD/);
    assert.match(r.kept[0].reason, /git branch -D army\/aborted-task/, 'the reason must carry the exact recovery command');
    assert.equal(r.clean, false);

    // --force sweeps the kept branch too.
    const forced = wt.cleanupArmyWorktrees(tmpDir, { force: true });
    assert.deepEqual(forced.deleted_branches, ['army/aborted-task']);
    assert.equal(forced.clean, true);
  });

  test('a dirty worktree is kept by default and removed with --force', () => {
    const t = wt.createTaskWorktree(tmpDir, 'dirty task');
    fs.writeFileSync(path.join(t.worktree_path, 'uncommitted.txt'), 'wip');

    const r = wt.cleanupArmyWorktrees(tmpDir);
    assert.equal(r.removed_worktrees.length, 0);
    assert.equal(r.kept.length, 1);
    assert.match(r.kept[0].reason, /--force/, 'the refusal must say how to override');
    assert.ok(fs.existsSync(t.worktree_path), 'dirty tree must survive a default sweep');

    const forced = wt.cleanupArmyWorktrees(tmpDir, { force: true });
    assert.equal(forced.removed_worktrees.length, 1);
    assert.ok(!fs.existsSync(t.worktree_path));
    assert.equal(forced.clean, true);
  });

  test('an orphaned army/ branch (worktree removed by hand) is swept', () => {
    const t = wt.createTaskWorktree(tmpDir, 'orphan task');
    git(['worktree', 'remove', t.worktree_path], tmpDir); // leaves the branch

    const r = wt.cleanupArmyWorktrees(tmpDir);
    assert.deepEqual(r.deleted_branches, ['army/orphan-task']);
    assert.equal(r.clean, true);
  });

  test('non-army worktrees and branches are never touched', () => {
    const otherDir = path.join(path.dirname(tmpDir), `pan-wt-other-${path.basename(tmpDir)}`);
    git(['worktree', 'add', '-b', 'feature/keep-me', otherDir, 'HEAD'], tmpDir);
    try {
      wt.createTaskWorktree(tmpDir, 'army task');

      const r = wt.cleanupArmyWorktrees(tmpDir, { force: true });

      assert.deepEqual(r.deleted_branches, ['army/army-task']);
      assert.ok(fs.existsSync(otherDir), 'foreign worktree must survive');
      const branches = execFileSync('git', ['branch', '--list', 'feature/keep-me'], { cwd: tmpDir, encoding: 'utf8' });
      assert.match(branches, /feature\/keep-me/, 'foreign branch must survive');
    } finally {
      try { git(['worktree', 'remove', '--force', otherDir], tmpDir); } catch { /* */ }
      try { fs.rmSync(otherDir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  test('a non-git directory reports an error instead of pretending to clean', () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-nogit-'));
    try {
      assert.match(wt.cleanupArmyWorktrees(nonGit).error, /git/i);
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });
});
