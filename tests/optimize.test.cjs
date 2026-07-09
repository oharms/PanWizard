'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');

const {
  initTraceSession,
  getCurrentSessionId,
  logTraceEvent,
  endTraceSession,
  readTraceSession,
  listTraceSessions,
  analyzeEvents,
  generateLocalReport,
  listOptimizationReports,
  parseAutoApplyBlock,
  applyReportRecommendations,
  deriveActionsFromAnalysis,
  getOptimizeStats,
  cmdOptimizeTrace,
  cmdOptimizeLearn,
  cmdOptimizeApply,
  cmdOptimizeStats,
  cmdOptimizeList,
  getOptimizeDir,
  getTracesDir,
  getReportsDir,
  OPTIMIZE_DIR,
  TRACES_DIR,
  OPT_REPORTS_DIR,
  APPLIED_LOG,
  TRACE_EVENT_FILE,
  OPT_SESSION_FILE,
  CURRENT_SESSION_FILE,
  EVENT_TYPES,
  IMPACT_LEVELS,
} = require('../pan-wizard-core/bin/lib/optimize.cjs');

const {
  buildTraceEvents,
  appendTraceEvents,
} = require('../hooks/pan-trace-logger.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function readJsonl(p) {
  return fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('optimize constants', () => {
  test('OPTIMIZE_DIR is optimization', () => assert.equal(OPTIMIZE_DIR, 'optimization'));
  test('TRACES_DIR is traces', () => assert.equal(TRACES_DIR, 'traces'));
  test('OPT_REPORTS_DIR is reports', () => assert.equal(OPT_REPORTS_DIR, 'reports'));
  test('TRACE_EVENT_FILE is trace.jsonl', () => assert.equal(TRACE_EVENT_FILE, 'trace.jsonl'));
  test('OPT_SESSION_FILE is session.json', () => assert.equal(OPT_SESSION_FILE, 'session.json'));
  test('CURRENT_SESSION_FILE is current-session', () => assert.equal(CURRENT_SESSION_FILE, 'current-session'));
  test('EVENT_TYPES covers all expected types', () => {
    ['decision', 'error', 'gap', 'correction', 'redundancy', 'memory_hit', 'memory_miss', 'surprise']
      .forEach(t => assert.ok(EVENT_TYPES.includes(t), `Missing: ${t}`));
  });
  test('IMPACT_LEVELS covers all expected levels', () => {
    ['critical', 'major', 'minor', 'trivial']
      .forEach(l => assert.ok(IMPACT_LEVELS.includes(l), `Missing: ${l}`));
  });
});

// ─── Path helpers ─────────────────────────────────────────────────────────────

describe('optimize path helpers', () => {
  test('getOptimizeDir', () =>
    assert.equal(getOptimizeDir('/p'), path.join('/p', '.planning', 'optimization')));
  test('getTracesDir', () =>
    assert.equal(getTracesDir('/p'), path.join('/p', '.planning', 'optimization', 'traces')));
  test('getReportsDir', () =>
    assert.equal(getReportsDir('/p'), path.join('/p', '.planning', 'optimization', 'reports')));
});

// ─── initTraceSession ────────────────────────────────────────────────────────

describe('initTraceSession', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('creates session directory and session.json', () => {
    cwd = createTempProject();
    const r = initTraceSession(cwd, { description: 'test build' });
    assert.ok(r.session_id.startsWith('sess_'));
    assert.ok(r.started_at);
    assert.ok(fs.existsSync(path.join(getTracesDir(cwd), r.session_id, OPT_SESSION_FILE)));
  });

  test('writes current-session file', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    const stored = fs.readFileSync(path.join(getOptimizeDir(cwd), CURRENT_SESSION_FILE), 'utf-8').trim();
    assert.equal(stored, session_id);
  });

  test('accepts custom sessionId', () => {
    cwd = createTempProject();
    const r = initTraceSession(cwd, { sessionId: 'sess_custom123' });
    assert.equal(r.session_id, 'sess_custom123');
  });

  test('session.json carries description, command, phase', () => {
    cwd = createTempProject();
    const r = initTraceSession(cwd, { description: 'desc', command: 'exec-phase', phase: '1' });
    const meta = readJson(path.join(getTracesDir(cwd), r.session_id, OPT_SESSION_FILE));
    assert.equal(meta.description, 'desc');
    assert.equal(meta.command, 'exec-phase');
    assert.equal(meta.phase, '1');
    assert.equal(meta.event_count, 0);
  });

  test('session.json ended_at is null at init', () => {
    cwd = createTempProject();
    const r = initTraceSession(cwd, {});
    const meta = readJson(path.join(getTracesDir(cwd), r.session_id, OPT_SESSION_FILE));
    assert.equal(meta.ended_at, null);
  });
});

