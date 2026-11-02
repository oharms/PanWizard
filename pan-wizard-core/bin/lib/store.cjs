/**
 * Store — one write path for PAN's orchestration files (durable orchestration
 * Stage A; ADR-0030's escalation path).
 *
 * Every read-modify-write of an orchestration file reads INSIDE the lock, so a
 * writer never writes back data it read before another writer changed it:
 *
 *   updateRecord(file, mutate)  JSON records (auto-run.json, batch files, run
 *                               records, approvals): strict lock, `_rev`
 *                               incremented on every write, optional
 *                               compare-and-swap on it (expectRev)
 *   updateText(file, mutate)    markdown: best-effort lock unless
 *                               concurrency.strict, compare-and-swap on a hash
 *                               of the raw bytes (expectHash) — nothing is
 *                               added to the file
 *   appendLine(file, obj)       JSONL journals: seq = last seq + 1, under the lock
 *   reserveDir(parent, name)    numbered directories: claim n by exclusive mkdir
 *   lockCommand(cwd, verb, sub) the planning markdown a whole dispatcher command
 *                               reads and writes, held for the command's run
 *
 * A refusal is returned, never thrown: {error, ...} with nothing written.
 * Zero dependencies; synchronous, like the rest of lib/.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withFileLock, holdLock, writeFileAtomic, lockPathFor } = require('./lock.cjs');
const { planningPath } = require('./utils.cjs');
const transitions = require('./transitions.cjs');

const ABORT = Symbol('store.abort');

/** Returned from a mutate function: refuse, write nothing, hand back payload. */
function abort(payload) {
  return { [ABORT]: payload };
}

const hashOf = (raw) => crypto.createHash('sha1').update(raw).digest('hex');

/** .planning/config.json as written ({} when missing or unreadable): the sections loadConfig does not carry. */
function rawConfig(cwd) {
  if (!cwd) return {};
  try {
    const cfg = JSON.parse(fs.readFileSync(planningPath(cwd, 'config.json'), 'utf-8'));
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch { return {}; }
}

/** True when .planning/config.json sets concurrency.strict. */
function strictConfigured(cwd) {
  const c = rawConfig(cwd).concurrency;
  return Boolean(c && c.strict === true);
}

const lockTimeout = (file) => ({
  error: 'lock_timeout',
  file,
  lock: lockPathFor(file),
  reason: 'another PAN process holds the lock; retry when it finishes, or delete the lock file if no PAN process is running',
});

/**
 * Read a JSON record.
 * @returns {{data: object, rev: number, hash: string} | {missing: true} | {error: 'unreadable', file, reason}}
 */
function readRecord(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return { missing: true }; }
  try {
    const data = JSON.parse(raw);
    const rev = data && Number.isInteger(data._rev) ? data._rev : 0;
    return { data, rev, hash: hashOf(raw) };
  } catch (err) {
    return { error: 'unreadable', file, reason: err.message };
  }
}

/**
 * Read, change and write a JSON record under its lock.
 * @param {string} file
 * @param {(current: object|null) => object|null|undefined} mutate - gets the
 *   record as it is on disk now (null when missing); returns the new record,
 *   null/undefined to leave the file alone, or abort(payload) to refuse.
 * @param {object} [opts] - {expectRev, strict (default true), space (default 2),
 *   keepMtime (restore the file's mtime after the write, for files ordered by it),
 *   transition (a transitions.cjs entity: a status change its table does not allow
 *   is refused illegal_transition, inside the lock), force (skip that check)}
 * @returns {{ok: true, data, rev, written: boolean} | {error, ...}}
 */
