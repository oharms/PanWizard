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
  if (body == null) {
    return { ...base, ok: false, errors: [{ code: 'claims_missing', detail: 'no `## Claims` table (claim · type · source · checked)' }] };
  }
  const { header, rows } = claimRows(body);
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

function cmdResearchLint(cwd, target, opts, raw) {
  if (!target) error('Usage: research lint <phase|path> [--now YYYY-MM-DD]');
  const r = lintResearch(cwd, target, opts);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

module.exports = { FRESHNESS_DAYS, lintResearch, cmdResearchLint };
