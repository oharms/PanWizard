#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (resume-from-journal): the crash takes the last commit with it.
 * `git reset --hard HEAD~1` in <workspace>, so a journal line still names a commit that is
 * no longer reachable from HEAD.
 *
 *   node lose-last-commit.cjs <workspace>
 *
 * Prints JSON `{ reset, head }`.
 */
const { spawnSync } = require('child_process');

const [ws] = process.argv.slice(2);
const r = spawnSync('git', ['reset', '-q', '--hard', 'HEAD~1'], { cwd: ws, encoding: 'utf8' });
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim();
console.log(JSON.stringify({ reset: r.status === 0, head }));
process.exit(r.status === 0 ? 0 : 1);
