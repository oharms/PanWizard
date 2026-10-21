/**
 * Program P5: a reproduction per requirement, and a case base of resolved debug sessions.
 *
 * `debug repro <slug>` runs the reproduction a debug session recorded: a seeded gap
 * closes only when its reproduction turns green. `debug similar "<symptom>"` ranks the
 * resolved sessions by how much their symptoms and root cause overlap the new symptom,
 * so a recurring bug starts from the fix that worked last time.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const D = require('../pan-wizard-core/bin/lib/debug-cases.cjs');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
const session = ({ status = 'resolved', expected, actual, errors = '', command, requirement, rootCause = '', fix = '' }) => [
  '---', `status: ${status}`, 'trigger: "x"', 'created: 2026-10-20T00:00:00Z', 'updated: 2026-10-20T00:00:00Z', '---', '',
  '## Symptoms', '', `expected: ${expected}`, `actual: ${actual}`, `errors: ${errors}`, 'reproduction: run it', 'started: always', '',
  '## Reproduction', '', `command: ${command}`, 'fails_with: wrong output', 'deterministic: yes', ...(requirement ? [`requirement: ${requirement}`] : []), '',
  '## Resolution', '', `root_cause: ${rootCause}`, `fix: ${fix}`, 'verification: ran it', 'files_changed: []', '',
].join('\n');

beforeEach(() => {
  dir = createTempProject();
  fs.mkdirSync(path.join(dir, '.planning', 'debug', 'resolved'), { recursive: true });
});
afterEach(() => cleanup(dir));

describe('parseDebugSession (P5)', () => {
  test('reads the symptoms, the reproduction (with its requirement) and the resolution', () => {
    const s = D.parseDebugSession(session({ expected: 'login works', actual: 'login 500s', command: 'node check.js', requirement: 'REQ-4', rootCause: 'null session', fix: 'guard it' }));
    assert.equal(s.status, 'resolved');
    assert.equal(s.reproduction.command, 'node check.js');
    assert.equal(s.reproduction.requirement, 'REQ-4');
    assert.equal(s.resolution.root_cause, 'null session');
    assert.equal(s.symptoms.actual, 'login 500s');
  });
});

describe('debug repro: a gap closes only on a green reproduction (P5)', () => {
  test('a failing reproduction is red and exits 1; once the fix lands it is green and exits 0', () => {
    fs.writeFileSync(path.join(dir, 'check.js'), 'process.exit(require("./value.json").ok ? 0 : 1);\n');
    fs.writeFileSync(path.join(dir, 'value.json'), '{"ok": false}');
    fs.writeFileSync(path.join(dir, '.planning', 'debug', 'login-500.md'), session({ status: 'fixing', expected: 'ok', actual: 'fails', command: 'node check.js', requirement: 'REQ-4' }));
    const red = spawnSync(process.execPath, [TOOLS_PATH, 'debug', 'repro', 'login-500', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual([red.status, red.stdout.trim()], [1, 'red']);
    fs.writeFileSync(path.join(dir, 'value.json'), '{"ok": true}');
    const green = spawnSync(process.execPath, [TOOLS_PATH, 'debug', 'repro', 'login-500'], { cwd: dir, encoding: 'utf8' });
    assert.equal(green.status, 0, green.stdout);
    const json = JSON.parse(green.stdout);
    assert.equal(json.result, 'green');
    assert.equal(json.requirement, 'REQ-4');
    assert.equal(json.closable, true);
  });

  test('a session with no reproduction is not closable on this check', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'debug', 'flaky.md'), session({ status: 'fixing', expected: 'a', actual: 'b', command: 'none' }));
    const r = D.reproCheck(dir, 'flaky');
    assert.equal(r.result, 'none');
    assert.equal(r.closable, false);
  });

  test('a slug that escapes the debug directory is refused', () => {
    assert.equal(D.reproCheck(dir, '../../etc/passwd').error, 'invalid_slug');
  });
});

describe('debug similar: the resolved case base (P5)', () => {
  test('ranks resolved sessions by overlap with the symptom, best first, and skips unrelated ones', () => {
    const write = (slug, s) => fs.writeFileSync(path.join(dir, '.planning', 'debug', 'resolved', `${slug}.md`), session(s));
    write('token-expiry', { expected: 'refresh token renews the session', actual: 'session expires after refresh token renewal', command: 'node a.js', rootCause: 'refresh token TTL reset to zero', fix: 'carry the TTL over' });
    write('csv-export', { expected: 'export writes every row', actual: 'export drops the last row', command: 'node b.js', rootCause: 'off-by-one in the paginator', fix: 'inclusive bound' });
    write('login-500', { expected: 'login works', actual: 'login returns 500 when the session token expired', command: 'node c.js', rootCause: 'expired token not handled', fix: 'refresh first' });
    const r = D.similarCases(dir, 'the session expires right after the refresh token is renewed');
    assert.deepEqual(r.cases.map((c) => c.slug), ['token-expiry', 'login-500']);
    assert.ok(r.cases[0].score > r.cases[1].score);
    assert.equal(r.cases[0].root_cause, 'refresh token TTL reset to zero');
    assert.equal(r.cases[0].fix, 'carry the TTL over');
  });

  test('CLI: debug similar returns the cases, and an empty case base is not an error', () => {
    const r = spawnSync(process.execPath, [TOOLS_PATH, 'debug', 'similar', 'anything at all'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).cases, []);
  });
});
