/**
 * Program L8: UAT that runs on every runtime (walkthrough → uat.md → diagnose).
 *
 * The walkthrough is a portable markdown workflow; what it writes goes through the
 * engine, so every runtime leaves the same uat.md: `uat record` sets one test's result
 * and rebuilds the summary and the gaps the diagnose step and `plan-phase --gaps` read;
 * `uat status` reports what is left. Diagnosis fields a gap already carries survive a
 * re-record.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('../pan-wizard-core/bin/lib/uat.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
let uatFile;
const PENDING = [
  '---', 'status: testing', 'phase: 01-greetings', 'source: [01-01-summary.md]', 'started: 2026-10-20T08:00:00Z', 'updated: 2026-10-20T08:00:00Z', '---', '',
  '## Current Test', '', 'number: 1', 'name: greet', 'expected: |', '  greet returns Hello', 'awaiting: user response', '',
  '## Tests', '',
  '### 1. greet returns the greeting', 'expected: greet(\'Ada\') returns Hello, Ada!', 'result: [pending]', '',
  '### 2. farewell punctuation', 'expected: farewell(\'Ada\') returns Goodbye, Ada.', 'result: [pending]', '',
  '## Summary', '', 'total: 2', 'passed: 0', 'issues: 0', 'pending: 2', 'skipped: 0', '',
  '## Gaps', '', '<!-- YAML format for plan-phase --gaps consumption -->', '',
].join('\n');

beforeEach(() => {
  dir = createTempProject();
  fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'), '# Roadmap\n\n### Phase 1: Greetings\n');
  const phaseDir = path.join(dir, '.planning', 'phases', '01-greetings');
  fs.mkdirSync(phaseDir, { recursive: true });
  uatFile = path.join(phaseDir, '01-uat.md');
  fs.writeFileSync(uatFile, PENDING);
});
afterEach(() => cleanup(dir));

describe('parseUat (L8)', () => {
  test('reads each test with its expected behaviour and result', () => {
    const u = U.parseUat(PENDING);
    assert.deepEqual(u.tests.map((t) => [t.number, t.name, t.result]), [[1, 'greet returns the greeting', 'pending'], [2, 'farewell punctuation', 'pending']]);
    assert.equal(u.status, 'testing');
  });
});

describe('uat record and status (L8)', () => {
  test('a pass and an issue rebuild the summary and the gaps; the session completes when nothing is pending', () => {
    U.recordUatResult(dir, '1', { test: 1, result: 'pass' });
    let s = U.uatStatus(dir, '1');
    assert.deepEqual([s.passed, s.issues, s.pending, s.complete], [1, 0, 1, false]);
    U.recordUatResult(dir, '1', { test: 2, result: 'issue', reported: 'it prints Goodbye, Ada! with an exclamation mark', severity: 'major' });
    s = U.uatStatus(dir, '1');
    assert.deepEqual([s.passed, s.issues, s.pending, s.complete], [1, 1, 0, true]);
    assert.equal(s.gaps.length, 1);
    assert.equal(s.gaps[0].test, 2);
    assert.match(s.gaps[0].reason, /exclamation mark/);
    const text = fs.readFileSync(uatFile, 'utf8');
    assert.match(text, /^status: complete$/m);
    assert.match(text, /### 2\. farewell punctuation\nexpected: .*\nresult: issue\nreported: "it prints Goodbye, Ada! with an exclamation mark"\nseverity: major/);
    assert.match(text, /## Summary\n\ntotal: 2\npassed: 1\nissues: 1\npending: 0\nskipped: 0/);
    assert.match(text, /- truth: "farewell\('Ada'\) returns Goodbye, Ada\."\n  status: failed\n  reason: "User reported: it prints Goodbye, Ada! with an exclamation mark"\n  severity: major\n  test: 2/);
  });

  test('re-recording keeps the diagnosis a gap already carries', () => {
    U.recordUatResult(dir, '1', { test: 2, result: 'issue', reported: 'wrong punctuation', severity: 'major' });
    fs.writeFileSync(uatFile, fs.readFileSync(uatFile, 'utf8').replace('  test: 2\n', '  test: 2\n  root_cause: "the template uses !"\n  debug_session: ".planning/debug/farewell.md"\n'));
    U.recordUatResult(dir, '1', { test: 1, result: 'pass' });
    const text = fs.readFileSync(uatFile, 'utf8');
    assert.match(text, /root_cause: "the template uses !"/);
    assert.match(text, /debug_session: ".planning\/debug\/farewell.md"/);
  });

  test('an unknown test number or result is refused', () => {
    assert.equal(U.recordUatResult(dir, '1', { test: 9, result: 'pass' }).error, 'test_not_found');
    assert.equal(U.recordUatResult(dir, '1', { test: 1, result: 'maybe' }).error, 'invalid_result');
  });

  test('CLI: uat record then uat status', () => {
    const rec = spawnSync(process.execPath, [TOOLS_PATH, 'uat', 'record', '1', '--test', '2', '--result', 'issue', '--reported', 'wrong mark', '--severity', 'minor'], { cwd: dir, encoding: 'utf8' });
    assert.equal(rec.status, 0, rec.stdout + rec.stderr);
    const st = spawnSync(process.execPath, [TOOLS_PATH, 'uat', 'status', '1', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.equal(st.stdout.trim(), '0 passed, 1 issues, 1 pending');
  });
});
