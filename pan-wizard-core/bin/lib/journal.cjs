/**
 * Journal — an append-only record of the steps of a plan, so a run that
 * crashed resumes after the last step it can prove it finished, instead of
 * re-reading the plan and git log (durable orchestration Stage C).
 *
 * One JSON line per event, beside the plan:
 *   .planning/phases/<phase>/<plan>-journal.jsonl
 *   {"seq":3,"ts":"…","run":"03-02","step":"task-2","event":"completed","artifact":{"commit":"a1b2c3d"},"by":"pan-executor"}
 *
 * Lines are evidence, not instructions: a step counts as done only when its
 * latest event is `completed` AND its artifact checks out (a commit reachable
 * from HEAD, or a file whose hash still matches). A forged or stale line can
 * make PAN redo a step, never skip one. No journal means today's behaviour:
 * the plan restarts at its first task.
 *
 * Event changes follow the plan.step table in transitions.cjs.
 *
 * A task commit is evidence on its own: a `PAN-Step: <plan>/task-N` line in
 * its message counts while the commit is reachable from HEAD and not reverted,
 * so a plan resumes correctly even when the executor never journaled the task
 * (or the journal file is gone). One bounded `git log` per process and HEAD
 * finds them all (`trailerIndex`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { findPhaseInternal, verifyCommit, commitReachable, execGit, toPosix } = require('./core.cjs');
const { countPlanTasks } = require('./utils.cjs');
const store = require('./store.cjs');
const transitions = require('./transitions.cjs');

const EVENTS = ['started', 'completed', 'failed', 'paused', 'resumed', 'forced'];
const JOURNAL_SUFFIX = '-journal.jsonl';
// How far back HEAD's history is read for task trailers: far beyond any open
// plan, and bounded so a large repository costs one fast call.
const TRAILER_WINDOW = 1000;
// Any line of the message, any case, leading whitespace allowed (a squash
// merge indents the bodies it folds in). One line per task a commit finishes.
const TRAILER_RE = /^\s*PAN-Step:\s*(\S+?)\/(task-\d+)\s*$/i;
const REVERT_RE = /This reverts commit ([0-9a-f]{7,40})/i;

/**
 * The task trailers in HEAD's newest `window` commits, newest commit per step.
 * Commits a later reachable commit reverted (net of reverts of reverts) do not
 * count. Memoised per directory and HEAD: one git call however many plans ask.
 * @returns {{head: string|null, steps: Map<string, {sha, time}>, plans: Set<string>, shas: string[], reverted: string[]}}
 */
const trailerMemo = new Map();
function trailerIndex(cwd, opts = {}) {
  const window = opts.window || TRAILER_WINDOW;
  const empty = { head: null, steps: new Map(), plans: new Set(), shas: [], reverted: [] };
  const head = execGit(cwd, ['rev-parse', 'HEAD']);
  if (head.exitCode !== 0 || !head.stdout) return empty;
  const key = `${path.resolve(cwd)}\0${head.stdout}\0${window}`;
  if (trailerMemo.has(key)) return trailerMemo.get(key);
  const log = execGit(cwd, ['log', '-n', String(window), '--format=%H%x1f%ct%x1f%B%x1e', 'HEAD']);
  if (log.exitCode !== 0) return empty;
  const commits = [];
  for (const rec of log.stdout.split('\x1e')) {
    const [sha, ct, body = ''] = rec.replace(/^\s+/, '').split('\x1f');
    if (/^[0-9a-f]{40}$/i.test(sha || '')) commits.push({ sha: sha.toLowerCase(), time: Number(ct) || 0, body });
  }
  // Newest first: a commit that is itself reverted undoes nothing.
  const reverted = [];
  const isReverted = (sha) => reverted.some((r) => sha.startsWith(r));
  for (const c of commits) {
    if (isReverted(c.sha)) continue;
    const m = c.body.match(REVERT_RE);
    if (m) reverted.push(m[1].toLowerCase());
  }
  const steps = new Map();
  const plans = new Set();
  for (const c of commits) {
    if (isReverted(c.sha)) continue;
    for (const line of c.body.split('\n')) {
      const m = line.match(TRAILER_RE);
      if (!m) continue;
      const k = `${m[1]}/${m[2]}`;
      plans.add(m[1]);
      if (!steps.has(k)) steps.set(k, { sha: c.sha.slice(0, 7), time: c.time });
    }
  }
  const idx = { head: head.stdout, steps, plans, shas: commits.map((c) => c.sha), reverted };
  trailerMemo.set(key, idx);
  return idx;
}

/**
 * Resolve a plan given as a path (…/03-02-plan.md) or as an id (03-02).
 * @returns {{id: string, plan: string, journal: string} | {error: 'plan_not_found', plan, reason}}
 */
