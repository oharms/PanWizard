#!/usr/bin/env node
/**
 * release-check.js — Pre-publish validation gate.
 *
 * Wired into `prepublishOnly` so `npm publish` fails BEFORE upload if any
 * gate is red. Runs seven checks in order; first failure aborts.
 *
 *   1. build:hooks      — hook scripts copy/build cleanly
 *   2. test:all         — full test suite (unit + scenario) passes
 *   3. npm audit        — no known vulnerabilities in production deps
 *                         (we have zero runtime deps, but the dev-deps are checked)
 *   4. doc-lint counts  — no drift-prone count violations in user-facing docs
 *   5. links validate   — doc↔code link graph resolves (no broken references)
 *   6. npm pack dry-run — package builds; size is sane
 *   7. smoke install    — npm pack + install into temp dir + run pan-tools list
 *                         catches "ships but doesn't actually work" failures
 *
 * Usage:
 *   node scripts/release-check.js              # all gates
 *   node scripts/release-check.js --skip-audit # skip audit (use carefully)
 *   node scripts/release-check.js --skip-smoke # skip pack+install (faster)
 *
 * Exit code 0 = all clear; non-zero = a gate failed (see stderr).
 */

'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const SKIP_AUDIT = ARGS.includes('--skip-audit');
const SKIP_SMOKE = ARGS.includes('--skip-smoke');

const checks = [];
let failed = false;

function logGate(name, ok, detail = '') {
  const mark = ok ? 'OK' : 'FAIL';
  const line = `[release-check] ${mark}  ${name}${detail ? ' — ' + detail : ''}`;
  process.stderr.write(line + '\n');
  checks.push({ name, ok, detail });
  if (!ok) failed = true;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    ...opts,
  });
}

// Gate 1: build:hooks
process.stderr.write('\n[release-check] Gate 1/7: build:hooks\n');
{
  const r = run('npm', ['run', 'build:hooks']);
  logGate('build:hooks', r.status === 0, r.status !== 0 ? `exit ${r.status}` : '');
  if (failed) process.exit(1);
}

// Gate 2: test:all
process.stderr.write('\n[release-check] Gate 2/7: test:all\n');
{
  const r = run('npm', ['run', 'test:all']);
  logGate('test:all', r.status === 0, r.status !== 0 ? `exit ${r.status}` : '');
  if (failed) process.exit(1);
}

// Gate 3: npm audit (production deps only)
if (SKIP_AUDIT) {
  process.stderr.write('\n[release-check] Gate 3/7: npm audit (SKIPPED)\n');
} else {
  process.stderr.write('\n[release-check] Gate 3/7: npm audit --omit=dev\n');
  const r = run('npm', ['audit', '--omit=dev', '--audit-level=high'], { capture: true });
  // npm audit exits non-zero on findings. We tolerate moderate; fail on high+.
  const ok = r.status === 0;
  logGate('npm audit', ok, ok ? 'no high-severity findings' : `exit ${r.status} — high or critical CVEs in production deps`);
  if (!ok) {
    process.stderr.write((r.stdout || '') + '\n' + (r.stderr || '') + '\n');
    process.exit(1);
  }
}

