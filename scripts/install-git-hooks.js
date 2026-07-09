#!/usr/bin/env node
/**
 * install-git-hooks.js
 *
 * Points this repo's git at `scripts/git-hooks/` instead of the per-clone
 * `.git/hooks/` directory. Run automatically by the `prepare` npm script,
 * which fires on `npm install` inside the source repo.
 *
 * Why this exists:
 *   `.git/hooks/` is per-clone (never committed). Without this, every fresh
 *   clone of PAN Wizard would have to manually `cp scripts/git-hooks/pre-commit
 *   .git/hooks/` to get the gitleaks pre-commit scan. With `core.hooksPath`
 *   set to the tracked `scripts/git-hooks/` directory, the hook is active
 *   the moment you finish `npm install`.
 *
 * No-op when not in a git working tree (e.g., the package is being installed
 * as a dependency in someone else's `node_modules/`, where there's no `.git`).
 *
 * Safe to re-run.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = 'scripts/git-hooks';

// 1. Are we in a git working tree? If not, this is a downstream install —
//    do nothing.
const gitDir = path.join(REPO_ROOT, '.git');
if (!fs.existsSync(gitDir)) {
  // Silent no-op for downstream consumers. Their `node_modules/pan-wizard/`
  // doesn't have its own .git directory.
  process.exit(0);
}

// 2. Set core.hooksPath. Idempotent — overwrites any previous value.
try {
  execFileSync('git', ['config', '--local', 'core.hooksPath', HOOKS_DIR], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
} catch (err) {
  // If `git` isn't on PATH or the config write fails, warn but don't fail
  // the install. The user can run this manually later.
  console.warn(`[install-git-hooks] could not set core.hooksPath: ${err.message}`);
  process.exit(0);
}

// 3. Confirm the hook file is executable on Unix. On Windows the bit doesn't
//    matter — Git Bash treats `.sh` and shebanged scripts as executable.
const hookFile = path.join(REPO_ROOT, HOOKS_DIR, 'pre-commit');
if (process.platform !== 'win32') {
  try {
    fs.chmodSync(hookFile, 0o755);
  } catch {
    // Best effort.
  }
}

console.error(`[install-git-hooks] core.hooksPath → ${HOOKS_DIR} (gitleaks pre-commit active)`);
