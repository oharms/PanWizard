/**
 * Program H10, the project-definition pair (pair-brief-live): model-free validation.
 *
 * Seed brief-shop is an almost empty Node repository whose only content is BRIEF.md, one
 * paragraph describing a stock and order library (reservations, partial shipments,
 * cancellations, low stock, a daily report, persistence). There is no .planning/: the PAN
 * arm must define the project itself (`/pan:new-project --auto @BRIEF.md`, then
 * `pan-tools autodev run` over the phases it planned); the stock arm is the bare host over
 * four fresh sessions with no structure given. Both are judged by
 * harness/scripts/check-shop.cjs, which neither can see. Before any paid run:
 *   - the check passes a reference implementation and fails five plausible mistakes on
 *     exactly the cases each breaks;
 *   - the brief is one paragraph that names the API and every behaviour the check tests;
 *   - the PAN arm's two spending steps run end to end against a stand-in `claude`: the
 *     model step through the harness's own runStep (a stand-in new-project writes a
 *     .planning tree from the brief), then autodev over that tree to done;
 *   - the stock arm's four steps are separate sessions, each with its own spend cap.
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
const CHECK = path.join(ROOT, 'harness', 'scripts', 'check-shop.cjs');
const RUN = path.join(ROOT, 'harness', 'scripts', 'autodev-run.cjs');
const SEED_TESTS = path.join(ROOT, 'harness', 'scripts', 'seed-tests.cjs');
const FIX = path.join(__dirname, 'fixtures', 'h10-shop');
const SEED = path.join(ROOT, 'harness', 'seeds', 'brief-shop');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const check = (ws) => { const r = spawnSync(process.execPath, [CHECK, ws], { encoding: 'utf8', timeout: 120000 }); return { ...JSON.parse(r.stdout), exit: r.status }; };
/** The seed with the reference on top, then a wrong variant's files over it. */
const workspace = (variant) => {
  const ws = tmp('pan-h10b-ws-');
  fs.cpSync(SEED, ws, { recursive: true });
  fs.cpSync(path.join(FIX, 'reference'), ws, { recursive: true });
  if (variant) fs.cpSync(path.join(FIX, variant), ws, { recursive: true });
  return ws;
};
/** A `claude` stand-in in its own directory: claude.cmd on Windows, a shell script elsewhere. */
const standIn = (binDir, js) => {
  if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`);
  else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
};

describe('H10 project-definition pair: the hidden check tells right from wrong', () => {
  test('the reference passes every case in every area', () => {
    const r = check(workspace(null));
    assert.equal(r.exit, 0, JSON.stringify(r.cases.filter((c) => !c.ok)));
    assert.equal(r.passed, true);
    assert.equal(r.failed, 0);
    assert.ok(r.cases.length >= 28 && r.cases.length <= 40, `${r.cases.length} cases`);
    assert.deepEqual(Object.keys(r.per_area), ['products', 'money', 'orders', 'fulfilment', 'cancel', 'low-stock', 'report', 'persistence']);
    for (const a of Object.values(r.per_area)) assert.equal(a.passed, a.total);
    assert.ok(r.per_area.persistence.total >= 4, 'persistence across restarts is tested');
  });

  // Each mistake is one a careful reader of the brief can still make; each fails exactly
  // the cases it should.
  const MISTAKES = {
    'cancel-releases-all': [
      'cancelling after a partial shipment releases only the unshipped part',
      'a partial order reopened and cancelled releases only its unshipped part',
    ],
    'low-stock-ignores-reserved': [
      'low stock counts available (stock minus reserved), not stock',
      'a cancel that releases stock takes a product off the low-stock list',
      'LOW is appended to a product that is low by available count',
      'products and reservations survive a restart',
    ],
    'report-unsorted': [
      'the report format: header, a line per product by SKU, total',
      'products are listed by SKU ascending, not in the order they were added',
    ],
    'float-money': [
      'a price that is not integer cents throws',
      'report amounts are currency units with two decimals',
      'the report format: header, a line per product by SKU, total',
      'only shipments made on that date count; reserving and cancelling are not revenue',
      'LOW is appended to a product that is low by available count',
      'an empty shop reports only the header and a zero total',
    ],
    'reservation-lost-on-reopen': [
      'products and reservations survive a restart',
      'a partial order reopened and cancelled releases only its unshipped part',
      'the report after a restart counts shipments made before it',
    ],
  };
  test('every wrong fixture on disk is listed here', () => {
    assert.deepEqual(fs.readdirSync(FIX).filter((d) => d !== 'reference').sort(), Object.keys(MISTAKES).sort());
  });
  for (const [variant, names] of Object.entries(MISTAKES)) {
    test(`${variant} fails exactly the cases it breaks`, () => {
      const r = check(workspace(variant));
      assert.equal(r.exit, 1);
      assert.equal(r.passed, false);
      assert.deepEqual(r.cases.filter((c) => !c.ok).map((c) => c.name), names);
    });
  }

  test('the reference passes its own tests through the seed\'s npm test', () => {
    const ws = workspace(null);
    const r = spawnSync(process.execPath, [SEED_TESTS, ws], { encoding: 'utf8', timeout: 120000 });
    assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).passed, true, r.stdout);
    assert.equal(r.status, 0);
  });
});

describe('H10 project-definition pair: the seed is a brief and nothing else', () => {
  const brief = fs.readFileSync(path.join(SEED, 'BRIEF.md'), 'utf8');

  test('no project structure and no code: no .planning, no src, zero dependencies', () => {
    assert.equal(fs.existsSync(path.join(SEED, '.planning')), false);
    assert.equal(fs.existsSync(path.join(SEED, 'src')), false);
    assert.deepEqual(fs.readdirSync(SEED).sort(), ['BRIEF.md', 'README.md', 'package.json']);
    const pkg = JSON.parse(fs.readFileSync(path.join(SEED, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'node --test');
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
  });

  test('BRIEF.md is one paragraph of prose, not a list of requirements', () => {
    const body = brief.trim();
    assert.ok(!/\n\s*\n/.test(body), 'a single paragraph');
    assert.ok(!/^\s*(?:[-*#>]|\d+[.)])\s/m.test(body), 'no headings, bullets or numbered items');
    assert.ok(!/^---/.test(body), 'no frontmatter (it would steer new-project in one arm only)');
    const words = body.split(/\s+/).length;
    assert.ok(words >= 150 && words <= 360, `${words} words`);
  });

  test('BRIEF.md names the public API the check calls and every behaviour it tests', () => {
    assert.match(brief, /`createShop\(file\)` from `src\/shop\.js`/);
    for (const name of ['addProduct', 'restock', 'getProduct', 'placeOrder', 'fulfil', 'cancel', 'getOrder', 'lowStock', 'dailyReport']) {
      assert.match(brief, new RegExp('`' + name + '\\('), name);
    }
    // The check reads these methods and no others.
    const used = new Set(fs.readFileSync(CHECK, 'utf8').match(/\bs\.(\w+)\(/g).map((m) => m.slice(2, -1)));
    for (const name of used) assert.match(brief, new RegExp('`' + name + '\\('), `the check calls ${name}, which the brief must name`);
    // The interacting rules and formats, stated in words.
    for (const rule of [/integer cents/, /stock minus reserved/, /whole order is refused/, /releases only the reservations not yet shipped/, /at or below its threshold, by SKU ascending/, /one line per product by SKU ascending/, /` LOW` appended/, /two decimals/, /reopened on the same file after a restart/, /never reused/]) {
      assert.match(brief, rule);
    }
  });
});

