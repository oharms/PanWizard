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
const crypto = require('crypto');

// Runtime config dirs a local PAN install lands in (mirrors installer getDirName).
const PAN_RUNTIME_DIRS = ['.claude', '.codex', '.gemini', '.opencode', '.github'];

// M62: only instrument actual PAN projects. A global-install hook fires in EVERY
// repo the user opens; without this gate it silently creates .planning/ metrics
// artifacts in non-PAN repos. A project counts as PAN if it already has a
// .planning/ tree (a /pan command created it) OR carries a local PAN install
// (a manifest / core payload under a runtime config dir — covers a fresh local
// install before any .planning/ exists). Global installs in a plain repo match
// neither, so the hook no-ops. Best-effort — never throws.
function isPanProject(cwd) {
  try {
    if (!cwd) return false;
    if (fs.existsSync(path.join(cwd, '.planning'))) return true;
    for (const d of PAN_RUNTIME_DIRS) {
      if (fs.existsSync(path.join(cwd, d, 'pan-file-manifest.json'))) return true;
      if (fs.existsSync(path.join(cwd, d, 'pan-wizard-core'))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const METRICS_DIR = 'metrics';
const TOKENS_FILE = 'tokens.jsonl';
const CURSOR_FILE = '.cost-cursor.json';

// Ledger row schema version. Bump when the record shape changes so readers can
// tell which shape a row was written in (pre-versioned rows read as v1). Kept as
// a literal in both hooks + cost.cjs — the hooks are standalone zero-dep scripts
// that can't import from pan-wizard-core, so this MUST stay in sync by hand.
const SCHEMA_V = 2;

// Reverse-map a resolved model id to its cost tier so the "By tier" dashboard
// section isn't blind on the hook path. Anthropic families only (the tiers PAN
// resolves); unknown models stay null rather than guess.
function tierForModel(model) {
  if (typeof model !== 'string' || !model) return null;
  if (/opus|fable|mythos/i.test(model)) return 'reasoning';
  if (/sonnet/i.test(model)) return 'mid';
  if (/haiku/i.test(model)) return 'fast';
  return null;
}

// Best-effort read of the active trace session's command/phase so hook rows can
// be attributed to the command that spawned them. current-session →
// traces/<sid>/session.json (both written by the trace logger / optimize.cjs).
// Never throws — returns {} on any miss.
function readActiveSessionMeta(cwd) {
  try {
    const optDir = path.join(cwd, '.planning', 'optimization');
    const sid = fs.readFileSync(path.join(optDir, 'current-session'), 'utf-8').trim();
    if (!sid) return {};
    const meta = JSON.parse(fs.readFileSync(path.join(optDir, 'traces', sid, 'session.json'), 'utf-8'));
    return meta && typeof meta === 'object' ? meta : {};
  } catch {
    return {};
  }
}

// Duration of a transcript slice from its first→last record timestamp. Returns
// null when either bound is absent/unparseable — never a fabricated 0.
function durationFromSpan(firstTs, lastTs) {
  if (!firstTs || !lastTs) return null;
  const a = Date.parse(firstTs);
  const b = Date.parse(lastTs);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

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

// N17/N25-N27: reserved key in the cursor map recording, per transcript, the
// SIGNATURES of recently-seen SubagentStop events. An empty-slice event is a
// true re-fire / dual-registration ONLY when its full-payload signature was
// already seen for that transcript; a PARALLEL SIBLING (any payload difference)
// or a FIRST FIRE (missing/unreadable transcript, since===0) carries a new
// signature and must be recorded, not dropped. A bounded FIFO SET rather than a
// single slot (N25): a sibling recorded in between can no longer evict the
// signature that identifies an earlier event's re-fire. Bounded by COUNT, not
// by transcript existence, so the L40 dead-transcript prune can no longer erase
// the live marker of a missing-transcript first fire in the very write meant to
// persist it (N27). The name can never collide with a transcript path (an
// absolute file path).
const SEEN_EVENTS = '__seenEvents';
// Pre-N25 single-slot marker — no longer read; dropped on the next write
// (self-migrating, no reader of the old shape exists outside this hook).
const LEGACY_CONSUME_KEYS = '__consumeKeys';
// Bounds (L40): at most MAX_SEEN_TRANSCRIPTS transcripts x MAX_SEEN_SIGS
// signatures (~40 chars each) — a few KB worst-case. FIFO eviction on both
// axes; dual-registration re-fires arrive within the same event dispatch, so a
// recency window of 8 events per transcript is ample.
const MAX_SEEN_SIGS = 8;
const MAX_SEEN_TRANSCRIPTS = 16;

// Signature of a SubagentStop event: a hash of the FULL payload as delivered.
// A dual-registration re-fire is byte-identical on stdin (the host pipes the
// same JSON to every registration of one event), so its signature matches. A
// same-type parallel sibling is distinguished by ANY differing payload field —
// a per-invocation agent id, a cumulative usage snapshot, a per-subagent
// transcript path — without hardcoding which field a given runtime provides
// (N26). Siblings whose payloads are byte-identical in EVERY field remain
// informationally indistinguishable from re-fires and stay suppressed (the
// guard fails toward M61 phantom suppression). Returns null when the payload
// cannot be serialized — callers then fail OPEN (record, never mark).
function eventSignature(data) {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  } catch { return null; }
}
function getSeenSigs(cursor, transcriptPath) {
  const se = cursor && cursor[SEEN_EVENTS];
  const arr = se && typeof se === 'object' ? se[transcriptPath] : null;
  return Array.isArray(arr) ? arr : [];
}
function addSeenSig(cursor, transcriptPath, sig) {
  if (!sig) return; // unhashable payload → never mark (fail open to recording)
  if (!cursor[SEEN_EVENTS] || typeof cursor[SEEN_EVENTS] !== 'object') cursor[SEEN_EVENTS] = {};
  const se = cursor[SEEN_EVENTS];
  const arr = Array.isArray(se[transcriptPath]) ? se[transcriptPath].filter((s) => s !== sig) : [];
  arr.push(sig);
  while (arr.length > MAX_SEEN_SIGS) arr.shift(); // FIFO — evict the oldest signature
  delete se[transcriptPath]; // re-insert so key order tracks recency for the transcript cap
  se[transcriptPath] = arr;
  const keys = Object.keys(se);
  for (let i = 0; i < keys.length - MAX_SEEN_TRANSCRIPTS; i++) delete se[keys[i]];
}

function writeCursor(cwd, cursor) {
  try {
    // Prune cursor keys for transcripts that no longer exist so the map can't
    // grow without bound over a long-lived project (L40, ADR audit 2026-08).
    const pruned = {};
    for (const [tp, v] of Object.entries(cursor)) {
      if (tp === SEEN_EVENTS || tp === LEGACY_CONSUME_KEYS) continue; // reserved markers — not paths
      if (tp && fs.existsSync(tp)) pruned[tp] = v;
    }
    // Preserve the seen-event marker (N17/N25-N27). Deliberately NOT pruned by
    // transcript existence — a missing-transcript first fire's marker must
    // survive this very write, or its re-fire is re-admitted as a phantom row
    // (N27). Bounded by count instead (FIFO on both axes), which keeps the file
    // strictly bounded per L40.
    const se = cursor[SEEN_EVENTS];
    if (se && typeof se === 'object') {
      const bounded = {};
      for (const tp of Object.keys(se).slice(-MAX_SEEN_TRANSCRIPTS)) {
        const arr = se[tp];
        if (Array.isArray(arr) && arr.length) bounded[tp] = arr.slice(-MAX_SEEN_SIGS);
      }
      if (Object.keys(bounded).length) pruned[SEEN_EVENTS] = bounded;
    }
    fs.mkdirSync(path.dirname(cursorFilePath(cwd)), { recursive: true });
    fs.writeFileSync(cursorFilePath(cwd), JSON.stringify(pruned), 'utf-8');
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
  let durationMs = null;
  // token_source records WHICH path produced the counts; clamped marks a value
  // dropped to 0 by the plausibility guard so a guarded zero is distinguishable
  // from a genuine zero-token run.
  let tokenSource = data.transcript_path ? 'transcript' : 'usage-fallback';
  let clamped = false;
  // Set when a transcript-sourced event consumed no new records AND is an
  // identical re-fire / dual-registration. Carried on the returned record as a
  // transient flag so appendRecord can drop the phantom row; never written to
  // the ledger (M61).
  let emptySlice = false;
  const agent = data.agent_type || data.subagent_type || null;
  if (data.transcript_path) {
    const cursor = readCursor(cwd);
    const since = cursor[data.transcript_path] || 0;
    const fromTranscript = readUsageFromTranscript(data.transcript_path, data.session_id, since);
    inputTokens = fromTranscript.input_tokens;
    outputTokens = fromTranscript.output_tokens;
    cacheRead = fromTranscript.cache_read_input_tokens;
    cacheWrite = fromTranscript.cache_creation_input_tokens;
    durationMs = durationFromSpan(fromTranscript.first_ts, fromTranscript.last_ts);
    if (!model) model = fromTranscript.model;
    if (fromTranscript.lineCount > since) {
      // A real slice. Advance the cursor so the next subagent's record starts
      // fresh — the slices partition the transcript, so it is never re-summed on
      // every event. Remember this event's signature (N17/N25) so a later
      // empty-slice event can tell its re-fire from a parallel sibling — even
      // when other siblings are recorded in between (N25).
      cursor[data.transcript_path] = fromTranscript.lineCount;
      addSeenSig(cursor, data.transcript_path, eventSignature(data));
      writeCursor(cwd, cursor);
    } else {
      // No transcript records past the cursor: this event consumed NO slice of
      // its own. Two very different situations land here (N17):
      //   • A re-fire / dual global+local hook registration — the SAME event
      //     delivered again (byte-identical payload). Its all-zero row is a
      //     phantom (the last-row dedup can't catch it — the zeros differ from
      //     the real row the re-fire follows), so flag it and let appendRecord
      //     drop it (M61).
      //   • A PARALLEL SIBLING (another subagent — same or different type — whose
      //     sibling already consumed the shared transcript to EOF and advanced
      //     this shared cursor) or a FIRST FIRE whose transcript_path is
      //     missing/unreadable (lineCount=0, since=0). These are legitimate
      //     spawns that must be RECORDED with zero tokens, not dropped —
      //     dropping them undercounts /pan:cost.
      // The full-payload signature distinguishes them (N25/N26): DROP only when
      // this exact payload was already seen for this transcript (true re-fire);
      // otherwise record the spawn.
      const sig = eventSignature(data);
      if (sig && getSeenSigs(cursor, data.transcript_path).includes(sig)) {
        emptySlice = true; // already-seen event → re-fire; appendRecord drops the phantom row (M61)
      } else {
        // Sibling / first-fire: record the spawn (zero tokens) and remember its
        // signature so a subsequent re-fire of THIS event is dropped.
        addSeenSig(cursor, data.transcript_path, sig);
        writeCursor(cwd, cursor);
      }
    }
  } else {
    // No transcript to slice — best-effort from data.usage, plausibility-guarded
    // so a cumulative counter can never slip through as a per-call value. Flag
    // when the guard actually fired so a dropped value isn't read as a real zero.
    const rawIn = extractNumber(data.usage, 'input_tokens');
    const rawOut = extractNumber(data.usage, 'output_tokens');
    const rawCr = extractNumber(data.usage, 'cache_read_input_tokens');
    const rawCw = extractNumber(data.usage, 'cache_creation_input_tokens');
    inputTokens = clampPlausible(rawIn);
    outputTokens = clampPlausible(rawOut);
    cacheRead = clampPlausible(rawCr);
    cacheWrite = clampPlausible(rawCw);
    clamped = [rawIn, rawOut, rawCr, rawCw].some((n) => n > PLAUSIBLE_MAX);
  }

  // Backfill command/phase from the active trace session when the payload omits
  // them (real SubagentStop payloads carry neither); tier is derived from the model.
  const sessionMeta = readActiveSessionMeta(cwd);
  const command = data.command || sessionMeta.command || null;
  const phase = data.phase || sessionMeta.phase || null;

  const record = {
    v: SCHEMA_V,
    ts: new Date().toISOString(),
    agent,
    command,
    model,
    tier: tierForModel(model),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cost_usd: null,
    duration_ms: durationMs,
    phase,
    session: data.session_id || null,
    source: 'hook',
    token_source: tokenSource,
    clamped,
  };

  // Non-enumerable transient flag: it must NOT be serialized into the ledger,
  // but appendRecord needs to read it to drop a phantom re-fire row (M61).
  if (emptySlice) {
    Object.defineProperty(record, '__emptySlice', { value: true, enumerable: false });
  }

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
    first_ts: null,
    last_ts: null,
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
    // Span of THIS subagent's slice (after the session filter) — first→last
    // record timestamp gives a measured runtime rather than an idle-gap proxy.
    const entryTs = typeof entry.timestamp === 'string' ? entry.timestamp : null;
    if (entryTs) {
      if (!totals.first_ts) totals.first_ts = entryTs;
      totals.last_ts = entryTs;
    }
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
  // M61 re-fire guard: a transcript-sourced event that consumed no new records
  // (buildCostRecord flags it via __emptySlice) is a re-fired / dual-registered
  // SubagentStop with nothing of its own to attribute. Dropping it here is the
  // real guard the last-row dedup could not be — the phantom all-zero row
  // differs from the real row it follows, so the dedup never fired (M61).
  if (record.__emptySlice) return false;
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
      // M62: a global-install hook fires in every repo; don't pollute non-PAN
      // projects with .planning/ metrics artifacts.
      if (!isPanProject(cwd)) return;
      const record = buildCostRecord(data, cwd);
      appendRecord(cwd, record);
    } catch {
      // Silent fail — don't block agent loop on hook errors.
    }
  });
}

module.exports = { buildCostRecord, appendRecord, readUsageFromTranscript, readCursor, writeCursor, isPanProject, METRICS_DIR, TOKENS_FILE, CURSOR_FILE };
