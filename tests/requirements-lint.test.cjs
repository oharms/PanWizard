/**
 * Program V8: requirements with EARS criteria, a requirements lint, and a truth→test
 * trace matrix. A requirement is ticked only on passing tests.
 *
 * Code gate (docs/specs/product-excellence-superplan.md): a scenario-less requirement
 * fails the lint; an untested truth reads not_checked; a tick needs a passing mapped
 * test. Legacy requirements (no criteria at all) keep the old tick so existing
 * projects are not frozen.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const RL = require('../pan-wizard-core/bin/lib/requirements-lint.cjs');
const P = require('../pan-wizard-core/bin/lib/phase.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
const REQS = [
  '# Requirements: X', '', '## v1 Requirements', '', '### Auth', '',
  '- [ ] **AUTH-01**: User can sign in with email and password',
  '  - WHEN a user submits a correct email and password THE SYSTEM SHALL start a session',
  '  - IF the password is wrong THEN THE SYSTEM SHALL refuse the sign-in',
  '  - Test: tests/auth-pass.test.js',
  '- [ ] **AUTH-02**: User can reset a password',
  '  - WHEN a user asks for a reset THE SYSTEM SHALL email a single-use link',
  '  - Test: tests/auth-fail.test.js',
  '- [ ] **AUTH-03**: User session persists across refresh',
  '  - WHILE a session is valid THE SYSTEM SHALL keep the user signed in',
  '- [ ] **AUTH-04**: Legacy requirement with no criteria',
  '', '## v2 Requirements', '', '- **AUTH-09**: Deferred, no checkbox', '',
].join('\n');

beforeEach(() => {
  dir = createTempProject();
  fs.writeFileSync(path.join(dir, '.planning', 'requirements.md'), REQS);
  fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ workflow: { test_file_command: 'node {file}' } }));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'auth-pass.test.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(dir, 'tests', 'auth-fail.test.js'), 'process.exit(1);\n');
});
afterEach(() => cleanup(dir));

describe('parseRequirements (V8)', () => {
  test('reads each requirement, its EARS criteria and its mapped tests', () => {
    const reqs = RL.parseRequirements(REQS);
    const a1 = reqs.find((r) => r.id === 'AUTH-01');
    assert.equal(a1.criteria.length, 2);
    assert.deepEqual(a1.tests, ['tests/auth-pass.test.js']);
    assert.equal(reqs.find((r) => r.id === 'AUTH-09').v1, false, 'a requirement without a checkbox is deferred');
    assert.ok(RL.isEars('THE SYSTEM SHALL log every sign-in'));
    assert.ok(!RL.isEars('the login page looks nice'));
  });
});

describe('verify requirements: a scenario-less requirement fails the lint (V8)', () => {
  test('AUTH-04 has no criterion and is the only error; v2 requirements are not linted', () => {
    const r = RL.lintRequirements(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => [e.code, e.id]), [['req_no_scenario', 'AUTH-04']]);
    const cli = spawnSync(process.execPath, [TOOLS_PATH, 'verify', 'requirements', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual([cli.status, cli.stdout.trim()], [1, 'invalid']);
  });
});

describe('verify traceability: the truth→test matrix (V8)', () => {
  test('a mapped passing test reads passed, a failing one failing, an unmapped truth not_checked', () => {
    const m = RL.traceMatrix(dir);
    const status = Object.fromEntries(m.requirements.map((r) => [r.id, r.status]));
    assert.deepEqual(status, { 'AUTH-01': 'passed', 'AUTH-02': 'failing', 'AUTH-03': 'not_checked', 'AUTH-04': 'legacy' });
  });
});

describe('phase complete ticks a requirement only on passing tests (V8)', () => {
  test('AUTH-01 is ticked; AUTH-02 (failing) and AUTH-03 (untested) are held; legacy AUTH-04 keeps the old tick', () => {
    const roadmap = '# Roadmap\n\n### Phase 1: Auth\n**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04\n';
    const r = P.markRequirementsCompleteForPhase(dir, '1', roadmap);
    assert.equal(r.updated, true);
    const text = fs.readFileSync(path.join(dir, '.planning', 'requirements.md'), 'utf8');
    assert.match(text, /- \[x\] \*\*AUTH-01\*\*/);
    assert.match(text, /- \[ \] \*\*AUTH-02\*\*/);
    assert.match(text, /- \[ \] \*\*AUTH-03\*\*/);
    assert.match(text, /- \[x\] \*\*AUTH-04\*\*/);
    assert.deepEqual(r.held.map((h) => [h.id, h.status]), [['AUTH-02', 'failing'], ['AUTH-03', 'not_checked']]);
  });
});