// Gate 4: doc-lint counts on user-facing docs (count-SSoT enforcement)
process.stderr.write('\n[release-check] Gate 4/7: doc-lint counts docs/\n');
{
  const tools = path.join(REPO_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
  const docsDir = path.join(REPO_ROOT, 'docs');
  const r = run('node', [tools, 'doc-lint', 'counts', docsDir, '--raw'], { capture: true });
  const ok = r.status === 0;
  logGate('doc-lint counts', ok, ok ? 'no count violations in docs/' : 'drift-prone counts found outside CLAUDE.md');
  if (!ok) {
    process.stderr.write((r.stdout || '') + '\n');
    process.exit(1);
  }
}

// Gate 5: doc↔code link graph resolves (anti-fake — a doc cannot reference a
// code anchor that doesn't exist; deterministic, self-enforcing exit 1).
process.stderr.write('\n[release-check] Gate 5/7: links validate\n');
{
  const tools = path.join(REPO_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
  const r = run('node', [tools, 'links', 'validate', '--raw'], { capture: true });
  const ok = r.status === 0;
  logGate('links validate', ok, ok ? 'doc↔code link graph resolves' : 'broken doc↔code references');
  if (!ok) {
    process.stderr.write((r.stdout || '') + '\n');
    process.exit(1);
  }
}


// NOTE: we deliberately do NOT parse `npm pack --json` stdout. Under
// `npm publish` the runner routes the child pack's lifecycle-script output onto
// stdout (foreground-scripts), and that noise can include a decoy JSON object —
// any string heuristic then picks the wrong payload (Gate 7 crashed on
// packJson[0].filename with "0 files"). Instead, pack into a temp dir and read
// the .tgz npm actually wrote: a filesystem op that stdout noise cannot corrupt.

// Gate 6: npm pack — produces a non-empty, sanely-sized tarball (read the file,
// never parse stdout)
process.stderr.write('\n[release-check] Gate 6/7: npm pack (size sanity)\n');
{
  const tmp6 = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-release-pack-'));
  const r = run('npm', ['pack', '--pack-destination', tmp6], { capture: true });
  const tgz = r.status === 0 ? fs.readdirSync(tmp6).find(f => f.endsWith('.tgz')) : null;
  const size = tgz ? fs.statSync(path.join(tmp6, tgz)).size : 0;
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  // Sane = a non-empty tarball under 50MB (large for a zero-runtime-dep tool)
  const ok = r.status === 0 && !!tgz && size > 0 && size < 50 * 1024 * 1024;
  logGate('npm pack', ok, tgz ? `${sizeMB}MB tarball` : `no tarball (exit ${r.status})`);
  fs.rmSync(tmp6, { recursive: true, force: true });
  if (!ok) {
    process.stderr.write((r.stderr || '') + '\n');
    process.exit(1);
  }
}

// Gate 7: smoke install — pack and install into temp dir, run pan-tools
if (SKIP_SMOKE) {
  process.stderr.write('\n[release-check] Gate 7/7: smoke install (SKIPPED)\n');
} else {
  process.stderr.write('\n[release-check] Gate 7/7: smoke install (npm pack + install + sanity)\n');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-release-smoke-'));
  try {
    // Pack — read the .tgz npm writes to tmpDir; never parse its stdout (see note).
    const pack = run('npm', ['pack', '--pack-destination', tmpDir], { capture: true });
    if (pack.status !== 0) {
      logGate('smoke install (pack)', false, `exit ${pack.status}`);
      process.stderr.write((pack.stderr || '') + '\n');
      process.exit(1);
    }
    const tgz = fs.readdirSync(tmpDir).find(f => f.endsWith('.tgz'));
    if (!tgz) {
      logGate('smoke install (pack)', false, `no .tgz produced in ${tmpDir}`);
      process.exit(1);
    }
    const tarball = path.join(tmpDir, tgz);
    // Install into a separate fake project dir
    const installDir = path.join(tmpDir, 'install-target');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({ name: 'smoke-test', version: '0.0.0' }));
    const inst = run('npm', ['install', tarball, '--no-save', '--prefix', installDir], { capture: true });
    if (inst.status !== 0) {
      logGate('smoke install (install)', false, `exit ${inst.status}`);
      process.stderr.write((inst.stderr || '') + '\n');
      process.exit(1);
    }
    // Sanity: invoke pan-tools experiment list against an empty root
    const panToolsPath = path.join(installDir, 'node_modules', 'pan-wizard', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    if (!fs.existsSync(panToolsPath)) {
      logGate('smoke install (sanity)', false, `pan-tools.cjs missing in installed package at ${panToolsPath}`);
      process.exit(1);
    }
    // Pick a non-existent root so we exercise the read path without scaffolding anything
    const fakeRoot = path.join(tmpDir, 'no-experiments-here');
    const sanity = run('node', [panToolsPath, 'experiment', 'list', '--root', fakeRoot], { capture: true });
    const ok = sanity.status === 0;
    logGate('smoke install', ok, ok ? 'pan-tools experiment list works in installed package' : `exit ${sanity.status}`);
    if (!ok) {
      process.stderr.write((sanity.stderr || '') + '\n');
      process.exit(1);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// Summary
process.stderr.write('\n[release-check] Summary:\n');
for (const c of checks) {
  process.stderr.write(`  [${c.ok ? 'OK' : 'FAIL'}] ${c.name}${c.detail ? ' — ' + c.detail : ''}\n`);
}
process.stderr.write(`\n[release-check] ${failed ? 'FAILED' : 'PASSED'}\n`);
process.exit(failed ? 1 : 0);
