/**
 * Focus cycles registered as quick tasks (spec focus_phase_integration_featureai.md,
 * Stage A): `focus open` and `focus close`, the measured test counts `focus auto
 * --update` reads back, `--stop` closing an open cycle, the guard seeing an open
 * cycle as work in flight on every hook host, and the focus prompts bracketing their
 * edits and committing through the commit verb.
 */
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const focus = require('../pan-wizard-core/bin/lib/focus.cjs');
const G = require('../hooks/pan-guard.js');

const ROOT = path.join(__dirname, '..');
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const json = (r) => JSON.parse(r.output);

const STATE = '# Project State\n\n## Current Position\n\n**Last Activity:** 2026-10-01\n**Last Activity Description:** started\n\n### Blockers/Concerns\n\nNone\n';
const BATCH = {
  date: '2026-10-31', mode: 'balanced', budget: 10, allocated: 6,
  batch: [
    { id: 'P1-1', title: 'Guard readdir', file: 'src/a.js', tier: 'MICRO', status: 'active' },
    { id: 'P2-2', title: 'Two files', files: ['src/b.js', 'lib/c.js'], tier: 'STANDARD' },
    { id: 'phase-2', title: 'Phase 2: API', source: 'phase', file: '.planning/phases/02-api', tier: 'FULL' },
    { id: 'todo-fix-login.md', title: 'Fix login', source: 'todo', file: '.planning/todos/pending/fix-login.md', tier: 'MICRO' },
  ],
};

// A test command whose pass count is whatever count.txt says: the measurement is real
// (test-gate runs it and parses Node's spec summary), the number is the fixture's.
function withSuite(dir, count) {
  write(dir, 't.cjs', "const n=require('fs').readFileSync(__dirname+'/count.txt','utf8').trim();console.log('\\u2139 tests '+n+'\\n\\u2139 pass '+n+'\\n\\u2139 fail 0');\n");
  write(dir, 'count.txt', String(count));
  write(dir, '.planning/config.json', JSON.stringify({ workflow: { test_command: 'node t.cjs' } }));
}

function seed(dir, { batch = BATCH, count = 5 } = {}) {
  write(dir, '.planning/state.md', STATE);
  write(dir, '.planning/todos/pending/fix-login.md', '---\ntitle: Fix login\n---\nThe login button.\n');
  if (batch) write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify(batch, null, 2));
  if (count != null) withSuite(dir, count);
}

const cycleDir = (dir) => fs.readdirSync(path.join(dir, '.planning', 'quick')).find((n) => /-focus-/.test(n));

