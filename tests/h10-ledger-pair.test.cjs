/**
 * Program H10, the large-project pair (pair-ledger-live): model-free validation.
 *
 * Seed ledger-roadmap is a six-phase household ledger roadmap in which phase 5 changes the
 * storage format under phases 1-4 (and must migrate their files, data/sample-ledger.json
 * among them) and phase 6 must reuse phases 3 and 4. The PAN arm runs `pan-tools autodev
 * run` over all six phases; the stock arm is the bare host, one fresh session per phase.
 * Both are judged by harness/scripts/check-ledger.cjs, which neither can see. Before any
 * paid run:
 *   - the check passes a reference implementation and fails six plausible phase-by-phase
 *     mistakes on exactly the cases each breaks, cross-phase regressions included;
 *   - the reference passes the seed's own `npm test`;
 *   - the PAN arm's step runs end to end against a stand-in `claude` through all six phases;
 *   - the stock arm's six steps are separate sessions, each with its own spend cap.
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
const CHECK = path.join(ROOT, 'harness', 'scripts', 'check-ledger.cjs');
const RUN = path.join(ROOT, 'harness', 'scripts', 'autodev-run.cjs');
const SEED_TESTS = path.join(ROOT, 'harness', 'scripts', 'seed-tests.cjs');
const FIX = path.join(__dirname, 'fixtures', 'h10-ledger');
const SEED = path.join(ROOT, 'harness', 'seeds', 'ledger-roadmap');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const check = (ws) => { const r = spawnSync(process.execPath, [CHECK, ws], { encoding: 'utf8', timeout: 120000 }); return { ...JSON.parse(r.stdout), exit: r.status }; };
/** The seed with the reference on top, then a wrong variant's files over it. */
const workspace = (variant) => {
  const ws = tmp('pan-h10l-ws-');
  fs.cpSync(SEED, ws, { recursive: true });
  fs.cpSync(path.join(FIX, 'reference'), ws, { recursive: true });
  if (variant) fs.cpSync(path.join(FIX, variant), ws, { recursive: true });
  return ws;
};

