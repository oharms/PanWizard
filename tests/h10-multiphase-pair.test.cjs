/**
 * Program H10, the multi-phase pair (pair-roadmap-live): model-free validation.
 *
 * The PAN arm runs `pan-tools autodev run` over a two-phase roadmap (seed tasks-roadmap);
 * the stock arm is one Claude Code session given the same roadmap. Both are judged by
 * harness/scripts/check-tasks.cjs, which neither can see. Before any paid run:
 *   - the check passes a reference implementation and fails five plausible mistakes on
 *     exactly the requirement each breaks (persistence across restarts included);
 *   - the PAN arm's step runs end to end against a stand-in `claude`: PAN installed into a
 *     copy of the seed, autodev plans, executes, verifies and completes both phases through
 *     the real phase gate, and the step reports the spend the harness counts;
 *   - an sh step marked `spends` receives the step's cap and adds its cost to the run.
 */
'use strict';

const { describe, test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { INSTALLER_PATH } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'harness', 'scripts', 'check-tasks.cjs');
const RUN = path.join(ROOT, 'harness', 'scripts', 'autodev-run.cjs');
const FIX = path.join(__dirname, 'fixtures', 'h10-tasks');
const SEED = path.join(ROOT, 'harness', 'seeds', 'tasks-roadmap');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const check = (ws) => { const r = spawnSync(process.execPath, [CHECK, ws], { encoding: 'utf8' }); return { ...JSON.parse(r.stdout), exit: r.status }; };

describe('H10 multi-phase pair: the hidden check tells right from wrong', () => {
  test('a reference implementation passes every case', () => {
    const r = check(path.join(FIX, 'reference'));
    assert.equal(r.passed, true, JSON.stringify(r.cases.filter((c) => !c.ok)));
    assert.ok(r.cases.length >= 12);
    assert.deepEqual([...new Set(r.cases.map((c) => c.req))].sort(), ['REPORT-01', 'REPORT-02', 'REPORT-03', 'STORE-01', 'STORE-02', 'STORE-03', 'STORE-04']);
  });

  const MISTAKES = {
    'reuse-ids': ['ids are not reused after a remove', 'ids are not reused after a reopen'],
    'counter-from-max': ['ids are not reused after a reopen'],
    'overdue-inclusive': ['due today is not overdue; done tasks are not overdue'],
    'nodue-first': ['by priority, no due date last, then id'],
    'csv-no-quote-doubling': ['CSV quotes commas, quotes and line breaks'],
  };
  for (const [variant, names] of Object.entries(MISTAKES)) {
    test(`${variant} fails exactly the requirement it breaks`, () => {
      const r = check(path.join(FIX, variant));
      assert.equal(r.exit, 1);
      assert.deepEqual(r.cases.filter((c) => !c.ok).map((c) => c.name), names);
    });
  }
});

