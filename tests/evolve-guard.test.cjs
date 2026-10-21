/**
 * Program S4: guarded prompt evolution.
 *
 * harness/src/evolve.cjs evolves one section of one judge prompt at a time (GEPA-style):
 * failing training transcripts are reflected into a candidate, the candidate is scored on
 * the training scenarios, then on held-out ones, paired against the baseline, with a
 * deletion arm (the section removed) always run, and the survivors ranked on a Pareto
 * front over pass rate, cost and turns.
 *
 * The guard is the point: the evolver writes only under harness/variants/. It cannot
 * write the corpus, the scorer or the held-out split, held-out data never reaches the
 * reflection, and a generation aborts if any evaluator file changed while it ran.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const E = require('../harness/src/evolve.cjs');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('S4: the evaluator is out of the evolver\'s reach', () => {
  test('the evolver writes only under harness/variants/', () => {
    for (const p of ['harness/corpus/case-1/clean.js', 'harness/src/stats.cjs', 'harness/src/assert.cjs', 'harness/src/evolve.cjs', 'harness/evolve/split.json', 'harness/scenarios/quick-mode.json', 'tests/evolve-guard.test.cjs', 'scripts/prompt-lint.cjs', 'agents/pan-reviewer.md', '../outside.md', 'harness/variants/../src/run.cjs']) {
      assert.throws(() => E.guardedWrite(ROOT, p, 'x', { dryRun: true }), /outside harness\/variants/, p);
    }
    assert.doesNotThrow(() => E.guardedWrite(ROOT, 'harness/variants/pan-reviewer.g1.md', 'x', { dryRun: true }));
  });

  test('a generation aborts when an evaluator file changes while it runs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evolve-'));
    dirs.push(root);
    for (const f of E.EVALUATOR_FILES) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), `${f}\n`);
    }
    fs.mkdirSync(path.join(root, 'harness', 'variants'), { recursive: true });
    const r = E.runGeneration({
      root, target: { file: 'agents/pan-reviewer.md', section: 'Scope' }, baseline: '## Scope\nold\n', split: { training: ['t1'], heldout: ['h1'] },
      reflect: () => '## Scope\nnew\n',
      evaluate: () => { fs.appendFileSync(path.join(root, 'harness/src/stats.cjs'), 'tampered\n'); return { t1: { pass: 1, n: 1 } }; },
    });
    assert.equal(r.aborted, 'evaluator_changed');
  });

  test('the held-out split is disjoint from training, and never reaches the reflection', () => {
    assert.throws(() => E.checkSplit({ training: ['a', 'b'], heldout: ['b', 'c'] }), /both training and held-out: b/);
    const seen = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evolve-'));
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'harness', 'variants'), { recursive: true });
    E.runGeneration({
      root, target: { file: 'agents/pan-reviewer.md', section: 'Scope' }, baseline: '## Scope\nold\n', split: { training: ['t1'], heldout: ['h1'] },
      failures: [{ scenario: 't1', transcript: 'T1 FAIL' }, { scenario: 'h1', transcript: 'H1 FAIL' }],
      reflect: (input) => { seen.push(input); return '## Scope\nnew\n'; },
      evaluate: (arm, scenarios) => Object.fromEntries(scenarios.map((s) => [s, { pass: 1, n: 1 }])),
    });
    assert.equal(seen.length, 1);
    assert.ok(seen[0].failures.every((f) => f.scenario === 't1'), 'only training transcripts');
    assert.doesNotMatch(JSON.stringify(seen[0]), /H1 FAIL|h1/);
  });

  test('the repository\'s split file is disjoint and the scorer files exist', () => {
    const split = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'evolve', 'split.json'), 'utf8'));
    assert.doesNotThrow(() => E.checkSplit(split));
    for (const f of E.EVALUATOR_FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  });
});

describe('S4: one generation', () => {
  function root() {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evolve-'));
    dirs.push(r);
    fs.mkdirSync(path.join(r, 'harness', 'variants'), { recursive: true });
    return r;
  }
  const scores = (table) => (arm, scenarios) => Object.fromEntries(scenarios.map((s) => [s, table[arm][s]]));

  test('every generation runs baseline, candidate and the deletion arm', () => {
    const arms = new Set();
    E.runGeneration({
      root: root(), target: { file: 'agents/pan-reviewer.md', section: 'Scope' }, baseline: '## Scope\nold\n', split: { training: ['t1'], heldout: ['h1'] },
      reflect: () => '## Scope\nnew\n', evaluate: (arm, sc) => { arms.add(arm); return Object.fromEntries(sc.map((s) => [s, { pass: 1, n: 1 }])); },
    });
    assert.deepEqual([...arms].sort(), ['baseline', 'candidate', 'deletion']);
  });

  test('a candidate that is non-inferior on held-out data at δ 0.05 is accepted and written as a variant', () => {
    const r0 = root();
    const r = E.runGeneration({
      root: r0, target: { file: 'agents/pan-reviewer.md', section: 'Scope' }, baseline: '## Scope\nold\n', split: { training: ['t1'], heldout: ['h1'] }, generation: 3,
      reflect: () => '## Scope\nnew\n',
      evaluate: scores({
        baseline: { t1: { pass: 10, n: 20 }, h1: { pass: 18, n: 20 } },
        candidate: { t1: { pass: 16, n: 20 }, h1: { pass: 40, n: 40 } },
        deletion: { t1: { pass: 9, n: 20 }, h1: { pass: 12, n: 20 } },
      }),
    });
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.equal(r.variant, 'harness/variants/pan-reviewer.scope.g3.md');
    assert.equal(fs.readFileSync(path.join(r0, r.variant), 'utf8'), '## Scope\nnew\n');
    assert.equal(r.section_matters, true, 'the deletion arm did worse: the section carries weight');
  });

  test('a candidate worse on held-out data is refused, whatever it did on training', () => {
    const r = E.runGeneration({
      root: root(), target: { file: 'agents/pan-reviewer.md', section: 'Scope' }, baseline: '## Scope\nold\n', split: { training: ['t1'], heldout: ['h1'] },
      reflect: () => '## Scope\nnew\n',
      evaluate: scores({
        baseline: { t1: { pass: 10, n: 20 }, h1: { pass: 19, n: 20 } },
        candidate: { t1: { pass: 20, n: 20 }, h1: { pass: 10, n: 20 } },
        deletion: { t1: { pass: 10, n: 20 }, h1: { pass: 19, n: 20 } },
      }),
    });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, 'heldout_inferior');
    assert.equal(r.section_matters, false, 'deleting the section changed nothing: it is decorative');
  });

  test('the Pareto front keeps the non-dominated variants over pass rate, cost and turns', () => {
    const front = E.paretoFront([
      { id: 'a', pass: 0.9, cost: 1.0, turns: 10 },
      { id: 'b', pass: 0.8, cost: 0.5, turns: 10 },
      { id: 'c', pass: 0.8, cost: 1.2, turns: 12 },
      { id: 'd', pass: 0.95, cost: 2.0, turns: 9 },
    ]);
    assert.deepEqual(front.map((x) => x.id).sort(), ['a', 'b', 'd']);
  });
});

describe('S4: the harness runs a variant arm', () => {
  test('--variant takes a workspace path and a file under harness/variants/ only', () => {
    const { parseArgs, variantArm } = require('../harness/src/run.cjs');
    assert.deepEqual(parseArgs(['--variant', '.claude/agents/pan-reviewer.md=harness/variants/x.md']).variant, { path: '.claude/agents/pan-reviewer.md', file: 'harness/variants/x.md' });
    assert.throws(() => variantArm(ROOT, { path: '.claude/agents/x.md', file: 'harness/src/stats.cjs' }), /harness\/variants/);
  });
});
