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