function updateRecord(file, mutate, opts = {}) {
  const strict = opts.strict !== false;
  // The lock file lives beside the record, so its directory must exist first.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let outcome;
  const run = withFileLock(file, () => {
    const cur = readRecord(file);
    if (cur.error) { outcome = cur; return; }
    const rev = cur.missing ? 0 : cur.rev;
    if (opts.expectRev !== undefined && opts.expectRev !== null && Number(opts.expectRev) !== rev) {
      outcome = { error: 'stale_write', file, expected: Number(opts.expectRev), actual: rev };
      return;
    }
    const current = cur.missing ? null : cur.data;
    const next = mutate(current ? structuredClone(current) : null);
    if (next && next[ABORT]) { outcome = next[ABORT]; return; }
    if (next === null || next === undefined) { outcome = { ok: true, data: current, rev, written: false }; return; }
    if (opts.transition && !opts.force) {
      const refused = transitions.checkRecord(opts.transition, current, next);
      if (refused) { outcome = { ...refused, file }; return; }
    }
    const out = { ...next, _rev: rev + 1 };
    let st = null;
    if (opts.keepMtime) { try { st = fs.statSync(file); } catch { /* new file */ } }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, JSON.stringify(out, null, opts.space ?? 2) + '\n');
    if (st) fs.utimesSync(file, st.atime, st.mtime);
    outcome = { ok: true, data: out, rev: rev + 1, written: true };
  }, { strict });
  if (run.timedOut) return lockTimeout(file);
  return outcome;
}

/**
 * Read, change and write a text file (markdown) under its lock.
 * @param {string} file
 * @param {(raw: string|null) => string|null|undefined} mutate - gets the file's
 *   raw text (null when missing); returns the new text, null/undefined to leave
 *   it alone, or abort(payload).
 * @param {object} [opts] - {expectHash, strict (default: concurrency.strict), cwd}
 * @returns {{ok: true, hash, written: boolean} | {error, ...}}
 */
function updateText(file, mutate, opts = {}) {
  const strict = opts.strict ?? strictConfigured(opts.cwd);
  // The lock file lives beside the record, so its directory must exist first.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let outcome;
  const run = withFileLock(file, () => {
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf-8'); } catch { /* missing */ }
    const hash = raw === null ? null : hashOf(raw);
    if (opts.expectHash && opts.expectHash !== hash) {
      outcome = { error: 'stale_write', file, expected: opts.expectHash, actual: hash };
      return;
    }
    const next = mutate(raw);
    if (next && typeof next === 'object' && next[ABORT]) { outcome = next[ABORT]; return; }
    if (next === null || next === undefined || next === raw) { outcome = { ok: true, hash, written: false }; return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, next);
    outcome = { ok: true, hash: hashOf(next), written: true };
  }, { strict });
  if (run.timedOut) return lockTimeout(file);
  return outcome;
}

/** The last parseable line's seq (0 when the file is missing or has none). */
function lastSeq(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return 0; }
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (Number.isInteger(row.seq)) return row.seq;
    } catch { /* a torn last line — keep looking */ }
  }
  return 0;
}

/**
 * Append one JSON line with seq = last seq + 1, under the file's lock.
 * @param {string} file
 * @param {object|((seq: number) => object)} row - the row, or a function of its seq
 * @param {object} [opts] - {strict (default true), seqField (default 'seq'; false = no seq)}
 * @returns {{ok: true, seq: number|null, row} | {error, ...}}
 */
function appendLine(file, row, opts = {}) {
  const strict = opts.strict !== false;
  const seqField = opts.seqField === undefined ? 'seq' : opts.seqField;
  // The lock file lives beside the record, so its directory must exist first.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let outcome;
  const run = withFileLock(file, () => {
    const seq = seqField ? lastSeq(file) + 1 : null;
    const body = typeof row === 'function' ? row(seq) : row;
    const line = seqField ? { [seqField]: seq, ...body } : body;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + '\n', 'utf-8');
    outcome = { ok: true, seq, row: line };
  }, { strict });
  if (run.timedOut) return lockTimeout(file);
  return outcome;
}

