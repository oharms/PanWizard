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