describe('H10 project-definition pair: the PAN arm runs end to end against a stand-in host', () => {
  let binDir;
  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-h10b-bin-'));
    // The stand-in plays both kinds of session. Given new-project (the harness's model step,
    // prompt on stdin) it writes what new-project --auto would from BRIEF.md: a project,
    // requirements, a two-phase roadmap, state and an auto-advancing config. Given an autodev
    // unit (prompt as the last argument) it writes a plan, the reference code and a passing
    // verification. Phase 1's requirements are precise (the engine plans it, no session);
    // phase 2 has a vague one, so a planning session runs.
    const js = path.join(binDir, 'claude-stand-in.js');
    fs.writeFileSync(js, `
const fs = require('fs'), path = require('path');
const cwd = process.cwd();
let prompt = process.argv[process.argv.length - 1];
if (!/\\/pan:/.test(prompt)) { try { prompt = fs.readFileSync(0, 'utf8'); } catch {} }
const P = (...p) => path.join(cwd, '.planning', ...p);
const log = (s) => fs.appendFileSync(path.join(process.env.H10_STANDIN_LOG), s + '\\n');
if (/^\\/pan:new-project --auto @BRIEF\\.md /.test(prompt)) {
  if (!fs.existsSync(path.join(cwd, 'BRIEF.md')) || fs.existsSync(P())) { process.stdout.write(JSON.stringify({ result: 'no brief or already defined', is_error: true, total_cost_usd: 0.1 })); process.exit(1); }
  log('new-project');
  fs.mkdirSync(P(), { recursive: true });
  fs.writeFileSync(P('config.json'), JSON.stringify({ mode: 'yolo', depth: 'quick', model_profile: 'balanced', commit_docs: true, workflow: { research: true, plan_check: true, verifier: true, auto_advance: true } }, null, 2));
  fs.writeFileSync(P('project.md'), '# Shopkeep\\n\\nStock and orders for a corner shop, from BRIEF.md.\\n\\n## Core Value\\n\\nStock is never oversold.\\n');
  fs.writeFileSync(P('requirements.md'), [
    '# Requirements', '', '## v1.0 Requirements', '', '### Catalogue and orders (phase 1)', '',
    '- **SHOP-01** — \\x60src/shop.js\\x60 exports \\x60createShop(file)\\x60; \\x60addProduct\\x60, \\x60restock\\x60 and \\x60getProduct\\x60 keep products with integer-cent prices, persisted to the file at once.',
    '- **SHOP-02** — \\x60placeOrder(lines, date)\\x60 reserves stock for every line or refuses the whole order and reserves nothing; order ids count from 1 and are never reused.',
    '', '### Fulfilment and reporting (phase 2)', '',
    '- **SHOP-03** — \\x60fulfil(id, sku, qty, date)\\x60 ships part or all of a line and \\x60cancel(id)\\x60 releases only what was not shipped, with statuses open, partial, fulfilled and cancelled.',
    '- **SHOP-04** — Reporting works the way the shop wants.', '',
  ].join('\\n'));
  fs.writeFileSync(P('roadmap.md'), [
    '# Roadmap: Shopkeep', '', '## Phases', '',
    '- [ ] **Phase 1: Catalogue and orders** - Products and reservations',
    '- [ ] **Phase 2: Fulfilment and reporting** - Shipping, cancelling, low stock and the daily report', '',
    '## Phase Details', '',
    '### Phase 1: Catalogue and orders', '**Goal:** Products can be added and ordered, and survive a restart.', '**Depends on:** Nothing (first phase)', '**Requirements:** SHOP-01, SHOP-02', '**Success Criteria** (what must be TRUE):', '  1. An over-order reserves nothing', '**Plans:** 0 plans', '',
    '### Phase 2: Fulfilment and reporting', '**Goal:** Orders ship and cancel, and the shop sees low stock and a daily report.', '**Depends on:** Phase 1', '**Requirements:** SHOP-03, SHOP-04', '**Success Criteria** (what must be TRUE):', '  1. A cancel after a partial shipment releases only the rest', '**Plans:** 0 plans', '',
  ].join('\\n'));
  fs.writeFileSync(P('state.md'), '# Project State\\n\\n## Current Position\\n\\n**Current Phase:** 1\\n**Current Phase Name:** Catalogue and orders\\n**Current Plan:** —\\n**Total Plans in Phase:** 0\\n**Total Phases:** 2\\n**Status:** Ready to plan\\n**Last Activity:** 2026-10-25\\n**Progress:** [░░░░░░░░░░] 0%\\n\\n## Active Blockers\\n\\nNone.\\n');
  process.stdout.write(JSON.stringify({ result: 'defined', is_error: false, total_cost_usd: 0.5, num_turns: 9, session_id: 'np' }));
  process.exit(0);
}
const m = prompt.match(/\\/pan:(plan|exec|verify)-phase (\\d+)/);
const NAMES = { 1: 'catalogue-and-orders', 2: 'fulfilment-and-reporting' };
if (m) {
  log(m[1] + ':' + m[2]);
  const n = m[2], pad = '0' + n;
  const phases = P('phases');
  fs.mkdirSync(phases, { recursive: true });
  let dir = fs.readdirSync(phases).find((d) => d.startsWith(pad + '-'));
  if (!dir) { dir = pad + '-' + NAMES[n]; fs.mkdirSync(path.join(phases, dir)); }
  dir = path.join(phases, dir);
  if (m[1] === 'plan') fs.writeFileSync(path.join(dir, pad + '-01-plan.md'), '---\\nphase: ' + pad + '\\n---\\n<objective>\\nphase ' + n + '\\n</objective>\\n');
  if (m[1] === 'exec') {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'tests'), { recursive: true });
    fs.copyFileSync(path.join(process.env.H10_REFERENCE, 'src', 'shop.js'), path.join(cwd, 'src', 'shop.js'));
    fs.copyFileSync(path.join(process.env.H10_REFERENCE, 'tests', 'shop.test.js'), path.join(cwd, 'tests', 'shop.test.js'));
    fs.writeFileSync(path.join(dir, pad + '-01-summary.md'), '# done\\n');
  }
  if (m[1] === 'verify') fs.writeFileSync(path.join(dir, pad + '-verification.md'), '---\\nstatus: passed\\n---\\n# V\\n');
}
process.stdout.write(JSON.stringify({ result: 'ok', total_cost_usd: 0.25 }) + '\\n');
`);
    standIn(binDir, js);
  });
  after(() => fs.rmSync(binDir, { recursive: true, force: true }));

  test('new-project defines the project from the brief, then autodev builds every phase it planned to done', () => {
    const ws = tmp('pan-h10b-ws-');
    fs.cpSync(SEED, ws, { recursive: true });
    execFileSync(process.execPath, [INSTALLER_PATH, '--claude', '--local'], { cwd: ws, stdio: 'ignore' });
    const S = require('../harness/src/scenario.cjs');
    const pan = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((s) => s.id === 'pair-brief-live');
    const logFile = path.join(tmp('pan-h10b-log-'), 'calls.log');
    const saved = { PATH: process.env.PATH, H10_STANDIN_LOG: process.env.H10_STANDIN_LOG };

    // Step 1, the model step, through the harness's own runner. Only the stand-in can answer
    // to `claude` (cmd.exe itself is found through ComSpec), so nothing real can spend.
    let step1;
    try {
      process.env.PATH = binDir + (process.platform === 'win32' ? '' : `${path.delimiter}/usr/bin${path.delimiter}/bin`);
      process.env.H10_STANDIN_LOG = logFile;
      const { runStep } = require('../harness/src/run.cjs');
      let spent = 0;
      const ctx = { ws, other: ws, repo: ROOT, pkg: ROOT, runtime: 'claude', budget: pan.budget, shareUsd: 30, spentUsd: () => spent, addCost: (c) => { spent += c; } };
      step1 = runStep(pan.steps[0], ctx);
      assert.equal(spent, 0.5);
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.H10_STANDIN_LOG === undefined) delete process.env.H10_STANDIN_LOG; else process.env.H10_STANDIN_LOG = saved.H10_STANDIN_LOG;
    }
    assert.equal(step1.code, 0, step1.stderr);
    for (const e of pan.steps[0].expect.filter((x) => x.startsWith('file:'))) assert.ok(fs.existsSync(path.join(ws, e.slice(5))), e);

    // Step 2, autodev over the tree new-project wrote (its config left auto_advance on).
    const args = pan.steps[1].args.map((a) => (a === '<ws>' ? ws : a));
    const env = { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, PAN_STANDIN_DIR: binDir, H10_REFERENCE: path.join(FIX, 'reference'), H10_STANDIN_LOG: logFile, PAN_HARNESS_STEP_MAX_USD: '29.50' };
    const r = spawnSync(process.execPath, [RUN, ...args], { cwd: ws, encoding: 'utf8', env, timeout: 600000 });
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(out.stop, 'done', JSON.stringify(out) + r.stderr);
    assert.equal(r.status, 0);
    const units = [];
    for (let n = 1; n <= 2; n++) units.push(`plan:${n}`, `execute:${n}`, `verify:${n}`, `complete_phase:${n}`);
    assert.deepEqual(out.units, units);
    // Phase 1 is lean, planned by the engine at $0; phase 2 has a vague requirement, so its
    // plan is a session: five sessions at $0.25.
    assert.deepEqual(fs.readFileSync(logFile, 'utf8').trim().split('\n'), ['new-project', 'exec:1', 'verify:1', 'plan:2', 'exec:2', 'verify:2']);
    assert.equal(out.cost_usd, 1.25);
    assert.ok(fs.existsSync(path.join(ws, 'src', 'shop.js')));
    const c = check(ws);
    assert.equal(c.passed, true, JSON.stringify(c.cases.filter((x) => !x.ok)));
    const t = spawnSync(process.execPath, [SEED_TESTS, ws], { encoding: 'utf8', timeout: 120000 });
    assert.equal(t.status, 0, t.stdout);
  });
});

