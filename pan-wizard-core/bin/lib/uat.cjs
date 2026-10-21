'use strict';
/**
 * UAT through the engine (program L8): the walkthrough is a portable markdown workflow
 * (workflows/uat-walkthrough.md, `/pan:verify-phase N --uat`), and what it records goes
 * through these verbs, so every runtime leaves the same `{phase}-uat.md`:
 *
 *   uat record <phase> --test N --result pass|issue|skipped [--reported "…"] [--severity S] [--reason "…"]
 *       sets one test's result, then rebuilds `## Summary` and `## Gaps` (the YAML list
 *       diagnose-issues and `plan-phase --gaps` read). Diagnosis fields a gap already
 *       carries (root_cause, artifacts, missing, debug_session) survive a re-record.
 *       The session is `complete` when no test is pending.
 *   uat status <phase>
 *       counts and the gaps, for the walkthrough to decide whether to diagnose.
 *
 * The file shape is templates/uat.md.
 */
const fs = require('fs');
const path = require('path');
const { findPhaseInternal, output, error, toLf, dominantEol, withEol } = require('./core.cjs');

const RESULTS = Object.freeze(['pass', 'issue', 'skipped']);
const SEVERITIES = Object.freeze(['blocker', 'major', 'minor', 'cosmetic']);
const KEEP_GAP_FIELDS = Object.freeze(['root_cause', 'artifacts', 'missing', 'debug_session']);

const unquote = (s) => String(s || '').trim().replace(/^"(.*)"$/, '$1');
const quote = (s) => `"${String(s || '').replace(/"/g, "'")}"`;

function uatPath(cwd, phase) {
  const info = findPhaseInternal(cwd, phase);
  if (!info || !info.found) return null;
  const dir = path.join(cwd, info.directory);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /-uat\.md$/i.test(f)); } catch { /* none */ }
  return files.length ? path.join(dir, files[0]) : null;
}

