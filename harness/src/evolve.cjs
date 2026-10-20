#!/usr/bin/env node
'use strict';
/**
 * Guarded prompt evolution (program S4). Development only.
 *
 * One section of one judge prompt at a time, GEPA-style: the failing transcripts of the
 * training scenarios are reflected into a candidate section; the candidate is scored on
 * the training scenarios and then on held-out ones, paired against the baseline, and a
 * deletion arm (the section removed) is always run, so a section that carries no weight
 * shows as decorative. A candidate is accepted only when it is non-inferior to the
 * baseline on held-out data (Newcombe interval, δ 0.05) and no worse on training.
 * Accepted variants are ranked on a Pareto front over pass rate, cost and turns, and
 * ship as a PR a human opens.
 *
 * The guard: the evolver writes only under harness/variants/ (guardedWrite). It cannot
 * write the corpus, the scorer or the held-out split (EVALUATOR_FILES, harness/corpus,
 * harness/scenarios): a generation aborts if their digest changes while it runs.
 * Held-out scenarios and their transcripts never reach the reflection.
 *
 *   node harness/src/evolve.cjs --target agents/pan-reviewer.md#Scope            the plan
 *   node harness/src/evolve.cjs --target ... --approve-usd 10 [--generations 3]   a paid run
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nonInferiority } = require('./stats.cjs');

const ROOT = path.join(__dirname, '..', '..');
const VARIANTS = 'harness/variants';
const SPLIT = 'harness/evolve/split.json';
const EVALUATOR_FILES = Object.freeze([
  'harness/src/stats.cjs', 'harness/src/assert.cjs', 'harness/src/run.cjs', 'harness/src/scenario.cjs',
  'harness/src/evolve.cjs', 'harness/scripts/catch-rate.cjs', SPLIT,
]);
const EVALUATOR_DIRS = ['harness/corpus', 'harness/scenarios', 'harness/cassettes'];
const DEFAULT_DELTA = 0.05;

/** Write `content` at `rel`, which must resolve inside harness/variants/. */
function guardedWrite(root, rel, content, o = {}) {
  const base = path.resolve(root, VARIANTS);
  const abs = path.resolve(root, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`refused: ${rel} is outside harness/variants/ — the evolver writes nowhere else`);
  if (o.dryRun) return abs;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** A digest of everything that scores a candidate. */
function evaluatorDigest(root) {
  const h = crypto.createHash('sha256');
  const add = (rel) => { try { h.update(rel + '\0' + fs.readFileSync(path.join(root, rel))); } catch { h.update(rel + '\0-'); } };
  for (const f of EVALUATOR_FILES) add(f);
  const walk = (rel) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of entries) { const r = `${rel}/${e.name}`; if (e.isDirectory()) walk(r); else add(r); }
  };
  for (const d of EVALUATOR_DIRS) walk(d);
  return h.digest('hex');
}

function checkSplit(split) {
  const both = (split.training || []).filter((s) => (split.heldout || []).includes(s));
  if (both.length) throw new Error(`the split puts scenarios in both training and held-out: ${both.join(', ')}`);
  if (!(split.training || []).length || !(split.heldout || []).length) throw new Error('the split needs training and held-out scenarios');
  return true;
}

function removeSection(text, section) {
  const re = new RegExp(`^(#{1,4}) ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n[\\s\\S]*?(?=^#{1,4} |(?![\\s\\S]))`, 'm');
  return text.replace(re, '');
}

function rate(scores) {
  const t = Object.values(scores || {}).reduce((a, s) => ({ pass: a.pass + (s.pass || 0), n: a.n + (s.n || 0) }), { pass: 0, n: 0 });
  return { successes: t.pass, n: t.n, p: t.n ? t.pass / t.n : null };
}

/**
 * One generation. `reflect(input)` returns a candidate section (it sees the target, the
 * baseline section and the training failures, nothing else); `evaluate(arm, scenarios)`
 * returns `{scenario: {pass, n, cost?, turns?}}` for arm baseline | candidate | deletion.
 */
function runGeneration(o) {
  const root = o.root || ROOT;
  checkSplit(o.split);
  const before = evaluatorDigest(root);
  const training = new Set(o.split.training);
  const failures = (o.failures || []).filter((f) => training.has(f.scenario));
  const candidate = o.reflect({ target: o.target, baseline: o.baseline, failures });
  const scored = {};
  for (const arm of ['baseline', 'candidate', 'deletion']) scored[arm] = { training: o.evaluate(arm, o.split.training, { candidate, target: o.target }) };
  for (const arm of ['baseline', 'candidate', 'deletion']) scored[arm].heldout = o.evaluate(arm, o.split.heldout, { candidate, target: o.target });
  if (evaluatorDigest(root) !== before) return { aborted: 'evaluator_changed', reason: 'an evaluator file changed during the generation; nothing is accepted' };
  const r = (arm, split) => rate(scored[arm][split]);
  const delta = o.delta ?? DEFAULT_DELTA;
  const ni = nonInferiority(r('baseline', 'heldout'), r('candidate', 'heldout'), delta);
  const sectionMatters = r('deletion', 'heldout').p !== null && r('baseline', 'heldout').p !== null && r('deletion', 'heldout').p < r('baseline', 'heldout').p - delta;
  const result = {
    generation: o.generation || 1,
    rates: Object.fromEntries(['baseline', 'candidate', 'deletion'].map((a) => [a, { training: r(a, 'training').p, heldout: r(a, 'heldout').p }])),
    heldout_interval: { lower: ni.lower, upper: ni.upper, delta },
    section_matters: sectionMatters,
  };
  if (r('candidate', 'training').p < r('baseline', 'training').p) return { ...result, accepted: false, reason: 'training_worse' };
  if (!ni.nonInferior) return { ...result, accepted: false, reason: 'heldout_inferior' };
  const slug = String(o.target.section).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const variant = `${VARIANTS}/${path.basename(o.target.file, '.md')}.${slug}.g${result.generation}.md`;
  guardedWrite(root, variant, candidate);
  return { ...result, accepted: true, variant };
}

/** Non-dominated variants: higher pass, lower cost, fewer turns. */
function paretoFront(items) {
  const dominates = (a, b) => a.pass >= b.pass && a.cost <= b.cost && a.turns <= b.turns && (a.pass > b.pass || a.cost < b.cost || a.turns < b.turns);
  return items.filter((x) => !items.some((y) => y !== x && dominates(y, x)));
}

module.exports = { guardedWrite, evaluatorDigest, checkSplit, runGeneration, paretoFront, removeSection, EVALUATOR_FILES, VARIANTS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const [file, section] = String(val('--target') || '').split('#');
  const split = JSON.parse(fs.readFileSync(path.join(ROOT, SPLIT), 'utf8'));
  checkSplit(split);
  const plan = {
    target: { file, section }, generations: Number(val('--generations')) || 1, split,
    arms: ['baseline', 'candidate', 'deletion'], acceptance: `non-inferior to the baseline on held-out data at δ ${DEFAULT_DELTA}, no worse on training`,
    writes: `${VARIANTS}/ only`, approval: val('--approve-usd') ? `approved: $${val('--approve-usd')}` : 'required: --approve-usd <N> (reflection and scoring run a real model)',
  };
  if (!file || !section || !val('--approve-usd')) { console.log(JSON.stringify(plan, null, 2)); process.exit(file && section ? 0 : 1); }
  console.log('A paid evolution run reflects with `claude -p` and scores with `node harness/src/run.cjs --tier 1 --variant <installed path>=<variant>`; run the generations from /evolve-prompt, which keeps the owner in the loop.');
}
