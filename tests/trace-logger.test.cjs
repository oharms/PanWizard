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
const { spawnSync } = require('child_process');
const {
  buildTraceEvents, appendTraceEvents, isPanProject,
  PLANNING_DIR, OPTIMIZE_DIR, TRACES_DIR, TRACE_EVENT_FILE, CURRENT_SESSION_FILE,
} = require('../hooks/pan-trace-logger.js');

const TRACE_HOOK = path.join(__dirname, '..', 'hooks', 'pan-trace-logger.js');

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

describe('pan-trace-logger — M61 re-fired SubagentStop guard', () => {
  test('a re-fire with no new transcript records emits nothing (no phantom completion row)', () => {
    const p = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 5100, output_tokens: 250 } },
    }) + '\n');
    const data = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };

    const first = buildTraceEvents(data, 'sess1', tmpDir);
    assert.ok(completionOf(first), 'first fire emits a completion event');
    assert.equal(appendTraceEvents(tmpDir, first, 'sess1'), true);

    // Cursor is now past every record → the re-fire's slice is empty → no events.
    const second = buildTraceEvents(data, 'sess1', tmpDir);
    assert.deepEqual(second, [], 'a re-fire with an empty slice emits nothing');
    assert.equal(appendTraceEvents(tmpDir, second, 'sess1'), false);

    const completions = fs.readFileSync(traceFile('sess1'), 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => e.category === 'agent_completion');
    assert.equal(completions.length, 1, 'exactly one real completion row survives');
  });
});

describe('pan-trace-logger — N17 empty-slice: re-fires dropped, siblings + first-fires recorded', () => {
  const completions = (sessionId) => fs.readFileSync(traceFile(sessionId), 'utf-8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.category === 'agent_completion');

  test('(1) a dual-fire of the IDENTICAL event yields exactly ONE completion row (M61 preserved)', () => {
    const p = path.join(tmpDir, 'dual.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5100, output_tokens: 250 } } }) + '\n');
    const data = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };

    const first = buildTraceEvents(data, 'sess1', tmpDir);
    assert.ok(completionOf(first));
    assert.equal(appendTraceEvents(tmpDir, first, 'sess1'), true);

    const second = buildTraceEvents(data, 'sess1', tmpDir);
    assert.deepEqual(second, [], 'the identical re-fire emits nothing');
    assert.equal(appendTraceEvents(tmpDir, second, 'sess1'), false);

    assert.equal(completions('sess1').length, 1);
  });

  test('(2) two DISTINCT sibling subagents sharing a transcript yield TWO completion rows (N17a)', () => {
    const p = path.join(tmpDir, 'shared.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 4200, output_tokens: 180 } } }) + '\n');

    const evA = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' }, 'sess1', tmpDir);
    assert.equal(completionOf(evA).context.input_tokens, 4200, 'sibling A gets the real slice');
    assert.equal(appendTraceEvents(tmpDir, evA, 'sess1'), true);

    const evB = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' }, 'sess1', tmpDir);
    const cB = completionOf(evB);
    assert.ok(cB, 'a parallel sibling still emits a completion (not dropped as a phantom)');
    assert.equal(cB.context.input_tokens, 0, 'empty slice → zero tokens, but the spawn is counted');
    assert.equal(cB.agent, 'pan-verifier');
    assert.equal(appendTraceEvents(tmpDir, evB, 'sess1'), true);

    assert.equal(completions('sess1').length, 2, 'both sibling spawns are counted');
  });

  test('(3) a first fire whose transcript is unreadable yields ONE completion row (N17b)', () => {
    const missing = path.join(tmpDir, 'missing.jsonl');
    const ev = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: missing, session_id: 's9' }, 'sess1', tmpDir);
    const c = completionOf(ev);
    assert.ok(c, 'a first fire with an unreadable transcript still emits a completion');
    assert.equal(c.context.input_tokens, 0);
    assert.equal(c.agent, 'pan-planner');
    assert.equal(appendTraceEvents(tmpDir, ev, 'sess1'), true);

    assert.equal(completions('sess1').length, 1);
  });
});

