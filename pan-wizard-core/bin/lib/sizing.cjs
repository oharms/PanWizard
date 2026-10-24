'use strict';
/**
 * Right-sized ceremony: decide in code how much process a piece of work gets.
 *
 * Measured 2026-10-24 (docs/specs/right-sized-ceremony.md): on precisely specified work
 * PAN spent about 70% of its cost and time on planning ceremony (research, a planner and
 * a plan-checker revising each other three or four times), all of it on the launch model,
 * against a bare host that finished the same tasks correctly for about a thirtieth of the
 * cost. A small, well-specified piece of work does not need that: the spec is the plan.
 *
 *   lean  the executor works from the spec; the engine's deterministic plan checks and
 *         test gate check it; an LLM checker or verifier runs only when those cannot decide
 *   full  today's path: research, planner, plan-checker loop, verifier, reviewers
 *
 * The mode: `full` everywhere when the profile is `quality` (the old behaviour, chosen at
 * new-project or settings), when `workflow.ceremony` is `full`, or when a run passes
 * `--quality`; otherwise `auto`, which sizes each piece of work. Pure apart from reads.
 */

const fs = require('fs');
const { loadConfig } = require('./core.cjs');
const { roadmapRequirementIds } = require('./roadmap.cjs');
const { ROADMAP_FILE, REQUIREMENTS_FILE } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

const DEFAULT_LEAN_MAX_REQUIREMENTS = 5;

// loadConfig flattens the workflow section away; the ceremony keys are read from the raw file.
function ceremonyConfig(cwd) {
  const workflow = require('./test-gate.cjs').rawConfig(cwd).workflow || {};
  return { ...loadConfig(cwd), workflow };
}

/** 'full' or 'auto' for this project and run. `config`: ceremonyConfig's. */
function ceremonyMode(config, opts = {}) {
  if (opts.quality) return { mode: 'full', why: '--quality was passed for this run' };
  const wf = (config && config.workflow) || {};
  if (wf.ceremony === 'full') return { mode: 'full', why: 'workflow.ceremony is full' };
  if (config && config.model_profile === 'quality') return { mode: 'full', why: 'the quality profile keeps the full ceremony' };
  return { mode: 'auto', why: null };
}

