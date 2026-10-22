// scripts/local-ci.cjs — the local replacement for the GitHub CI gates. Each gate is proved
// red on a seeded breakage before it is trusted green: a failing test, a planted token in
// the history, a stale surface registry, a gate that writes into the tree. A tool that is
// not installed must come back SKIP, never PASS.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'local-ci.cjs');
const { parseArgs, planGates, which, lastSignal } = require(SCRIPT);

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function localCi(root, args, env = process.env) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--no-docker', ...args], { encoding: 'utf8', env, timeout: 300000 });
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(root, '.ci-local', 'report.json'), 'utf8')); } catch { /* asserted by the caller */ }
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), report };
}

const gate = (report, id) => report.gates.find(g => g.id === id);

function mkRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.ci-local/\n');
  return dir;
}

describe('local-ci: options and planning', () => {
  test('parses the flags it documents and rejects the rest', () => {
    const o = parseArgs(['--fast', '--only', 'host,gitleaks', '--codescan=codeql', '--jobs', '3', '--strict', '--no-docker']);
    assert.equal(o.fast, true);
    assert.deepEqual(o.only, ['host', 'gitleaks']);
    assert.equal(o.codescan, 'codeql');
    assert.equal(o.jobs, 3);
    assert.equal(o.strict, true);
    assert.equal(o.docker, false);
    assert.equal(parseArgs(['--codescan']).codescan, 'semgrep');
    assert.throws(() => parseArgs(['--codescan=sonar']), /semgrep or codeql/);
    assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  });

  test('every CI gate is planned, and codescan only behind its flag', () => {
    const ids = planGates(parseArgs(['--no-docker', '--root', ROOT])).map(g => g.id);
    for (const id of ['harness', 'gitleaks', 'audit', 'links', 'surface', 'coverage', 'linux-node18', 'linux-node20', 'linux-node22']) {
      assert.ok(ids.includes(id), `${id} missing from ${ids.join(', ')}`);
    }
    for (const v of ['18', '20', '22']) assert.ok(ids.includes(`host-node${v}`), `host-node${v} missing — a version fnm lacks must still be listed, as skipped`);
    assert.ok(!ids.includes('codescan'));
    assert.ok(planGates(parseArgs(['--no-docker', '--codescan=codeql', '--root', ROOT])).some(g => g.id === 'codescan'));
  });

  test('--fast is the pre-push subset: the current Node suite, the harness and gitleaks', () => {
    const cur = process.versions.node.split('.')[0];
    assert.deepEqual(planGates(parseArgs(['--fast', '--root', ROOT])).map(g => g.id), [`host-node${cur}`, 'harness', 'gitleaks']);
  });

  test('a tool missing from PATH is planned as a skip with an install hint', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lci-path-'));
    const env = { ...process.env, PATH: empty, Path: empty };
    assert.equal(which('gitleaks', env), null);
    assert.equal(which('docker', env), null);
    const gates = planGates(parseArgs(['--root', ROOT]), env);
    assert.match(gates.find(g => g.id === 'gitleaks').skip, /not installed.*winget install gitleaks/);
    assert.match(gates.find(g => g.id === 'linux-node22').skip, /Docker not installed/);
    const skipped = gates.filter(g => g.id.startsWith('host-node') && g.skip);
    assert.ok(skipped.length >= 2, 'without fnm, the Node versions other than the current one are skipped');
    for (const g of skipped) assert.match(g.skip, /fnm/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  test('lastSignal picks the failing line out of a log', () => {
    assert.equal(lastSignal('ok 1 - a\nnot ok 2 - b\n# tests 2\n'), 'not ok 2 - b');
    assert.equal(lastSignal('done\n'), 'done');
  });
});

describe('local-ci: the suite gate', () => {
  let repo;
  before(() => {
    repo = mkRepo('pan-lci-suite-');
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.copyFileSync(path.join(ROOT, 'scripts', 'run-tests.cjs'), path.join(repo, 'scripts', 'run-tests.cjs'));
    fs.mkdirSync(path.join(repo, 'tests', 'scenarios'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'scenarios', 'ok.test.cjs'), "require('node:test')('ok', () => {});\n");
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'fixture');
  });
  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  test('a failing test turns it red, and fixing it turns it green', () => {
    const failing = path.join(repo, 'tests', 'seeded.test.cjs');
    fs.writeFileSync(failing, "const assert = require('node:assert');\nrequire('node:test')('seeded', () => assert.equal(1, 2));\n");
    const red = localCi(repo, ['--only', 'host']);
    assert.equal(red.status, 1, red.out);
    assert.equal(red.report.status, 'fail');
    const ran = red.report.gates.filter(g => g.id.startsWith('host-') && g.status !== 'skip');
    assert.ok(ran.length >= 1, `no host suite ran: ${red.out}`);
    for (const g of ran) assert.equal(g.status, 'fail', `${g.id} passed a failing test`);
    assert.match(red.out, /FAILED/);

    fs.writeFileSync(failing, "const assert = require('node:assert');\nrequire('node:test')('seeded', () => assert.equal(2, 2));\n");
    const green = localCi(repo, ['--only', 'host']);
    assert.equal(green.status, 0, green.out);
    for (const g of green.report.gates.filter(x => x.id.startsWith('host-') && x.status !== 'skip')) assert.equal(g.status, 'pass');
  });

  test('a second run on the same checkout is refused while the first is alive; a stale lock is taken over', () => {
    const lock = path.join(repo, '.ci-local', 'run.lock');
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, String(process.pid));
    const refused = localCi(repo, ['--only', 'clean-tree']);
    assert.equal(refused.status, 2, refused.out);
    assert.match(refused.out, /another run/);
    fs.writeFileSync(lock, '999999999');
    const ok = localCi(repo, ['--only', 'clean-tree']);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(fs.existsSync(lock), false, 'the lock is released when the run ends');
  });

  test('a skipped gate is reported SKIP, and --strict makes it fail the run', () => {
    const r = localCi(repo, ['--only', 'linux']);
    assert.equal(r.status, 0, r.out);
    for (const id of ['linux-node18', 'linux-node20', 'linux-node22']) assert.equal(gate(r.report, id).status, 'skip');
    assert.equal(r.report.counts.pass, 0, 'nothing ran, so nothing may count as passed');
    assert.match(r.out, /SKIP {2}linux-node22/);
    assert.equal(localCi(repo, ['--only', 'linux', '--strict']).status, 1);
  });

  test('clean-tree fails when a gate writes into the checkout, and tolerates edits made before the run', () => {
    fs.writeFileSync(path.join(repo, 'tests', 'scenarios', 'writes.test.cjs'),
      "require('node:test')('w', () => require('fs').writeFileSync(require('path').join(__dirname, '..', '..', 'leaked.txt'), 'x'));\n");
    const red = localCi(repo, ['--only', 'host,clean-tree']);
    assert.equal(red.status, 1, red.out);
    assert.equal(gate(red.report, 'clean-tree').status, 'fail');
    assert.match(gate(red.report, 'clean-tree').detail, /leaked\.txt/);

    fs.rmSync(path.join(repo, 'tests', 'scenarios', 'writes.test.cjs'));
    fs.rmSync(path.join(repo, 'leaked.txt'));
    const green = localCi(repo, ['--only', 'clean-tree']);
    assert.equal(green.status, 0, green.out);
    assert.equal(gate(green.report, 'clean-tree').status, 'pass');
  });
});

