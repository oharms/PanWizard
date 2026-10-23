#!/usr/bin/env node
'use strict';

/**
 * Corpus judge driver (program H4): produce LIVE judge rows for the seeded-defect corpus,
 * the input harness/scripts/catch-rate.cjs scores. Paid evidence steps H4, R2, R5, V8 and V10
 * run through it on the owner's Claude Code login (no API key is needed: it drives `claude -p`).
 *
 *   node harness/scripts/corpus-run.cjs --judge verifier|reviewer|plan-checker|meta-reviewer
 *        (--dry-run | --max-usd N) [--session-usd 2] [--entry <id>]... [--limit N]
 *        [--profile balanced] [--arm <label>] [--variant <installed path>=<harness/variants file>]
 *        [--lenses k] [--out rows.jsonl] [--state-dir <dir>] [--package <extracted package dir>]
 *        [--timeout-min 20] [--keep]
 *
 * Per corpus entry and twin (clean, defect): a workspace under the state dir holds a PAN
 * project whose phase 1 was given the entry's task. The base commit is the planning tree plus
 * PAN, installed from a packed artifact (harness/src/artifact.cjs, never the source tree); the
 * second commit is the twin, as the executor's change, with a plan summary. One headless
 * `claude -p` session (harness/src/model.cjs runModelStep: its argv, --max-budget-usd, and
 * cost read from the JSON result) spawns the named judge on that change. The judge's report
 * (its pan-verdict block, or a verifier's verification.md) becomes one row:
 *   {corpus, twin, judge, host, profile, report, arm, cost_usd, duration_ms, ...}
 * appended to --out. With --arm the row's profile is "<profile>:<arm>", so catch-rate keys
 * the arm apart (judge × host × profile) and --compare can pair it against the baseline.
 *
 *   --variant   as harness/src/run.cjs --variant: after install, the installed file at
 *               <installed path> is replaced by <file>, which must be under harness/variants/
 *   --lenses k  reviewer only (R2): k passes per twin, each with one <lens> (correctness,
 *               security, maintainability, round robin), merged by the installed
 *               `pan-tools review vote`; the merged report is the row's report
 *   --max-usd   hard cap across the run, required for a live run. A twin starts only while
 *               the remaining cap covers all of its sessions at --session-usd each, so the
 *               run stops before a session could overrun it
 *   --dry-run   prints the plan (entries × twins × arm, sessions, spend ceiling) and spends
 *               nothing: no pack, no workspace, no CLI
 *
 * Each twin's workspace is deleted once its row is written, and the extracted package at the
 * end of the run; --keep leaves both. Test safety: with PAN_STANDIN_DIR set, `claude` must be
 * a stand-in in that directory (autodev.cjs standinMissing) and that directory leads PATH.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadCorpus, twinFiles, TWINS, CORPUS_DIR } = require('../src/corpus.cjs');
const { parseVerdictText } = require('../../pan-wizard-core/bin/lib/verdict.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const JUDGES = Object.freeze({
  verifier: 'pan-verifier', reviewer: 'pan-reviewer', 'plan-checker': 'pan-plan-checker', 'meta-reviewer': 'pan-meta-reviewer',
});
const LENSES = Object.freeze(['correctness', 'security', 'maintainability']);
const PHASE_DIR = '.planning/phases/01-corpus';
const DEFAULT_SESSION_USD = 2;
function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=pan-corpus', '-c', 'user.email=corpus@pan.local', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed in ${cwd}: ${String(r.stderr || r.error || '').trim().slice(-400)}`);
  return r.stdout;
}

function defaultStateDir() {
  const testDir = process.platform === 'win32' ? 'C:\\Project\\pantesting' : null;
  return testDir && fs.existsSync(testDir) ? path.join(testDir, 'corpus-runs') : path.join(os.tmpdir(), 'pan-corpus-runs');
}

function parseArgs(argv) {
  const a = { judge: null, entries: [], limit: null, maxUsd: null, sessionUsd: DEFAULT_SESSION_USD, profile: 'balanced', arm: null, variant: null, lenses: 1, out: null, stateDir: null, pkg: null, timeoutMin: 20, keep: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = argv[i + 1];
    const num = () => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${k} needs a number`); i++; return n; };
    if (k === '--judge') { a.judge = v; i++; }
    else if (k === '--entry') { a.entries.push(v); i++; }
    else if (k === '--limit') a.limit = num();
    else if (k === '--max-usd') a.maxUsd = num();
    else if (k === '--session-usd') a.sessionUsd = num();
    else if (k === '--profile') { a.profile = v; i++; }
    else if (k === '--arm') { a.arm = v; i++; }
    else if (k === '--variant') { const s = String(v || ''); const at = s.indexOf('='); a.variant = { path: s.slice(0, at), file: s.slice(at + 1) }; i++; }
    else if (k === '--lenses') a.lenses = num();
    else if (k === '--out') { a.out = path.resolve(v); i++; }
    else if (k === '--state-dir') { a.stateDir = path.resolve(v); i++; }
    else if (k === '--package') { a.pkg = path.resolve(v); i++; }
    else if (k === '--timeout-min') a.timeoutMin = num();
    else if (k === '--keep') a.keep = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (a.help) return a;
  if (!JUDGES[a.judge]) throw new Error(`--judge must be one of ${Object.keys(JUDGES).join(', ')}`);
  if (!Number.isInteger(a.lenses) || a.lenses < 1) throw new Error('--lenses needs a whole number of passes, 1 or more');
  if (a.lenses > 1 && a.judge !== 'reviewer') throw new Error('--lenses applies to the reviewer only (R2)');
  if (!(a.sessionUsd > 0)) throw new Error('--session-usd must be above 0');
  if (a.variant && (!a.variant.path || !a.variant.file)) throw new Error('--variant takes <installed path>=<file>');
  if (!a.dryRun && !(typeof a.maxUsd === 'number' && a.maxUsd > 0)) throw new Error('a live run needs --max-usd N (the hard cap across the run); --dry-run spends nothing');
  if (a.pkg && path.resolve(a.pkg) === REPO) throw new Error('--package must be an extracted package, never the source tree');
  return a;
}

/** The entries selected by --entry and --limit. */
function selectEntries(corpus, opts) {
  let list = corpus;
  if (opts.entries.length) {
    const missing = opts.entries.filter((id) => !corpus.some((e) => e.id === id));
    if (missing.length) throw new Error(`no corpus entry ${missing.join(', ')}`);
    list = corpus.filter((e) => opts.entries.includes(e.id));
  }
  if (opts.limit != null) list = list.slice(0, Math.max(0, opts.limit));
  return list;
}

