#!/usr/bin/env node
'use strict';

/**
 * Developer intake for PAN learning reports (`/pan:feedback`). Not shipped.
 *
 *   node harness/scripts/feedback-intake.cjs <file>... [--json] [--inbox]
 *   gh issue list --label feedback --json body -q '.[].body' | node harness/scripts/feedback-intake.cjs -
 *
 * Reads pasted reports (issue bodies, files, or stdin with `-`), takes each fenced
 * `pan-feedback` block, rejects any block whose schema is not `pan-feedback/1` or
 * whose top-level fields differ from the schema's or have the wrong type, keeps only PAN
 * tokens (names, codes, versions) from the rest, drops exact duplicates, and prints
 * what recurs across reports: gate refusals, judge classes users dismiss, forecast
 * misses, unfinished commands, and the suggested learnings that at least
 * MIN_REPORTS reports share. `--inbox` appends those to
 * harness/autopilot/state/inbox.md, the inbox the market watcher feeds; it never
 * writes the ideas ledger or the learnings store (promotion stays `learn promote`).
 * A count a report gives as `<3` is read as 1.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'pan-feedback/1';
const FIELDS = ['schema', 'pan', 'env', 'window', 'config', 'gate', 'judges', 'execution', 'cost', 'usage', 'guard', 'trace', 'suggestions'];
const MIN_REPORTS = 3;
const INBOX = path.join(__dirname, '..', 'autopilot', 'state', 'inbox.md');

const num = (v) => (typeof v === 'number' ? v : v === '<3' ? 1 : 0);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
// What each top-level field must be; a report is pasted by anyone, so nothing is assumed.
const SHAPES = { pan: isObj, env: isObj, window: isObj, config: isObj, gate: isObj, judges: isObj, execution: isObj, cost: isObj, usage: isObj, guard: isObj, trace: isObj, suggestions: Array.isArray };
// A PAN name, code or version: the only strings that may reach the output or the inbox.
const tok = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v);
// The suggestions the engine makes (feedback.cjs suggestions()), and the evidence that names each.
const SUGGESTION_KEYS = { judge_noise: ['agent', 'class'], gate_top_refusal: ['code'], forecast_low: [], no_test_command: [], command_unfinished: ['command'] };

/** Every pan-feedback block in a text, parsed and checked. */
function extract(text) {
  const out = [];
  const re = /```pan-feedback\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(String(text)))) {
    let block;
    try { block = JSON.parse(m[1]); } catch { out.push({ ok: false, why: 'not JSON' }); continue; }
    if (!block || block.schema !== SCHEMA) { out.push({ ok: false, why: `schema ${block && block.schema}` }); continue; }
    const keys = Object.keys(block);
    const extra = keys.filter((k) => !FIELDS.includes(k));
    const missing = FIELDS.filter((k) => !keys.includes(k));
    if (extra.length || missing.length) { out.push({ ok: false, why: `fields: extra ${extra.join(',') || '-'}, missing ${missing.join(',') || '-'}` }); continue; }
    const misshapen = Object.keys(SHAPES).filter((k) => !SHAPES[k](block[k]));
    if (block.usage && block.usage.commands_unfinished !== undefined && !Array.isArray(block.usage.commands_unfinished)) misshapen.push('usage.commands_unfinished');
    if (misshapen.length) { out.push({ ok: false, why: `wrong type: ${misshapen.join(',')}` }); continue; }
    out.push({ ok: true, block, hash: crypto.createHash('sha256').update(JSON.stringify(block)).digest('hex').slice(0, 16) });
  }
  return out;
}

/** Aggregate accepted reports. Pure. */
function aggregate(blocks) {
  const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const a = { reports: blocks.length, versions: {}, runtimes: {}, gate_refusals: {}, judge_classes: {}, forecast: { checked: 0, above_p90: 0 }, unfinished: {}, suggestions: {} };
  // Every string kept is a PAN token (tok): a pasted report cannot put prose, newlines or
  // instructions into the aggregate, or through --inbox into a file a model skill reads.
  for (const b of blocks) {
    const pan = obj(b.pan);
    add(a.versions, tok(pan.version) ? pan.version : 'other');
    for (const r of arr(pan.runtimes).filter(tok)) add(a.runtimes, r);
    for (const [code, n] of Object.entries(obj(obj(b.gate).refusals))) if (tok(code)) add(a.gate_refusals, code, num(n));
    for (const [agent, j] of Object.entries(obj(b.judges))) {
      if (!tok(agent)) continue;
      for (const [cls, c] of Object.entries(obj(obj(j).by_class))) {
        if (!tok(cls)) continue;
        const key = `${agent} ${cls}`;
        if (!a.judge_classes[key]) a.judge_classes[key] = { total: 0, dismissed: 0, reports: 0 };
        a.judge_classes[key].total += num(obj(c).total);
        a.judge_classes[key].dismissed += num(obj(c).dismissed);
        a.judge_classes[key].reports++;
      }
    }
    const forecast = obj(obj(b.cost).forecast);
    a.forecast.checked += num(forecast.checked);
    a.forecast.above_p90 += num(forecast.above_p90);
    for (const c of arr(obj(b.usage).commands_unfinished).filter(tok)) add(a.unfinished, c);
    const seen = new Set();
    for (const s of arr(b.suggestions)) {
      if (!isObj(s) || !Object.prototype.hasOwnProperty.call(SUGGESTION_KEYS, s.id)) continue;
      const parts = SUGGESTION_KEYS[s.id].map((k) => obj(s.evidence)[k]);
      if (!parts.every(tok)) continue;
      const key = [s.id, ...parts].join(' ');
      if (!seen.has(key)) { seen.add(key); add(a.suggestions, key); }
    }
  }
  a.recurring = Object.entries(a.suggestions).filter(([, n]) => n >= MIN_REPORTS).sort((x, y) => y[1] - x[1]).map(([key, reports]) => ({ key, reports }));
  return a;
}

function main(argv) {
  const json = argv.includes('--json');
  const inbox = argv.includes('--inbox');
  const inputs = argv.filter((x) => !x.startsWith('--'));
  if (!inputs.length) { process.stderr.write('usage: feedback-intake.cjs <file>... | - [--json] [--inbox]\n'); process.exitCode = 2; return; }
  const texts = inputs.map((f) => (f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8')));
  const found = texts.flatMap(extract);
  const rejected = found.filter((f) => !f.ok);
  const unique = new Map();
  for (const f of found.filter((x) => x.ok)) unique.set(f.hash, f.block);
  const a = aggregate([...unique.values()]);
  a.rejected = rejected.map((r) => r.why);
  a.duplicates = found.filter((x) => x.ok).length - unique.size;
  if (inbox && a.recurring.length) {
    const lines = a.recurring.map((r) => `- [feedback] ${r.key} — in ${r.reports} of ${a.reports} learning reports (${new Date().toISOString().slice(0, 10)})`);
    fs.mkdirSync(path.dirname(INBOX), { recursive: true });
    fs.appendFileSync(INBOX, lines.join('\n') + '\n');
  }
  if (json) { process.stdout.write(JSON.stringify(a, null, 2) + '\n'); return; }
  const L = [`${a.reports} report(s), ${a.duplicates} duplicate(s), ${a.rejected.length} rejected`];
  L.push(`Versions: ${Object.entries(a.versions).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
  L.push(`Gate refusals: ${Object.entries(a.gate_refusals).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
  for (const [k, c] of Object.entries(a.judge_classes).sort((x, y) => y[1].dismissed - x[1].dismissed).slice(0, 10)) L.push(`Judge ${k}: dismissed ${c.dismissed} of ${c.total} across ${c.reports} report(s)`);
  if (a.forecast.checked) L.push(`Forecast above p90: ${a.forecast.above_p90} of ${a.forecast.checked} phases`);
  L.push(`Recurring suggestions (>= ${MIN_REPORTS} reports): ${a.recurring.map((r) => `${r.key} (${r.reports})`).join('; ') || 'none yet'}`);
  process.stdout.write(L.join('\n') + '\n');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { extract, aggregate, SCHEMA, FIELDS, MIN_REPORTS };
