/**
 * verify scope — the mechanical half of the unrequested-work check (M11, EL-6).
 *
 * A candidate is a file the phase changed that none of its plans declared. The cases
 * pin where "changed" comes from (the phase's own plan commits, by the executor's
 * subject convention, plus summary key-files), what is never a candidate (the
 * planning tree, lockfiles, PAN's runtime directories), and the one hint that saves
 * the verifier a judgement (a test for a declared file).
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scopePhase } = require('../pan-wizard-core/bin/lib/verify.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

let dir;
const PHASE = path.join('.planning', 'phases', '03-auth');

function write(rel, content = 'x\n') {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function plan(id, files) {
  write(path.join(PHASE, `03-${id}-plan.md`), `---\nphase: 03-auth\nplan: ${id}\nfiles_modified: [${files.join(', ')}]\n---\n# plan\n`);
}
function summary(id, created, modified) {
  write(path.join(PHASE, `03-${id}-summary.md`), `---\nphase: 03-auth\nkey-files:\n  created: [${created.join(', ')}]\n  modified: [${modified.join(', ')}]\n---\n# summary\n`);
}
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf-8' });
function commit(subject, files) {
  for (const f of files) write(f, `${subject}\n${f}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', subject);
}

beforeEach(() => {
  dir = fs.realpathSync(createTempProject());
  fs.mkdirSync(path.join(dir, PHASE), { recursive: true });
});
afterEach(() => cleanup(dir));

describe('verify scope — without git, from summaries', () => {
  test('an undeclared summary key-file is a candidate; declared and planning files are not', () => {
    plan('01', ['src/login.ts']);
    summary('01', ['src/admin.ts'], ['src/login.ts', '.planning/state.md']);
    const r = scopePhase(dir, '3');
    assert.equal(r.git, false);
    assert.deepEqual(r.declared, ['src/login.ts']);
    assert.deepEqual(r.candidates, [{ path: 'src/admin.ts', hint: null, sources: ['summary'] }]);
    assert.deepEqual(r.excluded, [{ path: '.planning/state.md', reason: 'planning tree' }]);
  });

  test('a declared directory (trailing slash) covers the files under it', () => {
    plan('01', ['src/lib/']);
    summary('01', ['src/lib/a.ts', 'src/lib/deep/b.ts'], []);
    assert.deepEqual(scopePhase(dir, '03').candidates, []);
  });

  test('an unknown phase is an error', () => {
    assert.equal(scopePhase(dir, '9').error, 'phase_not_found');
  });
});

describe('verify scope — from the phase\'s plan commits', () => {
  beforeEach(() => {
    git('init', '-q');
    git('config', 'user.email', 'scope@test.invalid');
    git('config', 'user.name', 'scope test');
    git('config', 'commit.gpgsign', 'false');
    plan('01', ['src/login.ts', 'src/session.ts']);
    commit('chore: seed', ['README.md']);
  });

  test('only this phase\'s plan commits count, with or without zero padding', () => {
    commit('feat(03-01): add login', ['src/login.ts', 'src/admin.ts']);
    commit('fix(3-02)!: tighten session', ['src/session.ts', 'src/cache.ts']);
    commit('feat(04-01): add billing', ['src/billing.ts']);
    commit('feat(13-01): unrelated phase 13', ['src/thirteen.ts']);
    const r = scopePhase(dir, '03');
    assert.equal(r.git, true);
    assert.equal(r.commits, 2);
    assert.deepEqual(r.candidates.map((c) => c.path), ['src/admin.ts', 'src/cache.ts']);
    assert.deepEqual(r.candidates[0].sources, ['commit']);
    assert.ok(!r.changed.includes('src/billing.ts'), 'another phase\'s commit is not this phase\'s change');
    assert.ok(!r.changed.includes('src/thirteen.ts'), 'phase 13 is not phase 3');
  });

  test('lockfiles, the planning tree and PAN runtime directories are excluded with a reason', () => {
    commit('feat(03-01): add login', ['src/login.ts', 'package-lock.json', '.claude/settings.json', '.github/copilot-instructions.md']);
    commit('docs(03-01): complete login plan', ['.planning/phases/03-auth/03-01-summary.md']);
    const r = scopePhase(dir, '3');
    assert.deepEqual(r.candidates, []);
    const reasons = Object.fromEntries(r.excluded.map((e) => [e.path, e.reason]));
    assert.deepEqual(reasons, {
      '.claude/settings.json': 'PAN runtime directory',
      '.github/copilot-instructions.md': 'PAN runtime directory',
      '.planning/phases/03-auth/03-01-summary.md': 'planning tree',
      'package-lock.json': 'lockfile',
    });
  });

  test('a test for a declared file is marked test_for_declared; an unrelated test is not', () => {
    commit('test(03-01): add failing login test', ['tests/login.test.ts', 'tests/admin.test.ts']);
    const r = scopePhase(dir, '03');
    assert.deepEqual(r.candidates.map((c) => [c.path, c.hint]), [['tests/admin.test.ts', null], ['tests/login.test.ts', 'test_for_declared']]);
  });

  test('a file both committed and reported in a summary lists both sources', () => {
    commit('feat(03-01): add login', ['src/admin.ts']);
    summary('01', ['src/admin.ts'], []);
    assert.deepEqual(scopePhase(dir, '03').candidates, [{ path: 'src/admin.ts', hint: null, sources: ['commit', 'summary'] }]);
  });
});

describe('verify scope — CLI', () => {
  test('verify scope prints the scope as JSON and the candidate count with --raw', () => {
    plan('01', ['src/login.ts']);
    summary('01', ['src/admin.ts', 'src/extra.ts'], []);
    const json = JSON.parse(runPanTools('verify scope 3', dir).output);
    assert.deepEqual(json.candidates.map((c) => c.path), ['src/admin.ts', 'src/extra.ts']);
    assert.equal(runPanTools('verify scope 3 --raw', dir).output, '2');
  });

  test('verify scope without a phase, or with an unknown one, exits 1 with an error body', () => {
    for (const args of ['verify scope', 'verify scope 9']) {
      const r = runPanTools(args, dir);
      assert.equal(r.success, false, args);
      assert.ok(JSON.parse(r.output).error, args);
    }
  });
});

// ─── Stale verification (market-ideas M27) ──────────────────────────────────
// A verification describes the code at one commit. The verifier records it as
// `verified_commit`; a covered file changed since then, committed or not, makes the
// verification stale, and `progress` says so.

describe('verify stale — a verification tied to the commit it checked (M27)', () => {
  const { verificationFreshness } = require('../pan-wizard-core/bin/lib/verify.cjs');
  let verified;

  function verify(fields = {}) {
    const fm = { phase: '03-auth', verified_commit: verified, status: 'passed', test_gate: 'passed', ...fields };
    const lines = Object.entries(fm).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
    write(path.join(PHASE, '03-verification.md'), `---\n${lines.join('\n')}\n---\n# verification\n`);
  }

  beforeEach(() => {
    git('init', '-q');
    git('config', 'user.email', 'stale@test.invalid');
    git('config', 'user.name', 'stale test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');
    plan('01', ['src/login.ts']);
    summary('01', ['src/session.ts'], []);
    commit('feat(03-01): add login', ['src/login.ts', 'src/session.ts', 'src/unrelated.ts']);
    verified = git('rev-parse', 'HEAD').trim();
    verify();
    commit('docs(03): verification', []);
  });

  test('fresh until a covered file changes; an unrelated file or the planning tree does not count', () => {
    assert.equal(verificationFreshness(dir, '3').state, 'fresh');
    commit('chore: elsewhere', ['src/unrelated.ts', '.planning/state.md']);
    assert.equal(verificationFreshness(dir, '3').state, 'fresh');
  });

  test('a committed change to a declared file or a summary key-file makes it stale, and names the files', () => {
    commit('fix: tweak login', ['src/login.ts']);
    write('src/session.ts', 'edited, not committed\n');
    const r = verificationFreshness(dir, '03');
    assert.equal(r.state, 'stale');
    assert.equal(r.verified_commit, verified);
    assert.deepEqual(r.changed_since, ['src/login.ts', 'src/session.ts']);
  });

  test('without a usable verified_commit the state is unknown, with the reason; without a verification, unverified', () => {
    verify({ verified_commit: null });
    assert.match(verificationFreshness(dir, '3').reason, /no verified_commit/);
    verify({ verified_commit: 'deadbeefdeadbeef' });
    const gone = verificationFreshness(dir, '3');
    assert.equal(gone.state, 'unknown');
    assert.match(gone.reason, /not in this repository/);
    fs.rmSync(path.join(dir, PHASE, '03-verification.md'));
    assert.equal(verificationFreshness(dir, '3').state, 'unverified');
  });

  test('the CLI and progress report it', () => {
    commit('fix: tweak login', ['src/login.ts']);
    const raw = runPanTools('verify stale 3 --raw', dir);
    assert.ok(raw.success, raw.error);
    assert.equal(raw.output, 'stale');
    const progress = JSON.parse(runPanTools('progress json', dir).output);
    const p = progress.phases.find((x) => x.number === '03');
    assert.equal(p.verification, 'stale');
    assert.deepEqual(p.changed_since_verification, ['src/login.ts']);
    assert.match(runPanTools('progress table --raw', dir).output, /\| 03 \| auth \| 1\/1 \| Complete \(verification stale\) \|/);
    assert.equal(runPanTools('verify stale', dir).success, false, 'a missing phase argument is an error');
  });
});