const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
// A concrete artifact: a backticked token, a file with an extension, or a call `name(`.
const ARTIFACT = /`[^`\n]+`|\b[\w./-]+\.(?:c?js|mjs|tsx?|jsx|py|json|md|go|rs|java|rb|cs|php|sh|ya?ml|toml|sql|html|css)\b|\b[a-zA-Z_][\w]*\([^)\n]*\)/;

/** Whether a requirement says precisely what to build. Pure. */
function requirementSpecified(req) {
  if (req && Array.isArray(req.criteria) && req.criteria.length) return true;
  const t = String((req && req.text) || '');
  return ARTIFACT.test(t) && words(t) >= 12;
}

/** Whether a quick task's description says precisely what to build. Pure. */
function taskSpecified(text) {
  const t = String(text || '');
  const reasons = [];
  if (!ARTIFACT.test(t)) reasons.push('names no file, function or other concrete artifact');
  if (words(t) < 15) reasons.push('is too short to specify the work (under 15 words)');
  return { specified: reasons.length === 0, reasons };
}

/** The ceremony for a quick task. */
function sizeTask(cwd, text, opts = {}) {
  const config = ceremonyConfig(cwd);
  const m = ceremonyMode(config, opts);
  if (m.mode === 'full') return { path: 'full', mode: m.mode, reasons: [m.why] };
  if (opts.full) return { path: 'full', mode: m.mode, reasons: ['--full was passed'] };
  const s = taskSpecified(text);
  return s.specified
    ? { path: 'lean', mode: m.mode, reasons: ['the description names what to build and how to check it'] }
    : { path: 'full', mode: m.mode, reasons: s.reasons.map((r) => `the description ${r}`) };
}

/** The ceremony for a roadmap phase. */
function sizePhase(cwd, phase, opts = {}) {
  const config = ceremonyConfig(cwd);
  const m = ceremonyMode(config, opts);
  const max = Number(((config && config.workflow) || {}).lean_max_requirements) || DEFAULT_LEAN_MAX_REQUIREMENTS;
  let roadmap = '';
  let reqText = '';
  try { roadmap = fs.readFileSync(planningPath(cwd, ROADMAP_FILE), 'utf8'); } catch { /* no roadmap */ }
  try { reqText = fs.readFileSync(planningPath(cwd, REQUIREMENTS_FILE), 'utf8'); } catch { /* no requirements */ }
  const ids = roadmapRequirementIds(roadmap, String(phase));
  const all = require('./requirements-lint.cjs').parseRequirements(reqText);
  const byId = new Map(all.map((r) => [String(r.id).toUpperCase(), r]));
  const reqs = ids.map((id) => byId.get(String(id).toUpperCase()) || { id, text: '', criteria: [] });
  const unspecified = reqs.filter((r) => !requirementSpecified(r)).map((r) => r.id);
  const metrics = { requirements: reqs.length, unspecified, lean_max_requirements: max };
  if (m.mode === 'full') return { phase: String(phase), path: 'full', mode: m.mode, reasons: [m.why], metrics };
  if (opts.full) return { phase: String(phase), path: 'full', mode: m.mode, reasons: ['--full was passed'], metrics };
  const reasons = [];
  if (!reqs.length) reasons.push('the roadmap maps no requirements to this phase, so nothing pins down the work');
  if (reqs.length > max) reasons.push(`${reqs.length} requirements is above workflow.lean_max_requirements (${max})`);
  if (unspecified.length) reasons.push(`not precisely specified: ${unspecified.join(', ')} (no acceptance criterion and no named artifact)`);
  return reasons.length
    ? { phase: String(phase), path: 'full', mode: m.mode, reasons, metrics }
    : { phase: String(phase), path: 'lean', mode: m.mode, reasons: [`${reqs.length} requirement(s), each naming what to build`], metrics };
}

/**
 * The lean path's plan check, in code: the plan set (requirement coverage, waves,
 * dependencies), every plan's structure, and the plans' own grep gates. When all pass it
 * records a plan-check verdict from the engine, bound to the plans' hash like the
 * plan-checker agent's, so exec-phase's plan-check gate holds. When any fails, nothing is
 * recorded and the workflow falls back to the plan-checker agent.
 */
function engineCheckPlans(cwd, phase) {
  const VPS = require('./verify-plan-set.cjs');
  const set = VPS.checkPlanSet(cwd, phase);
  if (set.error) return { ok: false, error: set.error, reason: set.reason };
  const pf = VPS.phaseFiles(cwd, phase);
  const { planStructure } = require('./verify.cjs');
  const path = require('path');
  const structure = pf.planFiles.map((f) => ({ plan: f, ...planStructure(fs.readFileSync(path.join(pf.dir, f), 'utf8')) }));
  const gates = require('./plan-lint.cjs').checkGates(cwd, phase);
  const errors = [
    ...(set.errors || []).map((e) => (typeof e === 'string' ? e : e.message || e.code || JSON.stringify(e))),
    ...structure.flatMap((s) => s.errors.map((e) => `${s.plan}: ${e}`)),
    ...((gates && gates.errors) || []).map((e) => (typeof e === 'string' ? e : `${e.plan || ''} ${e.code || ''} ${e.command || ''}`.trim())),
  ];
  return { ok: errors.length === 0, errors, plans: pf.planFiles.length };
}

/** Record the engine's passing plan check as the phase's plan-check verdict. */
function recordEngineCheck(cwd, phase, result) {
  const F = require('./findings.cjs');
  const block = '```pan-verdict\n' + JSON.stringify({ contract: '1.0', agent: 'pan-plan-checker', phase: String(phase), outcome: 'pass', verdict: 'PASSED', findings: [] }) + '\n```\n';
  const text = `Plan check by the engine (lean path): plan set, plan structure and grep gates all pass for ${result.plans} plan(s).\n\n${block}`;
  return F.recordVerdict(cwd, { phase: String(phase), agent: 'pan-plan-checker', text, source: 'engine:lean-plan-check' });
}

/**
 * The one-task plan for a lean quick task, written by the engine instead of a planner
 * session: the description is the plan. Files are the ones the description names; the
 * verify command is the project's test command. Pure apart from the test-command read.
 */
function leanQuickPlan(cwd, description, num) {
  const desc = String(description || '').trim();
  const files = [...new Set((desc.match(/\b[\w./-]+\.(?:c?js|mjs|tsx?|jsx|py|json|md|go|rs|java|rb|cs|php|sh|ya?ml|toml|sql|html|css)\b/g) || []))].filter((f) => !/^\d/.test(f));
  const test = require('./test-gate.cjs').detectTestCommand(cwd);
  const verify = (test && test.command) || 'the project\'s tests';
  const esc = (t) => t.replace(/</g, '&lt;');
  return [
    '---', 'phase: quick', `plan: ${String(num || 1).padStart(2, '0')}`, 'type: execute', 'wave: 1', 'depends_on: []',
    `files_modified: [${files.join(', ')}]`, 'autonomous: true', 'tier: micro', 'must_haves:', '  truths:', `    - ${JSON.stringify(desc.slice(0, 300))}`,
    '---', '', '<objective>', esc(desc), '', 'Written by the engine (lean path): the task description is precise enough to be the plan.', '</objective>', '',
    '<tasks>', '', '<task type="auto">', `  <name>${esc(desc.split(/\.\s|\n/)[0].slice(0, 80))}</name>`, `  <files>${files.join(', ') || 'the files the description names'}</files>`,
    `  <action>Do exactly what the objective says, with tests for each rule it states. The objective is the specification: do not widen it.</action>`,
    `  <verify>${verify}</verify>`, '  <done>Every rule in the objective holds and is covered by a test; the tests pass.</done>', '</task>', '', '</tasks>', '',
  ].join('\n');
}

const FILE_RE = /\b[\w./-]+\.(?:c?js|mjs|tsx?|jsx|py|json|md|go|rs|java|rb|cs|php|sh|ya?ml|toml|sql|html|css)\b/g;

/**
 * Write a lean phase's plan from its requirements (autodev step 2): one plan, one task per
 * requirement, each task's action the requirement's own text. The requirements already say
 * what to build, so a planner session would only restate them. Refuses a phase that is not
 * lean, or that already has plans. Creates the phase directory when it is missing.
 * @returns {{written, path, plan_dir, requirements}|{error, reason}}
 */
function writeLeanPhasePlan(cwd, phase, opts = {}) {
  const path = require('path');
  const C = require('./core.cjs');
  const size = sizePhase(cwd, phase, opts);
  if (size.path !== 'lean') return { error: 'not_lean', reason: size.reasons.join('; ') };
  const rp = C.getRoadmapPhaseInternal(cwd, String(phase));
  if (!rp || !rp.found) return { error: 'phase_not_found', reason: `phase ${phase} is not in roadmap.md` };
  const padded = C.normalizePhaseName(String(phase));
  let info = C.findPhaseInternal(cwd, String(phase));
  let dir;
  if (info && info.found) dir = path.join(cwd, info.directory);
  else {
    dir = path.join(planningPath(cwd, 'phases'), `${padded}-${C.generateSlugInternal(rp.phase_name || 'phase')}`);
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.readdirSync(dir).some((f) => /-plan\.md$/i.test(f))) return { error: 'has_plans', reason: `phase ${phase} already has plans` };
  let reqText = '';
  try { reqText = fs.readFileSync(planningPath(cwd, REQUIREMENTS_FILE), 'utf8'); } catch { /* sized lean, so present */ }
  const all = require('./requirements-lint.cjs').parseRequirements(reqText);
  const ids = roadmapRequirementIds(fs.readFileSync(planningPath(cwd, ROADMAP_FILE), 'utf8'), String(phase));
  const reqs = ids.map((id) => all.find((r) => String(r.id).toUpperCase() === String(id).toUpperCase()) || { id, text: '', criteria: [] });
  const one = (t) => String(t || '').replace(/\s+/g, ' ').trim().replace(/^[—–:-]+\s*/, '');
  const filesOf = (t) => [...new Set((String(t).match(FILE_RE) || []).filter((f) => !/^\d/.test(f)))];
  const files = [...new Set(reqs.flatMap((r) => filesOf(r.text)))];
  const test = require('./test-gate.cjs').detectTestCommand(cwd);
  const verify = (test && test.command) || 'the project\'s tests';
  const head = C.execGit(cwd, ['rev-parse', 'HEAD']);
  const slug = path.basename(dir).replace(/^\d+(?:\.\d+)*-/, '');
  const esc = (t) => t.replace(/</g, '&lt;');
  const tasks = reqs.map((r) => {
    const own = filesOf(r.text);
    const criteria = (r.criteria || []).map((c) => `\n    - ${esc(one(c))}`).join('');
    return ['<task type="auto">', `  <name>${r.id}: ${esc(one(r.text).slice(0, 70))}</name>`, `  <files>${(own.length ? own : files).join(', ') || 'the files the requirement names'}</files>`,
      `  <action>Implement ${r.id} exactly as requirements.md states it, with a test for each rule in it: ${esc(one(r.text))}${criteria}</action>`,
      `  <verify>${verify}</verify>`, `  <done>${r.id} holds and a test covers each rule in it; the tests pass.</done>`, '</task>'].join('\n');
  });
  const text = [
    '---', `phase: ${padded}-${slug}`, 'plan: 01', 'type: execute', 'wave: 1', 'depends_on: []', `files_modified: [${files.join(', ')}]`, 'autonomous: true',
    `requirements: [${reqs.map((r) => r.id).join(', ')}]`, ...(head.exitCode === 0 ? [`planned_commit: ${head.stdout.trim()}`] : []),
    'must_haves:', '  truths:', ...reqs.map((r) => `    - ${JSON.stringify(`${r.id}: ${one(r.text).slice(0, 240)}`)}`),
    '---', '', '<objective>', esc(one(rp.goal || '')), '', `Written by the engine (lean path): the phase's requirements (${reqs.map((r) => r.id).join(', ')}) say precisely what to build, so each is one task. The requirements are the specification: do not widen them.`, '</objective>', '',
    '<tasks>', '', tasks.join('\n\n'), '', '</tasks>', '',
  ].join('\n');
  const file = path.join(dir, `${padded}-01-plan.md`);
  fs.writeFileSync(file, text);
  const rel = require('./core.cjs').toPosix(path.relative(cwd, file));
  return { written: true, path: rel, plan_dir: require('./core.cjs').toPosix(path.relative(cwd, dir)), requirements: reqs.map((r) => r.id) };
}

