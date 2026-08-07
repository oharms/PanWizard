/**
 * The stub gate must see brand-new files. Drift detection must not.
 *
 * Medium finding from the 2026-08 deployed stability test. scanStubs took its file
 * list from getChangedFiles, which is `git diff HEAD` plus `--cached` — neither of
 * which lists UNTRACKED files. The normal shape of PAN execution is "a plan creates
 * new files, a later step commits them", so during that entire window a brand-new,
 * fully stubbed module was invisible to the gate that exists to stop exactly that
 * from being handed off as done.
 *
 * Untracked inclusion is opt-in rather than global because the two consumers want
 * different things: drift asks "what changed against the baseline", where an
 * untracked scratch file is noise; the stub gate asks "is any code in this handoff a
 * stub", where a new file is the whole point.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const PAN_TOOLS = path.join(PROJECT_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const { getChangedFiles } = require(path.join(PROJECT_ROOT, 'pan-wizard-core', 'bin', 'lib', 'verify-drift.cjs'));

let tempRoot;
let repo;

function git(args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
}

function pan(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: repo, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

const STUB = 'function pay() {\n  throw new Error("not implemented");\n}\nmodule.exports = { pay };\n';
const REAL = 'function pay(amount) {\n  return amount * 2;\n}\nmodule.exports = { pay };\n';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-stub-'));
  repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
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

describe('verify stubs --gate sees untracked files', () => {
  test('a brand-new stubbed module fails the gate', () => {
    fs.writeFileSync(path.join(repo, 'src', 'payments.js'), STUB);

    const { code, out } = pan(['verify', 'stubs', '--gate', '--raw']);

    // REVERT CHECK: git diff lists nothing for an untracked file, so the gate
    // scanned zero files and passed a module that is entirely a stub.
    assert.equal(code, 1, `a fully stubbed new module must fail the gate (${out})`);
  });

  test('a brand-new real module passes', () => {
    fs.writeFileSync(path.join(repo, 'src', 'payments.js'), REAL);
    const { code } = pan(['verify', 'stubs', '--gate', '--raw']);
    assert.equal(code, 0, 'working code must not be blocked');
  });

  test('a stub in a tracked, modified file still fails', () => {
    // The case that always worked — it must keep working.
    fs.writeFileSync(path.join(repo, 'src', 'payments.js'), REAL);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'add payments']);
    fs.writeFileSync(path.join(repo, 'src', 'payments.js'), STUB);

    const { code } = pan(['verify', 'stubs', '--gate', '--raw']);
    assert.equal(code, 1);
  });
});

describe('getChangedFiles keeps untracked opt-in', () => {
  test('untracked files are excluded by default (drift behaviour)', () => {
    fs.writeFileSync(path.join(repo, 'src', 'scratch.js'), 'const x = 1;\n');

    const files = getChangedFiles(repo);

    assert.ok(!files.some(f => f.includes('scratch')),
      'drift must not pick up untracked scratch files — that is why this is opt-in');
  });

  test('untracked files are included when asked for', () => {
    fs.writeFileSync(path.join(repo, 'src', 'scratch.js'), 'const x = 1;\n');

    const files = getChangedFiles(repo, null, { includeUntracked: true });

    assert.ok(files.some(f => f.includes('scratch')), 'the stub gate needs them');
  });

  test('tracked modifications are still reported either way', () => {
    fs.appendFileSync(path.join(repo, 'README.md'), 'more\n');

    assert.ok(getChangedFiles(repo).some(f => f.includes('README')));
    assert.ok(getChangedFiles(repo, null, { includeUntracked: true }).some(f => f.includes('README')));
  });
});