function resolvePlan(cwd, planArg) {
  if (!planArg) return { error: 'plan_required', reason: 'pass --plan <phase>-<plan> or a plan path' };
  const arg = String(planArg).trim();
  let abs = null;
  if (/-plan\.md$/i.test(arg)) {
    abs = path.resolve(cwd, arg);
  } else {
    // The plan number is the last "-NN"; findPhaseInternal judges the phase part
    // (multi-level decimal phases such as 02.1.1, letter phases such as 03A).
    const m = arg.match(/^(.+)-(\d+)$/);
    if (m) {
      const info = findPhaseInternal(cwd, m[1]);
      if (info && info.found) {
        const name = info.plans.find((p) => p.toLowerCase() === `${arg}-plan.md`.toLowerCase());
        if (name) abs = path.resolve(cwd, info.directory, name);
      }
    }
  }
  if (!abs || !fs.existsSync(abs)) return { error: 'plan_not_found', plan: arg, reason: `no plan file for "${arg}" (pass <phase>-<plan>, e.g. 03-02, or the plan's path)` };
  const id = path.basename(abs).replace(/-plan\.md$/i, '');
  return { id, plan: toPosix(path.relative(cwd, abs)), journal: path.join(path.dirname(abs), `${id}${JOURNAL_SUFFIX}`) };
}

/** Every parseable line of a journal, in order. */
function readJournal(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line — skipped */ }
  }
  return rows;
}

/** The latest row per step, in the order steps first appear. */
function latestByStep(rows) {
  const latest = new Map();
  for (const r of rows) if (r && r.step) latest.set(r.step, r);
  return latest;
}

/** Does a completed step's artifact still hold? */
function artifactHolds(cwd, artifact, idx) {
  if (!artifact || typeof artifact !== 'object') return { ok: false, why: 'no artifact recorded' };
  if (artifact.commit) {
    const sha = String(artifact.commit).toLowerCase();
    if (idx && idx.reverted.some((r) => r.startsWith(sha) || sha.startsWith(r))) return { ok: false, why: `commit ${artifact.commit} was reverted` };
    // In the scanned window means reachable from HEAD: no git call needed.
    if (idx && /^[0-9a-f]{4,40}$/.test(sha) && idx.shas.some((s) => s.startsWith(sha))) return { ok: true };
    return commitReachable(cwd, artifact.commit) ? { ok: true } : { ok: false, why: `commit ${artifact.commit} is not reachable from HEAD` };
  }
  if (artifact.file) {
    let raw;
    try { raw = fs.readFileSync(path.resolve(cwd, artifact.file), 'utf-8'); } catch { return { ok: false, why: `${artifact.file} is missing` }; }
    if (artifact.sha1 && store.hashOf(raw) !== artifact.sha1) return { ok: false, why: `${artifact.file} changed since it was recorded` };
    return { ok: true };
  }
  return { ok: false, why: 'no commit or file recorded' };
}

/** The plan's tasks, in order: task-1 … task-N (the count phase-plan-index gives). */
function planTasks(planFile) {
  let text = '';
  try { text = fs.readFileSync(planFile, 'utf-8'); } catch { return []; }
  return Array.from({ length: countPlanTasks(text) }, (_, i) => `task-${i + 1}`);
}

/**
 * Record one event of one step.
 * @param {object} o - {plan, step, event, commit?, file?, note?, by?}
 * @returns {{recorded: true, seq, plan, step, event, journal} | refusal}
 */
function journalStep(cwd, o) {
  const p = resolvePlan(cwd, o.plan);
  if (p.error) return p;
  if (!o.step || !/^[A-Za-z0-9._-]{1,64}$/.test(o.step)) return { error: 'step_required', reason: 'pass --step <name>, e.g. task-3 (letters, digits, . _ -)' };
  if (!EVENTS.includes(o.event)) return { error: 'invalid_event', event: o.event || null, allowed: EVENTS };
  let artifact = null;
  if (o.commit) {
    const sha = verifyCommit(cwd, o.commit);
    if (!sha) return { error: 'commit_unknown', commit: o.commit, reason: `${o.commit} is not a commit reachable from HEAD` };
    artifact = { commit: sha };
  } else if (o.file) {
    const abs = path.resolve(cwd, o.file);
    let raw;
    try { raw = fs.readFileSync(abs, 'utf-8'); } catch { return { error: 'file_missing', file: o.file }; }
    artifact = { file: toPosix(path.relative(cwd, abs)), sha1: store.hashOf(raw) };
  }
  if (o.event === 'completed' && !artifact) {
    return { error: 'artifact_required', reason: 'a completed step names what proves it: --commit <sha> or --file <path>' };
  }
  // `forced` is the recorded override (journal fork, a hand fix): never checked.
  let refused = null;
  if (o.event !== 'forced') {
    const prev = latestByStep(readJournal(p.journal)).get(o.step);
    refused = transitions.checkTransition('plan.step', prev ? prev.event : null, o.event);
    if (refused && prev && prev.event === 'forced') refused = null;
  }
  if (refused) return { ...refused, plan: p.id, step: o.step };
  const w = store.appendLine(p.journal, {
    ts: new Date().toISOString(), run: p.id, step: o.step, event: o.event,
    ...(artifact ? { artifact } : {}), ...(o.note ? { note: String(o.note).slice(0, 500) } : {}), ...(o.by ? { by: o.by } : {}),
  });
  if (w.error) return w;
  return { recorded: true, seq: w.seq, plan: p.id, step: o.step, event: o.event, journal: toPosix(path.relative(cwd, p.journal)) };
}

