'use strict';
// optimize.cjs — Circular optimization loop: trace → learn → apply → repeat.
//
// Every agent spawn is logged to a trace session. After a build, /pan:learn
// invokes pan-optimizer to analyze the trace. /pan:optimize apply writes memory
// entries, config notes, and prompt suggestions back into the project, making
// the next run smarter.

const fs = require('fs');
const path = require('path');
const { output, escapeRegex, execGit, toLf } = require('./core.cjs');
const { planningPath, planningRel } = require('./utils.cjs');

// ─── Storage layout ──────────────────────────────────────────────────────────

const OPTIMIZE_DIR = 'optimization';
const TRACES_DIR = 'traces';
const OPT_REPORTS_DIR = 'reports';
const CURRENT_SESSION_FILE = 'current-session';
const TRACE_EVENT_FILE = 'trace.jsonl';
const OPT_SESSION_FILE = 'session.json';
const APPLIED_LOG = 'applied.jsonl';

// Event types the trace system recognizes
const EVENT_TYPES = ['decision', 'error', 'gap', 'correction', 'redundancy', 'memory_hit', 'memory_miss', 'surprise'];
// Impact levels
const IMPACT_LEVELS = ['critical', 'major', 'minor', 'trivial'];

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getOptimizeDir(cwd) {
  return planningPath(cwd, OPTIMIZE_DIR);
}

function getTracesDir(cwd) {
  return path.join(getOptimizeDir(cwd), TRACES_DIR);
}

function getReportsDir(cwd) {
  return path.join(getOptimizeDir(cwd), OPT_REPORTS_DIR);
}

// ─── Session management ───────────────────────────────────────────────────────

function generateSessionId() {
  const now = new Date();
  // sess_20260421T180000
  return 'sess_' + now.toISOString().replace(/[-:.Z]/g, '').slice(0, 15);
}

// P-1404 helper: try to reuse a recent existing session.
// Returns { session_id, started_at, directory, reused: true } on success,
// null if no recent session exists or reuse failed.
function tryReuseSession(cwd, opts) {
  try {
    const optimizeDir = getOptimizeDir(cwd);
    const currentSessionPath = path.join(optimizeDir, CURRENT_SESSION_FILE);
    const existingId = fs.readFileSync(currentSessionPath, 'utf-8').trim();
    if (!existingId) return null;

    const sessionDir = path.join(getTracesDir(cwd), existingId);
    const sessionMetaPath = path.join(sessionDir, OPT_SESSION_FILE);
    const meta = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf-8'));

    // Don't reuse if session is already explicitly ended
    if (meta.ended_at) return null;

    // Don't reuse if session started more than REUSE_WINDOW_MS ago
    const startedAt = new Date(meta.started_at).getTime();
    if (Date.now() - startedAt > SESSION_REUSE_WINDOW_MS) return null;

    return {
      session_id: existingId,
      started_at: meta.started_at,
      directory: sessionDir,
      reused: true,
    };
  } catch {
    return null;
  }
}

// P-1404 fix (v3.7.3): a recent existing session (within REUSE_WINDOW_MS) is
// reused instead of creating a new one. Without this, every /pan:exec-phase /
// /pan:plan-phase / etc. creates its own session, fragmenting trace data
// across many sub-sessions and making /pan:learn analysis incomplete.
// Fragmentation surfaced by panloop run: 14 events scattered across 4 sessions.
const SESSION_REUSE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function initTraceSession(cwd, opts = {}) {
  // Reuse logic: if no explicit sessionId requested AND a current-session
  // file exists pointing at a recent session, reuse it.
  if (!opts.sessionId && !opts.forceNew) {
    const reused = tryReuseSession(cwd, opts);
    if (reused) return reused;
  }

  const sessionId = opts.sessionId || generateSessionId();
  const sessionDir = path.join(getTracesDir(cwd), sessionId);

  try {
    fs.mkdirSync(sessionDir, { recursive: true });

    const meta = {
      session_id: sessionId,
      started_at: new Date().toISOString(),
      description: opts.description || null,
      command: opts.command || null,
      phase: opts.phase || null,
      agent_count: 0,
      event_count: 0,
      ended_at: null,
    };

    fs.writeFileSync(path.join(sessionDir, OPT_SESSION_FILE), JSON.stringify(meta, null, 2) + '\n');

    // Record as active session
    const optimizeDir = getOptimizeDir(cwd);
    fs.mkdirSync(optimizeDir, { recursive: true });
    fs.writeFileSync(path.join(optimizeDir, CURRENT_SESSION_FILE), sessionId + '\n');

    return { session_id: sessionId, started_at: meta.started_at, directory: sessionDir, reused: false };
  } catch (e) {
    return { error: e.message || 'trace_init_failed' };
  }
}

