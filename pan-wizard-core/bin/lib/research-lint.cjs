'use strict';
/**
 * Research claims with provenance and freshness (program P3).
 *
 * A research file lists the claims a plan will rest on in a `## Claims` table:
 *
 *   | Claim | Type | Source | Checked |
 *   | jose 6 supports EdDSA | version | https://github.com/panva/jose/releases | 2026-10-12 |
 *
 * `research lint <phase|path>` reads it. A claim with no source, or with no date (or
 * a date that is not YYYY-MM-DD, or is in the future), is an error: nobody can tell
 * where it came from or when it was true. A claim older than the freshness window for
 * its type is `stale`, not an error: what a version or a price was two months ago
 * says little about today, while a practice lasts for years. The plan-checker weighs
 * stale claims against what the plans rest on.
 *
 * Research answers questions (2026-10-25: research that surveyed a domain never
 * finished and grew the scope). The orchestrator writes at most five open questions
 * that block building; one researcher answers them in a table
 *
 *   | # | Question | Answer | Source | Confidence | Decision it settles |
 *
 * `research check <questions> <research> [--market]` holds it to that: at most five
 * questions, every question a row with an answer and a source, or an answer marked
 * `unknown` that names the assumption the plan uses; in market mode, at most five
 * comparable products. Without a `## Claims` table, `research lint` reads the
 * answered rows of that table as claims, with the date in the source cell.
 */
const fs = require('fs');
const path = require('path');
const { output, error, toLf, toPosix, findPhaseInternal } = require('./core.cjs');
const { sectionBody } = require('./verify-scope.cjs');

// Days a claim of each type stays fresh. Versions, prices and security advisories
// move monthly; an API surface quarterly; an engineering practice yearly.
const FRESHNESS_DAYS = Object.freeze({ version: 30, pricing: 30, security: 30, api: 90, general: 180, practice: 365 });
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A template placeholder (`[Official docs URL]`, `<url>`) or a stand-in is no source.
const PLACEHOLDER_RE = /^(\[.*\]|<.*>|-+|n\/?a|none|tbd|todo|\?+|unknown)$/i;

function utcDay(s) {
  if (!DATE_RE.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isNaN(t) ? null : t;
}

/** The research file a phase number or a path names, or `{error, reason}`. */
function resolveResearch(cwd, target) {
  const asPath = path.resolve(cwd, String(target));
  if (/\.md$/i.test(String(target))) {
    if (!fs.existsSync(asPath)) return { error: 'file_not_found', reason: `no file at ${target}` };
    return { abs: asPath };
  }
  const info = findPhaseInternal(cwd, target);
  if (!info || !info.found) return { error: 'phase_not_found', reason: `no phase directory for phase ${target}` };
  const dir = path.join(cwd, info.directory);
  let files = [];
  try { files = fs.readdirSync(dir); } catch { /* read as empty */ }
  const file = files.filter((f) => /-research\.md$/i.test(f) || /^research\.md$/i.test(f)).sort()[0];
  if (!file) return { error: 'no_research', reason: `phase ${target} has no research file` };
  return { abs: path.join(dir, file) };
}

/** Table rows of the `## Claims` section as arrays of cells, header and rule dropped. */
function claimRows(body) {
  const rows = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
    .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  if (!rows.length) return { header: null, rows: [] };
  const header = rows[0].map((c) => c.toLowerCase());
  return { header, rows: rows.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c) || c === '')) };
}

/**
 * @param {string} cwd
 * @param {string} target  a phase number, or a path to a research markdown file
 * @param {{now?: string}} [opts]  `now` (YYYY-MM-DD) fixes "today" for a reproducible lint
 */
