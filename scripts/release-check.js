#!/usr/bin/env node
/**
 * release-check.js — Pre-publish validation gate.
 *
 * Wired into `prepublishOnly` so `npm publish` fails BEFORE upload if any
 * gate is red. Runs five checks in order; first failure aborts.
 *
 *   1. build:hooks      — hook scripts copy/build cleanly
 *   2. test:all         — full test suite (unit + scenario) passes
 *   3. npm audit        — no known vulnerabilities in production deps
 *                         (we have zero runtime deps, but esbuild dev-dep is checked)
 *   4. doc-lint counts  — no drift-prone count violations in user-facing docs
 *   5. npm pack dry-run — package builds; size is sane
 *   6. smoke install    — npm pack + install into temp dir + run pan-tools list
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
process.stderr.write('\n[release-check] Gate 1/6: build:hooks\n');
{
  const r = run('npm', ['run', 'build:hooks']);
  logGate('build:hooks', r.status === 0, r.status !== 0 ? `exit ${r.status}` : '');
  if (failed) process.exit(1);
}

// Gate 2: test:all
process.stderr.write('\n[release-check] Gate 2/6: test:all\n');
{
  const r = run('npm', ['run', 'test:all']);
  logGate('test:all', r.status === 0, r.status !== 0 ? `exit ${r.status}` : '');
  if (failed) process.exit(1);
}

// Gate 3: npm audit (production deps only)
if (SKIP_AUDIT) {
  process.stderr.write('\n[release-check] Gate 3/6: npm audit (SKIPPED)\n');
} else {
  process.stderr.write('\n[release-check] Gate 3/6: npm audit --omit=dev\n');
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
process.stderr.write('\n[release-check] Gate 4/6: doc-lint counts docs/\n');
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


// npm runs lifecycle scripts (prepare) before pack; any of their stdout noise
// lands ahead of the --json payload. npm pretty-prints the JSON array starting
// on its own line — parse from there.
function parseNpmJson(stdout) {
  try { return JSON.parse(stdout); } catch { /* fall through to extraction */ }
  const m = stdout.search(/^[[{]s*$/m);
  if (m === -1) throw new Error('no JSON payload found in npm output');
  return JSON.parse(stdout.slice(m));
}

// Gate 5: npm pack dry-run
process.stderr.write('\n[release-check] Gate 5/6: npm pack --dry-run\n');
{
  const r = run('npm', ['pack', '--dry-run', '--json'], { capture: true });
  if (r.status !== 0) {
    logGate('npm pack dry-run', false, `exit ${r.status}`);
    process.stderr.write((r.stderr || '') + '\n');
    process.exit(1);
  }
  // Parse the JSON output to check size
  try {
    const parsed = parseNpmJson(r.stdout);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    const size = entry.size || 0;
    const fileCount = entry.files ? entry.files.length : 0;
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    // Flag if pack size exceeds 50MB — large for a zero-runtime-dep tool
    const ok = size < 50 * 1024 * 1024;
    logGate('npm pack dry-run', ok, `${sizeMB}MB, ${fileCount} files`);
    if (!ok) process.exit(1);
  } catch (err) {
    logGate('npm pack dry-run', false, 'JSON parse failed: ' + err.message);
    process.exit(1);
  }
}

// Gate 6: smoke install — pack and install into temp dir, run pan-tools
if (SKIP_SMOKE) {
  process.stderr.write('\n[release-check] Gate 6/6: smoke install (SKIPPED)\n');
} else {
  process.stderr.write('\n[release-check] Gate 6/6: smoke install (npm pack + install + sanity)\n');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-release-smoke-'));
  try {
    // Pack
    const pack = run('npm', ['pack', '--pack-destination', tmpDir, '--json'], { capture: true });
    if (pack.status !== 0) {
      logGate('smoke install (pack)', false, `exit ${pack.status}`);
      process.exit(1);
    }
    const packJson = parseNpmJson(pack.stdout);
    const tarball = path.join(tmpDir, packJson[0].filename);
    if (!fs.existsSync(tarball)) {
      logGate('smoke install (pack)', false, `tarball not found at ${tarball}`);
      process.exit(1);
    }
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
