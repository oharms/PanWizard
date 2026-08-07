#!/usr/bin/env node
// pan-trace-logger — SubagentStop hook (v3.5+).
//
// Fires alongside pan-cost-logger on every SubagentStop event. In a PAN project
// (see isPanProject — M62) it ensures a day-scoped trace session exists and
// appends a completion event to it. This is the automatic instrumentation layer
// of the circular optimization loop — no extra user action required. Outside a
// PAN project the hook no-ops, so a global install does not create .planning/
// trace artifacts in every repo the user opens.
//
// Events logged per subagent:
//   - completion: agent finished, tokens used, exit status
//   - redundancy: detected when the same agent type ran twice in this session
//     with similar token counts (rough heuristic for repeated work)
//
// Errors are swallowed — this hook must never block the main agent loop.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Runtime config dirs a local PAN install lands in (mirrors installer getDirName).
const PAN_RUNTIME_DIRS = ['.claude', '.codex', '.gemini', '.opencode', '.github'];

// M62: only instrument actual PAN projects. A global-install hook fires in EVERY
// repo the user opens; without this gate it silently creates .planning/
// optimization + trace artifacts in non-PAN repos. A project counts as PAN if it
// already has a .planning/ tree (a /pan command created it) OR carries a local
// PAN install (a manifest / core payload under a runtime config dir — covers a
// fresh local install before any .planning/ exists). Global installs in a plain
// repo match neither, so the hook no-ops. Best-effort — never throws.
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

const PLANNING_DIR = '.planning';
const OPTIMIZE_DIR = 'optimization';
const TRACES_DIR = 'traces';
const CURRENT_SESSION_FILE = 'current-session';
const TRACE_EVENT_FILE = 'trace.jsonl';

// Trace event schema version — kept in sync by hand with pan-cost-logger.js
// (standalone zero-dep hooks can't share a module). v3 added the per-invocation
// `event_sig` discriminator to the completion event's context. See that file.
const SCHEMA_V = 3;

// YYYYMMDD stamp for a Date (the day-scope of an auto-session id).
function dayStamp(d) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 8);
}

// Duration of a transcript slice from its first→last record timestamp; null when
// either bound is missing/unparseable (never a fabricated 0).
function durationFromSpan(firstTs, lastTs) {
  if (!firstTs || !lastTs) return null;
  const a = Date.parse(firstTs);
  const b = Date.parse(lastTs);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

// Read a session's persisted command/phase (written by optimize.cjs
// initTraceSession) so hook events can inherit them. Best-effort → {} on miss.
function readSessionMetaById(cwd, sid) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(getTracesDir(cwd), sid, 'session.json'), 'utf-8'));
    return meta && typeof meta === 'object' ? meta : {};
  } catch {
    return {};
  }
}