describe('pan-trace-logger — N25/N26/N27 seen-event signatures (idempotency-marker rework)', () => {
  const completions = (sessionId) => fs.readFileSync(traceFile(sessionId), 'utf-8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.category === 'agent_completion');
  const traceCursorFile = () => path.join(tmpDir, PLANNING_DIR, OPTIMIZE_DIR, '.trace-cursor.json');

  test('(N25) interleaved dual registration A, B, A′, B′ yields exactly TWO completion rows', () => {
    // Pre-fix, the single-slot marker held only the LAST event per transcript,
    // so both re-fires mismatched the displaced key and emitted phantom
    // zero-token completions. The bounded seen-signature set drops both.
    const p = path.join(tmpDir, 't.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2001, output_tokens: 30 } } }) + '\n');
    const A = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const B = { hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' };

    assert.equal(appendTraceEvents(tmpDir, buildTraceEvents(A, 'sess1', tmpDir), 'sess1'), true, 'A consumes the real slice');
    assert.equal(appendTraceEvents(tmpDir, buildTraceEvents(B, 'sess1', tmpDir), 'sess1'), true, 'sibling B is recorded');

    assert.deepEqual(buildTraceEvents(A, 'sess1', tmpDir), [], "A′ is recognized as A's re-fire → emits nothing");
    assert.deepEqual(buildTraceEvents(B, 'sess1', tmpDir), [], "B′ is recognized as B's re-fire → emits nothing");

    assert.equal(completions('sess1').length, 2, 'exactly A + B — zero phantom completions');
  });

  test('(N26) two parallel siblings of the SAME agent type both emit completions when any payload field differs', () => {
    // Same-type executor wave: the full-payload signature distinguishes the
    // siblings via ANY differing field (here a per-subagent id). Byte-identical
    // sibling payloads remain indistinguishable from re-fires (suppressed —
    // pinned by N17 test (1) above).
    const p = path.join(tmpDir, 'wave.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 3003, output_tokens: 41 } } }) + '\n');
    const s1 = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: 'exec-1' };
    const s2 = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: 'exec-2' };

    assert.equal(appendTraceEvents(tmpDir, buildTraceEvents(s1, 'sess1', tmpDir), 'sess1'), true, 'sibling 1 consumes the slice');

    const ev2 = buildTraceEvents(s2, 'sess1', tmpDir);
    const c2 = completionOf(ev2);
    assert.ok(c2, 'a same-type sibling with a distinct payload still emits a completion');
    assert.equal(c2.context.input_tokens, 0);
    assert.equal(appendTraceEvents(tmpDir, ev2, 'sess1'), true);
    assert.equal(completions('sess1').length, 2, 'the wave records both spawns');

    // ...while sibling 2's own byte-identical re-fire emits nothing.
    assert.deepEqual(buildTraceEvents(s2, 'sess1', tmpDir), [], "sibling 2's re-fire is dropped");
    assert.equal(completions('sess1').length, 2);
  });

  test('(N27) a missing-transcript first fire\'s marker survives the dead-transcript prune; its re-fire emits nothing even after an interleaved completion', () => {
    const missing = path.join(tmpDir, 'never-written.jsonl');
    const F = { hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: missing, session_id: 's9' };

    assert.equal(appendTraceEvents(tmpDir, buildTraceEvents(F, 'sess1', tmpDir), 'sess1'), true, 'first fire counts the spawn');

    // Marker persisted despite the transcript not existing — the pre-fix
    // writeTraceCursor existence-prune erased it inside this very call.
    const persisted = JSON.parse(fs.readFileSync(traceCursorFile(), 'utf-8'));
    assert.ok(persisted.__seenEvents && Array.isArray(persisted.__seenEvents[missing]) && persisted.__seenEvents[missing].length === 1,
      'the seen-event marker for the missing transcript reached disk');

    // An unrelated completion lands in between so the last-completion dedup
    // can no longer catch the re-fire — only the persisted marker can.
    assert.equal(appendTraceEvents(tmpDir, buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-researcher', session_id: 's9', usage: { input_tokens: 7, output_tokens: 1 } }, 'sess1', tmpDir), 'sess1'), true);

    assert.deepEqual(buildTraceEvents(F, 'sess1', tmpDir), [], 'the re-fire is recognized from the persisted marker');
    assert.equal(completions('sess1').length, 2, 'first fire + unrelated completion only — no phantom');
  });

  test('(L40) marker storage stays bounded: signature FIFO per transcript and transcript-count cap', () => {
    const missing = path.join(tmpDir, 'gone.jsonl');
    for (let i = 0; i < 12; i++) {
      buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: missing, session_id: 's1', agent_id: `a${i}` }, 'sess1', tmpDir);
    }
    for (let i = 0; i < 24; i++) {
      buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: path.join(tmpDir, `gone-${i}.jsonl`), session_id: 's2' }, 'sess1', tmpDir);
    }
    const persisted = JSON.parse(fs.readFileSync(traceCursorFile(), 'utf-8'));
    const seen = persisted.__seenEvents || {};
    assert.ok(Object.keys(seen).length <= 16, `at most 16 transcripts tracked (got ${Object.keys(seen).length})`);
    for (const sigs of Object.values(seen)) {
      assert.ok(Array.isArray(sigs) && sigs.length <= 8, 'at most 8 signatures per transcript');
    }
  });
});

