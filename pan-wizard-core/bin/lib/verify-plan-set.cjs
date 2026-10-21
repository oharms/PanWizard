'use strict';
/**
 * Plan checks in code (program V7).
 *
 * The plan-checker agent reads a phase's plans and judges them, but the parts of that
 * judgement that are arithmetic were left to the model: whether every requirement is
 * covered, whether two plans in one wave edit the same file, whether a dependency
 * points at a plan that does not exist, at the same wave or a later one, or round in
 * a circle. `verify plan-set` checks those in code, before the checker is spent.
 *
 * It also binds a passing plan check to the plans it checked. The recorder stores a
 * hash of the phase's plan files with every plan-checker verdict (`plans_sha`), and
 * `planCheckStatus` tells exec-phase whether the plans it is about to run are the
 * plans that passed: `ok`, `stale` (edited since), `failed`, `missing`, `legacy`
 * (a record from before hashing: a warning, never a refusal) or `disabled`.
 *
 * And it reports drift: a plan that records `planned_commit` lists the files it
 * modifies that changed on the branch since it was planned.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findPhaseInternal, output, error, execGit, loadConfig, toLf, toPosix } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { roadmapRequirementIds } = require('./roadmap.cjs');
const { buildPlanIndex, dependencyNames } = require('./phase.cjs');
const { ROADMAP_FILE, getPlanId } = require('./constants.cjs');
const { planningPath, filterPlanFiles, filterSummaryFiles } = require('./utils.cjs');

const PLAN_CHECKER = 'pan-plan-checker';

const asList = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map((x) => String(x).trim()).filter(Boolean);
const normFile = (f) => toPosix(String(f).trim()).replace(/^\.\//, '');

/** The phase directory and its plan and summary files, or `{error, reason}`. */
function phaseFiles(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  if (!info || !info.found) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const dir = path.join(cwd, info.directory);
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { return { error: 'unreadable_phase', reason: `cannot read ${info.directory}: ${e.code || e.message}` }; }
  return { info, dir, planFiles: filterPlanFiles(files).sort(), summaryFiles: filterSummaryFiles(files) };
}

/**
 * A hash of a phase's plan files (names and line-ending-normalised contents), so a
 * plan check can be matched to exactly the plans it checked.
 */
function plansSha(dir, planFiles) {
  const h = crypto.createHash('sha256');
  for (const f of [...planFiles].sort()) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf-8'); } catch { /* unreadable reads as empty */ }
    h.update(f + '\u0000' + toLf(text) + '\u0000');
  }
  return h.digest('hex').slice(0, 16);
}

/** `plansSha` for a phase by number, or null when it has no plans. */
function plansShaFor(cwd, phase) {
  const pf = phaseFiles(cwd, phase);
  if (pf.error || !pf.planFiles.length) return null;
  return plansSha(pf.dir, pf.planFiles);
}

/** The phase's plans, each with its requirements, planned_commit and file name. */
function loadPlans(pf) {
  const { plans } = buildPlanIndex(pf.dir, pf.planFiles, pf.summaryFiles);
  const byId = new Map(plans.map((p) => [p.id, p]));
  for (const file of pf.planFiles) {
    const p = byId.get(getPlanId(file));
    if (!p) continue;
    let fm = {};
    try { fm = extractFrontmatter(fs.readFileSync(path.join(pf.dir, file), 'utf-8')) || {}; } catch { /* unreadable */ }
    p.file = file;
    p.requirements = asList(fm.requirements);
    p.planned_commit = fm.planned_commit ? String(fm.planned_commit).trim() : null;
    p.files_modified = p.files_modified.map(normFile).filter(Boolean);
  }
  return plans;
}

/** A dependency entry that names a plan of another phase (`02-01` from phase 03). */
function isOtherPhase(dep, phaseNumber) {
  const m = /^(\d+(?:\.\d+)*)-\d+$/.exec(String(dep).trim());
  if (!m) return false;
  const strip = (s) => String(s).split('.').map((x) => String(parseInt(x, 10))).join('.');
  return strip(m[1]) !== strip(phaseNumber);
}

/**
 * Check a phase's plan set.
 * @returns {{phase, ok, errors: Array, warnings: Array, plans: number}|{error, reason}}
 */