// Finalize a session in place: recompute event_count / type_counts / agents from
// its trace.jsonl and stamp ended_at. Inlined (the hook can't import optimize.cjs)
// and mirrors optimize.cjs endTraceSession's count loop so day-rollover leaves a
// properly-closed session behind. Best-effort; never throws.
function finalizeSession(cwd, sid) {
  try {
    const sessionDir = path.join(getTracesDir(cwd), sid);
    const metaPath = path.join(sessionDir, 'session.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { return; }
    let eventCount = 0;
    const agentNames = new Set();
    const typeCounts = {};
    try {
      const raw = fs.readFileSync(path.join(sessionDir, TRACE_EVENT_FILE), 'utf-8');
      raw.trim().split('\n').filter(Boolean).forEach((line) => {
        try {
          const e = JSON.parse(line);
          eventCount++;
          if (e.agent) agentNames.add(e.agent);
          typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
        } catch { /* skip malformed */ }
      });
    } catch { /* no trace.jsonl */ }
    meta.ended_at = new Date().toISOString();
    meta.event_count = eventCount;
    meta.agent_count = agentNames.size;
    meta.agents = Array.from(agentNames);
    meta.type_counts = typeCounts;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  } catch { /* best-effort */ }
}

function getOptimizeDir(cwd) {
  return path.join(cwd, PLANNING_DIR, OPTIMIZE_DIR);
}

function getTracesDir(cwd) {
  return path.join(getOptimizeDir(cwd), TRACES_DIR);
}

function getCurrentSessionId(cwd) {
  try {
    return fs.readFileSync(path.join(getOptimizeDir(cwd), CURRENT_SESSION_FILE), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

const TRACE_CURSOR_FILE = '.trace-cursor.json';

// Per-transcript high-water mark (see pan-cost-logger.js for the full rationale):
// sum only the transcript slice since this hook's previous SubagentStop, so a
// shared-session transcript isn't re-summed on every event (which inflates
// cumulative-per-turn cache-read into the billions — field report 2026-06).
// Trace-logger keeps its OWN cursor: cost-logger fires on the same event and the
// two must not consume each other's slice.
function traceCursorPath(cwd) { return path.join(getOptimizeDir(cwd), TRACE_CURSOR_FILE); }
function readTraceCursor(cwd) {
  try { const c = JSON.parse(fs.readFileSync(traceCursorPath(cwd), 'utf-8')); return c && typeof c === 'object' ? c : {}; }
  catch { return {}; }
}

// N17/N25-N27: reserved key in the cursor map recording, per transcript, the
// SIGNATURES of recently-seen SubagentStop events. Mirrors pan-cost-logger —
// an empty-slice event is a true re-fire / dual registration ONLY when its
// full-payload signature was already seen for that transcript; a parallel
// sibling (any payload difference) or a first-fire (missing/unreadable
// transcript) carries a new signature and must be recorded, not dropped.
// Bounded FIFO SET rather than a single slot (N25) so an interleaved sibling
// can't evict the signature identifying an earlier event's re-fire; bounded by
// COUNT, not transcript existence, so the L40 prune can't erase the live marker
// of a missing-transcript first fire (N27). See pan-cost-logger.js for the full
// design rationale (the two hooks are standalone and must stay in sync by hand).
const SEEN_EVENTS = '__seenEvents';
// Pre-N25 single-slot marker — no longer read; dropped on the next write.
const LEGACY_CONSUME_KEYS = '__consumeKeys';
// This window is the ONLY layer that recognizes a re-fire which is no longer the
// LATEST completion in the trace file: the dedup below compares against that one
// completion and nothing further. A sibling wave wider than this bound on one
// transcript therefore evicts the earliest sibling's signature, and a late
// re-fire of THAT sibling is emitted as a phantom completion. That residual is
// accepted deliberately, not overlooked — see eventSignature below for what
// widening either window was measured to cost.
const MAX_SEEN_SIGS = 8;
const MAX_SEEN_TRANSCRIPTS = 16;

// Full-payload hash: byte-identical for a dual-registration re-fire, different
// for a sibling whose payload differs in ANY field, with no hardcoding of which
// field a given runtime provides (N26).
//
// WHICH fields actually differ on real payloads is only partly established, so
// the sibling-admission benefit is CONDITIONAL. What this repo has observed:
//   • `agent_type` / `subagent_type` is supplied and does vary between siblings
//     of DIFFERENT type — the trace rows recorded under
//     experiments/*/.planning/optimization/traces/ were written by THIS hook
//     from real payloads and carry real agent names.
//   • `session_id` is SHARED with the parent, and so is the session transcript
//     (docs/FIELD-REPORT-army-2026-06.md, root cause 1).
//   • `model` and `phase` came out null in those recorded rows — the payload
//     carried neither; `usage` is absent entirely in headless mode
//     (docs/HOOKS.md, P-1805).
//   • No recorded payload in this repo carries an `agent_id` or any other
//     per-invocation id; the hook tests inject one as a stand-in.
// So for two CONCURRENT SAME-TYPE siblings no varying payload field is confirmed
// on any host: where the host supplies one, both spawns are admitted; where it
// supplies none the payloads are the same bytes, hence indistinguishable from a
// re-fire, and the second stays suppressed.
//
// What the guards promise, stated as narrowly as they hold: a re-fire is
// suppressed while it is still RECOGNIZABLE — its signature is in this
// transcript's seen-event window (MAX_SEEN_SIGS), or it is byte-identical modulo
// `ts` to the LATEST completion already in the trace file. Nothing further. A
// re-fire arriving after its signature has been evicted from the marker window,
// and no longer adjacent to the completion it duplicates, IS emitted as a phantom
// completion. That is the residual; it is documented rather than engineered away.
//
// It was engineered away once, and the cure destroyed data. The dedup was widened
// to scan a tail of recent completions, with a second prong matching on a
// repeated signature alone for completions carrying no tokens. Both prongs delete
// real spawns. Five genuine spawns X,Y,X,Y,X on one shared transcript — the
// ordinary shared-session topology of docs/FIELD-REPORT-army-2026-06.md, where
// sequential same-type subagents deliver byte-identical payloads and therefore
// one signature — collapsed to TWO completions; when their slices carried real
// usage the collapsed completions' token counts vanished with them. Deleting real
// telemetry is strictly worse than the occasional phantom completion it prevents.
// The invariant that justified the contentless prong ("an event that consumed a
// real transcript slice never looks contentless") is also false: a slice of
// records that carry no `usage` and no `timestamp` yields zero on every axis and
// a null duration. So the dedup stays adjacent-only, and this comment states the
// residual instead of an invariant the code does not hold. Pinned in
// tests/trace-logger.test.cjs — `grep -n 'no genuine spawn' tests/trace-logger.test.cjs`.
//
// The NO-transcript path carries a wider residual: it never consults the marker
// layer at all (there is no transcript to key it by), so an INTERLEAVED dual
// registration there — A, B, A′, B′ — puts A′ and B′ out of adjacency reach and
// both are emitted as phantom completions. Closing that needs a lookback, and a
// lookback is the window whose failure mode is the data loss above, so it stays
// open.
//
// Where the guards CAN distinguish two events (payloads differ, so signatures
// differ) both are emitted — that is what the completion's `event_sig` is for.
// Where they CANNOT (identical bytes), the second is suppressed. The bias falls
// on the indistinguishable case only, deliberately: an undercount beats a
// phantom completion (N29).
//
// Its cost, stated because no other comment admits it: two SEQUENTIAL genuine
// spawns whose completions coincide in every field but `ts` collapse to one,
// losing the second's real counts. Inherent to an adjacent whole-record dedup,
// identical in the pre-`event_sig` code, and the alternative (no dedup)
// reinstates the duplicate-record bug. It is the one UNDER-count residual —
// distinct from the evicted-marker phantom (over-count) and from N29.
//
// Null when unserializable → fail open.
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

function writeTraceCursor(cwd, cursor) {
  try {
    // Prune dead-transcript keys so the cursor map stays bounded (L40, ADR audit 2026-08).
    const pruned = {};
    for (const [tp, v] of Object.entries(cursor)) {
      if (tp === SEEN_EVENTS || tp === LEGACY_CONSUME_KEYS) continue; // reserved markers — not paths
      if (tp && fs.existsSync(tp)) pruned[tp] = v;
    }
    // Preserve the seen-event marker (N17/N25-N27). Deliberately NOT pruned by
    // transcript existence — a missing-transcript first fire's marker must
    // survive this very write (N27); bounded by count instead (L40).
    const se = cursor[SEEN_EVENTS];
    if (se && typeof se === 'object') {
      const bounded = {};
      for (const tp of Object.keys(se).slice(-MAX_SEEN_TRANSCRIPTS)) {
        const arr = se[tp];
        if (Array.isArray(arr) && arr.length) bounded[tp] = arr.slice(-MAX_SEEN_SIGS);
      }
      if (Object.keys(bounded).length) pruned[SEEN_EVENTS] = bounded;
    }
    fs.mkdirSync(path.dirname(traceCursorPath(cwd)), { recursive: true });
    fs.writeFileSync(traceCursorPath(cwd), JSON.stringify(pruned), 'utf-8');
  } catch { /* best-effort — never block the agent loop */ }
}

/**
 * Ensure a trace session exists. If none is active, create a day-scoped
 * auto-session so tracing works across the whole flow without manual init.
 *
 * @param {string} cwd
 * @returns {string} The active session ID
 */
function ensureSessionId(cwd) {
  const now = new Date();
  const stamp = dayStamp(now); // YYYYMMDD
  const existing = getCurrentSessionId(cwd);
  if (existing) {
    // Day-rollover: a stale day-scoped auto-session from a previous day must not
    // keep accumulating today's rows. Finalize it and mint a fresh one. Explicit
    // (non-auto) sessions stay sticky — only auto-sessions roll over.
    const m = /^sess_auto_(\d{8})$/.exec(existing);
    if (m && m[1] !== stamp) {
      finalizeSession(cwd, existing);
      // fall through to mint a new day-scoped session below
    } else {
      return existing;
    }
  }

  // Create a day-scoped auto session
  const sessionId = `sess_auto_${stamp}`;
  try {
    const sessionDir = path.join(getTracesDir(cwd), sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const meta = {
      session_id: sessionId,
      started_at: now.toISOString(),
      description: 'auto-session (day-scoped)',
      auto: true,
      event_count: 0,
    };
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(meta, null, 2) + '\n');
    const optimizeDir = getOptimizeDir(cwd);
    fs.mkdirSync(optimizeDir, { recursive: true });
    fs.writeFileSync(path.join(optimizeDir, CURRENT_SESSION_FILE), sessionId + '\n');
    return sessionId;
  } catch {
    return sessionId; // Return the ID even if write fails — best effort
  }
}

function extractNumber(obj, key) {
  if (!obj || typeof obj !== 'object') return 0;
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}

// Drop implausibly large per-call token counts (a cumulative counter that leaked
// through the no-transcript fallback) to 0 rather than record them. Mirrors
// pan-cost-logger's guard.
const PLAUSIBLE_MAX = 20000000;
function clampPlausible(n) {
  return typeof n === 'number' && n >= 0 && n <= PLAUSIBLE_MAX ? n : 0;
}

/**
 * P-1805 (v3.7.8): extract usage totals by reading the SubagentStop transcript.
 * The hook payload from Claude Code in headless mode does NOT include
 * `data.usage` — only `transcript_path`. This function reads the transcript
 * JSONL file and sums the `usage` fields across all assistant messages
 * belonging to the just-completed subagent (its session_id is in `data.session_id`).
 *
 * Returns the SUM of input/output/cache tokens for the subagent's whole
 * conversation. Agents that finish in one Claude API call will have one
 * usage record; agents with multi-turn tool use will have several.
 *
 * Returns `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`
 * with all zeros if the transcript is unreadable / missing — same fallback
 * shape as the original behavior, so callers don't break.
 *
 * @param {string} transcriptPath - Absolute path to the transcript JSONL file
 * @param {string} [sessionId] - Optional subagent session_id to filter on
 * @returns {Object} usage totals object
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
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    return totals;
  }
  let seen = 0; // count of non-empty JSONL records (the cursor unit)
  for (const line of raw.split('\n')) {
    if (!line) continue;
    seen++;
    if (seen <= sinceLine) continue; // already attributed to an earlier event
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // Filter to entries from this subagent if a session_id is provided.
    // The transcript may include parent + child traffic; session_id discriminates.
    if (sessionId && entry.session_id && entry.session_id !== sessionId) continue;
    // Span of this subagent's slice (after the session filter) for duration_ms,
    // and the model id (mirrors pan-cost-logger — keep the last model seen).
    const entryTs = typeof entry.timestamp === 'string' ? entry.timestamp : null;
    if (entryTs) {
      if (!totals.first_ts) totals.first_ts = entryTs;
      totals.last_ts = entryTs;
    }
    const entryModel = entry.message?.model || entry.model || null;
    if (typeof entryModel === 'string' && entryModel) totals.model = entryModel;
    // Usage typically lives on assistant message records.
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
 * Build trace event(s) from a SubagentStop payload.
 *
 * When the payload lacks usage and `cwd` is supplied, this advances a
 * per-transcript cursor (its only side effect) so each event is attributed
 * just its own transcript slice — never the whole shared-session transcript
 * re-summed every event (field report 2026-06). Without `cwd` it falls back to
 * the legacy whole-transcript read (used only when a transcript_path is given).
 *
 * @param {Object} data - SubagentStop event payload
 * @param {string} sessionId - active trace session id
 * @param {string} [cwd] - project root, enables per-transcript delta attribution
 * @returns {Object[]} Array of trace event records
 */
function buildTraceEvents(data, sessionId, cwd) {
  if (!data || typeof data !== 'object') return [];
  if (data.hook_event_name && data.hook_event_name !== 'SubagentStop') return [];

  const ts = new Date().toISOString();
  const agent = data.agent_type || data.subagent_type || 'unknown';
  // This event's per-invocation identity, hashed once and used by BOTH layers:
  // the seen-event marker below and the completion's `event_sig` context field.
  // buildTraceEvents never mutates `data`, so hoisting the hash here yields the
  // same value the marker calls used when they each computed it themselves.
  const eventSig = eventSignature(data);

  // Per-call tokens come from the transcript SLICE. The SubagentStop `data.usage`,
  // when present, is a CUMULATIVE session counter — not this subagent's delta — so
  // logging it verbatim produced impossible per-row magnitudes (see pan-cost-logger
  // for the full rationale). The slice is authoritative; data.usage is only a
  // plausibility-guarded fallback when no transcript is available.
  let model = typeof data.model === 'string' && data.model ? data.model : null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let durationMs = null;
  let tokenSource = data.transcript_path ? 'transcript' : 'usage-fallback';
  let clamped = false;
  if (data.transcript_path) {
    const cursor = readTraceCursor(cwd);
    const since = cursor[data.transcript_path] || 0;
    const fromTranscript = readUsageFromTranscript(data.transcript_path, data.session_id, since);
    inputTokens = fromTranscript.input_tokens;
    outputTokens = fromTranscript.output_tokens;
    cacheRead = fromTranscript.cache_read_input_tokens;
    durationMs = durationFromSpan(fromTranscript.first_ts, fromTranscript.last_ts);
    if (!model) model = fromTranscript.model;
    if (cwd && fromTranscript.lineCount > since) {
      // A real slice. Advance the cursor and remember this event's signature
      // (N17/N25) so a later empty-slice event can tell its re-fire from a
      // parallel sibling — even when other siblings are recorded in between (N25).
      cursor[data.transcript_path] = fromTranscript.lineCount;
      addSeenSig(cursor, data.transcript_path, eventSig);
      writeTraceCursor(cwd, cursor);
    } else if (cwd && fromTranscript.lineCount <= since) {
      // No transcript records past the cursor: this event consumed NO slice of its
      // own. Two situations land here (N17):
      //   • A re-fire / dual global+local hook registration — the SAME event
      //     delivered again (byte-identical payload). Its all-zero completion row
      //     is a phantom the dedup cannot catch (zeros differ from the real row
      //     it follows), so emit nothing (M61). This marker is the ONLY layer
      //     that catches that case; there is no signature-matching backstop below
      //     it, by design (see eventSignature).
      //   • A PARALLEL SIBLING (another subagent — same or different type — whose
      //     sibling already consumed the shared transcript to EOF and advanced
      //     this shared cursor) or a FIRST FIRE with a missing/unreadable
      //     transcript. These are legitimate spawns that must be RECORDED (zero
      //     tokens), not dropped.
      // The full-payload signature distinguishes them (N25/N26): emit nothing
      // ONLY when this exact payload was already seen for this transcript;
      // otherwise fall through and emit the completion.
      if (eventSig && getSeenSigs(cursor, data.transcript_path).includes(eventSig)) {
        return []; // already-seen event → re-fire; emit nothing (M61)
      }
      // Sibling / first-fire: remember this event's signature so its own re-fire
      // is subsequently dropped, then fall through to emit the completion.
      addSeenSig(cursor, data.transcript_path, eventSig);
      writeTraceCursor(cwd, cursor);
    }
  } else {
    const rawIn = extractNumber(data.usage, 'input_tokens');
    const rawOut = extractNumber(data.usage, 'output_tokens');
    const rawCr = extractNumber(data.usage, 'cache_read_input_tokens');
    inputTokens = clampPlausible(rawIn);
    outputTokens = clampPlausible(rawOut);
    cacheRead = clampPlausible(rawCr);
    clamped = [rawIn, rawOut, rawCr].some((n) => n > PLAUSIBLE_MAX);
  }
  const totalTokens = inputTokens + outputTokens;

  // Inherit command/phase from the active session when the payload omits them
  // (mirrors optimize.cjs logTraceEvent's W3 phase-inheritance, which the hook
  // path otherwise bypasses).
  const sessionMeta = cwd ? readSessionMetaById(cwd, sessionId) : {};
  const phase = data.phase || sessionMeta.phase || null;

  const events = [];

  // Core completion event
  events.push({
    v: SCHEMA_V,
    ts,
    session: sessionId,
    agent,
    phase,
    type: 'decision',
    category: 'agent_completion',
    description: `${agent} completed`,
    context: {
      model,
      command: data.command || sessionMeta.command || null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheRead,
      total_tokens: totalTokens,
      duration_ms: durationMs,
      exit_code: data.exit_code || 0,
      token_source: tokenSource,
      clamped,
      // This spawn's per-invocation discriminator: the event signature,
      // persisted. The signature was already hashed for the seen-event marker
      // but never written into the event, so two parallel same-type siblings
      // produced completions byte-identical modulo `ts` and the dedup dropped the
      // second one even though the marker layer had correctly admitted it (N26).
      // Persisting it gives both layers ONE notion of event identity: siblings
      // differ here even when every other field matches, while a re-fire carries
      // the same signature and still matches the completion it duplicates.
      // It is a field the dedup COMPARES as part of whole-event identity — never
      // a key the dedup searches the trace file by. Two sequential subagents on a
      // shared growing transcript share one payload and therefore one signature
      // while holding different real token counts, so matching on the signature
      // alone deletes genuine completions (see eventSignature). Mirrors
      // pan-cost-logger's ledger-row field of the same name. null when the
      // payload could not be hashed.
      event_sig: eventSig,
    },
    impact: 'trivial',
    correction: null,
    tokens_wasted: null,
  });

  // Heuristic: if output tokens > 3000 and no cache hits, flag as potential redundancy
  // (expensive agent run that wasn't cached — may be repeated research)
  if (outputTokens > 3000 && cacheRead === 0) {
    events.push({
      v: SCHEMA_V,
      ts,
      session: sessionId,
      agent,
      phase,
      type: 'redundancy',
      category: 'uncached_heavy_run',
      description: `${agent} produced ${outputTokens} output tokens with zero cache hits — possible repeated research`,
      context: { output_tokens: outputTokens, cache_read_tokens: 0 },
      impact: 'minor',
      correction: null,
      tokens_wasted: outputTokens,
    });
  }

  return events;
}

/**
 * Append trace events to the active session.
 * Returns true if written, false if no session or write failed.
 *
 * @param {string} cwd
 * @param {Object[]} events
 * @param {string} sessionId
 */
function appendTraceEvents(cwd, events, sessionId) {
  if (!events.length) return false;
  try {
    const sessionDir = path.join(getTracesDir(cwd), sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const file = path.join(sessionDir, TRACE_EVENT_FILE);
    // Idempotency guard: a re-fired SubagentStop must not double-log — the
    // source of the ~57% duplicate completion rows in the field (2026-07). If
    // this batch's completion event duplicates the LAST agent_completion already
    // in the file (every field but `ts`), skip the whole batch — its redundancy
    // event, if any, is derived from the same numbers. Adjacent-only on purpose;
    // see isDuplicateCompletion.
    const completion = events.find(e => e && e.category === 'agent_completion');
    if (completion && isDuplicateCompletion(file, completion)) return false;
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(file, lines, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `completion` matches the file's LAST agent_completion, ignoring `ts`.
 *
 * Adjacent-only, and that is the design rather than an oversight. The comparison
 * covers every field including the `event_sig` discriminator in `context`, so a
 * true re-fire (same payload → same signature → same completion) still matches
 * the one it follows, while two siblings the payload can distinguish both survive
 * (N26).
 *
 * It deliberately does NOT scan back over a tail of recent completions, and does
 * not match on a repeated signature. Both of those were tried and both delete
 * real spawns: an identity scan over a window collapses genuine repeat spawns
 * whose completions coincide, and a signature prong collapses genuine spawns that
 * share a payload — the ordinary shared-transcript topology. eventSignature
 * carries the measured reproduction and the residual this leaves standing;
 * tests/trace-logger.test.cjs pins both
 * (`grep -n 'no genuine spawn' tests/trace-logger.test.cjs`).
 *
 * Completions written before the discriminator existed hold no `event_sig` and an
 * older `v`, so one written now never equals them. The bounded consequence: the
 * first append after a schema bump can land beside a pre-bump completion without
 * matching it, and the guard resumes on the following same-shape pair. Those
 * older events still parse and still analyse — optimize.cjs reads a trace event
 * field by field and requires no particular version or field to be present.
 */
function isDuplicateCompletion(file, completion) {
  let last;
  try {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; } // skip malformed rows
      if (e && e.category === 'agent_completion') last = e;
    }
  } catch {
    return false;
  }
  if (!last) return false;
  const strip = (e) => { const { ts, ...rest } = e; return JSON.stringify(rest); };
  return strip(last) === strip(completion);
}

// ─── Stdin driver ────────────────────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (input += chunk));
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const cwd = data.cwd || data.workspace?.current_dir || process.cwd();
      // M62: a global-install hook fires in every repo; skip non-PAN projects so
      // we don't create .planning/ optimization + trace artifacts in them.
      if (!isPanProject(cwd)) return;
      // In a PAN project, ensure a session exists — creates a day-scoped
      // auto-session if needed.
      const sessionId = ensureSessionId(cwd);
      const events = buildTraceEvents(data, sessionId, cwd);
      appendTraceEvents(cwd, events, sessionId);
    } catch {
      // Silent fail
    }
  });
}

module.exports = {
  buildTraceEvents,
  appendTraceEvents,
  getCurrentSessionId,
  ensureSessionId,
  isPanProject,
  PLANNING_DIR,
  OPTIMIZE_DIR,
  TRACES_DIR,
  CURRENT_SESSION_FILE,
  TRACE_EVENT_FILE,
};