/** The run's plan: every session it would start, and its spend ceiling. Pure. */
function planRun(entries, opts) {
  const twins = entries.flatMap((e) => TWINS.map((twin) => ({ corpus: e.id, twin })));
  const sessions = twins.length * opts.lenses;
  return {
    judge: JUDGES[opts.judge], arm: opts.arm, variant: opts.variant, profile: rowProfile(opts), lenses: opts.lenses,
    entries: entries.map((e) => e.id), twins: twins.length, sessions, session_usd: opts.sessionUsd,
    ceiling_usd: +(sessions * opts.sessionUsd).toFixed(2), max_usd: opts.maxUsd,
    twins_within_cap: opts.maxUsd == null ? null : Math.min(twins.length, Math.floor(opts.maxUsd / (opts.sessionUsd * opts.lenses))),
  };
}

const rowProfile = (opts) => (opts.arm ? `${opts.profile}:${opts.arm}` : opts.profile);

/** The PAN planning tree for an entry's phase 1 (the task it was given). Pure. */
function planningFiles(entry, profile, changed) {
  const t = entry.task;
  const list = changed.map((f) => `\`${f}\``).join(', ');
  return new Map([
    ['.planning/config.json', JSON.stringify({ model_profile: profile, commit_docs: true, workflow: { auto_advance: false } }, null, 2) + '\n'],
    ['.planning/project.md', `# Corpus project\n\n## What This Is\n\nA small Node.js library. Zero dependencies; tests use \`node --test\`.\n\n## Core Value\n\nThe phase's task is done as stated, with tests that check it.\n`],
    ['.planning/requirements.md', `# Requirements\n\n## v1.0 Requirements\n\n- **REQ-01** — ${t}\n\n## Traceability\n\n| Requirement | Phase | Plan | Status |\n|---|---|---|---|\n| REQ-01 | 1 | 01-01 | Complete |\n`],
    ['.planning/roadmap.md', `# Roadmap: Corpus\n\n## Phases\n\n- [ ] **Phase 1: Corpus** - ${t}\n\n## Phase Details\n\n### Phase 1: Corpus\n**Goal:** ${t}\n**Depends on:** Nothing (first phase)\n**Requirements:** REQ-01\n**Success Criteria** (what must be TRUE):\n  1. ${t}\n  2. \`npm test\` passes\n**Plans:** 1 plan\n\nPlans:\n- [x] 01-01: ${t}\n`],
    ['.planning/state.md', `# Project State\n\n## Current Position\n\n**Current Phase:** 1\n**Current Phase Name:** Corpus\n**Current Plan:** 01\n**Total Plans in Phase:** 1\n**Total Phases:** 1\n**Status:** Executed, awaiting verification\n`],
    [`${PHASE_DIR}/01-01-plan.md`, `---\nphase: 01-corpus\nplan: 01\ntype: execute\nwave: 1\ndepends_on: []\nfiles_modified: [${changed.join(', ')}]\nautonomous: true\nrequirements: [REQ-01]\n\nmust_haves:\n  truths:\n    - ${JSON.stringify(t)}\n    - "npm test passes"\n---\n\n<objective>\n${t}\n\nOutput: ${list}, committed.\n</objective>\n\n<tasks>\n\n<task type="auto">\n  <name>Task 1: ${t.replace(/[<>]/g, '')}</name>\n  <files>${changed.join(', ')}</files>\n  <action>${t}</action>\n  <verify>npm test</verify>\n  <done>The task is done as stated and npm test passes.</done>\n</task>\n\n</tasks>\n`],
  ]);
}

