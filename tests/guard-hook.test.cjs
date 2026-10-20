/**
 * hooks/pan-guard.js — the pre-tool guard (program A7).
 *
 * Each host's payload (fixtures/hooks/pretool-*.json, derived from the documented
 * fields) normalises to the same call. The rules: a credential written into a file,
 * a direct write to PAN's own state, a test file the phase in flight does not declare.
 * `report` (the default) logs and never denies; `enforce` denies a secret write, a direct
 * write to PAN's state and a judge's write outside the planning tree (A7b), on stderr with exit 2 (Claude, Codex, Gemini) or as Copilot's JSON decision; `off`
 * does nothing. Inert outside a PAN project, fail-open on input it cannot parse.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('../hooks/pan-guard.js');
const { cleanup } = require('./helpers.cjs');

const HOOK = path.join(__dirname, '..', 'hooks', 'pan-guard.js');
const FIX = path.join(__dirname, 'fixtures', 'hooks');
// A credential shape the guard knows, assembled so no scanner reads this file as a leak.
const SECRET = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

let dir;
const payload = (host) => JSON.parse(fs.readFileSync(path.join(FIX, `pretool-${host}.json`), 'utf8')
  .split('{{PROJECT_DIR}}').join(dir.replace(/\\/g, '/')).split('{{SECRET}}').join(SECRET));
const run = (host, body, args = ['--host', host]) => spawnSync(process.execPath, [HOOK, ...args], { cwd: dir, input: typeof body === 'string' ? body : JSON.stringify(body), encoding: 'utf8' });
const guardLog = () => { try { return fs.readFileSync(path.join(dir, '.planning', 'guard.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
const config = (guard) => fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ hooks: { guard } }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-guard-'));
  fs.mkdirSync(path.join(dir, '.planning', 'phases', '03-auth'), { recursive: true });
});
afterEach(() => cleanup(dir));

describe('every host\'s payload normalises to the same call', () => {
  for (const host of ['claude', 'codex', 'gemini', 'copilot']) {
    test(host, () => {
      const call = G.normalise(payload(host));
      assert.equal(call.writes.length, 1, JSON.stringify(call));
      assert.match(call.writes[0].path.replace(/\\/g, '/'), /src\/config\.js$/);
      assert.ok(call.writes[0].text.includes(SECRET));
    });
  }

  test('Edit and MultiEdit carry their new text; a read-only tool carries no write', () => {
    assert.equal(G.normalise({ tool_name: 'Edit', tool_input: { file_path: 'a.js', old_string: 'x', new_string: 'y' } }).writes[0].text, 'y');
    assert.equal(G.normalise({ tool_name: 'MultiEdit', tool_input: { file_path: 'a.js', edits: [{ new_string: 'p' }, { new_string: 'q' }] } }).writes[0].text, 'p\nq');
    assert.deepEqual(G.normalise({ tool_name: 'Read', tool_input: { file_path: 'a.js' } }).writes, []);
  });
});

describe('the rules', () => {
  test('secret_write: a known token shape and a long key=value secret; placeholders are not secrets', () => {
    assert.equal(G.hasSecret(`const k = "${SECRET}";`), true);
    // Assembled at runtime, like SECRET above, so no secret scanner reads the fixture as a leak.
    assert.equal(G.hasSecret('password = "' + 's3cr3tPass' + 'w0rdXyz"'), true);
    assert.equal(G.hasSecret('apiKey: process.env.API_KEY'), false);
    assert.equal(G.hasSecret('password = "${DB_PASSWORD}"'), false);
    assert.equal(G.hasSecret('token = "your-token-here"'), false);
  });

  test('state_write: a direct write to state.md, findings.jsonl or the token ledger', () => {
    const hits = G.evaluate(G.normalise({ tool_name: 'Write', tool_input: { file_path: path.join(dir, '.planning', 'state.md'), content: 'x' } }), dir, '.planning');
    assert.deepEqual(hits.map((h) => h.rule), ['state_write']);
  });

  test('judge_write: a judge agent writing outside the planning tree', () => {
    const hits = G.evaluate({ ...G.normalise({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.js'), new_string: 'x' } }), agent: 'pan-reviewer' }, dir, '.planning');
    assert.deepEqual(hits.map((h) => h.rule), ['judge_write']);
    assert.equal(G.normalise({ agent_type: 'pan-plan-checker', tool_name: 'Read', tool_input: {} }).agent, 'pan-plan-checker');
  });

  test('undeclared_test_edit: a test file outside the unfinished plans of the phase in flight', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'state.md'), '# State\n\n**Current Phase:** 3\n');
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '03-auth', '03-01-plan.md'), '---\nphase: 03-auth\nfiles_modified: [src/login.js, tests/login.test.js]\n---\n');
    const write = (rel) => G.evaluate(G.normalise({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel), new_string: 'x' } }), dir, '.planning').map((h) => h.rule);
    assert.deepEqual(write('tests/login.test.js'), [], 'a declared test');
    assert.deepEqual(write('tests/other.test.js'), ['undeclared_test_edit']);
    assert.deepEqual(write('src/other.js'), [], 'not a test file');
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '03-auth', '03-01-summary.md'), '# done\n');
    assert.deepEqual(write('tests/other.test.js'), [], 'no unfinished plan: nothing in flight to compare with');
  });
});

describe('modes, through the hook process', () => {
  test('report (default): logs the match, never denies, prints nothing', () => {
    const r = run('claude', payload('claude'));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    const [row] = guardLog();
    assert.deepEqual([row.rule, row.mode, row.action, row.host], ['secret_write', 'report', 'reported', 'claude']);
  });

  for (const host of ['claude', 'codex', 'gemini']) {
    test(`enforce on ${host}: a secret write is denied with exit 2 and the reason on stderr`, () => {
      config('enforce');
      const r = run(host, payload(host));
      assert.equal(r.status, 2);
      assert.match(r.stderr, /PAN guard: this write puts a credential into/);
      assert.equal(guardLog()[0].action, 'denied');
    });
  }

  test('enforce on copilot: the deny is Copilot\'s JSON decision on stdout, exit 0', () => {
    config('enforce');
    const r = run('copilot', payload('copilot'));
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /credential/);
  });

  test('enforce denies a direct state.md write (A7b: its writers go through pan-tools)', () => {
    config('enforce');
    const r = run('claude', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, '.planning', 'state.md'), content: 'x' } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /pan-tools state/);
    assert.equal(guardLog()[0].action, 'denied');
  });

  test('report only logs a state write', () => {
    const r = run('claude', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, '.planning', 'state.md'), content: 'x' } });
    assert.equal(r.status, 0);
    assert.equal(guardLog()[0].action, 'reported');
  });

  test('enforce denies a judge editing source, and lets it write its report in the planning tree', () => {
    config('enforce');
    const src = run('claude', { cwd: dir, agent_type: 'pan-verifier', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.js'), new_string: 'x' } });
    assert.equal(src.status, 2);
    assert.match(src.stderr, /judge/);
    const report = run('claude', { cwd: dir, agent_type: 'pan-verifier', tool_name: 'Write', tool_input: { file_path: path.join(dir, '.planning', 'phases', '03-auth', '03-verification.md'), content: 'x' } });
    assert.equal(report.status, 0);
    const executor = run('claude', { cwd: dir, agent_type: 'pan-executor', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.js'), new_string: 'x' } });
    assert.equal(executor.status, 0, 'an executor edits source');
  });

  test('undeclared_test_edit still only reports under enforce', () => {
    config('enforce');
    fs.writeFileSync(path.join(dir, '.planning', 'state.md'), '# State\n\n**Current Phase:** 3\n');
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '03-auth', '03-01-plan.md'), '---\nphase: 03-auth\nfiles_modified: [src/login.js]\n---\n');
    const r = run('claude', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'tests', 'x.test.js'), new_string: 'x' } });
    assert.equal(r.status, 0);
  });

  test('off: nothing at all', () => {
    config('off');
    const r = run('claude', payload('claude'));
    assert.equal(r.status, 0);
    assert.deepEqual(guardLog(), []);
  });
});

describe('the deny format follows the payload, not only the registration', () => {
  test('a camelCase Copilot payload is Copilot whatever --host says; snake_case keeps the flag', () => {
    assert.equal(G.hostOf({ toolName: 'create', toolArgs: '{}' }, 'claude'), 'copilot');
    assert.equal(G.hostOf({ tool_name: 'Write', tool_input: {} }, 'claude'), 'claude');
    assert.equal(G.hostOf({ tool_name: 'write_file', tool_input: {} }, 'gemini'), 'gemini');
    assert.equal(G.hostOf({ toolName: 'x', tool_name: 'x' }, 'codex'), 'codex', 'a payload carrying the snake_case key is not Copilot\'s');
    assert.equal(G.hostOf(null, 'claude'), 'claude');
  });
});

describe('inert and fail-open', () => {
  test('outside a PAN project: nothing, whatever the payload', () => {
    fs.rmSync(path.join(dir, '.planning'), { recursive: true });
    const r = run('claude', payload('claude'));
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('unparseable input, an empty payload, or a payload that is not an object: exit 0, silent', () => {
    for (const body of ['not json', '', 'null', '42']) {
      const r = run('claude', body);
      assert.equal(r.status, 0, `${JSON.stringify(body)}: ${r.stderr}`);
      assert.equal(r.stderr, '');
    }
  });
});
