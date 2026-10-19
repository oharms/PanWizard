/**
 * `review scope <phase>` (program R1): the reviewer reads the diff, not the executor's own
 * list of what it touched, and gets the plans' intent beside it.
 *
 * The fixture is the case R1 exists for: the plan commit changes a file the summary's
 * key-files never names, and an untracked file sits in the tree. Both must be in scope,
 * and reported as unlisted.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { reviewScope, sectionBody } = require('../pan-wizard-core/bin/lib/verify-scope.cjs');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

const PLAN = `---
phase: 01-auth
plan: 01
type: execute
wave: 1
files_modified: [src/login.js]
requirements: [AUTH-01]
must_haves:
  truths:
    - "A wrong password is refused"
  artifacts:
    - path: src/login.js
      provides: login
---

<objective>
Add password login.
</objective>

## Review Focus

The password comparison must be constant-time.

## Tasks

1. Write src/login.js.
`;

const SUMMARY = `---
phase: 01-auth
plan: 01
key-files:
  created: [src/login.js]
  modified: []
---

# Summary
`;

describe('review scope', () => {
  let dir;
  before(() => {
    dir = createTempProject();
    git(dir, 'init', '-q');
    write(dir, 'README.md', 'project\n');
    write(dir, '.planning/requirements.md', '# Requirements\n\n- [ ] **AUTH-01**: A user can log in with a password\n- [ ] **AUTH-02**: A user can reset a password\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: init');
    write(dir, '.planning/phases/01-auth/01-01-plan.md', PLAN);
    write(dir, '.planning/phases/01-auth/01-01-summary.md', SUMMARY);
    write(dir, 'src/login.js', 'module.exports = (u, p) => p === u.password;\n');
    write(dir, 'src/session.js', 'module.exports = {};\n');
    write(dir, 'package-lock.json', '{}\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(01-01): password login');
    write(dir, 'src/debug.js', 'console.log(1);\n');
  });
  after(() => cleanup(dir));

  test('a committed file absent from key-files is in scope and reported unlisted', () => {
    const r = reviewScope(dir, '1');
    const paths = r.files.map((f) => f.path);
    assert.ok(paths.includes('src/session.js'), `session.js missing from ${paths}`);
    assert.deepEqual(r.files.find((f) => f.path === 'src/session.js'), { path: 'src/session.js', sources: ['commit'], listed: false });
    assert.deepEqual(r.files.find((f) => f.path === 'src/login.js').sources, ['commit', 'summary']);
    assert.ok(r.unlisted.includes('src/session.js'));
    assert.equal(r.unlisted.includes('src/login.js'), false);
  });

  test('untracked work is in scope; the planning tree and lockfiles are not', () => {
    const r = reviewScope(dir, '1');
    assert.deepEqual(r.files.find((f) => f.path === 'src/debug.js'), { path: 'src/debug.js', sources: ['untracked'], listed: false });
    const paths = r.files.map((f) => f.path);
    assert.equal(paths.some((p) => p.startsWith('.planning/')), false);
    assert.equal(paths.includes('package-lock.json'), false);
    assert.ok(r.excluded.some((e) => e.path === 'package-lock.json' && e.reason === 'lockfile'));
  });

  test('the intent: objective, must_haves, Review Focus and the claimed requirement text', () => {
    const r = reviewScope(dir, '1');
    assert.equal(r.intent.plans.length, 1);
    const p = r.intent.plans[0];
    assert.equal(p.objective, 'Add password login.');
    assert.deepEqual(p.must_haves.truths, ['A wrong password is refused']);
    assert.equal(p.must_haves.artifacts[0].path, 'src/login.js');
    assert.equal(p.review_focus, 'The password comparison must be constant-time.');
    assert.deepEqual(r.intent.requirements, [{ id: 'AUTH-01', text: '- [ ] **AUTH-01**: A user can log in with a password' }]);
    assert.deepEqual(r.intent.missing_requirements, []);
    assert.match(r.base, /^[0-9a-f]{40}$/);
    assert.equal(r.commits, 1);
  });

  test('CLI: JSON by default, one path per line with --raw', () => {
    const json = runPanTools('review scope 1', dir);
    assert.equal(json.success, true, json.error);
    assert.ok(JSON.parse(json.output).unlisted.includes('src/session.js'));
    const raw = runPanTools('review scope 1 --raw', dir);
    assert.equal(raw.success, true, raw.error);
    assert.deepEqual(raw.output.split(/\r?\n/).sort(), ['src/debug.js', 'src/login.js', 'src/session.js']);
  });

  test('CLI: an unknown phase and an unknown subcommand fail', () => {
    const missing = runPanTools('review scope 9', dir);
    assert.equal(missing.success, false, 'an unknown phase exits 1');
    assert.match(missing.output, /phase_not_found/);
    const bad = runPanTools('review nope', dir);
    assert.equal(bad.success, false);
    assert.match(bad.error, /Unknown review subcommand\. Available: scope/);
  });

  test('a plan without a Review Focus section reads null, not the next section', () => {
    assert.equal(sectionBody('# P\n\n## Tasks\n\n1. x\n', 'Review Focus'), null);
    assert.equal(sectionBody('## Review Focus\n\nA\n### detail\nB\n## Tasks\nC', 'Review Focus'), 'A\n### detail\nB');
  });
});

describe('review scope reads every working-tree change, whatever its status column', () => {
  const { workingTreeFiles } = require('../pan-wizard-core/bin/lib/verify-scope.cjs');
  let dir;
  before(() => {
    dir = createTempProject();
    git(dir, 'init', '-q');
    write(dir, 'a/first.js', '1\n');
    write(dir, 'b/second.js', '2\n');
    write(dir, 'c/old-name.js', '3\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: init');
    write(dir, 'a/first.js', '1 changed\n'); // unstaged: " M a/first.js", the line `git status` prints first
    write(dir, 'b/second.js', '2 changed\n');
    git(dir, 'add', 'b/second.js'); // staged: "M  b/second.js"
    git(dir, 'mv', 'c/old-name.js', 'c/new-name.js'); // renamed: "R  c/old-name.js -> c/new-name.js"
    write(dir, 'd/fresh.js', '4\n'); // untracked
  });
  after(() => cleanup(dir));

  test('an unstaged edit on the first status line keeps its whole path', () => {
    const w = workingTreeFiles(dir);
    assert.deepEqual(w.uncommitted.sort(), ['a/first.js', 'b/second.js', 'c/new-name.js']);
    assert.deepEqual(w.untracked, ['d/fresh.js']);
  });
});
