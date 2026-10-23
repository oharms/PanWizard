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

describe('S4: a target must name a section that exists', () => {
  test('a section the agent does not have is refused, naming the headings it does have', () => {
    assert.throws(() => E.resolveTarget(ROOT, 'agents/pan-verifier.md#Scope'), /pan-verifier\.md has no heading "Scope"\. Its headings: .*Step 7c: Check Scope/);
    assert.throws(() => E.resolveTarget(ROOT, 'agents/pan-verifier.md'), /must be <agents\/pan-x\.md>#<Section>/);
    assert.throws(() => E.resolveTarget(ROOT, 'agents/pan-nope.md#Scope'), /does not exist/);
    assert.throws(() => E.resolveTarget(ROOT, 'harness/src/stats.cjs#x'), /not a shipped agent/);
  });

  test('the CLI exits 1 with that error and spends nothing', () => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'harness', 'src', 'evolve.cjs'), '--target', 'agents/pan-verifier.md#Scope'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /has no heading "Scope"/);
  });

  test('a unique heading prefix resolves; an ambiguous one is refused', () => {
    const t = E.resolveTarget(ROOT, 'agents/pan-reviewer.md#Scope');
    assert.equal(t.sectionTitle, 'Scope (unrequested work)');
    assert.match(t.baseline, /^## Scope \(unrequested work\)\r?\n/);
    assert.throws(() => E.resolveTarget(ROOT, 'agents/pan-plan-checker.md#Dimension 8'), /names 2 headings/);
  });

  test('a # comment inside a code fence neither starts nor ends a section', () => {
    const text = '# A\n\n## Keep\nx\n```bash\n# Import check\ngrep x\n```\ny\n## Next\nz\n';
    assert.equal(E.findSection(text, 'Import check'), null);
    assert.equal(E.findSection(text, 'Keep').text, '## Keep\nx\n```bash\n# Import check\ngrep x\n```\ny\n');
    assert.equal(E.removeSection(text, 'Keep'), '# A\n\n## Next\nz\n');
    assert.equal(E.replaceSection(text, 'Keep', '## Keep\nnew\n'), '# A\n\n## Keep\nnew\n## Next\nz\n');
  });
});

