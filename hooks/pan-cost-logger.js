#!/usr/bin/env node
// PAN cost logger — SubagentStop hook (v3.4+).
//
// Claude Code fires SubagentStop when a Task-spawned sub-agent finishes.
// The hook receives JSON on stdin describing the session, transcript path,
// and (when available) usage metadata.
//
// We append a minimal record to .planning/metrics/tokens.jsonl so
// `/pan:cost` reports reflect real agent spawns, not just manually-appended
// entries. Token counts are best-effort: if the hook input doesn't carry
// them, we log a record with zeros + a `source: "hook"` flag so the
// aggregator distinguishes these from fully-instrumented records.
//
// This hook NEVER blocks the main agent loop — all errors are swallowed.

const fs = require('fs');
const path = require('path');

const METRICS_DIR = 'metrics';
const TOKENS_FILE = 'tokens.jsonl';
const CURSOR_FILE = '.cost-cursor.json';

// Per-transcript high-water mark: the count of JSONL records already attributed
// to earlier SubagentStop events, keyed by transcript path. Each event then sums
// ONLY its own slice (records past the cursor) instead of re-summing the whole
// shared-session transcript every time — the latter multiplies cumulative-per-turn
// cache-read into the billions/trillions and stamps it onto every subagent record
// (field report 2026-06). Stored next to tokens.jsonl; best-effort, never blocks.
function cursorFilePath(cwd) {
  return path.join(cwd, '.planning', METRICS_DIR, CURSOR_FILE);
}
function readCursor(cwd) {
  try {
    const c = JSON.parse(fs.readFileSync(cursorFilePath(cwd), 'utf-8'));
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; }
}
function writeCursor(cwd, cursor) {
  try {
    fs.mkdirSync(path.dirname(cursorFilePath(cwd)), { recursive: true });
    fs.writeFileSync(cursorFilePath(cwd), JSON.stringify(cursor), 'utf-8');
  } catch { /* best-effort — never block the agent loop */ }
}

/**
 * Extract what we can from the SubagentStop event payload.
 * Pure function — safe to test without stdin.
 *
 * @param {Object} data - Parsed SubagentStop event JSON
 * @param {string} cwd - Project cwd (for path resolution)
 * @returns {Object|null} Cost record, or null if the event should be ignored
 */
function buildCostRecord(data, cwd) {
  if (!data || typeof data !== 'object') return null;

  // Only log actual subagent stops; ignore other Stop variants.
  if (data.hook_event_name && data.hook_event_name !== 'SubagentStop') return null;

  // Per-call token counts come from the transcript SLICE — the records since
  // this transcript's previous SubagentStop cursor. The SubagentStop `data.usage`,
  // when Claude Code supplies it, is a CUMULATIVE session counter, NOT this
  // subagent's delta, so logging it verbatim stamped impossible per-row magnitudes
  // (tens of millions of output tokens, billions of cache-read) onto every record
  // and made /pan:cost and the optimizer unusable (field reports 2026-06 / 2026-07).
  // The transcript slice is the authoritative per-invocation delta; `data.usage`
  // is a guarded fallback used only when no transcript is available.
  let model = typeof data.model === 'string' && data.model ? data.model : null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  if (data.transcript_path) {
    const cursor = readCursor(cwd);
    const since = cursor[data.transcript_path] || 0;
    const fromTranscript = readUsageFromTranscript(data.transcript_path, data.session_id, since);
    inputTokens = fromTranscript.input_tokens;
    outputTokens = fromTranscript.output_tokens;
    cacheRead = fromTranscript.cache_read_input_tokens;
    cacheWrite = fromTranscript.cache_creation_input_tokens;
    if (!model) model = fromTranscript.model;
    // Advance the cursor so the next subagent's record starts fresh — the slices
    // partition the transcript, so it is never re-summed on every event.
    if (fromTranscript.lineCount > since) {
      cursor[data.transcript_path] = fromTranscript.lineCount;
      writeCursor(cwd, cursor);
    }
  } else {
    // No transcript to slice — best-effort from data.usage, plausibility-guarded
    // so a cumulative counter can never slip through as a per-call value.
    inputTokens = clampPlausible(extractNumber(data.usage, 'input_tokens'));
    outputTokens = clampPlausible(extractNumber(data.usage, 'output_tokens'));
    cacheRead = clampPlausible(extractNumber(data.usage, 'cache_read_input_tokens'));
    cacheWrite = clampPlausible(extractNumber(data.usage, 'cache_creation_input_tokens'));
  }

  const record = {
    ts: new Date().toISOString(),
    agent: data.agent_type || data.subagent_type || null,
    command: null,
    model,
    tier: null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cost_usd: null,
    phase: data.phase || null,
    session: data.session_id || null,
    source: 'hook',
  };

  return record;
}

