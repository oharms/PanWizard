// Claude rates corrected and Haiku 5.5 priced (market-ideas queue M35, M36).
//
// The Anthropic pricing page (read 2026-10-10) prices a Sonnet 5.5 cache hit at
// $0.10 (0.05x input); PAN had $0.20. Claude Haiku 5.5 became the `haiku` alias on
// the Anthropic API in Claude Code 2.1.293 — PAN's fast tier there — and PAN had no
// row for it, so its calls priced as unknown. Haiku 5.5 is also the first model
// priced by prompt length: a request whose prompt (input plus cache reads and
// writes) is over 100,000 tokens bills every rate at 5x. A ledger row sums many
// requests, so the hook and `cost rebuild` keep those requests' tokens apart as
// `long_prompt`, and computeCost prices that part at the long rate.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCostRecord, readUsageFromTranscript } = require('../hooks/pan-cost-logger.js');
const { sumTranscriptUsage } = require('../pan-wizard-core/bin/lib/cost-rebuild.cjs');
const { computeCost, resolveRate, effectiveRates, LONG_PROMPT_THRESHOLD } = require('../pan-wizard-core/bin/lib/cost.cjs');
const { detectModelCapabilities } = require('../bin/install-lib.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

const turn = (id, model, input, cacheRead, output = 100) => JSON.stringify({
  type: 'assistant',
  timestamp: '2026-10-10T10:00:00Z',
  sessionId: 'lp-session',
  message: { id, model, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } },
});

describe('the rate table matches the pricing page of 2026-10-10', () => {
  test('a Sonnet 5.5 cache hit is $0.10, half of Sonnet 5\'s', () => {
    assert.equal(resolveRate('claude-sonnet-5-5').cache_read, 0.10);
    assert.equal(resolveRate('claude-sonnet-5').cache_read, 0.20);
    assert.equal(resolveRate('claude-sonnet-5-5-20261001').cache_read, 0.10, 'a dated id takes the 5.5 row');
  });

  test('Haiku 5.5 has its own row, with a 5x long-prompt tier above 100,000 tokens', () => {
    const r = resolveRate('claude-haiku-5-5');
    assert.deepEqual([r.input, r.output, r.cache_read, r.cache_write, r.cache_write_1h], [0.10, 0.50, 0.01, 0.125, 0.20]);
    assert.deepEqual([r.long.above, r.long.input, r.long.output, r.long.cache_read, r.long.cache_write, r.long.cache_write_1h],
      [100000, 0.50, 2.50, 0.05, 0.625, 1.0]);
    assert.notEqual(resolveRate('claude-haiku-4-5').input, r.input, 'not priced at Haiku 4.5\'s row');
  });
});

describe('computeCost prices the long-prompt part at the long rate', () => {
  const row = { model: 'claude-haiku-5-5', input_tokens: 30000, output_tokens: 3000, cache_read_tokens: 400000, cache_write_tokens: 0 };

  test('a row with no long requests prices at the base rate', () => {
    // 30k * 0.10 + 3k * 0.50 + 400k * 0.01 = 3000 + 1500 + 4000 = 8500 / 1e6
    assert.equal(computeCost(row), 0.0085);
  });

  test('the long part bills at 5x and the rest at the base rate', () => {
    const long = { above: 100000, input_tokens: 10000, output_tokens: 1000, cache_read_tokens: 200000, cache_write_tokens: 0 };
    // long: 10k*0.5 + 1k*2.5 + 200k*0.05 = 5000+2500+10000 = 17500; rest: 20k*0.1 + 2k*0.5 + 200k*0.01 = 2000+1000+2000 = 5000
    assert.equal(computeCost({ ...row, long_prompt: long }), 0.0225);
  });

  test('a split measured at another threshold is not re-cut', () => {
    assert.equal(computeCost({ ...row, long_prompt: { above: 200000, input_tokens: 30000, output_tokens: 3000, cache_read_tokens: 400000 } }), 0.0085);
  });

  test('a model with no long tier ignores the split', () => {
    const sonnet = { ...row, model: 'claude-sonnet-5-5', long_prompt: { above: 100000, input_tokens: 30000, output_tokens: 3000, cache_read_tokens: 400000 } };
    assert.equal(computeCost(sonnet), computeCost({ ...row, model: 'claude-sonnet-5-5' }));
  });

  test('a managed-pricing multiplier scales the long rates too', () => {
    const rates = effectiveRates({}, { multiplier: 2 });
    assert.equal(resolveRate('claude-haiku-5-5', null, rates).long.input, 1.0);
  });
});

