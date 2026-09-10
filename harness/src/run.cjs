#!/usr/bin/env node
'use strict';

/**
 * PAN Harness runner (ADR-0047).
 *
 *   node harness/src/run.cjs [--scenario <id>]... [--tier 0|1|2] [--max-usd <n>]
 *                            [--repeat <n>] [--state-dir <dir>] [--repo <dir>] [--keep]
 *
 * Tier 0 (default) is model-free and free. A model step is REFUSED without an
 * explicit --max-usd; the cap is enforced from measured spend and reaching it ends
 * the run with a run-level note, not a finding against PAN.
 *
 * Every run: pack the repo → extract → install from the package (never the source
 * tree) → for each scenario: workspace + seed → install → steps → assertions.
 * Output: <state>/<run-id>/report.md + report.json, and harness/ledger.jsonl merged.
 * Exit 1 when any step failed. Skips (missing CLI) are recorded, never green.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { packAndExtract } = require('./artifact.cjs');
const { loadScenarios } = require('./scenario.cjs');
const { createWorkspace, installPan, runPan } = require('./workspace.cjs');
const { rpcBatch, materialise } = require('./mcp.cjs');
const { runModelStep } = require('./model.cjs');
const { check } = require('./assert.cjs');
const { readLedger, writeLedger, mergeRun, isPromotable } = require('./ledger.cjs');
const { findCli, unmetRequirement } = require('./cli-detect.cjs');

const HARNESS_ROOT = path.join(__dirname, '..');
const DEFAULT_REPO = path.join(HARNESS_ROOT, '..');
const LEDGER = path.join(HARNESS_ROOT, 'ledger.jsonl');

function parseArgs(argv) {
  const a = { scenarios: [], tier: 0, maxUsd: null, repeat: 1, stateDir: null, repo: DEFAULT_REPO, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--scenario') { a.scenarios.push(v); i++; }
    else if (k === '--tier') { a.tier = Number(v); i++; }
    else if (k === '--max-usd') { a.maxUsd = Number(v); i++; }
    else if (k === '--repeat') { a.repeat = Math.max(1, Number(v) || 1); i++; }
    else if (k === '--state-dir') { a.stateDir = v; i++; }
    else if (k === '--repo') { a.repo = path.resolve(v); i++; }
    else if (k === '--keep') a.keep = true;
    else if (k === '--help' || k === '-h') { a.help = true; }
    else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

function defaultStateDir() {
  if (process.env.PAN_HARNESS_STATE) return process.env.PAN_HARNESS_STATE;
  return process.platform === 'win32' && fs.existsSync('D:\\pantesting') ? 'D:\\pantesting\\harness-runs' : path.join(os.tmpdir(), 'pan-harness-runs');
}

/**
 * The run-id PREFIX. The unique suffix is not ours to invent: `mkdtempSync` appends
 * it while creating the directory, so the name cannot be guessed and pre-created by
 * another user of a shared temp directory. Keep the shape in step with the `<run>`
 * rule in ledger.cjs `normaliseDetail`.
 */
function runIdPrefix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `run-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-`;
}

function fill(value, vars) {
  if (typeof value === 'string') return value.replace(/<(ws|other|repo|pkg)>/g, (_, k) => vars[k]);
  if (Array.isArray(value)) return value.map(v => fill(v, vars));
  return value;
}

// A model step is not started with less than this much cap left: a run cut off by
// the budget records nothing about PAN, only about the budget. Your first tier-2
// run started its last rep with ~$0.50 and logged eight false failures.
const MIN_MODEL_STEP_USD = 1;

/**
 * Pure. Split --max-usd equally across the model-tier scenarios in a run so an
 * alphabetically earlier oracle cannot starve the scenario it was meant to be
 * compared with (which is exactly what happened on 2026-09-10: the markdown
 * chain spent all $20 and the native chain never ran a model step).
 * @returns {Map<string, number>} scenario id → its share in USD (tier-0 scenarios get 0)
 */
function allocateBudget(maxUsd, scenarios) {
  const model = scenarios.filter(s => s.tier >= 1);
  const share = model.length && maxUsd !== null ? maxUsd / model.length : 0;
  return new Map(scenarios.map(s => [s.id, s.tier >= 1 ? share : 0]));
}

/**
 * Pure. Order (scenario, rep) pairs so every scenario gets its rep 1 before any
 * gets its rep 2 — a run interrupted by budget or time still yields a comparable
 * number of reps per scenario. Tier-0 scenarios run once.
 */