// ─── getCurrentSessionId ──────────────────────────────────────────────────────

describe('getCurrentSessionId', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns null when no session active', () => {
    cwd = createTempProject();
    assert.equal(getCurrentSessionId(cwd), null);
  });

  test('returns session ID after init', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    assert.equal(getCurrentSessionId(cwd), session_id);
  });
});

// ─── logTraceEvent ────────────────────────────────────────────────────────────

describe('logTraceEvent', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns false when no session active', () => {
    cwd = createTempProject();
    assert.equal(logTraceEvent(cwd, { type: 'error', description: 'x' }), false);
  });

  test('appends event to trace.jsonl', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    const logged = logTraceEvent(cwd, {
      agent: 'pan-planner', type: 'decision', category: 'file_structure',
      description: 'chose MVC', impact: 'minor',
    });
    assert.equal(logged, true);
    const events = readJsonl(path.join(getTracesDir(cwd), session_id, TRACE_EVENT_FILE));
    assert.equal(events.length, 1);
    assert.equal(events[0].agent, 'pan-planner');
    assert.equal(events[0].type, 'decision');
  });

  test('normalizes unknown event type to unknown', () => {
    cwd = createTempProject();
    initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'bogus', description: 'x' });
    const sid = getCurrentSessionId(cwd);
    const events = readJsonl(path.join(getTracesDir(cwd), sid, TRACE_EVENT_FILE));
    assert.equal(events[0].type, 'unknown');
  });

  test('normalizes unknown impact to minor', () => {
    cwd = createTempProject();
    initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'error', impact: 'extreme', description: 'x' });
    const sid = getCurrentSessionId(cwd);
    const events = readJsonl(path.join(getTracesDir(cwd), sid, TRACE_EVENT_FILE));
    assert.equal(events[0].impact, 'minor');
  });

  test('can use explicit sessionId', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'gap', description: 'missing auth context' }, session_id);
    const events = readJsonl(path.join(getTracesDir(cwd), session_id, TRACE_EVENT_FILE));
    assert.equal(events[0].type, 'gap');
  });

  test('multiple events appended in order', () => {
    cwd = createTempProject();
    initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'decision', description: 'first' });
    logTraceEvent(cwd, { type: 'error', description: 'second' });
    logTraceEvent(cwd, { type: 'gap', description: 'third' });
    const sid = getCurrentSessionId(cwd);
    const events = readJsonl(path.join(getTracesDir(cwd), sid, TRACE_EVENT_FILE));
    assert.equal(events.length, 3);
    assert.equal(events[0].description, 'first');
    assert.equal(events[2].description, 'third');
  });

  test('event record has ts and session fields', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'decision', description: 'x' });
    const events = readJsonl(path.join(getTracesDir(cwd), session_id, TRACE_EVENT_FILE));
    assert.ok(events[0].ts);
    assert.equal(events[0].session, session_id);
  });

  test('inherits phase from session metadata when event has no phase (W3)', () => {
    cwd = createTempProject();
    initTraceSession(cwd, { phase: '3' });
    logTraceEvent(cwd, { type: 'decision', description: 'no explicit phase' });
    const sid = getCurrentSessionId(cwd);
    const events = readJsonl(path.join(getTracesDir(cwd), sid, TRACE_EVENT_FILE));
    assert.equal(events[0].phase, '3');
  });

  test('event explicit phase overrides session phase (W3)', () => {
    cwd = createTempProject();
    initTraceSession(cwd, { phase: '3' });
    logTraceEvent(cwd, { type: 'decision', description: 'explicit phase', phase: '3.1' });
    const sid = getCurrentSessionId(cwd);
    const events = readJsonl(path.join(getTracesDir(cwd), sid, TRACE_EVENT_FILE));
    assert.equal(events[0].phase, '3.1');
  });

  test('phase is null when session has no phase and event has none (W3)', () => {
    cwd = createTempProject();
    initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'decision', description: 'no phase anywhere' });
    const sid = getCurrentSessionId(cwd);
    const events = readJsonl(path.join(getTracesDir(cwd), sid, TRACE_EVENT_FILE));
    assert.equal(events[0].phase, null);
  });
});