describe('H10 project-definition pair: the scenarios', () => {
  const S = require('../harness/src/scenario.cjs');
  const all = S.loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
  const pan = all.find((s) => s.id === 'pair-brief-live');
  const stock = all.find((s) => s.id === 'pair-brief-live-stock');
  const quality = all.find((s) => s.id === 'brief-live-quality');

  test('the three scenarios validate; the pair is consistent; all end in the same two judges', () => {
    for (const s of [pan, stock, quality]) assert.deepEqual(S.validateScenario(s), [], s.id);
    assert.deepEqual(S.validatePairs([pan, stock]), []);
    assert.equal(quality.pair, undefined, 'the quality arm is a third result, not a pair arm');
    for (const s of [pan, stock, quality]) {
      assert.equal(s.seed, 'brief-shop');
      assert.equal(s.tier, 2);
      assert.deepEqual(s.steps.slice(-2).map((st) => st.script), ['seed-tests.cjs', 'check-shop.cjs']);
      assert.ok(s.steps.slice(-2).every((st) => st.expect.includes('json:passed=true')));
    }
  });

  test('the PAN arms define the project with new-project --auto from the brief, then autodev builds it', () => {
    for (const s of [pan, quality]) {
      assert.deepEqual(s.install, ['--claude']);
      const [define, build] = s.steps;
      assert.equal(define.kind, 'model');
      // The command comes first, so the host expands it (as autodev's own unit prompts do).
      assert.match(define.prompt, /^\/pan:new-project --auto @BRIEF\.md /);
      assert.match(define.prompt, /do not continue into phase 1/);
      assert.ok(define.maxUsd > 0 && define.maxUsd <= s.budget.maxUsd);
      for (const f of ['project.md', 'requirements.md', 'roadmap.md']) assert.ok(define.expect.includes(`file:.planning/${f}`));
      assert.equal(build.script, 'autodev-run.cjs');
      assert.equal(build.spends, true);
      const arg = (k) => Number(build.args[build.args.indexOf(k) + 1]);
      assert.ok(define.maxUsd + arg('--max-usd') <= s.budget.maxUsd, 'both spending steps fit the budget');
      assert.ok(arg('--max-turns') >= 24, 'up to six phases of four units');
      assert.ok(arg('--timeout-minutes') < s.budget.maxStepMinutes && s.budget.maxStepMinutes <= s.budget.maxMinutes);
      assert.ok(build.expect.includes('json:stop=done') && build.expect.includes('file:src/shop.js'));
    }
    assert.ok(!pan.steps[1].args.includes('--quality'));
    assert.ok(quality.steps[1].args.includes('--quality'));
    assert.match(quality.steps[0].prompt, /model_profile: quality/);
    assert.ok(!/model_profile/.test(pan.steps[0].prompt), 'the default arm takes new-project\'s auto defaults');
  });

  test('the stock arm is four independent sessions from the brief, each capped', () => {
    assert.equal(stock.install, null);
    const models = stock.steps.filter((st) => st.kind === 'model');
    assert.equal(models.length, 4);
    assert.deepEqual(stock.steps.slice(0, 4), models, 'the four sessions come first');
    assert.match(models[0].prompt, /^Read BRIEF\.md and build this product\. It is too large for one session: you will get four sessions, and nothing carries over between them except this repository\./);
    models.slice(1).forEach((st, i) => {
      assert.match(st.prompt, new RegExp(`^Continue building the product described in BRIEF\\.md from where the repository stands\\. Session ${i + 2} of 4`));
    });
    assert.match(models[3].prompt, /every behaviour in the brief works and is tested/);
    for (const st of models) {
      assert.match(st.prompt, /do not ask questions\.$/);
      // No session carried over: no persistence, no resume, no scripted user between them.
      assert.equal(st.persistSession, undefined);
      assert.equal(st.resume, undefined);
      assert.ok(st.maxUsd > 0 && st.maxUsd * 4 <= stock.budget.maxUsd, 'four steps fit the budget');
      // Nothing PAN-shaped is handed to the bare host.
      assert.ok(!/\.planning|\/pan:|roadmap|requirements/i.test(st.prompt), st.prompt);
    }
    assert.ok(!stock.steps.some((st) => st.kind === 'user'));
    assert.ok(stock.budget.maxStepMinutes * 4 <= stock.budget.maxMinutes);
    const { modelArgs } = require('../harness/src/model.cjs');
    const argv = modelArgs(tmp('pan-h10b-args-'), { maxUsd: models[0].maxUsd });
    assert.ok(argv.includes('--no-session-persistence'));
    assert.ok(!argv.includes('--resume'));
  });
});
