/**
 * mutate.cjs — the mutation report on a phase's diff (program V5).
 *
 * The operator tables per language, the changed-line filter, and the report end to end
 * in a real git repository: phase 2 adds `isAdult` and `inRange` (four mutants, none of
 * them equivalent). Weak tests let all four survive; strong tests kill all four. A flaky
 * suite aborts before any mutant is read, so does a suite that already fails, `off` runs
 * nothing, and the user's working tree is never touched (mutants run in a worktree).
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const M = require('../pan-wizard-core/bin/lib/mutate.cjs');
const { cleanup, TOOLS_PATH } = require('./helpers.cjs');

describe('operators and lines', () => {
  test('each language family has its own swaps', () => {
    assert.equal(M.languageOf('src/a.ts').family, 'js');
    assert.equal(M.languageOf('pkg/a.go').family, 'c');
    assert.equal(M.languageOf('app/a.py').family, 'py');
    assert.equal(M.languageOf('README.md'), null);
    const py = M.mutationsFor('def ok(a, b):\n    return a and b\n# a and b in a comment\n', { family: 'py', comments: ['#'] });
    assert.deepEqual(py.map((m) => [m.line, m.op, m.after.trim()]), [[2, 'and→or', 'return a or b']]);
    const go = M.mutationsFor('if a == b {\n', { family: 'c' });
    assert.deepEqual(go.map((m) => m.op), ['eq→neq']);
    assert.deepEqual(M.mutationsFor('if (a === b) {}\n', { family: 'js' }).map((m) => m.op), ['eq→neq']);
  });

  test('only the lines asked for', () => {
    const src = 'const a = x >= 1;\nconst b = y >= 2;\n';
    assert.deepEqual(M.mutationsFor(src, { family: 'js', lines: new Set([2]) }).map((m) => m.line), [2]);
  });

  test('a seeded sample is reproducible', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    assert.deepEqual(M.sample(items, 5, 7), M.sample(items, 5, 7));
    assert.notDeepEqual(M.sample(items, 5, 7), M.sample(items, 5, 8));
  });
});

describe('verify mutate, end to end', () => {
  let dir;
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  const SRC = '// age and range checks\nexports.isAdult = (age) => age >= 18;\nexports.inRange = (x, lo, hi) => x >= lo && x <= hi;\n';
  const TEST = (asserts) => `const test = require('node:test');\nconst assert = require('node:assert');\nconst { isAdult, inRange } = require('../src/rules.js');\ntest('rules', () => {\n${asserts}\n});\n`;
  const WEAK = TEST('  assert.equal(isAdult(30), true);\n  assert.equal(inRange(5, 0, 10), true);');
  const STRONG = TEST('  assert.equal(isAdult(18), true);\n  assert.equal(isAdult(17), false);\n  assert.equal(inRange(0, 0, 10), true);\n  assert.equal(inRange(10, 0, 10), true);\n  assert.equal(inRange(-1, 0, 10), false);\n  assert.equal(inRange(11, 0, 10), false);');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mut-'));
    git('init', '-q');
    write('.planning/roadmap.md', '# Roadmap\n\n### Phase 2: Rules\n');
    write('.planning/phases/02-rules/02-01-plan.md', '---\nphase: 02-rules\nplan: 01\n---\n');
    write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
    write('README.md', '# x\n');
    commit('chore: before phase 2');
  });
  afterEach(() => cleanup(dir));

  const phase = (testText) => {
    write('src/rules.js', SRC);
    write('test/rules.test.js', testText);
    commit('feat(02-01): rules');
  };

  test('gate: weak tests let every mutant survive, listed by file, line and swap', () => {
    phase(WEAK);
    const r = M.mutatePhase(dir, '2');
    assert.equal(r.checked, true);
    assert.equal(r.mode, 'report');
    assert.equal(r.sampled, 4);
    assert.equal(r.killed, 0);
    assert.deepEqual(r.survivors.map((s) => `${s.file}:${s.line} ${s.op}`).sort(), ['src/rules.js:2 gte→gt', 'src/rules.js:3 and→or', 'src/rules.js:3 gte→gt', 'src/rules.js:3 lte→lt']);
  });

  test('gate: strong tests kill every mutant', () => {
    phase(STRONG);
    const r = M.mutatePhase(dir, '2');
    assert.equal(r.sampled, 4);
    assert.equal(r.killed, 4);
    assert.deepEqual(r.survivors, []);
    assert.equal(r.score, 1);
  });

  test('the CLI writes the record, exits 0 in report mode, and leaves the working tree alone', () => {
    phase(WEAK);
    const out = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'mutate', '--phase', '2', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout.trim(), '0/4 killed');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'phases', '02-rules', '02-mutation.json'), 'utf8'));
    assert.equal(rec.survived, 4);
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'rules.js'), 'utf8'), SRC, 'mutants ran in a worktree, not here');
    assert.equal(git('worktree', 'list').trim().split('\n').length, 1);
  });

  test('flake pre-check: a suite that passes once and fails once aborts before any mutant', () => {
    const counter = path.join(dir, '..', `${path.basename(dir)}-counter`).replace(/\\/g, '/');
    phase(STRONG.replace("test('rules', () => {", `test('rules', () => {\n  const fs = require('fs');\n  const n = fs.existsSync('${counter}') ? Number(fs.readFileSync('${counter}', 'utf8')) : 0;\n  fs.writeFileSync('${counter}', String(n + 1));\n  assert.equal(n % 2, 0);`));
    try {
      const r = M.mutatePhase(dir, '2');
      assert.equal(r.aborted, 'flaky');
      assert.equal(r.checked, false);
      assert.match(r.reason, /passed once and failed once/);
    } finally { fs.rmSync(counter, { force: true }); }
  });

  test('a suite that already fails aborts; off runs nothing; no plan commits is not checked', () => {
    assert.match(M.mutatePhase(dir, '2').reason, /no plan commits/);
    phase(TEST('  assert.equal(isAdult(1), true);'));
    assert.equal(M.mutatePhase(dir, '2').aborted, 'suite_fails');
    write('.planning/config.json', JSON.stringify({ workflow: { mutation_gate: 'off' } }));
    const off = M.mutatePhase(dir, '2');
    assert.equal(off.checked, false);
    assert.match(off.reason, /mutation_gate is off/);
  });
});
