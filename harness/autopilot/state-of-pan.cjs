#!/usr/bin/env node
'use strict';
/**
 * The weekly State of PAN (program S5). Development only. Deterministic: the same files
 * and the same `now` give the same report.
 *
 * Reads: harness/autopilot/state/history.jsonl (suite runs: tests, failing, line
 * coverage), harness/prompt-mutants.jsonl (H6), the surface check, harness/ledger.jsonl
 * (open findings and their age), harness/autopilot/state/market-watch.json (fired
 * triggers), state/bot-runs.jsonl and state/spend.jsonl (the autopilot).
 *
 *   node harness/autopilot/state-of-pan.cjs [--now YYYY-MM-DD]   writes state/state-of-pan-<date>.md
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DAY = 24 * 60 * 60 * 1000;

function rows(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function json(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
const signed = (n, digits = 0) => `${n >= 0 ? '+' : ''}${digits ? n.toFixed(digits) : n}`;

function surfaceDrift(root) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'test-surface.cjs'), '--check'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return [];
  return `${r.stdout}\n${r.stderr}`.split('\n').map((l) => l.trim()).filter((l) => l && !/^surface registry|^liveness:/.test(l));
}

function buildReport({ root = ROOT, now, surfaceDrift: drift } = {}) {
  const today = now || new Date().toISOString().slice(0, 10);
  const t = Date.parse(`${today}T00:00:00Z`);
  const st = path.join(root, 'harness', 'autopilot', 'state');
  const inWeek = (ts) => { const x = Date.parse(ts); return x <= t + DAY && x > t - 7 * DAY; };
  const out = [`# State of PAN — week ending ${today}`, ''];

  const hist = rows(path.join(st, 'history.jsonl'));
  out.push('## Suite');
  if (hist.length) {
    out.push('| Run | Tests | Failing | Line coverage |', '|---|---|---|---|');
    for (const h of hist) out.push(`| ${String(h.ts).slice(0, 10)} | ${h.tests} | ${h.fail} | ${h.line_coverage != null ? `${h.line_coverage}%` : '—'} |`);
    const a = hist[0]; const b = hist[hist.length - 1];
    const cov = a.line_coverage != null && b.line_coverage != null ? `, coverage ${signed(Math.round((b.line_coverage - a.line_coverage) * 10) / 10, 1)} points` : '';
    out.push('', `Trend: ${signed(b.tests - a.tests)} tests${cov} over ${hist.length} runs.`);
  } else out.push('- no suite runs recorded');

  const mutants = rows(path.join(root, 'harness', 'prompt-mutants.jsonl'));
  const deco = mutants.filter((m) => m.verdict === 'decorative');
  out.push('', '## Prompt mutants');
  if (mutants.length) {
    out.push(`- decorative: ${deco.length}${deco.length ? ` (${deco.map((m) => m.rule).join(', ')})` : ''}`);
    out.push(`- load-bearing: ${mutants.filter((m) => m.verdict === 'load_bearing').length}`);
  } else out.push('- none run');

  const d = drift || surfaceDrift(root);
  out.push('', '## Surface', d.length ? d.map((x) => `- ${x}`).join('\n') : '- drift: none');

  const open = rows(path.join(root, 'harness', 'ledger.jsonl')).filter((f) => !f.resolved_at);
  out.push('', '## Open harness findings');
  if (open.length) {
    out.push('| Scenario | Detail | Age (days) |', '|---|---|---|');
    for (const f of open) out.push(`| ${f.scenario} | ${String(f.detail || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${Math.floor((t - Date.parse(f.first_seen)) / DAY)} |`);
  } else out.push('- none');

  const fired = (json(path.join(st, 'market-watch.json'), {}).fired || []).filter((f) => inWeek(`${f.at}T00:00:00Z`));
  out.push('', '## Fired WATCH triggers', fired.length ? fired.map((f) => `- ${f.id} (${f.at}): ${f.note}`).join('\n') : '- none');

  const bots = rows(path.join(st, 'bot-runs.jsonl')).filter((r) => inWeek(r.ts));
  const count = (o) => bots.filter((r) => r.outcome === o).length;
  out.push('', '## Bot branches', `- opened ${count('opened')}, merged ${count('merged')}, reverted ${count('reverted')}`);

  const month = today.slice(0, 7);
  const spend = rows(path.join(st, 'spend.jsonl')).filter((r) => String(r.ts).startsWith(month)).reduce((n, r) => n + (Number(r.usd) || 0), 0);
  out.push('', '## Autopilot spend', `- this month: $${spend.toFixed(2)}`);
  return out.join('\n') + '\n';
}

module.exports = { buildReport };

if (require.main === module) {
  const i = process.argv.indexOf('--now');
  const now = i >= 0 ? process.argv[i + 1] : new Date().toISOString().slice(0, 10);
  const report = buildReport({ root: ROOT, now });
  const file = path.join(__dirname, 'state', `state-of-pan-${now}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, report);
  process.stdout.write(report);
}