function checkPlanSet(cwd, phase) {
  const pf = phaseFiles(cwd, phase);
  if (pf.error) return pf;
  if (!pf.planFiles.length) return { error: 'no_plans', reason: `phase ${phase} has no plans` };
  const phaseNumber = pf.info.phase_number || String(phase);
  const plans = loadPlans(pf);
  const errors = [];
  const warnings = [];

  // 1. Requirement coverage, against the roadmap's requirement ids for this phase.
  let roadmap = '';
  try { roadmap = fs.readFileSync(planningPath(cwd, ROADMAP_FILE), 'utf-8'); } catch { /* no roadmap: nothing to cover */ }
  const required = roadmapRequirementIds(roadmap, phaseNumber);
  const key = (id) => String(id).trim().toUpperCase();
  const planned = new Set(plans.flatMap((p) => p.requirements.map(key)));
  for (const id of required) {
    if (!planned.has(key(id))) errors.push({ code: 'uncovered_requirement', requirement: id, detail: `requirement ${id} is in the roadmap for phase ${phaseNumber} but no plan lists it` });
  }
  if (required.length) {
    const known = new Set(required.map(key));
    for (const p of plans) for (const r of p.requirements) {
      if (!known.has(key(r))) warnings.push({ code: 'unknown_requirement', plan: p.id, requirement: r, detail: `plan ${p.id} lists ${r}, which the roadmap does not give phase ${phaseNumber}` });
    }
  }

  // 2. Dependencies: each must name a plan of this phase in an earlier wave.
  const resolved = new Map(); // plan id → ids of the plans it depends on
  for (const p of plans) {
    const deps = [];
    for (const d of p.depends_on) {
      if (isOtherPhase(d, phaseNumber)) continue; // a finished phase's plan: not this set's to check
      const target = plans.find((q) => q.id !== p.id && dependencyNames(d, q.id));
      if (!target) {
        if (dependencyNames(d, p.id)) errors.push({ code: 'self_reference', plan: p.id, detail: `plan ${p.id} depends on itself` });
        else errors.push({ code: 'missing_reference', plan: p.id, depends_on: d, detail: `plan ${p.id} depends on "${d}", which names no plan in this phase` });
        continue;
      }
      deps.push(target.id);
      if (target.wave >= p.wave) {
        errors.push({ code: 'future_reference', plan: p.id, depends_on: target.id, detail: `plan ${p.id} (wave ${p.wave}) depends on ${target.id} (wave ${target.wave}); a dependency must be in an earlier wave` });
      }
    }
    resolved.set(p.id, deps);
    const depWaves = deps.map((id) => plans.find((q) => q.id === id).wave);
    const expected = depWaves.length ? Math.max(...depWaves) + 1 : 1;
    if (p.wave > expected) {
      warnings.push({ code: 'wave_gap', plan: p.id, detail: `plan ${p.id} is in wave ${p.wave} but its dependencies allow wave ${expected}` });
    }
  }

  // 3. Cycles.
  const state = new Map();
  const reported = new Set();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'active') {
      const cycle = [...trail.slice(trail.indexOf(id)), id];
      const sig = [...new Set(cycle)].sort().join(',');
      if (!reported.has(sig)) { reported.add(sig); errors.push({ code: 'cycle', plans: cycle, detail: `dependency cycle: ${cycle.join(' → ')}` }); }
      return;
    }
    state.set(id, 'active');
    for (const d of resolved.get(id) || []) visit(d, [...trail, id]);
    state.set(id, 'done');
  };
  for (const p of plans) visit(p.id, []);

  // 4. Same-wave file overlap: two plans that run in parallel must not edit one file.
  const dependsOn = (a, b, seen = new Set()) => {
    if (seen.has(a)) return false;
    seen.add(a);
    return (resolved.get(a) || []).some((d) => d === b || dependsOn(d, b, seen));
  };
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i];
      const b = plans[j];
      if (a.wave !== b.wave) continue;
      const shared = a.files_modified.filter((f) => b.files_modified.includes(f));
      if (!shared.length || dependsOn(a.id, b.id) || dependsOn(b.id, a.id)) continue;
      errors.push({ code: 'same_wave_overlap', plans: [a.id, b.id], files: shared, detail: `plans ${a.id} and ${b.id} both modify ${shared.join(', ')} in wave ${a.wave} with no dependency between them` });
    }
  }

  // 5. Property tasks (V10): a requirement whose EARS criterion is a validation rule
  // (IF … THEN … SHALL, or a claim over any / every / all inputs, or a "never") is a
  // claim over many inputs, which one example test cannot show. The plan that lists it
  // must carry a property-test task: property="true" on the task, or "property test" /
  // "property-based" in its name or action.
  let reqText = '';
  try { reqText = fs.readFileSync(planningPath(cwd, 'requirements.md'), 'utf-8'); } catch { /* none */ }
  if (reqText && required.length) {
    const RL = require('./requirements-lint.cjs');
    const byId = new Map(RL.parseRequirements(reqText).map((r) => [key(r.id), r]));
    for (const id of required) {
      const r = byId.get(key(id));
      if (!r || !r.criteria.some(isValidationRule)) continue;
      const covering = plans.filter((p) => p.requirements.map(key).includes(key(id)));
      const hasProperty = covering.some((p) => {
        let text = '';
        try { text = toLf(fs.readFileSync(path.join(pf.dir, p.file), 'utf-8')); } catch { /* unreadable */ }
        return /<task\b[^>]*\bproperty=["']?true/i.test(text) || /property[- ]based|property test/i.test(text);
      });
      if (!hasProperty) errors.push({ code: 'missing_property_task', requirement: id, detail: `${id} states a validation rule ("${r.criteria.find(isValidationRule).slice(0, 80)}"): a plan covering it needs a property-test task, which checks the rule over generated inputs with the project's own property library` });
    }
  }

  return { phase: phaseNumber, ok: errors.length === 0, errors, warnings, plans: plans.length, plans_sha: plansSha(pf.dir, pf.planFiles) };
}

