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

module.exports = { leanQuickPlan, ceremonyMode, requirementSpecified, taskSpecified, sizeTask, sizePhase, engineCheckPlans, recordEngineCheck, DEFAULT_LEAN_MAX_REQUIREMENTS };