describe('pan-trace-logger — M62 PAN-project gate', () => {
  test('isPanProject: true for .planning/ or a local install marker, else false', () => {
    const plan = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-t62-plan-'));
    const inst = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-t62-inst-'));
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-t62-plain-'));
    try {
      fs.mkdirSync(path.join(plan, '.planning'), { recursive: true });
      assert.equal(isPanProject(plan), true);
      fs.mkdirSync(path.join(inst, '.opencode', 'pan-wizard-core'), { recursive: true });
      assert.equal(isPanProject(inst), true, 'a local core payload marks a PAN project');
      assert.equal(isPanProject(plain), false);
    } finally {
      for (const d of [plan, inst, plain]) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('the stdin driver no-ops in a non-PAN repo (no optimization/trace artifacts)', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-t62-drv-'));
    try {
      const payload = { hook_event_name: 'SubagentStop', cwd: plain, session_id: 'test-sess', agent_type: 'pan-executor' };
      const res = spawnSync(process.execPath, [TRACE_HOOK], { input: JSON.stringify(payload), cwd: plain, encoding: 'utf8' });
      assert.equal(res.status, 0, 'hook never blocks the agent loop');
      assert.ok(!fs.existsSync(path.join(plain, PLANNING_DIR)), 'no .planning/ pollution in a non-PAN repo');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  test('the stdin driver creates a trace session in a PAN project', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-t62-proj-'));
    try {
      fs.mkdirSync(path.join(proj, PLANNING_DIR), { recursive: true }); // marks it a PAN project
      const payload = { hook_event_name: 'SubagentStop', cwd: proj, session_id: 's', agent_type: 'pan-executor' };
      const res = spawnSync(process.execPath, [TRACE_HOOK], { input: JSON.stringify(payload), cwd: proj, encoding: 'utf8' });
      assert.equal(res.status, 0);
      assert.ok(
        fs.existsSync(path.join(proj, PLANNING_DIR, OPTIMIZE_DIR, CURRENT_SESSION_FILE)),
        'an auto trace session is created in a PAN project'
      );
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
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
    // Distinct transcript paths: the trace cursor is keyed by transcript_path, so
    // reusing one path across two buildTraceEvents calls would leave the second
    // slice empty (cursor already past it) and emit nothing (the M61 re-fire guard).
    const p = path.join(tmpDir, 'dur-span.jsonl');
    fs.writeFileSync(p, [
      { type: 'assistant', timestamp: '2026-07-30T10:00:00.000Z', message: { usage: { input_tokens: 10 } } },
      { type: 'assistant', timestamp: '2026-07-30T10:00:03.000Z', message: { usage: { output_tokens: 4 } } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.equal(completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', transcript_path: p }, 's', tmpDir)).context.duration_ms, 3000);
    const p2 = path.join(tmpDir, 'dur-none.jsonl');
    fs.writeFileSync(p2, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1 } } }) + '\n');
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
