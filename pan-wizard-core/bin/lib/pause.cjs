/**
 * Pause — a typed pause for a person's answer, kept in a file so it outlives
 * the session that asked (durable orchestration Stage D).
 *
 *   .planning/pauses/<id>.json
 *   {id, kind, status: open|answered|expired|cancelled, run, step, question,
 *    expects, created_at, expires_at, answer, note, answered_at, _rev}
 *
 * A checkpoint, a plan-check override, a spec conflict or an autodev
 * human_needed stop opens one; the answer is checked against `expects`
 * (pause-schema.cjs) inside the pause's lock, and status changes follow the
 * `pause` table in transitions.cjs. next-action puts an open pause first, so
 * /pan:resume asks the same question again instead of starting new work.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { toPosix } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const store = require('./store.cjs');
const schema = require('./pause-schema.cjs');

const PAUSES_DIR = 'pauses';

// What each kind waits for, unless the opener says otherwise. `decision` and
// `spec-conflict` take their values from --options.
const KIND_EXPECTS = Object.freeze({
  'human-verify': { type: 'enum', values: ['approved', 'issues'], noteFor: ['issues'] },
  'human-action': { type: 'enum', values: ['done'] },
  'decision': null,
  'spec-conflict': null,
  'plan-override': { type: 'string', maxLength: 1000 },
  'autodev-human': { type: 'string', maxLength: 1000 },
});
const KINDS = Object.keys(KIND_EXPECTS);

const pausePath = (cwd, id) => planningPath(cwd, PAUSES_DIR, `${id}.json`);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** `orchestration.pause_ttl_hours`: hours until a pause expires (null: never). */
function pauseTtlHours(cwd) {
  const v = Number(((store.rawConfig(cwd).orchestration) || {}).pause_ttl_hours);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** A pause as it stands now: an open pause past expires_at reads as expired. */
function effective(p, now = Date.now()) {
  if (p && p.status === 'open' && p.expires_at && Date.parse(p.expires_at) <= now) return { ...p, status: 'expired' };
  return p;
}

function readPause(cwd, id) {
  const r = store.readRecord(pausePath(cwd, id));
  return r.data || null;
}

/** Every pause, newest first; `open` keeps only the open ones. */
function listPauses(cwd, { open = false } = {}) {
  let names = [];
  try { names = fs.readdirSync(planningPath(cwd, PAUSES_DIR)).filter((n) => n.endsWith('.json')); } catch { return []; }
  const all = names.map((n) => effective(store.readRecord(path.join(planningPath(cwd, PAUSES_DIR), n)).data)).filter(Boolean);
  all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return open ? all.filter((p) => p.status === 'open') : all;
}

/**
 * Open a pause. Opening the same question again (same kind, run and step)
 * while it is open returns the open one, so a re-run asks once.
 * @param {object} o - {kind, run?, step?, question, options?: string[], expects?: object, ttlHours?}
 */
function openPause(cwd, o) {
  if (!KINDS.includes(o.kind)) return { error: 'invalid_kind', kind: o.kind || null, allowed: KINDS };
  if (!o.question || !String(o.question).trim()) return { error: 'question_required', reason: 'pass --question "<what the person is asked>"' };
  let expects = o.expects || KIND_EXPECTS[o.kind];
  if (!expects && Array.isArray(o.options) && o.options.length) expects = { type: 'enum', values: o.options };
  if (!expects) return { error: 'expects_required', reason: `a ${o.kind} pause needs --options a,b,c (or --expects '<json>')` };
  const problem = schema.schemaProblem(expects);
  if (problem) return { error: 'invalid_expects', reason: problem };

  const base = `p-${slug(o.kind)}${o.run ? '-' + slug(o.run) : ''}${o.step ? '-' + slug(o.step) : ''}`;
  for (const p of listPauses(cwd, { open: true })) {
    if (p.id.startsWith(base) && p.kind === o.kind && (p.run || null) === (o.run || null) && (p.step || null) === (o.step || null)) {
      return { opened: false, existing: true, pause: p };
    }
  }
  const now = new Date();
  const ttl = o.ttlHours !== undefined ? o.ttlHours : pauseTtlHours(cwd);
  for (let n = 1; n < 100; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const record = {
      id, kind: o.kind, status: 'open', run: o.run || null, step: o.step || null,
      question: String(o.question).slice(0, 2000), expects,
      created_at: now.toISOString(), expires_at: ttl ? new Date(now.getTime() + ttl * 3600000).toISOString() : null,
      answer: null, note: null, answered_at: null,
    };
    let taken = false;
    const w = store.updateRecord(pausePath(cwd, id), (cur) => {
      if (cur) { taken = true; return null; }
      return record;
    }, { transition: 'pause' });
    if (w.error) return w;
    if (!taken) return { opened: true, pause: w.data, file: toPosix(path.relative(cwd, pausePath(cwd, id))) };
  }
  return { error: 'too_many_pauses', reason: `${base}: 99 pauses already exist for this step` };
}

/**
 * Answer an open pause. The answer is checked against the pause's expects and
 * the pause's status inside its lock.
 * @param {object} o - {value?, json?, note?}
 */
function answerPause(cwd, id, o = {}) {
  if (!id) return { error: 'id_required', reason: 'pause answer <id> --value <answer>' };
  let value = o.value;
  if (o.json !== undefined && o.json !== null) {
    try { value = typeof o.json === 'string' ? JSON.parse(o.json) : o.json; } catch (e) { return { error: 'invalid_json', reason: e.message }; }
  }
  let outcome = null;
  const w = store.updateRecord(pausePath(cwd, id), (cur) => {
    if (!cur) { outcome = { error: 'pause_not_found', id }; return store.abort(outcome); }
    if (cur.status !== 'open') {
      // Answered, cancelled or expired is final: a second answer never replaces the first.
      outcome = { error: 'illegal_transition', entity: 'pause', id, from: cur.status, to: 'answered', allowed: [], reason: `pause ${id} is already ${cur.status}` };
      return store.abort(outcome);
    }
    const now = effective(cur);
    if (now.status === 'expired') {
      outcome = { error: 'pause_expired', id, expires_at: cur.expires_at, reason: `pause ${id} expired at ${cur.expires_at}; open it again to ask anew` };
      return { ...cur, status: 'expired' };
    }
    if (cur.expects.type === 'boolean' && typeof value === 'string') value = value === 'true' ? true : value === 'false' ? false : value;
    const bad = schema.validateAnswer(cur.expects, { value, note: o.note });
    if (bad) {
      outcome = { error: 'pause_answer_invalid', id, reason: bad.problem, ...(bad.allowed ? { allowed: bad.allowed } : {}) };
      return store.abort(outcome);
    }
    return { ...cur, status: 'answered', answer: value, note: o.note || null, answered_at: new Date().toISOString() };
  }, { transition: 'pause' });
  if (outcome) return outcome;
  if (w.error) return { ...w, id };
  // The answer joins the run's journal when the pause belongs to a plan step.
  const p = w.data;
  if (p.run && p.step) {
    try { require('./journal.cjs').journalStep(cwd, { plan: p.run, step: p.step, event: 'resumed', note: `pause ${p.id} answered: ${typeof p.answer === 'string' ? p.answer : JSON.stringify(p.answer)}`, by: 'pause' }); } catch { /* best-effort */ }
  }
  return { answered: true, pause: p };
}

function cancelPause(cwd, id, reason) {
  if (!reason || !String(reason).trim()) return { error: 'reason_required', reason: 'pause cancel <id> --reason "<why>"' };
  const w = store.updateRecord(pausePath(cwd, id), (cur) => {
    if (!cur) return store.abort({ error: 'pause_not_found', id });
    if (cur.status !== 'open') return store.abort({ error: 'illegal_transition', entity: 'pause', id, from: cur.status, to: 'cancelled', allowed: [], reason: `pause ${id} is already ${cur.status}` });
    return { ...cur, status: 'cancelled', note: String(reason).slice(0, 1000), answered_at: new Date().toISOString() };
  }, { transition: 'pause' });
  return w.error ? { ...w, id } : { cancelled: true, pause: w.data };
}

/** The next-action step for the oldest open pause, or null. */
function pauseNextStep(cwd) {
  const open = listPauses(cwd, { open: true });
  if (!open.length) return null;
  const p = open[open.length - 1];
  const hint = p.expects.type === 'enum' ? `--value <${p.expects.values.join('|')}>` : p.expects.type === 'object' ? "--json '{...}'" : '--value "<answer>"';
  return {
    action: 'answer_pause', reason: 'pause_open', pause: { id: p.id, kind: p.kind, run: p.run, step: p.step, question: p.question, expects: p.expects },
    command: `pan-tools pause answer ${p.id} ${hint}`,
    detail: `${p.kind} pause ${p.id} is waiting for an answer: ${p.question}`,
    open_pauses: open.length,
  };
}

function cmdPause(cwd, sub, opts, raw) {
  const { output } = require('./core.cjs');
  let r;
  if (sub === 'open') {
    let expects;
    if (opts.expects) { try { expects = JSON.parse(opts.expects); } catch (e) { return output({ error: 'invalid_expects', reason: e.message }, raw); } }
    r = openPause(cwd, { kind: opts.kind, run: opts.run, step: opts.step, question: opts.question, options: opts.options ? opts.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined, expects });
    return output(r, raw, r.error ? 'error' : r.pause.id);
  }
  if (sub === 'answer') {
    r = answerPause(cwd, opts.id, { value: opts.value, json: opts.json, note: opts.note });
    return output(r, raw, r.error ? 'error' : 'answered');
  }
  if (sub === 'list') {
    const pauses = listPauses(cwd, { open: opts.open });
    return output({ pauses, open: pauses.filter((p) => p.status === 'open').length }, raw, String(pauses.length));
  }
  if (sub === 'cancel') {
    r = cancelPause(cwd, opts.id, opts.reason);
    return output(r, raw, r.error ? 'error' : 'cancelled');
  }
  return output({ error: 'unknown_subcommand', reason: `unknown pause subcommand: ${sub}` }, raw);
}

module.exports = { KINDS, KIND_EXPECTS, PAUSES_DIR, openPause, answerPause, cancelPause, listPauses, readPause, pauseNextStep, pauseTtlHours, effective, cmdPause };
