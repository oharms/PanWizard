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
const { parseArgs, planGates, which, findCodeql, judgeSarif, lastSignal, verdictFile } = require(SCRIPT);

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
    assert.equal(parseArgs(['--codescan']).codescan, 'auto', 'CodeQL when installed, else Semgrep');
    assert.equal(parseArgs(['--codescan-all']).codescan, 'auto');
    assert.equal(parseArgs(['--out', 'x']).out, path.resolve('x'));
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

  test('CodeQL is found on PATH or where the bundle is unpacked, and preferred by --codescan', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lci-cq-'));
    const env = { ...process.env, PATH: empty, Path: empty, USERPROFILE: empty, HOME: empty };
    assert.equal(findCodeql(env), null);
    assert.equal(planGates(parseArgs(['--codescan', '--only', 'codescan', '--root', ROOT]), env)[0].title.startsWith('semgrep'), true, 'no CodeQL: Semgrep');
    const exe = path.join(empty, '.codeql-cli', 'codeql', process.platform === 'win32' ? 'codeql.exe' : 'codeql');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    assert.equal(findCodeql(env), exe);
    const g = planGates(parseArgs(['--codescan', '--only', 'codescan', '--root', ROOT]), env)[0];
    assert.match(g.title, /CodeQL/);
    assert.equal(g.cmd, exe);
    assert.ok(g.then.args.some(a => /security-extended/.test(a)));
    fs.rmSync(empty, { recursive: true, force: true });
  });

  test('a CodeQL result blocks at error level or security severity high+, as GitHub\'s check does', () => {
    const doc = (results) => ({ runs: [{ tool: { driver: { rules: [{ id: 'js/high', properties: { 'security-severity': '7.5' } }, { id: 'js/low', properties: { 'security-severity': '3.1' } }, { id: 'js/note' }] } }, results }] });
    assert.equal(judgeSarif(doc([])).status, 'pass');
    assert.equal(judgeSarif(doc([{ ruleId: 'js/low', level: 'warning' }, { ruleId: 'js/note', level: 'note' }])).status, 'pass');
    const high = judgeSarif(doc([{ ruleId: 'js/high', level: 'warning' }]));
    assert.equal(high.status, 'fail');
    assert.match(high.detail, /js\/high/);
    assert.equal(judgeSarif(doc([{ ruleId: 'js/note', level: 'error' }])).status, 'fail');
  });

  test('a finding accepted on review (rule and file) does not block; a new one in the same file does; a dead acceptance is stale', () => {
    const at = (ruleId, uri, line) => ({ ruleId, level: 'warning', locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }] });
    const doc = { runs: [{ tool: { driver: { rules: [{ id: 'js/high', properties: { 'security-severity': '7.5' } }, { id: 'js/other', properties: { 'security-severity': '8.0' } }] } }, results: [at('js/high', 'bin/a.js', 10)] }] };
    const accepted = [{ rule: 'js/high', path: 'bin/a.js', reason: 'reviewed' }, { rule: 'js/gone', path: 'bin/b.js', reason: 'fixed since' }];
    const v = judgeSarif(doc, accepted);
    assert.equal(v.status, 'pass');
    assert.match(v.detail, /0 blocking.*1 accepted.*1 stale/);
    doc.runs[0].results.push(at('js/other', 'bin/a.js', 3));
    const red = judgeSarif(doc, accepted);
    assert.equal(red.status, 'fail');
    assert.deepEqual(red.blocking, [{ rule: 'js/other', path: 'bin/a.js', line: 3 }]);
  });

  test('every committed CodeQL acceptance names a rule, a file that exists, and a reason', () => {
    const { accepted } = JSON.parse(fs.readFileSync(path.join(ROOT, '.codeql-accepted.json'), 'utf8'));
    assert.ok(accepted.length > 0);
    for (const a of accepted) {
      assert.match(a.rule, /^js\//);
      assert.ok(fs.existsSync(path.join(ROOT, a.path)), `${a.path} does not exist`);
      assert.ok(String(a.reason).length > 20, `${a.rule} ${a.path} needs a reason`);
    }
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

  test('PAN_TEST_CONCURRENCY=1 makes run-tests run one file at a time (Node 20.10+)', (t) => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (!(major > 20 || (major === 20 && minor >= 10))) { t.skip('--test-concurrency needs Node 20.10+'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lci-conc-'));
    const trace = path.join(dir, 'trace.txt');
    for (const n of ['a', 'b']) {
      fs.writeFileSync(path.join(dir, `${n}.test.cjs`), `const fs = require('fs');
require('node:test')('${n}', async () => {
  fs.appendFileSync(${JSON.stringify(trace)}, 'start ${n}\\n');
  await new Promise((r) => setTimeout(r, 400));
  fs.appendFileSync(${JSON.stringify(trace)}, 'end ${n}\\n');
});\n`);
    }
    const env = { ...process.env, PAN_TEST_CONCURRENCY: '1' };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.cjs'), dir], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const lines = fs.readFileSync(trace, 'utf8').trim().split('\n');
    assert.deepEqual(lines.map(l => l.split(' ')[0]), ['start', 'end', 'start', 'end'], `files overlapped: ${lines.join(', ')}`);
    fs.rmSync(dir, { recursive: true, force: true });
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

  test('--out puts the report elsewhere; only a full run records a verdict for land', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lci-out-'));
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const file = verdictFile(repo, head);
    fs.rmSync(file, { force: true });
    const partial = localCi(repo, ['--only', 'clean-tree', '--out', out]);
    assert.equal(partial.status, 0, partial.out);
    assert.ok(fs.existsSync(path.join(out, 'report.json')));
    assert.equal(fs.existsSync(file), false, 'an --only run is not a verdict on the commit');

    const full = localCi(repo, []);
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(v.headFull, head);
    assert.equal(v.status, full.status === 0 ? 'pass' : 'fail');
    assert.equal(typeof v.dirtyAtStart, 'boolean');
    fs.rmSync(out, { recursive: true, force: true });
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
    const body = Array.from({ length: 36 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
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
