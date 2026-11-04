/**
 * openWork (spec focus_phase_integration_featureai.md, A1-R): the work started and not
 * finished, read by `init resume` and /pan:resume. The guard keeps its own copy of the
 * in-flight question (hooks cannot require core), so the two are pinned here to give
 * the same answer on every fixture.
 */
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { openWork } = require('../pan-wizard-core/bin/lib/open-work.cjs');
const G = require('../hooks/pan-guard.js');

const ROOT = path.join(__dirname, '..');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const STATE = '# Project State\n\n**Current Phase:** 2\n';
const FOCUS_PLAN = '---\nphase: quick\nsource: focus\nfocus_kind: exec\nrun_id: "auto-2026-11-01-1"\n---\n';

const FIXTURES = {
  'no work': () => {},
  'an unfinished plan in the current phase': (d) => { write(d, '.planning/state.md', STATE); write(d, '.planning/phases/02-api/02-01-plan.md', '# plan\n'); },
  'a finished plan in the current phase': (d) => { write(d, '.planning/state.md', STATE); write(d, '.planning/phases/02-api/02-01-plan.md', '# plan\n'); write(d, '.planning/phases/02-api/02-01-summary.md', '# done\n'); },
  'an unfinished plan in another phase': (d) => { write(d, '.planning/state.md', STATE); write(d, '.planning/phases/03-ui/03-01-plan.md', '# plan\n'); },
  'an open focus cycle': (d) => write(d, '.planning/quick/4-focus-exec-2026-11-01/4-plan.md', FOCUS_PLAN),
  'a closed focus cycle': (d) => { write(d, '.planning/quick/4-focus-exec-2026-11-01/4-plan.md', FOCUS_PLAN); write(d, '.planning/quick/4-focus-exec-2026-11-01/4-summary.md', '# closed\n'); },
  'an open /pan:quick task': (d) => write(d, '.planning/quick/3-fix-typo/3-plan.md', '---\nphase: quick\n---\n'),
  'a quick directory with no plan': (d) => fs.mkdirSync(path.join(d, '.planning', 'quick', '5-empty'), { recursive: true }),
  'a file where a quick task would be': (d) => write(d, '.planning/quick/notes.md', 'x'),
  'a debug session': (d) => write(d, '.planning/debug/login.md', '# debug\n'),
};

describe('openWork and the guard agree on what is in flight', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  for (const [name, setup] of Object.entries(FIXTURES)) {
    test(name, () => {
      setup(dir);
      assert.equal(openWork(dir).in_flight, G.workInFlight(dir, '.planning'));
    });
  }

  test('the fixtures cover both answers', () => {
    const answers = new Set();
    for (const setup of Object.values(FIXTURES)) {
      const d = createTempProject();
      try { setup(d); answers.add(openWork(d).in_flight); } finally { cleanup(d); }
    }
    assert.deepEqual([...answers].sort(), [false, true]);
  });

  test('a planning tree the guard cannot read: the guard throws (and its caller fails open), openWork lists nothing', () => {
    write(dir, '.planning/quick', 'not a directory');
    assert.throws(() => G.workInFlight(dir, '.planning'));
    assert.equal(openWork(dir).in_flight, false);
  });
});

describe('openWork lists what resume shows', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  test('focus cycles and /pan:quick tasks are told apart; closed ones are not listed', () => {
    FIXTURES['an open focus cycle'](dir);
    FIXTURES['an open /pan:quick task'](dir);
    write(dir, '.planning/quick/1-old/1-plan.md', '# plan\n');
    write(dir, '.planning/quick/1-old/1-summary.md', '# done\n');
    const w = openWork(dir);
    assert.deepEqual(w.quick.map((q) => [q.dir, q.source]), [
      ['.planning/quick/3-fix-typo', 'quick'],
      ['.planning/quick/4-focus-exec-2026-11-01', 'focus'],
    ]);
    assert.equal(w.quick[1].run_id, 'auto-2026-11-01-1');
    assert.equal(w.quick[1].kind, 'exec');
  });

  test('every phase\'s unfinished plans are listed, the current phase marked; checkpoints too', () => {
    write(dir, '.planning/state.md', STATE);
    write(dir, '.planning/phases/02-api/02-01-plan.md', '# plan\n');
    write(dir, '.planning/phases/03-ui/03-01-plan.md', '# plan\n');
    write(dir, '.planning/phases/02-api/.continue-here-02-01.md', '# where\n');
    const w = openWork(dir);
    assert.deepEqual(w.phase_plans.map((p) => [p.plan, p.current]), [
      ['.planning/phases/02-api/02-01-plan.md', true],
      ['.planning/phases/03-ui/03-01-plan.md', false],
    ]);
    assert.deepEqual(w.continue_here, [{ path: '.planning/phases/02-api/.continue-here-02-01.md' }]);
  });

  test('init resume carries open_work', () => {
    FIXTURES['an open focus cycle'](dir);
    FIXTURES['a debug session'](dir);
    const r = runPanTools('init resume', dir);
    assert.ok(r.success, r.error);
    const w = JSON.parse(r.output).open_work;
    assert.equal(w.in_flight, true);
    assert.equal(w.quick[0].source, 'focus');
    assert.deepEqual(w.debug, [{ file: '.planning/debug/login.md' }]);
  });

  test('/pan:resume reads open_work and no longer loops over phase plans in the shell', () => {
    const prompt = fs.readFileSync(path.join(ROOT, 'pan-wizard-core/workflows/resume-project.md'), 'utf8');
    assert.match(prompt, /`open_work`/);
    assert.match(prompt, /\*\*If an open focus cycle exists/);
    assert.doesNotMatch(prompt, /for plan in \.planning\/phases/);
  });
});