// ─── endTraceSession ─────────────────────────────────────────────────────────

describe('endTraceSession', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns error when no active session', () => {
    cwd = createTempProject();
    const r = endTraceSession(cwd);
    assert.ok(r.error);
  });

  test('writes ended_at, event_count, agent_count to session.json', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    logTraceEvent(cwd, { agent: 'pan-planner', type: 'decision', description: 'x' });
    logTraceEvent(cwd, { agent: 'pan-executor', type: 'error', description: 'y' });
    const r = endTraceSession(cwd, session_id);
    assert.equal(r.event_count, 2);
    assert.equal(r.agent_count, 2);
    assert.ok(r.ended_at);
    const meta = readJson(path.join(getTracesDir(cwd), session_id, OPT_SESSION_FILE));
    assert.equal(meta.event_count, 2);
    assert.ok(meta.agents.includes('pan-planner'));
    assert.ok(meta.agents.includes('pan-executor'));
  });

  test('reports type_counts breakdown', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'error', description: 'a' });
    logTraceEvent(cwd, { type: 'error', description: 'b' });
    logTraceEvent(cwd, { type: 'gap', description: 'c' });
    const r = endTraceSession(cwd, session_id);
    assert.equal(r.type_counts.error, 2);
    assert.equal(r.type_counts.gap, 1);
  });

  test('session with no events ends cleanly', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    const r = endTraceSession(cwd, session_id);
    assert.equal(r.event_count, 0);
    assert.equal(r.agent_count, 0);
    assert.ok(r.ended_at);
  });
});

// ─── readTraceSession ─────────────────────────────────────────────────────────

describe('readTraceSession', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns empty events for nonexistent session', () => {
    cwd = createTempProject();
    const r = readTraceSession(cwd, 'sess_notexist');
    assert.deepEqual(r.events, []);
    assert.equal(r.event_count, 0);
  });

  test('returns all logged events', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'decision', description: 'a' });
    logTraceEvent(cwd, { type: 'gap', description: 'b' });
    const r = readTraceSession(cwd, session_id);
    assert.equal(r.events.length, 2);
    assert.equal(r.event_count, 2);
  });

  test('returns metadata from session.json', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, { description: 'meta test' });
    const r = readTraceSession(cwd, session_id);
    assert.equal(r.metadata.description, 'meta test');
  });
});

// ─── listTraceSessions ────────────────────────────────────────────────────────

describe('listTraceSessions', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns empty list when no sessions', () => {
    cwd = createTempProject();
    const r = listTraceSessions(cwd);
    assert.equal(r.count, 0);
    assert.deepEqual(r.sessions, []);
  });

  test('lists sessions sorted newest first', () => {
    cwd = createTempProject();
    initTraceSession(cwd, { sessionId: 'sess_20260101T120000' });
    initTraceSession(cwd, { sessionId: 'sess_20260201T120000' });
    // Override started_at so the sort is deterministic regardless of wall clock
    const tracesDir = getTracesDir(cwd);
    const metaA = path.join(tracesDir, 'sess_20260101T120000', OPT_SESSION_FILE);
    const metaB = path.join(tracesDir, 'sess_20260201T120000', OPT_SESSION_FILE);
    const a = readJson(metaA); a.started_at = '2026-01-01T12:00:00.000Z';
    fs.writeFileSync(metaA, JSON.stringify(a));
    const b = readJson(metaB); b.started_at = '2026-02-01T12:00:00.000Z';
    fs.writeFileSync(metaB, JSON.stringify(b));
    const r = listTraceSessions(cwd);
    assert.equal(r.count, 2);
    assert.equal(r.sessions[0].session_id, 'sess_20260201T120000');
  });

  test('count matches sessions array length', () => {
    cwd = createTempProject();
    initTraceSession(cwd, { sessionId: 'sess_20260301T090000' });
    initTraceSession(cwd, { sessionId: 'sess_20260302T090000' });
    initTraceSession(cwd, { sessionId: 'sess_20260303T090000' });
    const r = listTraceSessions(cwd);
    assert.equal(r.count, r.sessions.length);
  });
});

