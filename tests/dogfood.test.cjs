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
  const plan = D.planDogfood({ repo: ROOT, root: path.join(os.tmpdir(), 'pan-dogfood-root'), id: 'r1', finding: { id: 'a1', summary: 'quick-mode exits 1' }, approveUsd: 3 });

  test('pack, worktree, install, scaffold, session, verify, scope — in that order', () => {
    assert.deepEqual(plan.steps.map((s) => s.step), ['pack', 'worktree', 'install', 'scaffold', 'session', 'verify', 'scope']);
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
    assert.match(s.args[s.args.length - 1], /^\/pan:quick --full .*quick-mode exits 1/);
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
      scaffold: () => ({ ok: true }),
      session: () => { const d = path.join(ws, '.planning', 'quick', '1-fix'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '1-verification.md'), '---\nstatus: passed\n---\n'); return { ok: true, usd: 1.2 }; },
      changedFiles: () => ['pan-wizard-core/bin/lib/runner.cjs', 'tests/runner.test.cjs'],
      cleanup: () => {}, record: () => {},
      ...over,
    };
    return D.runDogfood({ repo: ROOT, root: ws, id: 'r1', worktree: ws, finding: { id: 'a1', summary: 'x' }, approveUsd: 3, ops });
  }

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
