#!/usr/bin/env node
'use strict';
/**
 * Guarded prompt evolution (program S4). Development only.
 *
 * One section of one judge prompt at a time, GEPA-style: the failing steps of the
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
 * Held-out scenarios and their failures never reach the reflection.
 *
 * One generation end to end (runEvolution): the baseline arm on training → reflect the
 * failures into a candidate section (`claude -p`, capped) → the three arms written as
 * whole installed-form agent files under harness/variants/.evolve-<id>/ → each arm run
 * through `run.cjs --tier 2 --variant .claude/agents/<agent>.md=<file>` on training and
 * on held-out → runGeneration decides. Every spend has its own cap (each run.cjs call
 * gets --max-usd, the reflection --max-budget-usd), and the caps add up to no more than
 * --approve-usd: that sum is the hard ceiling. The arm files and the run state are
 * deleted afterwards; an accepted section stays as harness/variants/<agent>.<slug>.g<N>.md.
 *
 *   node harness/src/evolve.cjs --target agents/pan-reviewer.md#Scope            plan + cost estimate
 *   node harness/src/evolve.cjs --target ... --run --approve-usd N [--repeat R] [--heldout-repeat H] [--smoke]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
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
// The tier the split's scenarios run at: run.cjs selects scenarios with tier <= --tier.
const SCORING_TIER = 2;
// The reflection is one `claude -p` call with no tools; this is its cap.
const REFLECT_USD = 1;
// Measured mean cost of one PAN rep, where a paid run measured it. pair-discounts-live:
// H10 hard pair 2026-10-21 (run-20261021-201032-Nfyojl), five PAN reps $1.49–$3.67.
// Unmeasured scenarios are estimated at half their budget.maxUsd (that run's ratio was 0.47).
const MEASURED_USD = Object.freeze({ 'pair-discounts-live': 2.82 });

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

/** The Markdown headings outside code fences: [{line, level, title}]. */
function headings(text) {
  const out = [];
  let fence = null;
  text.split('\n').forEach((raw, line) => {
    const l = raw.replace(/\r$/, '');
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (fence) return;
    const m = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ line, level: m[1].length, title: m[2] });
  });
  return out;
}

/**
 * Find the section a target names: the heading whose title is `section`, else the one
 * heading whose title starts with it at a word boundary ("Scope" finds "Scope (unrequested
 * work)"). The section runs to the next heading of the same or a higher level, outside
 * code fences. Returns null when absent; throws when the name is ambiguous.
 */
function findSection(text, section) {
  const hs = headings(text);
  const want = String(section || '').trim();
  if (!want) return null;
  let hits = hs.filter((h) => h.title === want);
  if (!hits.length) {
    const esc = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    hits = hs.filter((h) => new RegExp(`^${esc}(?![\\w-])`).test(h.title));
  }
  if (!hits.length) return null;
  if (hits.length > 1) throw new Error(`"${want}" names ${hits.length} headings (${hits.map((h) => `line ${h.line + 1}: ${h.title}`).join('; ')}); name one exactly`);
  const h = hits[0];
  const next = hs.find((x) => x.line > h.line && x.level <= h.level);
  const lines = text.split('\n');
  const end = next ? next.line : lines.length;
  return { level: h.level, title: h.title, startLine: h.line, endLine: end, text: lines.slice(h.line, end).join('\n') + (next ? '\n' : '') };
}

function splice(text, sec, insert) {
  const lines = text.split('\n');
  const before = lines.slice(0, sec.startLine).join('\n');
  const after = lines.slice(sec.endLine).join('\n');
  return (sec.startLine ? before + '\n' : '') + insert + after;
}

/** The text without the named section (unchanged when it is absent). */
function removeSection(text, section) {
  const sec = findSection(text, section);
  return sec ? splice(text, sec, '') : text;
}

/** The text with the named section replaced by `body` (which carries its own heading). */
function replaceSection(text, section, body) {
  const sec = findSection(text, section);
  if (!sec) throw new Error(`no section "${section}" to replace`);
  return splice(text, sec, body.endsWith('\n') ? body : body + '\n');
}

/**
 * Resolve `agents/<agent>.md#<Section>` against the repository, or throw a clear error:
 * a target whose section does not exist would score a deletion arm identical to the
 * baseline and a candidate spliced nowhere, and spend money proving nothing.
 */
