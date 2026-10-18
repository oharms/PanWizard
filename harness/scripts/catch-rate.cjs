#!/usr/bin/env node
'use strict';

/**
 * Detection scoreboard (program H4): how often does a judge catch a seeded defect, and how
 * often does it cry wolf on the clean twin? Every rate travels with its 95% Wilson interval
 * (H3), because 7/9 is [0.45, 0.94], not "78%".
 *
 * Input: JSONL result rows, one per judge run on one twin of one corpus entry:
 *   {corpus, twin: "clean"|"defect", judge, host, profile, report}
 * `report` is the judge's report text as the run returned it (a replayed cassette at $0, or
 * a recorded live run): its verdict is read with verdict.cjs parseVerdictText — the last
 * `pan-verdict` block, or a verification's frontmatter — exactly as PAN reads it.
 *
 *   flagged     the verdict's outcome is not `pass` (fail or needs_human)
 *   located     flagged, and a finding's `where` names the entry's truth file
 *   unreadable  no verdict could be read: counted, never scored as a catch or a miss
 *
 * Catch rate = flagged / scored defect twins; false-alarm rate = flagged / scored clean
 * twins, each distinct clean project counted once (generated entries share their base's).
 *
 *   node harness/scripts/catch-rate.cjs <results.jsonl>... [--json] [--compare <baseline-key> <candidate-key>]
 *
 * A key is "judge × host × profile". --compare runs the paired catch-rate SPRT (H3) on the
 * defect twins both keys judged: `h1` means the candidate catches more, `h0` that it does not.
 */

const fs = require('fs');
const path = require('path');
const { wilson, sprtPaired, pairedSignTest } = require('../src/stats.cjs');
const { loadCorpus, CORPUS_DIR } = require('../src/corpus.cjs');
const { parseVerdictText } = require('../../pan-wizard-core/bin/lib/verdict.cjs');

const keyOf = (r) => `${r.judge} × ${r.host} × ${r.profile}`;

/** Read JSONL rows from one or more files; a malformed line throws with its file and line. */
function readRows(files) {
  const rows = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      try { rows.push(JSON.parse(line)); } catch (e) { throw new Error(`${f}:${i + 1}: ${e.message}`); }
    });
  }
  return rows;
}

/**
 * Score one result row against its corpus entry.
 * @returns {{key, corpus, twin, category, status: 'flagged'|'passed'|'unreadable', located: boolean, reason?: string}}
 */
function scoreRow(row, entry) {
  const base = { key: keyOf(row), corpus: row.corpus, twin: row.twin, category: entry ? entry.category : null };
  if (!entry) return { ...base, status: 'unreadable', located: false, reason: `no corpus entry ${row.corpus}` };
  const parsed = parseVerdictText(String(row.report || ''), { agent: row.judge });
  if (!parsed.ok) return { ...base, status: 'unreadable', located: false, reason: parsed.reason };
  const v = parsed.verdict;
  const flagged = v.outcome !== 'pass';
  const truth = entry.truth.file.replace(/\\/g, '/');
  const located = flagged && v.findings.some((f) => f.where && f.where.replace(/\\/g, '/').includes(truth));
  return { ...base, status: flagged ? 'flagged' : 'passed', located };
}

/**
 * The scoreboard: one row per judge × host × profile.
 * @param {Object[]} rows - result rows
 * @param {Object[]} corpus - loadCorpus() entries
 */
