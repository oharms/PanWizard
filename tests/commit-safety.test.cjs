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

  test('--files stops at the next flag, so a later --type value is not staged', () => {
    // `--files .planning/state.md --type docs` staged `docs/` too: every later
    // argument without a leading `--` was taken as a file, the flag's value included.
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'note.md'), '# not part of this commit');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '# state');
    const result = runPanTools('commit update-state --files .planning/state.md --type docs', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(JSON.parse(result.output).type, 'docs');
    const committed = execSync('git show --name-only --format= HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim().split('\n');
    assert.deepStrictEqual(committed, ['.planning/state.md']);
  });

  test('commit with invalid --type returns error', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'bad.md'), '# bad');
    const result = runPanTools('commit msg --type invalid', tmpDir);
    assert.ok(!result.success, 'should fail with invalid type');
    assert.ok(result.error.includes('Invalid commit type'), 'error should mention invalid type');
    assert.ok(result.error.includes('feat, fix, docs, test, refactor, perf, chore'), 'error should list valid types');
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
    // Exit 1: a blocked commit is a refusal that protected something — nothing landed,
    // which is the same harm as commit_failed for an autonomous loop. The JSON body is
    // still on stdout (that is what this test's original wording was checking).
    assert.equal(result.success, false, 'a blocked commit must not report success');
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
    assert.equal(result.success, false, 'a blocked commit must not report success');
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, false);
    assert.strictEqual(out.reason, 'sensitive_file_detected');
    assert.ok(out.safety_checks.sensitive_files_blocked.some(f => f.includes('credentials')));
  });

  test('PAN\'s own cost ledger and a file merely named for tokens commit; a credentials file does not', () => {
    // .planning/metrics/tokens.jsonl matched the old bare `token` pattern, so every commit
    // that staged .planning/ was blocked once the cost logger had written to it.
    // 3.42 (PAN-11): the defaults match a basename shape, not a word anywhere in the path,
    // so api-token.txt (blocked before this release) now commits on its name; a credential
    // inside it would still be caught by the content scan.
    fs.mkdirSync(path.join(tmpDir, '.planning', 'metrics'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'metrics', 'tokens.jsonl'), '{"agent":"pan-executor","input_tokens":12}\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ledger.md'), '# ledger test');
    const ok = runPanTools('commit with-ledger', tmpDir);
    assert.ok(ok.success, ok.error);
    assert.strictEqual(JSON.parse(ok.output).committed, true);
    fs.writeFileSync(path.join(tmpDir, '.planning', 'api-token.txt'), 'abc');
    const named = runPanTools('commit with-token-file', tmpDir);
    assert.ok(named.success, named.output);
    assert.strictEqual(JSON.parse(named.output).committed, true);
    fs.writeFileSync(path.join(tmpDir, '.planning', '.npmrc'), 'registry=x');
    const blocked = runPanTools('commit with-npmrc', tmpDir);
    assert.equal(blocked.success, false);
    assert.deepEqual(JSON.parse(blocked.output).safety_checks.sensitive_files_blocked, ['.planning/.npmrc']);
  });

  test('a deletion the commit would make is refused and reported by its full name', () => {
    fs.writeFileSync(path.join(tmpDir, 'gone.txt'), 'bye');
    execSync('git add gone.txt', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add gone"', { cwd: tmpDir, stdio: 'pipe' });
    fs.unlinkSync(path.join(tmpDir, 'gone.txt'));
    const result = runPanTools('commit after-delete --files gone.txt', tmpDir);
    assert.equal(result.success, false, 'a blocked commit must not report success');
    const out = JSON.parse(result.output);
    assert.strictEqual(out.reason, 'deleted_files_detected');
    assert.deepStrictEqual(out.safety_checks.deleted_files, ['gone.txt']);
    assert.ok(runPanTools('commit after-delete --files gone.txt --force', tmpDir).success, '--force confirms the deletion');
  });

  test('an unstaged deletion outside the commit does not block it', () => {
    // The whole-tree scan refused this: a focus cycle's todo move left a deletion in
    // todos/pending/ that the next commit, of other files, would never have contained.
    fs.writeFileSync(path.join(tmpDir, 'gone.txt'), 'bye');
    execSync('git add gone.txt', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add gone"', { cwd: tmpDir, stdio: 'pipe' });
    fs.unlinkSync(path.join(tmpDir, 'gone.txt'));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'note.md'), '# note');
    const result = runPanTools('commit with-note --files .planning/note.md', tmpDir);
    assert.ok(result.success, result.output);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.committed, true);
    assert.deepStrictEqual(out.safety_checks.deleted_files, []);
    assert.match(execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' }), /^ D gone\.txt$/m, 'the deletion is left as it was');
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
// 3.42.0 PAN-11 / DD-7: sensitive files by basename, secrets by staged content
// ─────────────────────────────────────────────────────────────────────────────

describe('commit safety — basename rules and content scan (PAN-11)', () => {
  let tmpDir;
  const configPath = () => path.join(tmpDir, '.planning', 'config.json');
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(tmpDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, rel), text);
  };
  const commit = (rel) => {
    const r = runPanTools(`commit add-file --files ${rel}`, tmpDir);
    return { ok: r.success, out: JSON.parse(r.output) };
  };

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

  afterEach(() => { cleanup(tmpDir); });

  for (const rel of ['docs/secret-rotation.md', 'src/secrets-manager.ts', 'src/token-utils.ts', 'docs/password-policy.md', '.env.example', 'keys/id_rsa.pub']) {
    test(`${rel} commits (no sensitive basename, no secret inside)`, () => {
      put(rel, '# ordinary content\nconst tokenLength = 32;\npassword: string\n');
      const r = commit(rel);
      assert.ok(r.ok, JSON.stringify(r.out));
      assert.strictEqual(r.out.committed, true);
    });
  }

  for (const rel of ['.env', 'config/.env.local', 'id_rsa', 'deploy/server.key', 'certs/site.pem', 'credentials.json', 'secrets.yaml']) {
    test(`${rel} is blocked by its name`, () => {
      put(rel, 'x');
      const r = commit(rel);
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.out.reason, 'sensitive_file_detected');
      assert.deepStrictEqual(r.out.safety_checks.sensitive_files_blocked, [rel]);
    });
  }

  test('a .md with api_key = "sk-…" is blocked on content, the value not printed', () => {
    const value = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
    put('docs/setup.md', `# Setup\n\napi_key = "${value}"\n`);
    const r = commit('docs/setup.md');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.out.reason, 'sensitive_content_detected');
    assert.deepStrictEqual(r.out.safety_checks.sensitive_content_blocked, [{ file: 'docs/setup.md', rule: 'token' }]);
    assert.ok(!JSON.stringify(r.out).includes(value), 'the secret is never echoed');
    assert.strictEqual(execSync('git diff --cached --name-only', { cwd: tmpDir, encoding: 'utf8' }).trim(), '', 'unstaged again');
  });

  test('a key-value secret without a provider prefix is blocked; a placeholder is not', () => {
    put('notes/a.md', 'client_secret: "q8Zt3kP0vW9xR2mN7bL4"\n');
    const r = commit('notes/a.md');
    assert.strictEqual(r.out.reason, 'sensitive_content_detected');
    assert.deepStrictEqual(r.out.safety_checks.sensitive_content_blocked, [{ file: 'notes/a.md', rule: 'secret_key_value' }]);
    put('notes/b.md', 'password: <your-password-here>\napi_key = ${API_KEY_2024_PROD}\ntoken: required\n');
    assert.ok(commit('notes/b.md').ok);
  });

  test('a binary staged file is not content-scanned', () => {
    put('assets/blob.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('api_key = "sk-a1B2c3D4e5F6g7H8i9J0"')]));
    assert.ok(commit('assets/blob.bin').ok);
  });

  test('a config.json carrying the old default list verbatim is read as the new default', () => {
    const config = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    config.commit = { safety_checks: true, sensitive_patterns: ['\\.env$', '\\.pem$', '\\.key$', 'credentials', 'secret', 'password', 'token'] };
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
    put('docs/secret-rotation.md', '# rotate\n');
    assert.ok(commit('docs/secret-rotation.md').ok, 'the old bare `secret` no longer applies');
    put('.env', 'x');
    assert.strictEqual(commit('.env').out.reason, 'sensitive_file_detected');
  });

  test('a custom pattern still applies to the whole path', () => {
    const config = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    config.commit = { safety_checks: true, sensitive_patterns: ['^private/', 'internal'] };
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
    put('private/notes.md', '# n\n');
    const r = commit('private/notes.md');
    assert.strictEqual(r.out.reason, 'sensitive_file_detected');
    put('docs/internal-design.md', '# d\n');
    assert.strictEqual(commit('docs/internal-design.md').out.reason, 'sensitive_file_detected');
    put('.env', 'x');
    assert.ok(commit('.env').ok, 'a custom list replaces the defaults, as before');
  });

  test('config-ensure-section writes the basename defaults, not the old words', () => {
    const config = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    const { DEFAULT_SENSITIVE_PATTERNS } = require('../pan-wizard-core/bin/lib/constants.cjs');
    assert.deepStrictEqual(config.commit.sensitive_patterns, DEFAULT_SENSITIVE_PATTERNS);
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

