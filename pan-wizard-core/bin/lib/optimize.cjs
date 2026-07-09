'use strict';
// optimize.cjs — Circular optimization loop: trace → learn → apply → repeat.
//
// Every agent spawn is logged to a trace session. After a build, /pan:learn
// invokes pan-optimizer to analyze the trace. /pan:optimize apply writes memory
// entries, config notes, and prompt suggestions back into the project, making
// the next run smarter.

const fs = require('fs');
const path = require('path');
const { output } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');

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
  return path.join(cwd, PLANNING_DIR, OPTIMIZE_DIR);
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
    return { error: e.message };
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

function logTraceEvent(cwd, event, sessionId) {
  const sid = sessionId || getCurrentSessionId(cwd);
  if (!sid) return false;

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

function endTraceSession(cwd, sessionId) {
  const sid = sessionId || getCurrentSessionId(cwd);
  if (!sid) return { error: 'No active session' };

  try {
    const sessionDir = path.join(getTracesDir(cwd), sid);
    const metaPath = path.join(sessionDir, OPT_SESSION_FILE);

    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}

    let eventCount = 0;
    const agentNames = new Set();
    const typeCounts = {};

    try {
      const raw = fs.readFileSync(path.join(sessionDir, TRACE_EVENT_FILE), 'utf-8');
      raw.trim().split('\n').filter(Boolean).forEach(line => {
        try {
          const e = JSON.parse(line);
          eventCount++;
          if (e.agent) agentNames.add(e.agent);
          typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
        } catch {}
      });
    } catch {}

    meta.ended_at = new Date().toISOString();
    meta.event_count = eventCount;
    meta.agent_count = agentNames.size;
    meta.agents = Array.from(agentNames);
    meta.type_counts = typeCounts;

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

    return {
      session_id: sid,
      event_count: eventCount,
      agent_count: agentNames.size,
      type_counts: typeCounts,
      ended_at: meta.ended_at,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function readTraceSession(cwd, sessionId) {
  try {
    const sessionDir = path.join(getTracesDir(cwd), sessionId);

    let metadata = {};
    try {
      metadata = JSON.parse(fs.readFileSync(path.join(sessionDir, OPT_SESSION_FILE), 'utf-8'));
    } catch {}

    const events = [];
    try {
      const raw = fs.readFileSync(path.join(sessionDir, TRACE_EVENT_FILE), 'utf-8');
      raw.trim().split('\n').filter(Boolean).forEach(line => {
        try { events.push(JSON.parse(line)); } catch {}
      });
    } catch {}

    return { session_id: sessionId, metadata, events, event_count: events.length };
  } catch (e) {
    return { error: e.message };
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
      return meta;
    }).sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

    return { sessions, count: sessions.length };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Local analysis (no agent) ────────────────────────────────────────────────

function analyzeEvents(events, sessionMeta) {
  const errors = events.filter(e => e.type === 'error');
  const gaps = events.filter(e => e.type === 'gap');
  const redundancies = events.filter(e => e.type === 'redundancy');
  const decisions = events.filter(e => e.type === 'decision');
  const corrections = events.filter(e => e.type === 'correction');
  const memoryMisses = events.filter(e => e.type === 'memory_miss');
  const reviewerCorrections = events.filter(e => e.type === 'error' && e.category === 'reviewer_correction');
  const memoryPrimed = events.filter(e => e.type === 'decision' && e.category === 'memory_primed');

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
    if (!agentStats[e.agent]) agentStats[e.agent] = { total: 0, errors: 0, gaps: 0, corrections: 0 };
    agentStats[e.agent].total++;
    if (e.type === 'error') agentStats[e.agent].errors++;
    if (e.type === 'gap') agentStats[e.agent].gaps++;
    if (e.type === 'correction') agentStats[e.agent].corrections++;
  });

  Object.keys(agentStats).forEach(a => {
    const s = agentStats[a];
    s.error_rate = s.total > 0 ? Math.round((s.errors / s.total) * 100) / 100 : 0;
  });

  const wastedTokens = redundancies.reduce((sum, e) => sum + (e.tokens_wasted || 0), 0);

  // ── Timing analysis from wall-clock timestamps ────────────────────────────
  // Token data is unavailable (Claude Code SubagentStop doesn't populate usage).
  // Use event timestamps + session start/end for meaningful timing analysis.
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
    },
    timing,
    overhead,
    error_patterns: frequencyMap(errors),
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

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    metadata: session.metadata,
    ...analyzeEvents(session.events, session.metadata),
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
    return { error: e.message };
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

  const applied = [];
  const skipped = [];

  for (const action of actions) {
    try {
      if (action.type === 'memory') {
        // Write new memory entry (skip if file exists to avoid overwriting manual edits)
        const memPath = path.join(cwd, action.path);
        try {
          fs.accessSync(memPath);
          skipped.push({ action, reason: 'File already exists — skipped to preserve manual edits' });
        } catch {
          fs.mkdirSync(path.dirname(memPath), { recursive: true });
          fs.writeFileSync(memPath, action.content, 'utf-8');
          applied.push({ action, result: `Written to ${action.path}` });
        }
      } else if (action.type === 'memory_append') {
        // Append to existing memory file
        const memPath = path.join(cwd, action.path);
        fs.mkdirSync(path.dirname(memPath), { recursive: true });
        fs.appendFileSync(memPath, '\n' + action.content, 'utf-8');
        applied.push({ action, result: `Appended to ${action.path}` });
      } else if (action.type === 'note') {
        // Write a human-readable suggestion note
        const notePath = path.join(getOptimizeDir(cwd), 'suggestions.md');
        const entry = `\n## ${new Date().toISOString()}: ${action.description || 'Suggestion'}\n\n${action.content || action.suggestion || ''}\n\n**Target:** ${action.target || 'unspecified'}\n`;
        fs.appendFileSync(notePath, entry);
        applied.push({ action, result: 'Suggestion written to optimization/suggestions.md' });
      } else if (action.type === 'planning_note') {
        // Write optimization note into .planning/optimization/config-suggestions.md
        const notePath = path.join(getOptimizeDir(cwd), 'config-suggestions.md');
        const entry = `\n## ${new Date().toISOString()}\n${action.content}\n`;
        fs.appendFileSync(notePath, entry);
        applied.push({ action, result: 'Config suggestion recorded' });
      } else {
        skipped.push({ action, reason: `Unknown action type: ${action.type}` });
      }
    } catch (e) {
      skipped.push({ action, reason: e.message });
    }
  }

  // Log what was applied for cumulative stats
  try {
    const logEntry = {
      ts: new Date().toISOString(),
      report: path.basename(reportPath),
      applied_count: applied.length,
      skipped_count: skipped.length,
      applied_types: applied.map(a => a.action.type),
    };
    fs.appendFileSync(path.join(getOptimizeDir(cwd), APPLIED_LOG), JSON.stringify(logEntry) + '\n');
  } catch {}

  return { applied, skipped };
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
    try {
      const raw = fs.readFileSync(path.join(getOptimizeDir(cwd), APPLIED_LOG), 'utf-8');
      raw.trim().split('\n').filter(Boolean).forEach(line => {
        try {
          const e = JSON.parse(line);
          totalApplied += e.applied_count || 0;
          totalSkipped += e.skipped_count || 0;
          applyRuns++;
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
      current_session: getCurrentSessionId(cwd),
    };
  } catch (e) {
    return { error: e.message };
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
  } else {
    output({ error: 'Unknown trace subcommand. Available: init, log, end, current, list, show' }, raw);
  }
}

function cmdOptimizeLearn(cwd, opts, raw) {
  const sessionId = opts.sessionId || getCurrentSessionId(cwd);
  if (!sessionId) {
    output({ error: 'No trace session active. Start one with: pan-tools optimize trace init' }, raw);
    return;
  }

  const report = generateLocalReport(cwd, sessionId);
  if (report.error) { output(report, raw); return; }

  // Persist as JSON analysis for the optimizer agent to read
  const reportsDir = getReportsDir(cwd);
  try { fs.mkdirSync(reportsDir, { recursive: true }); } catch {}
  const reportName = `${sessionId}-analysis.json`;
  const reportPath = path.join(reportsDir, reportName);
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  } catch (e) {
    output({ error: `Failed to write analysis: ${e.message}` }, raw);
    return;
  }

  output({
    session_id: sessionId,
    analysis_path: path.join(PLANNING_DIR, OPTIMIZE_DIR, OPT_REPORTS_DIR, reportName).replace(/\\/g, '/'),
    summary: report.summary,
    top_error_patterns: report.error_patterns.slice(0, 5),
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
  const content = fs.readFileSync(filePath, 'utf-8');
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
    `\\n## ${patternId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b[^\\n]*[\\s\\S]*?(?=\\n## |$)`,
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
  EVENT_TYPES,
  IMPACT_LEVELS,
  VALID_SCOPES,
};