function scoreboard(rows, corpus) {
  const byId = new Map(corpus.map((e) => [e.id, e]));
  const groups = new Map();
  for (const row of rows) {
    const s = scoreRow(row, byId.get(row.corpus));
    const g = groups.get(s.key) || { key: s.key, judge: row.judge, host: row.host, profile: row.profile, defect: [], clean: new Map(), unreadable: [] };
    groups.set(s.key, g);
    if (s.status === 'unreadable') { g.unreadable.push({ corpus: s.corpus, twin: s.twin, reason: s.reason }); continue; }
    if (s.twin === 'defect') g.defect.push(s);
    else if (s.twin === 'clean') {
      const e = byId.get(row.corpus);
      const project = e.mutation ? e.mutation.base : e.id;
      if (!g.clean.has(project)) g.clean.set(project, s);
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map((g) => {
    const caught = g.defect.filter((s) => s.status === 'flagged').length;
    const located = g.defect.filter((s) => s.located).length;
    const clean = [...g.clean.values()];
    const alarms = clean.filter((s) => s.status === 'flagged').length;
    const categories = {};
    for (const s of g.defect) {
      const c = categories[s.category] || (categories[s.category] = { caught: 0, n: 0 });
      c.n++; if (s.status === 'flagged') c.caught++;
    }
    return {
      key: g.key, judge: g.judge, host: g.host, profile: g.profile,
      catch: { caught, n: g.defect.length, interval: g.defect.length ? wilson(caught, g.defect.length) : null },
      located: { located, n: g.defect.length, interval: g.defect.length ? wilson(located, g.defect.length) : null },
      falseAlarm: { flagged: alarms, n: clean.length, interval: clean.length ? wilson(alarms, clean.length) : null },
      categories, unreadable: g.unreadable,
    };
  });
}

/**
 * Paired comparison of two keys on the defect twins both judged: does the candidate catch
 * more? (A weakened judge must come out lower: decision `h0`, with `aOnly` > `bOnly`.)
 */
function compare(rows, corpus, baselineKey, candidateKey, opts = {}) {
  const byId = new Map(corpus.map((e) => [e.id, e]));
  const outcome = (key) => {
    const m = new Map();
    for (const r of rows) {
      if (keyOf(r) !== key || r.twin !== 'defect') continue;
      const s = scoreRow(r, byId.get(r.corpus));
      if (s.status !== 'unreadable' && !m.has(r.corpus)) m.set(r.corpus, s.status === 'flagged');
    }
    return m;
  };
  const a = outcome(baselineKey);
  const b = outcome(candidateKey);
  const pairs = [...a.keys()].filter((id) => b.has(id)).sort().map((id) => [a.get(id), b.get(id)]);
  return { baseline: baselineKey, candidate: candidateKey, pairs: pairs.length, sign: pairedSignTest(pairs), sprt: sprtPaired(pairs, opts) };
}

const pct = (iv) => (iv ? `${(iv.p * 100).toFixed(0)}% [${(iv.lower * 100).toFixed(0)}, ${(iv.upper * 100).toFixed(0)}]` : '—');

/** The scoreboard as report.md lines. */
function renderMarkdown(board) {
  const lines = [
    '## Detection scoreboard', '',
    '| Judge × host × profile | Caught | Catch rate (95%) | Located | False alarms | False-alarm rate (95%) | Unreadable |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of board) {
    lines.push(`| ${r.key} | ${r.catch.caught}/${r.catch.n} | ${pct(r.catch.interval)} | ${r.located.located}/${r.located.n} | ${r.falseAlarm.flagged}/${r.falseAlarm.n} | ${pct(r.falseAlarm.interval)} | ${r.unreadable.length} |`);
  }
  lines.push('');
  for (const r of board) {
    const cats = Object.entries(r.categories).sort(([x], [y]) => x.localeCompare(y)).map(([c, v]) => `${c} ${v.caught}/${v.n}`).join(' · ');
    if (cats) lines.push(`- **${r.key}** by category: ${cats}`);
  }
  lines.push('');
  return lines;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const files = [];
  let json = false;
  let cmp = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--compare') { cmp = [argv[i + 1], argv[i + 2]]; i += 2; }
    else files.push(path.resolve(argv[i]));
  }
  if (!files.length) {
    process.stderr.write('usage: catch-rate.cjs <results.jsonl>... [--json] [--compare <baseline-key> <candidate-key>]\n');
    process.exit(2);
  }
  const corpus = loadCorpus(CORPUS_DIR);
  const rows = readRows(files);
  const board = scoreboard(rows, corpus);
  const comparison = cmp ? compare(rows, corpus, cmp[0], cmp[1]) : null;
  if (json) process.stdout.write(JSON.stringify({ scoreboard: board, comparison }, null, 2) + '\n');
  else {
    process.stdout.write(renderMarkdown(board).join('\n') + '\n');
    if (comparison) process.stdout.write(`Paired catch-rate SPRT, ${comparison.candidate} vs ${comparison.baseline}: ${comparison.sprt.decision} (baseline-only ${comparison.sprt.aOnly}, candidate-only ${comparison.sprt.bOnly}, ${comparison.pairs} pairs)\n`);
  }
}

module.exports = { keyOf, readRows, scoreRow, scoreboard, compare, renderMarkdown };