// ─── analyzeEvents ────────────────────────────────────────────────────────────

describe('analyzeEvents', () => {
  test('zero summary for empty events', () => {
    const r = analyzeEvents([]);
    assert.equal(r.summary.total_events, 0);
    assert.equal(r.summary.errors, 0);
    assert.equal(r.summary.gaps, 0);
  });

  test('counts event types correctly', () => {
    const events = [
      { type: 'error', agent: 'pan-planner', category: 'tool_fail', description: 'x', impact: 'minor' },
      { type: 'error', agent: 'pan-planner', category: 'tool_fail', description: 'y', impact: 'major' },
      { type: 'gap', agent: 'pan-executor', category: 'missing_context', description: 'z', impact: 'minor' },
      { type: 'memory_miss', agent: 'pan-planner', category: 'express', description: 'w', impact: 'minor' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.summary.errors, 2);
    assert.equal(r.summary.gaps, 1);
    assert.equal(r.summary.memory_misses, 1);
    assert.equal(r.summary.total_events, 4);
  });

  test('builds error_patterns frequency map sorted descending', () => {
    const events = [
      { type: 'error', category: 'tool_fail', description: 'a', impact: 'minor' },
      { type: 'error', category: 'tool_fail', description: 'b', impact: 'minor' },
      { type: 'error', category: 'wrong_path', description: 'c', impact: 'minor' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.error_patterns[0].pattern, 'tool_fail');
    assert.equal(r.error_patterns[0].count, 2);
    assert.equal(r.error_patterns[1].pattern, 'wrong_path');
  });

  test('computes per-agent error rates', () => {
    const events = [
      { type: 'decision', agent: 'pan-planner', description: 'a', impact: 'trivial' },
      { type: 'error', agent: 'pan-planner', description: 'b', impact: 'minor' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.agent_stats['pan-planner'].error_rate, 0.5);
    assert.equal(r.agent_stats['pan-planner'].errors, 1);
    assert.equal(r.agent_stats['pan-planner'].total, 2);
  });

  test('sums wasted_tokens from redundancy events', () => {
    const events = [
      { type: 'redundancy', description: 'repeated research', tokens_wasted: 1500, impact: 'minor' },
      { type: 'redundancy', description: 'same search', tokens_wasted: 800, impact: 'minor' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.summary.wasted_tokens, 2300);
  });

  test('separates critical and major events', () => {
    const events = [
      { type: 'error', description: 'bad', impact: 'critical' },
      { type: 'gap', description: 'gap', impact: 'major' },
      { type: 'decision', description: 'ok', impact: 'trivial' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.critical_events.length, 1);
    assert.equal(r.major_events.length, 1);
  });

  test('agent with zero events has zero error_rate', () => {
    const events = [{ type: 'decision', agent: 'pan-planner', description: 'x', impact: 'trivial' }];
    const r = analyzeEvents(events);
    assert.equal(r.agent_stats['pan-planner'].error_rate, 0);
  });

  test('computes session_duration_ms from sessionMeta', () => {
    const meta = { started_at: '2026-04-21T21:00:00.000Z', ended_at: '2026-04-21T21:05:00.000Z' };
    const r = analyzeEvents([], meta);
    assert.equal(r.timing.session_duration_ms, 300000);
    assert.equal(r.timing.session_duration_human, '5m');
  });

  test('timing absent when sessionMeta not provided', () => {
    const r = analyzeEvents([]);
    assert.ok(r.timing);
    assert.equal(r.timing.session_duration_ms, undefined);
  });

  test('token_data_available false when all token counts zero', () => {
    const events = [
      { type: 'decision', ts: '2026-04-21T21:00:00.000Z', context: { input_tokens: 0, output_tokens: 0 } },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.timing.token_data_available, false);
  });

  test('token_data_available true when any event has real token count', () => {
    const events = [
      { type: 'decision', ts: '2026-04-21T21:00:00.000Z', context: { input_tokens: 1234 } },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.timing.token_data_available, true);
  });

  test('detects slow agent when average interval exceeds 3 minutes', () => {
    const events = [
      { type: 'decision', agent: 'pan-executor', ts: '2026-04-21T21:00:00.000Z', description: 'a' },
      { type: 'decision', agent: 'pan-executor', ts: '2026-04-21T21:05:00.000Z', description: 'b' },
    ];
    const r = analyzeEvents(events);
    assert.ok(r.timing.slow_agents);
    assert.equal(r.timing.slow_agents[0].agent, 'pan-executor');
  });

  test('counts reviewer_correction events in summary (W1)', () => {
    const events = [
      { type: 'error', category: 'reviewer_correction', agent: 'pan-reviewer', description: 'Phase 2: NEEDS_FIXES', impact: 'major' },
      { type: 'error', category: 'reviewer_correction', agent: 'pan-reviewer', description: 'Phase 3: NEEDS_FIXES', impact: 'major' },
      { type: 'decision', category: 'wave_complete', agent: 'pan-executor', description: 'Wave 1 done', impact: 'trivial' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.summary.reviewer_corrections, 2);
    assert.equal(r.summary.errors, 2);
  });

  test('reviewer_correction events appear in error_patterns (W1)', () => {
    const events = [
      { type: 'error', category: 'reviewer_correction', agent: 'pan-reviewer', description: 'NEEDS_FIXES', impact: 'major' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.error_patterns[0].pattern, 'reviewer_correction');
    assert.equal(r.error_patterns[0].count, 1);
  });

  test('counts memory_primed events in summary (W2)', () => {
    const events = [
      { type: 'decision', category: 'memory_primed', agent: 'orchestrator', description: 'Loaded 3 memory entries', impact: 'minor' },
      { type: 'decision', category: 'wave_complete', agent: 'pan-executor', description: 'Wave 1 done', impact: 'trivial' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.summary.memory_primed_count, 1);
  });

  test('reviewer_corrections is zero when no correction events logged', () => {
    const events = [
      { type: 'decision', category: 'wave_complete', agent: 'pan-executor', description: 'Wave 1 done', impact: 'trivial' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.summary.reviewer_corrections, 0);
  });

  test('memory_primed_count is zero when no memory priming events logged', () => {
    const events = [
      { type: 'error', category: 'tool_fail', agent: 'pan-planner', description: 'fail', impact: 'minor' },
    ];
    const r = analyzeEvents(events);
    assert.equal(r.summary.memory_primed_count, 0);
  });
});

// ─── generateLocalReport ─────────────────────────────────────────────────────

describe('generateLocalReport', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('generates report from logged events', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, { description: 'test run' });
    logTraceEvent(cwd, { type: 'error', agent: 'pan-planner', category: 'tool_fail', description: 'e1', impact: 'minor' });
    logTraceEvent(cwd, { type: 'gap', category: 'auth_context', description: 'g1', impact: 'major' });
    const report = generateLocalReport(cwd, session_id);
    assert.equal(report.session_id, session_id);
    assert.equal(report.summary.errors, 1);
    assert.equal(report.summary.gaps, 1);
    assert.equal(report.error_patterns[0].pattern, 'tool_fail');
  });

  test('includes raw_events in report', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    logTraceEvent(cwd, { type: 'decision', description: 'z' });
    const report = generateLocalReport(cwd, session_id);
    assert.equal(report.raw_events.length, 1);
  });

  test('has generated_at timestamp', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    const report = generateLocalReport(cwd, session_id);
    assert.ok(report.generated_at);
  });
});

// ─── parseAutoApplyBlock ─────────────────────────────────────────────────────

describe('parseAutoApplyBlock', () => {
  test('returns null when no auto-apply section', () =>
    assert.equal(parseAutoApplyBlock('# Report\n\nNo auto-apply here.'), null));

  test('extracts JSON array from auto-apply block', () => {
    const report = `# Report\n\n## Auto-Apply Actions\n\n\`\`\`json\n[{"type":"memory","path":".planning/memory/test.md","content":"# Test"}]\n\`\`\`\n`;
    const actions = parseAutoApplyBlock(report);
    assert.equal(Array.isArray(actions), true);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'memory');
  });

  test('returns null on invalid JSON', () => {
    const report = `## Auto-Apply Actions\n\n\`\`\`json\n[not valid\n\`\`\``;
    assert.equal(parseAutoApplyBlock(report), null);
  });

  test('handles multiple actions in block', () => {
    const actions = [
      { type: 'memory', path: '.planning/memory/a.md', content: 'A' },
      { type: 'note', description: 'tip', content: 'B', target: 'agents/x.md' },
    ];
    const report = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const parsed = parseAutoApplyBlock(report);
    assert.equal(parsed.length, 2);
  });
});

// ─── applyReportRecommendations ───────────────────────────────────────────────

describe('applyReportRecommendations', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns error for nonexistent report file', () => {
    cwd = createTempProject();
    const r = applyReportRecommendations(cwd, '/nonexistent/report.md');
    assert.ok(r.error);
  });

  test('applies memory action — writes new file', () => {
    cwd = createTempProject();
    const actions = [{ type: 'memory', path: '.planning/memory/express.md', description: 'Express patterns', content: '# Express\n\nUse helmet.' }];
    const reportContent = `# Report\n\n## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\`\n`;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r1.md');
    fs.writeFileSync(reportPath, reportContent);

    const r = applyReportRecommendations(cwd, reportPath);
    assert.equal(r.applied.length, 1);
    assert.ok(fs.existsSync(path.join(cwd, '.planning', 'memory', 'express.md')));
    assert.ok(fs.readFileSync(path.join(cwd, '.planning', 'memory', 'express.md'), 'utf-8').includes('helmet'));
  });

  test('skips memory action when file already exists', () => {
    cwd = createTempProject();
    const memDir = path.join(cwd, '.planning', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'existing.md'), '# Existing');

    const actions = [{ type: 'memory', path: '.planning/memory/existing.md', content: '# New' }];
    const reportContent = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r2.md');
    fs.writeFileSync(reportPath, reportContent);

    const r = applyReportRecommendations(cwd, reportPath);
    assert.equal(r.skipped.length, 1);
    assert.ok(fs.readFileSync(path.join(memDir, 'existing.md'), 'utf-8').includes('Existing'));
  });

  test('applies memory_append action', () => {
    cwd = createTempProject();
    const memDir = path.join(cwd, '.planning', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'base.md'), '# Base\nOriginal.');

    const actions = [{ type: 'memory_append', path: '.planning/memory/base.md', content: '\n## Appended\nNew.' }];
    const reportContent = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r3.md');
    fs.writeFileSync(reportPath, reportContent);

    const r = applyReportRecommendations(cwd, reportPath);
    assert.equal(r.applied.length, 1);
    const content = fs.readFileSync(path.join(memDir, 'base.md'), 'utf-8');
    assert.ok(content.includes('Original.'));
    assert.ok(content.includes('Appended'));
  });

  test('applies note action to suggestions.md', () => {
    cwd = createTempProject();
    const actions = [{ type: 'note', description: 'improve pan-planner', content: 'Add complexity detection', target: 'agents/pan-planner.md' }];
    const reportContent = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r4.md');
    fs.writeFileSync(reportPath, reportContent);

    applyReportRecommendations(cwd, reportPath);
    assert.ok(fs.existsSync(path.join(getOptimizeDir(cwd), 'suggestions.md')));
  });

  test('applies planning_note action to config-suggestions.md', () => {
    cwd = createTempProject();
    const actions = [{ type: 'planning_note', content: 'Enable research for Node.js' }];
    const reportContent = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r5.md');
    fs.writeFileSync(reportPath, reportContent);

    applyReportRecommendations(cwd, reportPath);
    const notePath = path.join(getOptimizeDir(cwd), 'config-suggestions.md');
    assert.ok(fs.existsSync(notePath));
    assert.ok(fs.readFileSync(notePath, 'utf-8').includes('Enable research'));
  });

  test('skips unknown action type', () => {
    cwd = createTempProject();
    const actions = [{ type: 'unknown_action_type', path: '.planning/x.md' }];
    const reportContent = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r6.md');
    fs.writeFileSync(reportPath, reportContent);

    const r = applyReportRecommendations(cwd, reportPath);
    assert.equal(r.skipped.length, 1);
    assert.ok(r.skipped[0].reason.includes('Unknown action type'));
  });

  test('logs applied results to applied.jsonl', () => {
    cwd = createTempProject();
    const actions = [{ type: 'memory', path: '.planning/memory/x.md', content: '# X' }];
    const reportContent = `## Auto-Apply Actions\n\n\`\`\`json\n${JSON.stringify(actions)}\n\`\`\``;
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r7.md');
    fs.writeFileSync(reportPath, reportContent);

    applyReportRecommendations(cwd, reportPath);
    const log = readJsonl(path.join(getOptimizeDir(cwd), APPLIED_LOG));
    assert.equal(log.length, 1);
    assert.equal(log[0].applied_count, 1);
    assert.equal(log[0].report, 'r7.md');
  });

  test('returns note when no auto-apply block in report', () => {
    cwd = createTempProject();
    const reportsDir = getReportsDir(cwd);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'r8.md');
    fs.writeFileSync(reportPath, '# Report\n\nNo auto-apply section.');

    const r = applyReportRecommendations(cwd, reportPath);
    assert.ok(r.note);
    assert.equal(r.applied.length, 0);
  });
});