describe('focus open', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  test('registers a quick task numbered after /pan:quick\'s, with the items and only source paths', () => {
    seed(dir);
    fs.mkdirSync(path.join(dir, '.planning', 'quick', '3-fix-typo'), { recursive: true });
    const r = runPanTools('focus open', dir);
    assert.ok(r.success, r.error);
    const out = json(r);
    assert.equal(out.num, 4);
    assert.match(out.dir, /^\.planning\/quick\/4-focus-exec-\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(out.items, ['P1-1', 'P2-2', 'phase-2', 'todo-fix-login.md']);
    assert.deepEqual(out.files_modified, ['src/a.js', 'src/b.js', 'lib/c.js'], 'pointers into .planning/ are not files the cycle changes');
    assert.equal(out.tests_before, 5, 'measured by running the test command');
    const plan = read(dir, out.plan);
    assert.match(plan, /^source: focus$/m);
    assert.match(plan, /^focus_kind: exec$/m);
    assert.match(plan, /^items: \["P1-1", "P2-2", "phase-2", "todo-fix-login\.md"\]$/m);
    assert.match(plan, /^files_modified: \[src\/a\.js, src\/b\.js, lib\/c\.js\]$/m);
    assert.match(plan, /^tests_before: 5$/m);
    assert.equal(focus.openFocusCycle(dir).num, 4);
  });

  test('refuses a second cycle while one is open, naming it', () => {
    seed(dir);
    const first = json(runPanTools('focus open', dir));
    const second = runPanTools('focus open', dir);
    assert.equal(second.success, false);
    const out = json(second);
    assert.equal(out.error, 'cycle_open');
    assert.equal(out.dir, first.dir);
    assert.equal(fs.readdirSync(path.join(dir, '.planning', 'quick')).length, 1, 'nothing new created');
  });

  test('every batch shape opens: a "batch" array, an "items" array, items with file, files or neither', () => {
    seed(dir, { batch: { items: [{ id: 'a', file: 'x.js' }, { id: 'b', files: ['y.js'] }, { id: 'c' }, 'a bare string'] } });
    const out = json(runPanTools('focus open', dir));
    assert.deepEqual(out.items, ['a', 'b', 'c', 'item-4']);
    assert.deepEqual(out.files_modified, ['x.js', 'y.js']);
  });

  test('a batch file that is not JSON is refused with the reader\'s message, and no directory is made', () => {
    seed(dir, { batch: null });
    write(dir, '.planning/focus/batch-2026-10-31.json', '{ not json');
    const r = runPanTools('focus open', dir);
    assert.equal(r.success, false);
    assert.match(json(r).reason, /is not valid JSON/);
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'quick')), false);
  });

  test('--batch names a file; an unknown one and an unknown --kind are refused', () => {
    seed(dir);
    write(dir, '.planning/focus/batch-2026-11-01-docs.json', JSON.stringify({ items: [{ id: 'd1' }] }));
    assert.equal(json(runPanTools('focus open --batch batch-2026-11-01-docs.json', dir)).items[0], 'd1');
    focus.focusClose(dir, { dir: focus.openFocusCycle(dir).rel, status: 'failed', measure: false });
    assert.equal(json(runPanTools('focus open --batch nope.json', dir)).error, 'batch_not_found');
    assert.equal(json(runPanTools('focus open --kind deploy', dir)).error, 'invalid_kind');
  });

  test('a docs cycle needs no batch and runs no tests', () => {
    seed(dir, { batch: null });
    const out = json(runPanTools('focus open --kind docs', dir));
    assert.match(out.dir, /-focus-docs-/);
    assert.deepEqual(out.items, []);
    assert.equal(out.tests_before, null);
    assert.equal(out.test_status, null);
  });
});

