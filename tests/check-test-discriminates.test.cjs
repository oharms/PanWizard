/**
 * scripts/check-test-discriminates.cjs (market-ideas M65, MI-162): a test must pass with
 * the fix and fail with the source reverted to the base. Exercised end to end on scratch
 * git repositories, never on this checkout.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-test-discriminates.cjs');
const D = require(SCRIPT);
const { cleanup } = require('./helpers.cjs');

const BUGGY = 'module.exports = (a, b) => a - b;\n';
const FIXED = 'module.exports = (a, b) => a + b;\n';
const GOOD_TEST = "const t=require('node:test');const a=require('node:assert');const add=require('../add.cjs');t.test('adds',()=>a.equal(add(2,3),5));\n";
const WEAK_TEST = "const t=require('node:test');const a=require('node:assert');const add=require('../add.cjs');t.test('is a function',()=>a.equal(typeof add,'function'));\n";

let repo;
const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' });
const snapshot = () => ({ status: git('status', '--porcelain'), worktrees: git('worktree', 'list').trim().split('\n').length });

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-discrim-'));
  git('init', '-q');
  write('add.cjs', BUGGY);
  write('README.md', 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});
afterEach(() => cleanup(repo));

describe('check-test-discriminates', () => {
  test('a test that pins the fix discriminates (exit 0), and the checkout is left as it was', () => {
    write('add.cjs', FIXED);
    write('tests/add.test.cjs', GOOD_TEST);
    const before = snapshot();
    const r = run('tests/add.test.cjs', '--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, 'discriminates');
    assert.equal(out.base, 'HEAD');
    assert.deepEqual(out.revert, ['add.cjs']);
    assert.deepEqual(out.overlaid, ['tests/add.test.cjs']);
    assert.equal(out.reverted.passed, false);
    assert.deepEqual(snapshot(), before);
    assert.equal(fs.readFileSync(path.join(repo, 'add.cjs'), 'utf8'), FIXED);
  });

  test('a test that passes either way does not discriminate (exit 1)', () => {
    write('add.cjs', FIXED);
    write('tests/add.test.cjs', WEAK_TEST);
    const r = run('tests/add.test.cjs');
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /DOES NOT DISCRIMINATE/);
  });

  test('a test that fails on the working tree cannot be checked (exit 2)', () => {
    write('tests/add.test.cjs', GOOD_TEST); // the source is still buggy
    write('other.cjs', '1;\n');
    const r = run('tests/add.test.cjs');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fail on the working tree/);
  });

  test('nothing outside tests/ changed: nothing to revert (exit 2)', () => {
    write('tests/add.test.cjs', WEAK_TEST);
    const r = run('tests/add.test.cjs');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no source file outside tests\/ differs/);
  });

  test('a committed fix: a clean tree uses HEAD~1 as the base', () => {
    write('add.cjs', FIXED);
    write('tests/add.test.cjs', GOOD_TEST);
    git('add', '-A');
    git('commit', '-q', '-m', 'fix');
    const out = JSON.parse(run('tests/add.test.cjs', '--json').stdout);
    assert.equal(out.base, 'HEAD~1');
    assert.equal(out.verdict, 'discriminates');
  });

  test('--src limits what is reverted; other changed files keep their new version', () => {
    write('add.cjs', FIXED);
    write('README.md', 'changed\n');
    write('tests/add.test.cjs', GOOD_TEST);
    const out = JSON.parse(run('tests/add.test.cjs', '--src', 'add.cjs', '--json').stdout);
    assert.deepEqual(out.revert, ['add.cjs']);
    assert.ok(out.overlaid.includes('README.md'));
    // Reverting only the README leaves the fix in place, so the test passes: no discrimination.
    const r = run('tests/add.test.cjs', '--src', 'README.md');
    assert.equal(r.status, 1);
  });

  test('bad input exits 2 with usage', () => {
    assert.equal(run().status, 2);
    assert.equal(run('--nope', 'x').status, 2);
    assert.match(run('tests/missing.test.cjs').stderr, /no such test file/);
    assert.match(run(SCRIPT).stderr, /outside the repository/);
    write('add.cjs', FIXED);
    write('tests/add.test.cjs', GOOD_TEST);
    assert.match(run('tests/add.test.cjs', '--base', 'no-such-ref').stderr, /not a commit/);
  });
});

describe('planOverlay', () => {
  const changed = [
    { path: 'src/a.cjs', deleted: false },
    { path: 'tests/a.test.cjs', deleted: false },
    { path: 'tests/fixtures/x.json', deleted: false },
    { path: 'docs/a.md', deleted: true },
  ];
  test('default: everything outside tests/ is the source under test', () => {
    const p = D.planOverlay(changed, ['tests/a.test.cjs'], []);
    assert.deepEqual(p.revert, ['src/a.cjs', 'docs/a.md']);
    assert.deepEqual(p.overlay.map((f) => f.path), ['tests/a.test.cjs', 'tests/fixtures/x.json']);
  });
  test('--src names exactly what is reverted', () => {
    const p = D.planOverlay(changed, ['tests/a.test.cjs'], ['.\\src\\a.cjs']);
    assert.deepEqual(p.revert, ['src/a.cjs']);
    assert.equal(p.overlay.length, 3);
  });
  test('a named test outside tests/ is never reverted', () => {
    const p = D.planOverlay([{ path: 'lib/a.spec.cjs', deleted: false }, { path: 'lib/a.cjs', deleted: false }], ['lib/a.spec.cjs'], []);
    assert.deepEqual(p.revert, ['lib/a.cjs']);
  });
});