describe('local-ci: gitleaks', () => {
  const gitleaks = which('gitleaks');

  test('without gitleaks on PATH the gate is skipped, not passed', () => {
    const repo = mkRepo('pan-lci-noleaks-');
    const env = { ...process.env, PATH: path.dirname(which('git')), Path: path.dirname(which('git')) };
    const r = localCi(repo, ['--only', 'gitleaks'], env);
    assert.equal(r.status, 0, r.out);
    assert.equal(gate(r.report, 'gitleaks').status, 'skip');
    assert.match(gate(r.report, 'gitleaks').detail, /not installed/);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('a token planted in the history turns it red; a clean history is green', { skip: !gitleaks && 'gitleaks not installed (winget install gitleaks.gitleaks)' }, () => {
    const repo = mkRepo('pan-lci-leaks-');
    fs.writeFileSync(path.join(repo, 'README.md'), '# clean\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'clean');
    const green = localCi(repo, ['--only', 'gitleaks']);
    assert.equal(green.status, 0, green.out);
    assert.equal(gate(green.report, 'gitleaks').status, 'pass');

    // Assembled at run time so this file never holds a token-shaped string itself.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const body = [...crypto.randomBytes(36)].map(b => alphabet[b % alphabet.length]).join('');
    fs.writeFileSync(path.join(repo, 'config.js'), `module.exports = { token: '${'gh' + 'p_'}${body}' };\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'leak');
    const red = localCi(repo, ['--only', 'gitleaks']);
    assert.equal(red.status, 1, red.out);
    assert.equal(gate(red.report, 'gitleaks').status, 'fail');
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe('local-ci: surface registry', () => {
  let copy;
  before(() => {
    // A copy of this checkout's files (tracked and new), so the registry can be broken
    // without touching the real one.
    copy = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lci-surface-'));
    const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\0').filter(Boolean);
    for (const f of files) {
      const src = path.join(ROOT, f);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
      fs.copyFileSync(src, path.join(copy, f));
    }
  });
  after(() => fs.rmSync(copy, { recursive: true, force: true }));

  test('a stale registry turns it red; the committed one is green', () => {
    const reg = path.join(copy, 'tests', 'fixtures', 'surface.json');
    const original = fs.readFileSync(reg, 'utf8');
    const stale = JSON.parse(original);
    stale.content['commands/pan'].pop();
    fs.writeFileSync(reg, JSON.stringify(stale, null, 2) + '\n');
    const red = localCi(copy, ['--only', 'surface']);
    assert.equal(red.status, 1, red.out);
    assert.equal(gate(red.report, 'surface').status, 'fail');

    fs.writeFileSync(reg, original);
    const green = localCi(copy, ['--only', 'surface']);
    assert.equal(green.status, 0, green.out);
    assert.equal(gate(green.report, 'surface').status, 'pass');
  });
});
