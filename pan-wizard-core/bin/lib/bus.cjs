/**
 * Bus — file-backed message channels for agent-to-agent communication
 *
 * Part of Spec B v2 Y-7 infrastructure (v3.0). Enables future hierarchical
 * agent spawning (exec-phase --hierarchical, Wave 5) and inter-agent
 * coordination (review-deep, Wave 3) without committing to an in-process
 * IPC mechanism.
 *
 * Storage model:
 *   .planning/bus/<channel>.jsonl — append-only JSON Lines
 *   Each line: {ts, source, payload}
 *
 * Channels are created on first publish. Readers use cursor-based drain
 * (read N lines from an offset) or partial-consume drain (read the drained
 * window, splice just those lines out, and write the remainder back).
 *
 * Concurrent-write safety: each publish opens the file with append flag
 * (`a`) which the OS treats atomically for writes <PIPE_BUF on POSIX and
 * sub-buffer writes on Windows. Entries are single lines. For parallel
 * publishers writing large payloads, see the safety note below.
 *
 * Agent-name / channel-name validation: restricted to
 * `^[a-zA-Z0-9_-]+$` to block path traversal.
 */

const fs = require('fs');
const path = require('path');
const { withFileLock, writeFileAtomic } = require('./lock.cjs');
const { output, error } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');

const BUS_DIR = 'bus';
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_DRAIN_LIMIT = 1000;

function busDir(cwd) {
  return path.join(planningPath(cwd), BUS_DIR);
}

function channelFile(cwd, channel) {
  return path.join(busDir(cwd), `${channel}.jsonl`);
}

function validateName(name, label) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return `Invalid ${label}: ${name}. Must match ${NAME_RE}`;
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Publish a message to a channel. Creates channel file + dir if missing.
 *
 * @param {string} cwd - Project root
 * @param {string} channel - Channel name (validated)
 * @param {*} payload - JSON-serializable payload
 * @param {Object} [opts] - {source: string} — who sent it (agent name, command name)
 * @returns {{published: true, ts: string, file: string, size: number}|{error: string}}
 */
function publish(cwd, channel, payload, opts) {
  const chErr = validateName(channel, 'channel');
  if (chErr) return { error: chErr };
  const source = opts?.source;
  // Treat null + undefined + empty string as "no source provided".
  if (source !== undefined && source !== null && source !== '') {
    const sErr = validateName(source, 'source');
    if (sErr) return { error: sErr };
  }

  const normalizedSource = (source !== undefined && source !== null && source !== '') ? source : null;
  let line;
  try {
    line = JSON.stringify({ ts: nowIso(), source: normalizedSource, payload }) + '\n';
  } catch (e) {
    return { error: `payload not JSON-serializable: ${e.message}` };
  }

  try {
    fs.mkdirSync(busDir(cwd), { recursive: true });
  } catch (e) {
    return { error: `Failed to create bus dir: ${e.message}` };
  }

  const file = channelFile(cwd, channel);
  try {
    // Under the channel's lock, so an append never lands between a consume's
    // read and its rewrite (which would drop it).
    const r = withFileLock(file, () => fs.appendFileSync(file, line, { encoding: 'utf-8' }), { strict: true });
    if (r.timedOut) return { error: `Failed to append to channel ${channel}: lock_timeout` };
  } catch (e) {
    return { error: `Failed to append to channel ${channel}: ${e.message}` };
  }

  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* race — ignore */ }

  return { published: true, ts: JSON.parse(line).ts, file, size };
}

/**
 * Parse a channel file into an array of entries.
 * @param {string} cwd - Project root
 * @param {string} channel - Channel name
 * @param {Object} [opts] - {offset: number, limit: number}
 * @returns {{entries: Array, total: number, offset: number, more: boolean}|{error: string}}
 */
