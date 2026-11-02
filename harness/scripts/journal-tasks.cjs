#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (resume-from-journal): do what the executor's commit protocol does
 * for the first <n> tasks of <plan> — commit each task's file, then journal it through the
 * INSTALLED pan-tools (`journal step --event completed --commit <sha>`).
 *
 *   node journal-tasks.cjs <workspace> <plan id> <n>
 *
 * Prints JSON `{ journaled, commits }` and exits 0 when every step was recorded.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [ws, plan, nArg] = process.argv.slice(2);
const n = Number(nArg);
const tools = path.join(ws, '.claude', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const git = (...a) => spawnSync('git', ['-c', 'user.email=harness@pan.local', '-c', 'user.name=pan-harness', '-c', 'commit.gpgsign=false', ...a], { cwd: ws, encoding: 'utf8' });
const commits = [];
let journaled = 0;
for (let i = 1; i <= n; i++) {
  const file = path.join(ws, 'src', `task${i}.js`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `module.exports = ${i};\n`);
  git('add', file);
  git('commit', '-q', '-m', `feat(${plan}): task ${i}`);
  const sha = git('rev-parse', '--short', 'HEAD').stdout.trim();
  commits.push(sha);
  const r = spawnSync(process.execPath, [tools, 'journal', 'step', '--plan', plan, '--step', `task-${i}`, '--event', 'completed', '--commit', sha, '--by', 'harness'], { cwd: ws, encoding: 'utf8' });
  if (r.status === 0) journaled++;
}
console.log(JSON.stringify({ journaled, commits }));
process.exit(journaled === n ? 0 : 1);
