#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: give a seeded workspace history. A seed is applied as one commit; a
 * scenario that reviews a phase needs a base and the phase's own commits, or
 * `pan-tools review scope` finds no diff (a single-commit seed gives a reviewer a prompt
 * with no `diff --git` in it).
 *
 *   node apply-overlay.cjs <workspace> <overlay dir>
 *
 * Each `<overlay>/commits/<NN>-<name>/` directory, in name order, is copied over the
 * workspace and committed with the message in its `COMMIT_MSG`. Only the overlay's own
 * files are staged, never the PAN install beside them. Prints JSON
 * `{ applied, commits: [{sha, subject, files}], head }`; exits 1 on any failure.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function listFiles(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, acc);
    else if (!(dir === base && e.name === 'COMMIT_MSG')) acc.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return acc;
}

function applyOverlay(ws, overlay) {
  const git = (args) => spawnSync('git', ['-c', 'user.email=harness@pan.local', '-c', 'user.name=pan-harness', '-c', 'commit.gpgsign=false', ...args], { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const root = path.join(overlay, 'commits');
  if (!fs.existsSync(root)) return { applied: false, error: `no commits/ under ${overlay}` };
  const commits = [];
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const msgFile = path.join(dir, 'COMMIT_MSG');
    if (!fs.existsSync(msgFile)) return { applied: false, error: `${name} has no COMMIT_MSG` };
    const subject = fs.readFileSync(msgFile, 'utf8').trim();
    const files = listFiles(dir);
    for (const rel of files) {
      const dest = path.join(ws, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(dir, rel), dest);
    }
    const add = git(['add', '--', ...files]);
    if (add.status !== 0) return { applied: false, error: `git add failed for ${name}: ${add.stderr}` };
    const c = git(['commit', '-q', '-m', subject]);
    if (c.status !== 0) return { applied: false, error: `git commit failed for ${name}: ${c.stderr || c.stdout}` };
    commits.push({ sha: git(['rev-parse', 'HEAD']).stdout.trim(), subject, files });
  }
  return { applied: commits.length > 0, commits, head: commits.length ? commits[commits.length - 1].sha : null };
}

if (require.main === module) {
  const [ws, overlay] = process.argv.slice(2);
  if (!ws || !overlay || !fs.existsSync(ws)) {
    console.log(JSON.stringify({ applied: false, error: 'usage: apply-overlay.cjs <workspace> <overlay dir>' }));
    process.exit(1);
  }
  const r = applyOverlay(path.resolve(ws), path.resolve(overlay));
  console.log(JSON.stringify(r));
  process.exit(r.applied ? 0 : 1);
}

module.exports = { applyOverlay, listFiles };