function interleave(scenarios, repeat) {
  const maxRep = Math.max(1, repeat);
  const queue = [];
  for (let rep = 1; rep <= maxRep; rep++) {
    for (const s of scenarios) {
      const reps = s.tier >= 1 ? maxRep : 1;
      if (rep <= reps) queue.push({ scenario: s, rep, reps });
    }
  }
  return queue;
}

function runStep(step, ctx) {
  const { ws, other, repo, pkg, runtime, budget } = ctx;
  const vars = { ws, other, repo, pkg };
  const stepTimeout = (step.timeoutMinutes || budget.maxStepMinutes || 5) * 60000;
  switch (step.kind) {
    case 'fs': {
      if (step.read) {
        const p = path.join(ws, fill(step.read, vars));
        try { return { code: 0, stdout: fs.readFileSync(p, 'utf8'), stderr: '' }; }
        catch (e) { return { code: 1, stdout: '', stderr: `cannot read ${step.read}: ${e.message}` }; }
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    case 'pan':
      return runPan(ws, fill(step.argv, vars), step.runtime || runtime, stepTimeout);
    case 'sh': {
      const script = path.join(HARNESS_ROOT, 'scripts', step.script);
      const r = spawnSync(process.execPath, [script, ...fill(step.args || [], vars)], { cwd: ws, encoding: 'utf8', timeout: stepTimeout, stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') + (r.error ? r.error.message : '') };
    }
    case 'build': {
      const script = path.join(repo, 'scripts', step.script);
      const out = path.join(ws, fill(step.out || 'bundle', vars));
      const env = { ...process.env, PAN_AGENT_PLUGIN_OUT: out, PAN_PLUGIN_OUT: out };
      const r = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8', timeout: stepTimeout, env, stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') + (r.error ? r.error.message : '') };
    }
    case 'cli': {
      const bin = findCli(step.bin);
      if (!bin) return { code: 127, stdout: '', stderr: `${step.bin} not on PATH` };
      const r = spawnSync(bin, fill(step.args || [], vars), { cwd: ws, encoding: 'utf8', timeout: stepTimeout, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin) });
      return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') + (r.error ? r.error.message : '') };
    }
    case 'mcp': {
      const cwd = step.cwd === 'other' ? other : ws;
      return rpcBatch(ws, materialise(step.requests, { ws, other }), { runtime: step.runtime || runtime, cwd, timeoutMs: stepTimeout });
    }
    case 'model': {
      // Cap = what is left of THIS scenario's share, bounded by its own budget.maxUsd.
      const remaining = ctx.shareUsd === null ? null : ctx.shareUsd - ctx.spentUsd();
      const cap = remaining === null ? null : Math.min(remaining, budget.maxUsd || remaining);
      if (cap !== null && cap < MIN_MODEL_STEP_USD) {
        return { code: 2, stdout: '', stderr: `budget exhausted: $${cap.toFixed(2)} of this scenario's $${ctx.shareUsd.toFixed(2)} share left (floor $${MIN_MODEL_STEP_USD})`, costUsd: 0, budgetExhausted: true };
      }
      const r = runModelStep(ws, fill(step.prompt, vars), { maxUsd: cap, timeoutMs: stepTimeout, pluginDir: step.pluginDir ? fill(step.pluginDir, vars) : undefined, strictMcp: step.strictMcp !== false });
      ctx.addCost(r.costUsd || 0);
      // Claude Code stops a run at --max-budget-usd with is_error and a tool_use
      // stop reason. Spend within ~15% of the cap is that stop, not a PAN result.
      if (r.code !== 0 && cap !== null && (r.costUsd || 0) >= cap * 0.85) r.budgetStopped = true;
      return r;
    }
    default:
      return { code: 1, stdout: '', stderr: `unknown step kind ${step.kind}` };
  }
}

/**
 * A model step that spent nothing and produced no turns never reached the model —
 * a missing plugin dir, a refused launch, a CLI that exited at once. That is a fault
 * of the probe or the harness, not evidence about PAN, so it must record `error`,
 * evaluate no assertions and file no findings. Two tier-1 runs on 2026-09-10 did the
 * opposite and filed two promotable phantom findings (reality check RC23 / R20).
 * Returns the note to record, or null when the outcome is a real result. Pure.
 */
function modelStepNeverRan(outcome) {
  if (!outcome || outcome.refused || outcome.budgetExhausted || outcome.budgetStopped) return null;
  const spent = outcome.costUsd || 0;
  const turns = typeof outcome.turns === 'number' ? outcome.turns : 0;
  if (spent > 0 || turns > 0) return null;
  const why = String(outcome.stderr || outcome.stdout || '').replace(/\s+/g, ' ').slice(0, 300);
  return `model step ran no turns and spent nothing — a probe or harness fault, not a PAN result: ${why || '(no output)'}`;
}

/**
 * Write a model step's complete stdout/stderr (the `claude -p` JSON and whatever it
 * printed) to <runDir>/steps/<scenario>-<rep>-<step>.json. The report keeps counts and
 * 4 KB excerpts; when a run dies mid-agent (2026-09-10: two native-workflow reps
 * aborted at ~605 s with nothing on disk to say why) the full output is the evidence.
 * Best effort — never fails the run.
 */
function persistStepOutput(runDir, scenarioId, rep, index, outcome) {
  try {
    const dir = path.join(runDir, 'steps');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${scenarioId}-${rep}-${index}.json`);
    fs.writeFileSync(file, JSON.stringify({
      scenario: scenarioId, rep, step: index, code: outcome.code, costUsd: outcome.costUsd || 0,
      turns: outcome.turns ?? null, durationMs: outcome.durationMs ?? null,
      budgetStopped: !!outcome.budgetStopped, refused: !!outcome.refused,
      stdout: String(outcome.stdout || ''), stderr: String(outcome.stderr || ''),
    }, null, 2));
  } catch { /* evidence is best effort */ }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('node harness/src/run.cjs [--scenario id]... [--tier 0|1|2] [--max-usd n] [--repeat n] [--state-dir dir] [--repo dir] [--keep]\n');
    return 0;
  }
  const stateDir = args.stateDir || defaultStateDir();
  fs.mkdirSync(stateDir, { recursive: true });
  // mkdtempSync, not mkdirSync on a name we chose: off Windows the default state
  // directory lives under the shared OS temp directory, where a predictable run name
  // is another user's to pre-create or point a symlink at before we write the report.
  // mkdtemp creates the directory atomically, 0700, with a suffix only this process knows.
  const runDir = fs.mkdtempSync(path.join(stateDir, runIdPrefix()));
  const id = path.basename(runDir);
  const log = (m) => process.stderr.write(`[harness] ${m}\n`);

  log(`run ${id} — repo ${args.repo}`);
  const art = packAndExtract(args.repo, path.join(runDir, 'artifact'));
  log(`artifact ${art.build.tarball} (${art.build.sha256.slice(0, 12)}) from ${art.build.head ? art.build.head.slice(0, 9) : 'no-git'}`);

  let scenarios = loadScenarios(path.join(HARNESS_ROOT, 'scenarios'));
  if (args.scenarios.length) scenarios = scenarios.filter(s => args.scenarios.includes(s.id));
  scenarios = scenarios.filter(s => s.tier <= args.tier);
  if (scenarios.length === 0) { log('no scenarios selected'); return 2; }

  let spent = 0;
  const spentBy = new Map();
  const shares = allocateBudget(args.maxUsd, scenarios);
  const results = [];
  const failures = [];
  const passedSteps = [];
  const startedAt = Date.now();
  if (args.maxUsd !== null) {
    for (const [id, share] of shares) if (share > 0) log(`budget share ${id}: $${share.toFixed(2)}`);
  }

  for (const { scenario: s, rep, reps } of interleave(scenarios, args.repeat)) {
    {
      const label = reps > 1 ? `${s.id}#${rep}` : s.id;
      const rec = { scenario: s.id, tier: s.tier, rep, status: 'passed', steps: [], skipped: null, durationMs: 0 };
      results.push(rec);
      const t0 = Date.now();
      const unmet = unmetRequirement(s.requires);
      if (unmet) {
        rec.status = 'skipped'; rec.skipped = unmet;
        log(`${label}: SKIPPED — ${rec.skipped}`);
        continue;
      }
      if (s.tier >= 1 && args.maxUsd === null) {
        rec.status = 'skipped'; rec.skipped = 'model tier requires --max-usd';
        log(`${label}: SKIPPED — ${rec.skipped}`);
        continue;
      }
      const seedDir = s.seed && s.seed !== 'empty' ? path.join(HARNESS_ROOT, 'seeds', s.seed) : null;
      if (seedDir && !fs.existsSync(seedDir)) throw new Error(`${s.id}: seed ${s.seed} not found`);
      const ws = createWorkspace(runDir, label.replace('#', '-'), seedDir);
      const other = path.join(runDir, 'ws', `${label.replace('#', '-')}-other`);
      fs.mkdirSync(other, { recursive: true });
      const runtime = (s.install || []).map(f => f.replace(/^--/, '')).find(f => ['claude', 'codex', 'gemini', 'opencode', 'copilot'].includes(f)) || 'claude';
      if (s.install && s.install.length) {
        const inst = installPan(art.installer, ws, s.install);
        rec.install = { code: inst.code };
        if (inst.code !== 0) {
          rec.status = 'failed';
          failures.push({ scenario: s.id, tier: s.tier, step: -1, expect: 'exit:0', failure: `installer exit ${inst.code}: ${inst.stderr.slice(0, 400)}`, why: 'PAN must install before any step can run' });
          log(`${label}: install FAILED (exit ${inst.code})`);
          continue;
        }
      }
      const shareUsd = args.maxUsd === null ? null : shares.get(s.id);
      const ctx = {
        ws, other, repo: args.repo, pkg: art.packageDir, runtime, budget: s.budget || {},
        shareUsd,
        spentUsd: () => spentBy.get(s.id) || 0,
        addCost: (c) => { spent += c; spentBy.set(s.id, (spentBy.get(s.id) || 0) + c); },
      };
      const scenarioDeadline = t0 + ((s.budget && s.budget.maxMinutes) || 30) * 60000;
      for (let i = 0; i < s.steps.length; i++) {
        const step = s.steps[i];
        if (Date.now() > scenarioDeadline) { rec.status = 'failed'; failures.push({ scenario: s.id, tier: s.tier, step: i, expect: 'budget', failure: 'scenario exceeded budget.maxMinutes', why: step.why }); break; }
        const outcome = runStep(step, ctx);
        if (outcome.refused) { rec.status = 'skipped'; rec.skipped = outcome.stderr; break; }
        // Budget outcomes are facts about the run, never findings against PAN.
        if (outcome.budgetExhausted) { rec.status = 'budget'; rec.note = outcome.stderr; log(`${label}: BUDGET — ${rec.note}`); break; }
        if (outcome.budgetStopped) {
          rec.status = 'budget'; rec.note = `model step stopped by the cap after $${(outcome.costUsd || 0).toFixed(2)} (${outcome.turns ?? '?'} turns) — no assertion evaluated`;
          rec.steps.push({ index: i, kind: step.kind, code: outcome.code, failures: [], costUsd: outcome.costUsd || 0, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) });
          log(`${label}: BUDGET — ${rec.note}`); break;
        }
        if (step.kind === 'model') {
          const never = modelStepNeverRan(outcome);
          if (never) {
            rec.status = 'error'; rec.note = never;
            rec.steps.push({ index: i, kind: step.kind, code: outcome.code, failures: [], costUsd: 0, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) });
            log(`${label}: ERROR — ${rec.note}`); break;
          }
        }
        if (step.kind === 'model') persistStepOutput(runDir, s.id, rep, i, outcome);
        const fails = check(step.expect, outcome, ws);
        const sr = { index: i, kind: step.kind, code: outcome.code, failures: fails, costUsd: outcome.costUsd || 0, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) };
        rec.steps.push(sr);
        if (fails.length) {
          rec.status = 'failed';
          for (const f of fails) failures.push({ scenario: s.id, tier: s.tier, step: i, expect: f.expect, failure: f.failure, why: step.why });
          log(`${label} step ${i} (${step.kind}) FAILED: ${fails.map(f => `${f.expect} → ${f.failure}`).join('; ')}`);
          if (step.fatal) break;
        } else {
          passedSteps.push({ scenario: s.id, step: i });
        }
      }
      rec.durationMs = Date.now() - t0;
      log(`${label}: ${rec.status.toUpperCase()} (${rec.steps.length} steps, ${(rec.durationMs / 1000).toFixed(1)}s${spent ? `, $${spent.toFixed(3)} so far` : ''})`);
    }
  }

  // Ledger + report
  const now = new Date().toISOString();
  const entries = mergeRun(readLedger(LEDGER), { runId: id, build: `${art.build.version}@${(art.build.head || 'nogit').slice(0, 9)}`, now, failures, passedSteps });
  writeLedger(LEDGER, entries);
  const promotable = entries.filter(isPromotable);
  // Per-scenario completion rate across reps — the number a chain comparison is about.
  const byScenario = {};
  for (const r of results) {
    const b = byScenario[r.scenario] || (byScenario[r.scenario] = { scenario: r.scenario, tier: r.tier, reps: 0, passed: 0, failed: 0, skipped: 0, budget: 0, error: 0, spentUsd: 0 });
    b.reps++; b[r.status] = (b[r.status] || 0) + 1; b.spentUsd += r.steps.reduce((n, st) => n + (st.costUsd || 0), 0);
  }
  const summary = {
    run: id, build: art.build, tier: args.tier, maxUsd: args.maxUsd, spentUsd: spent, durationMs: Date.now() - startedAt,
    shares: Object.fromEntries([...shares].filter(([, v]) => v > 0)),
    scenarios: results.map(r => ({ scenario: r.scenario, tier: r.tier, rep: r.rep, status: r.status, skipped: r.skipped, note: r.note || null, steps: r.steps.length, failures: r.steps.reduce((n, st) => n + st.failures.length, 0), costUsd: r.steps.reduce((n, st) => n + (st.costUsd || 0), 0), durationMs: r.durationMs })),
    completion: Object.values(byScenario),
    failures, promotable: promotable.map(e => ({ signature: e.signature, scenario: e.scenario, step: e.step, expect: e.expect, detail: e.detail, runs: e.runs.length })),
  };
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ ...summary, steps: results }, null, 2));
  const lines = [
    `# PAN Harness run ${id}`, '',
    `Build: ${art.build.version} @ ${art.build.head || 'no-git'} · tarball sha256 ${art.build.sha256}`,
    `Tier ≤ ${args.tier} · spent $${spent.toFixed(3)}${args.maxUsd !== null ? ` of $${args.maxUsd}` : ''} · ${((Date.now() - startedAt) / 1000).toFixed(0)}s`, '',
    '| Scenario | Tier | Status | Steps | Failures | Cost | Note |', '|---|---|---|---|---|---|---|',
    ...summary.scenarios.map(r => `| ${r.scenario}${r.rep > 1 ? ` #${r.rep}` : ''} | ${r.tier} | ${r.status} | ${r.steps} | ${r.failures} | ${r.costUsd ? `$${r.costUsd.toFixed(2)}` : ''} | ${r.skipped || r.note || ''} |`),
    '',
    '## Completion per scenario', '',
    '| Scenario | Tier | Reps | Passed | Failed | Budget-stopped | Skipped | Error | Spent |', '|---|---|---|---|---|---|---|---|---|',
    ...summary.completion.map(c => `| ${c.scenario} | ${c.tier} | ${c.reps} | ${c.passed} | ${c.failed} | ${c.budget} | ${c.skipped} | ${c.error || 0} | ${c.spentUsd ? `$${c.spentUsd.toFixed(2)}` : ''} |`),
    '',
  ];
  if (failures.length) {
    lines.push('## Failures', '');
    for (const f of failures) lines.push(`- **${f.scenario}** step ${f.step}: \`${f.expect}\` → ${f.failure}`, f.why ? `  - why this step exists: ${f.why}` : '');
    lines.push('');
  }
  if (promotable.length) {
    lines.push('## Promotable findings (ledger)', '');
    for (const e of promotable) lines.push(`- \`${e.signature}\` ${e.scenario} step ${e.step} \`${e.expect}\` — ${e.detail} (${e.runs.length} run${e.runs.length === 1 ? '' : 's'})`);
    lines.push('');
  }
  fs.writeFileSync(path.join(runDir, 'report.md'), lines.join('\n'));
  if (!args.keep) { try { fs.rmSync(path.join(runDir, 'artifact'), { recursive: true, force: true }); } catch { /* best effort */ } }

  const failed = summary.scenarios.filter(r => r.status === 'failed').length;
  const skipped = summary.scenarios.filter(r => r.status === 'skipped').length;
  const budget = summary.scenarios.filter(r => r.status === 'budget').length;
  const passed = summary.scenarios.filter(r => r.status === 'passed').length;
  const errors = summary.scenarios.filter(r => r.status === 'error').length;
  log(`done: ${passed} passed, ${failed} failed, ${budget} budget-stopped, ${skipped} skipped, ${errors} harness errors — report ${path.join(runDir, 'report.md')}`);
  process.stdout.write(JSON.stringify({ run: id, passed, failed, budget, skipped, errors, spentUsd: spent, report: path.join(runDir, 'report.md') }) + '\n');
  // An error is not green: the run could not measure what it set out to.
  return (failed || errors) ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { process.stderr.write(`[harness] fatal: ${e && e.stack || e}\n`); process.exit(2); }
}

module.exports = { parseArgs, fill, runStep, allocateBudget, interleave, modelStepNeverRan, MIN_MODEL_STEP_USD };
