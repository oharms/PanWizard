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