function resolveTarget(root, spec) {
  const s = String(spec || '');
  const hash = s.indexOf('#');
  if (hash < 1 || hash === s.length - 1) throw new Error(`--target must be <agents/pan-x.md>#<Section>, got "${s}"`);
  const file = s.slice(0, hash).replace(/\\/g, '/');
  const section = s.slice(hash + 1).trim();
  if (!/^agents\/pan-[a-z0-9-]+\.md$/.test(file)) throw new Error(`--target: ${file} is not a shipped agent (agents/pan-*.md)`);
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { throw new Error(`--target: ${file} does not exist`); }
  const sec = findSection(text, section);
  if (!sec) {
    const list = headings(text).filter((h) => h.level <= 3).map((h) => h.title);
    throw new Error(`--target: ${file} has no heading "${section}". Its headings: ${list.length ? list.join(' | ') : '(none)'}`);
  }
  return { file, section, agent: path.basename(file, '.md'), text, sectionTitle: sec.title, baseline: sec.text };
}

/**
 * The split must exercise the target: at least one training and one held-out scenario
 * that spawns the agent (split.exercises). Otherwise every arm scores the same.
 */
function checkCoverage(split, agent) {
  const ex = split.exercises || {};
  const hit = (ids) => ids.filter((id) => (ex[id] || []).includes(agent));
  const tr = hit(split.training || []);
  const ho = hit(split.heldout || []);
  if (!tr.length || !ho.length) {
    throw new Error(`the split does not exercise ${agent}: ${tr.length} training and ${ho.length} held-out scenarios spawn it (harness/evolve/split.json "exercises"); a prompt no scenario runs cannot be scored`);
  }
  return { training: tr, heldout: ho };
}

/** An agent's source text as a local Claude install writes it (bin/install.js agent copy). */
function toInstalled(content) {
  const prefix = './.claude/';
  return content.replace(/~\/\.claude\//g, prefix).replace(/\bpan-tools\b(?=\s+[a-z])/g, `node ${prefix}pan-wizard-core/bin/pan-tools.cjs`);
}

function rate(scores) {
  const t = Object.values(scores || {}).reduce((a, s) => ({ pass: a.pass + (s.pass || 0), n: a.n + (s.n || 0) }), { pass: 0, n: 0 });
  return { successes: t.pass, n: t.n, p: t.n ? t.pass / t.n : null };
}

/** The fewest held-out reps per arm at which even two perfect arms are non-inferior at δ. */
function minAcceptReps(delta = DEFAULT_DELTA) {
  for (let n = 1; n <= 2000; n++) if (nonInferiority({ successes: n, n }, { successes: n, n }, delta).nonInferior) return n;
  return Infinity;
}

function loadScenario(root, id) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'harness', 'scenarios', `${id}.json`), 'utf8')); } catch { return null; }
}

/**
 * What one generation costs at `repeat` reps per scenario per arm: three arms over every
 * training and held-out scenario (the baseline's training run doubles as the reflection's
 * input), plus the reflection. expected = measured or half the budget; ceiling = budget.
 * `heldoutRepeat` (default `repeat`) sets the held-out reps apart: acceptance is decided
 * there, so that is where the reps are needed.
 */
function estimate(root, split, repeat = 1, delta = DEFAULT_DELTA, heldoutRepeat = repeat) {
  const per = {};
  for (const id of [...split.training, ...split.heldout]) {
    const s = loadScenario(root, id);
    const ceiling = (s && s.budget && s.budget.maxUsd) || 0;
    per[id] = { tier: s ? s.tier : null, expected: MEASURED_USD[id] ?? ceiling / 2, ceiling };
  }
  const sum = (ids, k, r) => ids.reduce((a, id) => a + per[id][k], 0) * r;
  const arm = { training: { expected: sum(split.training, 'expected', repeat), ceiling: sum(split.training, 'ceiling', repeat) }, heldout: { expected: sum(split.heldout, 'expected', heldoutRepeat), ceiling: sum(split.heldout, 'ceiling', heldoutRepeat) } };
  const need = minAcceptReps(delta);
  const heldoutReps = heldoutRepeat * split.heldout.length;
  const decidingRepeat = Math.ceil(need / split.heldout.length);
  const at = (hr) => 3 * (sum(split.training, 'expected', repeat) + sum(split.heldout, 'expected', hr)) + REFLECT_USD;
  return {
    repeat, heldout_repeat: heldoutRepeat, per, arm, reflect: REFLECT_USD,
    expected: +(3 * (arm.training.expected + arm.heldout.expected) + REFLECT_USD).toFixed(2),
    ceiling: +(3 * (arm.training.ceiling + arm.heldout.ceiling) + REFLECT_USD).toFixed(2),
    heldout_reps_per_arm: heldoutReps,
    min_heldout_reps_to_accept: need,
    acceptance_possible: heldoutReps >= need,
    deciding: { heldout_repeat: decidingRepeat, expected: +at(decidingRepeat).toFixed(2), note: `--heldout-repeat ${decidingRepeat}: the fewest held-out reps at which two arms that pass every one are non-inferior at δ ${delta}; any failure needs more` },
  };
}

