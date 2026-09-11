'use strict';

/**
 * Workspaces (ADR-0047 D1/D7): a fresh directory per scenario under the run dir,
 * seeded from harness/seeds/<name> (a PAN-shaped `.planning/` tree plus a tiny
 * project), then PAN installed into it FROM THE EXTRACTED PACKAGE.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME_DIR = { claude: '.claude', codex: '.codex', gemini: '.gemini', opencode: '.opencode', copilot: '.github' };

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}

/** Create the workspace, apply the seed, `git init` so PAN's git-aware verbs have a repo. */
function createWorkspace(runDir, name, seedDir) {
  const ws = path.join(runDir, 'ws', name);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  if (seedDir) copyTree(seedDir, ws);
  const git = (args) => spawnSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['-c', 'user.email=harness@pan.local', '-c', 'user.name=pan-harness', '-c', 'commit.gpgsign=false', 'add', '-A']);
  git(['-c', 'user.email=harness@pan.local', '-c', 'user.name=pan-harness', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed', '--allow-empty']);
  return ws;
}

/** Run the extracted package's installer inside the workspace. */
function installPan(installer, ws, flags) {
  const r = spawnSync(process.execPath, [installer, ...flags, '--local', '--skip-warnings'], {
    cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
    env: { ...process.env, PAN_PROJECT_ROOT: '' },
  });
  return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), error: r.error ? String(r.error.message) : undefined };
}

function panToolsPath(ws, runtime = 'claude') {
  return path.join(ws, RUNTIME_DIR[runtime] || '.claude', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
}

/** Run the INSTALLED pan-tools with an argv, from the workspace. */
function runPan(ws, argv, runtime = 'claude', timeoutMs = 120000) {
  const r = spawnSync(process.execPath, [panToolsPath(ws, runtime), ...argv], {
    cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs,
    env: { ...process.env, PAN_PROJECT_ROOT: '' },
  });
  return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), error: r.error ? String(r.error.message) : undefined };
}

module.exports = { createWorkspace, installPan, runPan, panToolsPath, copyTree, RUNTIME_DIR };
