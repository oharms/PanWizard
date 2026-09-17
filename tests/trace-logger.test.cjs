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

// A1/N26 + A2/N29. The marker layer (N25-N27, above) decides whether an event is
// ADMITTED; this suite pins what the TRACE FILE ends up holding, which is where the
// defect lived: the per-invocation discriminator was hashed into the seen-event
// signature but never written into the completion event, so two admitted same-type
// siblings emitted completions byte-identical modulo `ts` and the pre-existing
// identity dedup dropped the second. Reproduced before the fix: a 3-sibling
// same-type wave wrote 2 completions.
//
// Each case names the assertion that fails if the `event_sig` context field is
// reverted, so a future reader can tell the six cases apart — several of them are
// distinguished only by which layer does the suppressing. Mirrors the matrix in
// tests/cost-logger-hook.test.cjs (the two hooks share this schema decision).
//
// WHAT `agent_id` IS IN CASES (3) AND (4): a stand-in for "some per-invocation
// field", not a field PAN has observed. Nothing in this repo establishes that a
// real SubagentStop payload carries `agent_id` or any other per-invocation
// identifier — `grep -rn agent_id hooks/ pan-wizard-core/ docs/` finds only PAN's
// own agent-tracking artifacts (written by workflows, not by the host) plus these
// tests. What the repo HAS observed, from the trace rows THIS hook recorded from
// real payloads under experiments/*/.planning/optimization/traces/ and from
// docs/FIELD-REPORT-army-2026-06.md:
//   • `agent_type`/`subagent_type` is supplied, and varies between DIFFERENT-type
//     siblings — which is what makes case (2) real and unconditional;
//   • `session_id` is SHARED with the parent, and so is the session transcript;
//   • `model` and `phase` came out null (the payload carried neither), and
//     `usage` is absent entirely in headless mode.
// So NO payload field is confirmed to vary between two CONCURRENT SAME-TYPE
// siblings on any host. Cases (3) and (4) therefore pin a CONDITIONAL benefit:
// what the trace file holds when the host does supply some per-invocation field.
// Where it supplies none, the two payloads are the same bytes and the second
// sibling stays suppressed by design — the residual pinned by case (1) of the N17
// suite above.
describe('pan-trace-logger — A1/A2 completion discriminator (six-case behavior matrix)', () => {
  const completions = (sessionId) => fs.readFileSync(traceFile(sessionId), 'utf-8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.category === 'agent_completion');
  // One-record transcript: whichever event arrives first consumes a real slice.
  const transcript = (name) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', message: { usage: { input_tokens: 1200, output_tokens: 34 } },
    }) + '\n');
    return p;
  };
  const fire = (data, sid = 'sess1') => appendTraceEvents(tmpDir, buildTraceEvents(data, sid, tmpDir), sid);

  test('(1) a true byte-identical re-fire yields exactly ONE completion', () => {
    const p = transcript('refire.jsonl');
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    assert.equal(fire(ev), true);
    assert.equal(fire(ev), false, 'the same event delivered twice is suppressed');
    assert.equal(completions('sess1').length, 1);
  });

  test('(1b) a byte-identical re-fire with NO transcript_path is still caught by the completion dedup', () => {
    // No transcript → the marker layer is never consulted, so the last-completion
    // dedup is the only guard. Both completions carry the SAME event_sig because
    // the payload is the same bytes. REVERT CHECK (in the other direction): this
    // assertion is what fails if the discriminator is ever made per-event-unique —
    // a counter, a nonce, a timestamp — instead of derived from the payload.
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: 's1', usage: { input_tokens: 9, output_tokens: 2 } };
    assert.equal(fire(ev), true);
    assert.equal(fire(ev), false, 'identical payload → identical discriminator → duplicate');
    assert.equal(completions('sess1').length, 1);
  });

  test('(2) interleaved dual registration A, B, A′, B′ yields exactly TWO completions, no phantoms', () => {
    const p = transcript('interleaved.jsonl');
    const A = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const B = { hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' };
    assert.equal(fire(A), true, 'A consumes the real slice');
    assert.equal(fire(B), true, 'sibling B is recorded with zero tokens');
    assert.deepEqual(buildTraceEvents(A, 'sess1', tmpDir), [], "A′ is A's re-fire → emits nothing");
    assert.deepEqual(buildTraceEvents(B, 'sess1', tmpDir), [], "B′ is B's re-fire → emits nothing");
    assert.equal(completions('sess1').length, 2, 'A + B only');
  });

  test('(3) two same-type siblings with distinct per-invocation identity yield TWO completions', () => {
    // The audit's reproduction. A verifier consumes the shared transcript FIRST, so
    // both same-type siblings then see an empty slice and emit completions equal in
    // every field except the discriminator — the exact input the last-completion
    // dedup used to collapse.
    // REVERT CHECK: without event_sig in the context, the second `fire` returns
    // false ("the second same-type sibling is recorded") and the count is 2, not 3.
    const p = transcript('pair.jsonl');
    assert.equal(fire({ hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' }), true,
      'the verifier consumes the shared transcript');
    const sib = (id) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: id });
    assert.equal(fire(sib('exec-1')), true);
    assert.equal(fire(sib('exec-2')), true, 'the second same-type sibling is recorded');
    const c = completions('sess1');
    assert.equal(c.length, 3, 'verifier + both executors');
    // The two sibling completions are identical apart from ts and the discriminators
    // — the hashed signature, and since v3.29 the host's own `agent_id` carried in
    // the clear — which is precisely what saves the second one.
    const strip = (e) => {
      const { ts, ...rest } = e;
      const { event_sig, agent_id, ...ctx } = rest.context;
      return JSON.stringify({ ...rest, context: ctx });
    };
    assert.equal(strip(c[1]), strip(c[2]), 'the sibling completions differ in nothing else');
    assert.notEqual(c[1].context.event_sig, c[2].context.event_sig, 'distinct per-invocation discriminators');
    assert.deepEqual([c[1].context.agent_id, c[2].context.agent_id], ['exec-1', 'exec-2'], 'the host id is on the event itself');
  });

  test('(4) a 3-sibling same-type wave yields THREE completions', () => {
    // Reproduced as 2 completions before the fix: sibling 1 consumed the slice,
    // sibling 2 was recorded with zeros, and sibling 3's completion was
    // byte-identical to sibling 2's modulo ts, so the dedup dropped the batch.
    // REVERT CHECK: the third `fire` returns false and the count is 2.
    const p = transcript('wave.jsonl');
    const sib = (id) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: id });
    assert.equal(fire(sib('exec-1')), true, 'sibling 1 consumes the slice');
    assert.equal(fire(sib('exec-2')), true, 'sibling 2 (empty slice) is recorded');
    assert.equal(fire(sib('exec-3')), true, 'sibling 3 is recorded — not eaten as a duplicate of sibling 2');
    const c = completions('sess1');
    assert.equal(c.length, 3, 'a three-subagent wave counts three spawns');
    assert.equal(new Set(c.map((e) => e.context.event_sig)).size, 3, 'three distinct discriminators');
  });

  test('(5) a first fire with a missing/unreadable transcript_path yields ONE completion', () => {
    const missing = path.join(tmpDir, 'never-written.jsonl');
    const ev = buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: missing, session_id: 's9' }, 'sess1', tmpDir);
    assert.ok(completionOf(ev), 'a first fire still emits a completion');
    assert.equal(appendTraceEvents(tmpDir, ev, 'sess1'), true, 'the spawn is counted');
    const c = completions('sess1');
    assert.equal(c.length, 1);
    assert.equal(typeof c[0].context.event_sig, 'string', 'the completion still carries a discriminator');
  });

  test('(6) the M61 phantom — a re-fire after the cursor consumed the slice — stays suppressed', () => {
    // Same input as case (1); pinned separately because the SUPPRESSING LAYER is
    // what matters here: the marker layer returns no events at all, so nothing ever
    // reaches the dedup. The dedup could not catch this one (the phantom's zeros
    // differ from the real completion it follows), which is why the discriminator
    // change must not shift this case onto the dedup.
    const p = transcript('m61.jsonl');
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const first = buildTraceEvents(ev, 'sess1', tmpDir);
    assert.equal(completionOf(first).context.input_tokens, 1200);
    assert.equal(appendTraceEvents(tmpDir, first, 'sess1'), true);
    assert.deepEqual(buildTraceEvents(ev, 'sess1', tmpDir), [], 'suppressed by the marker layer, not by the dedup');
    assert.equal(completions('sess1').length, 1);
  });

  test('the discriminator is the event signature, carried in the completion context', () => {
    const p = transcript('shape.jsonl');
    assert.equal(fire({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' }), true);
    assert.match(completions('sess1')[0].context.event_sig, /^[0-9a-f]{40}$/);
  });

  test('a pre-discriminator trace file still parses and analyses (backward compatibility)', () => {
    const { analyzeEvents } = require('../pan-wizard-core/bin/lib/optimize.cjs');
    // Two completions exactly as the previous hook wrote them — v2, no event_sig.
    const legacy = (agent, input) => JSON.stringify({
      v: 2, ts: '2026-08-01T00:00:00.000Z', session: 'sess1', agent, phase: null,
      type: 'decision', category: 'agent_completion', description: `${agent} completed`,
      context: {
        model: null, command: null, input_tokens: input, output_tokens: 10,
        cache_read_tokens: 0, total_tokens: input + 10, duration_ms: null,
        exit_code: 0, token_source: 'transcript', clamped: false,
      },
      impact: 'trivial', correction: null, tokens_wasted: null,
    });
    const dir = path.dirname(traceFile('sess1'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(traceFile('sess1'), legacy('pan-executor', 500) + '\n' + legacy('pan-verifier', 700) + '\n');
    const before = analyzeEvents(completions('sess1'), {});
    assert.equal(before.summary.total_events, 2, 'events without the field still parse');
    assert.equal(before.summary.total_input_tokens, 1200, 'and still aggregate');
    // A new-shape completion appends alongside them, and the guard works normally
    // thereafter (a new event is never equal to one written in the older shape —
    // they differ in `v` as well as in the discriminator).
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-planner', session_id: 's1', usage: { input_tokens: 5, output_tokens: 1 } };
    assert.equal(fire(ev), true);
    assert.equal(fire(ev), false, 'the guard is live again on the following same-shape pair');
    assert.equal(completions('sess1').length, 3);
    const after = analyzeEvents(completions('sess1'), {});
    assert.equal(after.summary.total_input_tokens, 1205, 'mixed-shape trace files analyse as one');
    assert.equal(Object.keys(after.agent_stats).length, 3);
  });
});

// A4/N29 — how far the dedup reaches, where it stops, and the floor it must never
// cross. Mirrors the suite of the same name in tests/cost-logger-hook.test.cjs.
//
// A pass once tried to close the residual pinned below by widening the dedup: scan
// a tail of recent completions for an identical one, and additionally treat a
// repeated `context.event_sig` as a re-fire whenever the candidate carried no
// tokens on any axis and no measured duration. Both halves destroy real data, which
// is why the guard is back to comparing against the file's last completion only.
//
// The first two cases below are the floor — they are the reproduction that killed
// the widening, and they fail loudly if it is ever reintroduced. The rest pin the
// residual the simple guard leaves standing, so the hooks' comments can be checked
// against behavior instead of taken on trust.
describe('pan-trace-logger — A4 dedup reach, the data-loss floor, and the honest residual', () => {
  const completions = (sessionId) => fs.readFileSync(traceFile(sessionId), 'utf-8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.category === 'agent_completion');
  const transcript = (name) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', message: { usage: { input_tokens: 1200, output_tokens: 34 } },
    }) + '\n');
    return p;
  };
  // WAVE is deliberately larger than the hook's MAX_SEEN_SIGS so sibling 1's
  // signature is evicted from the marker FIFO by the time its re-fire arrives.
  const WAVE = 12;
  const sib = (p, i) => ({
    hook_event_name: 'SubagentStop', agent_type: 'pan-executor',
    transcript_path: p, session_id: 's1', agent_id: `exec-${i}`,
  });
  const fire = (data, sid = 'sess1') => appendTraceEvents(tmpDir, buildTraceEvents(data, sid, tmpDir), sid);

  // The shared transcript from docs/FIELD-REPORT-army-2026-06.md: one session
  // transcript every subagent appends to, so each spawn's slice is the records
  // added since the previous spawn's. Two agent types alternate, which makes each
  // repeat of a payload NON-ADJACENT in the trace file.
  const SPAWNS = ['X', 'Y', 'X', 'Y', 'X'];
  const PAYLOAD = {
    X: (p) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' }),
    Y: (p) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' }),
  };
  // One record per spawn. `usage: null` → the slice yields zeros; no `timestamp`
  // field → duration_ms stays null, so the completion looks "contentless" even
  // though the spawn was entirely real.
  const growBy = (p, usage) => fs.appendFileSync(p, JSON.stringify(
    usage ? { type: 'assistant', message: { usage } } : { type: 'assistant', message: {} },
  ) + '\n');
  const runSharedTranscript = (usageFor) => {
    const p = path.join(tmpDir, 'shared.jsonl');
    fs.writeFileSync(p, '');
    for (const which of SPAWNS) {
      growBy(p, usageFor(which));       // the subagent does its work…
      fire(PAYLOAD[which](p));          // …then SubagentStop fires for it
    }
    return completions('sess1');
  };

  test('no genuine spawn is ever dropped: five spawns X,Y,X,Y,X on one shared transcript whose slices carry no usage yield FIVE completions', () => {
    // THE DATA-LOSS FLOOR. Every one of these five events is a distinct real spawn;
    // none is a re-fire. Because X's payload is byte-identical each time it runs
    // (agent type, session id and transcript path are all shared — the field
    // report's topology) all three X completions carry ONE signature, and because
    // the slices hold no usage and no timestamps every completion is all-zero with
    // a null duration.
    //
    // WHICH ASSERTION FAILS IF THE WINDOW SCAN IS REINTRODUCED: this test's first
    // assertion — `completions('sess1').length === SPAWNS.length` — reports 2
    // instead of 5. Spawns 3, 4 and 5 are eaten, by either half of the widening
    // independently: the identity scan finds spawn 1's completion (identical modulo
    // `ts`) further back in the tail, and the signature prong finds spawn 1's
    // `event_sig` on a candidate that looks contentless. The `agents` assertion then
    // reports ['pan-executor','pan-verifier'].
    const c = runSharedTranscript(() => null);
    assert.equal(c.length, SPAWNS.length, 'five real spawns, five completions');
    assert.deepEqual(c.map((e) => e.agent),
      ['pan-executor', 'pan-verifier', 'pan-executor', 'pan-verifier', 'pan-executor'],
      'in spawn order, with no collapse of the repeated payloads');
    assert.equal(new Set(c.map((e) => e.context.event_sig)).size, 2,
      'only TWO signatures across the five completions — the signature is not an identity');
  });

  test('no genuine spawn is ever dropped, and real token counts survive with it', () => {
    // Same five spawns, now with real usage in each slice and each agent type's
    // slices identical to its own earlier ones — so the completions repeat exactly.
    // WHICH ASSERTION FAILS IF THE WINDOW SCAN IS REINTRODUCED: the token-sum
    // assertion — the identity scan drops spawns 3-5 and the sum reports 2000
    // instead of 5200, i.e. 3200 input tokens of real, billed usage deleted from the
    // trace. This is the case that makes the widening strictly worse than the
    // phantom completion it was chasing.
    const c = runSharedTranscript((which) => (which === 'X'
      ? { input_tokens: 1200, output_tokens: 340 }
      : { input_tokens: 800, output_tokens: 120 }));
    assert.equal(c.length, SPAWNS.length, 'five real spawns, five completions');
    assert.deepEqual(c.map((e) => e.context.input_tokens), [1200, 800, 1200, 800, 1200]);
    assert.equal(c.reduce((n, e) => n + e.context.input_tokens, 0), 5200, 'no billed tokens lost');
    assert.deepEqual(c.map((e) => e.context.output_tokens), [340, 120, 340, 120, 340]);
  });

  test('sequential subagents with byte-identical payloads on a growing transcript keep their counts', () => {
    // The same topology reduced to its smallest form and stated in the terms of
    // docs/FIELD-REPORT-army-2026-06.md: two subagents of the SAME type, same
    // session id, same transcript path, no usage in the payload — so byte-identical
    // payloads and therefore the same event_sig — each consuming a real slice as the
    // transcript grows. Here the completions differ in their token counts, so the
    // identity comparison cannot collapse them at any window width; it is the
    // signature prong alone that used to.
    const p = path.join(tmpDir, 'growing.jsonl');
    const rec = (usage) => JSON.stringify({ type: 'assistant', message: { usage } }) + '\n';
    fs.writeFileSync(p, rec({ input_tokens: 70, output_tokens: 64549 }));
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };

    assert.equal(fire(ev), true, 'the first subagent records its slice');
    fs.appendFileSync(p, rec({ input_tokens: 42, output_tokens: 9011 })); // next subagent appends
    assert.equal(fire(ev), true, 'the second subagent records ITS slice, same signature and all');

    const c = completions('sess1');
    assert.equal(c.length, 2);
    assert.equal(c[0].context.event_sig, c[1].context.event_sig, 'identical payloads → identical signature');
    assert.deepEqual(c.map((e) => e.context.input_tokens), [70, 42], 'both real token counts survive');
    assert.deepEqual(c.map((e) => e.context.output_tokens), [64549, 9011]);
  });

  test('the residual: a re-fire is suppressed while its signature is in the marker window, and emitted as a phantom completion once evicted', () => {
    // The hooks promise suppression only while a re-fire is still RECOGNIZABLE — its
    // signature in the per-transcript FIFO, or the completion it duplicates being
    // the last one in the file. This pins BOTH sides of that line so the comments
    // can be checked rather than trusted. If a future change suppresses the second
    // half too, update the comments in BOTH hooks first — and re-run the two
    // data-loss-floor cases above, because widening the guard is how the last
    // attempt paid for it.
    const p = transcript('wave.jsonl');
    for (let i = 1; i <= WAVE; i++) {
      assert.equal(fire(sib(p, i)), true, `sibling ${i} is recorded`);
    }
    assert.equal(completions('sess1').length, WAVE, 'every sibling spawn is counted');

    // Still recognizable: the NEWEST sibling's signature has not been evicted, so
    // the marker layer emits nothing at all for its re-fire.
    assert.deepEqual(buildTraceEvents(sib(p, WAVE), 'sess1', tmpDir), [],
      'the marker layer recognizes a recent re-fire');
    assert.equal(completions('sess1').length, WAVE, 'no phantom completion for the recent re-fire');

    // Past the window: sibling 1's dual registration arrives after the wave has
    // pushed its signature out of the FIFO, and sibling 1's completion is long past
    // being the file's last. Nothing left can tell it from a fresh zero-token spawn.
    const late = buildTraceEvents(sib(p, 1), 'sess1', tmpDir);
    const c = completionOf(late);
    assert.ok(c, 'the marker layer no longer recognizes it — its signature was evicted');
    assert.equal(c.context.event_sig, completions('sess1')[0].context.event_sig,
      'the signature it carries is still the one on sibling 1\'s completion — but nothing searches by it');
    assert.equal(appendTraceEvents(tmpDir, late, 'sess1'), true, 'the documented residual: it is emitted');
    assert.equal(completions('sess1').length, WAVE + 1,
      'one phantom completion — the accepted price of never dropping a real spawn');
  });

  test('the wider residual on the NO-transcript path: an interleaved dual registration leaves phantom completions', () => {
    // That path never consults the marker layer at all — there is no transcript to
    // key it by — so the last-completion comparison is the only guard. A′ and B′ are
    // not the file's last completion when they arrive, so both are emitted. Closing
    // this needs a lookback, and a lookback is exactly what the two floor cases
    // above forbid: the hook cannot tell this A′ from a genuine third spawn carrying
    // A's payload, and guessing wrong deletes real completions. Documented in the
    // hook rather than fixed.
    const A = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: 's1', usage: { input_tokens: 9, output_tokens: 2 } };
    const B = { hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', session_id: 's1', usage: { input_tokens: 5, output_tokens: 1 } };
    assert.equal(fire(A), true);
    assert.equal(fire(B), true);
    assert.equal(fire(A), true, "A′ is out of adjacency reach — emitted");
    assert.equal(fire(B), true, "B′ likewise");
    assert.deepEqual(completions('sess1').map((e) => e.agent),
      ['pan-executor', 'pan-verifier', 'pan-executor', 'pan-verifier'],
      'two real spawns + two phantoms — the residual, not a fix');
    // An ADJACENT re-fire on the same path is still suppressed, which is the reach
    // the simple guard does have (matrix case 1b pins it from the other side).
    assert.equal(fire(B), false, 'B″ arrives adjacent to B′ and is caught');
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

// Mirrors the cost logger's per-agent attribution (2026-09): the host passes the
// PARENT session transcript on SubagentStop; the subagent's own file sits under
// <session_id>/subagents/agent-<agent_id>.jsonl and is what a completion event
// should carry. See tests/cost-logger-hook.test.cjs for the field numbers.
describe('pan-trace-logger — per-agent transcript attribution', () => {
  test('slices the subagent\'s own transcript when agent_id names one; clamps and flags a session-sized parent slice otherwise', () => {
    const SESSION = 'f1e2d3c4-0000-4000-8000-000000000001';
    const parent = path.join(tmpDir, `${SESSION}.jsonl`);
    const line = (u, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { model: 'claude-opus-5', usage: u } });
    fs.writeFileSync(parent,
      line({ input_tokens: 100, output_tokens: 5000, cache_read_input_tokens: 900000000 }, '2026-09-01T08:00:00.000Z') + '\n'
      + line({ input_tokens: 100, output_tokens: 5000, cache_read_input_tokens: 100 }, '2026-09-09T08:00:00.000Z') + '\n');
    const sub = path.join(tmpDir, SESSION, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), line({ input_tokens: 10, output_tokens: 4000, cache_read_input_tokens: 50000 }, '2026-09-02T10:00:00.000Z') + '\n');
    const base = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: SESSION, transcript_path: parent };

    const own = completionOf(buildTraceEvents({ ...base, agent_id: 'a1' }, 'sess1', tmpDir));
    assert.equal(own.v, 4);
    assert.equal(own.context.token_source, 'agent-transcript');
    assert.equal(own.context.agent_id, 'a1');
    assert.equal(own.context.cache_read_tokens, 50000);
    assert.equal(own.context.output_tokens, 4000);
    assert.equal(own.context.clamped, false);

    const missing = completionOf(buildTraceEvents({ ...base, agent_id: 'absent' }, 'sess1', tmpDir));
    assert.equal(missing.context.token_source, 'agent-transcript-missing', 'a named agent without a file consumes nothing');
    assert.equal(missing.context.cache_read_tokens, 0);
    assert.equal(missing.context.clamped, false);

    const shared = buildTraceEvents(base, 'sess1', tmpDir);
    const c = completionOf(shared);
    assert.equal(c.context.token_source, 'transcript', 'no agent id at all → the parent slice');
    assert.equal(c.context.cache_read_tokens, 0, 'a 900M cache-read slice is a session, dropped');
    assert.equal(c.context.clamped, true);
    assert.equal(c.context.duration_ms, Date.parse('2026-09-09T08:00:00.000Z') - Date.parse('2026-09-01T08:00:00.000Z'),
      'the eight-day span is recorded as measured; the reader judges it');
    assert.equal(shared.some((e) => e.category === 'uncached_heavy_run'), false,
      'a guard-produced zero is not a cache miss — no redundancy event');
  });

  test('one turn, one usage: block records sharing a message.id are counted once, last snapshot wins', () => {
    const SESSION = 'f1e2d3c4-0000-4000-8000-000000000002';
    const parent = path.join(tmpDir, `${SESSION}.jsonl`);
    fs.writeFileSync(parent, '');
    const sub = path.join(tmpDir, SESSION, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const turn = (id, u) => JSON.stringify({ type: 'assistant', timestamp: '2026-09-02T10:00:00.000Z', message: { id, model: 'claude-opus-5', usage: u } });
    fs.writeFileSync(path.join(sub, 'agent-z1.jsonl'), [
      turn('m1', { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 1000 }),
      turn('m1', { input_tokens: 5, output_tokens: 80, cache_read_input_tokens: 1000 }),
      turn('m2', { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 1200 }),
    ].join('\n') + '\n');
    const c = completionOf(buildTraceEvents({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: SESSION, transcript_path: parent, agent_id: 'z1' }, 'sess1', tmpDir));
    assert.equal(c.context.cache_read_tokens, 2200, 'two turns, not three blocks');
    assert.equal(c.context.output_tokens, 90, "the turn's final snapshot");
  });

  test('a resumed agent is charged only its new lines; its byte-identical re-fire emits nothing; a Workflow-tool agent one level down resolves', () => {
    const SESSION = 'f1e2d3c4-0000-4000-8000-000000000003';
    const parent = path.join(tmpDir, `${SESSION}.jsonl`);
    fs.writeFileSync(parent, '');
    const sub = path.join(tmpDir, SESSION, 'subagents');
    fs.mkdirSync(path.join(sub, 'workflows', 'wf_x'), { recursive: true });
    const turn = (id, u, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5', usage: u } });
    const agentPath = path.join(sub, 'agent-r1.jsonl');
    fs.writeFileSync(agentPath, turn('a', { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 100 }, '2026-09-02T10:00:00.000Z') + '\n');
    const p = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: SESSION, transcript_path: parent, agent_id: 'r1' };
    const first = buildTraceEvents(p, 'sess1', tmpDir);
    assert.equal(completionOf(first).context.output_tokens, 10);
    assert.deepEqual(buildTraceEvents(p, 'sess1', tmpDir), [], 'no new lines, seen signature → re-fire, nothing emitted');
    fs.appendFileSync(agentPath, turn('b', { input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 200 }, '2026-09-02T10:05:00.000Z') + '\n');
    const resumed = completionOf(buildTraceEvents({ ...p, last_assistant_message: 'more' }, 'sess1', tmpDir));
    assert.equal(resumed.context.output_tokens, 20, 'only the delta');
    fs.writeFileSync(path.join(sub, 'workflows', 'wf_x', 'agent-w9.jsonl'), turn('w', { input_tokens: 5, output_tokens: 500, cache_read_input_tokens: 5000 }, '2026-09-03T10:00:00.000Z') + '\n');
    const wf = completionOf(buildTraceEvents({ ...p, agent_type: 'workflow-subagent', agent_id: 'w9' }, 'sess1', tmpDir));
    assert.equal(wf.context.token_source, 'agent-transcript');
    assert.equal(wf.context.cache_read_tokens, 5000);
  });
});
