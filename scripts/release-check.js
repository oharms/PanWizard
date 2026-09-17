#!/usr/bin/env node
/**
 * release-check.js — Pre-publish validation gate.
 *
 * Wired into `prepublishOnly` so `npm publish` fails BEFORE upload if any
 * gate is red. Runs nine checks in order; first failure aborts.
 *
 *   1. build:hooks      — hook scripts copy/build cleanly
 *   2. test:all         — full test suite (unit + scenario) passes
 *   3. npm audit        — no known vulnerabilities in production deps
 *                         (we have zero runtime deps, but the dev-deps are checked)
 *   4. doc-lint counts  — no drift-prone count violations in user-facing docs
 *   5. links validate   — doc↔code link graph resolves (no broken references)
 *   6. npm pack dry-run — package builds; size is sane; zero runtime dependencies
 *   7. smoke install    — npm pack + install into temp dir + run pan-tools list
 *                         catches "ships but doesn't actually work" failures
 *   8. bundles          — both plugin builders build; dist/pan-agent-plugin is fresh
 *   9. coverage gate    — the suite under Node's coverage: every dispatcher arm
 *                         executed, line/function floors per module group
 *                         (scripts/coverage-gate.cjs; skipped on Node < 22)
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
process.stderr.write('\n[release-check] Gate 1/9: build:hooks\n');
{
  const r = run('npm', ['run', 'build:hooks']);
  logGate('build:hooks', r.status === 0, r.status !== 0 ? `exit ${r.status}` : '');
  if (failed) process.exit(1);
}

// Gate 2: test:all
process.stderr.write('\n[release-check] Gate 2/9: test:all\n');
{
  const r = run('npm', ['run', 'test:all']);
  logGate('test:all', r.status === 0, r.status !== 0 ? `exit ${r.status}` : '');
  if (failed) process.exit(1);
}

// Gate 3: npm audit (production deps only)
if (SKIP_AUDIT) {
  process.stderr.write('\n[release-check] Gate 3/9: npm audit (SKIPPED)\n');
} else {
  process.stderr.write('\n[release-check] Gate 3/9: npm audit --omit=dev\n');
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
process.stderr.write('\n[release-check] Gate 4/9: doc-lint counts docs/\n');
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
process.stderr.write('\n[release-check] Gate 5/9: links validate\n');
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
process.stderr.write('\n[release-check] Gate 6/9: npm pack (size sanity)\n');
{
  const tmp6 = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-release-pack-'));
  const r = run('npm', ['pack', '--pack-destination', tmp6], { capture: true });
  const tgz = r.status === 0 ? fs.readdirSync(tmp6).find(f => f.endsWith('.tgz')) : null;
  const size = tgz ? fs.statSync(path.join(tmp6, tgz)).size : 0;
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  // R8: "zero runtime dependencies" is a headline claim (README, COMPARISON.md); a
  // dependency added by accident must turn the release red before it ships. The unit
  // pin is tests/package-contract.test.cjs; this is the publish-time backstop.
  const deps = Object.keys(require(path.join(REPO_ROOT, 'package.json')).dependencies || {});
  const zeroDeps = deps.length === 0;
  // Sane = a non-empty tarball under 50MB (large for a zero-runtime-dep tool)
  const ok = r.status === 0 && !!tgz && size > 0 && size < 50 * 1024 * 1024 && zeroDeps;
  logGate('npm pack', ok, (tgz ? `${sizeMB}MB tarball` : `no tarball (exit ${r.status})`) + (zeroDeps ? '' : `; runtime dependencies present: ${deps.join(', ')}`));
  fs.rmSync(tmp6, { recursive: true, force: true });
  if (!ok) {
    process.stderr.write((r.stderr || '') + '\n');
    process.exit(1);
  }
}

// Gate 7: smoke install — pack and install into temp dir, run pan-tools
if (SKIP_SMOKE) {
  process.stderr.write('\n[release-check] Gate 7/9: smoke install (SKIPPED)\n');
} else {
  process.stderr.write('\n[release-check] Gate 7/9: smoke install (npm pack + install + sanity)\n');
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

// Gate 8: distribution bundles — both plugin builders produce a manifest. Built into
// temp dirs (never dist/) so the gate cannot race a concurrently running test and
// leaves the checkout untouched. A bundle that fails to build is a release that
// ships a broken marketplace entry.
process.stderr.write('\n[release-check] Gate 8/9: distribution bundles (build:plugin + build:agent-plugin)\n');
{
  const tmp8 = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-release-bundles-'));
  try {
    const claudeOut = path.join(tmp8, 'claude');
    const agentOut = path.join(tmp8, 'agent');
    const a = run('node', [path.join(REPO_ROOT, 'scripts', 'build-plugin.js')], { capture: true, env: { ...process.env, PAN_PLUGIN_OUT: claudeOut } });
    const b = run('node', [path.join(REPO_ROOT, 'scripts', 'build-agent-plugin.js')], { capture: true, env: { ...process.env, PAN_AGENT_PLUGIN_OUT: agentOut } });
    const okA = a.status === 0 && fs.existsSync(path.join(claudeOut, '.claude-plugin', 'plugin.json'));
    const okB = b.status === 0 && fs.existsSync(path.join(agentOut, 'plugin.json')) && fs.existsSync(path.join(agentOut, 'mcp.json'));
    // R10: .agents/plugins/marketplace.json (Codex) and .github/plugin/marketplace.json
    // (Copilot) resolve to ./dist/pan-agent-plugin with no rebuild-on-resolve — unlike
    // the Claude `command` source. A stale dist/ shipped silently on 2026-09-10 (built
    // before the vendor-directory commit). Compare it with the fresh build when it
    // exists; the gate stays read-only and never writes dist/.
    let staleDetail = '';
    const distAgent = path.join(REPO_ROOT, 'dist', 'pan-agent-plugin');
    if (okB && fs.existsSync(distAgent)) {
      const { dirDigest } = require(path.join(REPO_ROOT, 'bin', 'install-lib.cjs'));
      if (dirDigest(distAgent) !== dirDigest(agentOut)) {
        staleDetail = 'dist/pan-agent-plugin is STALE — run `npm run build:agent-plugin` (the Codex and Copilot marketplaces install from it)';
      }
    }
    const ok8 = okA && okB && !staleDetail;
    const detail = ok8
      ? 'Claude plugin + Agent Plugins bundle built' + (fs.existsSync(distAgent) ? '; dist/pan-agent-plugin matches the fresh build' : '')
      : staleDetail || `claude:${okA ? 'ok' : 'FAIL exit ' + a.status} agent-plugins:${okB ? 'ok' : 'FAIL exit ' + b.status}`;
    logGate('distribution bundles', ok8, detail);
    if (!ok8) {
      process.stderr.write((a.stderr || '') + (b.stderr || '') + '\n');
      process.exit(1);
    }
  } finally {
    try { fs.rmSync(tmp8, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// Gate 9: coverage gate — the whole suite once more, under Node's own coverage
// instrumentation, then: every dispatcher case arm executed (or allowlisted with a
// reason in tests/fixtures/coverage-policy.json) and line/function floors per module
// group. Gate 2 says the tests pass; this gate says the shipped code ran. On Node
// below 22 the script reports "skipped" and exits 0 — the CI Node-22 job carries it.
process.stderr.write('\n[release-check] Gate 9/9: coverage gate (dispatcher arms + coverage floors)\n');
{
  const r = run('node', [path.join(REPO_ROOT, 'scripts', 'coverage-gate.cjs')], { capture: true });
  const text = ((r.stdout || '') + (r.stderr || '')).trim();
  const first = text.split('\n')[0] || '';
  logGate('coverage gate', r.status === 0, first.replace(/^coverage gate — /, ''));
  if (r.status !== 0) {
    process.stderr.write(text + '\n');
    process.exit(1);
  }
}

// Summary
process.stderr.write('\n[release-check] Summary:\n');
for (const c of checks) {
  process.stderr.write(`  [${c.ok ? 'OK' : 'FAIL'}] ${c.name}${c.detail ? ' — ' + c.detail : ''}\n`);
}
process.stderr.write(`\n[release-check] ${failed ? 'FAILED' : 'PASSED'}\n`);
process.exit(failed ? 1 : 0);