/** The executor's summary, written with the change (true for the clean twin, not for the defect). */
function summaryFile(entry, changed) {
  return `---\nphase: 01-corpus\nplan: 01\nstatus: complete\nkey-files:\n  created: [${changed.join(', ')}]\n---\n\n# Plan 01-01 Summary\n\n${entry.task}\n\nDone as planned; \`npm test\` passes.\n`;
}

function writeFiles(dest, files) {
  for (const [rel, content] of files) {
    const p = path.join(dest, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

/**
 * The workspace for one twin: planning tree + PAN (installed from the package) + an optional
 * variant as the base commit, then the twin and its summary as the change commit.
 */
function buildWorkspace(wsRoot, entry, twin, installer, opts, variantArm) {
  const { installPan } = require('../src/workspace.cjs');
  const name = `${entry.id}-${twin}`;
  const ws = path.join(wsRoot, name);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  const files = twinFiles(entry, twin);
  const changed = [...files.keys()];
  writeFiles(ws, planningFiles(entry, opts.profile, changed));
  const inst = installPan(installer, ws, ['--claude']);
  if (inst.code !== 0) throw new Error(`install into ${name} failed (exit ${inst.code}): ${(inst.stderr || inst.error || '').slice(-400)}`);
  if (variantArm) {
    const p = path.join(ws, variantArm.write.path);
    if (!fs.existsSync(p)) throw new Error(`--variant: ${variantArm.write.path} is not an installed file`);
    fs.writeFileSync(p, variantArm.write.content);
  }
  git(ws, ['init', '-q']);
  // What the installer wrote stays out of git (excluded, not committed): the change under
  // judgement is the twin alone, and a deep install path can pass Windows' path limit.
  const installed = fs.readdirSync(ws).filter((n) => n !== '.git' && n !== '.planning');
  fs.appendFileSync(path.join(ws, '.git', 'info', 'exclude'), installed.map((n) => `/${n}`).join('\n') + '\n');
  git(ws, ['add', '-A']);
  git(ws, ['commit', '-q', '-m', 'chore: plan phase 1 (corpus)']);
  writeFiles(ws, files);
  writeFiles(ws, new Map([[`${PHASE_DIR}/01-01-summary.md`, summaryFile(entry, changed)]]));
  git(ws, ['add', '-A']);
  git(ws, ['commit', '-q', '-m', `feat(01-01): ${entry.task.slice(0, 60)}`]);
  return ws;
}

/** The headless session's prompt for one judge (and, for the reviewer, one lens). Pure. */
function judgePrompt(judge, entry, { lens = null, pass = null, model = null } = {}) {
  const agent = JUDGES[judge];
  const spawn = `Spawn the \`${agent}\` agent with the Agent tool (subagent_type \`${agent}\`${model ? `, model \`${model}\`` : ''})`;
  const context = [
    'This workspace is a PAN project. Phase 1 (`' + PHASE_DIR + '/`) was given one task:',
    '',
    `> ${entry.task}`,
    '',
    'Its executor\'s change is the last commit (`git show HEAD`; `git diff HEAD~1 --stat` lists the files), with its summary in `' + PHASE_DIR + '/01-01-summary.md`.',
    'You are the orchestrator of one judge run. Do not change any source or test file, and do not fix anything: report only.',
    '',
  ];
  const tail = 'Then print the agent\'s full report verbatim as your final reply, ending with its `pan-verdict` block. Add nothing after the block.';
  if (judge === 'verifier') {
    return [...context,
      `${spawn} to verify phase 1 (phase dir \`${PHASE_DIR}\`, phase number 01). It writes \`${PHASE_DIR}/01-verification.md\`.`,
      'Then print that verification file verbatim (frontmatter included) as your final reply.', ''].join('\n');
  }
  if (judge === 'reviewer') {
    return [...context,
      `${spawn} to review the files phase 1 changed (\`git diff HEAD~1\`) against the task.${lens ? ` The agent's prompt names its lens: <lens>${lens}</lens>.` : ''}`,
      tail, ''].join('\n');
  }
  if (judge === 'plan-checker') {
    return [...context,
      `${spawn} to check phase 1's plan set (\`${PHASE_DIR}/01-01-plan.md\`) against the phase goal in \`.planning/roadmap.md\`, reading the code now committed as what the plan produced.`,
      tail, ''].join('\n');
  }
  return [...context,
    'Run the review-deep first pass: spawn `pan-reviewer` and `pan-hardener` (subagent types of the same names) on the files phase 1 changed (`git diff HEAD~1`).',
    `Save their reports to \`${PHASE_DIR}/01-review.md\` and \`${PHASE_DIR}/01-hardening.md\`. Then ${spawn.charAt(0).toLowerCase() + spawn.slice(1)} on both reports.`,
    'Print the meta-reviewer\'s report as your final reply, ending with ONE `pan-verdict` block (contract in `.claude/pan-wizard-core/references/verdict-contract.md`) with `"agent": "pan-meta-reviewer"`, `outcome` `pass` or `fail` from the meta-reviewer\'s conclusion, and the findings it upholds or adds, each with `where` naming the file. Add nothing after the block.',
    ''].join('\n');
}