/**
 * The lean phase's whole planning step, in code: write the plan, check it, record the plan
 * check, and commit the plan when commit_docs is on. No model session.
 */
function planLeanPhase(cwd, phase, opts = {}) {
  const w = writeLeanPhasePlan(cwd, phase, opts);
  if (w.error) return w;
  const check = engineCheckPlans(cwd, phase);
  if (!check.ok) return { ...w, ok: false, errors: check.errors };
  const rec = recordEngineCheck(cwd, phase, check);
  if (rec.error) return { ...w, ok: false, errors: [rec.reason || rec.error] };
  const config = loadConfig(cwd);
  let commit = null;
  if (config.commit_docs !== false) {
    const C = require('./core.cjs');
    const add = C.execGit(cwd, ['add', '--', w.path]);
    const msg = `docs(${C.normalizePhaseName(String(phase))}): lean plan written by the engine`;
    const c = add.exitCode === 0 ? C.execGit(cwd, ['commit', '-q', '-m', msg, '--', w.path]) : add;
    commit = c.exitCode === 0 ? (C.execGit(cwd, ['rev-parse', '--short', 'HEAD']).stdout || '').trim() : null;
    // The plan stands without its commit (exec-phase commits as it goes); say why it is missing.
    if (!commit) return { ...w, ok: true, plan_check: 'recorded', commit: null, commit_error: String(c.stderr || c.stdout || 'git commit failed').trim().slice(0, 300) };
  }
  return { ...w, ok: true, plan_check: 'recorded', commit };
}

module.exports = { writeLeanPhasePlan, planLeanPhase, leanQuickPlan, ceremonyMode, requirementSpecified, taskSpecified, sizeTask, sizePhase, engineCheckPlans, recordEngineCheck, DEFAULT_LEAN_MAX_REQUIREMENTS };
