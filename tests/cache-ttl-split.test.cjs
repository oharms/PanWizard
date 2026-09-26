// The cache-write lifetime split (market-ideas queue M13).
//
// Claude Code transcripts record, per turn, how many cache-write tokens went to
// the five-minute and to the one-hour cache:
//   usage.cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }
// (read from a real transcript on this machine, 2026-09-26). One-hour writes bill
// at 2x base input against 1.25x (platform.claude.com pricing, same date), and
// PAN's ledger dropped the split: every write priced as a five-minute one, and
// the TTL advice had to guess the lifetime from idle gaps. The hook and
// `cost rebuild` now keep the split when the transcript has it, computeCost
// prices it, and assessCacheTtl says whether its numbers were measured.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCostRecord, readUsageFromTranscript } = require('../hooks/pan-cost-logger.js');
const { sumTranscriptUsage } = require('../pan-wizard-core/bin/lib/cost-rebuild.cjs');
const { computeCost, effectiveRates, DEFAULT_RATES } = require('../pan-wizard-core/bin/lib/cost.cjs');
const { assessCacheTtl } = require('../pan-wizard-core/bin/lib/context-budget.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

// One assistant record in Claude Code's shape. A turn written as several content
// blocks repeats the same message.id and usage snapshot; the last one wins.
const turn = (id, ts, cw, split) => JSON.stringify({
  type: 'assistant',
  timestamp: ts,
  sessionId: 'ttl-session',
  message: {
    id, model: 'claude-opus-5-5',
    usage: {
      input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: cw,
      ...(split ? { cache_creation: { ephemeral_5m_input_tokens: split[0], ephemeral_1h_input_tokens: split[1] } } : {}),
    },
  },
});

describe('the transcript readers keep the split', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ttl-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name, lines) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };

  test('the hook reader sums both lifetimes, once per turn', () => {
    const f = write('a.jsonl', [
      turn('m1', '2026-09-26T10:00:00Z', 3000, [1000, 2000]),
      turn('m1', '2026-09-26T10:00:01Z', 3000, [1000, 2000]), // second content block, same turn
      turn('m2', '2026-09-26T10:01:00Z', 500, [0, 500]),
    ]);
    const u = readUsageFromTranscript(f, 'ttl-session', 0);
    assert.equal(u.cache_creation_input_tokens, 3500);
    assert.equal(u.cache_write_5m_tokens, 1000);
    assert.equal(u.cache_write_1h_tokens, 2500);
  });

  test('a transcript without the block leaves the fields absent', () => {
    const f = write('b.jsonl', [turn('m1', '2026-09-26T10:00:00Z', 3000, null)]);
    const u = readUsageFromTranscript(f, 'ttl-session', 0);
    assert.equal(u.cache_creation_input_tokens, 3000);
    assert.ok(!('cache_write_1h_tokens' in u));
    assert.ok(!('cache_write_5m_tokens' in u));
  });

  test('cost rebuild reads the same split from an agent file', () => {
    const f = write('agent-x.jsonl', [
      turn('m1', '2026-09-26T10:00:00Z', 3000, [1000, 2000]),
      turn('m2', '2026-09-26T10:01:00Z', 500, [0, 500]),
    ]);
    const u = sumTranscriptUsage(f);
    assert.equal(u.cache_write_tokens, 3500);
    assert.equal(u.cache_write_5m_tokens, 1000);
    assert.equal(u.cache_write_1h_tokens, 2500);
    const plain = sumTranscriptUsage(write('agent-y.jsonl', [turn('m1', '2026-09-26T10:00:00Z', 3000, null)]));
    assert.ok(!('cache_write_1h_tokens' in plain), 'no block, no field');
  });
});

describe('the ledger row carries the split only when it was measured', () => {
  let tmp, home;
  const SESSION = 'ttl-session';
  beforeEach(() => {
    tmp = createTempProject();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ttl-home-'));
    fs.mkdirSync(path.join(home, SESSION, 'subagents'), { recursive: true });
  });
  afterEach(() => { cleanup(tmp); fs.rmSync(home, { recursive: true, force: true }); });

  const payload = (id) => ({
    hook_event_name: 'SubagentStop', agent_type: 'pan-executor', agent_id: id, session_id: SESSION,
    transcript_path: path.join(home, `${SESSION}.jsonl`),
  });
  const agent = (id, lines) => fs.writeFileSync(path.join(home, SESSION, 'subagents', `agent-${id}.jsonl`), lines.join('\n') + '\n');

  test('a transcript with the block gives a row with both fields beside the total', () => {
    fs.writeFileSync(path.join(home, `${SESSION}.jsonl`), '');
    agent('a1b2c3', [turn('m1', '2026-09-26T10:00:00Z', 3000, [1000, 2000])]);
    const rec = buildCostRecord(payload('a1b2c3'), tmp);
    assert.equal(rec.token_source, 'agent-transcript');
    assert.equal(rec.cache_write_tokens, 3000);
    assert.equal(rec.cache_write_5m_tokens, 1000);
    assert.equal(rec.cache_write_1h_tokens, 2000);
  });

  test('a transcript without it gives the row it always did', () => {
    fs.writeFileSync(path.join(home, `${SESSION}.jsonl`), '');
    agent('d4e5f6', [turn('m1', '2026-09-26T10:00:00Z', 3000, null)]);
    const rec = buildCostRecord(payload('d4e5f6'), tmp);
    assert.equal(rec.cache_write_tokens, 3000);
    assert.ok(!('cache_write_1h_tokens' in rec));
    assert.ok(!('cache_write_5m_tokens' in rec));
  });

  test('the payload-usage fallback keeps the split too', () => {
    const rec = buildCostRecord({
      hook_event_name: 'SubagentStop', agent_type: 'pan-executor',
      usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 700, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 500 } },
    }, tmp);
    assert.equal(rec.token_source, 'usage-fallback');
    assert.equal(rec.cache_write_1h_tokens, 500);
    assert.equal(rec.cache_write_5m_tokens, 200);
  });
});