/** Parse a uat.md: frontmatter status, the tests, and the gaps' extra fields by test number. */
function parseUat(raw) {
  const text = toLf(String(raw || ''));
  const status = ((/^---\n[\s\S]*?^status:\s*(.+)$/m.exec(text) || [])[1] || '').trim();
  const tests = [];
  const testsSec = (/^## Tests\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text) || [])[1] || '';
  for (const block of testsSec.split(/^(?=### \d+\.)/m)) {
    const h = /^### (\d+)\.\s*(.+)$/m.exec(block);
    if (!h) continue;
    const field = (k) => ((new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(block) || [])[1] || '').trim();
    let result = field('result').replace(/^\[|\]$/g, '') || 'pending';
    tests.push({ number: Number(h[1]), name: h[2].trim(), expected: field('expected'), result, reported: unquote(field('reported')) || null, severity: field('severity') || null, reason: field('reason') || null });
  }
  const gapsSec = (/^## Gaps\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text) || [])[1] || '';
  const gapExtras = new Map();
  for (const item of gapsSec.split(/^(?=- truth:)/m)) {
    const n = /^\s+test:\s*(\d+)/m.exec(item);
    if (!n) continue;
    const extras = {};
    for (const k of KEEP_GAP_FIELDS) {
      const m = new RegExp(`^\\s+${k}:\\s*(.*)$`, 'm').exec(item);
      if (m && m[1].trim() && m[1].trim() !== '""' && m[1].trim() !== '[]') extras[k] = m[1].trim();
    }
    gapExtras.set(Number(n[1]), extras);
  }
  return { status, tests, gapExtras };
}

function renderTest(t) {
  const lines = [`### ${t.number}. ${t.name}`, `expected: ${t.expected}`, `result: ${t.result === 'pending' ? '[pending]' : t.result}`];
  if (t.result === 'issue') {
    lines.push(`reported: ${quote(t.reported)}`);
    lines.push(`severity: ${t.severity || 'major'}`);
  }
  if (t.result === 'skipped' && t.reason) lines.push(`reason: ${t.reason}`);
  return lines.join('\n');
}

function summaryOf(tests) {
  const n = (r) => tests.filter((t) => t.result === r).length;
  return { total: tests.length, passed: n('pass'), issues: n('issue'), pending: n('pending'), skipped: n('skipped') };
}

function gapsOf(tests, gapExtras) {
  return tests.filter((t) => t.result === 'issue').map((t) => ({
    truth: t.expected, status: 'failed', reason: `User reported: ${t.reported || ''}`.trim(), severity: t.severity || 'major', test: t.number,
    ...(gapExtras.get(t.number) || {}),
  }));
}

function renderGaps(gaps) {
  return gaps.map((g) => {
    const lines = [`- truth: ${quote(g.truth)}`, `  status: ${g.status}`, `  reason: ${quote(g.reason)}`, `  severity: ${g.severity}`, `  test: ${g.test}`];
    for (const k of KEEP_GAP_FIELDS) if (g[k]) lines.push(`  ${k}: ${g[k]}`);
    return lines.join('\n');
  }).join('\n');
}

/** Set one test's result and rebuild the summary and the gaps. */
function recordUatResult(cwd, phase, input) {
  const file = uatPath(cwd, phase);
  if (!file) return { error: 'uat_not_found', reason: `no {phase}-uat.md in phase ${phase} (create one with scaffold uat)` };
  if (!RESULTS.includes(input.result)) return { error: 'invalid_result', reason: `result is one of ${RESULTS.join(', ')}` };
  if (input.severity && !SEVERITIES.includes(input.severity)) return { error: 'invalid_severity', reason: `severity is one of ${SEVERITIES.join(', ')}` };
  const raw = fs.readFileSync(file, 'utf8');
  const eol = dominantEol(raw);
  let text = toLf(raw);
  const u = parseUat(text);
  const t = u.tests.find((x) => x.number === Number(input.test));
  if (!t) return { error: 'test_not_found', reason: `uat.md has no test ${input.test}` };
  t.result = input.result;
  t.reported = input.result === 'issue' ? (input.reported || t.reported || '') : null;
  t.severity = input.result === 'issue' ? (input.severity || t.severity || 'major') : null;
  t.reason = input.result === 'skipped' ? (input.reason || t.reason || null) : null;

  const testsBody = '\n' + u.tests.map(renderTest).join('\n\n') + '\n\n';
  text = text.replace(/^## Tests\s*$[\s\S]*?(?=^## |(?![\s\S]))/m, `## Tests\n${testsBody}`);
  const s = summaryOf(u.tests);
  const summary = `## Summary\n\ntotal: ${s.total}\npassed: ${s.passed}\nissues: ${s.issues}\npending: ${s.pending}\nskipped: ${s.skipped}\n\n`;
  text = /^## Summary\s*$/m.test(text) ? text.replace(/^## Summary\s*$[\s\S]*?(?=^## |(?![\s\S]))/m, summary) : text + `\n${summary}`;
  const gaps = gapsOf(u.tests, u.gapExtras);
  const gapsBlock = `## Gaps\n\n<!-- YAML format for plan-phase --gaps consumption -->\n${gaps.length ? renderGaps(gaps) + '\n' : ''}`;
  text = /^## Gaps\s*$/m.test(text) ? text.replace(/^## Gaps\s*$[\s\S]*?(?=^## |(?![\s\S]))/m, gapsBlock) : text + `\n${gapsBlock}`;
  const now = new Date().toISOString();
  text = text.replace(/^updated:.*$/m, `updated: ${now}`);
  if (s.pending === 0) text = text.replace(/^status:\s*testing\s*$/m, 'status: complete');
  fs.writeFileSync(file, withEol(text, eol));
  return { recorded: true, test: t.number, result: t.result, ...s, complete: s.pending === 0, gaps: gaps.length };
}

function uatStatus(cwd, phase) {
  const file = uatPath(cwd, phase);
  if (!file) return { error: 'uat_not_found', reason: `no {phase}-uat.md in phase ${phase}` };
  const u = parseUat(fs.readFileSync(file, 'utf8'));
  const s = summaryOf(u.tests);
  return { file: path.basename(file), status: u.status, ...s, complete: s.pending === 0, gaps: gapsOf(u.tests, u.gapExtras) };
}

function cmdUatRecord(cwd, phase, opts, raw) {
  if (!phase || !opts.test || !opts.result) error('Usage: uat record <phase> --test N --result pass|issue|skipped [--reported "…"] [--severity S] [--reason "…"]');
  const r = recordUatResult(cwd, phase, opts);
  if (r.error) { output(r, raw, 'error', 1); return; }
  output(r, raw, `${r.test}: ${r.result}`);
}

function cmdUatStatus(cwd, phase, raw) {
  if (!phase) error('Usage: uat status <phase>');
  const r = uatStatus(cwd, phase);
  if (r.error) { output(r, raw, 'error', 1); return; }
  output(r, raw, `${r.passed} passed, ${r.issues} issues, ${r.pending} pending`);
}

module.exports = { parseUat, recordUatResult, uatStatus, cmdUatRecord, cmdUatStatus };