/**
 * The judge's report: the session's reply when it carries a readable verdict, else a
 * judge-written file in the phase dir (a verification.md, a review) that does.
 */
function readReport(ws, reply, agent) {
  if (parseVerdictText(String(reply || ''), { agent }).ok) return { report: String(reply), source: 'reply' };
  const dir = path.join(ws, PHASE_DIR);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /\.md$/.test(n) && !/-(plan|summary)\.md$|^pass-/.test(n)).sort(); } catch { /* no phase dir */ }
  const pref = (n) => (/verification/.test(n) ? 0 : /meta/.test(n) ? 1 : 2);
  for (const n of names.sort((x, y) => pref(x) - pref(y))) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8');
    if (parseVerdictText(text, { agent }).ok) return { report: text, source: `${PHASE_DIR}/${n}` };
  }
  return { report: String(reply || ''), source: 'reply' };
}

/** Resolve the judge's model the way PAN's workflows do (installed `pan-tools resolve-model`). */
function resolveModel(ws, agent) {
  const { runPan } = require('../src/workspace.cjs');
  const r = runPan(ws, ['resolve-model', agent]);
  try { const m = JSON.parse(r.stdout).model; return m && m !== 'inherit' ? m : null; } catch { return null; }
}

function standinGuard() {
  const dir = process.env.PAN_STANDIN_DIR;
  if (!dir) return null;
  const { standinMissing } = require('../../pan-wizard-core/bin/lib/autodev.cjs');
  const missing = standinMissing('claude');
  if (missing) return missing;
  process.env.PATH = dir + path.delimiter + (process.env.PATH || '');
  return null;
}

