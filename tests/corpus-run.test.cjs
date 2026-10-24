'use strict';

/**
 * Corpus judge driver (program H4: harness/scripts/corpus-run.cjs), tier 0.
 *
 * The driver produces the live judge rows catch-rate.cjs scores. Here every `claude` it
 * starts is a stand-in (PAN_STANDIN_DIR, and that directory leads PATH), and PAN comes from
 * a stand-in extracted package whose installer writes the judge agents and a pan-tools shim,
 * so nothing packs, nothing reaches a model and nothing is spent. The stand-in answers like
 * a judge: a verifier writes verification.md (gaps_found on the defective twin, passed on the
 * clean one, passed always when its installed prompt is the weakened variant); a reviewer
 * replies with a pan-verdict block.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'harness', 'scripts', 'corpus-run.cjs');
const { loadCorpus } = require('../harness/src/corpus.cjs');
const { readRows, scoreboard } = require('../harness/scripts/catch-rate.cjs');
const CR = require('../harness/scripts/corpus-run.cjs');

const ENTRY = 'stub-slugify';
const WEAK = 'harness/variants/pan-verifier-weakened.md';

let tmp; let binDir; let pkgDir; let logFile;

const STANDIN = `
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
let prompt = '';
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', () => {
  const cwd = process.cwd();
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ cwd, argv: process.argv.slice(2), prompt }) + '\\n');
  const defect = /-defect$/.test(path.basename(cwd));
  const changed = execFileSync('git', ['diff', 'HEAD~1', '--name-only'], { cwd, encoding: 'utf8' }).split(/\\r?\\n/).filter((f) => f.startsWith('src/'));
  const where = changed[0] || 'src';
  let result;
  if (prompt.includes('subagent_type \\u0060pan-verifier\\u0060')) {
    const body = fs.readFileSync(path.join(cwd, '.claude', 'agents', 'pan-verifier.md'), 'utf8');
    const weak = body.includes("Trust the executor's summary");
    const status = defect && !weak ? 'gaps_found' : 'passed';
    const gaps = status === 'gaps_found' ? 'gaps:\\n  - truth: "the task is done"\\n    status: failed\\n    reason: "stub"\\n    artifacts:\\n      - path: "' + where + '"\\n' : '';
    fs.writeFileSync(path.join(cwd, '.planning', 'phases', '01-corpus', '01-verification.md'), '---\\nphase: 01-corpus\\nstatus: ' + status + '\\ntest_gate: passed\\n' + gaps + '---\\n\\n# Verification\\n');
    result = 'Verification written.';
  } else {
    const v = defect
      ? { contract: '1.0', agent: 'pan-reviewer', verdict: 'NEEDS_FIXES', outcome: 'fail', findings: [{ class: 'defect', severity: 'high', where, summary: 'the function is a stub' }] }
      : { contract: '1.0', agent: 'pan-reviewer', verdict: 'PASS', outcome: 'pass', findings: [] };
    result = 'Review complete.\\n\\n\\u0060\\u0060\\u0060pan-verdict\\n' + JSON.stringify(v) + '\\n\\u0060\\u0060\\u0060\\n';
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: Number(process.env.FAKE_COST || '0.25'), duration_ms: 1500, num_turns: 3, session_id: 's' }));
});
`;

const INSTALLER = (repo) => `
const fs = require('fs'); const path = require('path');
const cwd = process.cwd();
const agents = path.join(cwd, '.claude', 'agents');
fs.mkdirSync(agents, { recursive: true });
for (const a of ['pan-verifier', 'pan-reviewer', 'pan-plan-checker', 'pan-meta-reviewer', 'pan-hardener']) fs.writeFileSync(path.join(agents, a + '.md'), '---\\nname: ' + a + '\\n---\\nstock prompt\\n');
const bin = path.join(cwd, '.claude', 'pan-wizard-core', 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'pan-tools.cjs'), "const r = require('child_process').spawnSync(process.execPath, [" + JSON.stringify(path.join(${JSON.stringify(repo)}, 'pan-wizard-core', 'bin', 'pan-tools.cjs')) + ", ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status == null ? 1 : r.status);\\n");
`;

function run(args, extraEnv = {}) {
  const env = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, FAKE_LOG: logFile, ...extraEnv };
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 240000 });
}
const sessions = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const fresh = (name) => { fs.rmSync(logFile, { force: true }); return { state: path.join(tmp, `state-${name}`), out: path.join(tmp, `${name}.jsonl`) }; };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-corpus-run-'));
  binDir = path.join(tmp, 'bin');
  pkgDir = path.join(tmp, 'package');
  logFile = path.join(tmp, 'sessions.jsonl');
  fs.mkdirSync(binDir);
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'bin', 'install.js'), INSTALLER(ROOT));
  const js = path.join(binDir, 'claude-stand-in.js');
  fs.writeFileSync(js, STANDIN);
  if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
  else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
});
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('corpus-run arguments and plan', () => {
  test('a live run without --max-usd is refused, before anything starts', () => {
    const { state } = fresh('refused');
    const r = run(['--judge', 'verifier', '--entry', ENTRY, '--package', pkgDir, '--state-dir', state]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /needs --max-usd/);
    assert.equal(sessions().length, 0);
    assert.equal(fs.existsSync(state), false);
  });

  test('--dry-run prints entries × twins × lenses and spends nothing', () => {
    const { state } = fresh('dry');
    const r = run(['--judge', 'reviewer', '--lenses', '3', '--limit', '2', '--dry-run', '--max-usd', '10', '--session-usd', '1.5', '--package', pkgDir, '--state-dir', state]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.dry_run, true);
    assert.equal(plan.entries.length, 2);
    assert.equal(plan.twins, 4);
    assert.equal(plan.sessions, 12);
    assert.equal(plan.ceiling_usd, 18);
    assert.equal(plan.twins_within_cap, 2);
    assert.equal(sessions().length, 0, 'no CLI started');
    assert.equal(fs.existsSync(state), false, 'no state written');
  });

  test('--lenses is the reviewer\'s only; --variant outside harness/variants/ is refused', () => {
    assert.throws(() => CR.parseArgs(['--judge', 'verifier', '--lenses', '3', '--dry-run']), /reviewer only/);
    assert.throws(() => CR.parseArgs(['--judge', 'nope', '--dry-run']), /--judge must be one of/);
    assert.throws(() => CR.parseArgs(['--judge', 'verifier', '--max-usd', '5', '--package', ROOT]), /never the source tree/);
    const { state } = fresh('badvariant');
    const r = run(['--judge', 'verifier', '--entry', ENTRY, '--max-usd', '5', '--package', pkgDir, '--state-dir', state, '--variant', '.claude/agents/pan-verifier.md=agents/pan-verifier.md']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not under harness\/variants/);
    assert.equal(sessions().length, 0);
  });
});

describe('corpus-run against a stand-in claude', () => {
  test('rows have catch-rate\'s shape, catch-rate scores them, and workspaces are deleted', () => {
    const { state, out } = fresh('reviewer');
    const r = run(['--judge', 'reviewer', '--entry', ENTRY, '--max-usd', '5', '--session-usd', '1', '--package', pkgDir, '--state-dir', state, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const rows = readRows([out]);
    assert.deepEqual(rows.map((x) => x.twin), ['clean', 'defect']);
    for (const row of rows) {
      for (const k of ['corpus', 'twin', 'judge', 'host', 'profile', 'report']) assert.equal(typeof row[k], 'string', k);
      assert.equal(row.corpus, ENTRY);
      assert.equal(row.judge, 'pan-reviewer');
      assert.equal(row.host, 'claude');
      assert.equal(row.profile, 'balanced');
      assert.equal(row.cost_usd, 0.25);
      assert.equal(row.duration_ms, 1500);
    }
    const [board] = scoreboard(rows, loadCorpus());
    assert.equal(board.key, 'pan-reviewer × claude × balanced');
    assert.deepEqual([board.catch.caught, board.catch.n, board.falseAlarm.flagged, board.falseAlarm.n, board.unreadable.length], [1, 1, 0, 1, 0]);
    assert.equal(board.located.located, 1, 'the finding names the truth file');
    const log = sessions();
    assert.equal(log.length, 2);
    assert.ok(log[0].argv.includes('--max-budget-usd'), 'each session carries its own budget');
    assert.equal(log[0].argv[log[0].argv.indexOf('--max-budget-usd') + 1], '1');
    assert.match(log[1].prompt, /Implement slugify/);
    for (const s of log) assert.equal(fs.existsSync(s.cwd), false, `workspace ${s.cwd} was deleted`);
    assert.equal(fs.readdirSync(state).length, 0, 'nothing left under the state dir');
  });

  test('the cap stops the run before a session could overrun it', () => {
    const { state, out } = fresh('cap');
    const r = run(['--judge', 'reviewer', '--limit', '3', '--max-usd', '1.5', '--session-usd', '1', '--package', pkgDir, '--state-dir', state, '--out', out], { FAKE_COST: '0.9' });
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assert.equal(res.sessions, 1);
    assert.equal(res.rows, 1);
    assert.equal(res.spent, 0.9);
    assert.match(res.stopped, /^cap: \$0\.60 left/);
    assert.equal(sessions().length, 1);
    assert.equal(readRows([out]).length, 1);
  });

  test('a --variant arm replaces the installed judge and is keyed apart', () => {
    const { state, out } = fresh('variant');
    const base = run(['--judge', 'verifier', '--entry', ENTRY, '--max-usd', '5', '--package', pkgDir, '--state-dir', state, '--out', out]);
    assert.equal(base.status, 0, base.stderr);
    const weak = run(['--judge', 'verifier', '--entry', ENTRY, '--max-usd', '5', '--package', pkgDir, '--state-dir', state, '--out', out, '--arm', 'weak-verifier', '--variant', `.claude/agents/pan-verifier.md=${WEAK}`]);
    assert.equal(weak.status, 0, weak.stderr);
    const rows = readRows([out]);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((x) => x.report_source), Array(4).fill('.planning/phases/01-corpus/01-verification.md'));
    const byKey = Object.fromEntries(scoreboard(rows, loadCorpus()).map((b) => [b.key, b.catch.caught]));
    assert.deepEqual(byKey, { 'pan-verifier × claude × balanced': 1, 'pan-verifier × claude × balanced:weak-verifier': 0 });
    assert.equal(rows[2].variant, WEAK);
    assert.equal(rows[2].arm, 'weak-verifier');
  });

  test('--lenses 3 runs one pass per lens and the row carries the voted report', () => {
    const { state, out } = fresh('lenses');
    const r = run(['--judge', 'reviewer', '--lenses', '3', '--entry', ENTRY, '--max-usd', '10', '--session-usd', '1', '--package', pkgDir, '--state-dir', state, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const log = sessions();
    assert.equal(log.length, 6);
    assert.deepEqual(log.slice(0, 3).map((s) => (s.prompt.match(/<lens>(\w+)<\/lens>/) || [])[1]), ['correctness', 'security', 'maintainability']);
    const rows = readRows([out]);
    assert.match(rows[1].report, /3 passes, quorum 2/);
    assert.equal(rows[1].cost_usd, 0.75);
    assert.equal(rows[1].report_source, 'review vote (3 lenses)');
    const [board] = scoreboard(rows, loadCorpus());
    assert.deepEqual([board.catch.caught, board.falseAlarm.flagged, board.unreadable.length], [1, 0, 0]);
  });
});

describe('judge prompts', () => {
  const entry = loadCorpus().find((e) => e.id === ENTRY);
  test('each judge is spawned by its agent type, with the task and the change', () => {
    for (const [judge, agent] of Object.entries(CR.JUDGES)) {
      const p = CR.judgePrompt(judge, entry);
      assert.ok(p.includes(`subagent_type \`${agent}\``), judge);
      assert.ok(p.includes(entry.task), judge);
      assert.ok(p.includes('git diff HEAD~1'), judge);
    }
    assert.match(CR.judgePrompt('meta-reviewer', entry), /pan-hardener/);
    assert.match(CR.judgePrompt('reviewer', entry, { model: 'sonnet' }), /model `sonnet`/);
  });
});

describe('readReport: a pass is scored only with what it wrote', () => {
  test('a review file older than the session is not taken as this pass\'s report', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-corpus-rr-'));
    try {
      const dir = path.join(ws, '.planning', 'phases', '01-corpus');
      fs.mkdirSync(dir, { recursive: true });
      const block = '```pan-verdict\n' + JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '01', outcome: 'fail', findings: [{ class: 'defect', severity: 'high', where: 'src/a.js:1', summary: 'old' }] }) + '\n```\n';
      const f = path.join(dir, '01-review.md');
      fs.writeFileSync(f, block);
      const old = Date.now() - 60000;
      fs.utimesSync(f, old / 1000, old / 1000);
      assert.equal(CR.readReport(ws, 'no verdict here', 'pan-reviewer', Date.now() - 1000).report, 'no verdict here');
      assert.equal(CR.readReport(ws, 'no verdict here', 'pan-reviewer', 0).source, '.planning/phases/01-corpus/01-review.md');
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  });
});
