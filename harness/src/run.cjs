#!/usr/bin/env node
'use strict';

/**
 * PAN Harness runner (ADR-0047).
 *
 *   node harness/src/run.cjs [--scenario <id>]... [--tier 0|1|2] [--max-usd <n>]
 *                            [--repeat <n>] [--state-dir <dir>] [--repo <dir>] [--keep]
 *
 * Tier 0 (default) is model-free and free, and carries no cap. A model tier (1, 2) is
 * capped at DEFAULT_MAX_USD ($15) unless --max-usd or PAN_HARNESS_MAX_USD says
 * otherwise (0 = spend nothing); the cap is enforced from measured spend and reaching
 * it ends the run with a run-level note, not a finding against PAN.
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
const { runModelStep, runDoubledModelStep } = require('./model.cjs');
const { check } = require('./assert.cjs');
const { wilson, passHatK, sprt } = require('./stats.cjs');
const { readLedger, writeLedger, mergeRun, isPromotable } = require('./ledger.cjs');
const { findCli, unmetRequirement } = require('./cli-detect.cjs');
const { loadCorpus } = require('./corpus.cjs');
const { readRows, scoreboard, renderMarkdown } = require('../scripts/catch-rate.cjs');

const HARNESS_ROOT = path.join(__dirname, '..');
const DEFAULT_REPO = path.join(HARNESS_ROOT, '..');
const LEDGER = path.join(HARNESS_ROOT, 'ledger.jsonl');

// The spend cap a model-tier run gets when none is given. The environment changes it
// (PAN_HARNESS_MAX_USD); --max-usd overrides both. Tier 0 spends nothing and has none.
const DEFAULT_MAX_USD = 15;

function parseArgs(argv, env = process.env) {
  const a = { scenarios: [], tier: 0, maxUsd: null, maxUsdDefaulted: false, repeat: 1, stateDir: null, repo: DEFAULT_REPO, keep: false, ledger: true, controls: false, untilDecided: false, arm: null, requireRun: [], record: false, scoreboards: [], promptMutant: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--scenario') { a.scenarios.push(v); i++; }
    else if (k === '--tier') { a.tier = Number(v); i++; }
    else if (k === '--max-usd') { a.maxUsd = Number(v); i++; }
    else if (k === '--repeat') { a.repeat = Math.max(1, Number(v) || 1); i++; }
    else if (k === '--state-dir') { a.stateDir = v; i++; }
    else if (k === '--repo') { a.repo = path.resolve(v); i++; }
    else if (k === '--keep') a.keep = true;
    // harness/ledger.jsonl is a TRACKED file — the finding history across runs. A CI run
    // is a throwaway checkout whose ledger nobody will read, and writing it there leaves
    // the working tree dirty, so CI passes --no-ledger and the run reports through its
    // own report.md/report.json under the state directory instead.
    else if (k === '--no-ledger') a.ledger = false;
    // --controls (H5): also run each passing scenario once per declared control, whose
    // sabotage must turn it red. Opt-in: it multiplies the run's length.
    else if (k === '--controls') a.controls = true;
    // --until-decided (H3): stop a model-tier scenario's reps once SPRT decides (pass
    // rate 0.8 against 0.5, alpha 0.05, beta 0.2), so a clear result costs fewer reps.
    else if (k === '--until-decided') a.untilDecided = true;
    // --arm <id> (H3, M43): run the scenarios that declare this arm with its change applied
    // (the no-guidance baseline, a deletion arm), for a paired comparison with the plain run.
    else if (k === '--arm') { a.arm = v; i++; }
    // --prompt-mutant <rule id> (H6): delete that rule from the packed package and run only
    // the scenarios that cover it. All of them passing means the rule changed nothing.
    else if (k === '--prompt-mutant') { a.promptMutant = v; i++; }
    // --require-run <id> (CI1): this scenario must actually run. Skipped, or not selected at
    // all, fails the run: CI installs a host CLI so the double-backed scenarios run there, and
    // a missing CLI must not turn into a quiet skip.
    else if (k === '--require-run') { a.requireRun.push(v); i++; }
    // --record (H2): a double step that carries a synthetic recipe (`double.record.script`)
    // re-records its cassette from it instead of replaying. Recording from a real model is
    // not a harness flag: it spends and needs an API key (program H2 evidence step).
    else if (k === '--record') a.record = true;
    // --scoreboard <results.jsonl> (H4): add the detection scoreboard (catch and false-alarm
    // rates per judge × host × profile against harness/corpus/) to report.md and report.json.
    // Repeatable; the rows are judge runs replayed from cassettes or recorded live.
    else if (k === '--scoreboard') { a.scoreboards.push(path.resolve(v)); i++; }
    else if (k === '--help' || k === '-h') { a.help = true; }
    else throw new Error(`unknown argument: ${k}`);
  }
  if (a.tier >= 1 && a.maxUsd === null) {
    const fromEnv = Number(env && env.PAN_HARNESS_MAX_USD);
    a.maxUsd = env && env.PAN_HARNESS_MAX_USD != null && Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_MAX_USD;
    a.maxUsdDefaulted = true;
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

/**
 * One argument for a cmd.exe command line. npm installs a CLI on Windows as a
 * `.cmd` shim, which only runs through the shell, and Node then CONCATENATES the
 * arguments unquoted — `-p "Reply with PROBE."` reached Copilot as four words and it
 * refused the command (2026-09-26). Quote anything with whitespace, a quote or a cmd
 * metacharacter; a quote inside becomes `\"`, which the shim's node process parses back.
 */