function getCurrentSessionId(cwd) {
  try {
    const content = fs.readFileSync(path.join(getOptimizeDir(cwd), CURRENT_SESSION_FILE), 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Day-scoped auto-session id, the same shape the trace hook mints
 * (`sess_auto_YYYYMMDD`) so a day's hook-written and agent-reported events share one
 * session instead of splitting into two.
 */
function autoSessionId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `sess_auto_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

/**
 * How long a `current-session` pointer is evidence of a live session. An explicit
 * (non-auto) session used to stay "current" indefinitely — a July session was still
 * current in September in a field project, so `readActiveSessionMeta` in the cost hook
 * backfilled two-month-old command/phase onto today's ledger rows, and agent-reported
 * events would have landed in a long-dead session's directory (field sweep 2026-09-17).
 */
const SESSION_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Last time anything was written to a session: its event log if it has one, else the
 * moment it started. Null when the session cannot be read at all.
 */
function sessionLastActivityMs(cwd, sid) {
  const dir = path.join(getTracesDir(cwd), sid);
  try {
    return fs.statSync(path.join(dir, TRACE_EVENT_FILE)).mtimeMs;
  } catch { /* no events yet */ }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, OPT_SESSION_FILE), 'utf-8'));
    const t = new Date(meta.started_at).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * Is this session finished, or too old to still be the one running? Read-only —
 * finalizing a stale session is the writing path's job (the trace hook's rollover).
 */
function isSessionStale(cwd, sid, now = Date.now()) {
  const dir = path.join(getTracesDir(cwd), sid);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, OPT_SESSION_FILE), 'utf-8'));
    if (meta && meta.ended_at) return true;
  } catch { /* unreadable meta — fall through to the age test */ }
  const last = sessionLastActivityMs(cwd, sid);
  if (last === null) return true;
  return now - last > SESSION_STALE_MS;
}

/**
 * Append one trace event.
 *
 * Creates the day's auto-session when none is active. It used to return false instead,
 * and the 16 `optimize trace log` call sites in the workflows are fire-and-forget
 * (`2>/dev/null || true`), so on the phase pipeline — which never starts a trace
 * session — every agent-reported event was silently discarded. Across fourteen field
 * projects the instrument held 3,737 events, 99.7% of them the completion rows the hook
 * writes, and not one error, gap or correction in its whole history (sweep 2026-09-17).
 * An explicit `--session` is still honoured verbatim.
 */
function logTraceEvent(cwd, event, sessionId) {
  // An explicit id is honoured verbatim. A POINTER, by contrast, is only evidence while
  // the session it names is alive; a dead one is no session at all.
  let sid = sessionId || null;
  if (!sid) {
    const current = getCurrentSessionId(cwd);
    if (current && !isSessionStale(cwd, current)) sid = current;
  }
  if (!sid) {
    const created = initTraceSession(cwd, { sessionId: autoSessionId(), description: 'auto-session (day-scoped)' });
    if (!created || created.error) return false;
    sid = created.session_id;
  }

  try {
    const sessionDir = path.join(getTracesDir(cwd), sid);

    // W3 fix: inherit session phase so per-phase filtering doesn't require session-join
    let resolvedPhase = event.phase || null;
    if (!resolvedPhase) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, OPT_SESSION_FILE), 'utf-8'));
        resolvedPhase = meta.phase || null;
      } catch {}
    }

    const record = {
      ts: new Date().toISOString(),
      session: sid,
      agent: event.agent || null,
      phase: resolvedPhase,
      type: EVENT_TYPES.includes(event.type) ? event.type : 'unknown',
      category: event.category || null,
      description: String(event.description || ''),
      context: event.context || null,
      impact: IMPACT_LEVELS.includes(event.impact) ? event.impact : 'minor',
      correction: event.correction || null,
      tokens_wasted: typeof event.tokens_wasted === 'number' ? event.tokens_wasted : null,
    };

    fs.mkdirSync(sessionDir, { recursive: true });
    fs.appendFileSync(path.join(sessionDir, TRACE_EVENT_FILE), JSON.stringify(record) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Recompute a session's counters straight from its trace.jsonl — the single
 * source of truth for event_count/agent_count/agents/type_counts, plus a count
 * of malformed (unparseable) rows that would otherwise vanish silently. Pure
 * read; never writes. Used by endTraceSession, the reconcile subcommand, and the
 * reconcile-on-read overlay so the counting logic lives in exactly one place.
 */
function reconcileSessionMeta(cwd, sessionId) {
  const sessionDir = path.join(getTracesDir(cwd), sessionId);
  let eventCount = 0;
  let malformed = 0;
  const agentNames = new Set();
  const typeCounts = {};
  try {
    const raw = fs.readFileSync(path.join(sessionDir, TRACE_EVENT_FILE), 'utf-8');
    raw.trim().split('\n').filter(Boolean).forEach(line => {
      let e;
      try { e = JSON.parse(line); } catch { malformed++; return; }
      eventCount++;
      if (e.agent) agentNames.add(e.agent);
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    });
  } catch { /* no trace.jsonl yet */ }
  return {
    event_count: eventCount,
    agent_count: agentNames.size,
    agents: Array.from(agentNames),
    type_counts: typeCounts,
    malformed_count: malformed,
  };
}

/**
 * Compute the measured dollar cost + commit count for a session's [started_at,
 * ended_at||now] window, folding the authoritative per-agent cost ledger
 * (tokens.jsonl, suspect rows already quarantined) into the session so the
 * autonomous-overhead metrics work. cost_usd is null when the ledger has no
 * in-window rows; commit_count is null when git is unavailable — never a
 * fabricated 0 (0 would make minutes_per_commit Infinity). Best-effort.
 */
function computeSessionCostAndCommits(cwd, meta) {
  const out = { cost_usd: null, commit_count: null };
  if (!meta || !meta.started_at) return out;
  const since = meta.started_at;
  const until = meta.ended_at || new Date().toISOString();
  try {
    const cost = require('./cost.cjs');
    const agg = cost.aggregate(cwd, { since, until });
    if (agg && agg.totals && agg.totals.calls > 0) out.cost_usd = agg.totals.cost_usd;
  } catch { /* cost is observability, never the critical path */ }
  try {
    const r = execGit(cwd, ['log', '--oneline', '--since', since, '--until', until]);
    if (r && r.exitCode === 0) {
      out.commit_count = r.stdout ? r.stdout.split('\n').filter(Boolean).length : 0;
    }
  } catch { /* non-repo / git absent → leave null */ }
  return out;
}

function endTraceSession(cwd, sessionId) {
  const sid = sessionId || getCurrentSessionId(cwd);
  if (!sid) return { error: 'No active session' };

  try {
    const sessionDir = path.join(getTracesDir(cwd), sid);
    const metaPath = path.join(sessionDir, OPT_SESSION_FILE);

    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}

    const counts = reconcileSessionMeta(cwd, sid);
    meta.ended_at = new Date().toISOString();
    meta.event_count = counts.event_count;
    meta.agent_count = counts.agent_count;
    meta.agents = counts.agents;
    meta.type_counts = counts.type_counts;
    if (counts.malformed_count) meta.malformed_count = counts.malformed_count;

    // Fold measured cost + commit count into the session so overhead.* metrics
    // and `optimize stats` carry real dollars, not perpetual nulls.
    const cc = computeSessionCostAndCommits(cwd, meta);
    if (cc.cost_usd != null) meta.cost_usd = cc.cost_usd;
    if (cc.commit_count != null) meta.commit_count = cc.commit_count;

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

    // Clear the active-session pointer so the next SubagentStop opens a fresh
    // session — but ONLY when we ended the session it points at (ending session
    // A explicitly must not orphan a different active session B).
    try {
      if (getCurrentSessionId(cwd) === sid) {
        fs.unlinkSync(path.join(getOptimizeDir(cwd), CURRENT_SESSION_FILE));
      }
    } catch { /* best-effort */ }

    return {
      session_id: sid,
      event_count: counts.event_count,
      agent_count: counts.agent_count,
      type_counts: counts.type_counts,
      malformed_count: counts.malformed_count,
      cost_usd: meta.cost_usd != null ? meta.cost_usd : null,
      commit_count: meta.commit_count != null ? meta.commit_count : null,
      ended_at: meta.ended_at,
    };
  } catch (e) {
    return { error: e.message || 'trace_read_failed' };
  }
}

/**
 * Rewrite session.json from trace.jsonl WITHOUT ending the session (ended_at is
 * left untouched). Powers `optimize trace reconcile`, so hook-driven auto-sessions
 * that never call `end` still get accurate counters.
 */
function reconcileTraceSession(cwd, sessionId) {
  const sid = sessionId || getCurrentSessionId(cwd);
  if (!sid) return { error: 'No session to reconcile' };
  try {
    const metaPath = path.join(getTracesDir(cwd), sid, OPT_SESSION_FILE);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
    const counts = reconcileSessionMeta(cwd, sid);
    meta.event_count = counts.event_count;
    meta.agent_count = counts.agent_count;
    meta.agents = counts.agents;
    meta.type_counts = counts.type_counts;
    if (counts.malformed_count) meta.malformed_count = counts.malformed_count;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    return { session_id: sid, reconciled: true, event_count: counts.event_count, malformed_count: counts.malformed_count };
  } catch (e) {
    return { error: e.message || 'trace_write_failed' };
  }
}

/** Reconcile every session dir (used by `optimize trace reconcile --all`). */
function reconcileAllTraceSessions(cwd) {
  const results = [];
  try {
    const tracesDir = getTracesDir(cwd);
    for (const e of fs.readdirSync(tracesDir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.startsWith('sess_')) results.push(reconcileTraceSession(cwd, e.name));
    }
  } catch { /* no traces dir */ }
  return { reconciled: results.length, sessions: results };
}

function readTraceSession(cwd, sessionId) {
  try {
    const sessionDir = path.join(getTracesDir(cwd), sessionId);

    let metadata = {};
    try {
      metadata = JSON.parse(fs.readFileSync(path.join(sessionDir, OPT_SESSION_FILE), 'utf-8'));
    } catch {}

    const events = [];
    let malformed = 0;
    try {
      const raw = fs.readFileSync(path.join(sessionDir, TRACE_EVENT_FILE), 'utf-8');
      raw.trim().split('\n').filter(Boolean).forEach(line => {
        try { events.push(JSON.parse(line)); } catch { malformed++; }
      });
    } catch {}

    // Reconcile-on-read: an unfinalized meta (no ended_at) or a stale zero
    // event_count is overlaid with the live counts derived from the events just
    // read, so consumers of metadata (e.g. optimize stats) never see a stale 0.
    if (!metadata.ended_at || !metadata.event_count) {
      const typeCounts = {};
      const agents = new Set();
      for (const e of events) { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; if (e.agent) agents.add(e.agent); }
      metadata = { ...metadata, event_count: events.length, agent_count: agents.size, agents: Array.from(agents), type_counts: typeCounts };
    }

    return { session_id: sessionId, metadata, events, event_count: events.length, malformed_count: malformed };
  } catch (e) {
    return { error: e.message || 'trace_end_failed' };
  }
}

function listTraceSessions(cwd) {
  try {
    const tracesDir = getTracesDir(cwd);
    try { fs.accessSync(tracesDir); } catch { return { sessions: [], count: 0 }; }

    const dirs = fs.readdirSync(tracesDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('sess_'));

    const sessions = dirs.map(e => {
      const sessionDir = path.join(tracesDir, e.name);
      let meta = { session_id: e.name };
      try {
        meta = JSON.parse(fs.readFileSync(path.join(sessionDir, OPT_SESSION_FILE), 'utf-8'));
      } catch {}
      // Reconcile-on-read: unfinalized (no ended_at) or stale-zero sessions —
      // every hook-driven auto-session — get live counts from trace.jsonl so
      // getOptimizeStats doesn't sum perpetual zeros. Finalized sessions with a
      // real count stay cheap (session.json read only).
      if (!meta.ended_at || !meta.event_count) {
        const counts = reconcileSessionMeta(cwd, e.name);
        meta = { ...meta, event_count: counts.event_count, agent_count: counts.agent_count, agents: counts.agents, type_counts: counts.type_counts };
      }
      return meta;
    }).sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

    return { sessions, count: sessions.length };
  } catch (e) {
    return { error: e.message || 'trace_reconcile_failed' };
  }
}

// ─── Local analysis (no agent) ────────────────────────────────────────────────

// Judge verdicts, as the findings ledger logs them (evidence loop) and as the
// workflow prose logged them before it (legacy categories, kept so older sessions
// still analyse). Legacy categories name no agent reliably, so each maps to its judge.
const VERDICT_CATEGORIES = {
  verdict_passed: { outcome: 'pass' },
  verdict_failed: { outcome: 'fail' },
  verdict_needs_human: { outcome: 'needs_human' },
  verification_passed: { outcome: 'pass', agent: 'pan-verifier' },
  verification_gaps: { outcome: 'fail', agent: 'pan-verifier' },
  verification_human_needed: { outcome: 'needs_human', agent: 'pan-verifier' },
  plan_verified: { outcome: 'pass', agent: 'pan-plan-checker' },
  plan_checker_issues: { outcome: 'fail', agent: 'pan-plan-checker' },
  reviewer_correction: { outcome: 'fail', agent: 'pan-reviewer' },
  reviewer_warnings: { outcome: 'pass', agent: 'pan-reviewer' },
};

/**
 * Failed tool calls grouped the way a lesson would be: the same agent hitting the
 * same failure (tool, class, message signature). `spawns` and `sessions` are what
 * separate a recurring failure from one run's accident.
 */
function toolErrorPatterns(toolErrors) {
  const groups = new Map();
  for (const e of toolErrors) {
    const c = e.context || {};
    const key = [e.agent || 'unknown', c.tool || 'unknown', c.error_class || 'other', c.message_sig || c.message || ''].join('\u0000');
    let g = groups.get(key);
    if (!g) {
      g = { agent: e.agent || 'unknown', tool: c.tool || 'unknown', error_class: c.error_class || 'other', exit_code: c.exit_code == null ? null : c.exit_code, message: c.message || '', occurrences: 0, spawns: new Set(), sessions: new Set() };
      groups.set(key, g);
    }
    g.occurrences += typeof c.count === 'number' && c.count > 0 ? c.count : 1;
    g.spawns.add(c.agent_id || `${e.session}|${e.ts}`);
    if (e.session) g.sessions.add(e.session);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, spawns: g.spawns.size, sessions: g.sessions.size }))
    .sort((a, b) => b.spawns - a.spawns || b.occurrences - a.occurrences);
}

/** Per-judge verdict counts, retries and the retries that turned a failure into a pass. */
function verdictStats(events) {
  const stats = {};
  const bump = (agent) => (stats[agent] = stats[agent] || { pass: 0, fail: 0, needs_human: 0, retries: 0, resolved_by_retry: 0 });
  for (const e of events) {
    const v = VERDICT_CATEGORIES[e.category];
    if (v) {
      const agent = (e.context && e.context.agent) || v.agent || e.agent || 'unknown';
      bump(agent)[v.outcome]++;
    } else if (e.type === 'correction' && e.category === 'verdict_retry') {
      const agent = (e.context && e.context.agent) || e.agent || 'unknown';
      const s = bump(agent);
      s.retries++;
      if (e.context && e.context.outcome === 'pass') s.resolved_by_retry++;
    }
  }
  return stats;
}

function analyzeEvents(events, sessionMeta) {
  const errors = events.filter(e => e.type === 'error');
  const gaps = events.filter(e => e.type === 'gap');
  const redundancies = events.filter(e => e.type === 'redundancy');
  const decisions = events.filter(e => e.type === 'decision');
  const corrections = events.filter(e => e.type === 'correction');
  const memoryMisses = events.filter(e => e.type === 'memory_miss');
  // The legacy category, or the reviewer's failed verdict as the findings ledger logs it.
  const reviewerCorrections = events.filter(e => e.type === 'error'
    && (e.category === 'reviewer_correction' || (e.category === 'verdict_failed' && ((e.context && e.context.agent) || e.agent) === 'pan-reviewer')));
  const memoryPrimed = events.filter(e => e.type === 'decision' && e.category === 'memory_primed');
  const toolErrors = events.filter(e => e.type === 'error' && e.category === 'tool_error');
  const toolPatterns = toolErrorPatterns(toolErrors);
  const verdicts = verdictStats(events);
  const measuredSpawns = events.filter(e => e.category === 'agent_completion' && e.context && typeof e.context.tool_errors === 'number');

  function frequencyMap(arr) {
    const map = {};
    arr.forEach(e => {
      const key = e.category || e.description.slice(0, 60);
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .map(([key, count]) => ({ pattern: key, count }))
      .sort((a, b) => b.count - a.count);
  }

  const agentStats = {};
  events.forEach(e => {
    if (!e.agent) return;
    if (!agentStats[e.agent]) agentStats[e.agent] = { total: 0, errors: 0, gaps: 0, corrections: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    agentStats[e.agent].total++;
    if (e.type === 'error') agentStats[e.agent].errors++;
    if (e.type === 'gap') agentStats[e.agent].gaps++;
    if (e.type === 'correction') agentStats[e.agent].corrections++;
    // Sum the per-call tokens the trace logger now writes — ONLY on completion
    // events, so the redundancy event that mirrors output_tokens isn't counted twice.
    if (e.category === 'agent_completion' && e.context) {
      agentStats[e.agent].input_tokens += e.context.input_tokens || 0;
      agentStats[e.agent].output_tokens += e.context.output_tokens || 0;
      agentStats[e.agent].total_tokens += e.context.total_tokens || ((e.context.input_tokens || 0) + (e.context.output_tokens || 0));
    }
  });

  Object.keys(agentStats).forEach(a => {
    const s = agentStats[a];
    s.error_rate = s.total > 0 ? Math.round((s.errors / s.total) * 100) / 100 : 0;
  });

  const wastedTokens = redundancies.reduce((sum, e) => sum + (e.tokens_wasted || 0), 0);

  // Sum the authoritative per-call tokens (written by the SubagentStop hooks
  // since v3.20.0) across completion events — the redundancy events mirror
  // output_tokens, so restrict to agent_completion to avoid double-counting.
  const completions = events.filter(e => e.category === 'agent_completion' && e.context);
  const tokenTotals = completions.reduce((acc, e) => {
    acc.input += e.context.input_tokens || 0;
    acc.output += e.context.output_tokens || 0;
    acc.cache_read += e.context.cache_read_tokens || 0;
    return acc;
  }, { input: 0, output: 0, cache_read: 0 });

  // ── Timing analysis ───────────────────────────────────────────────────────
  // Prefer measured per-agent duration_ms (hooks derive it from the transcript
  // slice); fall back to the inter-event wall-clock gap when it's absent.
  const timing = {};

  // Session total duration
  if (sessionMeta && sessionMeta.started_at && sessionMeta.ended_at) {
    timing.session_duration_ms = new Date(sessionMeta.ended_at) - new Date(sessionMeta.started_at);
    timing.session_duration_human = _msToHuman(timing.session_duration_ms);
  }

  // Per-agent intervals: time between consecutive events of the same agent
  const agentIntervals = {};
  const sorted = [...events].filter(e => e.ts).sort((a, b) => a.ts.localeCompare(b.ts));
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].ts) - new Date(sorted[i - 1].ts);
    const agent = sorted[i].agent || 'unknown';
    if (!agentIntervals[agent]) agentIntervals[agent] = [];
    agentIntervals[agent].push(gap);
  }

  // Slow-agent detection: flag agents whose avg interval exceeds 3 minutes
  const slowAgents = [];
  Object.entries(agentIntervals).forEach(([agent, intervals]) => {
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avg > 180000) slowAgents.push({ agent, avg_interval_ms: Math.round(avg), avg_human: _msToHuman(avg) });
  });
  if (slowAgents.length) timing.slow_agents = slowAgents;

  // Wave timing from wave_complete events (have context.duration_ms when wired)
  const waveEvents = events.filter(e => e.category === 'wave_complete');
  if (waveEvents.length) {
    timing.waves = waveEvents.map(e => ({
      description: e.description,
      duration_ms: e.context && e.context.duration_ms ? e.context.duration_ms : null,
    }));
  }

  timing.token_data_available = events.some(e => e.context && (e.context.input_tokens || 0) > 0);

  // P-1403 (v3.7.3): autonomous-overhead metrics. Useful as a trend signal —
  // are autonomous runs getting cheaper/faster as patterns saturate? Caller
  // can pass commitCount + costUsd via sessionMeta.commit_count /
  // sessionMeta.cost_usd (read from harvest.json + claude-cli result JSON).
  // When unavailable, fields are null (don't lie about absent data).
  const overhead = {};
  const commitCount = sessionMeta && typeof sessionMeta.commit_count === 'number'
    ? sessionMeta.commit_count
    : null;
  const costUsd = sessionMeta && typeof sessionMeta.cost_usd === 'number'
    ? sessionMeta.cost_usd
    : null;
  const durationMs = timing.session_duration_ms || null;

  if (commitCount != null && durationMs) {
    overhead.commits_per_minute = Math.round((commitCount / (durationMs / 60000)) * 100) / 100;
    overhead.minutes_per_commit = Math.round((durationMs / 60000 / commitCount) * 100) / 100;
  }
  if (costUsd != null && commitCount != null && commitCount > 0) {
    overhead.cost_usd_per_commit = Math.round((costUsd / commitCount) * 100) / 100;
  }
  if (costUsd != null) overhead.total_cost_usd = costUsd;
  if (commitCount != null) overhead.commit_count = commitCount;

  return {
    summary: {
      total_events: events.length,
      errors: errors.length,
      gaps: gaps.length,
      redundancies: redundancies.length,
      decisions: decisions.length,
      corrections: corrections.length,
      memory_misses: memoryMisses.length,
      wasted_tokens: wastedTokens,
      reviewer_corrections: reviewerCorrections.length,
      memory_primed_count: memoryPrimed.length,
      tool_errors: toolPatterns.reduce((n, p) => n + p.occurrences, 0),
      tool_error_patterns: toolPatterns.length,
      spawns_measured: measuredSpawns.length,
      spawns_with_tool_errors: measuredSpawns.filter(e => e.context.tool_errors > 0).length,
      verdict_failures: Object.values(verdicts).reduce((n, s) => n + s.fail, 0),
      verdict_retries: Object.values(verdicts).reduce((n, s) => n + s.retries, 0),
      total_input_tokens: tokenTotals.input,
      total_output_tokens: tokenTotals.output,
      total_cache_read_tokens: tokenTotals.cache_read,
      total_tokens: tokenTotals.input + tokenTotals.output,
    },
    timing,
    overhead,
    error_patterns: frequencyMap(errors),
    tool_error_patterns: toolPatterns,
    verdict_stats: verdicts,
    gap_patterns: frequencyMap(gaps),
    memory_miss_patterns: frequencyMap(memoryMisses),
    agent_stats: agentStats,
    critical_events: events.filter(e => e.impact === 'critical'),
    major_events: events.filter(e => e.impact === 'major'),
  };
}

function _msToHuman(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

function generateLocalReport(cwd, sessionId) {
  const session = readTraceSession(cwd, sessionId);
  if (session.error) return session;

  // Fold measured cost + commit count into the metadata before analysis so the
  // autonomous-overhead metrics populate even for hook-driven auto-sessions that
  // never call `optimize trace end`. Only fill fields a producer didn't set.
  const metadata = session.metadata || {};
  if (typeof metadata.cost_usd !== 'number' || typeof metadata.commit_count !== 'number') {
    const cc = computeSessionCostAndCommits(cwd, metadata);
    if (typeof metadata.cost_usd !== 'number' && cc.cost_usd != null) metadata.cost_usd = cc.cost_usd;
    if (typeof metadata.commit_count !== 'number' && cc.commit_count != null) metadata.commit_count = cc.commit_count;
  }

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    metadata,
    ...analyzeEvents(session.events, metadata),
    raw_events: session.events,
  };
}

// ─── Report storage + parsing ─────────────────────────────────────────────────

function listOptimizationReports(cwd) {
  try {
    const reportsDir = getReportsDir(cwd);
    try { fs.accessSync(reportsDir); } catch { return { reports: [], count: 0 }; }

    const reports = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.md') || f.endsWith('.json'))
      .map(f => {
        const p = path.join(reportsDir, f);
        let stat;
        try { stat = fs.statSync(p); } catch { return null; }
        return { filename: f, path: p, size: stat.size, created_at: stat.birthtime.toISOString() };
      })
      .filter(Boolean)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return { reports, count: reports.length };
  } catch (e) {
    return { error: e.message || 'report_write_failed' };
  }
}

// Extracts the JSON block from the "## Auto-Apply Actions" section of an
// optimizer markdown report.
function parseAutoApplyBlock(reportContent) {
  const match = reportContent.match(/##\s+Auto-Apply Actions[\s\S]*?```json\n([\s\S]*?)```/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// ─── Apply recommendations ────────────────────────────────────────────────────

// Every apply is recorded so it can be undone exactly (evidence loop EL-11, spec D10).
// A memory entry is read by every agent in every later run, so a bad one degrades
// all of them; before these records an append could not even be located afterwards,
// and running the same report twice appended everything twice.

function sha256Hex(s) {
  return require('crypto').createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Hash of a file's content with its line endings normalised: a CRLF checkout of the same bytes matches. */
function normalisedHash(text) {
  return sha256Hex(String(text).replace(/\r\n/g, '\n'));
}

/** One action's identity, from what the report asked for (not from the text written, which carries a timestamp). */
function actionSig(action) {
  return sha256Hex([action.type, action.path || action.target || '', action.description || '', action.content || action.suggestion || ''].join('\u0000')).slice(0, 16);
}

function newApplyId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `apl_${stamp}_${require('crypto').randomBytes(2).toString('hex')}`;
}

/** Rows of optimization/applied.jsonl in order; legacy rows (before apply records) have no `kind`. */
function readApplyLog(cwd) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(getOptimizeDir(cwd), APPLIED_LOG), 'utf-8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is skipped */ }
  }
  return rows;
}

/** apply_id → Set of reverted action indices. */
function revertedIndices(rows) {
  const out = new Map();
  for (const r of rows) {
    if (r.kind !== 'revert' || !r.apply_id) continue;
    if (!out.has(r.apply_id)) out.set(r.apply_id, new Set());
    for (const i of r.reverted || []) out.get(r.apply_id).add(i);
  }
  return out;
}

/** The trace session a report belongs to, from its name (`<session>-opt-report.md`, `<session>-analysis.json`). */
function reportSessionId(reportPath) {
  const m = path.basename(String(reportPath || '')).match(/^(.+?)-(?:opt-report\.md|analysis\.json)$/);
  return m ? m[1] : null;
}

/**
 * A legacy `memory` / `memory_append` action writes the file it names. Since O4,
 * memory loads only from agent logs with a `## Entries` list, so a topic file there
 * is written but never injected: say so in the result rather than let the apply
 * look like it taught anyone anything.
 */
function notLoadedWarning(cwd, relPath) {
  const abs = path.resolve(cwd, relPath || '');
  if (path.dirname(abs) !== path.resolve(planningPath(cwd), 'memory')) return {};
  let text = '';
  try { text = fs.readFileSync(abs, 'utf-8'); } catch { return {}; }
  if (/^##\s+Entries\s*$/m.test(text) && !require('./memory.cjs').RESERVED_MEMORY_NAMES.includes(path.basename(abs, '.md').toLowerCase())) return {};
  return { warning: 'not loaded as memory: memory loads only agent logs with a `## Entries` list (O4). Propose a memory_entry, which `memory record` checks, instead' };
}

function applyReportRecommendations(cwd, reportPath) {
  let reportContent;
  try {
    reportContent = fs.readFileSync(reportPath, 'utf-8');
  } catch (e) {
    return { error: `Cannot read report: ${e.message}` };
  }

  // Support both markdown reports (with auto-apply block) and JSON analysis files
  let actions = parseAutoApplyBlock(reportContent);
  if (!actions) {
    // Try parsing as raw JSON analysis — generate basic memory entries from memory_miss patterns
    try {
      const analysis = JSON.parse(reportContent);
      actions = deriveActionsFromAnalysis(analysis);
    } catch {
      return { applied: [], skipped: [], note: 'No auto-apply actions found in report' };
    }
  }

  if (!Array.isArray(actions)) {
    return { applied: [], skipped: [], note: 'Auto-apply block is not a valid array' };
  }

  // Actions an earlier apply wrote and nobody reverted: applying them again would
  // append the same text a second time.
  const log = readApplyLog(cwd);
  const reverted = revertedIndices(log);
  const live = new Map();
  for (const r of log) {
    if (r.kind !== 'apply' || !Array.isArray(r.actions)) continue;
    const undone = reverted.get(r.apply_id) || new Set();
    for (const a of r.actions) if (a.action_sig && !undone.has(a.i)) live.set(a.action_sig, r.apply_id);
  }

  const applyId = newApplyId();
  const applied = [];
  const skipped = [];
  const records = [];
  const rel = (abs) => toPosixRel(cwd, abs);
  const appendRecorded = (abs, text, action, i) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, text, 'utf-8');
    records.push({ i, type: action.type, path: rel(abs), kind: 'appended', text, sha256_after: normalisedHash(fs.readFileSync(abs, 'utf-8')), action_sig: actionSig(action) });
  };

  const resolvedCwd = path.resolve(cwd);
  actions.forEach((action, i) => {
    try {
      // Containment: action.path on memory writes is report/agent-authored and
      // must stay inside the project. A `../` (or absolute) path otherwise
      // escapes and writes anywhere the process can (M23, ADR audit 2026-08).
      if (action.type === 'memory' || action.type === 'memory_append') {
        const abs = path.resolve(cwd, action.path || '');
        if (abs !== resolvedCwd && !abs.startsWith(resolvedCwd + path.sep)) {
          skipped.push({ action, reason: 'path escapes project root — skipped' });
          return;
        }
      }
      const earlier = live.get(actionSig(action));
      if (earlier) {
        skipped.push({ action, reason: `already applied in ${earlier} — skipped (revert that apply to apply it again)` });
        return;
      }
      if (action.type === 'memory') {
        // Write new memory entry (skip if file exists to avoid overwriting manual edits)
        const memPath = path.join(cwd, action.path);
        try {
          fs.accessSync(memPath);
          skipped.push({ action, reason: 'File already exists — skipped to preserve manual edits' });
        } catch {
          fs.mkdirSync(path.dirname(memPath), { recursive: true });
          fs.writeFileSync(memPath, action.content, 'utf-8');
          records.push({ i, type: action.type, path: rel(memPath), kind: 'created', sha256_after: normalisedHash(fs.readFileSync(memPath, 'utf-8')), action_sig: actionSig(action) });
          applied.push({ action, result: `Written to ${action.path}`, ...notLoadedWarning(cwd, action.path) });
        }
      } else if (action.type === 'memory_append') {
        appendRecorded(path.join(cwd, action.path), '\n' + action.content, action, i);
        applied.push({ action, result: `Appended to ${action.path}`, ...notLoadedWarning(cwd, action.path) });
      } else if (action.type === 'memory_entry') {
        // The gated write path (O6): a lesson the optimizer drew from this report's
        // trace session, recorded only if it carries citations that hold and passes
        // `memory record`'s other rules. Recorded as created/appended so revert works.
        const session = reportSessionId(reportPath);
        if (!session) { skipped.push({ action, reason: 'a memory entry needs the trace session the report came from, and this report\'s name does not carry one' }); return; }
        const { recordLesson } = require('./memory.cjs');
        const logPath = path.join(planningPath(cwd), 'memory', `${String(action.agent || '')}.md`);
        let before = null;
        try { before = fs.readFileSync(logPath, 'utf-8'); } catch { /* a new log */ }
        const r = recordLesson(cwd, String(action.agent || ''), { lesson: action.lesson, trace: session, cites: action.cites });
        if (r.error || !r.recorded) { skipped.push({ action, reason: r.error || `memory record refused it: ${r.reason}` }); return; }
        const after = fs.readFileSync(logPath, 'utf-8');
        records.push(before === null
          ? { i, type: action.type, path: rel(logPath), kind: 'created', sha256_after: normalisedHash(after), action_sig: actionSig(action) }
          : { i, type: action.type, path: rel(logPath), kind: 'appended', text: toLf(after).slice(toLf(before).length), sha256_after: normalisedHash(after), action_sig: actionSig(action) });
        applied.push({ action, result: `Recorded for ${r.agent} from ${r.evidence}` });
      } else if (action.type === 'note') {
        // Write a human-readable suggestion note
        const entry = `\n## ${new Date().toISOString()}: ${action.description || 'Suggestion'}\n\n${action.content || action.suggestion || ''}\n\n**Target:** ${action.target || 'unspecified'}\n`;
        appendRecorded(path.join(getOptimizeDir(cwd), 'suggestions.md'), entry, action, i);
        applied.push({ action, result: 'Suggestion written to optimization/suggestions.md' });
      } else if (action.type === 'planning_note') {
        // Write optimization note into .planning/optimization/config-suggestions.md
        const entry = `\n## ${new Date().toISOString()}\n${action.content}\n`;
        appendRecorded(path.join(getOptimizeDir(cwd), 'config-suggestions.md'), entry, action, i);
        applied.push({ action, result: 'Config suggestion recorded' });
      } else {
        skipped.push({ action, reason: `Unknown action type: ${action.type}` });
      }
    } catch (e) {
      skipped.push({ action, reason: e.message });
    }
  });

  // Log what was applied: the counts for cumulative stats, the actions for revert.
  try {
    const logEntry = {
      ts: new Date().toISOString(),
      kind: 'apply',
      apply_id: applyId,
      report: path.basename(reportPath),
      applied_count: applied.length,
      skipped_count: skipped.length,
      applied_types: applied.map(a => a.action.type),
      actions: records,
    };
    fs.mkdirSync(getOptimizeDir(cwd), { recursive: true });
    fs.appendFileSync(path.join(getOptimizeDir(cwd), APPLIED_LOG), JSON.stringify(logEntry) + '\n');
  } catch {}

  return { apply_id: applyId, applied, skipped };
}

function toPosixRel(cwd, abs) {
  return path.relative(path.resolve(cwd), abs).split(path.sep).join('/');
}

/**
 * Undo one apply: delete the files it created, cut the text it appended.
 *
 * It refuses, and says why, whenever undoing could destroy someone's work:
 *   - a file whose content changed since the apply (the hash ignores line
 *     endings, so a CRLF checkout of the same bytes still matches);
 *   - a file a LATER unreverted apply also wrote. Reverts go last-in, first-out
 *     per file, so an earlier append is never cut from under a later one.
 * A CRLF file is written back CRLF. Legacy log rows (before apply records) cannot
 * be reverted and are reported as such.
 *
 * @param {string} cwd
 * @param {string} which - an apply_id, or 'last'
 */
function revertApply(cwd, which) {
  const rows = readApplyLog(cwd);
  const reverted = revertedIndices(rows);
  const applies = rows.map((r, seq) => ({ r, seq })).filter(({ r }) => r.kind === 'apply' || !r.kind);
  let target;
  if (which === 'last') {
    target = [...applies].reverse().find(({ r }) => r.kind !== 'apply' || (r.actions || []).some((a) => !(reverted.get(r.apply_id) || new Set()).has(a.i)));
    if (!target) return { error: 'nothing_applied', reason: 'no apply with anything left to revert' };
  } else {
    target = applies.find(({ r }) => r.apply_id === which);
    if (!target) return { error: 'unknown_apply', reason: `no apply ${which} in optimization/${APPLIED_LOG}` };
  }
  const { r: apply, seq } = target;
  if (apply.kind !== 'apply' || !Array.isArray(apply.actions)) {
    return { error: 'not_revertible', reason: `the apply of ${apply.report || 'that report'} at ${apply.ts || 'an unknown time'} predates apply records, so what it wrote cannot be located` };
  }
  const done = reverted.get(apply.apply_id) || new Set();
  const pending = apply.actions.filter((a) => !done.has(a.i));
  if (!pending.length) return { apply_id: apply.apply_id, reverted: [], refused: [], status: 'nothing_to_revert' };

  const resolvedCwd = path.resolve(cwd);
  const laterOwner = (p) => {
    for (const { r, seq: s } of applies) {
      if (s <= seq || r.kind !== 'apply' || !Array.isArray(r.actions)) continue;
      const undone = reverted.get(r.apply_id) || new Set();
      if (r.actions.some((a) => a.path === p && !undone.has(a.i))) return r.apply_id;
    }
    return null;
  };

  const out = [];
  const refused = [];
  for (const a of [...pending].sort((x, y) => y.i - x.i)) {
    const abs = path.resolve(cwd, a.path || '');
    if (!a.path || (abs !== resolvedCwd && !abs.startsWith(resolvedCwd + path.sep))) { refused.push({ i: a.i, path: a.path, reason: 'path outside the project' }); continue; }
    const later = laterOwner(a.path);
    if (later) { refused.push({ i: a.i, path: a.path, reason: `a later apply (${later}) also changed this file; revert it first` }); continue; }
    let raw;
    try { raw = fs.readFileSync(abs, 'utf-8'); } catch { refused.push({ i: a.i, path: a.path, reason: 'the file is gone' }); continue; }
    if (normalisedHash(raw) !== a.sha256_after) { refused.push({ i: a.i, path: a.path, reason: 'the file changed since the apply (edited by hand?)' }); continue; }
    try {
      if (a.kind === 'created') {
        fs.unlinkSync(abs);
      } else {
        const crlf = raw.includes('\r\n');
        const norm = raw.replace(/\r\n/g, '\n');
        const text = String(a.text || '').replace(/\r\n/g, '\n');
        if (!text || !norm.endsWith(text)) { refused.push({ i: a.i, path: a.path, reason: 'the appended text is not at the end of the file' }); continue; }
        const kept = norm.slice(0, norm.length - text.length);
        fs.writeFileSync(abs, crlf ? kept.replace(/\n/g, '\r\n') : kept, 'utf-8');
      }
      out.push(a.i);
    } catch (e) {
      refused.push({ i: a.i, path: a.path, reason: e.message });
    }
  }
  if (out.length || refused.length) {
    try {
      fs.appendFileSync(path.join(getOptimizeDir(cwd), APPLIED_LOG), JSON.stringify({ ts: new Date().toISOString(), kind: 'revert', apply_id: apply.apply_id, reverted: out, refused }) + '\n');
    } catch {}
  }
  const remaining = pending.length - out.length;
  return { apply_id: apply.apply_id, reverted: out.sort((x, y) => x - y), refused, status: remaining === 0 ? 'reverted' : (out.length ? 'partial' : 'refused') };
}

// Derive basic memory actions from a raw JSON analysis when no optimizer agent
// report is available (fallback for /pan:optimize apply on a JSON file).
function deriveActionsFromAnalysis(analysis) {
  const actions = [];
  const { memory_miss_patterns, gap_patterns, summary } = analysis;

  if (summary && summary.memory_misses > 0 && memory_miss_patterns) {
    memory_miss_patterns.slice(0, 3).forEach(p => {
      actions.push({
        type: 'note',
        description: `Memory miss: ${p.pattern}`,
        content: `This topic was missing from memory ${p.count} time(s) during the traced session. Consider adding a memory entry for it.`,
        target: '.planning/memory/',
      });
    });
  }

  // A failure becomes a suggestion only once it recurs across spawns: one run's
  // accident (a TDD red step, a grep with no match) is not a lesson.
  const recurring = (analysis.tool_error_patterns || []).filter(p => p.spawns >= 2).slice(0, 3);
  recurring.forEach(p => {
    actions.push({
      type: 'note',
      description: `Recurring tool failure: ${p.agent} ${p.tool} (${p.error_class})`,
      content: `${p.agent}'s ${p.tool} call failed with "${p.message}" in ${p.spawns} spawns across ${p.sessions} session(s) (${p.occurrences} times in all). Record the working form of the call, or the precondition it needs, as a memory entry for ${p.agent}.`,
      target: '.planning/memory/',
    });
  });
  Object.entries(analysis.verdict_stats || {}).filter(([, s]) => s.fail >= 2).forEach(([agent, s]) => {
    actions.push({
      type: 'note',
      description: `Repeated judge failures: ${agent}`,
      content: `${agent} failed ${s.fail} time(s) (${s.retries} retr${s.retries === 1 ? 'y' : 'ies'}, ${s.resolved_by_retry} resolved by the retry). Read the recorded findings (\`pan-tools findings list --agent ${agent}\`) for the class that keeps recurring before the next phase.`,
      target: '.planning/memory/',
    });
  });

  if (gap_patterns && gap_patterns.length > 0) {
    gap_patterns.slice(0, 3).forEach(p => {
      actions.push({
        type: 'note',
        description: `Knowledge gap: ${p.pattern}`,
        content: `The agent had to infer this ${p.count} time(s). Research and cache the answer.`,
        target: '.planning/memory/',
      });
    });
  }

  return actions;
}

// ─── Cumulative stats ─────────────────────────────────────────────────────────

function getOptimizeStats(cwd) {
  try {
    const sessions = listTraceSessions(cwd);
    const reports = listOptimizationReports(cwd);

    let totalEvents = 0;
    let totalErrors = 0;
    sessions.sessions && sessions.sessions.forEach(s => {
      totalEvents += s.event_count || 0;
      if (s.type_counts) totalErrors += s.type_counts.error || 0;
    });

    let totalApplied = 0;
    let totalSkipped = 0;
    let applyRuns = 0;
    let lastApplyId = null;
    const revertedRuns = new Set();
    try {
      const raw = fs.readFileSync(path.join(getOptimizeDir(cwd), APPLIED_LOG), 'utf-8');
      raw.trim().split('\n').filter(Boolean).forEach(line => {
        try {
          const e = JSON.parse(line);
          if (e.kind === 'revert') { if (e.apply_id && (e.reverted || []).length) revertedRuns.add(e.apply_id); return; }
          totalApplied += e.applied_count || 0;
          totalSkipped += e.skipped_count || 0;
          applyRuns++;
          if (e.apply_id) lastApplyId = e.apply_id;
        } catch {}
      });
    } catch {}

    return {
      trace_sessions: sessions.count || 0,
      optimization_reports: reports.count || 0,
      total_events_traced: totalEvents,
      total_errors_traced: totalErrors,
      total_optimizations_applied: totalApplied,
      total_skipped: totalSkipped,
      apply_runs: applyRuns,
      reverted_runs: revertedRuns.size,
      last_apply_id: lastApplyId,
      current_session: getCurrentSessionId(cwd),
    };
  } catch (e) {
    return { error: e.message || 'apply_failed' };
  }
}

// ─── CLI commands ─────────────────────────────────────────────────────────────

function cmdOptimizeTrace(cwd, sub, opts, raw) {
  if (sub === 'init') {
    output(initTraceSession(cwd, opts), raw);
  } else if (sub === 'log') {
    const logged = logTraceEvent(cwd, opts);
    output({ logged, session: getCurrentSessionId(cwd) }, raw);
  } else if (sub === 'end') {
    output(endTraceSession(cwd, opts.sessionId), raw);
  } else if (sub === 'current') {
    const sessionId = getCurrentSessionId(cwd);
    output({ session_id: sessionId, active: !!sessionId }, raw);
  } else if (sub === 'list') {
    output(listTraceSessions(cwd), raw);
  } else if (sub === 'show') {
    if (!opts.sessionId) { output({ error: 'Session ID required (--session <id>)' }, raw); return; }
    output(readTraceSession(cwd, opts.sessionId), raw);
  } else if (sub === 'reconcile') {
    // Rewrite session.json counters from trace.jsonl without ending the session,
    // so hook-driven auto-sessions that never call `end` still report real numbers.
    output(opts.all ? reconcileAllTraceSessions(cwd) : reconcileTraceSession(cwd, opts.sessionId), raw);
  } else {
    output({ error: 'Unknown trace subcommand. Available: init, log, end, current, list, show, reconcile' }, raw);
  }
}

/**
 * The last `n` trace sessions, newest last, by start time (the session id's own
 * date order when a session never recorded one).
 */
function recentSessionIds(cwd, n) {
  let dirs = [];
  try { dirs = fs.readdirSync(getTracesDir(cwd), { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('sess_')).map(e => e.name); } catch { return []; }
  const started = (sid) => {
    try { return JSON.parse(fs.readFileSync(path.join(getTracesDir(cwd), sid, OPT_SESSION_FILE), 'utf-8')).started_at || ''; } catch { return ''; }
  };
  return dirs.map(sid => ({ sid, at: started(sid) }))
    .sort((a, b) => (a.at || a.sid).localeCompare(b.at || b.sid))
    .slice(-n)
    .map(x => x.sid);
}

/**
 * One analysis over several sessions (`optimize learn --sessions <n>`): a
 * recommendation should explain failures that recur across runs, not one run's
 * accident.
 */
function generatePooledReport(cwd, sessionIds) {
  const events = [];
  const starts = [];
  const ends = [];
  for (const sid of sessionIds) {
    const s = readTraceSession(cwd, sid);
    if (s.error) continue;
    events.push(...s.events);
    if (s.metadata && s.metadata.started_at) starts.push(s.metadata.started_at);
    if (s.metadata && s.metadata.ended_at) ends.push(s.metadata.ended_at);
  }
  const metadata = {
    pooled_sessions: sessionIds,
    started_at: starts.length ? starts.sort()[0] : undefined,
    ended_at: ends.length ? ends.sort()[ends.length - 1] : undefined,
  };
  return {
    session_id: sessionIds[sessionIds.length - 1],
    pooled_sessions: sessionIds,
    generated_at: new Date().toISOString(),
    metadata,
    ...analyzeEvents(events, metadata),
    raw_events: events,
  };
}

function cmdOptimizeLearn(cwd, opts, raw) {
  const pool = opts.sessions == null ? null : Number(opts.sessions);
  if (pool !== null && (!Number.isInteger(pool) || pool < 1)) {
    output({ error: '--sessions must be a whole number of sessions (1 or more)' }, raw);
    return;
  }
  let report;
  let reportName;
  if (pool !== null && pool > 1) {
    const ids = recentSessionIds(cwd, pool);
    if (!ids.length) { output({ error: 'No trace sessions to pool. Sessions appear once a PAN command has run.' }, raw); return; }
    report = generatePooledReport(cwd, ids);
    reportName = `pooled-${ids.length}-${ids[ids.length - 1]}-analysis.json`;
  } else {
    const sessionId = opts.sessionId || getCurrentSessionId(cwd);
    if (!sessionId) {
      output({ error: 'No trace session active. Start one with: pan-tools optimize trace init' }, raw);
      return;
    }
    report = generateLocalReport(cwd, sessionId);
    if (report.error) { output(report, raw); return; }
    reportName = `${sessionId}-analysis.json`;
  }
  const sessionId = report.session_id;

  // Persist as JSON analysis for the optimizer agent to read
  const reportsDir = getReportsDir(cwd);
  try { fs.mkdirSync(reportsDir, { recursive: true }); } catch {}
  const reportPath = path.join(reportsDir, reportName);
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  } catch (e) {
    output({ error: `Failed to write analysis: ${e.message}` }, raw);
    return;
  }

  output({
    session_id: sessionId,
    analysis_path: planningRel(OPTIMIZE_DIR, OPT_REPORTS_DIR, reportName),
    ...(report.pooled_sessions ? { pooled_sessions: report.pooled_sessions } : {}),
    summary: report.summary,
    top_error_patterns: report.error_patterns.slice(0, 5),
    top_tool_error_patterns: report.tool_error_patterns.slice(0, 5),
    verdict_stats: report.verdict_stats,
    top_gap_patterns: report.gap_patterns.slice(0, 5),
    top_memory_misses: report.memory_miss_patterns.slice(0, 5),
    agent_stats: report.agent_stats,
    next_step: 'Invoke pan-optimizer agent to generate optimization report from this analysis',
  }, raw);
}

function cmdOptimizeApply(cwd, opts, raw) {
  const reports = listOptimizationReports(cwd);
  if (reports.error || reports.count === 0) {
    output({ error: 'No optimization reports found. Run /pan:learn first.' }, raw);
    return;
  }

  const reportPath = opts.reportPath || reports.reports[0].path;
  const result = applyReportRecommendations(cwd, reportPath);
  output({ report: path.basename(reportPath), ...result }, raw);
}

function cmdOptimizeRevert(cwd, opts, raw) {
  const which = opts.last ? 'last' : opts.applyId;
  if (!which) { output({ error: 'Usage: optimize revert <apply_id> | --last' }, raw); return; }
  const r = revertApply(cwd, which);
  output(r, raw, r.error ? undefined : r.status);
}

function cmdOptimizeStats(cwd, raw) {
  output(getOptimizeStats(cwd), raw);
}

function cmdOptimizeList(cwd, raw) {
  output(listOptimizationReports(cwd), raw);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

// ─── W4: Promote (self-improvement loop) ──────────────────────────────────────
//
// Spec: docs/specs/self_improvement_loop_featureai.md §3.2 W4
//
// Promote a finding from a harvested experiment into the shipped behavioral
// surface. Two scopes:
//   - universal: ships to all 5 runtime installs (consumed by user-project workflows)
//   - internal:  source-only (consumed when working on PAN itself)
//
// Each topic file is markdown with YAML frontmatter listing its pattern IDs.
// The promote step is manual — the human running pan-tools picks scope/topic.
// Auto-promote (rules-based, AI-confidence threshold) is deferred to v3.8+.

const VALID_SCOPES = ['universal', 'internal'];
// Topic name: lowercase, digits, hyphens; max 40 chars; no leading/trailing hyphen.
// Same rules as experiment slug (intentional — symmetric naming).
const TOPIC_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function getLearningsDir(sourceRoot, scope) {
  return path.join(sourceRoot, 'pan-wizard-core', 'learnings', scope);
}

function getTopicFilePath(sourceRoot, scope, topic) {
  return path.join(getLearningsDir(sourceRoot, scope), `${topic}.md`);
}

function validatePromoteInputs(pattern, opts) {
  if (!opts || typeof opts !== 'object') return 'opts is required';
  if (!VALID_SCOPES.includes(opts.scope)) {
    return `scope must be one of: ${VALID_SCOPES.join(', ')}, got "${opts.scope}"`;
  }
  if (typeof opts.topic !== 'string' || !TOPIC_RE.test(opts.topic)) {
    return 'topic invalid: must be lowercase letters, digits, hyphens (no path separators or leading/trailing hyphen)';
  }
  if (!opts.sourceRoot) return 'sourceRoot is required';
  if (!pattern || typeof pattern !== 'object') return 'pattern is required';
  if (!pattern.id) return 'pattern.id is required';
  if (!pattern.summary) return 'pattern.summary is required';
  if (!pattern.rule) return 'pattern.rule is required';
  // A citation names the code the pattern rests on, relative to the tree that
  // holds the store; it must hold now, and learn lint L-007 keeps checking it.
  if (pattern.cites !== undefined && !Array.isArray(pattern.cites)) return 'pattern.cites must be a list';
  const { citationProblem } = require('./memory.cjs');
  for (const c of pattern.cites || []) {
    const problem = citationProblem(opts.sourceRoot, c);
    if (problem) return `citation ${c}: ${problem}`;
  }
  return null;
}

/**
 * Classify whether a pattern looks STRUCTURAL (generalizes across models /
 * languages / runtimes) or PROMPT-FRAGMENT (specific phrasing that doesn't
 * generalize). Per P-RES-007 (Sakana DGM, 2025): structural changes
 * transferred across models in self-improvement loops; prompt-fragment
 * tweaks did not. Universal scope should be reserved for structural
 * patterns; prompt fragments belong in internal scope at most.
 *
 * This is HEURISTIC. Returns { kind: 'structural'|'prompt-fragment'|'unclear',
 * reasons: [...] } — never definitive. Used to surface a WARNING on
 * `learn promote --scope universal` so the human gate has a signal.
 *
 * @param {object} pattern - { rule, summary, ... }
 * @returns {object} { kind, reasons: string[] }
 */
function classifyPatternKind(pattern) {
  const rule = String(pattern.rule || '').toLowerCase();
  const summary = String(pattern.summary || '').toLowerCase();
  const combined = rule + ' ' + summary;
  const reasons = [];

  // Strong structural markers — describe SHAPES, contracts, file/module patterns
  const STRUCTURAL_RE = [
    /\b(pattern|structure|architecture|module|interface|contract|api|signature|schema|invariant)\b/,
    /\b(wrap|factor|compose|extract|encapsulate|inject)\b/,
    /\b(closure|callback|generator|stream|state\s+machine)\b/,
    /file:\/\/|\.md\b|\.cjs\b|\.js\b|\.ts\b/,
    /\b(workflow|step|phase|gate|hook)\b/,
  ];
  let structuralHits = 0;
  for (const re of STRUCTURAL_RE) {
    if (re.test(combined)) structuralHits++;
  }

  // Prompt-fragment markers — specific phrasing, "always say X", quoted strings.
  // Anchored carefully: "write" alone is too broad (matches "write to file"),
  // so we require co-occurrence with "the words"/"exact"/quoted text.
  const PROMPT_RE = [
    /\b(say|write)\s+(the\s+exact|the\s+words?|"|')/,
    /\buse\s+the\s+(exact|words?)\b/,
    /\b(prepend|prefix\s+with)\b/,
    /\balways\s+include\b/,
    /\bnever\s+say\b/,
    /\bphras(e|ing)\b/,
  ];
  let promptHits = 0;
  for (const re of PROMPT_RE) {
    if (re.test(combined)) promptHits++;
  }

  // Length heuristic — structural patterns need elaboration; very short rules are
  // either trivial or prompt fragments.
  const ruleLen = (pattern.rule || '').length;

  if (structuralHits >= 2 && promptHits === 0) {
    reasons.push(`structural markers: ${structuralHits} hit(s)`);
    return { kind: 'structural', reasons };
  }
  if (promptHits >= 1 && structuralHits < 2) {
    reasons.push(`prompt-fragment markers: ${promptHits} hit(s)`);
    if (ruleLen < 200) reasons.push(`short rule (${ruleLen} chars) — typical of prompt tweaks`);
    return { kind: 'prompt-fragment', reasons };
  }
  if (ruleLen < 100) {
    reasons.push(`very short rule (${ruleLen} chars) — likely too narrow to generalize`);
    return { kind: 'prompt-fragment', reasons };
  }
  reasons.push('no clear signal either way');
  return { kind: 'unclear', reasons };
}

/**
 * Parse a topic file: returns { frontmatter, body, patterns }.
 * frontmatter is the parsed YAML-ish (we use a minimal parser since files are
 * always written by us — no general YAML dependency needed).
 */
function readTopicFile(filePath) {
  // LF: an install committed with core.autocrlf=true holds these files as CRLF.
  const content = toLf(fs.readFileSync(filePath, 'utf-8'));
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: { topic: '', patterns: [] }, body: content, _raw: content };
  }
  const fmText = fmMatch[1];
  const body = fmMatch[2];
  const fm = parseSimpleFrontmatter(fmText);
  return { frontmatter: fm, body, _raw: content };
}

/**
 * Parse our own structured frontmatter shape:
 *   topic: <name>
 *   last_updated: <ISO>
 *   patterns:
 *     - id: P-001
 *       summary: ...
 *       promoted_at: ...
 *       source_experiments: [a, b]
 */
function parseSimpleFrontmatter(text) {
  const out = { topic: '', last_updated: '', patterns: [] };
  const lines = text.split('\n');
  let inPatterns = false;
  let current = null;
  for (const line of lines) {
    if (line === 'patterns:') { inPatterns = true; continue; }
    if (!inPatterns) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
      continue;
    }
    // Inside patterns
    if (line.startsWith('  - id:')) {
      if (current) out.patterns.push(current);
      current = { id: line.replace(/^\s*- id:\s*/, '').trim() };
    } else if (current) {
      const m = line.match(/^\s+([a-z_]+):\s*(.*)$/);
      if (m) {
        const key = m[1];
        let val = m[2].trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
        current[key] = val;
      }
    }
  }
  if (current) out.patterns.push(current);
  return out;
}

function serializeTopicFile(topic, patterns, body) {
  const ts = new Date().toISOString();
  let fm = `topic: ${topic}\nlast_updated: ${ts}\n`;
  fm += `patterns:\n`;
  for (const p of patterns) {
    fm += `  - id: ${p.id}\n`;
    fm += `    summary: ${(p.summary || '').replace(/\n/g, ' ')}\n`;
    fm += `    promoted_at: ${p.promoted_at || ts}\n`;
    const srcExps = Array.isArray(p.source_experiments) ? p.source_experiments : [];
    fm += `    source_experiments: [${srcExps.join(', ')}]\n`;
    // Optional fields survive a re-serialisation: promoting into an existing topic
    // rewrites every pattern's frontmatter, and dropping these lost the supersession
    // learn lint L-005 reads, and the citations L-007 checks.
    const cites = Array.isArray(p.cites) ? p.cites : [];
    if (cites.length) fm += `    cites: [${cites.join(', ')}]\n`;
    if (p.superseded_by) fm += `    superseded_by: ${p.superseded_by}\n`;
    if (p.superseded_id) fm += `    superseded_id: ${p.superseded_id}\n`;
  }
  return `---\n${fm}---\n${body}`;
}

function buildPatternBody(pattern) {
  const applies = pattern.applies_in || '';
  return [
    ``,
    `## ${pattern.id} — ${pattern.summary}`,
    ``,
    `**Evidence:** ${pattern.evidence || '(no evidence captured)'}`,
    ``,
    `**Rule:** ${pattern.rule}`,
    ``,
    applies ? `**Applies in:** ${applies}\n` : '',
  ].join('\n');
}

/**
 * Promote a pattern into a topic file under learnings/{scope}/{topic}.md.
 *
 * @param {object} pattern - { id, summary, evidence, rule, applies_in?, source_experiments? }
 * @param {object} opts
 * @param {string} opts.scope - 'universal' | 'internal'
 * @param {string} opts.topic - topic file name (no .md extension)
 * @param {string} opts.sourceRoot - PAN source repo root
 * @returns {object} { promoted_to, pattern_id, scope, topic } or { error }
 */
function promotePattern(pattern, opts) {
  const validationError = validatePromoteInputs(pattern, opts);
  if (validationError) return { error: validationError };

  const { scope, topic, sourceRoot } = opts;
  const learningsDir = getLearningsDir(sourceRoot, scope);

  // P-RES-007 gate: warn (don't block) when a pattern that looks like a
  // prompt fragment is being promoted to UNIVERSAL scope. Prompt fragments
  // don't generalize across models/runtimes per Sakana DGM (2025); they
  // should stay in internal scope. The check is HEURISTIC — final call is
  // still the human's. We attach the warning to the result object.
  let scopeWarning = null;
  if (scope === 'universal') {
    const classification = classifyPatternKind(pattern);
    if (classification.kind === 'prompt-fragment') {
      scopeWarning = {
        code: 'P-RES-007',
        kind: classification.kind,
        message: `Pattern looks like a prompt-fragment (specific phrasing) rather than a structural pattern. Per P-RES-007 (Sakana DGM, 2025), prompt tweaks don't generalize across models — universal scope should be reserved for structural changes. Consider --scope internal instead, or reword the rule to describe the SHAPE, not the WORDS.`,
        reasons: classification.reasons,
      };
    }
  }

  try {
    fs.mkdirSync(learningsDir, { recursive: true });
  } catch (err) {
    return { error: `failed to ensure learnings dir: ${err.message}` };
  }

  const filePath = getTopicFilePath(sourceRoot, scope, topic);
  const fileExists = fs.existsSync(filePath);

  let frontmatter, body;
  if (fileExists) {
    const parsed = readTopicFile(filePath);
    frontmatter = parsed.frontmatter;
    body = parsed.body;

    // Refuse duplicate pattern id
    if (frontmatter.patterns.some(p => p.id === pattern.id)) {
      return { error: `pattern "${pattern.id}" is already promoted in topic "${topic}"` };
    }
  } else {
    frontmatter = { topic, last_updated: '', patterns: [] };
    body = `\n# ${capitalize(topic.replace(/-/g, ' '))} (AI-derived)\n\n` +
           `> Auto-maintained by \`pan-tools learn promote\`. Each pattern was extracted ` +
           `from one or more experiment runs (see source_experiments). Patterns are ` +
           `**advisory** — orchestrators should weight them against current context.\n`;
  }

  // Append pattern to body
  body += buildPatternBody(pattern);

  // Append to frontmatter pattern list
  const promotedAt = new Date().toISOString();
  frontmatter.patterns.push({
    id: pattern.id,
    summary: pattern.summary,
    promoted_at: promotedAt,
    source_experiments: pattern.source_experiments || [],
    ...(pattern.cites && pattern.cites.length ? { cites: pattern.cites } : {}),
  });

  const serialized = serializeTopicFile(topic, frontmatter.patterns, body);

  try {
    fs.writeFileSync(filePath, serialized);
  } catch (err) {
    return { error: `failed to write topic file: ${err.message}` };
  }

  const result = {
    promoted_to: filePath,
    pattern_id: pattern.id,
    scope,
    topic,
    promoted_at: promotedAt,
  };
  if (scopeWarning) result.warning = scopeWarning;
  return result;
}

function capitalize(s) {
  return s.split(' ').map(w => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

/**
 * Walk both learnings tiers and return an inventory of all promoted patterns.
 *
 * @param {object} opts
 * @param {string} opts.sourceRoot
 * @returns {object} { universal: [...], internal: [...], total }
 */
function listPromotedPatterns(opts = {}) {
  const sourceRoot = opts.sourceRoot;
  if (!sourceRoot) return { error: 'sourceRoot is required' };

  const result = { universal: [], internal: [], total: 0 };
  for (const scope of VALID_SCOPES) {
    const dir = getLearningsDir(sourceRoot, scope);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const parsed = readTopicFile(filePath);
        const topicName = file.replace(/\.md$/, '');
        for (const p of parsed.frontmatter.patterns) {
          result[scope].push({
            id: p.id,
            summary: p.summary,
            scope,
            topic: topicName,
            promoted_at: p.promoted_at,
            source_experiments: p.source_experiments || [],
          });
        }
      } catch {
        // Skip malformed files
      }
    }
  }
  result.total = result.universal.length + result.internal.length;
  return result;
}

/**
 * Remove a previously-promoted pattern from a topic file. If the topic file
 * has no patterns left after removal, the file is deleted entirely.
 *
 * @param {string} patternId
 * @param {object} opts - { scope, topic, sourceRoot }
 */
function unpromotePattern(patternId, opts) {
  if (!opts || !VALID_SCOPES.includes(opts.scope)) {
    return { error: `scope must be one of: ${VALID_SCOPES.join(', ')}` };
  }
  if (!opts.topic || !TOPIC_RE.test(opts.topic)) {
    return { error: 'topic invalid' };
  }
  if (!opts.sourceRoot) return { error: 'sourceRoot is required' };
  if (!patternId) return { error: 'patternId is required' };

  const filePath = getTopicFilePath(opts.sourceRoot, opts.scope, opts.topic);
  if (!fs.existsSync(filePath)) {
    return { error: `topic file not found: ${opts.topic}` };
  }

  const parsed = readTopicFile(filePath);
  const before = parsed.frontmatter.patterns.length;
  parsed.frontmatter.patterns = parsed.frontmatter.patterns.filter(p => p.id !== patternId);
  if (parsed.frontmatter.patterns.length === before) {
    return { error: `pattern "${patternId}" not found in topic "${opts.topic}"` };
  }

  // Strip the pattern's body section. Pattern body is a `## P-<id> — ...` heading
  // followed by content until the next `## ` or end-of-file.
  const headingRe = new RegExp(
    `\\n## ${escapeRegex(patternId)}\\b[^\\n]*[\\s\\S]*?(?=\\n## |$)`,
    ''
  );
  const newBody = parsed.body.replace(headingRe, '');

  // If no patterns left, remove the topic file entirely
  if (parsed.frontmatter.patterns.length === 0) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      return { error: `failed to delete empty topic file: ${err.message}` };
    }
    return { removed: patternId, file_deleted: true };
  }

  const serialized = serializeTopicFile(opts.topic, parsed.frontmatter.patterns, newBody);
  try {
    fs.writeFileSync(filePath, serialized);
  } catch (err) {
    return { error: `failed to write topic file: ${err.message}` };
  }

  return { removed: patternId, file_deleted: false };
}

