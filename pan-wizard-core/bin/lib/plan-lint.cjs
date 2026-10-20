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

/**
 * Text with HTML comments removed: repeated until nothing changes, since removing
 * one can join the text around it into another, and an unclosed `<!--` hides the
 * rest. A placeholder comment is not a Review Focus item.
 */
function stripComments(s) {
  let prev;
  do { prev = s; s = s.replace(/<!--[\s\S]*?-->/g, ''); } while (s !== prev);
  const open = s.indexOf('<!--');
  return open === -1 ? s : s.slice(0, open);
}

/** Check one plan's `## Review Focus`. */
function reviewFocusOf(p) {
  const body = sectionBody(p.text, 'Review Focus');
  const out = { plan: p.plan, file: p.file, status: 'ok', items: 0 };
  const errors = [];
  if (body == null) {
    errors.push({ code: 'review_focus_missing', plan: p.plan, detail: 'no `## Review Focus` section' });
    return { ...out, status: 'missing', errors };
  }
  const text = stripComments(body).trim();
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

// ─── Gate baselines (M48) ─────────────────────────────────────────────────────
//
// A plan's `<verify>` often names a grep or count gate. One that already passes
// before any work proves nothing about the task; one whose pattern cannot compile
// can never match (gsd-core v1.18.0 "gate baselines"). The simple grep forms are
// interpreted here, in Node, never through a shell: the same on every platform,
// and nothing a plan writes is executed. Anything else is listed as not checkable.

const GATE_TOOLS = [['git', 'grep'], ['grep'], ['rg']];
const GATE_FLAGS = new Set(['r', 'R', 'i', 'c', 'E', 'F', 'w', 'q', 'l', 'n', 's', 'H', 'h']);
const REGRESSION_GUARD = /regression guard|already passes|must still pass/i;

/** Split a command line on spaces, honouring quotes. Null on shell syntax. */
function shellWords(cmd) {
  const words = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/[|;&<>`$()\\]/.test(ch)) return null;
    if (/\s/.test(ch)) { if (started) { words.push(cur); cur = ''; started = false; } continue; }
    cur += ch; started = true;
  }
  if (quote) return null;
  if (started) words.push(cur);
  return words;
}

/**
 * Parse a simple grep gate: `grep|rg|git grep [flags] PATTERN [paths...]`.
 * @returns {{tool, flags, pattern, paths}|null} null when the command is not one
 */
function parseGateCommand(cmd) {
  const words = shellWords(String(cmd || '').trim());
  if (!words || !words.length) return null;
  const tool = GATE_TOOLS.find((t) => t.every((w, i) => words[i] === w));
  if (!tool) return null;
  const flags = {};
  let pattern = null;
  const paths = [];
  let flagsDone = false;
  for (const w of words.slice(tool.length)) {
    if (!flagsDone && w === '--') { flagsDone = true; continue; }
    if (!flagsDone && /^-[A-Za-z]+$/.test(w)) {
      for (const f of w.slice(1)) { if (!GATE_FLAGS.has(f)) return null; flags[f] = true; }
      continue;
    }
    if (!flagsDone && w.startsWith('-')) return null;
    if (pattern === null) pattern = w; else paths.push(w);
  }
  if (pattern === null) return null;
  return { tool: tool.join(' '), flags, pattern, paths };
}

/** A JS RegExp for a grep pattern: -F literal, -E extended, else basic (BRE). Null when it cannot compile. */
function gateRegex(g) {
  let src = g.pattern;
  if (g.flags.F) src = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  else if (!g.flags.E && g.tool !== 'rg') {
    // BRE: \( \) \{ \} \| \+ \? are the operators; their bare forms are literals.
    src = src.replace(/\\([(){}|+?])|([(){}|+?])/g, (m, esc, bare) => (esc ? esc : '\\' + bare));
  }
  if (g.flags.w) src = `\\b(?:${src})\\b`;
  try { return new RegExp(src, g.flags.i ? 'i' : ''); } catch { return null; }
}

function filesUnder(root, rel, recursive) {
  const abs = path.join(root, rel);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (st.isFile()) return [abs];
  if (!st.isDirectory() || !recursive) return [];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/** Run a parsed gate against the tree as it is: passes_now | fails_now | target_missing | invalid. */
function runGate(cwd, g) {
  const re = gateRegex(g);
  if (!re) return 'invalid';
  const recursive = g.tool !== 'grep' || g.flags.r || g.flags.R;
  const targets = g.paths.length ? g.paths : ['.'];
  let anyTarget = false;
  for (const t of targets) {
    const files = filesUnder(cwd, t, recursive);
    if (files === null) continue;
    anyTarget = true;
    for (const f of files) {
      let text;
      try { text = toLf(fs.readFileSync(f, 'utf-8')); } catch { continue; }
      if (text.split('\n').some((line) => re.test(line))) return 'passes_now';
    }
  }
  return anyTarget ? 'fails_now' : 'target_missing';
}

/** The gate commands in a plan: backticked spans inside each task's <verify>. */
function gatesOf(text) {
  const out = [];
  const taskRe = /<task\b[^>]*>([\s\S]*?)<\/task>/g;
  let t;
  while ((t = taskRe.exec(text)) !== null) {
    const name = ((t[1].match(/<name>([\s\S]*?)<\/name>/) || [])[1] || 'unnamed').trim();
    const verify = (t[1].match(/<verify>([\s\S]*?)<\/verify>/) || [])[1] || '';
    for (const m of verify.matchAll(/`([^`]+)`/g)) out.push({ task: name, command: m[1].trim(), guard: REGRESSION_GUARD.test(verify) });
  }
  return out;
}

function checkGates(cwd, phase) {
  const pp = phasePlans(cwd, phase);
  if (pp.error) return pp;
  const gates = [];
  const errors = [];
  for (const p of pp.plans) {
    for (const g of gatesOf(p.text)) {
      const parsed = parseGateCommand(g.command);
      const status = parsed ? runGate(cwd, parsed) : 'not_checkable';
      gates.push({ plan: p.plan, task: g.task, command: g.command, status, ...(g.guard ? { regression_guard: true } : {}) });
      if (status === 'passes_now' && !g.guard) errors.push({ code: 'gate_vacuous', plan: p.plan, task: g.task, command: g.command, detail: 'passes before any work, so it cannot show the task did anything; check for what the task adds, or mark it a regression guard' });
      if (status === 'invalid') errors.push({ code: 'gate_invalid', plan: p.plan, task: g.task, command: g.command, detail: 'the pattern does not compile, so the gate can never match as written' });
    }
  }
  return { phase: pp.pf.info.phase_number, ok: errors.length === 0, gates, errors };
}

function cmdVerifyGates(cwd, phase, raw) {
  if (!phase) error('Usage: verify gates <phase>');
  const r = checkGates(cwd, phase);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

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

module.exports = {
  REVIEW_FOCUS_MAX, checkReviewFocus, checkDecisions, recordedDecisions, cmdVerifyReviewFocus, cmdVerifyDecisions,
  parseGateCommand, checkGates, cmdVerifyGates,
};