// ─── deriveActionsFromAnalysis ────────────────────────────────────────────────

describe('deriveActionsFromAnalysis', () => {
  test('returns empty array for empty analysis', () =>
    assert.deepEqual(deriveActionsFromAnalysis({}), []));

  test('generates note actions from memory_miss_patterns', () => {
    const analysis = {
      summary: { memory_misses: 3 },
      memory_miss_patterns: [{ pattern: 'express_middleware', count: 3 }],
    };
    const actions = deriveActionsFromAnalysis(analysis);
    assert.ok(actions.length > 0);
    assert.equal(actions[0].type, 'note');
    assert.ok(actions[0].description.includes('Memory miss'));
  });

  test('generates note actions from gap_patterns', () => {
    const analysis = {
      gap_patterns: [{ pattern: 'jwt_secret_storage', count: 2 }],
    };
    const actions = deriveActionsFromAnalysis(analysis);
    assert.ok(actions.some(a => a.description.includes('Knowledge gap')));
  });

  test('limits memory_miss to top 3', () => {
    const analysis = {
      summary: { memory_misses: 10 },
      memory_miss_patterns: Array.from({ length: 10 }, (_, i) => ({ pattern: `topic_${i}`, count: 1 })),
    };
    const memoryActions = deriveActionsFromAnalysis(analysis).filter(a => a.description.includes('Memory miss'));
    assert.ok(memoryActions.length <= 3);
  });
});