function lintResearch(cwd, target, opts = {}) {
  const at = resolveResearch(cwd, target);
  if (at.error) return at;
  const rel = path.relative(path.resolve(cwd), at.abs);
  const file = rel && !rel.startsWith('..') ? toPosix(rel) : toPosix(at.abs);
  const now = opts.now ? utcDay(opts.now) : utcDay(new Date().toISOString().slice(0, 10));
  if (now == null) return { error: 'invalid_now', reason: '--now must be YYYY-MM-DD' };

  const text = toLf(fs.readFileSync(at.abs, 'utf-8'));
  const base = { file, ok: true, claims: 0, errors: [], warnings: [], stale: [], windows: FRESHNESS_DAYS };
  const body = sectionBody(text, 'Claims');
  let header;
  let rows;
  if (body == null) {
    // A question-driven research file: its answered rows are the claims.
    const answers = answerTable(text);
    if (!answers) {
      return { ...base, ok: false, errors: [{ code: 'claims_missing', detail: 'no `## Claims` table (claim · type · source · checked) and no answers table (# · question · answer · source)' }] };
    }
    header = ['claim', 'type', 'source', 'checked'];
    rows = answers.rows.filter((r) => !isUnknown(r.answer)).map((r) => {
      const date = (r.source.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
      return [r.answer, 'general', r.source, date];
    });
  } else {
    ({ header, rows } = claimRows(body));
  }
  const col = (name, fallback) => {
    const i = header ? header.findIndex((h) => h.startsWith(name)) : -1;
    return i === -1 ? fallback : i;
  };
  const C = { claim: col('claim', 0), type: col('type', 1), source: col('source', 2), checked: col('checked', 3) };
  const errors = [];
  const warnings = [];
  const stale = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    const claim = r[C.claim] || '';
    const rawType = (r[C.type] || '').toLowerCase();
    const source = r[C.source] || '';
    const checked = r[C.checked] || '';
    let type = rawType;
    if (!Object.prototype.hasOwnProperty.call(FRESHNESS_DAYS, rawType)) {
      warnings.push({ code: 'claim_unknown_type', row, claim, detail: `type "${rawType}" is not one of ${Object.keys(FRESHNESS_DAYS).join(', ')}; read as general` });
      type = 'general';
    }
    if (!source || PLACEHOLDER_RE.test(source)) errors.push({ code: 'claim_no_source', row, claim, detail: 'no source' });
    const day = utcDay(checked);
    if (day == null) {
      errors.push({ code: 'claim_no_date', row, claim, detail: checked ? `"${checked}" is not a YYYY-MM-DD date` : 'no checked date' });
      return;
    }
    if (day > now) { errors.push({ code: 'claim_future_date', row, claim, detail: `checked ${checked}, after today` }); return; }
    const age = Math.round((now - day) / DAY_MS);
    if (age > FRESHNESS_DAYS[type]) stale.push({ row, claim, type, checked, age_days: age, window_days: FRESHNESS_DAYS[type] });
  });
  return { ...base, ok: errors.length === 0, claims: rows.length, errors, warnings, stale };
}

const MAX_QUESTIONS = 5;
const MAX_PRODUCTS = 5;

/** Every markdown table in `text` as arrays of cells (rule rows dropped); a non-table line ends a table. */
function tables(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) { cur = null; continue; }
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) continue;
    if (!cur) { cur = []; out.push(cur); }
    cur.push(cells);
  }
  return out;
}

/** The answers table (`# · Question · Answer · Source …`), rows as objects, or null. */
function answerTable(text) {
  for (const t of tables(text)) {
    const h = t[0].map((c) => c.toLowerCase());
    const qi = h.findIndex((c) => c.startsWith('question'));
    const ai = h.findIndex((c) => c.startsWith('answer'));
    const si = h.findIndex((c) => c.startsWith('source'));
    if (qi === -1 || ai === -1 || si === -1) continue;
    const ni = h.findIndex((c) => c === '#' || c === 'no' || c === 'n');
    const ci = h.findIndex((c) => c.startsWith('confidence'));
    const di = h.findIndex((c) => c.startsWith('decision'));
    return {
      rows: t.slice(1).map((r, i) => ({
        n: ni === -1 ? i + 1 : parseInt(String(r[ni] || '').replace(/\D/g, ''), 10),
        question: r[qi] || '', answer: r[ai] || '', source: r[si] || '',
        confidence: ci === -1 ? '' : (r[ci] || ''), decision: di === -1 ? '' : (r[di] || ''),
      })),
    };
  }
  return null;
}

/** Rows of the comparable-products table (first header cell `Product`), or null. */
function productTable(text) {
  const t = tables(text).find((tb) => /^products?$/i.test(tb[0][0] || ''));
  return t ? t.slice(1) : null;
}

const isUnknown = (answer) => /^\W*unknown\b/i.test(answer);
const hasAssumption = (cell) => /assum\w*\s*[:\u2014\u2013-]?\s*\S/i.test(cell);

/** Numbered questions in a questions file: lines `1. …` or `1) …`, or `| 1 | … |` table rows. */
function readQuestions(text) {
  const qs = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+)[.)]\s+(\S.*)$/) || line.match(/^\s*\|\s*(\d+)\s*\|\s*([^|]*\S[^|]*)\|/);
    if (m) qs.push({ n: parseInt(m[1], 10), text: m[2].trim() });
  }
  return qs;
}

