/**
 * Campaign — scheduled, self-resuming bot-army campaigns (ADR-0034).
 *
 * PAN is not a daemon: this module owns the schedule DESCRIPTOR and the
 * decision of whether a run is DUE. An external trigger (host scheduler,
 * cron, /loop, or a human) polls `campaign due` and fires `/pan:army
 * --continue`. The always-ask human merge gate is never affected by
 * scheduling. Pure + synchronous; `now` is injected for testability.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');

const ORCH_DIR = 'orchestration';
const SCHEDULE_FILE = 'schedule.json';
const HISTORY_CAP = 50;
const DAY_MS = 86400000;

function schedulePath(cwd) {
  return path.join(cwd, PLANNING_DIR, ORCH_DIR, SCHEDULE_FILE);
}

/**
 * Parse a cadence string into milliseconds.
 * @param {string} c - 'hourly' | 'daily' | 'weekly' | 'Nh' | 'Nd'
 * @returns {number|null} ms, or null if unparseable
 */
function parseCadence(c) {
  if (!c || typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  if (s === 'hourly') return 3600000;
  if (s === 'daily') return DAY_MS;
  if (s === 'weekly') return 7 * DAY_MS;
  const m = s.match(/^(\d+)\s*([hd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n <= 0) return null;
  return m[2] === 'h' ? n * 3600000 : n * DAY_MS;
}

/** @returns {object|null} the schedule descriptor, or null if none/unreadable */
function readSchedule(cwd) {
  try {
    return JSON.parse(fs.readFileSync(schedulePath(cwd), 'utf8'));
  } catch {
    return null;
  }
}

function writeScheduleFile(cwd, schedule) {
  const p = schedulePath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(schedule, null, 2) + '\n', 'utf8');
}

/**
 * Arm or update a campaign schedule.
 * @param {string} cwd
 * @param {object} opts - { goal, source, cadence, daily_budget, enabled, paused }
 * @param {Date} now
 * @returns {object|{error}} the written descriptor
 */
function writeSchedule(cwd, opts, now) {
  const cadence = opts.cadence || 'daily';
  if (parseCadence(cadence) === null) {
    return { error: `Invalid cadence "${cadence}". Use hourly | daily | weekly | Nh | Nd.` };
  }
  const at = now || new Date();
  const existing = readSchedule(cwd) || {};
  const schedule = {
    goal: opts.goal ?? existing.goal ?? null,
    source: opts.source ?? existing.source ?? 'backlog',
    cadence,
    daily_budget: opts.daily_budget != null ? Number(opts.daily_budget) : (existing.daily_budget ?? 300),
    enabled: opts.enabled != null ? Boolean(opts.enabled) : (existing.enabled ?? true),
    paused: opts.paused != null ? Boolean(opts.paused) : (existing.paused ?? false),
    next_due: existing.next_due ?? at.toISOString(),
    last_run: existing.last_run ?? null,
    history: Array.isArray(existing.history) ? existing.history : [],
  };
  writeScheduleFile(cwd, schedule);
  return schedule;
}

function sameUtcDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function spentToday(schedule, now) {
  return (schedule.history || [])
    .filter(h => { const t = new Date(h.ts); return !isNaN(t) && sameUtcDay(t, now); })
    .reduce((sum, h) => sum + (Number(h.points_used) || 0), 0);
}

/**
 * Is a scheduled run due right now?
 * @returns {{due: boolean, reason: string, next_due: string|null, spent_today: number}}
 */
function isRunDue(schedule, now) {
  const at = now || new Date();
  if (!schedule) return { due: false, reason: 'no_schedule', next_due: null, spent_today: 0 };
  const spent = spentToday(schedule, at);
  if (!schedule.enabled) return { due: false, reason: 'disabled', next_due: schedule.next_due, spent_today: spent };
  if (schedule.paused) return { due: false, reason: 'paused', next_due: schedule.next_due, spent_today: spent };
  if (schedule.daily_budget != null && spent >= schedule.daily_budget) {
    return { due: false, reason: 'budget_exhausted_today', next_due: schedule.next_due, spent_today: spent };
  }
  const due = new Date(schedule.next_due);
  if (isNaN(due) || at.getTime() >= due.getTime()) {
    return { due: true, reason: 'due', next_due: schedule.next_due, spent_today: spent };
  }
  return { due: false, reason: 'not_yet', next_due: schedule.next_due, spent_today: spent };
}

/**
 * Record a completed campaign run and advance next_due.
 * @returns {object|{error}} updated descriptor
 */
function recordRun(cwd, run, now) {
  const schedule = readSchedule(cwd);
  if (!schedule) return { error: 'No campaign schedule to record against' };
  const at = now || new Date();
  const ts = run?.ts || at.toISOString();
  schedule.history = (schedule.history || []).concat([{
    ts,
    items_landed: Number(run?.items_landed) || 0,
    points_used: Number(run?.points_used) || 0,
  }]).slice(-HISTORY_CAP);
  schedule.last_run = ts;
  const step = parseCadence(schedule.cadence) || DAY_MS;
  schedule.next_due = new Date(at.getTime() + step).toISOString();
  writeScheduleFile(cwd, schedule);
  return schedule;
}

/**
 * Is the retro/learn ("dream") step due? Default: once per calendar day that
 * had activity — curate memory between missions, not after every cycle.
 */
function isDreamDue(schedule, now) {
  if (!schedule || !schedule.enabled || schedule.paused) return false;
  const at = now || new Date();
  if (!schedule.last_run) return false;
  const last = new Date(schedule.last_run);
  if (isNaN(last)) return false;
  return !sameUtcDay(last, at) || (schedule.history || []).length > 0;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function cmdCampaignSchedule(cwd, opts, raw) {
  const r = writeSchedule(cwd, opts, opts.now);
  if (r.error) return error(r.error);
  const human = `Campaign scheduled: ${r.cadence} · budget ${r.daily_budget}/day · next ${r.next_due}${r.goal ? ` · goal: ${r.goal}` : ''}`;
  output(r, raw, human);
}

function cmdCampaignStatus(cwd, raw) {
  const schedule = readSchedule(cwd);
  if (!schedule) return output({ scheduled: false }, raw, 'No campaign scheduled');
  const at = new Date();
  const d = isRunDue(schedule, at);
  const result = {
    scheduled: true, enabled: schedule.enabled, paused: schedule.paused,
    cadence: schedule.cadence, daily_budget: schedule.daily_budget,
    next_due: schedule.next_due, last_run: schedule.last_run,
    spent_today: d.spent_today, runs: (schedule.history || []).length,
    due: d.due, reason: d.reason,
  };
  const human = `Campaign ${schedule.enabled ? (schedule.paused ? 'paused' : 'active') : 'disabled'} · ${schedule.cadence} · spent ${d.spent_today}/${schedule.daily_budget} today · next ${schedule.next_due} · ${d.due ? 'DUE NOW' : d.reason}`;
  output(result, raw, human);
}

function cmdCampaignDue(cwd, raw) {
  const schedule = readSchedule(cwd);
  const d = isRunDue(schedule, new Date());
  // exit-coded so a host scheduler can gate: 0 = due, 1 = not due
  output({ due: d.due, reason: d.reason, next_due: d.next_due }, raw, d.due ? 'due' : `not due (${d.reason})`);
}

module.exports = {
  parseCadence,
  readSchedule,
  writeSchedule,
  isRunDue,
  recordRun,
  isDreamDue,
  cmdCampaignSchedule,
  cmdCampaignStatus,
  cmdCampaignDue,
  SCHEDULE_FILE,
};