describe('the transcript readers keep the long-prompt requests apart', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lp-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, lines) => { const p = path.join(dir, name); fs.writeFileSync(p, lines.join('\n') + '\n'); return p; };

  test('the hook counts only requests whose prompt, cache included, is over the threshold', () => {
    const f = write('a.jsonl', [
      turn('m1', 'claude-haiku-5-5', 5000, 60000),   // 65k: base
      turn('m2', 'claude-haiku-5-5', 2000, 120000),  // 122k: long
      turn('m3', 'claude-haiku-5-5', 1000, 99000),   // exactly 100k: not over
    ]);
    const u = readUsageFromTranscript(f, 'lp-session', 0);
    assert.equal(u.input_tokens, 8000);
    assert.deepEqual(u.long_prompt, { above: 100000, input_tokens: 2000, output_tokens: 100, cache_read_tokens: 120000, cache_write_tokens: 0, cache_write_1h_tokens: 0 });
  });

  test('a transcript with no long requests has no field', () => {
    const u = readUsageFromTranscript(write('b.jsonl', [turn('m1', 'claude-haiku-5-5', 5000, 60000)]), 'lp-session', 0);
    assert.ok(!('long_prompt' in u));
  });

  test('cost rebuild applies the same rule', () => {
    const u = sumTranscriptUsage(write('agent-x.jsonl', [turn('m1', 'claude-haiku-5-5', 5000, 60000), turn('m2', 'claude-haiku-5-5', 2000, 120000)]));
    assert.equal(u.long_prompt.cache_read_tokens, 120000);
    assert.equal(u.long_prompt.input_tokens, 2000);
  });

  test('the hook\'s threshold is the library\'s', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'pan-cost-logger.js'), 'utf8');
    const m = /const LONG_PROMPT_THRESHOLD = (\d+);/.exec(src);
    assert.ok(m, 'the hook declares the threshold');
    assert.equal(Number(m[1]), LONG_PROMPT_THRESHOLD);
  });
});

describe('the ledger row carries the split, and the read side prices it', () => {
  let tmp, home;
  const SESSION = 'lp-session';
  beforeEach(() => {
    tmp = createTempProject();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lp-home-'));
    fs.mkdirSync(path.join(home, SESSION, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(home, `${SESSION}.jsonl`), '');
  });
  afterEach(() => { cleanup(tmp); fs.rmSync(home, { recursive: true, force: true }); });

  test('a Haiku 5.5 agent with a long request is priced above the flat base rate', () => {
    fs.writeFileSync(path.join(home, SESSION, 'subagents', 'agent-ab12.jsonl'),
      [turn('m1', 'claude-haiku-5-5', 5000, 60000), turn('m2', 'claude-haiku-5-5', 2000, 120000)].join('\n') + '\n');
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', agent_id: 'ab12', session_id: SESSION, transcript_path: path.join(home, `${SESSION}.jsonl`) }, tmp);
    assert.equal(rec.model, 'claude-haiku-5-5');
    assert.equal(rec.long_prompt.cache_read_tokens, 120000);
    const flat = computeCost({ ...rec, long_prompt: undefined });
    assert.ok(computeCost(rec) > flat, `long part billed higher: ${computeCost(rec)} vs ${flat}`);
  });
});

describe('Haiku 5.5 as a model PAN routes to', () => {
  test('its capability row has 1M context and thinking', () => {
    assert.deepEqual(detectModelCapabilities('claude-haiku-5-5'), { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'fast' });
    assert.equal(detectModelCapabilities('claude-haiku-4-5').has_1m_ctx, false, 'Haiku 4.5 keeps its profile');
  });

  test('OpenCode\'s Anthropic fast tier is Haiku 5.5', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'core.cjs'), 'utf8');
    const block = src.slice(src.indexOf('const OPENCODE_MODELS = {'), src.indexOf('};', src.indexOf('const OPENCODE_MODELS = {')));
    assert.match(block, /anthropic: \{[^}]*fast: 'anthropic\/claude-haiku-5-5'/);
    assert.match(block, /default: +\{[^}]*fast: 'anthropic\/claude-haiku-5-5'/);
  });
});
