'use strict';
/**
 * Plan intent checked in code: the parts of a plan check that are reading, not
 * judgement, so the plan-checker is not spent on them.
 *
 * `verify review-focus <phase>` (program P4, M41). A plan names, under
 * `## Review Focus`, at most five inputs or failure modes its requirements imply and
 * no test exercises yet, each pinned to the task that owns the code and the test that
 * task adds. A plan with none says so on one `None — <reason>` line. The reviewer gets
 * the section through `review scope` (R1).
 *
 * `verify decisions <phase>` (program P2). The phase design records its decisions with
 * ids (`DD-N`), and only the ones that pass the three-question test (hard to reverse,
 * a reasonable engineer could choose otherwise, more than one task depends on it).
 * Plans cite the ids they implement. A plan citing an id the design does not record
 * relies on a decision nobody approved; a recorded decision no plan cites is approved
 * design nobody builds. A design from before ids is `legacy`: a warning, never a refusal.
 */
const fs = require('fs');
const path = require('path');
const { output, error, toLf } = require('./core.cjs');
const { getPlanId } = require('./constants.cjs');
const { phaseFiles } = require('./verify-plan-set.cjs');
const { sectionBody } = require('./verify-scope.cjs');

const REVIEW_FOCUS_MAX = 5;
const DECISION_ID_RE = /\bDD-\d+\b/g;

function readText(file) {
  try { return toLf(fs.readFileSync(file, 'utf-8')); } catch { return ''; }
}

/** The phase's plans as `{plan, file, text}`, or `{error, reason}`. */
function phasePlans(cwd, phase) {
  const pf = phaseFiles(cwd, phase);
  if (pf.error) return pf;
  return { pf, plans: pf.planFiles.map((file) => ({ plan: getPlanId(file), file, text: readText(path.join(pf.dir, file)) })) };
}

// ─── Review Focus (P4) ───────────────────────────────────────────────────────

/** Check one plan's `## Review Focus`. */
function reviewFocusOf(p) {
  const body = sectionBody(p.text, 'Review Focus');
  const out = { plan: p.plan, file: p.file, status: 'ok', items: 0 };
  const errors = [];
  if (body == null) {
    errors.push({ code: 'review_focus_missing', plan: p.plan, detail: 'no `## Review Focus` section' });
    return { ...out, status: 'missing', errors };
  }
  const text = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  const items = text.split('\n').map((l) => l.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)/)).filter(Boolean).map((m) => m[1]);
  if (!items.length) {
    // `None — <reason>`: the reason is what tells the checker the planner looked.
    const none = text.match(/^none\b[\s—–:-]*(.*)$/im);
    if (none && none[1].trim().split(/\s+/).length >= 3) return { ...out, status: 'none', errors };
    errors.push({ code: 'review_focus_empty', plan: p.plan, detail: 'no items, and no `None — <reason>` line' });
    return { ...out, status: 'invalid', errors };
  }
  out.items = items.length;
  if (items.length > REVIEW_FOCUS_MAX) {
    errors.push({ code: 'review_focus_too_many', plan: p.plan, detail: `${items.length} items; at most ${REVIEW_FOCUS_MAX}` });
  }
  const taskCount = (p.text.match(/<task\b/g) || []).length;
  for (const item of items) {
    const short = item.slice(0, 80);
    const task = item.match(/\bTask\s+(\d+)\b/i);
    if (!task) errors.push({ code: 'review_focus_no_task', plan: p.plan, detail: `names no owning task: ${short}` });
    else if (Number(task[1]) < 1 || Number(task[1]) > taskCount) errors.push({ code: 'review_focus_unknown_task', plan: p.plan, detail: `Task ${task[1]} is not one of the plan's ${taskCount} tasks: ${short}` });
    if (!/\btests?\b/i.test(item)) errors.push({ code: 'review_focus_no_test', plan: p.plan, detail: `names no test: ${short}` });
  }
  return { ...out, status: errors.length ? 'invalid' : 'ok', errors };
}

/**
 * @returns {{phase, ok, plans: Array<{plan, file, status, items}>, errors}} or `{error, reason}`
 */
function checkReviewFocus(cwd, phase) {
  const pp = phasePlans(cwd, phase);
  if (pp.error) return pp;
  const results = pp.plans.map(reviewFocusOf);
  const errors = results.flatMap((r) => r.errors);
  return { phase: pp.pf.info.phase_number, ok: errors.length === 0, plans: results.map(({ errors: _e, ...r }) => r), errors };
}

// ─── Decision spine (P2) ─────────────────────────────────────────────────────

/** Decision ids a design records: the first cell of a table row, or the head of a list item. */
function recordedDecisions(text) {
  const ids = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\|\s*\**(DD-\d+)\**\s*\|/) || line.match(/^\s*(?:[-*]|\d+[.)])\s+\**(DD-\d+)\**\b/) || line.match(/^#{2,6}\s+(DD-\d+)\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * @returns {{phase, ok, status: 'checked'|'no_design'|'legacy', design, decisions, cited, errors, warnings}} or `{error, reason}`
 */
function checkDecisions(cwd, phase) {
  const pp = phasePlans(cwd, phase);
  if (pp.error) return pp;
  const base = { phase: pp.pf.info.phase_number, ok: true, design: null, decisions: [], cited: {}, errors: [], warnings: [] };
  let designFile = null;
  try { designFile = fs.readdirSync(pp.pf.dir).filter((f) => /-design\.md$/i.test(f)).sort()[0] || null; } catch { /* phaseFiles read it */ }
  if (!designFile) return { ...base, status: 'no_design' };
  const recorded = recordedDecisions(readText(path.join(pp.pf.dir, designFile)));
  const design = path.posix.join(pp.pf.info.directory.replace(/\\/g, '/'), designFile);
  if (!recorded.length) {
    return { ...base, status: 'legacy', design, warnings: [{ code: 'decisions_without_ids', detail: `${designFile} records no DD-N decision ids; plans cannot cite them` }] };
  }
  const errors = [];
  const seen = new Set();
  for (const id of recorded) {
    if (seen.has(id)) errors.push({ code: 'decision_duplicate', id, detail: `${id} is recorded more than once in ${designFile}` });
    seen.add(id);
  }
  const cited = {};
  for (const p of pp.plans) {
    for (const id of new Set(p.text.match(DECISION_ID_RE) || [])) {
      if (!seen.has(id)) errors.push({ code: 'decision_unrecorded', plan: p.plan, id, detail: `${p.plan} cites ${id}, which ${designFile} does not record` });
      else (cited[id] = cited[id] || []).push(p.plan);
    }
  }
  const decisions = [...seen].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  for (const id of decisions) {
    if (!cited[id]) errors.push({ code: 'decision_uncited', id, detail: `${id} is recorded in ${designFile} and cited by no plan` });
  }
  return { ...base, ok: errors.length === 0, status: 'checked', design, decisions, cited, errors };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function cmdVerifyReviewFocus(cwd, phase, raw) {
  if (!phase) error('Usage: verify review-focus <phase>');
  const r = checkReviewFocus(cwd, phase);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

function cmdVerifyDecisions(cwd, phase, raw) {
  if (!phase) error('Usage: verify decisions <phase>');
  const r = checkDecisions(cwd, phase);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

module.exports = { REVIEW_FOCUS_MAX, checkReviewFocus, checkDecisions, recordedDecisions, cmdVerifyReviewFocus, cmdVerifyDecisions };