function quoteCmdArg(arg) {
  const s = String(arg);
  if (s !== '' && !/[\s"&|<>^()%!]/.test(s)) return s;
  // Backslashes before a quote, and at the end, are doubled so the quote survives the
  // program's own argv parsing (the MSVCRT rules node follows).
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function fill(value, vars) {
  if (typeof value === 'string') return value.replace(/<(ws|other|repo|pkg)>/g, (_, k) => vars[k]);
  if (Array.isArray(value)) return value.map(v => fill(v, vars));
  return value;
}

/** fill() through every string of a JSON-shaped value (a double's script). Pure. */
function fillDeep(value, vars) {
  if (typeof value === 'string' || Array.isArray(value)) return Array.isArray(value) ? value.map(v => fillDeep(v, vars)) : fill(value, vars);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, vars)]));
  return value;
}

/**
 * The environment a `cli` step's child runs with: the harness's own, plus the step's
 * `env` overrides with placeholders filled. Pure. live-gate-gemini points
 * GEMINI_CLI_HOME at a scratch home under <other>, so the CLI never reads or writes
 * the user's real ~/.gemini, and a trust entry written there trusts only that workspace.
 */
function stepEnv(step, vars, base = process.env) {
  if (!step.env) return base;
  const env = { ...base };
  for (const [k, v] of Object.entries(step.env)) env[k] = fill(String(v), vars);
  return env;
}

/**
 * The scripted user's answer (H9): the first whose `match` (a case-insensitive pattern)
 * finds the host's last reply. Null when nothing matches, or there was no reply. Pure.
 */
