'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { getCurrentBranch, getBranchList, getTagList } = require('../pan-wizard-core/bin/lib/git.cjs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGitRepo(cwd) {
  execFileSync('git', ['init'], { cwd, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@pan.dev'], { cwd, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'PAN Test'], { cwd, stdio: 'pipe' });
  // Hermetic: don't inherit the developer's global signing config — with
  // tag.gpgsign=true a plain `git tag` in setup fails ("fatal: no tag message?").
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd, stdio: 'pipe' });
  execFileSync('git', ['config', 'tag.gpgsign', 'false'], { cwd, stdio: 'pipe' });
}

function seedCommit(cwd, message) {
  const f = path.join(cwd, 'seed-' + Date.now() + '.txt');
  fs.writeFileSync(f, 'seed');
  execFileSync('git', ['add', f], { cwd, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', message], { cwd, stdio: 'pipe' });
}

function parseOut(result) {
  try { return JSON.parse(result.output); } catch { return result.output; }
}

// ─── Helper exports (pure helpers — no CLI needed) ────────────────────────────

describe('getCurrentBranch', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns branch name in git repo', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const branch = getCurrentBranch(cwd);
    assert.ok(branch, 'branch should be non-null');
    assert.equal(typeof branch, 'string');
  });

  test('returns null in non-git directory', () => {
    cwd = createTempProject();
    assert.equal(getCurrentBranch(cwd), null);
  });
});

describe('getBranchList', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns array with branches after init+commit', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const branches = getBranchList(cwd, false);
    assert.ok(Array.isArray(branches));
    assert.ok(branches.length >= 1);
  });

  test('returns empty array in non-git dir', () => {
    cwd = createTempProject();
    assert.deepEqual(getBranchList(cwd, false), []);
  });
});

describe('getTagList', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns empty array when no tags exist', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    assert.deepEqual(getTagList(cwd, null), []);
  });

  test('returns tag after creation', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd, stdio: 'pipe' });
    const tags = getTagList(cwd, null);
    assert.ok(tags.includes('v1.0.0'));
  });
});

// ─── git status (CLI) ─────────────────────────────────────────────────────────

describe('git status', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('clean repo returns clean:true', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git status', cwd);
    const result = parseOut(r);
    assert.equal(result.clean, true);
    assert.ok(result.branch);
  });

  test('staged file returns staged_count > 0', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const f = path.join(cwd, 'new.txt');
    fs.writeFileSync(f, 'dirty');
    execFileSync('git', ['add', f], { cwd, stdio: 'pipe' });
    const r = runPanTools('git status', cwd);
    const result = parseOut(r);
    assert.equal(result.staged_count, 1);
    assert.equal(result.clean, false);
  });

  test('non-git dir returns error', () => {
    cwd = createTempProject();
    const r = runPanTools('git status', cwd);
    const result = parseOut(r);
    assert.equal(result.error, 'not_a_git_repo');
  });
});

// ─── git commit (CLI) ────────────────────────────────────────────────────────

describe('git commit', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns not_a_git_repo outside git repo', () => {
    cwd = createTempProject();
    const r = runPanTools('git commit --message test', cwd);
    assert.equal(parseOut(r).error, 'not_a_git_repo');
  });

  test('returns nothing_to_commit when tree is clean', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git commit --message empty', cwd);
    assert.equal(parseOut(r).reason, 'nothing_to_commit');
  });

  test('commits staged file with conventional type', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const f = path.join(cwd, 'change.txt');
    fs.writeFileSync(f, 'new content');
    execFileSync('git', ['add', f], { cwd, stdio: 'pipe' });
    const r = runPanTools('git commit --type feat --message add-change', cwd);
    const result = parseOut(r);
    assert.equal(result.committed, true);
    assert.equal(result.type, 'feat');
    assert.ok(result.hash);
  });
});

// ─── git branch (CLI) ────────────────────────────────────────────────────────

