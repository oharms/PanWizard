/**
 * Program A3: parallel isolation on every runtime.
 *
 * `phase-plan-index` partitions a wave's plans into sub-waves so no two plans in one
 * sub-wave touch the same file. `worktree preflight` shadow-merges branches onto the
 * base in a throwaway worktree and runs the oracle: two branches that pass alone but
 * break together are caught, and a conflict is named. `autodev run --worktrees` runs each
 * plan of a sub-wave in its own worktree and session, then merges the sub-wave back
 * behind the preflight. On Claude Code the native pan-exec-waves script can isolate each
 * executor with `agent({isolation: 'worktree'})` (`workflow.worktree_isolation`).
 */
'use strict';

const { describe, test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const P = require('../pan-wizard-core/bin/lib/phase.cjs');
const W = require('../pan-wizard-core/bin/lib/worktree.cjs');

const dirs = [];
afterEach(() => { while (dirs.length) { const d = dirs.pop(); try { execFileSync('git', ['worktree', 'prune'], { cwd: d, stdio: 'ignore' }); } catch {} fs.rmSync(d, { recursive: true, force: true }); } });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repo() {
  const d = tmp('pan-wt-');
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
  return d;
}
const commitAll = (d, m) => { git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', m); };

describe('A3: the overlap partitioner', () => {
  test('plans that share a file go to different sub-waves; the rest stay together', () => {
    const sub = P.partitionWave([
      { id: '01-01', files_modified: ['src/a.js'] },
      { id: '01-02', files_modified: ['src/a.js', 'src/b.js'] },
      { id: '01-03', files_modified: ['src/c.js'] },
      { id: '01-04', files_modified: ['src/b.js'] },
    ]);
    assert.deepEqual(sub, [['01-01', '01-03', '01-04'], ['01-02']]);
  });

  test('a plan that declares no files runs alone: its reach is unknown', () => {
    assert.deepEqual(P.partitionWave([{ id: 'a', files_modified: ['x'] }, { id: 'b', files_modified: [] }, { id: 'c', files_modified: ['y'] }]), [['a', 'c'], ['b']]);
  });

  test('phase-plan-index reports the sub-waves', () => {
    const d = tmp('pan-ppi-');
    const ph = path.join(d, '.planning', 'phases', '01-a');
    fs.mkdirSync(ph, { recursive: true });
    const plan = (id, files) => fs.writeFileSync(path.join(ph, `${id}-plan.md`), `---\nphase: 01\nplan: ${id.slice(3)}\nwave: 1\nfiles_modified: [${files.join(', ')}]\n---\n<objective>\nx\n</objective>\n`);
    plan('01-01', ['src/a.js']); plan('01-02', ['src/a.js']);
    const r = JSON.parse(execFileSync(process.execPath, [TOOLS, 'phase-plan-index', '1'], { cwd: d, encoding: 'utf8' }));
    assert.deepEqual(r.sub_waves, { 1: [['01-01'], ['01-02']] });
    assert.deepEqual(r.plans.map((p) => p.sub_wave), [0, 1]);
  });
});

describe('A3: the shadow-merge preflight', () => {
  function scenario() {
    const d = repo();
    fs.writeFileSync(path.join(d, 'a.js'), 'module.exports = { a: 1 };\n');
    fs.writeFileSync(path.join(d, 'check.js'), "const { a } = require('./a.js'); if (a !== 1) process.exit(1);\nfor (const f of ['c.js']) { try { require('./' + f); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }\n");
    commitAll(d, 'base');
    // A renames the export and updates its only user: passes alone.
    git(d, 'checkout', '-q', '-b', 'A');
    fs.writeFileSync(path.join(d, 'a.js'), 'module.exports = { alpha: 1 };\n');
    fs.writeFileSync(path.join(d, 'check.js'), "const { alpha } = require('./a.js'); if (alpha !== 1) process.exit(1);\nfor (const f of ['c.js']) { try { require('./' + f); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }\n");
    commitAll(d, 'A');
    // B adds a new user of the old name: passes alone.
    git(d, 'checkout', '-q', 'main');
    git(d, 'checkout', '-q', '-b', 'B');
    fs.writeFileSync(path.join(d, 'c.js'), "const { a } = require('./a.js'); if (a !== 1) throw new Error('a is gone');\n");
    commitAll(d, 'B');
    git(d, 'checkout', '-q', 'main');
    return d;
  }

  test('two branches that pass alone but break together are caught', () => {
    const d = scenario();
    const r = W.shadowMergePreflight(d, { base: 'main', branches: ['A', 'B'], test: 'node check.js' });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.verdict, 'break_together');
    assert.deepEqual(r.alone, { A: true, B: true });
    assert.deepEqual(r.merged, ['A', 'B']);
    assert.equal(git(d, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the checkout is untouched');
    assert.equal(git(d, 'status', '--porcelain'), '');
  });

  test('a clean pair passes, and a conflict is named', () => {
    const d = scenario();
    assert.equal(W.shadowMergePreflight(d, { base: 'main', branches: ['B'], test: 'node check.js' }).ok, true);
    git(d, 'checkout', '-q', '-b', 'C');
    fs.writeFileSync(path.join(d, 'a.js'), 'module.exports = { a: 1, c: 3 };\n');
    commitAll(d, 'C');
    git(d, 'checkout', '-q', 'main');
    const r = W.shadowMergePreflight(d, { base: 'main', branches: ['A', 'C'], test: 'node check.js' });
    assert.equal(r.verdict, 'conflict');
    assert.equal(r.conflict.branch, 'C');
    assert.ok(r.conflict.files.includes('a.js'));
  });

  test('the CLI: worktree preflight', () => {
    const d = scenario();
    const r = spawnSync(process.execPath, [TOOLS, 'worktree', 'preflight', '--base', 'main', '--branches', 'A,B', '--test', 'node check.js'], { cwd: d, encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).verdict, 'break_together');
  });
});

describe('A3: native worktree isolation on Claude Code', () => {
  test('pan-exec-waves runs sub-waves and isolates executors when the project asks', () => {
    const lib = require('../bin/install-lib.cjs');
    const scripts = lib.nativeWorkflowScripts ? lib.nativeWorkflowScripts() : null;
    const src = fs.readFileSync(path.join(ROOT, 'bin', 'install-lib.cjs'), 'utf8');
    const start = src.indexOf("name: 'pan-exec-waves'");
    const body = src.slice(start, src.indexOf("{ name: 'pan-exec-waves.js'", start));
    assert.match(body, /sub_wave/);
    assert.match(body, /isolation: 'worktree'/);
    assert.match(body, /worktree_isolation/);
    assert.ok(scripts === null || scripts, 'no-op');
  });

  test('init execute-phase reports workflow.worktree_isolation (off by default)', () => {
    const d = tmp('pan-iso-');
    fs.mkdirSync(path.join(d, '.planning', 'phases', '01-a'), { recursive: true });
    fs.writeFileSync(path.join(d, '.planning', 'roadmap.md'), '# R\n\n### Phase 1: A\n**Goal:** g\n');
    const r = JSON.parse(execFileSync(process.execPath, [TOOLS, 'init', 'execute-phase', '1'], { cwd: d, encoding: 'utf8' }));
    assert.equal(r.worktree_isolation, false);
  });

  test('exec-phase can run one plan: --plan', () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'commands', 'pan', 'exec-phase.md'), 'utf8'), /--plan <id>/);
    assert.match(fs.readFileSync(path.join(ROOT, 'pan-wizard-core', 'workflows', 'exec-phase.md'), 'utf8'), /--plan <id>/);
  });
});

