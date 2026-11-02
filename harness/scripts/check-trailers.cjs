#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (executor-trailers-live): after a real executor ran <plan>, check that
 * its task commits recorded themselves, then prove resume from those commits alone.
 *
 *   node check-trailers.cjs <workspace> <plan id> <task count>
 *
 * 1. Reads HEAD's history for `PAN-Step: <plan>/task-N` lines (the line the executor's
 *    commit template ends with) and maps each task to the commit that carries it.
 * 2. Moves the plan's journal aside, so the commits are the only record, and asks the
 *    INSTALLED pan-tools `journal resume-point`: every task must be proven by a trailer.
 * 3. Simulates a crash: resets to the parent of the newest task commit and asks again.
 *    The expected resume point is the lowest task that commit held (a coalesced commit
 *    holds several), so the check does not depend on how the executor grouped its commits.
 *
 * Prints JSON `{ recorded, missing, commits, coalesced, full: {all_done, sources},
 * rewind: {expected, resume_at, match} }` and exits 0 when every check holds.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [ws, plan, nArg] = process.argv.slice(2);
const n = Number(nArg);
const tools = path.join(ws, '.claude', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const git = (...a) => spawnSync('git', a, { cwd: ws, encoding: 'utf8' });
const esc = plan.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TRAILER = new RegExp(`^\\s*PAN-Step:\\s*${esc}\\/task-(\\d+)\\s*$`, 'gim');

const resumePoint = () => {
  const r = spawnSync(process.execPath, [tools, 'journal', 'resume-point', '--plan', plan], { cwd: ws, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return { error: (r.stderr || r.stdout || '').trim().slice(0, 300) }; }
};

// 1. Which commit carries each task's trailer (newest first, as git log lists them).
const log = git('log', '-n', '200', '--format=%h%x1f%B%x1e', 'HEAD').stdout || '';
const commits = [];
const byTask = new Map();
for (const rec of log.split('\x1e')) {
  const [sha, body] = rec.replace(/^\s+/, '').split('\x1f');
  if (!sha || !body) continue;
  const tasks = [...body.matchAll(TRAILER)].map((m) => Number(m[1]));
  if (!tasks.length) continue;
  commits.push({ sha, tasks });
  for (const t of tasks) if (!byTask.has(t)) byTask.set(t, sha);
}
const missing = [];
for (let i = 1; i <= n; i++) if (!byTask.has(i)) missing.push(`task-${i}`);

// 2. The commits alone must prove every task.
const phaseDir = path.join(ws, '.planning', 'phases');
let journal = null;
for (const d of fs.existsSync(phaseDir) ? fs.readdirSync(phaseDir) : []) {
  const f = path.join(phaseDir, d, `${plan}-journal.jsonl`);
  if (fs.existsSync(f)) journal = f;
}
if (journal) fs.renameSync(journal, journal + '.aside');
const full = resumePoint();
const sources = (full.completed || []).map((c) => c.source);

// 3. The crash takes the newest task commit (and everything after it) with it.
let rewind = { expected: null, resume_at: null, match: false };
if (commits.length) {
  const newest = commits[0];
  const expected = `task-${Math.min(...newest.tasks)}`;
  const reset = git('reset', '-q', '--hard', `${newest.sha}~1`);
  const after = reset.status === 0 ? resumePoint() : { error: 'reset failed' };
  // No evidence left (resume_at null) means the plan restarts at its first task.
  const at = after.resume_at ?? null;
  rewind = { expected, resume_at: at, match: (at ?? (after.error ? null : 'task-1')) === expected };
}

const out = {
  recorded: n - missing.length,
  missing,
  commits,
  coalesced: commits.some((c) => c.tasks.length > 1),
  journal_set_aside: Boolean(journal),
  full: { all_done: full.all_done === true, sources, error: full.error },
  rewind,
};
console.log(JSON.stringify(out));
process.exit(missing.length === 0 && out.full.all_done && sources.every((s) => s === 'trailer') && rewind.match ? 0 : 1);
