'use strict';

/** Is `name` runnable from PATH? Windows shims end in .cmd/.exe/.bat. Pure over the env passed in. */
const fs = require('fs');
const path = require('path');

function findCli(name, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      const p = path.join(d, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* keep looking */ }
    }
  }
  return null;
}

/**
 * Version of an installed CLI: runs `<bin> --version` and returns the first dotted
 * number in its output (`2.1.233 (Claude Code)` → `2.1.233`), or null when the binary
 * is absent, exits non-zero, or prints no version. Never throws.
 */
function cliVersion(name, env = process.env, platform = process.platform) {
  const bin = findCli(name, env, platform);
  if (!bin) return null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], shell: platform === 'win32' && /\.(cmd|bat)$/i.test(bin) });
    const m = String(out).match(/\d+\.\d+(?:\.\d+)*/);
    return m ? m[0] : null;
  } catch { return null; }
}

/** Dotted-version compare; missing segments read as 0. Returns -1 / 0 / 1. Pure. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Why a scenario's `requires` block is not met on this machine, or null when it is.
 * `requires.cli` must be on PATH; `requires.minVersion` (with a cli) must be satisfied by
 * `<cli> --version`. A skipped scenario is never green — the reason goes in the report.
 * Reality check R21 follow-up (2026-09-10): /skill-doctor exists from Claude Code 2.1.261;
 * on 2.1.233 the probe ran no turns and would otherwise record a harness error.
 */
function unmetRequirement(requires, env = process.env, platform = process.platform) {
  if (!requires) return null;
  if (requires.cli && !findCli(requires.cli, env, platform)) return `${requires.cli} not installed on this machine`;
  if (requires.minVersion) {
    if (!requires.cli) return 'requires.minVersion needs requires.cli';
    const v = cliVersion(requires.cli, env, platform);
    if (!v) return `${requires.cli} --version printed no version`;
    if (compareVersions(v, requires.minVersion) < 0) return `${requires.cli} ${v} is older than the required ${requires.minVersion}`;
  }
  return null;
}

module.exports = { findCli, cliVersion, compareVersions, unmetRequirement };
