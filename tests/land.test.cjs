// scripts/land.cjs — landing a branch on main without a pull request. Each refusal is proved
// on a seeded case (no verdict, a failed verdict, a skipped gate, a stale branch, a dirty
// main) before a clean case lands; the remote is a throwaway bare repository.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LAND = path.join(__dirname, '..', 'scripts', 'land.cjs');
const { parseArgs, verdictProblem, commitMessage } = require(LAND);

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function land(cwd, ...args) {
  const r = spawnSync(process.execPath, [LAND, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@local', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@local' },
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const passing = (sha, extra = {}) => ({ status: 'pass', headFull: sha, dirtyAtStart: false, options: { only: null, fast: false }, gates: [{ id: 'host-node22', status: 'pass' }], ...extra });

function writeVerdict(repo, sha, verdict) {
  const dir = path.join(repo, '.git', 'pan-ci-local');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify(verdict));
}

describe('land: pure parts', () => {
  test('arguments', () => {
    assert.deepEqual(parseArgs(['feat', '--title', 'T', '--no-push']), { branch: 'feat', title: 'T', dryRun: false, push: false, allowSkips: false, remote: 'origin', main: 'main' });
    assert.throws(() => parseArgs([]), /usage/);
    assert.throws(() => parseArgs(['a', 'b']), /one branch/);
    assert.throws(() => parseArgs(['a', '--force']), /unknown option/);
  });

  test('the verdict must be a clean, full, passing run on exactly this commit', () => {
    const sha = 'a'.repeat(40);
    assert.equal(verdictProblem(passing(sha), sha), null);
    assert.match(verdictProblem(null, sha), /no ci:local verdict/);
    assert.match(verdictProblem(passing('b'.repeat(40)), sha), /not aaaaaaaaa/);
    assert.match(verdictProblem(passing(sha, { status: 'fail', gates: [{ id: 'gitleaks', status: 'fail' }] }), sha), /failed.*gitleaks/);
    assert.match(verdictProblem(passing(sha, { options: { only: ['host'] } }), sha), /partial run/);
    assert.match(verdictProblem(passing(sha, { options: { fast: true } }), sha), /partial run/);
    assert.match(verdictProblem(passing(sha, { dirtyAtStart: true }), sha), /uncommitted/);
    const skip = passing(sha, { gates: [{ id: 'gitleaks', status: 'skip' }] });
    assert.match(verdictProblem(skip, sha), /skipped gitleaks/);
    assert.equal(verdictProblem(skip, sha, { allowSkips: true }), null);
  });

  test('the commit message: the first subject, or --title over a list of the commits', () => {
    assert.equal(commitMessage('b', ['Add x']), 'Add x\n');
    assert.equal(commitMessage('b', ['Add x', 'Fix y']), 'Add x\n\nSquashed from b:\n- Add x\n- Fix y\n');
    assert.equal(commitMessage('b', ['Add x'], 'Feature X'), 'Feature X\n\nSquashed from b:\n- Add x\n');
  });
});

describe('land: against a real remote', () => {
  let tmp, origin, work;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-land-test-'));
    origin = path.join(tmp, 'origin.git');
    work = path.join(tmp, 'work');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
    git(tmp, 'clone', '-q', origin, work);
    fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git(work, 'checkout', '-q', '-b', 'main');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'base');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(work, 'b.txt'), 'two\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'Add b');
    fs.writeFileSync(path.join(work, 'c.txt'), 'three\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'Add c');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const originMain = () => git(origin, 'rev-parse', 'main');

  test('refuses without a passing verdict, and lands once there is one: one squash commit, pushed, not forced', () => {
    const before = originMain();
    const sha = git(work, 'rev-parse', 'feat');
    const none = land(work, 'feat');
    assert.equal(none.status, 1, none.out);
    assert.match(none.out, /no ci:local verdict/);

    writeVerdict(work, sha, passing(sha, { status: 'fail', gates: [{ id: 'linux-node18', status: 'fail' }] }));
    const red = land(work, 'feat');
    assert.equal(red.status, 1);
    assert.match(red.out, /failed.*linux-node18/);
    assert.equal(originMain(), before, 'a refusal pushes nothing');

    writeVerdict(work, sha, passing(sha));
    const dry = land(work, 'feat', '--dry-run');
    assert.equal(dry.status, 0, dry.out);
    assert.match(dry.out, /would squash 2 commit/);
    assert.equal(originMain(), before, 'a dry run pushes nothing');

    const ok = land(work, 'feat', '--title', 'Feature: b and c');
    assert.equal(ok.status, 0, ok.out);
    const landed = originMain();
    assert.equal(git(origin, 'rev-parse', `${landed}^`), before, 'exactly one commit on top of the old main: a fast-forward, nothing rewritten');
    assert.equal(git(origin, 'rev-parse', `${landed}^{tree}`), git(work, 'rev-parse', 'feat^{tree}'), 'the tree ci:local passed');
    assert.match(git(origin, 'log', '-1', '--format=%B', landed), /^Feature: b and c\n\nSquashed from feat:\n- Add b\n- Add c/);
    assert.equal(git(work, 'rev-parse', 'main'), landed, 'the local main is the landed commit');
    assert.equal(git(work, 'rev-parse', 'feat'), sha, 'the branch is left alone');
  });

  test('refuses a branch that does not contain origin/main', () => {
    const other = path.join(tmp, 'other');
    git(tmp, 'clone', '-q', origin, other);
    fs.writeFileSync(path.join(other, 'z.txt'), 'z\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-qm', 'someone else');
    git(other, 'push', '-q', 'origin', 'main');
    const sha = git(work, 'rev-parse', 'feat');
    writeVerdict(work, sha, passing(sha));
    const r = land(work, 'feat');
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /does not contain origin\/main/);
  });

  test('refuses a skipped gate unless --allow-skips', () => {
    const sha = git(work, 'rev-parse', 'feat');
    writeVerdict(work, sha, passing(sha, { gates: [{ id: 'gitleaks', status: 'skip' }] }));
    assert.match(land(work, 'feat', '--no-push').out, /skipped gitleaks/);
    const r = land(work, 'feat', '--no-push', '--allow-skips');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /not pushed/);
  });

  test('lands in the checkout that has main, and refuses when that checkout is dirty', () => {
    const sha = git(work, 'rev-parse', 'feat');
    writeVerdict(work, sha, passing(sha));
    git(work, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(work, 'a.txt'), 'edited\n');
    const dirty = land(work, 'feat');
    assert.equal(dirty.status, 1, dirty.out);
    assert.match(dirty.out, /uncommitted changes/);
    git(work, 'checkout', '--', 'a.txt');
    const ok = land(work, 'feat');
    assert.equal(ok.status, 0, ok.out);
    assert.equal(git(work, 'rev-parse', 'HEAD'), originMain());
  });

  test('a push the remote rejects is reported, and nothing is forced', () => {
    const sha = git(work, 'rev-parse', 'feat');
    writeVerdict(work, sha, passing(sha));
    // A hook that rejects every push stands in for branch protection.
    const hook = path.join(origin, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\necho "protected branch" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const before = originMain();
    const r = land(work, 'feat');
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /rejected/);
    assert.equal(originMain(), before);
    assert.notEqual(git(work, 'rev-parse', 'main'), before, 'the commit stays on the local main');
  });
});
