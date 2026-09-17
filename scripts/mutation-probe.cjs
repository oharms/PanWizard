#!/usr/bin/env node
'use strict';
/**
 * Mutation probe — does the suite NOTICE when the code is wrong?
 *
 * Coverage says a line executed. It does not say an assertion depended on it. This probe
 * answers the harder question by breaking the code on purpose: apply one small mutation,
 * run the tests that claim to cover that file, and see whether anything turns red. A
 * mutation the suite does not catch is a **survivor** — a line that runs during the tests
 * and that no assertion actually constrains.
 *
 * Phase 6 of docs/specs/testing-system-redesign-2026-09.md. That phase proposed Stryker as
 * a devDependency; this is the same idea without one, for a specific reason: nearly every
 * test here asserts through a SPAWNED `pan-tools` process, so a mutation-testing framework
 * built around in-process instrumentation would have to re-run whole subprocess suites per
 * mutant anyway. What it would add over this file is a mutant catalogue and an HTML report,
 * at the cost of a large dependency tree in a repo whose headline claim is zero
 * dependencies. So: a sampled probe, dependency-free, and REPORT-ONLY.
 *
 * **This is not a gate and must never become one.** A survivor is a question ("should an
 * assertion pin this?"), and some survivors are correct — equivalent mutants, defensive
 * branches, log strings. Release-check does not run it and CI does not run it.
 *
 * Safety: mutations are applied inside a throwaway `git worktree`, never in your checkout.
 * The worktree is removed at the end, including after a crash.
 *
 *   node scripts/mutation-probe.cjs                      # default targets, 20 mutants
 *   node scripts/mutation-probe.cjs --max 50
 *   node scripts/mutation-probe.cjs --target hooks/pan-cost-logger.js
 *   node scripts/mutation-probe.cjs --seed 7 --json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/**
 * What to probe, and which tests are supposed to catch a break in it. The spec names the
 * hooks and the dispatcher first: the hooks because they are the code that writes the
 * ledger every field number comes from, the dispatcher because its arms are the surface a
 * user and an orchestrator hit.
 */
const TARGETS = [
  { file: 'hooks/pan-cost-logger.js', tests: ['tests/cost-logger-hook.test.cjs', 'tests/cost-logger.test.cjs'] },
  { file: 'hooks/pan-trace-logger.js', tests: ['tests/trace-logger.test.cjs'] },
  { file: 'pan-wizard-core/bin/lib/cost.cjs', tests: ['tests/cost.test.cjs'] },
  { file: 'pan-wizard-core/bin/lib/cost-rebuild.cjs', tests: ['tests/cost-rebuild.test.cjs'] },
  { file: 'pan-wizard-core/bin/pan-tools.cjs', tests: ['tests/dispatcher.test.cjs', 'tests/dispatcher-arms.test.cjs'] },
];

/**
 * The mutation operators. Each is a plain textual swap with a token that must appear
 * OUTSIDE a string or comment to be worth mutating (see mutableLine). They are deliberately
 * few and blunt: the point is to find unconstrained logic, not to enumerate every possible
 * defect.
 */
const OPERATORS = [
  { id: 'gte→gt', find: ' >= ', replace: ' > ' },
  { id: 'gt→gte', find: ' > ', replace: ' >= ' },
  { id: 'lte→lt', find: ' <= ', replace: ' < ' },
  { id: 'lt→lte', find: ' < ', replace: ' <= ' },
  { id: 'eq→neq', find: ' === ', replace: ' !== ' },
  { id: 'neq→eq', find: ' !== ', replace: ' === ' },
  { id: 'and→or', find: ' && ', replace: ' || ' },
  { id: 'or→and', find: ' || ', replace: ' && ' },
  { id: 'true→false', find: 'return true', replace: 'return false' },
  { id: 'false→true', find: 'return false', replace: 'return true' },
  { id: 'plus→minus', find: ' + 1', replace: ' - 1' },
];

/**
 * Is this line worth mutating? Skips comments, and skips a line whose only occurrence of
 * the token is inside a string literal — mutating a message changes nothing a test should
 * be pinning, and a survivor there would be noise.
 *
 * Crude but conservative: a line containing a quote is only mutated when the token also
 * occurs before the first quote.
 */
function mutableLine(line, token) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  const at = line.indexOf(token);
  if (at === -1) return false;
  const firstQuote = Math.min(
    ...["'", '"', '`'].map((q) => { const i = line.indexOf(q); return i === -1 ? Infinity : i; }),
  );
  return at < firstQuote;
}

/**
 * Every mutation available in a source file: one per (line, operator) pair, first
 * occurrence on the line.
 *
 * @returns {Array<{line: number, op: string, before: string, after: string}>}
 */
function mutationsFor(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    for (const op of OPERATORS) {
      if (!mutableLine(line, op.find)) continue;
      out.push({ line: i + 1, op: op.id, before: line, after: line.replace(op.find, op.replace) });
    }
  });
  return out;
}

/** Apply one mutation to a source string, by line number. Throws if the line moved. */
function applyMutation(src, mutation) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const idx = mutation.line - 1;
  if (lines[idx] !== mutation.before) {
    throw new Error(`line ${mutation.line} is not what the mutation was built from`);
  }
  lines[idx] = mutation.after;
  return lines.join(eol);
}