describe('focus close', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); });
  afterEach(() => cleanup(dir));

  test('writes the summary, the state row and Last Activity, the batch results, and completes the todo', () => {
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'count.txt', '7');
    const r = runPanTools(`focus close --dir ${opened.dir} --status verified --commit abc1234 --done P1-1,todo-fix-login.md --failed "P2-2=the fix broke b, reverted"`, dir);
    assert.ok(r.success, r.error);
    const out = json(r);
    assert.equal(out.status, 'verified');
    assert.deepEqual(out.items_done, ['P1-1', 'todo-fix-login.md']);
    assert.deepEqual(out.items_failed, ['P2-2']);
    assert.deepEqual(out.items_not_reported, ['phase-2']);
    assert.equal(out.tests_before, 5);
    assert.equal(out.tests_after, 7);

    const summary = read(dir, out.summary);
    assert.match(summary, /^status: verified$/m);
    assert.match(summary, /^tests_after: 7$/m);
    assert.match(summary, /\| P2-2 \| failed \| the fix broke b, reverted \|/);

    const state = read(dir, '.planning/state.md');
    assert.match(state, /\| focus: mode balanced — 2 of 4 items \| \d{4}-\d{2}-\d{2} \| abc1234 \| verified \| \[4?\d*-focus-exec-[\d-]+\]\(\.\/quick\/\d+-focus-exec-[\d-]+\/\) \|/);
    assert.match(state, /\*\*Last Activity Description:\*\* Closed focus cycle \d+: focus: mode balanced/);

    const batch = JSON.parse(read(dir, '.planning/focus/batch-2026-10-31.json'));
    assert.deepEqual(batch.results, { 'P1-1': 'done', 'todo-fix-login.md': 'done', 'P2-2': 'failed' });
    assert.equal(batch.result_reasons['P2-2'], 'the fix broke b, reverted');
    assert.equal(batch.batch[0].status, 'active', 'the scan-time status is left alone');

    assert.ok(fs.existsSync(path.join(dir, '.planning', 'todos', 'completed', 'fix-login.md')));
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'todos', 'pending', 'fix-login.md')), false);
    assert.equal(focus.openFocusCycle(dir), null, 'the cycle is no longer open');
  });

  test('with no test command, both counts are null and verified is capped at partial', () => {
    fs.rmSync(path.join(dir, '.planning', 'config.json'));
    const opened = json(runPanTools('focus open', dir));
    assert.equal(opened.tests_before, null);
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status verified --done P1-1`, dir));
    assert.equal(out.status, 'partial');
    assert.equal(out.reported_status, 'verified');
    assert.deepEqual(out.capped, ['no measured test count']);
    assert.equal(out.tests_after, null);
  });

  test('a directory that is not an open focus cycle is refused, and nothing is written', () => {
    write(dir, '.planning/quick/2-fix/2-plan.md', '# a /pan:quick plan\n');
    const before = read(dir, '.planning/state.md');
    for (const ref of ['.planning/quick/2-fix', '9', '']) {
      const r = runPanTools(`focus close --dir "${ref}" --status verified`, dir);
      assert.equal(r.success, false, ref);
      assert.equal(json(r).error, 'not_a_focus_cycle', ref);
    }
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'quick', '2-fix', '2-summary.md')), false);
    assert.equal(read(dir, '.planning/state.md'), before);
  });

  test('refuses an unknown item, an item both done and failed, a bad status, and a second close', () => {
    const opened = json(runPanTools('focus open', dir));
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status verified --done Z-9`, dir)).error, 'unknown_items');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status verified --done P1-1 --failed P1-1=x`, dir)).error, 'conflicting_items');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status done`, dir)).error, 'invalid_status');
    assert.ok(runPanTools(`focus close --dir ${opened.dir} --status failed`, dir).success);
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status failed`, dir)).error, 'cycle_closed');
  });

  test('--failed splits on a comma only before the next id=', () => {
    assert.deepEqual(focus.parseFailed(['a=x, y and z,b=w', 'c']), { a: 'x, y and z', b: 'w', c: 'no reason given' });
    assert.deepEqual(focus.parseDone(['a,b', 'b, c']), ['a', 'b', 'c']);
  });
});

describe('focus auto with registered cycles', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); });
  afterEach(() => cleanup(dir));

  test('--update records the closed cycle\'s measured counts as verified, without focus.verify_tests', () => {
    assert.ok(runPanTools('focus auto --category stability', dir).success);
    const opened = json(runPanTools('focus open', dir));
    assert.match(opened.run_id, /^auto-/, 'the live run is recorded on the cycle');
    write(dir, 'count.txt', '6');
    runPanTools(`focus close --dir ${opened.dir} --status verified --done P1-1 --failed P2-2=broke`, dir);
    // The agent's own figures disagree with what was measured; the measurement wins.
    const up = json(runPanTools('focus auto --update --items-completed 9 --items-failed 0 --points-used 4 --tests-before 100 --tests-after 100', dir));
    assert.equal(up.status, 'in_progress');
    const run = focus.readAutoRun(dir);
    const cycle = run.cycles[0];
    assert.equal(cycle.cycle_dir, opened.dir);
    assert.equal(cycle.items_completed, 1);
    assert.equal(cycle.items_failed, 1);
    assert.equal(cycle.tests_before, 5);
    assert.equal(cycle.tests_after, 6);
    assert.equal(cycle.tests_verified, true);
  });

  test('a measured drop trips the regression breaker', () => {
    runPanTools('focus auto --category stability', dir);
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'count.txt', '3');
    runPanTools(`focus close --dir ${opened.dir} --status partial --done P1-1`, dir);
    const up = json(runPanTools('focus auto --update --items-completed 1 --points-used 2 --tests-before 5 --tests-after 5', dir));
    assert.equal(up.stop_reason, 'regression');
  });

  test('an unregistered cycle keeps the flag path (tests_verified false)', () => {
    runPanTools('focus auto --category stability', dir);
    runPanTools('focus auto --update --items-completed 1 --points-used 2 --tests-before 5 --tests-after 5', dir);
    const cycle = focus.readAutoRun(dir).cycles[0];
    assert.equal(cycle.cycle_dir, undefined);
    assert.equal(cycle.tests_verified, false);
  });

  test('--stop closes an open cycle as failed', () => {
    runPanTools('focus auto --category stability', dir);
    const opened = json(runPanTools('focus open', dir));
    const out = json(runPanTools('focus auto --stop', dir));
    assert.equal(out.closed_cycle, opened.dir);
    assert.equal(focus.openFocusCycle(dir), null);
    assert.match(read(dir, `${opened.dir}/${opened.num}-summary.md`), /^status: failed$/m);
  });
});

describe('the guard sees an open focus cycle as work in flight, on every hook host', () => {
  let dir;
  beforeEach(() => {
    dir = createTempProject();
    seed(dir);
    const cfg = JSON.parse(read(dir, '.planning/config.json'));
    write(dir, '.planning/config.json', JSON.stringify({ ...cfg, hooks: { guard: 'enforce' }, instructions: { routing: 'exclusive' } }));
  });
  afterEach(() => cleanup(dir));

  const FIX = path.join(__dirname, 'fixtures', 'hooks');
  const payload = (host) => JSON.parse(fs.readFileSync(path.join(FIX, `pretool-${host}.json`), 'utf8')
    .split('{{PROJECT_DIR}}').join(dir.replace(/\\/g, '/')).split('{{SECRET}}').join('plain text'));
  const unrouted = (host) => G.evaluate(G.normalise(payload(host)), dir, '.planning', JSON.parse(read(dir, '.planning/config.json')))
    .filter((h) => h.rule === 'unrouted_write');

  for (const host of ['claude', 'codex', 'gemini', 'copilot']) {
    test(host, () => {
      assert.equal(unrouted(host).length, 1, 'nothing in flight: the source write is unrouted');
      const opened = json(runPanTools('focus open', dir));
      assert.deepEqual(unrouted(host), [], 'an open focus cycle is PAN work');
      runPanTools(`focus close --dir ${opened.dir} --status partial`, dir);
      assert.equal(unrouted(host).length, 1, 'closed: unrouted again');
    });
  }
});

describe('the focus prompts register their writes and commit through the commit verb', () => {
  const PROMPTS = {
    'commands/pan/focus-auto.md': read(ROOT, 'commands/pan/focus-auto.md'),
    'pan-wizard-core/workflows/focus-exec.md': read(ROOT, 'pan-wizard-core/workflows/focus-exec.md'),
    'pan-wizard-core/workflows/focus-doc-audit.md': read(ROOT, 'pan-wizard-core/workflows/focus-doc-audit.md'),
    'pan-wizard-core/workflows/focus-sync.md': read(ROOT, 'pan-wizard-core/workflows/focus-sync.md'),
    'pan-wizard-core/workflows/focus-drift-walking.md': read(ROOT, 'pan-wizard-core/workflows/focus-drift-walking.md'),
  };

  test('no focus prompt stages or commits with raw git', () => {
    for (const [file, text] of Object.entries(PROMPTS)) {
      const hit = text.match(/.*\bgit (?:add|commit)\b.*/);
      assert.equal(hit, null, `${file} runs git add or git commit: ${hit && hit[0]}`);
    }
  });

  test('every write-producing focus prompt opens a cycle before its edits and closes it after its commit', () => {
    for (const [file, text] of Object.entries(PROMPTS)) {
      const open = text.indexOf('pan-tools.cjs focus open');
      const commit = text.indexOf('pan-tools.cjs commit');
      const close = text.indexOf('pan-tools.cjs focus close');
      assert.ok(open !== -1, `${file}: no focus open`);
      assert.ok(close > open, `${file}: focus close must follow focus open`);
      assert.ok(commit === -1 || (commit > open && close > commit), `${file}: open, then commit, then close`);
    }
  });
});
