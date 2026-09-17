#!/usr/bin/env node
// Check for PAN updates in background, write result to cache
// Called by SessionStart hook - runs once per session
//
// Structure (M58, ADR audit 2026-08): the update-check logic used to live in
// an inline `node -e` string that was never parsed, linted, or executed by any
// test — a syntax error or field rename crashed the detached child silently
// forever. The logic now lives in exported pure functions (below) that are
// syntax-checked at load and unit-tested (tests/check-update-hook.test.cjs).
// The parent process still spawns a detached child so the ~10s `npm view`
// never blocks SessionStart; the child re-runs THIS file with `--run-check`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// ── Pure logic (exported for tests) ─────────────────────────────────────────

// Parse a version string into numeric [major, minor, patch, ...] components,
// dropping a leading 'v' and any pre-release/build metadata after '-' or '+'.
// Returns null when the string has no parseable numeric core.
function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const core = v.trim().replace(/^v/, '').split(/[-+]/)[0];
  if (!core) return null;
  const parts = core.split('.').map((n) => parseInt(n, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

// -1 if a < b, 0 if equal, 1 if a > b, null if either is unparseable.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

// L38: only flag an update when the installed version is strictly OLDER than
// npm latest. The old `installed !== latest` check flagged an update for ANY
// difference, so a source checkout ahead of the npm 'latest' dist-tag showed a
// permanent "update" badge that nudged the user to DOWNGRADE. Also skip the
// '0.0.0' sentinel (no VERSION file found → we don't know what's installed).
function isUpdateAvailable(installed, latest) {
  if (!latest) return false;
  if (!installed || installed === '0.0.0') return false;
  const cmp = compareVersions(installed, latest);
  // Unparseable tag: fall back to strict inequality (matches historical
  // behavior for odd tags; the '0.0.0' sentinel is already excluded above).
  if (cmp === null) return installed !== latest;
  return cmp < 0;
}

// Build the cache record consumed by the statusline.
function computeUpdateResult(installed, latest, nowSeconds) {
  return {
    update_available: isUpdateAvailable(installed, latest),
    installed,
    latest: latest || 'unknown',
    checked: nowSeconds != null ? nowSeconds : Math.floor(Date.now() / 1000),
  };
}

// Resolve the installed version: project VERSION wins over global VERSION.
// Falls back to the '0.0.0' sentinel when neither is readable.
function resolveInstalledVersion(fsMod, projectVersionFile, globalVersionFile) {
  let installed = '0.0.0';
  try {
    if (fsMod.existsSync(projectVersionFile)) {
      installed = fsMod.readFileSync(projectVersionFile, 'utf8').trim();
    } else if (fsMod.existsSync(globalVersionFile)) {
      installed = fsMod.readFileSync(globalVersionFile, 'utf8').trim();
    }
  } catch (e) { /* fall through to sentinel */ }
  return installed || '0.0.0';
}

// Perform the full check and write the cache file. `fetchLatest` is injectable
// so tests never touch the network; it returns the latest version or null.
function runCheck(opts) {
  const {
    fsMod = fs,
    cacheFile,
    projectVersionFile,
    globalVersionFile,
    fetchLatest,
    nowSeconds,
  } = opts;
  const installed = resolveInstalledVersion(fsMod, projectVersionFile, globalVersionFile);
  let latest = null;
  try {
    latest = fetchLatest ? fetchLatest() : null;
  } catch (e) {
    latest = null;
  }
  const result = computeUpdateResult(installed, latest, nowSeconds);
  fsMod.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}

// Default network fetch — queried only in the detached child, never in tests.
function defaultFetchLatest() {
  const { execSync } = require('child_process');
  return execSync('npm view pan-wizard version', {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    // Own the silence here rather than relying on the caller's stdio: 'ignore'. npm
    // writes registry and PATH failures to stderr, and a hook that lets them through
    // puts its own diagnostics in front of the user mid-session.
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// ── Runtime entry point ──────────────────────────────────────────────────────

function main() {
  const homeDir = os.homedir();
  const cwd = process.cwd();
  const cacheDir = path.join(homeDir, '.claude', 'cache');
  const cacheFile = path.join(cacheDir, 'pan-update-check.json');

  // VERSION file locations (check project first, then global)
  const projectVersionFile = path.join(cwd, '.claude', 'pan-wizard-core', 'VERSION');
  const globalVersionFile = path.join(homeDir, '.claude', 'pan-wizard-core', 'VERSION');

  // Ensure cache directory exists
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  } catch (e) { /* best-effort — a write failure below is swallowed too */ }

  if (process.argv.includes('--run-check')) {
    // Child mode: perform the (possibly slow) npm check synchronously, then
    // exit. Never surface errors — a hook must not crash the session.
    try {
      runCheck({
        cacheFile,
        projectVersionFile,
        globalVersionFile,
        fetchLatest: defaultFetchLatest,
      });
    } catch (e) { /* silent */ }
    return;
  }

  // Parent mode: run the check in a detached background child so the 10s
  // `npm view` never blocks SessionStart. windowsHide prevents a console flash.
  const child = spawn(process.execPath, [__filename, '--run-check'], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true, // Required on Windows for proper process detachment
  });
  child.unref();
}

if (require.main === module) {
  main();
}

module.exports = {
  parseVersion,
  compareVersions,
  isUpdateAvailable,
  computeUpdateResult,
  resolveInstalledVersion,
  runCheck,
};
