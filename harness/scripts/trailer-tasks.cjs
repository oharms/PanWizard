#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (resume-from-trailers): do what the executor's commit protocol does
 * for the first <n> tasks of <plan> — commit each task's file with raw git, the message
 * ending in `PAN-Step: <plan>/task-N` — and make NO journal call, so the commits are the
 * only record.
 *
 *   node trailer-tasks.cjs <workspace> <plan id> <n>
 *
 * Prints JSON `{ committed, commits }` and exits 0 when every task was committed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [ws, plan, nArg] = process.argv.slice(2);
const n = Number(nArg);
const git = (...a) => spawnSync('git', ['-c', 'user.email=harness@pan.local', '-c', 'user.name=pan-harness', '-c', 'commit.gpgsign=false', ...a], { cwd: ws, encoding: 'utf8' });
const commits = [];
for (let i = 1; i <= n; i++) {
  const file = path.join(ws, 'src', `task${i}.js`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `module.exports = ${i};\n`);
  git('add', file);
  if (git('commit', '-q', '-m', `feat(${plan}): task ${i}\n\n- task ${i}\n\nPAN-Step: ${plan}/task-${i}\n`).status !== 0) break;
  commits.push(git('rev-parse', '--short', 'HEAD').stdout.trim());
}
console.log(JSON.stringify({ committed: commits.length, commits }));
process.exit(commits.length === n ? 0 : 1);
