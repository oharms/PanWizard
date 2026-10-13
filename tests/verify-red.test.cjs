/**
 * verify-red.cjs — RED and catch proof (program V4).
 *
 * In a real git repository: phase 2's plan commits add `multiply()` with a test that
 * needs it (fails at the phase's base, passes at HEAD: caught), and a tautological test
 * that passes anywhere (not_red, rejected). Also a test broken at HEAD (not_green), a
 * runner that cannot run one file (not_checked), a phase with no plan commits, and the
 * worktree hygiene: the project's own node_modules survives, and no worktree is left.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const R = require('../pan-wizard-core/bin/lib/verify-red.cjs');
const { cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
const TEST = (body) => `const test = require('node:test');\nconst assert = require('node:assert');\n${body}\n`;
const verdicts = (r) => Object.fromEntries(r.files.map((f) => [f.file, f.verdict]));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-red-'));
  git('init', '-q');
  write('.planning/roadmap.md', '# Roadmap\n\n### Phase 2: Multiply\n');
  write('.planning/phases/02-multiply/02-01-plan.md', '---\nphase: 02-multiply\nplan: 01\n---\n');
  write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  write('src/math.js', 'exports.add = (a, b) => a + b;\n');
  write('test/add.test.js', TEST("const { add } = require('../src/math.js');\ntest('adds', () => assert.strictEqual(add(2, 3), 5));"));
  commit('chore: project before phase 2');
});
afterEach(() => cleanup(dir));

describe('verify red', () => {
  test('gate: a real test is caught (red at the base, green at HEAD); a tautological one is rejected', () => {
    write('src/math.js', 'exports.add = (a, b) => a + b;\nexports.multiply = (a, b) => a * b;\n');
    write('test/multiply.test.js', TEST("const { multiply } = require('../src/math.js');\ntest('multiplies', () => assert.strictEqual(multiply(2, 3), 6));"));
    commit('feat(02-01): multiply');
    write('test/sanity.test.js', TEST("test('arithmetic still works', () => assert.strictEqual(1 + 1, 2));"));
    commit('test(02-01): sanity check');
    const r = R.checkRed(dir, '2');
    assert.equal(r.checked, true);
    assert.equal(r.ok, false);
    assert.deepEqual(verdicts(r), { 'test/multiply.test.js': 'caught', 'test/sanity.test.js': 'not_red' });
    assert.match(r.files.find((f) => f.verdict === 'not_red').detail, /tautological/);
    assert.notEqual(r.files[0].base_exit, 0);
    assert.equal(r.files[0].head_exit, 0);
  });

  test('only caught tests: ok, and the CLI exits 0 with raw "caught"; a not_red one exits 1', () => {
    write('src/math.js', 'exports.add = (a, b) => a + b;\nexports.multiply = (a, b) => a * b;\n');
    write('test/multiply.test.js', TEST("const { multiply } = require('../src/math.js');\ntest('multiplies', () => assert.strictEqual(multiply(2, 3), 6));"));
    commit('feat(02-01): multiply');
    const ok = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'red', '2', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), 'caught');
    write('test/sanity.test.js', TEST("test('true', () => assert.ok(1 === 1));"));
    commit('test(02-01): sanity');
    const bad = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'red', '2', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout.trim(), 'not_caught');
  });

  test('a test that fails at HEAD is not_green', () => {
    write('test/multiply.test.js', TEST("const { multiply } = require('../src/math.js');\ntest('multiplies', () => assert.strictEqual(multiply(2, 3), 6));"));
    commit('feat(02-01): multiply test, no implementation');
    const r = R.checkRed(dir, '2');
    assert.deepEqual(verdicts(r), { 'test/multiply.test.js': 'not_green' });
    assert.match(r.files[0].detail, /fails at HEAD/);
  });

  test('a runner that cannot run one file is not_checked, with the way to fix it', () => {
    write('.planning/config.json', JSON.stringify({ workflow: { test_command: 'make test' } }));
    write('test/multiply.test.js', TEST("test('x', () => {});"));
    commit('feat(02-01): a test');
    const r = R.checkRed(dir, '2');
    assert.equal(r.checked, false);
    assert.equal(r.ok, true);
    assert.equal(r.files[0].verdict, 'not_checked');
    assert.match(r.files[0].detail, /workflow\.test_file_command/);
  });

  test('a phase with no plan commits is not checked, never a failure', () => {
    const r = R.checkRed(dir, '2');
    assert.equal(r.checked, false);
    assert.equal(r.ok, true);
    assert.match(r.reason, /no plan commits/);
  });

  test('the worktree links node_modules, leaves the real one alone, and is removed', () => {
    write('node_modules/helper/index.js', 'module.exports = 6;\n');
    write('.gitignore', 'node_modules/\n');
    commit('chore: ignore node_modules');
    write('src/math.js', 'exports.add = (a, b) => a + b;\nexports.multiply = (a, b) => a * b;\n');
    write('test/multiply.test.js', TEST("const { multiply } = require('../src/math.js');\nconst six = require('helper');\ntest('multiplies', () => assert.strictEqual(multiply(2, 3), six));"));
    commit('feat(02-01): multiply');
    const r = R.checkRed(dir, '2');
    assert.deepEqual(verdicts(r), { 'test/multiply.test.js': 'caught' });
    assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'helper', 'index.js')), 'the project\'s node_modules is untouched');
    assert.equal(git('worktree', 'list').trim().split('\n').length, 1, 'no worktree left behind');
  });
});