/**
 * Run the plan. Synchronous; rows are appended to opts.out as each twin finishes.
 * @returns {{rows: Object[], spent: number, sessions: number, stopped: string|null}}
 */
function runCorpus(entries, opts, log = (s) => process.stderr.write(s + '\n')) {
  const refused = standinGuard();
  if (refused) throw new Error(refused);
  const { runModelStep } = require('../src/model.cjs');
  const { variantArm } = require('../src/run.cjs');
  const vArm = opts.variant ? variantArm(REPO, opts.variant) : null;
  const agent = JUDGES[opts.judge];
  const stateDir = opts.stateDir || defaultStateDir();
  fs.mkdirSync(stateDir, { recursive: true });
  const runDir = fs.mkdtempSync(path.join(stateDir, 'corpus-'));
  const out = opts.out || path.join(runDir, 'rows.jsonl');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const wsRoot = path.join(runDir, 'ws');
  let pkg; let build = null;

  const rows = [];
  let spent = 0; let sessions = 0; let stopped = null;
  const need = opts.sessionUsd * opts.lenses;
  try {
    if (opts.pkg) pkg = { installer: path.join(opts.pkg, 'bin', 'install.js'), packageDir: opts.pkg };
    else { pkg = require('../src/artifact.cjs').packAndExtract(REPO, path.join(runDir, 'artifact')); build = pkg.build; }
    if (!fs.existsSync(pkg.installer)) throw new Error(`no installer at ${pkg.installer}`);
    outer: for (const entry of entries) {
      for (const twin of TWINS) {
        if (opts.maxUsd - spent < need) { stopped = `cap: $${(opts.maxUsd - spent).toFixed(2)} left of $${opts.maxUsd}, a twin needs $${need.toFixed(2)}`; break outer; }
        const t0 = Date.now();
        const ws = buildWorkspace(wsRoot, entry, twin, pkg.installer, opts, vArm);
        const model = resolveModel(ws, agent);
        const passes = [];
        let cost = 0; let costUnread = false; let durationMs = 0; let exit = 0; let stderr = '';
        for (let p = 0; p < opts.lenses; p++) {
          const lens = opts.lenses > 1 ? LENSES[p % LENSES.length] : null;
          const prompt = judgePrompt(opts.judge, entry, { lens, model });
          const s0 = Date.now();
          const r = runModelStep(ws, prompt, { maxUsd: opts.sessionUsd, timeoutMs: opts.timeoutMin * 60000 });
          sessions++;
          const measured = r.json && typeof r.json.total_cost_usd === 'number';
          if (!measured) costUnread = true;
          // An unread cost is charged at the session's ceiling, so the cap still holds.
          const charged = measured ? r.costUsd : opts.sessionUsd;
          cost += r.costUsd || 0; spent += charged;
          durationMs += r.durationMs != null ? r.durationMs : Date.now() - s0;
          if (r.code !== 0) { exit = r.code; stderr = String(r.stderr || '').slice(-300); }
          passes.push(readReport(ws, r.stdout, agent));
        }
        let report; let source;
        if (opts.lenses > 1) {
          const { runPan } = require('../src/workspace.cjs');
          const files = passes.map((x, i) => { const f = `${PHASE_DIR}/pass-${i + 1}-${LENSES[i % LENSES.length]}.md`; fs.writeFileSync(path.join(ws, f), x.report); return f; });
          const merged = `${PHASE_DIR}/01-review-merged.md`;
          const v = runPan(ws, ['review', 'vote', '--phase', '1', '--out', merged, ...files]);
          report = v.code === 0 && fs.existsSync(path.join(ws, merged)) ? fs.readFileSync(path.join(ws, merged), 'utf8') : '';
          source = v.code === 0 ? `review vote (${opts.lenses} lenses)` : `review vote failed: ${(v.stdout + v.stderr).slice(-200)}`;
        } else ({ report, source } = passes[0]);
        const row = {
          corpus: entry.id, twin, judge: agent, host: 'claude', profile: rowProfile(opts), report,
          arm: opts.arm || 'baseline', variant: opts.variant ? opts.variant.file : null, lenses: opts.lenses, model,
          cost_usd: +cost.toFixed(4), cost_unread: costUnread || undefined, duration_ms: durationMs, wall_ms: Date.now() - t0,
          exit, stderr_tail: exit ? stderr : undefined, report_source: source, build, ts: new Date().toISOString(),
        };
        fs.appendFileSync(out, JSON.stringify(row) + '\n');
        rows.push(row);
        const readable = parseVerdictText(report, { agent }).ok;
        log(`[corpus] ${entry.id} ${twin}: ${readable ? 'verdict read' : 'NO VERDICT'} from ${source}, $${row.cost_usd} (spent $${spent.toFixed(2)} of $${opts.maxUsd})`);
        if (!opts.keep) fs.rmSync(ws, { recursive: true, force: true });
      }
    }
  } finally {
    // No leftovers (owner rule), also when a twin threw: only the rows (and --keep) stay.
    if (!opts.keep) {
      fs.rmSync(wsRoot, { recursive: true, force: true });
      fs.rmSync(path.join(runDir, 'artifact'), { recursive: true, force: true });
      if (opts.out && !fs.readdirSync(runDir).length) fs.rmSync(runDir, { recursive: true, force: true });
    }
  }
  return { rows: rows.length, out, spent: +spent.toFixed(4), sessions, stopped, run_dir: fs.existsSync(runDir) ? runDir : null };
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { process.stderr.write(`corpus-run: ${e.message}\n`); return 2; }
  if (opts.help) { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/\n'); return 0; }
  let entries;
  try { entries = selectEntries(loadCorpus(CORPUS_DIR), opts); } catch (e) { process.stderr.write(`corpus-run: ${e.message}\n`); return 2; }
  const plan = planRun(entries, opts);
  if (opts.dryRun) { process.stdout.write(JSON.stringify({ dry_run: true, ...plan }, null, 2) + '\n'); return 0; }
  try {
    const res = runCorpus(entries, opts);
    process.stdout.write(JSON.stringify({ ...plan, ...res }, null, 2) + '\n');
    return 0;
  } catch (e) {
    process.stderr.write(`corpus-run: ${e.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = { JUDGES, LENSES, parseArgs, selectEntries, planRun, planningFiles, judgePrompt, readReport, runCorpus, defaultStateDir };
