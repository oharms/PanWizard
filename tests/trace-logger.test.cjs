/**
 * Tests for hooks/pan-trace-logger.js — SubagentStop trace capture.
 * Focus: the 2026-07 fix making the transcript SLICE authoritative over the
 * cumulative SubagentStop `data.usage`, the plausibility guard, and the
 * completion-event dedup guard.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildTraceEvents, appendTraceEvents,
  PLANNING_DIR, OPTIMIZE_DIR, TRACES_DIR, TRACE_EVENT_FILE,
} = require('../hooks/pan-trace-logger.js');

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-tracelog-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeTranscript(lines) {
  const p = path.join(tmpDir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}
function completionOf(events) { return events.find((e) => e && e.category === 'agent_completion'); }
function traceFile(sessionId) { return path.join(tmpDir, PLANNING_DIR, OPTIMIZE_DIR, TRACES_DIR, sessionId, TRACE_EVENT_FILE); }

describe('pan-trace-logger — buildTraceEvents', () => {
  test('ignores non-SubagentStop events', () => {
    assert.deepEqual(buildTraceEvents({ hook_event_name: 'Stop' }, 's'), []);
    assert.deepEqual(buildTraceEvents(null, 's'), []);
  });

  test('emits a completion event with per-call token context', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900 } } },
    ]);
    const ev = completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p }, 'sess1', tmpDir));
    assert.ok(ev);
    assert.equal(ev.agent, 'pan-executor');
    assert.equal(ev.context.input_tokens, 120);
    assert.equal(ev.context.output_tokens, 40);
    assert.equal(ev.context.cache_read_tokens, 900);
  });

  test('transcript slice is authoritative over a cumulative payload usage (P0 fix)', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const ev = completionOf(buildTraceEvents({
      hook_event_name: 'SubagentStop', agent_type: 'a', transcript_path: p,
      usage: { input_tokens: 41296311, output_tokens: 41296311 }, // cumulative counter
    }, 'sess1', tmpDir));
    assert.equal(ev.context.input_tokens, 10, 'uses the transcript slice, not the cumulative payload');
    assert.equal(ev.context.output_tokens, 5);
  });

  test('plausibility guard drops a cumulative magnitude when no transcript is present', () => {
    const ev = completionOf(buildTraceEvents({
      hook_event_name: 'SubagentStop', agent_type: 'a',
      usage: { input_tokens: 999999999, output_tokens: 41296311 },
    }, 'sess1', tmpDir));
    assert.equal(ev.context.input_tokens, 0);
    assert.equal(ev.context.output_tokens, 0);
  });
});

describe('pan-trace-logger — appendTraceEvents dedup', () => {
  test('skips a completion event identical to the last one already written (ignoring ts)', () => {
    const mk = () => buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'dup', session_id: 'x' }, 'sess1', tmpDir);
    assert.equal(appendTraceEvents(tmpDir, mk(), 'sess1'), true);
    assert.equal(appendTraceEvents(tmpDir, mk(), 'sess1'), false, 're-fired identical completion is not double-logged');
    const completions = fs.readFileSync(traceFile('sess1'), 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => e.category === 'agent_completion');
    assert.equal(completions.length, 1);
  });

  test('a different agent still appends', () => {
    appendTraceEvents(tmpDir, buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'a' }, 'sess2', tmpDir), 'sess2');
    assert.equal(appendTraceEvents(tmpDir, buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'b' }, 'sess2', tmpDir), 'sess2'), true);
    const completions = fs.readFileSync(traceFile('sess2'), 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => e.category === 'agent_completion');
    assert.equal(completions.length, 2);
  });
});

describe('pan-trace-logger — v3.21.0 enrichment', () => {
  const { ensureSessionId, getCurrentSessionId } = require('../hooks/pan-trace-logger.js');

  test('model falls back to the transcript when the payload omits it', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const ev = completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', transcript_path: p }, 'sess1', tmpDir));
    assert.equal(ev.context.model, 'claude-opus-4-8');
  });

  test('duration_ms is the transcript slice span; null without timestamps', () => {
    const p = writeTranscript([
      { type: 'assistant', timestamp: '2026-07-30T10:00:00.000Z', message: { usage: { input_tokens: 10 } } },
      { type: 'assistant', timestamp: '2026-07-30T10:00:03.000Z', message: { usage: { output_tokens: 4 } } },
    ]);
    assert.equal(completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', transcript_path: p }, 's', tmpDir)).context.duration_ms, 3000);
    const p2 = writeTranscript([{ type: 'assistant', message: { usage: { input_tokens: 1 } } }]);
    assert.equal(completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', transcript_path: p2 }, 's', tmpDir)).context.duration_ms, null);
  });

  test('every emitted event carries the numeric schema version (completion + redundancy)', () => {
    const p = writeTranscript([{ type: 'assistant', message: { usage: { output_tokens: 4000, cache_read_input_tokens: 0 } } }]);
    const events = buildTraceEvents({ hook_event_name: 'SubagentStop', transcript_path: p }, 's', tmpDir);
    assert.ok(events.length >= 2, 'redundancy event emitted for uncached heavy run');
    for (const e of events) assert.equal(typeof e.v, 'number');
  });

  test('command/phase inherit from the active session when the payload omits them', () => {
    const sdir = path.join(tmpDir, PLANNING_DIR, OPTIMIZE_DIR, TRACES_DIR, 'sess1');
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'session.json'), JSON.stringify({ command: 'exec-phase', phase: '09' }));
    const p = writeTranscript([{ type: 'assistant', message: { usage: { input_tokens: 1 } } }]);
    const ev = completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', transcript_path: p }, 'sess1', tmpDir));
    assert.equal(ev.phase, '09');
    assert.equal(ev.context.command, 'exec-phase');
  });

  test('ensureSessionId rolls over a stale day-scoped auto-session and finalizes it', () => {
    const optDir = path.join(tmpDir, PLANNING_DIR, OPTIMIZE_DIR);
    const yStamp = new Date(Date.now() - 86400000).toISOString().replace(/[-:T]/g, '').slice(0, 8);
    const stale = `sess_auto_${yStamp}`;
    const sdir = path.join(optDir, TRACES_DIR, stale);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(optDir, 'current-session'), stale + '\n');
    fs.writeFileSync(path.join(sdir, 'session.json'), JSON.stringify({ session_id: stale, started_at: '2026-01-01T00:00:00Z', event_count: 0, auto: true }));
    fs.writeFileSync(path.join(sdir, TRACE_EVENT_FILE), JSON.stringify({ type: 'decision', agent: 'a' }) + '\n' + JSON.stringify({ type: 'error', agent: 'b' }) + '\n');

    const fresh = ensureSessionId(tmpDir);
    assert.notEqual(fresh, stale, 'a fresh day-scoped session is minted');
    assert.match(fresh, /^sess_auto_\d{8}$/);
    const finalized = JSON.parse(fs.readFileSync(path.join(sdir, 'session.json'), 'utf-8'));
    assert.ok(finalized.ended_at, 'stale session finalized with ended_at');
    assert.equal(finalized.event_count, 2, 'event_count reconciled from trace.jsonl');
    assert.equal(finalized.type_counts.error, 1);
  });

  test('an explicit (non-auto) session stays sticky — no rollover', () => {
    const optDir = path.join(tmpDir, PLANNING_DIR, OPTIMIZE_DIR);
    fs.mkdirSync(optDir, { recursive: true });
    fs.writeFileSync(path.join(optDir, 'current-session'), 'sess_20260101T120000\n');
    assert.equal(ensureSessionId(tmpDir), 'sess_20260101T120000');
  });
});
