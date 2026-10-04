#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the memory lesson chain (memory optimisation O6). Measures,
 * in a workspace seeded from `lesson-chain`:
 *
 *   recorded   lessons in .planning/memory/ carrying `evidence: finding:` — what the
 *              fix round's record_lessons step wrote through `memory record`
 *   injected   whether phase 2's pan-executor prompts carried a recorded lesson
 *              (read from the orchestrator's transcript; needs persistSession)
 *   effect     whether phase 2's `farewell` rejects a bad name with a TypeError,
 *              the behaviour the phase 1 lesson teaches and phase 2's plan never
 *              asks for
 *
 *   node lesson-chain-check.cjs <workspace> recorded   → exits 1 unless a lesson was recorded
 *   node lesson-chain-check.cjs <workspace> effect     → exits 1 when farewell.js is missing
 *
 * The control scenario runs the same chain with the memory folder removed before
 * phase 2, so `effect` there is the rate without the lesson. Whether the layer earns
 * its keep is the difference between the two (docs/specs/memory-optimization-2026-10.md, O6).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { projectDir } = require('./context-reads.cjs');
const { executorPrompts } = require('./memory-injection.cjs');

const STOP = new Set(['that', 'this', 'with', 'when', 'from', 'every', 'each', 'into', 'than', 'then', 'name', 'names', 'function', 'functions', 'should', 'must']);
const words = (t) => new Set((String(t).toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)));

/** Lessons recorded through the gate: entries whose metadata names a finding. */
function recordedLessons(ws) {
  const dir = path.join(ws, '.planning', 'memory');
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return out; }
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^-\s+(?:\d{4}-\d{2}-\d{2}:\s*)?(.*?)\s*<!--([^>]*evidence:\s*finding:[^>]*)-->\s*$/);
      if (m) out.push({ agent: f.replace(/\.md$/, ''), lesson: m[1] });
    }
  }
  return out;
}

/** A prompt carries a lesson when it holds at least half the lesson's content words. */
function carries(prompt, lesson) {
  const want = words(lesson);
  if (!want.size) return false;
  const have = words(prompt);
  let hit = 0;
  for (const w of want) if (have.has(w)) hit++;
  return hit / want.size >= 0.5;
}

/** Does src/farewell.js reject undefined, 42 and '' with a TypeError? Run in a child, so a crash is data. */
function farewellRejects(ws) {
  const file = path.join(ws, 'src', 'farewell.js');
  if (!fs.existsSync(file)) return null;
  const probe = `const { farewell } = require(${JSON.stringify(file)}); const out = {};
for (const [k, v] of [['undefined', undefined], ['number', 42], ['empty', '']]) {
  try { farewell(v); out[k] = 'returned'; } catch (e) { out[k] = e instanceof TypeError ? 'TypeError' : (e && e.name) || 'threw'; }
}
console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', timeout: 10000 });
  try { return JSON.parse(r.stdout.trim()); } catch { return { error: (r.stderr || '').slice(0, 200) }; }
}

function measure(ws, stage, home) {
  const problems = [];
  const lessons = recordedLessons(ws);
  const out = { stage, lessons_recorded: lessons.length, recorded_ok: lessons.length > 0, lessons: lessons.map((l) => l.lesson) };
  if (stage === 'recorded') {
    if (!lessons.length) problems.push('the fix round recorded no lesson through memory record');
    return { ...out, problems };
  }
  let prompts = [];
  try {
    const dir = projectDir(ws, home);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) prompts.push(...executorPrompts(fs.readFileSync(path.join(dir, f), 'utf8').split('\n')));
  } catch { problems.push('no session transcript: the phase 2 step must set persistSession: true'); }
  const phase2 = prompts.filter((p) => /02-01|farewell/i.test(p));
  const injected = phase2.some((p) => lessons.some((l) => carries(p, l.lesson)));
  const cases = farewellRejects(ws);
  if (cases === null) problems.push('src/farewell.js is missing: phase 2 did not build');
  const validates = !!cases && ['undefined', 'number', 'empty'].every((k) => cases[k] === 'TypeError');
  return { ...out, phase2_executor_spawns: phase2.length, lesson_injected: injected, effect: { validates, cases }, problems };
}

if (require.main === module) {
  const [ws, stage = 'effect'] = process.argv.slice(2);
  if (!ws || !['recorded', 'effect'].includes(stage)) { process.stderr.write('usage: lesson-chain-check.cjs <workspace> recorded|effect\n'); process.exit(2); }
  const r = measure(ws, stage);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  const ok = stage === 'recorded' ? r.recorded_ok : r.effect && r.effect.cases !== null;
  process.exit(ok ? 0 : 1);
}

module.exports = { recordedLessons, carries, farewellRejects, measure };