function readChannel(cwd, channel, opts) {
  const chErr = validateName(channel, 'channel');
  if (chErr) return { error: chErr };
  const offset = Math.max(0, Number(opts?.offset) || 0);
  const rawLimit = Number(opts?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_DRAIN_LIMIT;

  let raw;
  try {
    raw = fs.readFileSync(channelFile(cwd, channel), 'utf-8');
  } catch {
    return { entries: [], total: 0, offset: 0, more: false };
  }

  const lines = raw.split('\n').filter(Boolean);
  const total = lines.length;
  const slice = lines.slice(offset, offset + limit);
  const entries = [];
  for (let i = 0; i < slice.length; i++) {
    try {
      entries.push(JSON.parse(slice[i]));
    } catch {
      // Skip malformed lines but don't fail the whole read.
      entries.push({ ts: null, source: null, payload: null, malformed: true, raw: slice[i] });
    }
  }

  return { entries, total, offset, more: offset + entries.length < total };
}

/**
 * Drain (read + optionally mutate) messages from a channel.
 *
 * Three drain modes:
 *  - `peek` (default): read entries, leave file untouched
 *  - `consume`: read entries, then splice out ONLY the drained window
 *    (offset .. offset+consumed) and write the remainder back — messages
 *    outside that window (before the offset, or beyond the read limit / the
 *    1000-message default on large channels) survive. The file is emptied only
 *    when the drained window covers every line.
 *  - `archive`: read entries, rename file to `<channel>-<ts>.archive.jsonl` so
 *    historical data is preserved while the channel restarts empty
 *
 * @param {string} cwd - Project root
 * @param {string} channel - Channel name
 * @param {Object} [opts] - {mode: 'peek'|'consume'|'archive', limit, offset}
 * @returns {Object} Drain result
 */
/**
 * Consume ONLY the drained window (offset .. offset+limit). Truncating the whole
 * file to empty silently destroyed every message outside that window (H2, ADR
 * audit 2026-08). The entries handed back and the lines spliced out come from one
 * read taken inside the channel's lock, which publish shares, so two consumers
 * never receive the same message and a message nobody received is never deleted.
 */
function drainConsume(cwd, channel, opts) {
  const probe = readChannel(cwd, channel, { ...opts, limit: 1 }); // validates the channel name
  if (probe.error) return probe;
  const file = channelFile(cwd, channel);
  let read = null;
  try {
    const r = withFileLock(file, () => {
      read = readChannel(cwd, channel, opts);
      if (read.error || read.total === 0) return;
      let allLines = [];
      try { allLines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean); } catch { allLines = []; }
      const offset = Math.max(0, Number(opts?.offset) || 0);
      const consumed = read.entries.length; // raw lines actually returned by readChannel
      const remaining = allLines.slice(0, offset).concat(allLines.slice(offset + consumed));
      writeFileAtomic(file, remaining.length ? remaining.join('\n') + '\n' : '');
    }, { strict: true });
    if (r.timedOut) return { channel, entries: [], total: 0, mode: 'consume', drain_error: 'lock_timeout' };
  } catch (e) {
    return { ...(read || { channel, entries: [], total: 0 }), mode: 'consume', drain_error: e.message };
  }
  if (read.error) return read;
  return { ...read, mode: 'consume' };
}

function drain(cwd, channel, opts) {
  const mode = opts?.mode || 'peek';
  if (mode === 'consume') return drainConsume(cwd, channel, opts);
  const read = readChannel(cwd, channel, opts);
  if (read.error) return read;

  if (mode === 'peek' || read.total === 0) return { ...read, mode };

  const file = channelFile(cwd, channel);
  if (mode === 'archive') {
    const stamp = nowIso().replace(/[:.]/g, '-');
    const archivePath = path.join(busDir(cwd), `${channel}-${stamp}.archive.jsonl`);
    try {
      fs.renameSync(file, archivePath);
    } catch (e) {
      return { ...read, mode, drain_error: e.message };
    }
  } else {
    return { error: `unknown drain mode: ${mode}` };
  }

  return { ...read, mode };
}

/**
 * List channels + message counts + sizes for observability.
 * @param {string} cwd - Project root
 * @returns {{channels: Array<{channel: string, messages: number, bytes: number, archive: boolean}>}}
 */
function listChannels(cwd) {
  let files;
  try {
    files = fs.readdirSync(busDir(cwd));
  } catch {
    return { channels: [] };
  }

  const channels = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const archive = f.includes('.archive.');
    const nameBase = f.replace(/\.jsonl$/, '');
    const channel = archive ? nameBase.replace(/\.archive$/, '') : nameBase;
    const filePath = path.join(busDir(cwd), f);
    let bytes = 0;
    let messages = 0;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      bytes = Buffer.byteLength(content, 'utf-8');
      messages = content.split('\n').filter(Boolean).length;
    } catch { /* unreadable — skip */ }
    channels.push({ channel, messages, bytes, archive });
  }
  channels.sort((a, b) => a.channel.localeCompare(b.channel) || (a.archive ? 1 : -1));
  return { channels };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdBusPublish(cwd, channel, rawPayload, opts, raw) {
  if (!channel || rawPayload === undefined) {
    error('Usage: bus publish <channel> <json-payload> [--source <name>]');
  }
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    // Fall back: treat as plain string if not valid JSON.
    payload = rawPayload;
  }
  const result = publish(cwd, channel, payload, opts);
  output(result, raw);
}

function cmdBusDrain(cwd, channel, opts, raw) {
  if (!channel) error('Usage: bus drain <channel> [--mode peek|consume|archive] [--limit N] [--offset N]');
  const result = drain(cwd, channel, opts);
  output(result, raw);
}

function cmdBusList(cwd, raw) {
  output(listChannels(cwd), raw);
}

module.exports = {
  publish,
  readChannel,
  drain,
  listChannels,
  validateName,
  cmdBusPublish,
  cmdBusDrain,
  cmdBusList,
  BUS_DIR,
  DEFAULT_DRAIN_LIMIT,
};