describe('A3: autodev runs plans in worktrees', () => {
  let binDir;
  after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  before(() => {
    // Not through tmp(): afterEach must not delete the stand-in, or a later test reaches the real CLI.
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-wt-bin-'));
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `
const fs = require('fs'), path = require('path'), cp = require('child_process');
const prompt = process.argv[process.argv.length - 1];
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ cwd: process.cwd(), prompt }) + '\\n');
const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)(?: --plan (\\S+))?/);
const g = (...a) => cp.execFileSync('git', a, { cwd: process.cwd(), stdio: 'ignore' });
if (m) {
  const pad = '0' + m[2];
  const phases = path.join(process.cwd(), '.planning', 'phases');
  const dir = path.join(phases, fs.readdirSync(phases).find((d) => d.startsWith(pad + '-')));
  if (m[1] === 'exec' && m[3]) {
    fs.appendFileSync(path.join(process.cwd(), 'src', 'shared.js'), '// ' + m[3] + '\\n');
    fs.writeFileSync(path.join(dir, m[3] + '-summary.md'), '# done\\n');
    g('add', '-A'); g('commit', '-q', '-m', 'exec ' + m[3]);
  }
  if (m[1] === 'verify') { fs.writeFileSync(path.join(dir, pad + '-verification.md'), '---\\nstatus: passed\\n---\\n'); g('add', '-A'); g('commit', '-q', '-m', 'verify'); }
}
process.stdout.write(JSON.stringify({ result: 'ok', total_cost_usd: 0.1 }) + '\\n');
`);
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
  });

  test('two plans touching one file run one after the other, each in its own worktree, and merge back', () => {
    const d = repo();
    const p = path.join(d, '.planning');
    fs.mkdirSync(path.join(p, 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(d, 'src'));
    fs.writeFileSync(path.join(d, 'src', 'shared.js'), '// shared\n');
    fs.writeFileSync(path.join(p, 'project.md'), '# P\n');
    fs.writeFileSync(path.join(p, 'requirements.md'), '# R\n');
    fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: 'warn' } }));
    fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n- [ ] **Phase 1: A**\n\n### Phase 1: A\n**Goal:** g\n');
    for (const id of ['01-01', '01-02']) fs.writeFileSync(path.join(p, 'phases', '01-a', `${id}-plan.md`), `---\nphase: 01\nwave: 1\nfiles_modified: [src/shared.js]\n---\n<objective>\nx\n</objective>\n`);
    commitAll(d, 'planned');
    const log = path.join(os.tmpdir(), `pan-wt-log-${process.pid}-${Date.now()}.jsonl`);
    try {
      const r = spawnSync(process.execPath, [TOOLS, 'autodev', 'run', '--host', 'claude', '--max-usd', '10', '--worktrees'], { cwd: d, encoding: 'utf8', env: { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, FAKE_LOG: log } });
      const out = JSON.parse(r.stdout);
      assert.equal(out.stop.reason, 'done', r.stderr + r.stdout);
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const execs = calls.filter((c) => /exec-phase 1 --plan/.test(c.prompt));
      assert.deepEqual(execs.map((c) => c.prompt.match(/--plan (\S+)/)[1]), ['01-01', '01-02'], 'serialised: one sub-wave each');
      assert.ok(execs.every((c) => path.resolve(c.cwd) !== path.resolve(d)), 'each in a worktree');
      assert.notEqual(execs[0].cwd, execs[1].cwd);
      const shared = fs.readFileSync(path.join(d, 'src', 'shared.js'), 'utf8');
      assert.match(shared, /01-01/); assert.match(shared, /01-02/);
      assert.ok(fs.existsSync(path.join(p, 'phases', '01-a', '01-02-summary.md')), 'the summaries came back with the merge');
      assert.equal(git(d, 'worktree', 'list').split('\n').length, 1, 'the worktrees are removed');
    } finally { try { fs.rmSync(log); } catch {} }
  });
});