/**
 * Split the approved dollars into one cap per spend: the reflection, then each arm × split
 * run in proportion to its expected cost. The caps never add up to more than approveUsd.
 */
function allocateCaps(approveUsd, est) {
  const runs = [];
  for (const arm of ['baseline', 'candidate', 'deletion']) for (const split of ['training', 'heldout']) runs.push({ arm, split, expected: est.arm[split].expected });
  const pool = approveUsd - est.reflect;
  const total = runs.reduce((a, r) => a + r.expected, 0);
  const floor2 = (x) => Math.floor(x * 100) / 100;
  for (const r of runs) r.cap = floor2(total ? (pool * r.expected) / total : 0);
  return { reflect: est.reflect, runs, total: +(est.reflect + runs.reduce((a, r) => a + r.cap, 0)).toFixed(2) };
}

/**
 * One generation. `reflect(input)` returns a candidate section (it sees the target, the
 * baseline section and the training failures, nothing else); `evaluate(arm, scenarios)`
 * returns `{scenario: {pass, n, cost?, turns?}}` for arm baseline | candidate | deletion.
 */
function runGeneration(o) {
  const root = o.root || ROOT;
  checkSplit(o.split);
  const before = o.before || evaluatorDigest(root);
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
    rates: Object.fromEntries(['baseline', 'candidate', 'deletion'].map((a) => [a, { training: r(a, 'training').p, heldout: r(a, 'heldout').p, heldout_n: r(a, 'heldout').n }])),
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

// ─── One generation, end to end ──────────────────────────────────────────────

/** The reflection prompt: the target section and the training failures, nothing held out. */
function reflectionPrompt(input) {
  const fails = input.failures.length
    ? input.failures.map((f) => `- ${f.scenario} step ${f.step}: expected ${f.expect}; got ${String(f.failure || '').slice(0, 600)}`).join('\n')
    : '- (no training step failed; tighten only what the section leaves ambiguous)';
  return [
    `You are improving one section of a PAN judge prompt (${input.target.file}). Training scenarios that run this judge failed as follows:`,
    '', fails, '',
    'The current section, verbatim:', '', '<<<SECTION', input.baseline.trimEnd(), 'SECTION>>>', '',
    `Write the smallest change to this section that would have caught what was missed. Keep its heading line exactly as it is ("${input.baseline.split('\n')[0]}"). Reply with the whole new section only, between <<<SECTION and SECTION>>>, nothing else.`,
  ].join('\n');
}

function parseReflection(text, headingLine) {
  const m = String(text || '').match(/<<<SECTION\r?\n([\s\S]*?)\r?\nSECTION>>>/);
  if (!m) return null;
  const body = m[1].replace(/\r\n/g, '\n');
  return body.split('\n')[0].trim() === headingLine.trim() ? body + '\n' : null;
}

function defaultEvolveOps(root) {
  return {
    reflect: (prompt, capUsd) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evolve-reflect-'));
      try {
        const r = spawnSync('claude', ['-p', '--output-format', 'json', '--max-budget-usd', String(capUsd)], { cwd, input: prompt, encoding: 'utf8', shell: process.platform === 'win32', timeout: 20 * 60 * 1000 });
        let j = {};
        try { j = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch {}
        return { text: j.result || '', usd: Number(j.total_cost_usd) || 0, error: r.status === 0 ? null : String(r.stderr || '').slice(-400) };
      } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
    },
    runArm: ({ scenarios, repeat, capUsd, installedPath, variantFile }) => {
      const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-evolve-run-'));
      try {
        const args = [path.join(root, 'harness', 'src', 'run.cjs'), '--tier', String(SCORING_TIER), ...scenarios.flatMap((s) => ['--scenario', s]),
          '--repeat', String(repeat), '--max-usd', String(capUsd), '--no-ledger', '--state-dir', state, '--variant', `${installedPath}=${variantFile}`];
        spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 12 * 60 * 60 * 1000 });
        const dir = fs.readdirSync(state).find((d) => fs.existsSync(path.join(state, d, 'report.json')));
        if (!dir) return { error: 'no report.json from run.cjs', scores: {}, failures: [], usd: 0 };
        return readReport(JSON.parse(fs.readFileSync(path.join(state, dir, 'report.json'), 'utf8')));
      } finally { fs.rmSync(state, { recursive: true, force: true }); }
    },
  };
}