/**
 * Where a plan resumes: the first task not proven done.
 * @returns {{plan, journal: string|null, tasks: number, completed: Array, unverified: Array, resume_at: string|null, all_done: boolean}}
 */
function resumePoint(cwd, planArg, opts = {}) {
  const p = resolvePlan(cwd, planArg);
  if (p.error) return p;
  const rows = readJournal(p.journal);
  const tasks = planTasks(path.resolve(cwd, p.plan));
  const latest = latestByStep(rows);
  const idx = trailerIndex(cwd, opts);
  const trailerOf = (step) => idx.steps.get(`${p.id}/${step}`) || null;
  const completed = [];
  const unverified = [];
  const steps = [...latest.keys()];
  for (const t of tasks) if (!latest.has(t) && trailerOf(t)) steps.push(t);
  if (!tasks.length) for (const k of idx.steps.keys()) if (k.startsWith(`${p.id}/`) && !steps.includes(k.slice(p.id.length + 1))) steps.push(k.slice(p.id.length + 1));
  for (const step of steps) {
    const row = latest.get(step);
    const held = row && row.event === 'completed' ? artifactHolds(cwd, row.artifact, idx) : null;
    if (held && held.ok) {
      completed.push({ step, source: 'journal', ...(row.artifact.commit ? { commit: row.artifact.commit } : { file: row.artifact.file }) });
      continue;
    }
    // A trailer counts unless the journal moved the step on after its commit
    // (re-started, failed, paused, or a recorded override).
    const tr = trailerOf(step);
    const journalNewer = row && row.event !== 'completed' && (row.event === 'forced' || Date.parse(row.ts) >= (tr ? tr.time + 1 : 0) * 1000);
    if (tr && !journalNewer) {
      completed.push({ step, source: 'trailer', commit: tr.sha });
      continue;
    }
    if (held) unverified.push({ step, why: held.why });
  }
  const done = new Set(completed.map((c) => c.step));
  const evidence = rows.length > 0 || completed.some((c) => c.source === 'trailer');
  // The plan's own task list orders the steps; a journal step not in it (a
  // plan edited since) still blocks if it is unfinished.
  const order = tasks.length ? tasks : steps;
  const firstOpen = order.find((s) => !done.has(s))
    || [...latest.keys()].find((s) => !done.has(s) && latest.get(s).event !== 'completed')
    || null;
  return {
    plan: p.id,
    journal: rows.length ? toPosix(path.relative(cwd, p.journal)) : null,
    tasks: tasks.length,
    completed,
    unverified,
    resume_at: evidence ? firstOpen : null,
    all_done: evidence && tasks.length > 0 && tasks.every((s) => done.has(s)),
  };
}

/**
 * The resume point of every unfinished plan under a phase directory that has a
 * journal or task trailers in HEAD's history. A plan with a summary is
 * finished: its evidence is history and is not checked again.
 */
function journalsIn(cwd, phaseDir) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(phaseDir); } catch { return out; }
  const idx = trailerIndex(cwd);
  for (const n of names.filter((x) => /-plan\.md$/i.test(x))) {
    const id = n.replace(/-plan\.md$/i, '');
    const plan = path.join(phaseDir, n);
    if (names.includes(`${id}-summary.md`)) continue;
    if (!names.includes(`${id}${JOURNAL_SUFFIX}`) && !idx.plans.has(id)) continue;
    const rp = resumePoint(cwd, toPosix(path.relative(cwd, plan)));
    if (!rp.error) out[n] = rp;
  }
  return out;
}

function cmdJournal(cwd, sub, opts, raw) {
  const { output } = require('./core.cjs');
  let r;
  if (sub === 'step') {
    r = journalStep(cwd, opts);
    return output(r, raw, r.error ? 'error' : String(r.seq));
  }
  if (sub === 'show') {
    const p = resolvePlan(cwd, opts.plan);
    if (p.error) return output(p, raw);
    const entries = readJournal(p.journal);
    return output({ plan: p.id, journal: entries.length ? toPosix(path.relative(cwd, p.journal)) : null, entries }, raw, String(entries.length));
  }
  if (sub === 'resume-point') {
    r = resumePoint(cwd, opts.plan);
    return output(r, raw, r.error ? 'error' : (r.resume_at || (r.all_done ? 'done' : 'start')));
  }
  return output({ error: 'unknown_subcommand', reason: `unknown journal subcommand: ${sub}` }, raw);
}

module.exports = {
  EVENTS,
  JOURNAL_SUFFIX,
  resolvePlan,
  readJournal,
  journalStep,
  resumePoint,
  journalsIn,
  trailerIndex,
  TRAILER_WINDOW,
  planTasks,
  cmdJournal,
};