/**
 * @param {string} cwd
 * @param {string} questionsPath  the questions file the orchestrator wrote
 * @param {string} researchPath   the researcher's answers
 * @param {{market?: boolean}} [opts]  market mode also requires the products table
 */
function checkResearch(cwd, questionsPath, researchPath, opts = {}) {
  const qAbs = path.resolve(cwd, String(questionsPath));
  const rAbs = path.resolve(cwd, String(researchPath));
  if (!fs.existsSync(qAbs)) return { error: 'file_not_found', reason: `no questions file at ${questionsPath}` };
  if (!fs.existsSync(rAbs)) return { error: 'file_not_found', reason: `no research file at ${researchPath}` };
  const questions = readQuestions(toLf(fs.readFileSync(qAbs, 'utf-8')));
  const text = toLf(fs.readFileSync(rAbs, 'utf-8'));
  const errors = [];
  const warnings = [];
  if (questions.length === 0) errors.push({ code: 'no_questions', detail: 'the questions file lists no numbered question: with nothing blocking the build, no research runs' });
  if (questions.length > MAX_QUESTIONS) errors.push({ code: 'too_many_questions', detail: `${questions.length} questions; at most ${MAX_QUESTIONS}, the ones that block building` });
  const table = answerTable(text);
  let answered = 0;
  let unknown = 0;
  if (!table) {
    errors.push({ code: 'answers_missing', detail: 'no answers table (| # | Question | Answer | Source | Confidence | Decision it settles |)' });
  } else {
    for (const q of questions) {
      const row = table.rows.find((r) => r.n === q.n);
      if (!row || !row.answer || (PLACEHOLDER_RE.test(row.answer) && !isUnknown(row.answer))) {
        errors.push({ code: 'question_unanswered', question: q.n, detail: `question ${q.n} has no answer row` });
        continue;
      }
      if (isUnknown(row.answer)) {
        if (hasAssumption(`${row.answer} ${row.decision}`)) unknown++;
        else errors.push({ code: 'unknown_without_assumption', question: q.n, detail: `question ${q.n} is unknown but names no assumption the plan should use` });
        continue;
      }
      if (!row.source || PLACEHOLDER_RE.test(row.source)) {
        errors.push({ code: 'answer_no_source', question: q.n, detail: `question ${q.n} has an answer with no source (URL or doc, and date)` });
        continue;
      }
      if (!/^(high|medium|low)\b/i.test(row.confidence)) warnings.push({ code: 'answer_no_confidence', question: q.n, detail: `question ${q.n} gives no HIGH, MEDIUM or LOW confidence` });
      answered++;
    }
    const known = new Set(questions.map((q) => q.n));
    for (const r of table.rows) {
      if (!known.has(r.n)) warnings.push({ code: 'extra_row', row: r.n, detail: `row ${r.n} answers no listed question: new scope goes under Ideas, not into the answers` });
    }
  }
  const products = productTable(text);
  if (products && products.length > MAX_PRODUCTS) errors.push({ code: 'too_many_products', detail: `${products.length} comparable products; at most ${MAX_PRODUCTS}` });
  if (opts.market && !products) errors.push({ code: 'products_missing', detail: 'market mode: no table whose first column is Product' });
  const rel = (abs) => { const r = path.relative(path.resolve(cwd), abs); return r && !r.startsWith('..') ? toPosix(r) : toPosix(abs); };
  return {
    questions_file: rel(qAbs), research_file: rel(rAbs), ok: errors.length === 0,
    questions: questions.length, answered, unknown, products: products ? products.length : 0,
    limits: { questions: MAX_QUESTIONS, products: MAX_PRODUCTS }, errors, warnings,
  };
}

function cmdResearchCheck(cwd, questionsPath, researchPath, opts, raw) {
  if (!questionsPath || !researchPath) error('Usage: research check <questions file> <research file> [--market]');
  const r = checkResearch(cwd, questionsPath, researchPath, opts);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

function cmdResearchLint(cwd, target, opts, raw) {
  if (!target) error('Usage: research lint <phase|path> [--now YYYY-MM-DD]');
  const r = lintResearch(cwd, target, opts);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

module.exports = { FRESHNESS_DAYS, MAX_QUESTIONS, MAX_PRODUCTS, lintResearch, cmdResearchLint, checkResearch, cmdResearchCheck };
