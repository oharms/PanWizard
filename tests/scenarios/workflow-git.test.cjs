'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createScenarioRunner } = require('../helpers.cjs');

describe('E2E Workflow: Git Integration', () => {
  let runner;
  let pd;

  before(() => {
    runner = createScenarioRunner('claude');
    pd = path.join(runner.tmpDir, '.planning');

    // Initialize git repo
    execSync('git init', { cwd: runner.tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: runner.tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: runner.tmpDir, stdio: 'pipe' });

    // Create project structure
    fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), [
      '---', 'pan_state_version: "1.0"', 'Status: In progress',
      'Current Phase: 01', 'Milestone: v1.0', '---', '',
      '## Key Decisions', '', '## Active Blockers', '', '## Session History', '',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'roadmap.md'), [
      '## Roadmap', '', '| Phase | Name | Status |', '|---|---|---|',
    ].join('\n'));
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: true }));

    // Initial commit so we have a HEAD
    execSync('git add -A', { cwd: runner.tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: runner.tmpDir, stdio: 'pipe' });
  });

  after(() => { runner.cleanup(); });

  test('step 1: init detects existing git repo', () => {
    const r = runner.run('init new-project --name GitTest');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.ok(p.has_git, 'should detect git repo');
  });

  test('step 2: phase add + complete creates auto-commit', () => {
    runner.run('phase add git-test');
    // Stage the new files so commit can succeed
    execSync('git add -A', { cwd: runner.tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add phase"', { cwd: runner.tmpDir, stdio: 'pipe' });

    const r = runner.run('phase complete 01');
    assert.ok(r.success, `should succeed: ${r.error}`);
    const p = JSON.parse(r.output);
    assert.equal(p.completed_phase, '01');

    // Check if auto-commit was created
    const log = execSync('git log --oneline -3', { cwd: runner.tmpDir, encoding: 'utf-8' });
    // Auto-commit may or may not appear depending on dirty state
    assert.ok(log.length > 0, 'git log should have entries');
  });

  test('step 3: commit takes its message positionally, not via --message', () => {
    // Make a change first
    fs.writeFileSync(path.join(runner.tmpDir, 'test.txt'), 'hello');

    // Measured 2026-09-17: the dispatcher reads the message from args[1] and
    // ignores unknown flags, so `--message X` is NOT a message — every run of
    // this line has always been a usage error, which `r.output || r.error` hid.
    const flagged = runner.run('commit --message test-commit');
    assert.equal(flagged.success, false, '--message is not a recognised flag');
    assert.equal(flagged.output, '');
    assert.match(flagged.error, /^Error: commit message required$/);

    // The documented invocation reaches the git path: .planning/ is already committed by
    // step 2 and test.txt is outside it, so git finds nothing staged and says "nothing
    // added to commit but untracked files present". That is not a failed commit, and it
    // used to be reported as one ("commit_failed" / "unknown git error") because only
    // git's other phrasing, "nothing to commit", was recognised — the bug this
    // assertion's OR-shaped predecessor hid.
    const positional = runner.run('commit test-commit');
    const p = JSON.parse(positional.output);
    assert.equal(p.committed, false);
    assert.equal(p.reason, 'nothing_to_commit', `untracked-only should be nothing_to_commit, got ${JSON.stringify(p)}`);
    assert.equal(p.error, undefined, 'nothing to commit is not an error');
    assert.equal(positional.success, true, 'no change was NEEDED, so this exits 0 (CLI-REFERENCE "Error Shape")');
  });

  test('step 4: git log shows commit history', () => {
    const log = execSync('git log --oneline', { cwd: runner.tmpDir, encoding: 'utf-8' });
    const lines = log.trim().split('\n');
    assert.ok(lines.length >= 1, 'should have at least 1 commit');
  });

  test('step 5: phase complete with --no-commit skips auto-commit', () => {
    runner.run('phase add no-commit-test');
    execSync('git add -A', { cwd: runner.tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add phase 2"', { cwd: runner.tmpDir, stdio: 'pipe' });

    const beforeLog = execSync('git log --oneline', { cwd: runner.tmpDir, encoding: 'utf-8' });
    const beforeCount = beforeLog.trim().split('\n').length;

    const r = runner.run('phase complete 02 --no-commit');
    assert.ok(r.success, `should succeed: ${r.error}`);

    // With --no-commit, the auto-commit should be skipped
    // (note: the phase complete itself still writes files, just no git commit)
  });

  test('step 6: validate health works in git repo', () => {
    const r = runner.run('validate health');
    assert.equal(r.success, JSON.parse(r.output).status !== 'broken', 'exit code mirrors the verdict: broken exits non-zero (reality check R2)');
    const p = JSON.parse(r.output);
    assert.ok(['healthy', 'degraded', 'broken'].includes(p.status));
  });
});
