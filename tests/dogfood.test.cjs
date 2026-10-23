/**
 * Program S6: PAN on PAN, the dogfood lane (development only).
 *
 * The lane runs PAN's own loop on PAN's source: a worktree of the repository on a local
 * `bot/dogfood/<id>` branch, PAN installed from the packed tarball with `--global
 * --config-dir <scratch>` (so nothing is ever installed into the source repository), one
 * finding handed to `/pan:quick --full`, and the branch kept only when the quick task's
 * verification passed and its diff passes the scope check. Never published. The run
 * itself spends (paid); here every step is a stand-in.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = require('../harness/autopilot/dogfood.cjs');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('S6: the plan', () => {
  const plan = D.planDogfood({ repo: ROOT, root: path.join(os.tmpdir(), 'pan-dogfood-root'), id: 'r1', finding: { id: 'a1', summary: 'quick-mode exits 1' }, approveUsd: 3, env: { CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'owner-cfg') } });

  test('pack, worktree, install, login, scaffold, session, verify, scope — in that order', () => {
    assert.deepEqual(plan.steps.map((s) => s.step), ['pack', 'worktree', 'install', 'login', 'scaffold', 'session', 'verify', 'scope']);
    assert.equal(plan.branch, 'bot/dogfood/r1');
  });

  test('PAN is installed from the package into a scratch config dir, never into the source repository', () => {
    const install = plan.steps.find((s) => s.step === 'install');
    assert.ok(install.args.includes('--global'));
    const dir = install.args[install.args.indexOf('--config-dir') + 1];
    const rel = path.relative(ROOT, dir);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `config dir ${dir} must be outside the repository`);
    assert.notEqual(path.resolve(install.cwd), path.resolve(ROOT), 'the installer never runs in the source repository');
    assert.match(install.installer.replace(/\\/g, '/'), /\/package\/bin\/install\.js$/, 'the installer from the packed tarball');
  });

  test('the session runs PAN\'s quick task on the finding, with the scratch config and a spend ceiling', () => {
    const s = plan.steps.find((x) => x.step === 'session');
    assert.equal(s.env.CLAUDE_CONFIG_DIR, plan.configDir);
    assert.ok(s.args.includes('--max-budget-usd') && s.args.includes('3'));
    // On stdin, not as an argument: on Windows the shell split the prompt into words.
    assert.match(s.input, /^\/pan:quick --full .*quick-mode exits 1/);
    assert.ok(!s.args.some((a) => a.startsWith('/pan:')), 'the prompt is not an argument');
  });

  test('nothing in the lane publishes a branch', () => {
    const src = fs.readFileSync(path.join(ROOT, 'harness', 'autopilot', 'dogfood.cjs'), 'utf8');
    assert.doesNotMatch(src, /['"`]push['"`]|git push|gh pr create/);
  });
});

describe('S6: the run, with stand-in steps', () => {
  function runWith(over) {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-ws-'));
    dirs.push(ws);
    const ops = {
      pack: () => ({ ok: true, packageDir: path.join(ws, 'pkg') }),
      worktree: () => ({ ok: true }),
      install: () => ({ ok: true }),
      login: () => ({ ok: true }),
      logout: () => 'unchanged',
      scaffold: () => ({ ok: true }),
      session: () => { const d = path.join(ws, '.planning', 'quick', '1-fix'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '1-verification.md'), '---\nstatus: passed\n---\n'); return { ok: true, usd: 1.2 }; },
      changedFiles: () => ['pan-wizard-core/bin/lib/runner.cjs', 'tests/runner.test.cjs'],
      cleanup: () => {}, record: () => {},
      ...over,
    };
    return D.runDogfood({ repo: ROOT, root: ws, id: 'r1', worktree: ws, finding: { id: 'a1', summary: 'x' }, approveUsd: 3, ops, env: {}, state: ws });
  }

  test('the kill switch refuses the run before any step', () => {
    let ran = false;
    const r = D.runDogfood({ repo: ROOT, root: os.tmpdir(), id: 'r1', finding: { id: 'a1', summary: 'x' }, approveUsd: 3, env: { PAN_AUTOPILOT_KILL: '1' }, ops: { pack: () => { ran = true; return { ok: true }; } } });
    assert.equal(r.error, 'killed');
    assert.equal(ran, false);
  });

  test('a failed login refuses the run before the session, and the login is always released', () => {
    let session = false;
    let released = 0;
    const r = runWith({ login: () => ({ ok: false, reason: 'no login' }), logout: () => { released++; return 'none'; }, session: () => { session = true; return { ok: true }; } });
    assert.equal(r.reason, 'login_failed');
    assert.equal(session, false);
    assert.equal(released, 1);
  });

  test('a passing verification and a clean scope keep the branch for the owner', () => {
    const r = runWith({});
    assert.equal(r.outcome, 'kept', JSON.stringify(r));
    assert.equal(r.verification, 'passed');
    assert.equal(r.usd, 1.2);
  });

  test('a diff that touches an evaluator file is refused', () => {
    const r = runWith({ changedFiles: () => ['pan-wizard-core/bin/lib/runner.cjs', 'harness/scenarios/quick-mode.json'] });
    assert.equal(r.outcome, 'refused');
    assert.equal(r.reason, 'scope');
  });

  test('a session that fails is refused with its reason, not as an unverified run', () => {
    const r = runWith({ session: () => ({ ok: false, usd: 0, reason: 'error: unknown option' }) });
    assert.equal(r.outcome, 'refused');
    assert.equal(r.reason, 'session_failed');
    assert.equal(r.detail, 'error: unknown option');
  });

  test('no passing verification, no branch', () => {
    const r = runWith({ session: () => ({ ok: true, usd: 0.5 }) });
    assert.equal(r.outcome, 'refused');
    assert.equal(r.reason, 'no_passing_verification');
  });

  test('without the owner\'s approval nothing runs', () => {
    const r = D.runDogfood({ repo: ROOT, root: os.tmpdir(), id: 'r1', finding: { id: 'a1', summary: 'x' }, ops: {} });
    assert.equal(r.error, 'approval_required');
  });
});

describe('S6: the session uses the owner\'s login, never the owner\'s config', () => {
  const SECRET = 'sk-ant-oat01-STAND-IN-NOT-A-REAL-TOKEN';
  function owner() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-owner-'));
    dirs.push(d);
    fs.writeFileSync(path.join(d, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: 'r0' } }));
    return d;
  }

  test('the login step copies only the credentials file from the owner\'s config dir into the scratch config dir', () => {
    const o = owner();
    const plan = D.planDogfood({ repo: ROOT, root: path.join(os.tmpdir(), 'pan-dogfood-root'), id: 'r2', finding: { id: 'a1', summary: 'x' }, env: { CLAUDE_CONFIG_DIR: o } });
    const login = plan.steps.find((s) => s.step === 'login');
    assert.equal(login.mode, 'copy-credentials');
    assert.equal(login.from, path.join(o, '.credentials.json'));
    assert.equal(path.dirname(login.to), plan.configDir);
    const session = plan.steps.find((s) => s.step === 'session');
    assert.equal(session.env.CLAUDE_CONFIG_DIR, plan.configDir, 'PAN is read from the scratch config dir, not the owner\'s');
    assert.doesNotMatch(JSON.stringify(plan), new RegExp(SECRET), 'the plan names paths, never contents');
  });

  test('with ANTHROPIC_API_KEY set, nothing is copied', () => {
    const plan = D.planDogfood({ repo: ROOT, root: path.join(os.tmpdir(), 'pan-dogfood-root'), id: 'r3', finding: { id: 'a1', summary: 'x' }, env: { ANTHROPIC_API_KEY: 'stand-in' } });
    const login = plan.steps.find((s) => s.step === 'login');
    assert.equal(login.mode, 'api-key');
    assert.equal(login.from, undefined);
    assert.doesNotMatch(JSON.stringify(plan), /stand-in/);
  });

  test('an untouched copy is deleted and the owner\'s file is left as it was', () => {
    const o = owner();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-scratch-'));
    dirs.push(scratch);
    const before = fs.readFileSync(path.join(o, '.credentials.json'), 'utf8');
    const h = D.copyLogin(path.join(o, '.credentials.json'), path.join(scratch, 'claude-config', '.credentials.json'));
    assert.equal(h.ok, true);
    assert.equal(fs.readFileSync(h.to, 'utf8'), before);
    assert.equal(D.syncBack(h), 'unchanged');
    assert.equal(fs.existsSync(h.to), false, 'the scratch copy is deleted');
    assert.equal(fs.readFileSync(path.join(o, '.credentials.json'), 'utf8'), before);
    assert.doesNotMatch(JSON.stringify(h), new RegExp(SECRET), 'the handle carries digests, never contents');
  });

  test('a token the session refreshed goes back to the owner, unless the owner\'s file changed meanwhile', () => {
    const o = owner();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-scratch-'));
    dirs.push(scratch);
    const src = path.join(o, '.credentials.json');
    let h = D.copyLogin(src, path.join(scratch, 'a', '.credentials.json'));
    fs.writeFileSync(h.to, JSON.stringify({ claudeAiOauth: { accessToken: 'refreshed', refreshToken: 'r1' } }));
    assert.equal(D.syncBack(h), 'refreshed_synced');
    assert.match(fs.readFileSync(src, 'utf8'), /"r1"/);
    h = D.copyLogin(src, path.join(scratch, 'b', '.credentials.json'));
    fs.writeFileSync(h.to, JSON.stringify({ claudeAiOauth: { refreshToken: 'r2-session' } }));
    fs.writeFileSync(src, JSON.stringify({ claudeAiOauth: { refreshToken: 'r2-owner' } }));
    assert.equal(D.syncBack(h), 'diverged');
    assert.match(fs.readFileSync(src, 'utf8'), /r2-owner/, 'the owner\'s newer login is never overwritten');
    assert.equal(fs.existsSync(h.to), false);
  });

  test('no login on file refuses with a way to fix it', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-nologin-'));
    dirs.push(d);
    const h = D.copyLogin(path.join(d, '.credentials.json'), path.join(d, 'x', '.credentials.json'));
    assert.equal(h.ok, false);
    assert.match(h.reason, /\/login|ANTHROPIC_API_KEY/);
  });

  test('the run records the credentials status word, never the contents', () => {
    const o = owner();
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-ws-'));
    dirs.push(ws);
    const rows = [];
    const r = D.runDogfood({
      repo: ROOT, root: ws, id: 'r4', worktree: ws, finding: { id: 'a1', summary: 'x' }, approveUsd: 3, env: { CLAUDE_CONFIG_DIR: o }, state: ws,
      ops: { pack: () => ({ ok: true }), worktree: () => ({ ok: true }), install: () => ({ ok: true }), scaffold: () => ({ ok: true }), session: () => ({ ok: true, usd: 0.1 }), changedFiles: () => [], cleanup: () => {}, record: (row) => rows.push(row) },
    });
    assert.equal(r.credentials, 'unchanged', JSON.stringify(r));
    assert.equal(rows[0].credentials, 'unchanged');
    assert.doesNotMatch(JSON.stringify([r, rows]), new RegExp(SECRET));
    assert.equal(fs.existsSync(path.join(ws, 'autopilot', 'dogfood-r4-scratch', 'claude-config', '.credentials.json')), false, 'the scratch copy is gone');
  });

  test('the test directory: C:\\Project\\pantesting, then D:\\pantesting, then a private temp dir', () => {
    assert.equal(D.defaultRoot({}, (p) => p === 'C:\\Project\\pantesting' || p === 'D:\\pantesting', 'win32'), 'C:\\Project\\pantesting');
    assert.equal(D.defaultRoot({}, (p) => p === 'D:\\pantesting', 'win32'), 'D:\\pantesting');
    const t = D.defaultRoot({}, () => false, 'win32');
    dirs.push(t);
    assert.ok(path.basename(t).startsWith('pan-autopilot-') && fs.statSync(t).isDirectory(), t);
    assert.equal(D.defaultRoot({ PAN_AUTOPILOT_ROOT: 'X:\\r' }, () => true, 'win32'), 'X:\\r');
  });
});

describe('S6: picking the finding', () => {
  test('the oldest open harness finding first', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-f-'));
    dirs.push(d);
    fs.mkdirSync(path.join(d, 'harness'));
    fs.writeFileSync(path.join(d, 'harness', 'ledger.jsonl'), [
      { signature: 'new', scenario: 'b', detail: 'newer', first_seen: '2026-10-15T00:00:00Z' },
      { signature: 'old', scenario: 'a', detail: 'older', first_seen: '2026-10-01T00:00:00Z' },
      { signature: 'done', scenario: 'c', detail: 'fixed', first_seen: '2026-09-01T00:00:00Z', resolved_at: '2026-09-02T00:00:00Z' },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n');
    const f = D.pickFinding(d);
    assert.equal(f.id, 'old');
    assert.match(f.summary, /a.*older/);
    assert.equal(D.pickFinding(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-dogfood-e-'))), null);
  });
});