// 3.42.0: plan and summary names in any case. The guard, open work and hygiene matched
// lower-case `-plan.md` only, so an older layout's `-PLAN.md` was never in flight and the
// guard's unrouted-write rule fired during real PAN work.
describe('an upper-case -PLAN.md is in flight for open work, the guard and hygiene', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => { cleanup(dir); });

  test('a phase plan', () => {
    write(dir, '.planning/state.md', STATE);
    write(dir, '.planning/phases/02-api/02-01-PLAN.md', '---\nfiles_modified: [src/api.js]\n---\n# plan\n');
    assert.equal(openWork(dir).in_flight, true);
    assert.equal(G.workInFlight(dir, '.planning'), true);
    write(dir, '.planning/phases/02-api/02-01-SUMMARY.md', '# done\n');
    assert.equal(openWork(dir).in_flight, false, 'its own summary, in either case, finishes it');
    assert.equal(G.workInFlight(dir, '.planning'), false);
  });

  test('a quick task', () => {
    write(dir, '.planning/quick/1-fix/1-PLAN.md', '# plan\n');
    assert.equal(openWork(dir).in_flight, true);
    assert.equal(G.workInFlight(dir, '.planning'), true);
  });

  test('hygiene reports a stale upper-case quick plan', () => {
    const plan = path.join(dir, '.planning', 'quick', '1-fix', '1-PLAN.md');
    write(dir, '.planning/quick/1-fix/1-PLAN.md', '# plan\n');
    const old = new Date(Date.now() - 3 * 86400000);
    fs.utimesSync(plan, old, old);
    const r = runPanTools('hygiene scan', dir);
    const findings = JSON.parse(r.output).findings.filter((f) => f.check === 'open-task-stale');
    assert.equal(findings.length, 1, r.output);
  });
});

// Doc-audit pass 13 (3.42.0): the guard read one decimal level of the current phase, so a nested
// 29.4.1 picked 29.4's plans, and parseFloat made 29.10 and 29.1 the same phase.
describe('the guard finds the current phase at every decimal level', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => { cleanup(dir); });

  test('29.4.1 reads its own plans, not 29.4\'s; 29.10 is not 29.1', () => {
    write(dir, '.planning/phases/29.4-parent/29.4-01-plan.md', '---\nfiles_modified: [src/parent.js]\n---\n');
    write(dir, '.planning/phases/29.4.1-nested/29.4.1-01-plan.md', '---\nfiles_modified: [src/nested.js]\n---\n');
    write(dir, '.planning/state.md', '# State\n\n**Current Phase:** 29.4.1\n');
    const nested = G.declaredFiles(dir, '.planning');
    assert.ok(nested && [...(nested.files || nested)].some((f) => /nested\.js/.test(String(f))), JSON.stringify(nested && [...(nested.files || nested)]));
    assert.ok(![...(nested.files || nested)].some((f) => /parent\.js/.test(String(f))));
    write(dir, '.planning/phases/29.1-one/29.1-01-plan.md', '---\nfiles_modified: [src/one.js]\n---\n');
    write(dir, '.planning/state.md', '# State\n\n**Current Phase:** 29.10\n');
    assert.equal(G.declaredFiles(dir, '.planning'), null, 'no 29.10 directory: 29.1 is not it');
  });
});