describe('computeCost prices the one-hour share at the one-hour rate', () => {
  const row = (extra) => ({ model: 'claude-opus-5-5', cache_write_tokens: 1_000_000, ...extra });

  test('every Anthropic row carries a one-hour rate of 2x base input', () => {
    const anthropic = Object.entries(DEFAULT_RATES).filter(([k]) => k.startsWith('claude-') || ['reasoning', 'mid', 'fast'].includes(k));
    assert.ok(anthropic.length >= 10, 'non-vacuity');
    for (const [id, r] of anthropic) assert.equal(r.cache_write_1h, r.input * 2, id);
    for (const [id, r] of Object.entries(DEFAULT_RATES).filter(([k]) => /^(gpt|gemini)-/.test(k))) {
      assert.ok(!('cache_write_1h' in r), `${id}: the provider reports no lifetime split`);
    }
  });

  test('a split row bills each share at its own rate; a row without the split is unchanged', () => {
    // Opus 5.5: 5-minute $5, one-hour $8 per million.
    assert.equal(computeCost(row({})), 5, 'no split → every write at the five-minute rate, as before');
    assert.equal(computeCost(row({ cache_write_1h_tokens: 1_000_000, cache_write_5m_tokens: 0 })), 8);
    assert.equal(computeCost(row({ cache_write_1h_tokens: 250_000, cache_write_5m_tokens: 750_000 })), 5.75);
  });

  test('a one-hour count larger than the total is capped at the total', () => {
    assert.equal(computeCost(row({ cache_write_1h_tokens: 9_000_000 })), 8);
  });

  test('a rate without a one-hour figure bills the one-hour share at cache_write', () => {
    const rates = { 'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } };
    assert.equal(computeCost(row({ cache_write_1h_tokens: 1_000_000 }), rates), 5);
  });

  test('a managed modelPricing row prices both lifetimes at its cacheWrite', () => {
    const rates = effectiveRates({}, { overrides: { 'claude-opus-5-5': { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 3.75 } } });
    assert.equal(computeCost(row({ cache_write_1h_tokens: 1_000_000 }), rates), 3.75);
  });
});

describe('assessCacheTtl prefers the measured split', () => {
  const at = (min, extra) => ({ ts: new Date(Date.UTC(2026, 8, 26, 0, min, 0)).toISOString(), cache_write_tokens: 5000, ...extra });

  test('writes that were one-hour writes are not re-writes after a short idle', () => {
    const r = assessCacheTtl([
      at(0, { cache_write_1h_tokens: 5000, cache_write_5m_tokens: 0 }),
      at(20, { cache_write_1h_tokens: 5000, cache_write_5m_tokens: 0 }),
      at(45, { cache_write_1h_tokens: 5000, cache_write_5m_tokens: 0 }),
    ]);
    assert.equal(r.basis, 'measured');
    assert.equal(r.writes_after_short_idle, 0);
    assert.equal(r.recommend, false, 'the one-hour lifetime is already in use');
    assert.equal(r.cache_write_1h_tokens, 15000);
  });

  test('measured five-minute writes after short idles still recommend, and say they were measured', () => {
    const r = assessCacheTtl([
      at(0, { cache_write_1h_tokens: 0, cache_write_5m_tokens: 5000 }),
      at(20, { cache_write_1h_tokens: 0, cache_write_5m_tokens: 5000 }),
      at(45, { cache_write_1h_tokens: 0, cache_write_5m_tokens: 5000 }),
    ]);
    assert.equal(r.recommend, true);
    assert.match(r.advice, /\(measured:/);
  });

  test('rows without the split fall back to the gap heuristic and say so', () => {
    const r = assessCacheTtl([at(0), at(20), at(45)]);
    assert.equal(r.basis, 'inferred');
    assert.equal(r.recommend, true);
    assert.match(r.advice, /\(inferred from idle gaps/);
    const mixed = assessCacheTtl([at(0), at(20, { cache_write_1h_tokens: 0, cache_write_5m_tokens: 5000 }), at(45)]);
    assert.equal(mixed.basis, 'mixed');
    assert.match(mixed.advice, /\(partly measured/);
  });
});