// ─── End W4 promote ──────────────────────────────────────────────────────────

module.exports = {
  // Session management
  initTraceSession,
  getCurrentSessionId,
  logTraceEvent,
  endTraceSession,
  readTraceSession,
  listTraceSessions,
  reconcileSessionMeta,
  reconcileTraceSession,
  reconcileAllTraceSessions,
  computeSessionCostAndCommits,
  // Analysis
  analyzeEvents,
  generateLocalReport,
  // Reports
  listOptimizationReports,
  parseAutoApplyBlock,
  applyReportRecommendations,
  deriveActionsFromAnalysis,
  // Stats
  getOptimizeStats,
  // Commands
  cmdOptimizeTrace,
  cmdOptimizeLearn,
  cmdOptimizeApply,
  cmdOptimizeRevert,
  revertApply,
  readApplyLog,
  cmdOptimizeStats,
  cmdOptimizeList,
  // Path helpers (used by hook)
  getOptimizeDir,
  getTracesDir,
  getReportsDir,
  // W4: Self-improvement loop promote
  promotePattern,
  listPromotedPatterns,
  unpromotePattern,
  classifyPatternKind,  // P-RES-007 (v3.7.10)
  // Constants (exported for hook + tests)
  OPTIMIZE_DIR,
  TRACES_DIR,
  OPT_REPORTS_DIR,
  APPLIED_LOG,
  TRACE_EVENT_FILE,
  OPT_SESSION_FILE,
  CURRENT_SESSION_FILE,
  autoSessionId,
  isSessionStale,
  SESSION_STALE_MS,
  EVENT_TYPES,
  IMPACT_LEVELS,
  VALID_SCOPES,
};