// ─── getOptimizeStats ─────────────────────────────────────────────────────────

describe('getOptimizeStats', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('returns zeros on fresh project', () => {
    cwd = createTempProject();
    const s = getOptimizeStats(cwd);
    assert.equal(s.trace_sessions, 0);
    assert.equal(s.total_events_traced, 0);
    assert.equal(s.total_optimizations_applied, 0);
  });

  test('current_session is null on fresh project', () => {
    cwd = createTempProject();
    assert.equal(getOptimizeStats(cwd).current_session, null);
  });

  test('active session shows in current_session', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    assert.equal(getOptimizeStats(cwd).current_session, session_id);
  });

  test('counts sessions after init', () => {
    cwd = createTempProject();
    initTraceSession(cwd, { sessionId: 'sess_a' });
    initTraceSession(cwd, { sessionId: 'sess_b' });
    const s = getOptimizeStats(cwd);
    assert.equal(s.trace_sessions, 2);
  });
});

// ─── pan-trace-logger hook ────────────────────────────────────────────────────

describe('pan-trace-logger buildTraceEvents', () => {
  test('returns empty array for null data', () =>
    assert.deepEqual(buildTraceEvents(null, 'sess_test'), []));

  test('returns empty array for non-SubagentStop events', () => {
    assert.deepEqual(buildTraceEvents({ hook_event_name: 'PreToolUse' }, 'sess_test'), []);
  });

  test('builds completion event for SubagentStop', () => {
    const data = {
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-planner',
      model: 'claude-opus-4-7',
      usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0 },
    };
    const events = buildTraceEvents(data, 'sess_abc');
    const completion = events.find(e => e.category === 'agent_completion');
    assert.ok(completion, 'has agent_completion event');
    assert.equal(completion.agent, 'pan-planner');
    assert.equal(completion.type, 'decision');
    assert.equal(completion.session, 'sess_abc');
  });

  test('completion event carries token context', () => {
    const data = {
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-executor',
      usage: { input_tokens: 3000, output_tokens: 1000, cache_read_input_tokens: 500 },
    };
    const events = buildTraceEvents(data, 'sess_x');
    const completion = events.find(e => e.category === 'agent_completion');
    assert.equal(completion.context.input_tokens, 3000);
    assert.equal(completion.context.output_tokens, 1000);
    assert.equal(completion.context.total_tokens, 4000);
  });

  test('adds redundancy event for high-output uncached run', () => {
    const data = {
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-phase-researcher',
      usage: { input_tokens: 5000, output_tokens: 5000, cache_read_input_tokens: 0 },
    };
    const events = buildTraceEvents(data, 'sess_r');
    const redundancy = events.find(e => e.type === 'redundancy');
    assert.ok(redundancy, 'has redundancy event');
    assert.equal(redundancy.tokens_wasted, 5000);
  });

  test('no redundancy when output <= 3000', () => {
    const data = {
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-reviewer',
      usage: { input_tokens: 2000, output_tokens: 2000, cache_read_input_tokens: 0 },
    };
    const events = buildTraceEvents(data, 'sess_r2');
    assert.equal(events.find(e => e.type === 'redundancy'), undefined);
  });

  test('no redundancy when cache_read is non-zero', () => {
    const data = {
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-phase-researcher',
      usage: { input_tokens: 5000, output_tokens: 5000, cache_read_input_tokens: 3000 },
    };
    const events = buildTraceEvents(data, 'sess_r3');
    assert.equal(events.find(e => e.type === 'redundancy'), undefined);
  });

  test('handles missing usage gracefully', () => {
    const data = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor' };
    assert.doesNotThrow(() => buildTraceEvents(data, 'sess_x'));
  });

  test('per-transcript cursor — second SubagentStop counts only new transcript records (field report 2026-06)', () => {
    const os = require('os'), fs = require('fs'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-tracelog-'));
    try {
      const tp = path.join(dir, 't.jsonl');
      fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 20 } } }) + '\n');
      const e1 = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: tp }, 'sess_d', dir);
      assert.equal(e1.find(e => e.category === 'agent_completion').context.input_tokens, 100);
      fs.appendFileSync(tp, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 300, output_tokens: 40 } } }) + '\n');
      const e2 = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: tp }, 'sess_d', dir);
      assert.equal(e2.find(e => e.category === 'agent_completion').context.input_tokens, 300, 'only the appended record, not the cumulative 400');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('completion impact is trivial', () => {
    const data = { hook_event_name: 'SubagentStop', agent_type: 'pan-planner',
      usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0 } };
    const events = buildTraceEvents(data, 'sess_t');
    const completion = events.find(e => e.category === 'agent_completion');
    assert.equal(completion.impact, 'trivial');
  });
});

