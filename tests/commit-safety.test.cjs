/**
 * PAN Tools Tests - Commit Safety Checks + --type flag
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Commit safety checks
// ─────────────────────────────────────────────────────────────────────────────

describe('commit safety checks', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create config.json with defaults (needed for safety checks)
    runPanTools('config-ensure-section', tmpDir);
    // Init git repo for commit tests
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    // Initial commit so git is not empty
    fs.writeFileSync(path.join(tmpDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('no deleted, no sensitive → commit succeeds', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'test.md'), '# test');
    const result = runPanTools('commit test-commit', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, true);
    assert.strictEqual(out.reason, 'committed');
    assert.ok(out.safety_checks, 'should include safety_checks');
    assert.deepStrictEqual(out.safety_checks.deleted_files, []);
    assert.deepStrictEqual(out.safety_checks.sensitive_files_blocked, []);
  });

  test('commit with --type feat prepends type prefix', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'feat.md'), '# feature');
    const result = runPanTools('commit add-feature --type feat', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, true);
    assert.strictEqual(out.type, 'feat');
    // Verify the actual commit message contains the type prefix
    const log = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' });
    assert.ok(log.includes('feat: add-feature'), 'commit message should have type prefix');
  });

  test('commit with --type fix uses fix prefix', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'fix.md'), '# fix');
    const result = runPanTools('commit bugfix --type fix', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.type, 'fix');
  });

  test('commit with --type docs uses docs prefix', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'doc.md'), '# docs');
    const result = runPanTools('commit update-readme --type docs', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.type, 'docs');
  });

  test('commit with --type test uses test prefix', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'tst.md'), '# test');
    const result = runPanTools('commit add-tests --type test', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.type, 'test');
  });

  test('commit with --type refactor uses refactor prefix', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ref.md'), '# refactor');
    const result = runPanTools('commit cleanup --type refactor', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.type, 'refactor');
  });

  test('commit with --type chore uses chore prefix', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ch.md'), '# chore');
    const result = runPanTools('commit bump-deps --type chore', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.type, 'chore');
  });

  test('commit with invalid --type returns error', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'bad.md'), '# bad');
    const result = runPanTools('commit msg --type invalid', tmpDir);
    assert.ok(!result.success, 'should fail with invalid type');
    assert.ok(result.error.includes('Invalid commit type'), 'error should mention invalid type');
    assert.ok(result.error.includes('feat, fix, docs, test, refactor, chore'), 'error should list valid types');
  });

  test('commit without --type has null type in output', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'plain.md'), '# plain');
    const result = runPanTools('commit plain-msg', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.type, null, 'type should be null when not specified');
  });

  test('sensitive .env file in staging → blocked', () => {
    // Create and stage a .env file
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=abc123');
    execSync('git add .env', { cwd: tmpDir, stdio: 'pipe' });
    // Also stage a planning file to trigger commit
    fs.writeFileSync(path.join(tmpDir, '.planning', 'sens.md'), '# sensitive test');
    const result = runPanTools('commit with-env --files .planning/ .env', tmpDir);
    assert.ok(result.success, `Command should output JSON even when blocked: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'sensitive_file_detected');
    assert.ok(out.safety_checks.sensitive_files_blocked.length > 0, 'should list blocked files');
    assert.ok(out.safety_checks.sensitive_files_blocked.some(f => f.includes('.env')), 'should include .env');
  });

  test('credentials.json in staging → blocked', () => {
    fs.writeFileSync(path.join(tmpDir, 'credentials.json'), '{}');
    execSync('git add credentials.json', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'cred.md'), '# cred test');
    const result = runPanTools('commit with-creds --files .planning/ credentials.json', tmpDir);
    assert.ok(result.success);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'sensitive_file_detected');
    assert.ok(out.safety_checks.sensitive_files_blocked.some(f => f.includes('credentials')));
  });

  test('package.json in staging → not blocked (no pattern match)', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'pkg.md'), '# pkg');
    const result = runPanTools('commit with-pkg', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, true, 'package.json should not be blocked');
  });

  test('empty sensitive_patterns config → no sensitive checks', () => {
    // Set empty sensitive patterns
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.commit = { safety_checks: true, sensitive_patterns: [] };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    fs.writeFileSync(path.join(tmpDir, '.env'), 'KEY=val');
    execSync('git add .env', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'empty-pat.md'), '# test');
    const result = runPanTools('commit empty-patterns --files .planning/ .env', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // With empty patterns, .env should NOT be blocked
    assert.strictEqual(out.committed, true, 'should commit when patterns empty');
  });

  test('safety_checks disabled → no checks at all', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.commit = { safety_checks: false };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
    execSync('git add .env', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'disabled.md'), '# disabled');
    const result = runPanTools('commit safety-off --files .planning/ .env', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, true, 'should commit when safety checks disabled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-git directory behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('commit in non-git directory', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runPanTools('config-ensure-section', tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('commit returns not_a_git_repo', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'test.md'), '# test');
    const result = runPanTools('commit test-msg', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'not_a_git_repo');
    assert.ok(out.hint, 'should include hint');
  });

  test('commit with --type returns not_a_git_repo', () => {
    const result = runPanTools('commit test-msg --type feat', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.reason, 'not_a_git_repo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch commit
// ─────────────────────────────────────────────────────────────────────────────

describe('batch-commit', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runPanTools('config-ensure-section', tmpDir);
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('batch-commit with items creates commit', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'batch.md'), '# batch result');
    const toolsPath = path.resolve(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const items = JSON.stringify([{ title: 'fix-auth' }, { title: 'add-tests' }]);
    const out = JSON.parse(execFileSync('node', [toolsPath, 'batch-commit', items], { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }).trim());
    assert.strictEqual(out.committed, true);
    assert.strictEqual(out.reason, 'committed');
    assert.strictEqual(out.items_count, 2);
    assert.ok(out.hash);
  });

  test('batch-commit with empty array returns no_items', () => {
    const toolsPath = path.resolve(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const out = JSON.parse(execFileSync('node', [toolsPath, 'batch-commit', '[]'], { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }).trim());
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'no_items');
  });

  test('batch-commit with no planning changes returns nothing_to_commit', () => {
    const toolsPath = path.resolve(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const items = JSON.stringify([{ title: 'item1' }]);
    const out = JSON.parse(execFileSync('node', [toolsPath, 'batch-commit', items], { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }).trim());
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'nothing_to_commit');
  });

  test('batch-commit in non-git dir returns not_a_git_repo', () => {
    const noGitDir = createTempProject();
    runPanTools('config-ensure-section', noGitDir);
    const toolsPath = path.resolve(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const items = JSON.stringify([{ title: 'item1' }]);
    const out = JSON.parse(execFileSync('node', [toolsPath, 'batch-commit', items], { cwd: noGitDir, encoding: 'utf-8', stdio: 'pipe' }).trim());
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'not_a_git_repo');
    cleanup(noGitDir);
  });
});