/** A validation-rule criterion (V10): unwanted-behaviour EARS, or a claim over all inputs. */
function isValidationRule(criterion) {
  const c = String(criterion || '');
  return /^IF\b[\s\S]*\bTHEN\b/i.test(c) || /\b(any|every|all|each)\s+\w+/i.test(c) || /\bnever\b/i.test(c);
}

/**
 * Whether the plans exec-phase is about to run are the plans that passed a plan check.
 * @returns {{status: 'ok'|'stale'|'failed'|'missing'|'legacy'|'disabled', reason?: string, plans_sha?: string, checked_sha?: string, attempt?: number}}
 */
function planCheckStatus(cwd, phase) {
  const config = loadConfig(cwd);
  if (config.plan_checker === false) return { status: 'disabled', reason: 'workflow.plan_check is off in config.json' };
  const F = require('./findings.cjs');
  const V = require('./verdict.cjs');
  const { verdicts } = F.foldFindings(F.readLedger(cwd).rows);
  const mine = verdicts.filter((v) => v.agent === PLAN_CHECKER && V.comparablePhase(v.phase) === V.comparablePhase(phase));
  const last = mine[mine.length - 1];
  const current = plansShaFor(cwd, phase);
  if (!last) return { status: 'missing', reason: 'no plan check is recorded for this phase', plans_sha: current };
  if (last.outcome !== 'pass') return { status: 'failed', reason: `the last plan check (attempt ${last.attempt}) found issues`, attempt: last.attempt, plans_sha: current };
  if (!last.plans_sha) return { status: 'legacy', reason: 'the plan check was recorded before plans were hashed, so it cannot show the plans are unchanged', attempt: last.attempt, plans_sha: current };
  if (last.plans_sha !== current) return { status: 'stale', reason: 'the plans changed after they passed the plan check', attempt: last.attempt, checked_sha: last.plans_sha, plans_sha: current };
  return { status: 'ok', attempt: last.attempt, plans_sha: current };
}

/**
 * Plans not yet executed whose modified files changed since they were planned.
 * @returns {Array<{plan, planned_commit, files?: string[], error?: string}>}
 */
function planDrift(cwd, phase) {
  const pf = phaseFiles(cwd, phase);
  if (pf.error || !pf.planFiles.length) return [];
  const out = [];
  for (const p of loadPlans(pf)) {
    if (p.has_summary || !p.planned_commit || !p.files_modified.length) continue;
    if (!/^[0-9a-f]{4,40}$/i.test(p.planned_commit)) { out.push({ plan: p.id, planned_commit: p.planned_commit, error: 'not a commit sha' }); continue; }
    const r = execGit(cwd, ['diff', '--name-only', p.planned_commit, 'HEAD', '--']);
    if (r.exitCode !== 0) { out.push({ plan: p.id, planned_commit: p.planned_commit, error: 'unknown commit' }); continue; }
    const changed = new Set(r.stdout.split(/\r?\n/).map(normFile).filter(Boolean));
    const files = p.files_modified.filter((f) => changed.has(f));
    if (files.length) out.push({ plan: p.id, planned_commit: p.planned_commit, files });
  }
  return out;
}

function cmdVerifyPlanSet(cwd, phase, raw) {
  if (!phase) error('Usage: verify plan-set <phase>');
  const r = checkPlanSet(cwd, phase);
  if (r.error) { output(r, raw); return; }
  const result = { ...r, plan_check: planCheckStatus(cwd, phase), drift: planDrift(cwd, phase) };
  output(result, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

module.exports = { phaseFiles, checkPlanSet, plansSha, plansShaFor, planCheckStatus, planDrift, cmdVerifyPlanSet, PLAN_CHECKER };
