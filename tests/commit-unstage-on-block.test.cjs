/**
 * A blocked `pan-tools commit` must leave the index exactly as it found it.
 *
 * Regression guard for a High finding from the 2026-08 deployed stability test.
 * cmdCommit staged first and ran the safety checks second, so when the sensitive-file
 * check refused, the offending file was already in the index. Two harms:
 *
 *  1. The check that exists to keep a secret OUT of git was what put it IN. The
 *     block itself looked like a success ("sensitive_file_detected"), while the
 *     next `git commit` from any source — the user, an IDE, another tool — would
 *     have included the secret.
 *  2. It wedged every later commit: the file stayed staged and kept tripping the
 *     same check, so an autonomous run silently stopped persisting its own plans
 *     behind a message that reads like a safety win.
 *
 * These drive the real CLI and assert on `git diff --cached`, because the defect
 * was in the index — a unit test on runCommitSafetyChecks would have passed.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAN_TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tempRoot;
let repo;

function git(args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
}

function pan(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: repo, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function staged() {
  const r = git(['diff', '--cached', '--name-only']);
  return (r.stdout || '').split('\n').filter(Boolean).sort();
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-commit-'));
  repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(path.join(repo, '.planning'), { recursive: true });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'init']);
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('a blocked commit does not leave files staged', () => {
  test('an explicitly-passed secret is unstaged again, and left on disk', () => {
    fs.writeFileSync(path.join(repo, '.env'), 'AWS_SECRET_ACCESS_KEY=REALSECRET\n');

    const { code, out } = pan(['commit', 'chore: oops', '--files', '.env']);

    assert.equal(code, 1, 'a refusal is a failure for the caller');
    assert.match(out, /sensitive_file_detected/);
    // REVERT CHECK: without the unstage this is `['.env']` — the secret sitting in
    // the index, one `git commit` away from being published.
    assert.deepEqual(staged(), [], 'the index must be back to how PAN found it');
    assert.ok(fs.existsSync(path.join(repo, '.env')),
      'we unstage, never delete — the file is the user\'s');
  });

  test('a later unrelated commit is not wedged by the earlier block', () => {
    fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=abc\n');
    pan(['commit', 'chore: oops', '--files', '.env']);

    fs.appendFileSync(path.join(repo, 'README.md'), 'more\n');
    const { code, out } = pan(['commit', 'docs: update readme', '--files', 'README.md']);

    // REVERT CHECK: with .env still staged this returns sensitive_file_detected
    // again — forever, for every subsequent commit.
    assert.equal(code, 0, `an unrelated commit must succeed, got: ${out}`);
    assert.match(out, /"committed":\s*true/);
  });

  test('files the USER staged before calling PAN are left untouched by a block', () => {
    fs.writeFileSync(path.join(repo, 'mine.txt'), 'my work\n');
    git(['add', 'mine.txt']);
    fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=abc\n');

    pan(['commit', 'chore: blocked', '--files', '.env']);

    // We may only undo our OWN additions. Resetting the whole index would throw
    // away work the user had staged for their own commit.
    assert.deepEqual(staged(), ['mine.txt'], 'the user\'s staged file must survive');
  });

  test('the default .planning/ path is restored too, not just explicit --files', () => {
    // The realistic trigger: DEFAULT_SENSITIVE_PATTERNS contains bare unanchored
    // words, so a phase directory named for its topic matches with no secret in it.
    const dir = path.join(repo, '.planning', 'phases', '03-secrets-design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '03-01-plan.md'), 'design notes, no secrets\n');

    const { code, out } = pan(['commit', 'docs: planning']);

    assert.equal(code, 1);
    assert.match(out, /sensitive_file_detected/);
    assert.deepEqual(staged(), [], 'a directory expansion must be unstaged as well');
    // The block must not claim a secret was found in the file's contents.
    assert.match(out, /filename\/path, not content/,
      'the hint must say this matched a path and can be a false positive');
  });

  test('a clean commit still works and reports the hash', () => {
    fs.writeFileSync(path.join(repo, '.planning', 'notes.md'), 'ordinary notes\n');

    const { code, out } = pan(['commit', 'docs: planning notes']);

    assert.equal(code, 0, out);
    assert.match(out, /"committed":\s*true/);
    assert.deepEqual(staged(), [], 'a successful commit leaves nothing staged');
  });
});