function pickAnswer(answers, lastReply) {
  if (!lastReply) return null;
  return (answers || []).find((a) => new RegExp(a.match, 'i').test(lastReply)) || null;
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

/**
 * Apply a scenario control's sabotage (H5). Paths take the step placeholders and must
 * resolve inside the workspace or the scenario's scratch directory; a control that
 * names a missing file or a missing string throws, because a control that changes
 * nothing would "pass" by measuring nothing.
 */
function applyControl(control, vars) {
  const roots = [vars.ws, vars.other].filter(Boolean).map((r) => path.resolve(r));
  const target = (rel) => {
    const filled = fill(rel, vars);
    const abs = path.resolve(path.isAbsolute(filled) ? filled : path.join(vars.ws, filled));
    if (!roots.some((r) => abs === r || abs.startsWith(r + path.sep))) throw new Error(`${rel} is outside the workspace`);
    return abs;
  };
  if (control.delete) {
    const p = target(control.delete);
    if (!fs.existsSync(p)) throw new Error(`${control.delete} does not exist`);
    fs.rmSync(p, { recursive: true, force: true });
  } else if (control.write) {
    const p = target(control.write.path);
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    // Owner-only: off Windows the workspace lives under the shared OS temp directory.
    fs.writeFileSync(p, control.write.content, { mode: 0o600 });
  } else if (control.replace) {
    const p = target(control.replace.path);
    const text = fs.readFileSync(p, 'utf8');
    if (!text.includes(control.replace.find)) throw new Error(`"${control.replace.find}" is not in ${control.replace.path}`);
    fs.writeFileSync(p, text.split(control.replace.find).join(control.replace.with));
  } else {
    throw new Error('no sabotage (delete, write or replace)');
  }
}

/**
 * One row of the report's completion table (H3), pure: the pass rate always travels with
 * its 95% Wilson interval, and pass^3 (all of three trials pass) when there are three reps.
 */
function completionRow(c) {
  const n = c.passed + c.failed;
  const interval = c.interval || (n ? wilson(c.passed, n) : null);
  const hat3 = c.passHat3 !== undefined ? c.passHat3 : (n >= 3 ? passHatK(c.passed, n, 3) : null);
  const rate = interval ? `${c.passed}/${n} [${interval.lower.toFixed(2)}, ${interval.upper.toFixed(2)}]` : '—';
  return `| ${c.scenario} | ${c.tier} | ${c.reps} | ${c.passed} | ${c.failed} | ${c.budget || 0} | ${c.skipped || 0} | ${c.error || 0} | ${rate} | ${hat3 === null ? '—' : hat3.toFixed(2)} | ${c.spentUsd ? `$${c.spentUsd.toFixed(2)}` : ''} |`;
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
      // resolve, not join: an absolute `out` (live-gate-codex's `<repo>/dist/...`) must
      // replace the workspace, where join glued it on and the build could not write.
      const out = path.resolve(ws, fill(step.out || 'bundle', vars));
      const env = { ...process.env, PAN_AGENT_PLUGIN_OUT: out, PAN_PLUGIN_OUT: out };
      const r = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8', timeout: stepTimeout, env, stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') + (r.error ? r.error.message : '') };
    }
    case 'cli': {
      const bin = findCli(step.bin);
      if (!bin) return { code: 127, stdout: '', stderr: `${step.bin} not on PATH` };
      const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
      const argv = fill(step.args || [], vars);
      const r = spawnSync(viaShell ? quoteCmdArg(bin) : bin, viaShell ? argv.map(quoteCmdArg) : argv, { cwd: ws, env: stepEnv(step, vars), encoding: 'utf8', timeout: stepTimeout, stdio: ['ignore', 'pipe', 'pipe'], shell: viaShell });
      return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') + (r.error ? r.error.message : '') };
    }
    case 'mcp': {
      const cwd = step.cwd === 'other' ? other : ws;
      return rpcBatch(ws, materialise(step.requests, { ws, other }), { runtime: step.runtime || runtime, cwd, timeoutMs: stepTimeout });
    }
    case 'user': {
      // H9: answer the session the last model or user step left, by pattern over its reply,
      // and resume it with that answer. Double-backed it is tier 0; with a model it spends.
      const last = ctx.lastSession;
      if (!last || !last.sessionId) return { code: 1, stdout: '', stderr: 'no session to answer: the step before left no session id (persistSession on the model step?)', unanswered: true };
      const answer = pickAnswer(step.answers, last.reply);
      if (!answer) return { code: 1, stdout: '', stderr: `no scripted answer matches the last reply: ${String(last.reply || '').slice(0, 300)}`, unanswered: true };
      return runStep({ ...step, kind: 'model', prompt: answer.reply, persistSession: true, resume: last.sessionId }, ctx);
    }
    case 'model': {
      // A double-backed step (H1): the host runs for real against the local model double, which
      // answers from the step's script. Nothing is spent, so it needs no cap and is tier 0.
      if (step.double) {
        const tag = `double-${ctx.stepIndex === undefined ? 'x' : ctx.stepIndex}`;
        const dbl = { ...step.double, ...(step.double.cassette ? { cassette: fill(step.double.cassette, vars) } : {}) };
        if (!ctx.record) delete dbl.record; // replay unless the run asked to re-record
        // A session kept for a scripted user lives in one home for the whole scenario, so the
        // step that resumes it finds it; otherwise each step has its own.
        const keep = step.persistSession === true || !!step.resume;
        const script = dbl.script ? { script: fillDeep(dbl.script, vars) } : {};
        return runDoubledModelStep(ws, fill(step.prompt, vars), { runtime: step.runtime, double: { ...dbl, ...script }, capturesDir: path.join(other, tag), configDir: path.join(other, keep ? 'double-session-home' : `${tag}-home`), other, timeoutMs: stepTimeout, persistSession: keep, resume: step.resume || null });
      }
      // Cap = what is left of THIS scenario's share, bounded by its own budget.maxUsd.
      const remaining = ctx.shareUsd === null ? null : ctx.shareUsd - ctx.spentUsd();
      const cap = remaining === null ? null : Math.min(remaining, budget.maxUsd || remaining);
      if (cap !== null && cap < MIN_MODEL_STEP_USD) {
        return { code: 2, stdout: '', stderr: `budget exhausted: $${cap.toFixed(2)} of this scenario's $${ctx.shareUsd.toFixed(2)} share left (floor $${MIN_MODEL_STEP_USD})`, costUsd: 0, budgetExhausted: true };
      }
      const r = runModelStep(ws, fill(step.prompt, vars), { maxUsd: cap, timeoutMs: stepTimeout, pluginDir: step.pluginDir ? fill(step.pluginDir, vars) : undefined, strictMcp: step.strictMcp !== false, persistSession: step.persistSession === true, resume: step.resume || null, runtime: step.runtime });
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
/**
 * The scenarios a run was required to execute (--require-run) that did not run: skipped,
 * or never selected. Pure. Each is a failure of the run, with the reason.
 */
function unmetRuns(results, required) {
  const out = [];
  for (const id of required || []) {
    const recs = results.filter((r) => r.scenario === id && !r.control);
    const ran = recs.some((r) => r.status === 'passed' || r.status === 'failed' || r.status === 'drift');
    if (ran) continue;
    const why = recs.length ? recs.map((r) => r.skipped || r.note || r.status).join('; ') : 'not selected in this run';
    out.push({ scenario: id, tier: 0, step: 'require-run', expect: 'ran', failure: `required to run, but did not: ${why}`, why: 'CI installs the host CLI so this scenario runs; a skip would hide a broken setup' });
  }
  return out;
}

/**
 * Cassette drift no step expected (H2): the prompt the host sent changed since the cassette
 * was recorded. That is the impact of a prompt edit, reported, never a finding against PAN:
 * the step's other assertions cannot be read once the double refused an unrecorded request.
 * Null when there is none, or when the step asserts on drift itself. Pure.
 */
function driftNote(step, outcome) {
  if (!step || step.kind !== 'model' || !outcome || !outcome.doubled) return null;
  const drift = outcome.drift || [];
  if (!drift.length || (step.expect || []).some((e) => /^drift:/.test(e))) return null;
  const agents = [...new Map(drift.filter((d) => d.attributed).map((d) => [d.attributed.agent, `${d.attributed.agent} (${d.attributed.file})`])).values()];
  const unattributed = drift.filter((d) => !d.attributed).length;
  const parts = [...agents, ...(unattributed ? [`${unattributed} unattributed (the main session, a host-internal request, or a host upgrade)`] : [])];
  return `prompt impact: ${drift.length} request(s) not in the cassette — ${parts.join('; ')}. Intended? Re-record with --record`;
}

function modelStepNeverRan(outcome) {
  // A scripted user with nothing to answer is a real result (the session went elsewhere).
  if (!outcome || outcome.refused || outcome.budgetExhausted || outcome.budgetStopped || outcome.unanswered) return null;
  // A double-backed step spends nothing by design: it ran if the host reached the double.
  if (outcome.doubled) {
    if ((outcome.captures || []).some((c) => c && c.protocol)) return null;
    // A resume that finds no conversation is the step's own failure (H9): the session it
    // answers is gone, which is what a scripted user must be able to show.
    if (outcome.resumed && /no conversation found/i.test(`${outcome.stdout || ''} ${outcome.stderr || ''}`)) return null;
    const why = String(outcome.stderr || outcome.stdout || '').replace(/\s+/g, ' ').slice(0, 300);
    return `the host never reached the model double — a probe or harness fault, not a PAN result: ${why || '(no output)'}`;
  }
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

/** The detection scoreboard (H4) from result-row files, scored against the corpus. */
function detectionScoreboard(files) {
  return scoreboard(readRows(files), loadCorpus());
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('node harness/src/run.cjs [--scenario id]... [--tier 0|1|2] [--max-usd n] [--repeat n] [--state-dir dir] [--repo dir] [--keep] [--no-ledger] [--controls] [--until-decided] [--arm id] [--require-run id]... [--record] [--scoreboard results.jsonl]...\n');
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
  let mutant = null;
  if (args.promptMutant) {
    const PR = require(path.join(args.repo, 'scripts', 'prompt-rules.cjs'));
    mutant = PR.applyMutant(args.repo, art.packageDir, args.promptMutant);
    if (mutant.error) { log(`prompt mutant ${args.promptMutant}: ${mutant.reason}`); return 2; }
    log(`prompt mutant ${mutant.id}: removed ${mutant.file}:${mutant.line} "${mutant.text.slice(0, 70)}"`);
    scenarios = PR.coveringScenarios(scenarios, mutant.id);
    if (!scenarios.length) { log(`no scenario covers ${mutant.id}: add it to a scenario's covers first`); return 2; }
  }
  if (args.scenarios.length) scenarios = scenarios.filter(s => args.scenarios.includes(s.id));
  scenarios = scenarios.filter(s => s.tier <= args.tier);
  if (args.arm) {
    const without = scenarios.filter(s => !(s.arms || []).some(a => a.id === args.arm)).map(s => s.id);
    if (without.length) log(`arm ${args.arm}: not declared by ${without.join(', ')} — left out`);
    scenarios = scenarios.filter(s => (s.arms || []).some(a => a.id === args.arm));
  }
  if (scenarios.length === 0) { log('no scenarios selected'); return 2; }

  let spent = 0;
  const spentBy = new Map();
  const shares = allocateBudget(args.maxUsd, scenarios);
  const results = [];
  const failures = [];
  const passedSteps = [];
  const startedAt = Date.now();
  if (args.maxUsdDefaulted) log(`budget: ${args.maxUsd} (default; --max-usd or PAN_HARNESS_MAX_USD changes it)`);
  if (args.maxUsd !== null) {
    for (const [id, share] of shares) if (share > 0) log(`budget share ${id}: $${share.toFixed(2)}`);
  }

  // One scenario run in a fresh workspace. With a `control`, its sabotage is applied
  // after step `control.after` (-1: before the first step), and the run's failures are
  // the expected outcome, so they are returned rather than recorded as findings.
  const armOf = (s) => (args.arm ? (s.arms || []).find(a => a.id === args.arm) || null : null);
  const executeScenario = (s, rep, reps, control) => {
    const arm = armOf(s);
    const label = (reps > 1 ? `${s.id}#${rep}` : s.id) + (arm ? `@${arm.id}` : '') + (control ? `~${control.id}` : '');
    const rec = { scenario: s.id, tier: s.tier, rep, status: 'passed', steps: [], skipped: null, durationMs: 0, ...(arm ? { arm: arm.id } : {}), ...(control ? { control: control.id } : {}) };
    const out = { rec, failures: [], passedSteps: [] };
    const t0 = Date.now();
    const unmet = unmetRequirement(s.requires);
    if (unmet) {
      rec.status = 'skipped'; rec.skipped = unmet;
      log(`${label}: SKIPPED — ${rec.skipped}`);
      return out;
    }
    if (s.tier >= 1 && args.maxUsd === null) {
      rec.status = 'skipped'; rec.skipped = 'model tier requires --max-usd';
      log(`${label}: SKIPPED — ${rec.skipped}`);
      return out;
    }
    const seedDir = s.seed && s.seed !== 'empty' ? path.join(HARNESS_ROOT, 'seeds', s.seed) : null;
    if (seedDir && !fs.existsSync(seedDir)) throw new Error(`${s.id}: seed ${s.seed} not found`);
    const wsName = label.replace('#', '-').replace('@', '-at-').replace('~', '--');
    const ws = createWorkspace(runDir, wsName, seedDir);
    const other = path.join(runDir, 'ws', `${wsName}-other`);
    fs.mkdirSync(other, { recursive: true });
    const runtime = (s.install || []).map(f => f.replace(/^--/, '')).find(f => ['claude', 'codex', 'gemini', 'opencode', 'copilot'].includes(f)) || 'claude';
    if (s.install && s.install.length) {
      const inst = installPan(art.installer, ws, s.install);
      rec.install = { code: inst.code };
      if (inst.code !== 0) {
        rec.status = 'failed';
        out.failures.push({ scenario: s.id, tier: s.tier, step: -1, expect: 'exit:0', failure: `installer exit ${inst.code}: ${inst.stderr.slice(0, 400)}`, why: 'PAN must install before any step can run' });
        log(`${label}: install FAILED (exit ${inst.code})`);
        return out;
      }
    }
    const shareUsd = args.maxUsd === null ? null : shares.get(s.id);
    const ctx = {
      ws, other, repo: args.repo, pkg: art.packageDir, runtime, budget: s.budget || {}, record: args.record,
      shareUsd,
      spentUsd: () => spentBy.get(s.id) || 0,
      addCost: (c) => { spent += c; spentBy.set(s.id, (spentBy.get(s.id) || 0) + c); },
    };
    // An arm's change and a control's sabotage are applied the same way, each after its step.
    const sabotage = (afterIndex) => {
      for (const [kind, mod] of [['arm', arm], ['control', control]]) {
        if (!mod || (mod.after === undefined ? -1 : mod.after) !== afterIndex) continue;
        try { applyControl(mod, { ws, other, repo: args.repo, pkg: art.packageDir }); }
        catch (e) { rec.status = 'error'; rec.note = `${kind} ${mod.id} could not be applied: ${e.message}`; log(`${label}: ERROR — ${rec.note}`); return false; }
      }
      return true;
    };
    if (!sabotage(-1)) return out;
    const scenarioDeadline = t0 + ((s.budget && s.budget.maxMinutes) || 30) * 60000;
    for (let i = 0; i < s.steps.length; i++) {
      const step = s.steps[i];
      if (Date.now() > scenarioDeadline) { rec.status = 'failed'; out.failures.push({ scenario: s.id, tier: s.tier, step: i, expect: 'budget', failure: 'scenario exceeded budget.maxMinutes', why: step.why }); break; }
      ctx.stepIndex = i;
      const outcome = runStep(step, ctx);
      if (outcome.refused) { rec.status = 'skipped'; rec.skipped = outcome.stderr; break; }
      // Budget outcomes are facts about the run, never findings against PAN.
      if (outcome.budgetExhausted) { rec.status = 'budget'; rec.note = outcome.stderr; log(`${label}: BUDGET — ${rec.note}`); break; }
      if (outcome.budgetStopped) {
        rec.status = 'budget'; rec.note = `model step stopped by the cap after $${(outcome.costUsd || 0).toFixed(2)} (${outcome.turns ?? '?'} turns) — no assertion evaluated`;
        rec.steps.push({ index: i, kind: step.kind, code: outcome.code, failures: [], costUsd: outcome.costUsd || 0, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) });
        log(`${label}: BUDGET — ${rec.note}`); break;
      }
      if (step.kind === 'model' || step.kind === 'user') {
        const never = modelStepNeverRan(outcome);
        if (never) {
          rec.status = 'error'; rec.note = never;
          rec.steps.push({ index: i, kind: step.kind, code: outcome.code, failures: [], costUsd: 0, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) });
          log(`${label}: ERROR — ${rec.note}`); break;
        }
      }
      if (step.kind === 'model' || step.kind === 'user') {
        persistStepOutput(runDir, s.id, rep, i, outcome);
        if (outcome.sessionId) ctx.lastSession = { sessionId: outcome.sessionId, reply: String(outcome.stdout || '') };
      }
      const impact = driftNote(step, outcome);
      if (impact) {
        rec.status = 'drift'; rec.note = impact;
        rec.steps.push({ index: i, kind: step.kind, code: outcome.code, failures: [], costUsd: 0, drift: outcome.drift, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) });
        log(`${label}: DRIFT — ${impact}`); break;
      }
      const fails = check(step.expect, outcome, ws);
      const sr = { index: i, kind: step.kind, code: outcome.code, failures: fails, costUsd: outcome.costUsd || 0, stdout: String(outcome.stdout || '').slice(0, 4000), stderr: String(outcome.stderr || '').slice(0, 2000) };
      rec.steps.push(sr);
      if (fails.length) {
        rec.status = 'failed';
        for (const f of fails) out.failures.push({ scenario: s.id, tier: s.tier, step: i, expect: f.expect, failure: f.failure, why: step.why });
        log(`${label} step ${i} (${step.kind}) ${control ? 'red (expected under the control)' : 'FAILED'}: ${fails.map(f => `${f.expect} → ${f.failure}`).join('; ')}`);
        if (step.fatal || control) break;
      } else {
        out.passedSteps.push({ scenario: s.id, step: i });
      }
      if (!sabotage(i)) return out;
    }
    rec.durationMs = Date.now() - t0;
    log(`${label}: ${rec.status.toUpperCase()} (${rec.steps.length} steps, ${(rec.durationMs / 1000).toFixed(1)}s${spent ? `, $${spent.toFixed(3)} so far` : ''})`);
    return out;
  };

  const controlResults = [];
  const outcomesBy = new Map();
  const decided = new Map();
  for (const { scenario: s, rep, reps } of interleave(scenarios, args.repeat)) {
    if (args.untilDecided && s.tier >= 1 && decided.has(s.id)) continue;
    const run = executeScenario(s, rep, reps, null);
    if (s.tier >= 1 && (run.rec.status === 'passed' || run.rec.status === 'failed')) {
      const seq = outcomesBy.get(s.id) || [];
      seq.push(run.rec.status === 'passed');
      outcomesBy.set(s.id, seq);
      const d = sprt(seq);
      if (args.untilDecided && d.decision !== 'continue' && !decided.has(s.id)) {
        decided.set(s.id, { decision: d.decision, reps: seq.length });
        log(`${s.id}: decided after ${seq.length} rep(s) — pass rate ${d.decision === 'h1' ? 'at least 0.8' : 'at most 0.5'} (SPRT, alpha 0.05, beta 0.2)`);
      }
    }
    results.push(run.rec);
    failures.push(...run.failures);
    passedSteps.push(...run.passedSteps);
    // Controls (H5): each sabotage must turn a passing scenario red. A control the
    // scenario survives is a finding against the scenario: its assertions do not
    // measure what they claim.
    if (!args.controls || run.rec.status !== 'passed' || rep !== 1) continue;
    for (const control of s.controls || []) {
      const c = executeScenario(s, rep, reps, control);
      const verdict = c.rec.status === 'failed' ? 'killed' : (c.rec.status === 'passed' ? 'survived' : c.rec.status);
      controlResults.push({ scenario: s.id, control: control.id, verdict, note: c.rec.note || c.rec.skipped || null });
      if (verdict === 'survived') {
        failures.push({ scenario: s.id, tier: s.tier, step: 'control', expect: `control:${control.id}`, failure: 'the scenario stayed green under its sabotage, so its assertions do not measure what they claim', why: control.why });
        log(`${s.id}~${control.id}: SURVIVED — a control must turn the scenario red`);
      }
    }
  }
  for (const f of unmetRuns(results, args.requireRun)) failures.push(f);
  if (args.controls) {
    for (const c of controlResults) if (c.verdict === 'error') failures.push({ scenario: c.scenario, tier: 0, step: 'control', expect: `control:${c.control}`, failure: c.note, why: 'a control that cannot be applied measures nothing' });
  }

  // Ledger + report
  const now = new Date().toISOString();
  const entries = mergeRun(readLedger(LEDGER), { runId: id, build: `${art.build.version}@${(art.build.head || 'nogit').slice(0, 9)}`, now, failures, passedSteps });
  if (args.ledger) writeLedger(LEDGER, entries);
  const promotable = entries.filter(isPromotable);
  // Per-scenario completion rate across reps — the number a chain comparison is about.
  const byScenario = {};
  for (const r of results) {
    const b = byScenario[r.scenario] || (byScenario[r.scenario] = { scenario: r.scenario, tier: r.tier, reps: 0, passed: 0, failed: 0, skipped: 0, budget: 0, error: 0, spentUsd: 0 });
    b.reps++; b[r.status] = (b[r.status] || 0) + 1; b.spentUsd += r.steps.reduce((n, st) => n + (st.costUsd || 0), 0);
  }
  // Every measured rate carries its interval (H3): 4/5 is [0.38, 0.96], not "80%".
  for (const b of Object.values(byScenario)) {
    const n = b.passed + b.failed;
    b.interval = n ? wilson(b.passed, n) : null;
    b.passHat3 = n >= 3 ? passHatK(b.passed, n, 3) : null;
    if (decided.has(b.scenario)) b.decided = decided.get(b.scenario);
  }
  const summary = {
    run: id, build: art.build, tier: args.tier, maxUsd: args.maxUsd, spentUsd: spent, durationMs: Date.now() - startedAt,
    shares: Object.fromEntries([...shares].filter(([, v]) => v > 0)),
    scenarios: results.map(r => ({ scenario: r.scenario, tier: r.tier, rep: r.rep, status: r.status, skipped: r.skipped, note: r.note || null, steps: r.steps.length, failures: r.steps.reduce((n, st) => n + st.failures.length, 0), costUsd: r.steps.reduce((n, st) => n + (st.costUsd || 0), 0), durationMs: r.durationMs })),
    completion: Object.values(byScenario),
    controls: controlResults,
    failures, promotable: promotable.map(e => ({ signature: e.signature, scenario: e.scenario, step: e.step, expect: e.expect, detail: e.detail, runs: e.runs.length })),
    scoreboard: args.scoreboards.length ? detectionScoreboard(args.scoreboards) : null,
    pairs: pairSummary(results, scenarios),
    promptMutant: mutant ? { ...mutant, verdict: results.some(r => r.status === 'failed') ? 'load_bearing' : (results.some(r => r.status === 'passed') ? 'decorative' : 'undecided') } : null,
  };
  if (summary.promptMutant && args.ledger) {
    // H6's record: one row per mutant run, with the reps and each covering scenario's interval.
    const row = { ts: new Date().toISOString(), run: id, rule: mutant.id, file: mutant.file, verdict: summary.promptMutant.verdict, scenarios: summary.completion.map(b => ({ scenario: b.scenario, passed: b.passed, runs: (b.passed || 0) + (b.failed || 0), interval: b.interval || null })) };
    fs.appendFileSync(path.join(HARNESS_ROOT, 'prompt-mutants.jsonl'), JSON.stringify(row) + '\n');
  }
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ ...summary, steps: results }, null, 2));
  const lines = [
    `# PAN Harness run ${id}`, '',
    `Build: ${art.build.version} @ ${art.build.head || 'no-git'} · tarball sha256 ${art.build.sha256}`,
    `Tier ≤ ${args.tier} · spent $${spent.toFixed(3)}${args.maxUsd !== null ? ` of $${args.maxUsd}` : ''} · ${((Date.now() - startedAt) / 1000).toFixed(0)}s`, '',
    '| Scenario | Tier | Status | Steps | Failures | Cost | Note |', '|---|---|---|---|---|---|---|',
    ...summary.scenarios.map(r => `| ${r.scenario}${r.rep > 1 ? ` #${r.rep}` : ''} | ${r.tier} | ${r.status} | ${r.steps} | ${r.failures} | ${r.costUsd ? `$${r.costUsd.toFixed(2)}` : ''} | ${r.skipped || r.note || ''} |`),
    '',
    '## Completion per scenario', '',
    '| Scenario | Tier | Reps | Passed | Failed | Budget-stopped | Skipped | Error | Pass rate (95% interval) | pass^3 | Spent |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...summary.completion.map(completionRow),
    '',
  ];
  if (args.controls) {
    lines.push('## Controls', '', '| Scenario | Control | Verdict | Note |', '|---|---|---|---|',
      ...controlResults.map((c) => `| ${c.scenario} | ${c.control} | ${c.verdict} | ${c.note || ''} |`), '');
  }
  if (failures.length) {
    lines.push('## Failures', '');
    for (const f of failures) lines.push(`- **${f.scenario}** step ${f.step}: \`${f.expect}\` → ${f.failure}`, f.why ? `  - why this step exists: ${f.why}` : '');
    lines.push('');
  }
  if (summary.scoreboard) lines.push(...renderMarkdown(summary.scoreboard));
  if (summary.pairs.length) {
    const fmt = (d, k = 1) => (d.mean == null ? '—' : `${(d.mean * k).toFixed(2)}${d.lower == null ? '' : ` [${(d.lower * k).toFixed(2)}, ${(d.upper * k).toFixed(2)}]`}`);
    lines.push('', '## PAN versus the bare host (H10)', '', 'Paired deltas, PAN minus the host alone, with 95% intervals.', '', '| Pair | Reps | Completion | Cost ($) | Duration (s) |', '|---|---|---|---|---|');
    for (const p of summary.pairs) lines.push(`| ${p.pair} | ${p.n} | ${fmt(p.completion)} | ${fmt(p.cost_usd)} | ${fmt(p.duration_ms, 0.001)} |`);
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
  const drifted = summary.scenarios.filter(r => r.status === 'drift').length;
  // Run-level failures that no scenario status carries: a control the scenario survived
  // (H5) and a required scenario that did not run (CI1). Each fails the run.
  const runLevel = failures.filter((f) => f.step === 'control' || f.step === 'require-run').length;
  log(`done: ${passed} passed, ${failed} failed, ${budget} budget-stopped, ${skipped} skipped, ${errors} harness errors${drifted ? `, ${drifted} drifted (prompt impact, see report)` : ''}${runLevel ? `, ${runLevel} run-level failure(s)` : ''} — report ${path.join(runDir, 'report.md')}`);
  process.stdout.write(JSON.stringify({ run: id, passed, failed, budget, skipped, errors, drifted, runLevel, spentUsd: spent, report: path.join(runDir, 'report.md') }) + '\n');
  // An error is not green: the run could not measure what it set out to.
  return (failed || errors || runLevel) ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { process.stderr.write(`[harness] fatal: ${e && e.stack || e}\n`); process.exit(2); }
}

/**
 * H10: each pair's paired deltas (pan − stock), rep by rep: completion (passed = 1),
 * cost and duration, each with a 95% interval (stats.cjs pairedDelta).
 */
function pairSummary(results, scenarios) {
  const { pairedDelta } = require('./stats.cjs');
  const arms = new Map();
  for (const s of scenarios) if (s.pair) arms.set(s.id, s.pair);
  const byPair = new Map();
  for (const r of results) {
    const p = arms.get(r.scenario);
    if (!p || r.control || r.status === 'skipped') continue;
    if (!byPair.has(p.id)) byPair.set(p.id, { goal: p.goal, reps: new Map() });
    const reps = byPair.get(p.id).reps;
    if (!reps.has(r.rep)) reps.set(r.rep, {});
    reps.get(r.rep)[p.arm] = r;
  }
  const out = [];
  for (const [id, { goal, reps }] of byPair) {
    const both = [...reps.values()].filter((x) => x.pan && x.stock);
    const cost = (r) => (r.steps || []).reduce((n, st) => n + (st.costUsd || 0), 0);
    out.push({
      pair: id, goal, n: both.length,
      completion: pairedDelta(both.map((x) => ({ pan: x.pan.status === 'passed' ? 1 : 0, stock: x.stock.status === 'passed' ? 1 : 0 }))),
      cost_usd: pairedDelta(both.map((x) => ({ pan: cost(x.pan), stock: cost(x.stock) }))),
      duration_ms: pairedDelta(both.map((x) => ({ pan: x.pan.durationMs || 0, stock: x.stock.durationMs || 0 }))),
    });
  }
  return out;
}

module.exports = { pairSummary, DEFAULT_MAX_USD, pickAnswer, parseArgs, fill, stepEnv, quoteCmdArg, runStep, applyControl, completionRow, unmetRuns, driftNote, allocateBudget, interleave, modelStepNeverRan, detectionScoreboard, MIN_MODEL_STEP_USD };