describe('S4: the split scores judges at tier 2', () => {
  const split = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'evolve', 'split.json'), 'utf8'));

  test('every split scenario exists, is tier 2 and is mapped to the judges it spawns', () => {
    const ids = [...split.training, ...split.heldout];
    assert.deepEqual(Object.keys(split.exercises).sort(), [...ids].sort(), 'exercises maps exactly the split scenarios');
    for (const id of ids) {
      const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'scenarios', `${id}.json`), 'utf8'));
      assert.equal(s.tier, E.SCORING_TIER, `${id} is tier ${s.tier}: a tier-0 scenario runs no model and cannot tell judge prompts apart`);
      assert.ok(split.exercises[id].length > 0, id);
      for (const agent of split.exercises[id]) assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${agent}.md`)), `${id}: ${agent}`);
    }
  });

  test('a judge no training or no held-out scenario spawns is refused', () => {
    assert.throws(() => E.checkCoverage(split, 'pan-design-checker'), /does not exercise pan-design-checker/);
    for (const judge of ['pan-verifier', 'pan-reviewer', 'pan-plan-checker']) assert.doesNotThrow(() => E.checkCoverage(split, judge), judge);
  });

  test('the /evolve-prompt skill scores at the tier the split runs at', () => {
    const skill = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'evolve-prompt.md'), 'utf8');
    assert.doesNotMatch(skill, /--tier 1\b/);
  });
});

describe('S4: one generation end to end, under a hard cap', () => {
  function fixture() {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evolve-e2e-'));
    dirs.push(r);
    fs.mkdirSync(path.join(r, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(r, 'harness', 'scenarios'), { recursive: true });
    fs.writeFileSync(path.join(r, 'agents', 'pan-reviewer.md'), '---\nname: pan-reviewer\n---\n# Reviewer\n\n## Scope\nRead ~/.claude/pan-wizard-core/x.md and run pan-tools review scope 1.\n\n## Verdict\nPASS\n');
    for (const id of ['t1', 'h1', 'other']) fs.writeFileSync(path.join(r, 'harness', 'scenarios', `${id}.json`), JSON.stringify({ id, tier: 2, budget: { maxUsd: 4 } }));
    return { root: r, split: { training: ['t1'], heldout: ['h1', 'other'], exercises: { t1: ['pan-reviewer'], h1: ['pan-reviewer'], other: ['pan-verifier'] } } };
  }
  function ops(root, calls, over = {}) {
    return {
      reflect: (prompt, cap) => { calls.push({ reflect: prompt, cap }); return { text: '<<<SECTION\n## Scope\nRead the diff and nothing else.\nSECTION>>>', usd: 0.3 }; },
      runArm: (a) => {
        calls.push({ ...a, content: fs.readFileSync(path.join(root, a.variantFile), 'utf8') });
        const scores = Object.fromEntries(a.scenarios.map((s) => [s, { pass: a.repeat, n: a.repeat }]));
        const failures = a.split === 'training' ? [{ scenario: 't1', step: 0, expect: 'exit:0', failure: 'T1 MISSED' }] : [{ scenario: 'h1', step: 0, expect: 'x', failure: 'H1 SECRET' }];
        return { scores, failures, usd: a.capUsd / 2 };
      },
      ...over,
    };
  }

  test('refused before any spend: no approval, a cap under the estimate, or reps that cannot accept without --smoke', () => {
    const { root, split } = fixture();
    const calls = [];
    assert.equal(E.runEvolution({ root, split, target: 'agents/pan-reviewer.md#Scope', ops: ops(root, calls) }).error, 'approval_required');
    assert.equal(E.runEvolution({ root, split, target: 'agents/pan-reviewer.md#Scope', approveUsd: 5, smoke: true, ops: ops(root, calls) }).error, 'cap_below_estimate');
    const r = E.runEvolution({ root, split, target: 'agents/pan-reviewer.md#Scope', approveUsd: 100, ops: ops(root, calls) });
    assert.equal(r.error, 'cannot_accept');
    assert.match(r.reason, /--heldout-repeat \d+/);
    assert.throws(() => E.runEvolution({ root, split, target: 'agents/pan-reviewer.md#Nope', approveUsd: 100, ops: ops(root, calls) }), /no heading "Nope"/);
    assert.equal(calls.length, 0, 'nothing ran');
  });

  test('a smoke generation runs every arm on the target\'s scenarios, within the approved dollars, and leaves only an accepted variant', () => {
    const { root, split } = fixture();
    const calls = [];
    assert.equal(E.estimate(root, { training: ['t1'], heldout: ['h1'] }, 1).expected, 3 * (2 + 2) + 1, 'three arms × (t1 + h1) at half budget, plus the reflection');
    const r = E.runEvolution({ root, split, target: 'agents/pan-reviewer.md#Scope', approveUsd: 20, smoke: true, id: 'x1', ops: ops(root, calls) });
    assert.equal(r.error, undefined, JSON.stringify(r));
    const runs = calls.filter((c) => c.arm);
    assert.deepEqual(runs.map((c) => `${c.arm}/${c.split}`).sort(), ['baseline/heldout', 'baseline/training', 'candidate/heldout', 'candidate/training', 'deletion/heldout', 'deletion/training'], 'the baseline training run is reused, not repeated');
    for (const c of runs) {
      assert.deepEqual(c.scenarios, c.split === 'training' ? ['t1'] : ['h1'], 'only the scenarios that spawn the target');
      assert.equal(c.installedPath, '.claude/agents/pan-reviewer.md');
      assert.match(c.variantFile, /^harness\/variants\/\.evolve-x1\//);
      assert.doesNotMatch(c.content, /~\/\.claude\//, 'the arm is in installed form');
    }
    assert.match(runs.find((c) => c.arm === 'baseline').content, /node \.\/\.claude\/pan-wizard-core\/bin\/pan-tools\.cjs review/, 'paths rewritten as a local Claude install writes them');
    assert.match(runs.find((c) => c.arm === 'candidate').content, /Read the diff and nothing else/);
    assert.doesNotMatch(runs.find((c) => c.arm === 'deletion').content, /## Scope/);
    assert.match(runs.find((c) => c.arm === 'deletion').content, /## Verdict/);
    const reflect = calls.find((c) => c.reflect);
    assert.match(reflect.reflect, /T1 MISSED/);
    assert.doesNotMatch(reflect.reflect, /H1 SECRET/, 'held-out failures never reach the reflection');
    assert.ok(r.caps.total <= 20, `caps add up to ${r.caps.total}`);
    assert.ok(r.spent_usd <= 20, String(r.spent_usd));
    assert.equal(r.smoke, true);
    assert.equal(fs.existsSync(path.join(root, 'harness', 'variants', '.evolve-x1')), false, 'arm files are deleted');
    assert.equal(r.accepted, false, 'one rep per arm cannot show non-inferiority');
  });

  test('a reflection that loses the section heading stops the generation before the candidate arms run', () => {
    const { root, split } = fixture();
    const calls = [];
    const r = E.runEvolution({ root, split, target: 'agents/pan-reviewer.md#Scope', approveUsd: 20, smoke: true, ops: ops(root, calls, { reflect: () => ({ text: 'sure! here it is', usd: 0.2 }) }) });
    assert.equal(r.error, 'reflection_failed');
    assert.equal(calls.filter((c) => c.arm).length, 1, 'only the baseline training run spent');
  });

  test('acceptance needs dozens of held-out reps per arm at δ 0.05, and the estimate says so', () => {
    const n = E.minAcceptReps(0.05);
    assert.ok(n > 50 && n < 100, String(n));
    const est = E.estimate(ROOT, { training: ['plan-phase-checker-loop'], heldout: ['pair-discounts-live'] }, 1);
    assert.equal(est.acceptance_possible, false);
    assert.equal(est.deciding.heldout_repeat, n);
  });
});
