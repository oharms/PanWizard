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

  test('falls back to the transcript model when the payload has none', () => {
    const p = writeTranscript([
      { type: 'assistant', message: { model: 'claude-opus-4-8-20260301', usage: { input_tokens: 7, output_tokens: 3 } } },
    ]);
    const rec = buildCostRecord({
      hook_event_name: 'SubagentStop',
      transcript_path: p,
      usage: { input_tokens: 11, output_tokens: 4 }, // usage present — model pass must still run
    }, tmpDir);
    assert.equal(rec.model, 'claude-opus-4-8-20260301', 'model should come from the transcript');
    assert.equal(rec.input_tokens, 11, 'payload usage must not be overwritten');
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