function extractNumber(obj, key) {
  if (!obj || typeof obj !== 'object') return 0;
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}

// A single subagent call's token counts never realistically exceed this; a value
// above it is a cumulative session counter that leaked in, so we drop it to 0
// rather than poison the ledger. Generous vs. any real call, tiny vs. the
// billions/tens-of-millions the cumulative bug produced.
const PLAUSIBLE_MAX = 20000000;
function clampPlausible(n) {
  return typeof n === 'number' && n >= 0 && n <= PLAUSIBLE_MAX ? n : 0;
}

/**
 * P-1805 (v3.7.8): read transcript JSONL and sum usage across assistant messages.
 *
 * `sinceLine` (P-360, field report 2026-06): skip the first N non-empty records —
 * the count already attributed to earlier SubagentStop events for this transcript.
 * Summing only the slice past the cursor is what stops a shared-session transcript
 * from being re-summed on every event (which multiplied cumulative-per-turn
 * cache-read into the billions). Returns `lineCount` = total non-empty records seen
 * so the caller can advance the cursor. Returns zeros if missing/unreadable.
 *
 * @param {string} transcriptPath
 * @param {string} sessionId
 * @param {number} [sinceLine=0] - records already attributed (the cursor)
 */
function readUsageFromTranscript(transcriptPath, sessionId, sinceLine = 0) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: null,
    lineCount: 0,
  };
  if (!transcriptPath || typeof transcriptPath !== 'string') return totals;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf-8'); } catch { return totals; }
  let seen = 0; // count of non-empty JSONL records (the cursor unit)
  for (const line of raw.split('\n')) {
    if (!line) continue;
    seen++;
    if (seen <= sinceLine) continue; // already attributed to an earlier event
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (sessionId && entry.session_id && entry.session_id !== sessionId) continue;
    // Assistant messages carry the model id alongside their usage — keep the
    // last one seen (mid-session model switches resolve to the final model).
    const entryModel = entry.message?.model || entry.model || null;
    if (typeof entryModel === 'string' && entryModel) totals.model = entryModel;
    const usage = entry.usage
      || entry.message?.usage
      || entry.response?.usage
      || (entry.type === 'assistant' && entry.message?.usage)
      || null;
    if (!usage || typeof usage !== 'object') continue;
    totals.input_tokens += extractNumber(usage, 'input_tokens');
    totals.output_tokens += extractNumber(usage, 'output_tokens');
    totals.cache_read_input_tokens += extractNumber(usage, 'cache_read_input_tokens');
    totals.cache_creation_input_tokens += extractNumber(usage, 'cache_creation_input_tokens');
  }
  totals.lineCount = seen;
  return totals;
}

/**
 * Append record to .planning/metrics/tokens.jsonl. Silently succeeds
 * even if the file or directory can't be written — hook must not block.
 *
 * @param {string} cwd - Working directory (project root)
 * @param {Object} record - Cost record from buildCostRecord
 * @returns {boolean} true if written, false otherwise
 */
function appendRecord(cwd, record) {
  if (!record) return false;
  try {
    const dir = path.join(cwd, '.planning', METRICS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, TOKENS_FILE);
    // Idempotency guard: a re-fired SubagentStop must not double-log. Skip the
    // append when this record is identical (every field but the timestamp) to
    // the immediately-preceding row — the source of ~57% duplicate rows in the
    // field (2026-07). Best-effort: any read error just proceeds with the append.
    if (isDuplicateOfLastRecord(file, record)) return false;
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** True when `record` equals the last JSONL row of `file`, ignoring `ts`. */
function isDuplicateOfLastRecord(file, record) {
  let prev;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return false;
    prev = JSON.parse(lines[lines.length - 1]);
  } catch {
    return false; // no file / unreadable / bad JSON → not a duplicate
  }
  const strip = (r) => { const { ts, ...rest } = r; return JSON.stringify(rest); };
  return strip(prev) === strip(record);
}

// ─── Stdin driver ───────────────────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      // Prefer cwd from the event (Claude Code sends it in most hook payloads);
      // fall back to process.cwd() which is the project root when Claude Code
      // invokes the hook.
      const cwd = data.cwd || data.workspace?.current_dir || process.cwd();
      const record = buildCostRecord(data, cwd);
      appendRecord(cwd, record);
    } catch {
      // Silent fail — don't block agent loop on hook errors.
    }
  });
}

module.exports = { buildCostRecord, appendRecord, readUsageFromTranscript, readCursor, writeCursor, METRICS_DIR, TOKENS_FILE, CURSOR_FILE };