/**
 * Claim the next numbered directory under parent. The next number is worked
 * out and the directory made under parent's lock, so two callers never get the
 * same number even when their directory names differ; a non-recursive mkdir
 * still refuses a directory something else made.
 * @param {string} parent
 * @param {(n: number) => string} nameOf - directory name for number n
 * @param {number|(() => number)} start - first number to try, or a function
 *   computing it (called inside the lock)
 * @param {number} [tries=50]
 * @returns {{ok: true, n: number, dir: string} | {error: 'reserve_failed'|'lock_timeout', ...}}
 */
function reserveDir(parent, nameOf, start, tries = 50) {
  fs.mkdirSync(parent, { recursive: true });
  const lockFile = path.join(parent, '.reserve'); // names the lock only; never created
  let outcome;
  const run = withFileLock(lockFile, () => {
    const first = typeof start === 'function' ? start() : start;
    for (let n = first; n < first + tries; n++) {
      const dir = path.join(parent, nameOf(n));
      try {
        fs.mkdirSync(dir);
        outcome = { ok: true, n, dir };
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') { outcome = { error: 'reserve_failed', parent, reason: err.message }; return; }
      }
    }
    outcome = { error: 'reserve_failed', parent, reason: `no free number in ${first}..${first + tries - 1}` };
  }, { strict: true });
  if (run.timedOut) return lockTimeout(lockFile);
  return outcome;
}

// The planning markdown each dispatcher command reads and then writes. The
// whole command holds these locks (released by lock.cjs's exit handler, since
// output() ends the process), so its read and its write fall inside one hold.
// Order is fixed — config, roadmap, requirements, state — so two commands
// never wait on each other in opposite orders.
const ROADMAP = 'roadmap.md';
const REQUIREMENTS = 'requirements.md';
const STATE = 'state.md';
const CONFIG = 'config.json';
const COMMAND_LOCKS = {
  'state': [STATE],
  'phase add': [ROADMAP, STATE],
  'phase insert': [ROADMAP, STATE],
  'phase remove': [ROADMAP, REQUIREMENTS, STATE],
  'phase complete': [ROADMAP, REQUIREMENTS, STATE],
  'roadmap update-plan-progress': [ROADMAP],
  'roadmap slice': [ROADMAP],
  'roadmap compact': [ROADMAP, STATE],
  'requirements mark-complete': [REQUIREMENTS],
  'milestone complete': [ROADMAP, REQUIREMENTS, STATE],
  'validate health': [CONFIG, ROADMAP, REQUIREMENTS, STATE],
  'config-set': [CONFIG],
  'config-ensure-section': [CONFIG],
  'memory': [STATE],
  'design handoff': [ROADMAP],
};
const ORDER = [CONFIG, ROADMAP, REQUIREMENTS, STATE];

/** The planning files a command locks ([] for most commands). */
function commandLockFiles(verb, sub) {
  const files = COMMAND_LOCKS[`${verb} ${sub}`] || COMMAND_LOCKS[verb] || [];
  return ORDER.filter((f) => files.includes(f));
}

/**
 * Take the locks a command needs for its whole run. Best-effort, as state.md's
 * own lock always was, unless concurrency.strict: then a lock that cannot be
 * taken refuses the command with lock_timeout before it reads anything.
 * @returns {null | {error: 'lock_timeout', ...}}
 */
function lockCommand(cwd, verb, sub) {
  const files = commandLockFiles(verb, sub);
  if (files.length === 0) return null;
  const strict = strictConfigured(cwd);
  for (const name of files) {
    const file = planningPath(cwd, name);
    if (!fs.existsSync(path.dirname(file))) continue;
    const got = holdLock(file, { strict });
    if (!got.acquired && strict) return lockTimeout(file);
  }
  return null;
}

module.exports = {
  abort,
  readRecord,
  updateRecord,
  updateText,
  appendLine,
  lastSeq,
  reserveDir,
  commandLockFiles,
  lockCommand,
  strictConfigured,
  rawConfig,
  hashOf,
};
