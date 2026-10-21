'use strict';
/**
 * Debug sessions as evidence and as a case base (program P5).
 *
 * `debug repro <slug>` runs the reproduction a session recorded (its `## Reproduction`
 * `command:`), so a gap or a debug session closes only when that command turns green,
 * not when an agent says it is fixed. The reproduction may name the requirement it
 * stands for (`requirement: REQ-n`): one reproduction per requirement a gap breaks.
 *
 * `debug similar "<symptom>"` ranks the resolved sessions in `.planning/debug/resolved/`
 * by token overlap with the new symptom (their symptoms, errors and root cause), so a
 * recurring bug starts from the root cause and fix that worked before.
 */
const fs = require('fs');
const path = require('path');
const { output, error, toLf } = require('./core.cjs');
const TG = require('./test-gate.cjs');

const DEBUG_DIR = path.join('.planning', 'debug');
const RESOLVED_DIR = path.join(DEBUG_DIR, 'resolved');
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const DEFAULT_REPRO_TIMEOUT_MS = 2 * 60 * 1000;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'when', 'after', 'before', 'from', 'into', 'are', 'was', 'not', 'but', 'its', 'every', 'right']);

/** The `key: value` lines of one `## Heading` section. */
function sectionFields(text, heading) {
  const m = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/** Parse a debug session file. */
function parseDebugSession(raw) {
  const text = toLf(String(raw || ''));
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const status = fm ? ((/^status:\s*(.+)$/m.exec(fm[1]) || [])[1] || '').trim() : '';
  return {
    status,
    symptoms: sectionFields(text, 'Symptoms'),
    reproduction: sectionFields(text, 'Reproduction'),
    resolution: sectionFields(text, 'Resolution'),
  };
}

/** Run a session's reproduction. green | red | none (no command recorded). */
function reproCheck(cwd, slug, opts = {}) {
  if (!slug || !SLUG_RE.test(slug) || slug.includes('..')) return { error: 'invalid_slug', reason: 'a debug session slug is letters, digits, dots, dashes and underscores' };
  const candidates = [path.join(cwd, DEBUG_DIR, `${slug}.md`), path.join(cwd, RESOLVED_DIR, `${slug}.md`)];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return { error: 'session_not_found', reason: `no .planning/debug/${slug}.md` };
  const s = parseDebugSession(fs.readFileSync(file, 'utf8'));
  const command = s.reproduction.command || '';
  const requirement = s.reproduction.requirement || null;
  if (!command || /^none\b/i.test(command) || /^\[/.test(command)) {
    return { slug, result: 'none', closable: false, requirement, detail: 'the session records no reproduction command; its closing needs a human check' };
  }
  const r = TG.runCommand(cwd, command, opts.timeoutMs || DEFAULT_REPRO_TIMEOUT_MS);
  const result = r.exit === 0 ? 'green' : 'red';
  return { slug, result, closable: result === 'green', requirement, command, exit: r.exit, ...(r.timed_out ? { timed_out: true } : {}) };
}

function tokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Rank resolved sessions by overlap with a symptom. */
function similarCases(cwd, symptom, opts = {}) {
  const want = tokens(symptom);
  const dir = path.join(cwd, RESOLVED_DIR);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { /* none yet */ }
  const cases = [];
  for (const f of files) {
    const s = parseDebugSession(fs.readFileSync(path.join(dir, f), 'utf8'));
    const have = tokens([s.symptoms.expected, s.symptoms.actual, s.symptoms.errors, s.resolution.root_cause].join(' '));
    let both = 0;
    for (const t of want) if (have.has(t)) both++;
    const score = want.size && have.size ? both / (want.size + have.size - both) : 0;
    if (score <= 0) continue;
    cases.push({ slug: f.replace(/\.md$/, ''), score: Number(score.toFixed(3)), root_cause: s.resolution.root_cause || null, fix: s.resolution.fix || null, reproduction: s.reproduction.command || null });
  }
  cases.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return { symptom, cases: cases.slice(0, opts.limit || 5) };
}

function cmdDebugRepro(cwd, slug, raw, opts = {}) {
  if (!slug) error('Usage: debug repro <slug> [--timeout <ms>]');
  const r = reproCheck(cwd, slug, { timeoutMs: opts.timeout ? Number(opts.timeout) : undefined });
  if (r.error) { output(r, raw, 'error', 1); return; }
  output(r, raw, r.result, r.result === 'green' ? 0 : 1);
}

function cmdDebugSimilar(cwd, symptom, raw, opts = {}) {
  if (!symptom) error('Usage: debug similar "<symptom>" [--limit N]');
  const r = similarCases(cwd, symptom, { limit: opts.limit ? Number(opts.limit) : undefined });
  output(r, raw, r.cases.map((c) => c.slug).join('\n'));
}

module.exports = { parseDebugSession, reproCheck, similarCases, cmdDebugRepro, cmdDebugSimilar };