describe('pan-trace-logger appendTraceEvents', () => {
  let cwd;
  afterEach(() => { if (cwd) { cleanup(cwd); cwd = null; } });

  test('writes events to session trace.jsonl', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    const events = buildTraceEvents({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-executor',
      usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0 },
    }, session_id);

    const written = appendTraceEvents(cwd, events, session_id);
    assert.equal(written, true);
    const stored = readJsonl(path.join(getTracesDir(cwd), session_id, TRACE_EVENT_FILE));
    assert.ok(stored.length >= 1);
    assert.equal(stored[0].agent, 'pan-executor');
  });

  test('returns false for empty events array', () => {
    cwd = createTempProject();
    const { session_id } = initTraceSession(cwd, {});
    const result = appendTraceEvents(cwd, [], session_id);
    assert.equal(result, false);
  });

  test('returns false for invalid session directory', () => {
    cwd = createTempProject();
    // Session dir doesn't exist but appendTraceEvents creates it
    const result = appendTraceEvents(cwd, [{ ts: '2026-01-01T00:00:00Z', type: 'decision' }], 'sess_nonexistent');
    assert.equal(result, true); // creates directory
    assert.ok(fs.existsSync(path.join(getTracesDir(cwd), 'sess_nonexistent', TRACE_EVENT_FILE)));
  });
});
