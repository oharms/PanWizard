/**
 * pan-wizard-core/bin/lib/test-gate.cjs — the engine-run test gate (program V2).
 *
 * Every parser is tested on output its runner really emitted (tests/fixtures/test-runs/,
 * captured 2026-10-13 from node 24 and 22, jest 29.7.0 on Windows and Linux, pytest 9
 * and 6, go 1.27, cargo 1.99, and JUnit XML from node and pytest; local paths scrubbed to
 * `X:\fixture` and `/fixture`). Then the classifier, detection, and the gate end to end:
 * a regression of a phase-1 test seeded in phase 2 is caught against the baseline, a
 * failure the baseline already had is not a regression, and a crash is failed, never
 * skipped.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const T = require('../pan-wizard-core/bin/lib/test-gate.cjs');
const { cleanup, TOOLS_PATH } = require('./helpers.cjs');

const FIX = path.join(__dirname, 'fixtures', 'test-runs');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

describe('parsers, on real emitted output', () => {
  const NODE = String.raw`X:\fixture\node`;
  const cases = [
    ['node-spec.txt', NODE, { runner: 'node', total: 3, passed: 2, failed: 1, failing: ['test/math.test.js > subtracts numbers'] }],
    ['node-tap.txt', NODE, { runner: 'node-tap', total: 3, passed: 2, failed: 1, failing: ['test/math.test.js > subtracts numbers'] }],
    ['node-junit.xml', NODE, { runner: 'junit', total: 3, passed: 2, failed: 1, failing: ['test/math.test.js > subtracts numbers'] }],
    ['node-pass.txt', null, { runner: 'node', total: 2, passed: 2, failed: 0, failing: [] }],
    ['jest.txt', null, { runner: 'jest', total: 3, passed: 2, failed: 1, failing: ['__tests__/math.test.js > subtracts numbers'] }],
    ['jest-posix.txt', null, { runner: 'jest', total: 3, passed: 2, failed: 1, failing: ['__tests__/math.test.js > subtracts numbers'] }],
    ['pytest.txt', null, { runner: 'pytest', total: 3, passed: 2, failed: 1, failing: ['test_math.py::test_subtracts'] }],
    ['pytest6-posix.txt', null, { runner: 'pytest', total: 3, passed: 2, failed: 1, failing: ['test_math.py::test_subtracts'] }],
    ['pytest-pass.txt', null, { runner: 'pytest', total: 1, passed: 1, failed: 0, failing: [] }],
    ['pytest-junit.xml', null, { runner: 'junit', total: 3, passed: 2, failed: 1, failing: ['test_math > test_subtracts'] }],
    ['go.txt', null, { runner: 'go', total: null, passed: null, failed: 1, failing: ['example.com/calc/calc > TestSubtract'] }],
    ['go-v.txt', null, { runner: 'go', total: 3, passed: 2, failed: 1, failing: ['example.com/calc/calc > TestSubtract'] }],
    ['cargo.txt', null, { runner: 'cargo', total: 2, passed: 1, failed: 1, failing: ['tests::subtracts'] }],
  ];
  for (const [file, cwd, want] of cases) {
    test(`${file}: ${want.runner}, ${want.failed} failing`, () => {
      const r = T.parseTestOutput(read(file), cwd);
      assert.equal(r.parsed, true);
      for (const k of Object.keys(want)) assert.deepEqual(r[k], want[k], `${file} ${k}`);
    });
  }

  test('the same failure has the same id from node\'s spec, TAP and JUnit reporters', () => {
    const NODE_CWD = String.raw`X:\fixture\node`;
    const ids = ['node-spec.txt', 'node-tap.txt', 'node-junit.xml'].map((f) => T.parseTestOutput(read(f), NODE_CWD).failing);
    assert.deepEqual(ids[1], ids[0]);
    assert.deepEqual(ids[2], ids[0]);
  });

  test('crashes: each runner\'s "did not run" output is a crash or unparsed, never a clean count', () => {
    assert.equal(T.parseTestOutput(read('jest-crash.txt')).crashed, true);
    assert.equal(T.parseTestOutput(read('pytest-crash.txt')).crashed, true);
    assert.equal(T.parseTestOutput(read('go-crash.txt')).crashed, true);
    assert.equal(T.parseTestOutput(read('cargo-crash.txt')).parsed, false, 'a compile error prints no test result');
    for (const f of ['jest-crash.txt', 'pytest-crash.txt', 'go-crash.txt', 'cargo-crash.txt', 'node-crash.txt']) {
      const p = T.parseTestOutput(read(f));
      assert.equal(T.classifyRun({ command: 'x', exit: f.startsWith('cargo') ? 101 : (f.startsWith('pytest') ? 2 : 1), parse: p }).status, 'failed', f);
    }
  });

  test('ANSI colour codes are stripped before parsing', () => {
    const coloured = '\u001b[1mTests:\u001b[22m       \u001b[31m1 failed\u001b[39m, 2 passed, 3 total\nFAIL a.test.js\n  ● x › y\n';
    assert.deepEqual(T.parseTestOutput(coloured).failing, ['a.test.js > x › y']);
  });
});

describe('classifyRun', () => {
  const parsed = (failing, extra = {}) => ({ runner: 'node', parsed: true, total: 5, passed: 5 - failing.length, failed: failing.length, skipped: 0, failing, ...extra });

  test('no command is skipped, with the reason', () => {
    assert.deepEqual(T.classifyRun({ command: null, reason: 'none here' }).status, 'skipped');
  });
  test('exit 0 is passed; exit 0 with no tests is skipped; exit 0 with reported failures is failed', () => {
    assert.equal(T.classifyRun({ command: 'x', exit: 0, parse: parsed([]) }).status, 'passed');
    assert.equal(T.classifyRun({ command: 'x', exit: 0, parse: { ...parsed([]), total: 0, passed: 0 } }).status, 'skipped');
    assert.equal(T.classifyRun({ command: 'x', exit: 0, parse: parsed(['a']) }).status, 'failed');
    assert.equal(T.classifyRun({ command: 'x', exit: 0, parse: { parsed: false, failing: [] } }).status, 'passed', 'an unknown runner that exits 0');
  });
  test('a non-zero exit with no failing test is a suite that did not run: failed, never skipped', () => {
    const r = T.classifyRun({ command: 'x', exit: 1, parse: { parsed: false, failing: [] } });
    assert.equal(r.status, 'failed');
    assert.match(r.reason, /suite did not run/);
    assert.equal(T.classifyRun({ command: 'x', exit: 1, parse: parsed([]) }).status, 'failed');
    assert.equal(T.classifyRun({ command: 'x', timed_out: true, exit: null, parse: parsed([]) }).status, 'failed');
  });
  test('against a baseline: a pre-existing failure passes, a new one is a regression', () => {
    const base = { command: 'x', failing: ['old'], parsed: true };
    const pre = T.classifyRun({ command: 'x', exit: 1, parse: parsed(['old']) }, base);
    assert.equal(pre.status, 'passed');
    assert.deepEqual(pre.preexisting, ['old']);
    const reg = T.classifyRun({ command: 'x', exit: 1, parse: parsed(['old', 'new']) }, base);
    assert.equal(reg.status, 'failed');
    assert.deepEqual(reg.regressions, ['new']);
    assert.equal(T.classifyRun({ command: 'y', exit: 1, parse: parsed(['old']) }, base).status, 'failed', 'a baseline of another command compares nothing');
    assert.equal(T.classifyRun({ command: 'x', exit: 1, parse: parsed(['old'], { crashed: true }) }, base).status, 'failed', 'a crash is never excused by a baseline');
  });
});

describe('detectTestCommand', () => {
  const project = (files, config) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-tg-detect-'));
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    if (config) fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(config));
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
    return dir;
  };
  const cases = [
    [{ 'package.json': '{"scripts":{"test":"jest"}}' }, null, 'npm test'],
    [{ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}', 'go.mod': 'module x' }, null, 'go test ./...'],
    [{ 'pyproject.toml': '[tool.pytest.ini_options]\n' }, null, 'python -m pytest'],
    [{ 'pytest.ini': '[pytest]\n' }, null, 'python -m pytest'],
    [{ 'Cargo.toml': '[package]\n' }, null, 'cargo test'],
    [{ 'pom.xml': '<project/>' }, null, 'mvn -q test'],
    [{ 'build.gradle.kts': '' }, null, 'gradle test'],
    [{ 'Makefile': 'build:\n\tcc x\ntest:\n\t./run\n' }, null, 'make test'],
    [{ 'package.json': '{"scripts":{"test":"jest"}}' }, { workflow: { test_command: 'make check' } }, 'make check'],
  ];
  for (const [files, config, want] of cases) {
    test(`${Object.keys(files).join(' + ')}${config ? ' + workflow.test_command' : ''} → ${want}`, () => {
      const dir = project(files, config);
      try { assert.equal(T.detectTestCommand(dir).command, want); } finally { cleanup(dir); }
    });
  }
  test('nothing to run: no command, with a reason that says how to set one', () => {
    const dir = project({ 'README.md': '# x' });
    try {
      const d = T.detectTestCommand(dir);
      assert.equal(d.command, null);
      assert.match(d.reason, /workflow\.test_command/);
    } finally { cleanup(dir); }
  });
});

describe('pan-tools test run, end to end', () => {
  const pan = (dir, ...args) => {
    const r = spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const project = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-tg-'));
    for (const d of ['01-sum', '02-format']) fs.mkdirSync(path.join(dir, '.planning', 'phases', d), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'), '# Roadmap\n\n### Phase 1: Sum\n\n### Phase 2: Format\n');
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ workflow: { test_command: 'node --test --test-reporter=spec' } }));
    fs.mkdirSync(path.join(dir, 'test'));
    // Phase 1 built sum() and its test.
    fs.writeFileSync(path.join(dir, 'sum.js'), 'module.exports = (a, b) => a + b;\n');
    fs.writeFileSync(path.join(dir, 'test', 'sum.test.js'), "const test = require('node:test');\nconst assert = require('node:assert');\nconst sum = require('../sum.js');\ntest('sums', () => assert.strictEqual(sum(2, 3), 5));\n");
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  };

  test('gate: a phase-1 regression seeded in phase 2 is caught against the phase-2 baseline', () => {
    const dir = project();
    try {
      const base = pan(dir, 'test', 'run', '--phase', '2', '--baseline');
      assert.equal(base.status, 'passed');
      assert.equal(base.record, '.planning/phases/02-format/02-test-baseline.json');
      // Phase 2 "refactors" sum and breaks it.
      fs.writeFileSync(path.join(dir, 'sum.js'), 'module.exports = (a, b) => a - b;\n');
      const run = pan(dir, 'test', 'run', '--phase', '2');
      assert.equal(run.status, 'failed');
      assert.deepEqual(run.regressions, ['test/sum.test.js > sums']);
      assert.equal(run.baseline.status, 'passed');
      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'phases', '02-format', '02-test-run.json'), 'utf8'));
      assert.equal(onDisk.status, 'failed');
      assert.equal(T.readTestRun(dir, '2').status, 'failed');
      assert.deepEqual(T.testRunFacts(dir, '2').map((f) => [f.fact, f.ok]), [['test_run', false]]);
      // A gaps-only round baselines again: the phase's starting point is kept, so the
      // regression is still a regression.
      const again = pan(dir, 'test', 'run', '--phase', '2', '--baseline');
      assert.equal(again.kept_existing, true);
      assert.equal(again.status, 'passed');
      assert.equal(pan(dir, 'test', 'run', '--phase', '2').status, 'failed');
      assert.equal(pan(dir, 'test', 'run', '--phase', '2', '--baseline', '--rebaseline').status, 'failed', '--rebaseline runs it again');
    } finally { cleanup(dir); }
  });

  test('a failure the baseline already had is pre-existing, not a regression', () => {
    const dir = project();
    try {
      fs.writeFileSync(path.join(dir, 'test', 'old.test.js'), "require('node:test')('known broken', () => { throw new Error('x'); });\n");
      assert.equal(pan(dir, 'test', 'run', '--phase', '2', '--baseline').status, 'failed');
      const run = pan(dir, 'test', 'run', '--phase', '2');
      assert.equal(run.status, 'passed');
      assert.deepEqual(run.preexisting_failures, ['test/old.test.js > known broken']);
      assert.deepEqual(run.regressions, []);
    } finally { cleanup(dir); }
  });

  test('a suite that cannot run is failed, never skipped; no command at all is skipped', () => {
    const dir = project();
    try {
      fs.writeFileSync(path.join(dir, 'sum.js'), 'module.exports = (a, b) => a +;\n');
      const crashed = pan(dir, 'test', 'run', '--phase', '2');
      assert.equal(crashed.status, 'failed');
      fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{}');
      const none = pan(dir, 'test', 'run');
      assert.equal(none.status, 'skipped');
      assert.equal(none.command, null);
      assert.equal(pan(dir, 'test', 'detect').command, null);
    } finally { cleanup(dir); }
  });
});