describe('H10 large-project pair: the hidden check tells right from wrong', () => {
  test('the reference passes every case, in every phase, with no regression', () => {
    const r = check(workspace(null));
    assert.equal(r.exit, 0, JSON.stringify(r.cases.filter((c) => !c.ok)));
    assert.equal(r.passed, true);
    assert.equal(r.regressions, 0);
    assert.ok(r.cases.length >= 25 && r.cases.length <= 45, `${r.cases.length} cases`);
    assert.deepEqual(Object.keys(r.per_phase), ['1', '2', '3', '4', '5', '6']);
    for (const p of Object.values(r.per_phase)) assert.equal(p.passed, p.total);
    assert.ok(r.cases.filter((c) => c.regression).length >= 5, 'cross-phase regression cases');
    // Every requirement in the seed is exercised by at least one case.
    const reqs = fs.readFileSync(path.join(SEED, '.planning', 'requirements.md'), 'utf8').match(/^- \*\*([A-Z]+-\d+)\*\*/gm).map((l) => l.replace(/^- \*\*|\*\*$/g, ''));
    assert.deepEqual([...new Set(r.cases.map((c) => c.req))].sort(), reqs.sort());
  });

  // Each mistake is one a phase-by-phase implementer can make; each fails exactly the cases
  // it should. The regression count is the cross-phase cases among them.
  const MISTAKES = {
    'migration-skips-legacy': { regressions: 4, names: [
      'a phase 1-4 file opens with every amount exact',
      'the migration writes version 2 cents and a byte-for-byte backup',
      'a legacy file without nextId or rules continues from the largest id',
      'regression: the monthly report of the migrated sample is unchanged',
      'regression: import into a migrated ledger skips what it has and persists the rest',
      'regression: the trend over the migrated sample',
      'regression: budgets on the migrated sample ledger',
    ] },
    'migration-truncates': { regressions: 4, names: [
      'a phase 1-4 file opens with every amount exact',
      'the migration writes version 2 cents and a byte-for-byte backup',
      'a legacy file without nextId or rules continues from the largest id',
      'regression: the monthly report of the migrated sample is unchanged',
      'regression: import into a migrated ledger skips what it has and persists the rest',
      'regression: the trend over the migrated sample',
      'regression: budgets on the migrated sample ledger',
    ] },
    'migration-resets-ids': { regressions: 2, names: [
      'the migration keeps nextId, rules and categories',
      'regression: import into a migrated ledger skips what it has and persists the rest',
      'regression: ids stay unique after migrating, removing and reopening',
    ] },
    'report-float-sum': { regressions: 1, names: [
      'monthly income, expenses and net over the month only',
      'totals are exact to the cent',
      'byCategory nets each category; no category is uncategorized',
      'trend covers empty months and the year boundary',
      'regression: the monthly report of the migrated sample is unchanged',
    ] },
    'import-cents-unrounded': { regressions: 1, names: [
      'regression: import into a migrated ledger skips what it has and persists the rest',
    ] },
    'budget-own-matching': { regressions: 0, names: [
      'spent is the monthly report net of the stored category; refunds count',
    ] },
  };
  test('every wrong fixture on disk is listed here', () => {
    assert.deepEqual(fs.readdirSync(FIX).filter((d) => d !== 'reference').sort(), Object.keys(MISTAKES).sort());
  });
  for (const [variant, { names, regressions }] of Object.entries(MISTAKES)) {
    test(`${variant} fails exactly the cases it breaks`, () => {
      const r = check(workspace(variant));
      assert.equal(r.exit, 1);
      assert.equal(r.passed, false);
      assert.deepEqual(r.cases.filter((c) => !c.ok).map((c) => c.name), names);
      assert.equal(r.regressions, regressions);
    });
  }

  test('the check carries the seed sample byte for byte, so a workspace cannot change it', () => {
    const src = fs.readFileSync(CHECK, 'utf8');
    const sample = fs.readFileSync(path.join(SEED, 'data', 'sample-ledger.json'), 'utf8').trim();
    assert.ok(src.includes(`const SAMPLE = '${sample}';`));
  });

  test('the reference passes the seed\'s own tests; the bare seed has none to pass', () => {
    const ws = workspace(null);
    const r = spawnSync(process.execPath, [SEED_TESTS, ws], { encoding: 'utf8', timeout: 120000 });
    assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).passed, true, r.stdout);
    assert.equal(r.status, 0);
    // The seed ships no src/: every phase is still to build.
    assert.equal(fs.existsSync(path.join(SEED, 'src')), false);
  });
});