describe('git branch', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('current returns branch name', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git branch current', cwd);
    assert.ok(parseOut(r).branch);
  });

  test('list returns branches array', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git branch list', cwd);
    const result = parseOut(r);
    assert.ok(Array.isArray(result.branches));
    assert.ok(result.count >= 1);
  });

  test('create makes new branch', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git branch create --name feature-test', cwd);
    assert.equal(parseOut(r).created, true);
  });

  test('create with --phase uses pan/phase-N naming', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git branch create --phase 3', cwd);
    const result = parseOut(r);
    assert.equal(result.created, true);
    assert.equal(result.branch, 'pan/phase-3');
  });

  test('switch changes to existing branch', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    execFileSync('git', ['branch', 'target'], { cwd, stdio: 'pipe' });
    const r = runPanTools('git branch switch --name target', cwd);
    assert.equal(parseOut(r).switched, true);
  });

  test('delete removes merged branch', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    execFileSync('git', ['branch', 'to-delete'], { cwd, stdio: 'pipe' });
    const r = runPanTools('git branch delete --name to-delete', cwd);
    assert.equal(parseOut(r).deleted, true);
  });
});

// ─── git log (CLI) ───────────────────────────────────────────────────────────

describe('git log', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns commits with hash and message', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'first commit');
    seedCommit(cwd, 'second commit');
    const r = runPanTools('git log', cwd);
    const result = parseOut(r);
    assert.ok(Array.isArray(result.commits));
    assert.ok(result.commits.length >= 2);
    assert.ok(result.commits[0].hash);
    assert.ok(result.commits[0].message);
  });

  test('respects --count limit', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    for (let i = 0; i < 5; i++) seedCommit(cwd, 'commit ' + i);
    const r = runPanTools('git log --count 2', cwd);
    const result = parseOut(r);
    assert.equal(result.commits.length, 2);
  });
});

// ─── git rollback (CLI) ──────────────────────────────────────────────────────

describe('git rollback', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('errors when no pan-rollback-* tags exist', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git rollback', cwd);
    assert.equal(parseOut(r).error, 'no_rollback_tags');
  });

  test('dry-run shows target tag without resetting', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    execFileSync('git', ['tag', 'pan-rollback-01-000'], { cwd, stdio: 'pipe' });
    const r = runPanTools('git rollback --dry-run', cwd);
    const result = parseOut(r);
    assert.equal(result.dry_run, true);
    assert.equal(result.rolled_back, false);
    assert.equal(result.tag, 'pan-rollback-01-000');
  });
});

// ─── git tag (CLI) ───────────────────────────────────────────────────────────

describe('git tag', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('list returns tags array', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd, stdio: 'pipe' });
    const r = runPanTools('git tag list', cwd);
    const result = parseOut(r);
    assert.ok(result.tags.includes('v1.0.0'));
  });

  test('create adds a new tag', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const r = runPanTools('git tag create --name v2.0.0', cwd);
    assert.equal(parseOut(r).created, true);
  });

  test('delete removes a tag', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    execFileSync('git', ['tag', 'old-tag'], { cwd, stdio: 'pipe' });
    const r = runPanTools('git tag delete --name old-tag', cwd);
    assert.equal(parseOut(r).deleted, true);
  });
});

// ─── git stash (CLI) ─────────────────────────────────────────────────────────

describe('git stash', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('save → list → pop lifecycle', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const f = path.join(cwd, 'wip.txt');
    fs.writeFileSync(f, 'work in progress');
    execFileSync('git', ['add', f], { cwd, stdio: 'pipe' });

    const saveR = runPanTools('git stash save --name WIP-auth', cwd);
    assert.equal(parseOut(saveR).stashed, true);

    const listR = runPanTools('git stash list', cwd);
    assert.ok(parseOut(listR).count >= 1);

    const popR = runPanTools('git stash pop', cwd);
    assert.equal(parseOut(popR).popped, true);
  });
});

// ─── git diff (CLI) ──────────────────────────────────────────────────────────

describe('git diff', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('staged diff returns line counts', () => {
    cwd = createTempProject();
    makeGitRepo(cwd);
    seedCommit(cwd, 'init');
    const f = path.join(cwd, 'mod.txt');
    fs.writeFileSync(f, 'line1\nline2\n');
    execFileSync('git', ['add', f], { cwd, stdio: 'pipe' });
    const r = runPanTools('git diff --staged', cwd);
    const result = parseOut(r);
    assert.equal(typeof result.lines_added, 'number');
    assert.equal(typeof result.files_changed, 'number');
    assert.ok(result.files_changed >= 1);
  });
});
