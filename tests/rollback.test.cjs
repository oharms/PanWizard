/**
 * PAN Tools Tests - Rollback Snapshot (cmdRollbackSnapshot)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('rollback-snapshot command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Init git repo
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

  test('creates tag with correct naming pattern', () => {
    const result = runPanTools('rollback-snapshot 05', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.tag, 'should have tag name');
    assert.ok(out.tag.startsWith('pan-rollback-05-'), 'tag should start with pan-rollback-05-');
    assert.ok(out.hash, 'should have hash');
    assert.strictEqual(out.phase, '05');
  });

  test('tag points to current HEAD', () => {
    const result = runPanTools('rollback-snapshot 05', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);

    // Verify tag points to HEAD
    const tagHash = execSync(`git rev-parse --short ${out.tag}`, { cwd: tmpDir, encoding: 'utf-8' }).trim();
    const headHash = execSync('git rev-parse --short HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(tagHash, headHash, 'tag should point to HEAD');
  });

  test('decimal phase sanitized in tag name', () => {
    const result = runPanTools('rollback-snapshot 05.1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.tag.includes('pan-rollback-05-1-'), 'dots should be replaced with dashes');
    assert.ok(!out.tag.includes('05.1'), 'tag should not contain dots');
  });

  test('not a git repo → warning, no crash', () => {
    // Create a non-git temp dir
    const noGitDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-nogit-'));
    fs.mkdirSync(path.join(noGitDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(noGitDir, '.planning', 'config.json'), '{}');

    try {
      const result = runPanTools('rollback-snapshot 05', noGitDir);
      assert.ok(result.success, `Command should not crash: ${result.error}`);
      const out = JSON.parse(result.output);
      assert.strictEqual(out.tag, null, 'tag should be null for non-git dir');
      assert.ok(out.warning, 'should have warning message');
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  test('phase arg required → error if missing', () => {
    const result = runPanTools('rollback-snapshot', tmpDir);
    assert.ok(!result.success, 'should fail without phase');
    assert.ok(result.error.includes('phase required'), 'error should mention phase required');
  });

  test('raw mode returns just the tag name', () => {
    const result = runPanTools('rollback-snapshot 05 --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    // Raw output should be just the tag name string, not JSON
    assert.ok(result.output.startsWith('pan-rollback-05-'), 'raw output should be tag name');
    assert.ok(!result.output.startsWith('{'), 'raw output should not be JSON');
  });

  test('returns valid JSON with tag, hash, and phase', () => {
    const result = runPanTools('rollback-snapshot 12', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(typeof out.tag === 'string', 'tag should be a string');
    assert.ok(typeof out.hash === 'string', 'hash should be a string');
    assert.strictEqual(out.phase, '12', 'phase should match input');
  });

  test('numeric phase works', () => {
    const result = runPanTools('rollback-snapshot 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.tag.startsWith('pan-rollback-1-'), 'should work with single digit phase');
  });
});
