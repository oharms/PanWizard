#!/usr/bin/env node
/**
 * Glob-free test runner. `node --test tests/*.test.cjs` relies on shell glob
 * expansion: bash provides it (linux/macOS) and Node >=22 expands test-path
 * globs itself, but Windows PowerShell does neither on Node 18/20 — the
 * literal pattern "tests/*.test.cjs" matches no file and the run exits 1.
 * This script expands the pattern deterministically on every platform.
 *
 * Usage: node scripts/run-tests.cjs [--watch] <dir> [<dir> ...]
 *   Runs every *.test.cjs DIRECTLY inside each listed directory (no recursion,
 *   so `tests` and `tests/scenarios` stay separately addressable).
 *   --watch re-runs on change. It must go through this script too: since Node 21
 *   a bare `node --test --watch tests/` treats `tests/` as a glob pattern, fails
 *   to match the directory as a file, and crashes having run nothing (audit L36 /
 *   N8) — so the same deterministic expansion has to feed --watch.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const watch = argv[0] === '--watch';
const dirs = watch ? argv.slice(1) : argv;
if (dirs.length === 0) {
  console.error('Usage: node scripts/run-tests.cjs [--watch] <dir> [<dir> ...]');
  process.exit(1);
}

const files = [];
for (const dir of dirs) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    console.error(`run-tests: cannot read directory ${dir}: ${e.message}`);
    process.exit(1);
  }
  for (const name of entries.sort()) {
    if (name.endsWith('.test.cjs')) files.push(path.join(dir, name));
  }
}

if (files.length === 0) {
  console.error(`run-tests: no *.test.cjs files found in: ${dirs.join(', ')}`);
  process.exit(1);
}

const nodeArgs = watch ? ['--test', '--watch', ...files] : ['--test', ...files];
const result = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
