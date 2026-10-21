'use strict';
/**
 * The autodev proof dossier and replay (program A5).
 *
 *   autodev replay   re-runs the stop logic (autodev.cjs decideStop) over the inputs the
 *                    flight recorder wrote to blackbox.jsonl, and reports any decision it
 *                    would not make again. Identical decisions are the recorder's proof.
 *   autodev report   the dossier: per phase, requirement → plans → units and commits →
 *                    oracle evidence → verdict → dispositions → cost. Written beside the
 *                    ledger as dossier.md (the PR body) and dossier.html.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { output, escapeRegex, escapeTableCell } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { decideStop } = require('./autodev.cjs');

const runDir = (cwd, id) => planningPath(cwd, 'autodev', id);

function readRows(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

function latestRun(cwd) {
  try {
    const root = planningPath(cwd, 'autodev');
    return fs.readdirSync(root).filter((n) => n.startsWith('run-') && fs.existsSync(path.join(root, n, 'run.json')))
      .sort((a, b) => fs.statSync(path.join(root, b)).mtimeMs - fs.statSync(path.join(root, a)).mtimeMs)[0] || null;
  } catch { return null; }
}

/** Re-run decideStop over each recorded input; compare with the recorded decision. */
function replayRun(cwd, runId) {
  const id = runId || latestRun(cwd);
  if (!id) return { error: 'no_run', reason: 'no autodev run to replay' };
  const box = readRows(path.join(runDir(cwd, id), 'blackbox.jsonl'));
  if (!box.length) return { error: 'no_blackbox', reason: `run ${id} has no blackbox.jsonl` };
  const norm = (d) => (d ? { reason: d.reason, detail: d.detail } : null);
  const mismatches = [];
  box.forEach((b, index) => {
    const again = norm(decideStop(b.inputs));
    if (JSON.stringify(again) !== JSON.stringify(norm(b.decision))) mismatches.push({ index, recorded: norm(b.decision), replayed: again });
  });
  return { run: id, entries: box.length, identical: mismatches.length === 0, mismatches };
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function phaseSection(roadmap, num) {
  const re = new RegExp(`^#{2,4} Phase ${escapeRegex(String(num))}:([^\\n]*)\\n([\\s\\S]*?)(?=^#{2,4} Phase |(?![\\s\\S]))`, 'm');
  const m = roadmap.match(re);
  return m ? { name: m[1].trim(), body: m[2] } : { name: '', body: '' };
}

function phaseDir(cwd, num) {
  const root = planningPath(cwd, 'phases');
  const n = String(num);
  const padded = n.includes('.') ? n : n.padStart(2, '0');
  try {
    const d = fs.readdirSync(root).find((x) => x === padded || x.startsWith(`${padded}-`) || x.startsWith(`${n}-`));
    return d ? path.join(root, d) : null;
  } catch { return null; }
}

function frontmatterField(text, key) {
  const fm = String(text || '').match(/^---\n([\s\S]*?)\n---/);
  const m = fm && fm[1].match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'));
  return m ? m[1].trim() : null;
}

function commitsBetween(cwd, from, to) {
  if (!from || !to || from === to) return [];
  const r = spawnSync('git', ['log', '--oneline', '--no-decorate', `${from}..${to}`], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean) : [];
}

function buildDossier(cwd, runId) {
  const id = runId || latestRun(cwd);
  if (!id) return { error: 'no_run', reason: 'no autodev run to report' };
  const dir = runDir(cwd, id);
  let run = {};
  try { run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')); } catch {}
  const rows = readRows(path.join(dir, 'ledger.jsonl'));
  const finished = rows.filter((r) => r.status === 'finished');
  const stopped = rows.filter((r) => r.status === 'stopped').pop();
  const spent = finished.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
  const seqs = new Set(finished.map((r) => r.seq));
  let roadmap = '';
  try { roadmap = fs.readFileSync(planningPath(cwd, 'roadmap.md'), 'utf8').replace(/\r\n/g, '\n'); } catch {}
  const { phaseRequirementIds } = require('./roadmap.cjs');
  const { listFindings } = require('./findings.cjs');

  const lines = [`# Autodev dossier: ${id}`, ''];
  lines.push(`- **Host:** ${run.host || rows.map((r) => r.host).find(Boolean) || 'unknown'}`);
  lines.push(`- **Stopped:** ${stopped ? `${stopped.reason} — ${stopped.detail}` : 'still running, or interrupted'}`);
  lines.push(`- **Units:** ${seqs.size} (${finished.length} attempts)`);
  lines.push(`- **Spent:** ${money(spent)}${run.limits && run.limits.maxUsd != null ? ` of ${money(run.limits.maxUsd)}` : ''}`);

  const phases = [...new Set(finished.map((r) => r.unit && r.unit.phase).filter((p) => p != null))];
  const sections = [];
  for (const num of phases) {
    const sec = phaseSection(roadmap, num);
    const pdir = phaseDir(cwd, num);
    const files = pdir ? fs.readdirSync(pdir).sort() : [];
    const verification = files.find((f) => f === 'verification.md' || f.endsWith('-verification.md'));
    const vtext = verification ? fs.readFileSync(path.join(pdir, verification), 'utf8') : '';
    const mine = finished.filter((r) => r.unit && String(r.unit.phase) === String(num));
    const bySeq = new Map();
    for (const r of mine) { if (!bySeq.has(r.seq)) bySeq.set(r.seq, []); bySeq.get(r.seq).push(r); }
    const units = [...bySeq.values()].map((attempts) => {
      const a = attempts[0].unit.action;
      const cost = attempts.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
      const failures = attempts.filter((r) => r.failure_class).map((r) => `${r.failure_class} → ${r.policy}`);
      const recovered = attempts[attempts.length - 1].exit === 0 && failures.length ? ', recovered' : '';
      const note = attempts.length > 1 ? ` (${attempts.length} attempts: ${failures.join(', ')}${recovered})` : '';
      return a === 'complete_phase' ? `${a}${note}` : `${a} ${money(cost)}${note}`;
    });
    const starts = mine.map((r) => r.start_sha).filter(Boolean);
    const ends = mine.map((r) => r.end_sha).filter(Boolean);
    const commits = commitsBetween(cwd, starts[0], ends[ends.length - 1]);
    const f = listFindings(cwd, { phase: String(num) });
    const byStatus = Object.entries(f.counts.by_status || {}).map(([k, v]) => `${k} ${v}`).join(', ');
    const testGate = frontmatterField(vtext, 'test_gate');
    const status = frontmatterField(vtext, 'status');
    const reqs = phaseRequirementIds(sec.body);
    const cost = mine.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
    const rowsTable = [
      ['Requirements', reqs.length ? reqs.join(', ') : 'none recorded'],
      ['Plans', files.filter((x) => /-plan\.md$/i.test(x)).join(', ') || 'none'],
      ['Units', units.join(' · ')],
      ['Commits', commits.length ? commits.join('; ') : 'none recorded'],
      ['Oracle', testGate ? `test gate ${testGate}` : 'no test gate recorded'],
      ['Verdict', status ? `verification ${status}` : 'no verification'],
      ['Findings', f.counts.total ? `${f.counts.total} (${byStatus})` : 'none'],
      ['Cost', money(cost)],
    ];
    sections.push({ title: `Phase ${num}${sec.name ? `: ${sec.name}` : ''}`, rows: rowsTable });
    lines.push('', `## Phase ${num}${sec.name ? `: ${sec.name}` : ''}`, '', '| | |', '|---|---|');
    for (const [k, v] of rowsTable) lines.push(`| ${k} | ${escapeTableCell(String(v))} |`);
  }
  return { run: id, markdown: lines.join('\n') + '\n', sections, header: lines.slice(2, 6) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderHtml(d) {
  const head = d.header.map((l) => `<li>${esc(l.replace(/^- /, '').replace(/\*\*/g, ''))}</li>`).join('');
  const body = d.sections.map((s) => `<h2>${esc(s.title)}</h2><table>${s.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autodev dossier</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea}
@media (prefers-color-scheme: dark){:root{--bg:#161618;--fg:#f2f2f7;--muted:#a1a1a6;--line:#2c2c2e}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px}
th{text-align:left;color:var(--muted);font-weight:500;padding:6px 16px 6px 0;vertical-align:top;white-space:nowrap}
td{padding:6px 0;border-bottom:1px solid var(--line)}table{border-collapse:collapse;width:100%}h2{margin-top:32px}
</style></head><body>
<h1>Autodev dossier: ${esc(d.run)}</h1><ul>${head}</ul>
${body}
</body></html>
`;
}

function writeDossier(cwd, runId) {
  const d = buildDossier(cwd, runId);
  if (d.error) return d;
  const dir = runDir(cwd, d.run);
  fs.writeFileSync(path.join(dir, 'dossier.md'), d.markdown);
  fs.writeFileSync(path.join(dir, 'dossier.html'), renderHtml(d));
  const rel = (f) => path.relative(cwd, path.join(dir, f)).replace(/\\/g, '/');
  return { run: d.run, markdown: rel('dossier.md'), html: rel('dossier.html') };
}

function cmdAutodevReport(cwd, runId, raw) { const r = writeDossier(cwd, runId); output(r, raw, r.markdown || r.error); }
function cmdAutodevReplay(cwd, runId, raw) { const r = replayRun(cwd, runId); output(r, raw, r.error || String(r.identical)); }

module.exports = { replayRun, buildDossier, writeDossier, renderHtml, cmdAutodevReport, cmdAutodevReplay };