describe('H10 large-project pair: the PAN arm runs end to end against a stand-in host', () => {
  let binDir;
  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10l-bin-'));
    // The stand-in writes what each autodev unit would: a plan, the phase's code (from the
    // reference fixture) and a test, then a passing verification.
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `
const fs = require('fs'), path = require('path');
const prompt = process.argv[process.argv.length - 1];
const lm = prompt.match(/lean phase (\\d+)/); const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)/) || (lm ? [lm[0], 'exec', lm[1]] : null);
const NAMES = { 1: 'ledger', 2: 'csv-import', 3: 'categories', 4: 'monthly-reports', 5: 'integer-cents', 6: 'budgets' };
const FILES = { 1: ['ledger.js', 'categories.js'], 2: ['import.js'], 3: ['categories.js'], 4: ['report.js'], 5: ['ledger.js'], 6: ['budget.js'] };
if (m) {
  const n = m[2], pad = '0' + n;
  const phases = path.join(process.cwd(), '.planning', 'phases');
  fs.mkdirSync(phases, { recursive: true });
  let dir = fs.readdirSync(phases).find((d) => d.startsWith(pad + '-'));
  if (!dir) { dir = pad + '-' + NAMES[n]; fs.mkdirSync(path.join(phases, dir)); }
  dir = path.join(phases, dir);
  if (m[1] === 'plan') fs.writeFileSync(path.join(dir, pad + '-01-plan.md'), '---\\nphase: ' + pad + '\\n---\\n<objective>\\nphase ' + n + '\\n</objective>\\n');
  if (m[1] === 'exec') {
    fs.mkdirSync(path.join(process.cwd(), 'src'), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'tests'), { recursive: true });
    for (const file of FILES[n]) fs.copyFileSync(path.join(process.env.H10_REFERENCE, 'src', file), path.join(process.cwd(), 'src', file));
    fs.writeFileSync(path.join(process.cwd(), 'tests', 'phase' + n + '.test.js'), "const test = require('node:test'); test('loads', () => { require('../src/" + FILES[n][0] + "'); });\\n");
    if (n === '6') fs.copyFileSync(path.join(process.env.H10_REFERENCE, 'tests', 'ledger.test.js'), path.join(process.cwd(), 'tests', 'ledger.test.js'));
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

  test('autodev takes all six phases to done; the step reports its spend; the check passes', () => {
    const ws = tmp('pan-h10l-ws-');
    fs.cpSync(SEED, ws, { recursive: true });
    execFileSync(process.execPath, [INSTALLER_PATH, '--claude', '--local'], { cwd: ws, stdio: 'ignore' });
    const S = require('../harness/src/scenario.cjs');
    const pan = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((s) => s.id === 'pair-ledger-live');
    const args = pan.steps[0].args.map((a) => (a === '<ws>' ? ws : a));
    const env = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, H10_REFERENCE: path.join(FIX, 'reference'), PAN_HARNESS_STEP_MAX_USD: '30.00' };
    const r = spawnSync(process.execPath, [RUN, ...args], { cwd: ws, encoding: 'utf8', env, timeout: 600000 });
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(out.stop, 'done', JSON.stringify(out) + r.stderr);
    assert.equal(r.status, 0);
    const units = [];
    for (let n = 1; n <= 6; n++) units.push(`plan:${n}`, `execute:${n}`, `verify:${n}`, `complete_phase:${n}`);
    assert.deepEqual(out.units, units);
    // Every phase is lean (at most five precise requirements), so the engine plans each at
    // $0 and only the execute and verify units are sessions: twelve at $0.25.
    assert.equal(out.cost_usd, 3.0);
    const c = check(ws);
    assert.equal(c.passed, true, JSON.stringify(c.cases.filter((x) => !x.ok)));
    const t = spawnSync(process.execPath, [SEED_TESTS, ws], { encoding: 'utf8', timeout: 120000 });
    assert.equal(t.status, 0, t.stdout);
  });
});

describe('H10 large-project pair: the scenarios', () => {
  const S = require('../harness/src/scenario.cjs');
  const all = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
  const pan = all.find((s) => s.id === 'pair-ledger-live');
  const stock = all.find((s) => s.id === 'pair-ledger-live-stock');

  test('the pair is consistent and both arms end in the same two judges', () => {
    assert.deepEqual(S.validatePairs([pan, stock]), []);
    assert.equal(pan.seed, 'ledger-roadmap');
    for (const s of [pan, stock]) {
      assert.deepEqual(s.steps.slice(-2).map((st) => st.script), ['seed-tests.cjs', 'check-ledger.cjs']);
      assert.ok(s.steps.slice(-2).every((st) => st.expect.includes('json:passed=true')));
    }
  });

  test('the PAN arm spends through autodev under a cap that fits its budget and share', () => {
    const step = pan.steps[0];
    assert.equal(step.script, 'autodev-run.cjs');
    assert.equal(step.spends, true);
    const arg = (k) => Number(step.args[step.args.indexOf(k) + 1]);
    assert.ok(arg('--max-usd') <= pan.budget.maxUsd);
    assert.ok(arg('--max-turns') >= 24, 'six phases of four units');
    assert.ok(arg('--timeout-minutes') < pan.budget.maxStepMinutes && pan.budget.maxStepMinutes <= pan.budget.maxMinutes);
  });

  test('the stock arm is six independent sessions, one per phase in order, each capped', () => {
    const models = stock.steps.filter((st) => st.kind === 'model');
    assert.equal(models.length, 6);
    assert.deepEqual(stock.steps.slice(0, 6), models, 'the six sessions come first');
    models.forEach((st, i) => {
      assert.match(st.prompt, new RegExp(`^Implement phase ${i + 1} of the roadmap in \\.planning/roadmap\\.md`));
      assert.match(st.prompt, /Do not ask questions\.$/);
      if (i > 0) assert.match(st.prompt, /Earlier phases are already implemented in this repository\./);
      // No session carried over: no persistence, no resume, no scripted user between them.
      assert.equal(st.persistSession, undefined);
      assert.equal(st.resume, undefined);
      assert.ok(st.maxUsd > 0 && st.maxUsd * 6 <= stock.budget.maxUsd, 'six steps fit the budget');
    });
    assert.ok(!stock.steps.some((st) => st.kind === 'user'));
    assert.ok(stock.budget.maxStepMinutes * 6 <= stock.budget.maxMinutes);
    // A step without persistSession or resume runs headless with --no-session-persistence.
    const { modelArgs } = require('../harness/src/model.cjs');
    const argv = modelArgs(tmp('pan-h10l-args-'), { maxUsd: models[0].maxUsd });
    assert.ok(argv.includes('--no-session-persistence'));
    assert.ok(!argv.includes('--resume'));
  });

  test('maxUsd is only for model steps, and positive', () => {
    const base = { id: 'x', tier: 2, description: 'd', why: 'w', steps: [{ kind: 'model', prompt: 'p', maxUsd: 2, expect: ['exit:0'], why: 'w' }] };
    assert.deepEqual(S.validateScenario(base), []);
    assert.match(S.validateScenario({ ...base, steps: [{ ...base.steps[0], maxUsd: 0 }] }).join(), /maxUsd is a positive number/);
    assert.match(S.validateScenario({ ...base, steps: [{ kind: 'sh', script: 'a.cjs', maxUsd: 2, expect: ['exit:0'], why: 'w' }] }).join(), /only on model steps/);
  });
});

describe('H10 large-project pair: a model step\'s own maxUsd caps that session', () => {
  let binDir;
  const saved = process.env.PATH;
  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10l-cap-'));
    // A stand-in `claude` that reports the --max-budget-usd it was given and spends $0.10.
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `const a = process.argv; const i = a.indexOf('--max-budget-usd');
process.stdout.write(JSON.stringify({ result: 'cap=' + a[i + 1], is_error: false, total_cost_usd: 0.1 }));\n`);
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
    // Only the stand-in can answer to `claude` (cmd.exe itself is found through ComSpec).
    process.env.PATH = binDir + (process.platform === 'win32' ? '' : `${path.delimiter}/usr/bin${path.delimiter}/bin`);
  });
  after(() => { process.env.PATH = saved; fs.rmSync(binDir, { recursive: true, force: true }); });

  test('the cap is the smallest of the share left, the scenario budget and the step\'s maxUsd', () => {
    const { runStep } = require('../harness/src/run.cjs');
    const ws = tmp('pan-h10l-capws-');
    let spent = 0;
    const ctx = { ws, other: ws, repo: ROOT, pkg: ROOT, runtime: 'claude', budget: { maxUsd: 15, maxStepMinutes: 1 }, shareUsd: 30, spentUsd: () => spent, addCost: (c) => { spent += c; } };
    const capped = runStep({ kind: 'model', prompt: 'p', maxUsd: 2.5, expect: [], why: 'w' }, ctx);
    assert.equal(capped.stdout, 'cap=2.5');
    const uncapped = runStep({ kind: 'model', prompt: 'p', expect: [], why: 'w' }, ctx);
    assert.equal(uncapped.stdout, 'cap=15');
    assert.ok(Math.abs(spent - 0.2) < 1e-9);
  });
});
