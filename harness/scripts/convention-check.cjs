#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the memory effect experiment on the `lesson-convention` seed
 * (memory optimisation O6). The project quirk: `npm test` runs only the test files
 * test/manifest.json lists. Phase 1 wrote a test and never listed it; the fix round
 * listed it and, through record_lessons, may have recorded a lesson. Measures:
 *
 *   recorded   lessons in .planning/memory/ carrying `evidence: finding:`
 *   injected   whether phase 2's pan-executor prompts carried a recorded lesson
 *              (orchestrator transcript; the step must persist its session)
 *   effect     whether phase 2 listed tests/farewell.test.js in test/manifest.json,
 *              which phase 2's plan never asks for — the behaviour the lesson teaches
 *
 *   node convention-check.cjs <workspace> recorded   → exits 1 unless a lesson was recorded
 *   node convention-check.cjs <workspace> effect     → exits 1 when farewell's test is missing
 *
 * The control scenario removes .planning/memory/ before phase 2, so its `effect` is
 * the rate without the lesson.
 */
const fs = require('fs');
const path = require('path');
const { projectDir } = require('./context-reads.cjs');
const { executorPrompts } = require('./memory-injection.cjs');
const { recordedLessons, carries } = require('./lesson-chain-check.cjs');

function listed(ws) {
  try {
    const files = JSON.parse(fs.readFileSync(path.join(ws, 'test', 'manifest.json'), 'utf8')).files;
    return Array.isArray(files) ? files.map((f) => String(f).replace(/\\/g, '/').replace(/^\.\//, '')) : null;
  } catch { return null; }
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
  const testExists = fs.existsSync(path.join(ws, 'tests', 'farewell.test.js'));
  if (!testExists) problems.push('tests/farewell.test.js is missing: phase 2 did not write its test');
  const files = listed(ws);
  if (files === null) problems.push('test/manifest.json is missing or unreadable');
  return {
    ...out,
    phase2_executor_spawns: phase2.length,
    lesson_injected: phase2.some((p) => lessons.some((l) => carries(p, l.lesson))),
    effect: { listed: !!files && files.includes('tests/farewell.test.js'), manifest: files },
    problems,
  };
}

if (require.main === module) {
  const [ws, stage = 'effect'] = process.argv.slice(2);
  if (!ws || !['recorded', 'effect'].includes(stage)) { process.stderr.write('usage: convention-check.cjs <workspace> recorded|effect\n'); process.exit(2); }
  const r = measure(ws, stage);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  const ok = stage === 'recorded' ? r.recorded_ok : fs.existsSync(path.join(ws, 'tests', 'farewell.test.js')) && Array.isArray(r.effect.manifest);
  process.exit(ok ? 0 : 1);
}

module.exports = { listed, measure };
