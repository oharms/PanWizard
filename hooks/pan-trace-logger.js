#!/usr/bin/env node
// pan-trace-logger — SubagentStop hook (v3.5+).
//
// Fires alongside pan-cost-logger on every SubagentStop event. If a trace
// session is active (.planning/optimization/current-session exists), this
// hook appends a completion event to the trace. This is the automatic
// instrumentation layer of the circular optimization loop — no extra user
// action required.
//
// Events logged per subagent:
//   - completion: agent finished, tokens used, exit status
//   - redundancy: detected when the same agent type ran twice in this session
//     with similar token counts (rough heuristic for repeated work)
//
// Errors are swallowed — this hook must never block the main agent loop.

const fs = require('fs');
const path = require('path');

const PLANNING_DIR = '.planning';
const OPTIMIZE_DIR = 'optimization';
const TRACES_DIR = 'traces';
const CURRENT_SESSION_FILE = 'current-session';
const TRACE_EVENT_FILE = 'trace.jsonl';

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
function writeTraceCursor(cwd, cursor) {
  try { fs.mkdirSync(path.dirname(traceCursorPath(cwd)), { recursive: true }); fs.writeFileSync(traceCursorPath(cwd), JSON.stringify(cursor), 'utf-8'); }
  catch { /* best-effort — never block the agent loop */ }
}

/**
 * Ensure a trace session exists. If none is active, create a day-scoped
 * auto-session so tracing works across the whole flow without manual init.
 *
 * @param {string} cwd
 * @returns {string} The active session ID
 */
function ensureSessionId(cwd) {
  const existing = getCurrentSessionId(cwd);
  if (existing) return existing;

  // Create a day-scoped auto session
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8); // YYYYMMDD
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

  // P-1805: prefer usage from data.usage when present (interactive Claude Code path).
  // Fall back to reading the transcript file (headless `claude -p` path — usage
  // not in payload but discoverable via transcript_path).
  let inputTokens = extractNumber(data.usage, 'input_tokens');
  let outputTokens = extractNumber(data.usage, 'output_tokens');
  let cacheRead = extractNumber(data.usage, 'cache_read_input_tokens');
  if ((inputTokens + outputTokens + cacheRead) === 0 && data.transcript_path) {
    const cursor = readTraceCursor(cwd);
    const since = cursor[data.transcript_path] || 0;
    const fromTranscript = readUsageFromTranscript(data.transcript_path, data.session_id, since);
    inputTokens = fromTranscript.input_tokens;
    outputTokens = fromTranscript.output_tokens;
    cacheRead = fromTranscript.cache_read_input_tokens;
    if (cwd && fromTranscript.lineCount > since) {
      cursor[data.transcript_path] = fromTranscript.lineCount;
      writeTraceCursor(cwd, cursor);
    }
  }
  const totalTokens = inputTokens + outputTokens;

  const events = [];

  // Core completion event
  events.push({
    ts,
    session: sessionId,
    agent,
    phase: data.phase || null,
    type: 'decision',
    category: 'agent_completion',
    description: `${agent} completed`,
    context: {
      model: data.model || null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheRead,
      total_tokens: totalTokens,
      exit_code: data.exit_code || 0,
    },
    impact: 'trivial',
    correction: null,
    tokens_wasted: null,
  });

  // Heuristic: if output tokens > 3000 and no cache hits, flag as potential redundancy
  // (expensive agent run that wasn't cached — may be repeated research)
  if (outputTokens > 3000 && cacheRead === 0) {
    events.push({
      ts,
      session: sessionId,
      agent,
      phase: data.phase || null,
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
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(path.join(sessionDir, TRACE_EVENT_FILE), lines, 'utf-8');
    return true;
  } catch {
    return false;
  }
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
      // Always ensure a session exists — creates a day-scoped auto-session if needed
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
  PLANNING_DIR,
  OPTIMIZE_DIR,
  TRACES_DIR,
  CURRENT_SESSION_FILE,
  TRACE_EVENT_FILE,
};