/** Counts per scenario from a run.cjs report: passed and failed reps only (a budget stop is no verdict). */
function readReport(rep) {
  const scores = {};
  let excluded = 0;
  for (const c of rep.completion || []) {
    scores[c.scenario] = { pass: c.passed || 0, n: (c.passed || 0) + (c.failed || 0) };
    excluded += (c.budget || 0) + (c.skipped || 0) + (c.error || 0);
  }
  return { scores, failures: rep.failures || [], usd: Number(rep.spentUsd) || 0, excluded };
}

/**
 * One generation, end to end, under a hard cap. `ops` replaces the reflection and the
 * harness runs (the tests pass stand-ins). Refuses before spending anything when the
 * target, the split or the approval is wrong.
 */
function runEvolution(o) {
  const root = o.root || ROOT;
  const full = o.split || JSON.parse(fs.readFileSync(path.join(root, SPLIT), 'utf8'));
  checkSplit(full);
  const target = resolveTarget(root, o.target);
  // Only the scenarios that spawn the target are run: the others would score every arm alike.
  const split = checkCoverage(full, target.agent);
  const repeat = Math.max(1, Number(o.repeat) || 1);
  const heldoutRepeat = Math.max(1, Number(o.heldoutRepeat) || repeat);
  const est = estimate(root, split, repeat, o.delta ?? DEFAULT_DELTA, heldoutRepeat);
  const approve = Number(o.approveUsd);
  if (!(approve > 0)) return { error: 'approval_required', reason: 'a generation runs a real model: pass --approve-usd <N> for this run', estimate: est };
  if (approve < est.expected) return { error: 'cap_below_estimate', reason: `one generation at --repeat ${repeat} is expected to cost $${est.expected} (ceiling $${est.ceiling}); $${approve} would stop arms on budget and decide nothing`, estimate: est };
  if (!est.acceptance_possible && !o.smoke) return { error: 'cannot_accept', reason: `${est.heldout_reps_per_arm} held-out reps per arm cannot show non-inferiority at δ ${o.delta ?? DEFAULT_DELTA} (needs at least ${est.min_heldout_reps_to_accept}: --heldout-repeat ${est.deciding.heldout_repeat}, about $${est.deciding.expected}). Pass --smoke to run the pipeline anyway, knowing it cannot accept`, estimate: est };
  const caps = allocateCaps(approve, est);
  const ops = { ...defaultEvolveOps(root), ...(o.ops || {}) };
  const id = o.id || `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
  const dir = `${VARIANTS}/.evolve-${id}`;
  const installedPath = `.claude/agents/${target.agent}.md`;
  const slug = target.sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const armFile = (arm, content) => { const rel = `${dir}/${target.agent}.${slug}.${arm}.md`; guardedWrite(root, rel, toInstalled(content)); return rel; };
  const capFor = (arm, sp) => caps.runs.find((r) => r.arm === arm && r.split === sp).cap;
  const before = evaluatorDigest(root);
  let spent = 0;
  const excluded = {};
  const files = {};
  const runs = [];
  const run = (arm, sp) => {
    const r = ops.runArm({ arm, split: sp, scenarios: split[sp], repeat: sp === 'heldout' ? heldoutRepeat : repeat, capUsd: capFor(arm, sp), installedPath, variantFile: files[arm] });
    spent += r.usd || 0;
    excluded[`${arm}/${sp}`] = r.excluded || 0;
    runs.push({ arm, split: sp, cap: capFor(arm, sp), usd: r.usd || 0, error: r.error || null });
    return r;
  };
  try {
    files.baseline = armFile('baseline', target.text);
    files.deletion = armFile('deletion', removeSection(target.text, target.section));
    const baseTrain = run('baseline', 'training');
    let reflectErr = null;
    const result = runGeneration({
      root, split, before, target: { file: target.file, section: target.section }, baseline: target.baseline, generation: o.generation || 1, delta: o.delta,
      failures: baseTrain.failures,
      reflect: (input) => {
        const r = ops.reflect(reflectionPrompt(input), caps.reflect);
        spent += r.usd || 0;
        const body = parseReflection(r.text, target.baseline.split('\n')[0]);
        if (!body) { reflectErr = r.error || 'the reflection returned no section with the original heading'; return target.baseline; }
        return body;
      },
      evaluate: (arm, scenarios, ctx) => {
        if (reflectErr) return {};
        if (arm === 'candidate' && !files.candidate) files.candidate = armFile('candidate', replaceSection(target.text, target.section, ctx.candidate));
        const sp = scenarios === split.training ? 'training' : 'heldout';
        if (arm === 'baseline' && sp === 'training') return baseTrain.scores;
        return run(arm, sp).scores;
      },
    });
    if (reflectErr) return { error: 'reflection_failed', reason: reflectErr, spent_usd: +spent.toFixed(2), caps, runs };
    const undecided = Object.values(excluded).some((n) => n > 0);
    return { ...result, ...(undecided && result.accepted ? { accepted: false, reason: 'reps_stopped_without_verdict' } : {}), smoke: !est.acceptance_possible, spent_usd: +spent.toFixed(2), approved_usd: approve, caps, runs, excluded };
  } finally {
    fs.rmSync(path.join(root, dir), { recursive: true, force: true });
  }
}

module.exports = { guardedWrite, evaluatorDigest, checkSplit, runGeneration, runEvolution, paretoFront, removeSection, replaceSection, findSection, headings, resolveTarget, checkCoverage, toInstalled, estimate, allocateCaps, minAcceptReps, readReport, reflectionPrompt, parseReflection, EVALUATOR_FILES, VARIANTS, SCORING_TIER };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    const split = JSON.parse(fs.readFileSync(path.join(ROOT, SPLIT), 'utf8'));
    checkSplit(split);
    const target = resolveTarget(ROOT, val('--target'));
    const coverage = checkCoverage(split, target.agent);
    const repeat = Math.max(1, Number(val('--repeat')) || 1);
    const heldoutRepeat = Math.max(1, Number(val('--heldout-repeat')) || repeat);
    const est = estimate(ROOT, coverage, repeat, DEFAULT_DELTA, heldoutRepeat);
    if (!argv.includes('--run')) {
      console.log(JSON.stringify({
        target: { file: target.file, section: target.sectionTitle }, scenarios: coverage, why: 'only the split scenarios that spawn the target run (harness/evolve/split.json exercises)', scoring: `node harness/src/run.cjs --tier ${SCORING_TIER} --variant .claude/agents/${target.agent}.md=<arm file>`,
        arms: ['baseline', 'candidate', 'deletion'], acceptance: `non-inferior to the baseline on held-out data at δ ${DEFAULT_DELTA}, no worse on training`,
        writes: `${VARIANTS}/ only`, estimate: est,
        run: `node harness/src/evolve.cjs --target ${target.file}#${target.section} --run --approve-usd <N ≥ ${est.expected}> --repeat ${repeat} --heldout-repeat ${heldoutRepeat}${est.acceptance_possible ? '' : ' --smoke'}`,
      }, null, 2));
      process.exit(0);
    }
    const r = runEvolution({ target: val('--target'), approveUsd: val('--approve-usd'), repeat, heldoutRepeat, smoke: argv.includes('--smoke'), generation: Number(val('--generation')) || 1 });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.error ? 1 : 0);
  } catch (e) {
    console.error(`evolve: ${e.message}`);
    process.exit(1);
  }
}