/** Deterministic shuffle, so a run is reproducible from its seed. */
function sample(items, n, seed) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function parseArgs(argv) {
  const a = { max: 20, seed: 1, json: false, targets: [], timeoutMs: 600000, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--max') { a.max = Math.max(1, Number(v) || 1); i++; }
    else if (k === '--seed') { a.seed = Number(v) || 1; i++; }
    else if (k === '--target') { a.targets.push(v); i++; }
    else if (k === '--timeout') { a.timeoutMs = Math.max(30000, Number(v) || 30000); i++; }
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

/**
 * Run one target's tests inside `cwd`. A mutation is CAUGHT when they fail.
 * A test run that cannot start at all counts as caught too — the code is broken enough
 * that nothing ran, which is not a survivor.
 */
function testsFail(cwd, tests, timeoutMs) {
  const r = spawnSync(process.execPath, ['--test', ...tests], {
    cwd, encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return true; // an infinite loop is a detection
  return r.status !== 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('node scripts/mutation-probe.cjs [--max n] [--seed n] [--target <file>]... [--timeout ms] [--json]\n');
    return 0;
  }

  const targets = args.targets.length
    ? TARGETS.filter((t) => args.targets.some((want) => t.file.endsWith(want.replace(/\\/g, '/'))))
    : TARGETS;
  if (!targets.length) {
    process.stderr.write(`no known target matched ${args.targets.join(', ')}\nknown: ${TARGETS.map((t) => t.file).join(', ')}\n`);
    return 1;
  }

  // Build the candidate list from the real sources, then sample across all targets so one
  // large file cannot crowd the others out.
  const candidates = [];
  for (const t of targets) {
    const src = fs.readFileSync(path.join(ROOT, t.file), 'utf-8');
    for (const m of mutationsFor(src)) candidates.push({ ...m, ...t });
  }
  const chosen = sample(candidates, args.max, args.seed);

  // Everything happens in a throwaway worktree: the probe never edits your checkout.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mutation-'));
  let created = false;
  const survivors = [];
  let caught = 0;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
    created = true;
    // The hooks are copied to hooks/dist by the build; tests that spawn the built copy
    // need it present in the worktree.
    spawnSync(process.execPath, ['scripts/build-hooks.js'], { cwd: wt, stdio: 'ignore' });

    let i = 0;
    for (const m of chosen) {
      i += 1;
      const file = path.join(wt, m.file);
      const original = fs.readFileSync(file, 'utf-8');
      let mutated;
      try {
        mutated = applyMutation(original, m);
      } catch {
        continue; // the worktree's copy differs from the working tree — skip, do not guess
      }
      if (mutated === original) continue;
      try {
        fs.writeFileSync(file, mutated);
        // A hook mutation must reach the built copy the tests spawn.
        if (m.file.startsWith('hooks/')) spawnSync(process.execPath, ['scripts/build-hooks.js'], { cwd: wt, stdio: 'ignore' });
        const detected = testsFail(wt, m.tests, args.timeoutMs);
        if (detected) caught += 1;
        else survivors.push(m);
        if (!args.json) {
          process.stdout.write(`  [${String(i).padStart(2)}/${chosen.length}] ${detected ? 'caught  ' : 'SURVIVED'} ${m.file}:${m.line} ${m.op}\n`);
        }
      } finally {
        fs.writeFileSync(file, original);
        if (m.file.startsWith('hooks/')) spawnSync(process.execPath, ['scripts/build-hooks.js'], { cwd: wt, stdio: 'ignore' });
      }
    }
  } finally {
    if (created) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' }); } catch { /* fall through */ }
    }
    fs.rmSync(wt, { recursive: true, force: true });
    try { execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'ignore' }); } catch { /* best effort */ }
  }

  const ran = caught + survivors.length;
  const report = {
    candidates: candidates.length,
    sampled: chosen.length,
    ran,
    caught,
    survived: survivors.length,
    score: ran ? Number(((caught / ran) * 100).toFixed(1)) : null,
    seed: args.seed,
    survivors: survivors.map((s) => ({ file: s.file, line: s.line, op: s.op, code: s.before.trim().slice(0, 120) })),
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`\nmutation probe — REPORT ONLY, never a gate\n`);
  process.stdout.write(`  ${report.caught} caught / ${report.ran} run (${report.score === null ? 'n/a' : report.score + '%'}), from ${report.candidates} candidates, seed ${report.seed}\n`);
  if (survivors.length) {
    process.stdout.write(`\n  survivors — the suite ran this line and no assertion constrained it:\n`);
    for (const s of report.survivors) process.stdout.write(`    ${s.file}:${s.line}  ${s.op}\n      ${s.code}\n`);
    process.stdout.write('\n  Each is a question, not a verdict: some are equivalent mutants or defensive\n  branches where no assertion is owed. Pin the ones that describe real behaviour.\n');
  } else {
    process.stdout.write('\n  no survivors in this sample\n');
  }
  return 0;
}

module.exports = { mutationsFor, applyMutation, mutableLine, sample, OPERATORS, TARGETS };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`mutation probe failed: ${e.message}\n`);
    process.exit(1);
  }
}
