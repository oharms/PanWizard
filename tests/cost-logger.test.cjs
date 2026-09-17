/**
 * Tests for hooks/pan-cost-logger.js — SubagentStop cost capture, including
 * the 2026-06 model-capture fix (SubagentStop payloads carry no model id;
 * the transcript's assistant messages do).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildCostRecord, readUsageFromTranscript } = require('../hooks/pan-cost-logger.js');

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-costlog-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeTranscript(lines) {
  const p = path.join(tmpDir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

describe('readUsageFromTranscript — model capture', () => {
  test('captures message.model alongside usage', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-opus-4-8-20260301', usage: { input_tokens: 100, output_tokens: 50 } } },
    ]);
    const out = readUsageFromTranscript(p, null);
    assert.equal(out.model, 'claude-opus-4-8-20260301');
    assert.equal(out.input_tokens, 100);
  });

  test('last-seen model wins across a mid-session switch', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 10 } } },
      { type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 20 } } },
    ]);
    assert.equal(readUsageFromTranscript(p, null).model, 'claude-opus-4-8');
  });

  test('model is null when the transcript carries none', () => {
    const p = writeTranscript([{ type: 'assistant', message: { usage: { input_tokens: 5 } } }]);
    assert.equal(readUsageFromTranscript(p, null).model, null);
  });
});

describe('buildCostRecord — model resolution', () => {
  test('payload model wins when present', () => {
    const rec = buildCostRecord({
      hook_event_name: 'SubagentStop',
      model: 'claude-fable-5',
      usage: { input_tokens: 1, output_tokens: 1 },
    }, tmpDir);
    assert.equal(rec.model, 'claude-fable-5');
  });

  test('transcript slice is authoritative over the payload usage (cumulative-counter fix)', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-opus-4-8-20260301', usage: { input_tokens: 7, output_tokens: 3 } } },
    ]);
    const rec = buildCostRecord({
      hook_event_name: 'SubagentStop',
      transcript_path: p,
      // SubagentStop `usage` is a CUMULATIVE session counter — it must NOT override
      // the per-call transcript slice when a transcript is available (the P0 fix).
      usage: { input_tokens: 11, output_tokens: 4 },
    }, tmpDir);
    assert.equal(rec.model, 'claude-opus-4-8-20260301', 'model comes from the transcript');
    assert.equal(rec.input_tokens, 7, 'per-call transcript slice wins over the cumulative payload usage');
    assert.equal(rec.output_tokens, 3);
  });

  test('transcript supplies both usage and model in headless mode (P-1805 path)', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 1000 } } },
    ]);
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(rec.model, 'claude-sonnet-4-6');
    assert.equal(rec.input_tokens, 200);
    assert.equal(rec.cache_read_tokens, 1000);
  });
});

describe('buildCostRecord — per-subagent delta (field report 2026-06)', () => {
  test('a second SubagentStop counts only newly-appended records, not the cumulative transcript', () => {
    const p = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000 } } }) + '\n');
    const r1 = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(r1.input_tokens, 100);
    assert.equal(r1.cache_read_tokens, 5000);

    // a second subagent appends its own turn — the shared transcript grows
    fs.appendFileSync(p, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 6000 } } }) + '\n');
    const r2 = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(r2.input_tokens, 200, 'only the appended record, not the cumulative 300');
    assert.equal(r2.cache_read_tokens, 6000, 'cache_read must not be re-summed across the whole transcript');
  });

  test('a repeated SubagentStop with no new records logs zeros, not a re-sum', () => {
    const p = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 50, cache_read_input_tokens: 9000 } } }) + '\n');
    assert.equal(buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir).cache_read_tokens, 9000);
    const again = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(again.input_tokens, 0, 'no new transcript records → zero');
    assert.equal(again.cache_read_tokens, 0, 'no phantom re-counted cache-read');
  });

  test('readUsageFromTranscript honours sinceLine and returns lineCount', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { usage: { input_tokens: 1 } } },
      { type: 'assistant', message: { usage: { input_tokens: 2 } } },
      { type: 'assistant', message: { usage: { input_tokens: 4 } } },
    ]);
    const all = readUsageFromTranscript(p, null, 0);
    assert.equal(all.input_tokens, 7);
    assert.equal(all.lineCount, 3);
    const tail = readUsageFromTranscript(p, null, 2);
    assert.equal(tail.input_tokens, 4, 'only the 3rd record');
    assert.equal(tail.lineCount, 3);
  });
});

describe('buildCostRecord — plausibility guard (cumulative-counter safety net)', () => {
  test('no transcript: impossible per-call magnitudes from a cumulative usage are dropped to 0', () => {
    // Real field values from the cumulative-counter bug (2026-07): a single
    // SubagentStop usage carrying tens-of-millions output + billions cache-read.
    const rec = buildCostRecord({
      hook_event_name: 'SubagentStop',
      usage: { output_tokens: 41296311, cache_read_input_tokens: 13955330167 },
    }, tmpDir);
    assert.equal(rec.output_tokens, 0, 'impossible per-call output dropped');
    assert.equal(rec.cache_read_tokens, 0, 'impossible per-call cache-read dropped');
  });

  test('no transcript: a normal small usage passes through unchanged', () => {
    const rec = buildCostRecord({
      hook_event_name: 'SubagentStop',
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 8000 },
    }, tmpDir);
    assert.equal(rec.input_tokens, 1200);
    assert.equal(rec.output_tokens, 300);
    assert.equal(rec.cache_read_tokens, 8000);
  });
});

describe('buildCostRecord — v3.21.0 enrichment (duration / tier / provenance / schema)', () => {
  test('duration_ms is the first→last timestamp span of the slice', () => {
    const p = writeTranscript([
      { type: 'assistant', timestamp: '2026-07-30T10:00:00.000Z', message: { model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } } },
      { type: 'assistant', timestamp: '2026-07-30T10:00:05.000Z', message: { usage: { output_tokens: 7 } } },
    ]);
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(rec.duration_ms, 5000);
  });

  test('duration_ms is null (not 0) when records carry no timestamp', () => {
    const p = writeTranscript([{ type: 'assistant', message: { usage: { input_tokens: 10 } } }]);
    assert.equal(buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir).duration_ms, null);
  });

  test('tier is reverse-mapped from the model family', () => {
    // Distinct paths — the cost cursor is keyed by transcript_path, so reusing
    // one path across two buildCostRecord calls would skip the second slice.
    const opus = path.join(tmpDir, 'opus.jsonl');
    fs.writeFileSync(opus, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } } }) + '\n');
    assert.equal(buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: opus }, tmpDir).tier, 'reasoning');
    const haiku = path.join(tmpDir, 'haiku.jsonl');
    fs.writeFileSync(haiku, JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 1 } } }) + '\n');
    assert.equal(buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: haiku }, tmpDir).tier, 'fast');
  });

  test('every record carries the numeric schema version', () => {
    const p = writeTranscript([{ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } } }]);
    assert.equal(typeof buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir).v, 'number');
  });

  test('a clamped fallback zero is marked, distinguishable from a real zero', () => {
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', usage: { output_tokens: 5e8 } }, tmpDir);
    assert.equal(rec.output_tokens, 0, 'implausible value dropped');
    assert.equal(rec.clamped, true, 'marked as clamped');
    assert.equal(rec.token_source, 'usage-fallback');
  });

  test('a genuine transcript zero is NOT marked clamped', () => {
    const p = writeTranscript([{ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 0, output_tokens: 0 } } }]);
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(rec.clamped, false);
    assert.equal(rec.token_source, 'transcript');
  });

  // The session fixture carries started_at because a real one does (initTraceSession
  // writes it) and because the pointer is only evidence while the session is alive — a
  // field project still pointed at a 17 July session on 17 September, and every row in
  // between had inherited its command and phase (sweep 2026-09-17).
  const writeSession = (sid, meta) => {
    const optDir = path.join(tmpDir, '.planning', 'optimization');
    fs.mkdirSync(path.join(optDir, 'traces', sid), { recursive: true });
    fs.writeFileSync(path.join(optDir, 'current-session'), sid + '\n');
    fs.writeFileSync(path.join(optDir, 'traces', sid, 'session.json'),
      JSON.stringify({ session_id: sid, started_at: new Date().toISOString(), ended_at: null, ...meta }));
  };

  test('command/phase are backfilled from the active trace session', () => {
    writeSession('sess_x', { command: 'exec-phase', phase: '07' });
    const p = writeTranscript([{ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } } }]);
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(rec.command, 'exec-phase');
    assert.equal(rec.phase, '07');
  });

  test('a long-dead session backfills nothing', () => {
    writeSession('sess_old', { command: 'army', phase: '03', started_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() });
    const p = writeTranscript([{ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } } }]);
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir);
    assert.equal(rec.command, null, 'two months quiet is not the session running now');
    assert.notEqual(rec.phase, '03');
  });

  test('a session whose meta carries no timestamps cannot be shown to be alive', () => {
    writeSession('sess_nots', { command: 'exec-phase', phase: '07', started_at: undefined });
    const p = writeTranscript([{ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } } }]);
    assert.equal(buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir).command, null);
  });

  test('command stays null when no active session exists', () => {
    const p = writeTranscript([{ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1 } } }]);
    assert.equal(buildCostRecord({ hook_event_name: 'SubagentStop', transcript_path: p }, tmpDir).command, null);
  });
});
