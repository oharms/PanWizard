#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (program P1): how many clarifying questions did one questioning session
 * ask? Reads the step records the runner kept for this scenario's rep
 * (`<run>/steps/<scenario>-<rep>-<step>.json`, the model step and each scripted-user turn)
 * and counts, per reply, the lines that end in a question mark. The budget in
 * references/questioning.md is at most five per session.
 *
 *   node count-questions.cjs <workspace> <scenario id> [--max 5]
 *
 * Prints JSON `{ questions, rounds, per_round, max_per_round, max, within_budget,
 * context_written }` and exits 0 when the records were found (the expect list judges the
 * numbers), 1 when there were none to read. A heuristic: a question asked mid-line that does
 * not end the line is missed, a rhetorical one is counted; the per-round list is in the
 * output so a reader can check it against the step records.
 */
const fs = require('fs');
const path = require('path');

/** Lines of a reply that end in a question mark (markdown emphasis and quotes allowed after it). Pure. */
function questionLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /\?[*_`"')\]]*\s*$/.test(l));
}

/** The rep a workspace belongs to: `<id>-<rep>` when the run had reps, else 1. Pure. */
function repOf(wsName, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(wsName).match(new RegExp(`^${esc}-(\\d+)(?:-at-|--|$)`));
  return m ? Number(m[1]) : 1;
}

function countQuestions(ws, id, max = 5) {
  const runDir = path.dirname(path.dirname(ws));
  const stepsDir = path.join(runDir, 'steps');
  const rep = repOf(path.basename(ws), id);
  let files = [];
  try { files = fs.readdirSync(stepsDir).filter((f) => f.startsWith(`${id}-${rep}-`) && /-\d+\.json$/.test(f)); } catch { /* none */ }
  files.sort((a, b) => Number(a.match(/-(\d+)\.json$/)[1]) - Number(b.match(/-(\d+)\.json$/)[1]));
  const perRound = files.map((f) => {
    let rec = {};
    try { rec = JSON.parse(fs.readFileSync(path.join(stepsDir, f), 'utf8')); } catch { /* unreadable counts as empty */ }
    return { step: rec.step, questions: questionLines(rec.stdout).length, lines: questionLines(rec.stdout) };
  });
  const questions = perRound.reduce((n, r) => n + r.questions, 0);
  const phases = path.join(ws, '.planning', 'phases');
  let contextWritten = false;
  try { contextWritten = fs.readdirSync(phases).some((d) => { try { return fs.readdirSync(path.join(phases, d)).some((f) => /-context\.md$/.test(f)); } catch { return false; } }); } catch { /* no phases */ }
  return {
    found: files.length > 0, rep, rounds: perRound.length, questions, max,
    max_per_round: perRound.reduce((n, r) => Math.max(n, r.questions), 0),
    within_budget: questions <= max, context_written: contextWritten, per_round: perRound,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const [ws, id] = args;
  const mi = args.indexOf('--max');
  const max = mi >= 0 ? Number(args[mi + 1]) : 5;
  if (!ws || !id) { console.log(JSON.stringify({ found: false, error: 'usage: count-questions.cjs <workspace> <scenario id> [--max N]' })); process.exit(1); }
  const r = countQuestions(path.resolve(ws), id, max);
  console.log(JSON.stringify(r));
  process.exit(r.found ? 0 : 1);
}

module.exports = { questionLines, repOf, countQuestions };