describe('H10 multi-phase pair: the PAN arm runs end to end against a stand-in host', () => {
  let binDir;
  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10m-bin-'));
    // The stand-in writes what each autodev unit would: a plan, the phase's code (from the
    // reference fixture) and a test, then a passing verification.
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `
const fs = require('fs'), path = require('path');
const prompt = process.argv[process.argv.length - 1];
const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)/);
if (m) {
  const n = m[2], pad = '0' + n;
  const phases = path.join(process.cwd(), '.planning', 'phases');
  fs.mkdirSync(phases, { recursive: true });
  let dir = fs.readdirSync(phases).find((d) => d.startsWith(pad + '-'));
  if (!dir) { dir = pad + '-' + (n === '1' ? 'store' : 'reports'); fs.mkdirSync(path.join(phases, dir)); }
  dir = path.join(phases, dir);
  if (m[1] === 'plan') fs.writeFileSync(path.join(dir, pad + '-01-plan.md'), '---\\nphase: ' + pad + '\\n---\\n<objective>\\nphase ' + n + '\\n</objective>\\n');
  if (m[1] === 'exec') {
    const file = n === '1' ? 'store.js' : 'report.js';
    fs.mkdirSync(path.join(process.cwd(), 'src'), { recursive: true });
    fs.copyFileSync(path.join(process.env.H10_REFERENCE, 'src', file), path.join(process.cwd(), 'src', file));
    fs.mkdirSync(path.join(process.cwd(), 'tests'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'tests', file.replace('.js', '.test.js')), "const test = require('node:test'); test('loads', () => { require('../src/" + file + "'); });\\n");
    fs.writeFileSync(path.join(dir, pad + '-01-summary.md'), '# done\\n');
  }
  if (m[1] === 'verify') fs.writeFileSync(path.join(dir, pad + '-verification.md'), '---\\nstatus: passed\\n---\\n# V\\n');
}
process.stdout.write(JSON.stringify({ result: 'ok', total_cost_usd: 0.25 }) + '\\n');
`);
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
  });
  after(() => fs.rmSync(binDir, { recursive: true, force: true }));

  test('autodev takes both phases to done; the step reports its spend; the check passes', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10m-ws-'));
    dirs.push(ws);
    fs.cpSync(SEED, ws, { recursive: true });
    execFileSync(process.execPath, [INSTALLER_PATH, '--claude', '--local'], { cwd: ws, stdio: 'ignore' });
    const env = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, H10_REFERENCE: path.join(FIX, 'reference'), PAN_HARNESS_STEP_MAX_USD: '5.00' };
    const r = spawnSync(process.execPath, [RUN, ws, '--max-turns', '12'], { cwd: ws, encoding: 'utf8', env, timeout: 240000 });
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(out.stop, 'done', JSON.stringify(out) + r.stderr);
    assert.equal(r.status, 0);
    assert.deepEqual(out.units, ['plan:1', 'execute:1', 'verify:1', 'complete_phase:1', 'plan:2', 'execute:2', 'verify:2', 'complete_phase:2']);
    // Right-sized ceremony step 2: both phases are lean, so the engine plans them at $0 and
    // only the execute and verify units are sessions.
    assert.equal(out.cost_usd, 1.0, 'four sessions at $0.25: the two plan units ran in the engine');
    const c = check(ws);
    assert.equal(c.passed, true, JSON.stringify(c.cases.filter((x) => !x.ok)));
  });

  test('without a spend cap, or without PAN installed, the step refuses', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10m-ws-'));
    dirs.push(ws);
    const noPan = spawnSync(process.execPath, [RUN, ws], { encoding: 'utf8', env: { ...process.env, PAN_HARNESS_STEP_MAX_USD: '5' } });
    assert.equal(JSON.parse(noPan.stdout).error, 'pan_not_installed');
    fs.mkdirSync(path.join(ws, '.claude', 'pan-wizard-core', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.claude', 'pan-wizard-core', 'bin', 'pan-tools.cjs'), '');
    const env = { ...process.env };
    delete env.PAN_HARNESS_STEP_MAX_USD;
    const noCap = spawnSync(process.execPath, [RUN, ws], { encoding: 'utf8', env });
    assert.equal(JSON.parse(noCap.stdout).error, 'no_spend_cap');
  });
});

describe('H10 multi-phase pair: the pair and the spending sh step', () => {
  test('the pair is consistent; the PAN arm spends through autodev, the stock arm through one session', () => {
    const S = require('../harness/src/scenario.cjs');
    const all = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
    const pan = all.find((s) => s.id === 'pair-roadmap-live');
    const stock = all.find((s) => s.id === 'pair-roadmap-live-stock');
    assert.deepEqual(S.validatePairs([pan, stock]), []);
    assert.equal(pan.steps[0].script, 'autodev-run.cjs');
    assert.equal(pan.steps[0].spends, true);
    assert.equal(stock.steps[0].kind, 'model');
    for (const s of [pan, stock]) assert.ok(s.steps.some((st) => st.script === 'check-tasks.cjs'));
  });

  test('spends is only for sh steps, and never at tier 0', () => {
    const S = require('../harness/src/scenario.cjs');
    const base = { id: 'x', tier: 0, description: 'd', why: 'w', controls: [{ id: 'c', delete: 'a', why: 'w' }], steps: [{ kind: 'sh', script: 'a.cjs', spends: true, expect: ['exit:0'], why: 'w' }] };
    assert.match(S.validateScenario(base).join(), /cannot live in a tier-0 scenario/);
    assert.match(S.validateScenario({ ...base, tier: 2, steps: [{ kind: 'model', prompt: 'p', spends: true, expect: ['exit:0'], why: 'w' }] }).join(), /only for sh steps/);
  });

  test('the harness passes the cap to a spending sh step and counts its cost', () => {
    const src = fs.readFileSync(path.join(ROOT, 'harness', 'src', 'run.cjs'), 'utf8');
    const sh = src.slice(src.indexOf("case 'sh': {"), src.indexOf("case 'build': {"));
    assert.match(sh, /PAN_HARNESS_STEP_MAX_USD/);
    assert.match(sh, /ctx\.addCost\(cost\)/);
    assert.match(sh, /a spending sh step needs --max-usd/);
  });
});
