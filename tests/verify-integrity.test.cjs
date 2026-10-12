/**
 * verify-integrity.cjs — did a phase weaken the tests that judge it? (program V3)
 *
 * A fixture repo per pattern, each paired with a clean twin: a deleted test, a
 * renamed test (a warning), skip/only markers in JS, Python, Go, Rust and Java, a
 * dropped assertion, an assertion edited in a test no plan declared (and the same
 * edit allowed in a declared one), a rewritten snapshot, an always-true assertion.
 * Only the phase's own plan commits count.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const I = require('../pan-wizard-core/bin/lib/verify-integrity.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
let hasGit = true;
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' }).trim();
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (subject) => { git('add', '-A'); git('commit', '-q', '-m', subject); };
const codes = (r) => r.violations.map((v) => v.code).sort();

const LOGIN_TEST = "const assert = require('assert');\ntest('logs in', () => {\n  assert.equal(login('a', 'b'), true);\n  assert.equal(login('a', 'x'), false);\n});\n";
const OTHER_TEST = "const assert = require('assert');\ntest('other', () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(add(2, 2), 4);\n});\n";

beforeEach(() => {
  dir = createTempProject();
  const phaseDir = path.join(dir, '.planning', 'phases', '03-auth');
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(path.join(phaseDir, '03-01-plan.md'), '---\nphase: 03-auth\nplan: 01\nwave: 1\nfiles_modified: [src/login.js, tests/login.test.js]\n---\n\n<task>x</task>\n');
  try {
    git('init', '-q', '--initial-branch=main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
  } catch { hasGit = false; return; }
  write('src/login.js', 'module.exports = () => true;\n');
  write('tests/login.test.js', LOGIN_TEST);
  write('tests/other.test.js', OTHER_TEST);
  write('tests/test_api.py', 'def test_api():\n    assert api() == 1\n');
  write('pkg/api_test.go', 'package pkg\nfunc TestAPI(t *testing.T) {\n  if API() != 1 { t.Fatal("bad") }\n}\n');
  write('src/lib.rs', '#[test]\nfn works() {\n    assert_eq!(f(), 1);\n}\n');
  write('src/test/java/AppTest.java', 'class AppTest {\n  @Test void runs() { assertEquals(1, app()); }\n}\n');
  write('tests/__snapshots__/view.test.js.snap', 'exports[`view 1`] = `<div>hello</div>`;\n');
  commit('chore: base');
});
afterEach(() => cleanup(dir));

const guard = (t) => { if (!hasGit) { t.skip('git unavailable'); return true; } return false; };

describe('test integrity — each weakening is caught, its clean twin passes', () => {
  test('clean: a declared test gains an assertion and the code changes', (t) => {
    if (guard(t)) return;
    write('src/login.js', 'module.exports = (u, p) => p === "b";\n');
    write('tests/login.test.js', LOGIN_TEST.replace('});', "  assert.equal(login('', ''), false);\n});"));
    commit('feat(03-01): check the password');
    const r = I.checkTestIntegrity(dir, '3');
    assert.equal(r.checked, true);
    assert.equal(r.ok, true, JSON.stringify(r.violations));
    assert.equal(r.commits, 1);
  });

  test('a deleted test file', (t) => {
    if (guard(t)) return;
    git('rm', '-q', 'tests/other.test.js');
    commit('fix(03-01): remove a flaky test');
    assert.deepEqual(codes(I.checkTestIntegrity(dir, '3')), ['test_deleted']);
  });

  test('a renamed test is a warning, not a violation', (t) => {
    if (guard(t)) return;
    git('mv', 'tests/other.test.js', 'tests/math.test.js');
    commit('refactor(03-01): rename the math test');
    const r = I.checkTestIntegrity(dir, '3');
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings.map((w) => w.code), ['test_renamed']);
  });

  for (const [label, file, from, to] of [
    ['a JS test.skip, even in a declared test', 'tests/login.test.js', "test('logs in'", "test.skip('logs in'"],
    ['a jasmine xit', 'tests/other.test.js', "test('other'", "xit('other'"],
    ['a node:test skip option', 'tests/other.test.js', "test('other', () => {", "test('other', { skip: true }, () => {"],
    ['a pytest skip mark', 'tests/test_api.py', 'def test_api', '@pytest.mark.skip(reason="later")\ndef test_api'],
    ['a go t.Skip', 'pkg/api_test.go', 'func TestAPI(t *testing.T) {', 'func TestAPI(t *testing.T) {\n  t.Skip("later")'],
    ['a rust #[ignore]', 'src/lib.rs', '#[test]\n', '#[test]\n#[ignore]\n'],
    ['a junit @Disabled', 'src/test/java/AppTest.java', '@Test void', '@Disabled @Test void'],
  ]) {
    test(`a skip marker: ${label}`, (t) => {
      if (guard(t)) return;
      write(file, fs.readFileSync(path.join(dir, file), 'utf-8').replace(from, to));
      commit('fix(03-01): get the suite green');
      assert.ok(codes(I.checkTestIntegrity(dir, '3')).includes('skip_marker_added'), file);
    });
  }

  test('a dropped assertion, even in a declared test', (t) => {
    if (guard(t)) return;
    write('tests/login.test.js', LOGIN_TEST.replace("  assert.equal(login('a', 'x'), false);\n", ''));
    commit('fix(03-01): simplify the login test');
    assert.deepEqual(codes(I.checkTestIntegrity(dir, '3')), ['assertions_dropped']);
  });

  test('an expectation edited in a test no plan declares', (t) => {
    if (guard(t)) return;
    write('tests/other.test.js', OTHER_TEST.replace('add(2, 2), 4', 'add(2, 2), 5'));
    commit('fix(03-01): match the new behaviour');
    assert.deepEqual(codes(I.checkTestIntegrity(dir, '3')), ['undeclared_test_edit']);
  });

  test('the same edit in a declared test is allowed', (t) => {
    if (guard(t)) return;
    write('tests/login.test.js', LOGIN_TEST.replace("login('a', 'x'), false", "login('a', 'x'), null"));
    commit('feat(03-01): failed logins return null');
    assert.equal(I.checkTestIntegrity(dir, '3').ok, true);
  });

  test('a rewritten snapshot no plan declares', (t) => {
    if (guard(t)) return;
    write('tests/__snapshots__/view.test.js.snap', 'exports[`view 1`] = `<div>bye</div>`;\n');
    commit('test(03-01): update snapshots');
    assert.deepEqual(codes(I.checkTestIntegrity(dir, '3')), ['snapshot_rewritten']);
  });

  test('an assertion that cannot fail', (t) => {
    if (guard(t)) return;
    // Split so the suite's quality lint does not read the fixture text as a real assertion.
    write('tests/login.test.js', LOGIN_TEST.replace('});', '  assert.ok(' + 'true);\n});'));
    commit('test(03-01): cover the edge case');
    assert.deepEqual(codes(I.checkTestIntegrity(dir, '3')), ['always_true_assert']);
  });

  test('another phase\'s commits do not count', (t) => {
    if (guard(t)) return;
    git('rm', '-q', 'tests/other.test.js');
    commit('fix(04-01): remove the other test');
    write('src/login.js', 'module.exports = () => false;\n');
    commit('feat(03-01): deny by default');
    assert.equal(I.checkTestIntegrity(dir, '3').ok, true);
  });
});

describe('test integrity — what it cannot check, and the CLI', () => {
  test('no plan commits for the phase: not checked, never a violation', (t) => {
    if (guard(t)) return;
    const r = I.checkTestIntegrity(dir, '3');
    assert.equal(r.checked, false);
    assert.equal(r.ok, true);
    assert.match(r.reason, /no plan commits/);
  });

  test('an unknown phase is refused', () => {
    assert.equal(I.checkTestIntegrity(dir, '9').error, 'phase_not_found');
  });

  test('CLI: exit 1 and "violated" on a weakened test, exit 0 and "clean" otherwise', (t) => {
    if (guard(t)) return;
    write('src/login.js', 'module.exports = () => 1;\n');
    commit('feat(03-01): first');
    const ok = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'test-integrity', '3', '--raw'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), 'clean');
    git('rm', '-q', 'tests/other.test.js');
    commit('fix(03-01): second');
    const bad = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'test-integrity', '3', '--raw'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout.trim(), 'violated');
  });
});
