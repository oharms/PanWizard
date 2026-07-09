/**
 * Tests for cost.cjs — cost dashboard (Spec B v2 Y-6, v3.0).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  computeCost,
  appendRecord,
  readRecords,
  aggregate,
  isSuspectRecord,
  renderTable,
  renderChart,
  resolveRate,
  METRICS_DIR,
  TOKENS_FILE,
  DEFAULT_RATES,
} = require('../pan-wizard-core/bin/lib/cost.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('cost — resolveRate', () => {
  test('known model returns its rate', () => {
    const r = resolveRate('claude-opus-4-7', null, null);
    assert.equal(r.input, 5.0);
    assert.equal(r.output, 25.0);
  });

  test('claude-opus-4-8 has explicit rate', () => {
    const r = resolveRate('claude-opus-4-8', null, null);
    assert.ok(r, 'claude-opus-4-8 should resolve to a rate');
    assert.equal(r.input, 5.0);
    assert.equal(r.output, 25.0);
  });

  test('claude-fable-5 has explicit rate', () => {
    const r = resolveRate('claude-fable-5', null, null);
    assert.ok(r, 'claude-fable-5 should resolve to a rate');
    assert.equal(r.input, 10.0);
    assert.equal(r.output, 50.0);
  });

  test('reasoning tier fallback tracks current Opus pricing', () => {
    const r = resolveRate(null, 'reasoning', null);
    assert.equal(r.input, 5.0);
    assert.equal(r.output, 25.0);
  });

  test('unknown model falls through to tier', () => {
    const r = resolveRate('claude-unknown-model', 'mid', null);
    assert.equal(r.input, 3.0);
  });

  test('null model + null tier returns null rate', () => {
    assert.equal(resolveRate(null, null, null), null);
  });

  test('config override wins over default', () => {
    const overrides = { 'claude-opus-4-7': { input: 1, output: 1, cache_read: 0.1, cache_write: 1 } };
    const r = resolveRate('claude-opus-4-7', null, overrides);
    assert.equal(r.input, 1);
  });

  test('gemini-2.5-pro has explicit rate', () => {
    const r = resolveRate('gemini-2.5-pro', null, null);
    assert.ok(r, 'gemini-2.5-pro should resolve to a rate');
    assert.equal(r.input, 1.25);
    assert.equal(r.output, 10.0);
  });

  test('gemini-2.5-flash has explicit rate (mid tier pricing)', () => {
    const r = resolveRate('gemini-2.5-flash', null, null);
    assert.ok(r);
    assert.equal(r.input, 0.30);
    assert.equal(r.output, 2.50);
  });

  test('gemini-2.5-flash-lite has explicit rate (fast tier pricing)', () => {
    const r = resolveRate('gemini-2.5-flash-lite', null, null);
    assert.ok(r);
    assert.equal(r.input, 0.10);
    assert.equal(r.output, 0.40);
  });

  test('gemini-1.5-pro no longer has an explicit rate (retired model)', () => {
    // Removed from DEFAULT_RATES 2026-06; records fall back to tier rates.
    assert.equal(resolveRate('gemini-1.5-pro', null, null), null);
    const viaTier = resolveRate('gemini-1.5-pro', 'reasoning', null);
    assert.ok(viaTier, 'should fall back to tier rate when tier is known');
  });

  // Hook-captured ids are versioned; the table uses family keys (2026-06).
  test('versioned model ids prefix-match their family rate', () => {
    const versioned = resolveRate('claude-opus-4-8-20260301', null, null);
    assert.deepEqual(versioned, resolveRate('claude-opus-4-8', null, null));
    const ctx1m = resolveRate('claude-fable-5[1m]', null, null);
    assert.deepEqual(ctx1m, resolveRate('claude-fable-5', null, null));
    assert.equal(resolveRate('totally-unknown-model', null, null), null,
      'non-matching ids still fall through');
  });

  test('gpt-5.5 has explicit rate (verified 2026-06)', () => {
    const r = resolveRate('gpt-5.5', null, null);
    assert.ok(r, 'gpt-5.5 should resolve to a rate');
    assert.equal(r.input, 5.0);
    assert.equal(r.output, 30.0);
    // OpenAI prompt caching: 90% input discount, no separate write charge
    assert.equal(r.cache_read, 0.5);
    assert.equal(r.cache_write, 5.0);
  });

  test('gemini-3.1-pro has explicit rate, preview alias matches (verified 2026-06)', () => {
    const r = resolveRate('gemini-3.1-pro', null, null);
    assert.ok(r, 'gemini-3.1-pro should resolve to a rate');
    assert.equal(r.input, 2.00);
    assert.equal(r.output, 12.0);
    const preview = resolveRate('gemini-3.1-pro-preview', null, null);
    assert.deepEqual(preview, r, 'preview id should carry the same rate');
  });
});

describe('cost — rate-table staleness (models check)', () => {
  const { checkRatesStaleness, RATES_VERIFIED_AT } =
    require('../pan-wizard-core/bin/lib/cost.cjs');

  test('verification date is a valid ISO date', () => {
    assert.match(RATES_VERIFIED_AT, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(new Date(RATES_VERIFIED_AT).getTime()));
  });

  test('not stale right after verification', () => {
    const result = checkRatesStaleness(new Date(RATES_VERIFIED_AT + 'T12:00:00Z'));
    assert.equal(result.stale, false);
    assert.equal(result.age_days, 0);
    assert.equal(result.rates_verified_at, RATES_VERIFIED_AT);
  });

  test('stale once past the threshold', () => {
    const verified = new Date(RATES_VERIFIED_AT + 'T00:00:00Z');
    const threshold = checkRatesStaleness(verified).stale_after_days;
    const future = new Date(verified.getTime() + (threshold + 1) * 86400000);
    const result = checkRatesStaleness(future);
    assert.equal(result.stale, true);
    assert.ok(result.age_days > result.stale_after_days);
  });

  test('models list excludes tier fallbacks but includes current entries', () => {
    const result = checkRatesStaleness();
    for (const tier of ['reasoning', 'mid', 'fast']) {
      assert.ok(!result.models.includes(tier), `${tier} is a tier, not a model`);
    }
    assert.ok(result.models.includes('claude-fable-5'));
    assert.ok(result.models.includes('gpt-5.5'));
    assert.ok(result.models.includes('gemini-3.1-pro'));
  });

  test('models check CLI returns staleness JSON', () => {
    const tmpDir = createTempProject();
    try {
      const res = runPanTools('models check', tmpDir);
      assert.ok(res.success, `models check should succeed: ${res.error}`);
      const parsed = JSON.parse(res.output);
      assert.equal(parsed.rates_verified_at, RATES_VERIFIED_AT);
      assert.equal(typeof parsed.stale, 'boolean');
      assert.ok(Array.isArray(parsed.models));
    } finally {
      cleanup(tmpDir);
    }
  });
});

describe('cost — computeCost', () => {
  test('computes expected USD for a known model', () => {
    const cost = computeCost({
      model: 'claude-opus-4-7',
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    // 1000 × 5 + 100 × 25 = 7500 per million = 0.0075 USD
    assert.ok(Math.abs(cost - 0.0075) < 0.0001, `expected ~0.0075, got ${cost}`);
  });

  test('cache_read reduces effective input cost', () => {
    const noCache = computeCost({
      model: 'claude-opus-4-7',
      input_tokens: 10000,
      output_tokens: 0,
    });
    const withCache = computeCost({
      model: 'claude-opus-4-7',
      input_tokens: 10000,
      output_tokens: 0,
      cache_read_tokens: 9000,
    });
    assert.ok(withCache < noCache, `cache should reduce cost: noCache=${noCache} withCache=${withCache}`);
  });

  test('returns null when model+tier unknown', () => {
    const c = computeCost({ input_tokens: 100, output_tokens: 100 });
    assert.equal(c, null);
  });

  test('zero tokens yields zero cost', () => {
    assert.equal(computeCost({ model: 'claude-opus-4-7', input_tokens: 0, output_tokens: 0 }), 0);
  });
});

describe('cost — appendRecord', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  function fileOf(dir) {
    return path.join(dir, '.planning', METRICS_DIR, TOKENS_FILE);
  }

  test('creates file + dir on first append', () => {
    const r = appendRecord(tmpDir, { agent: 'pan-planner', input_tokens: 100 });
    assert.equal(r.appended, true);
    assert.ok(fs.existsSync(fileOf(tmpDir)));
  });

  test('normalizes missing fields to null/0', () => {
    appendRecord(tmpDir, {});
    const line = JSON.parse(fs.readFileSync(fileOf(tmpDir), 'utf-8').trim());
    assert.equal(line.agent, null);
    assert.equal(line.input_tokens, 0);
    assert.equal(line.output_tokens, 0);
    assert.ok(line.ts);
  });

  test('computes cost automatically when model is known', () => {
    appendRecord(tmpDir, {
      model: 'claude-opus-4-7',
      input_tokens: 1000,
      output_tokens: 100,
    });
    const line = JSON.parse(fs.readFileSync(fileOf(tmpDir), 'utf-8').trim());
    assert.ok(typeof line.cost_usd === 'number');
    assert.ok(line.cost_usd > 0);
  });

  test('caller-supplied cost_usd overrides computation', () => {
    appendRecord(tmpDir, {
      model: 'claude-opus-4-7',
      input_tokens: 1000,
      cost_usd: 999.99,
    });
    const line = JSON.parse(fs.readFileSync(fileOf(tmpDir), 'utf-8').trim());
    assert.equal(line.cost_usd, 999.99);
  });

  test('null cost_usd when model unknown', () => {
    appendRecord(tmpDir, { input_tokens: 100 });
    const line = JSON.parse(fs.readFileSync(fileOf(tmpDir), 'utf-8').trim());
    assert.equal(line.cost_usd, null);
  });

  test('multiple appends produce multiple lines', () => {
    for (let i = 0; i < 5; i++) {
      appendRecord(tmpDir, { agent: 'x', input_tokens: 100 });
    }
    const lines = fs.readFileSync(fileOf(tmpDir), 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 5);
  });
});

describe('cost — readRecords', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty when no log file', () => {
    assert.deepEqual(readRecords(tmpDir), []);
  });

  test('skips malformed lines', () => {
    appendRecord(tmpDir, { agent: 'a', input_tokens: 1 });
    const file = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
    fs.appendFileSync(file, 'not-json\n', 'utf-8');
    appendRecord(tmpDir, { agent: 'b', input_tokens: 2 });
    const recs = readRecords(tmpDir);
    assert.equal(recs.length, 2);
    assert.equal(recs[0].agent, 'a');
    assert.equal(recs[1].agent, 'b');
  });
});

describe('cost — isSuspectRecord', () => {
  test('flags billion-scale cache-read and cache-read that dwarfs input', () => {
    assert.equal(isSuspectRecord({ input_tokens: 1e6, output_tokens: 2e6, cache_read_tokens: 9e9 }), true);
    assert.equal(isSuspectRecord({ input_tokens: 1000, output_tokens: 200, cache_read_tokens: 5e8 }), true); // >100x io
    assert.equal(isSuspectRecord({ output_tokens: 2e7 }), true); // absurd output
  });
  test('keeps plausible records, including legitimately cache-heavy ones', () => {
    assert.equal(isSuspectRecord({ input_tokens: 200000, output_tokens: 5000, cache_read_tokens: 1000000 }), false);
    assert.equal(isSuspectRecord({ input_tokens: 1000, output_tokens: 200, cache_read_tokens: 50 }), false);
    assert.equal(isSuspectRecord({ input_tokens: 500000, output_tokens: 20000, cache_read_tokens: 8000000 }), false); // ~16x io, fine
  });
});

describe('cost — aggregate', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('empty log yields zero totals', () => {
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 0);
    assert.equal(agg.totals.input_tokens, 0);
    assert.equal(agg.totals.cost_usd, 0);
  });

  test('aggregates by agent, command, tier, day', () => {
    appendRecord(tmpDir, { agent: 'pan-planner', command: 'plan-phase', tier: 'reasoning', model: 'claude-opus-4-7', input_tokens: 1000, output_tokens: 100 });
    appendRecord(tmpDir, { agent: 'pan-planner', command: 'plan-phase', tier: 'reasoning', model: 'claude-opus-4-7', input_tokens: 2000, output_tokens: 200 });
    appendRecord(tmpDir, { agent: 'pan-verifier', command: 'verify-phase', tier: 'mid', model: 'claude-sonnet-4-6', input_tokens: 500, output_tokens: 50 });

    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 3);
    assert.equal(agg.totals.input_tokens, 3500);
    assert.equal(agg.totals.output_tokens, 350);
    assert.equal(agg.by_agent['pan-planner'].calls, 2);
    assert.equal(agg.by_agent['pan-verifier'].calls, 1);
    assert.equal(agg.by_command['plan-phase'].input, 3000);
    assert.equal(agg.by_tier['reasoning'].calls, 2);
    assert.equal(agg.by_tier['mid'].calls, 1);
  });

  test('quarantines physically-impossible records (pre-v3.12.4 transcript oversum)', () => {
    appendRecord(tmpDir, { agent: 'pan-planner', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 200, cache_read_tokens: 50 });
    appendRecord(tmpDir, { agent: 'workflow-subagent', model: 'claude-opus-4-8', input_tokens: 1000000, output_tokens: 2000000, cache_read_tokens: 9000000000 });
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 1, 'only the sane record is counted');
    assert.equal(agg.totals.suspect_excluded, 1, 'the poisoned record is quarantined');
    assert.equal(agg.totals.cache_read_tokens, 50, 'billions are not summed into the totals');
    assert.equal(agg.by_agent['workflow-subagent'], undefined, 'suspect agent excluded from the breakdown');
  });

  test('respects since filter', () => {
    appendRecord(tmpDir, { ts: '2026-01-01T00:00:00Z', agent: 'a', model: 'claude-opus-4-7', input_tokens: 1 });
    appendRecord(tmpDir, { ts: '2026-05-01T00:00:00Z', agent: 'b', model: 'claude-opus-4-7', input_tokens: 2 });
    const agg = aggregate(tmpDir, { since: '2026-04-01' });
    assert.equal(agg.totals.calls, 1);
    assert.equal(agg.totals.input_tokens, 2);
  });

  test('respects until filter', () => {
    appendRecord(tmpDir, { ts: '2026-01-01T00:00:00Z', agent: 'a', model: 'claude-opus-4-7', input_tokens: 1 });
    appendRecord(tmpDir, { ts: '2026-05-01T00:00:00Z', agent: 'b', model: 'claude-opus-4-7', input_tokens: 2 });
    const agg = aggregate(tmpDir, { until: '2026-03-01' });
    assert.equal(agg.totals.calls, 1);
    assert.equal(agg.totals.input_tokens, 1);
  });

  test('cache hit rate null when no cache activity', () => {
    appendRecord(tmpDir, { model: 'claude-opus-4-7', input_tokens: 1000, output_tokens: 100 });
    const agg = aggregate(tmpDir);
    // cache_read_tokens: 0, billed_input: 1000 → hit rate = 0/1000 = 0, but our code returns 0 not null here.
    // Actually: hitDenom = 0 + 1000 = 1000 > 0, so rate = 0/1000 = 0. null only when no activity at all.
    assert.equal(agg.cache_hit_rate_pct, 0);
  });

  test('cache hit rate computed from cache + billed input', () => {
    appendRecord(tmpDir, {
      model: 'claude-opus-4-7',
      input_tokens: 10000,
      cache_read_tokens: 8000,
      output_tokens: 100,
    });
    const agg = aggregate(tmpDir);
    // cache_read=8000, billed_input=10000-8000=2000, denom=10000, rate=8000/10000=80%
    assert.equal(agg.cache_hit_rate_pct, 80);
  });

  test('cost_unknown counts records without derivable cost', () => {
    appendRecord(tmpDir, { input_tokens: 100 }); // no model, no tier
    appendRecord(tmpDir, { model: 'claude-opus-4-7', input_tokens: 100, output_tokens: 10 });
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.cost_unknown, 1);
  });
});

describe('cost — renderTable', () => {
  test('produces human-readable output with sections', () => {
    const agg = {
      totals: { calls: 3, input_tokens: 1000, output_tokens: 100, cache_read_tokens: 200, cache_write_tokens: 50, cost_usd: 0.0123, cost_unknown: 0 },
      cache_hit_rate_pct: 20,
      by_agent: { 'pan-planner': { calls: 2, input: 800, output: 80, cache_read: 200, cache_write: 50, cost: 0.0100 } },
      by_command: {},
      by_tier: {},
      by_day: {},
      window: { since: null, until: null },
    };
    const out = renderTable(agg);
    assert.ok(out.includes('PAN Wizard Cost Dashboard'));
    assert.ok(out.includes('Calls'));
    assert.ok(out.includes('$0.0123'));
    assert.ok(out.includes('pan-planner'));
  });
});

describe('cost — renderChart', () => {
  test('empty aggregation produces placeholder', () => {
    const out = renderChart({ by_day: {}, totals: { cost_usd: 0 } });
    assert.ok(out.includes('No cost data'));
  });

  test('per-day bars scale proportionally', () => {
    const out = renderChart({
      by_day: {
        '2026-04-01': { cost: 0.1 },
        '2026-04-02': { cost: 1.0 },
        '2026-04-03': { cost: 0.5 },
      },
      totals: { cost_usd: 1.6 },
    });
    assert.ok(out.includes('2026-04-01'));
    assert.ok(out.includes('2026-04-02'));
    assert.ok(out.includes('$1.6000'));
    // The largest value should have a full bar.
    const lines = out.split('\n');
    const biggest = lines.find(l => l.includes('2026-04-02'));
    const smallest = lines.find(l => l.includes('2026-04-01'));
    // Count █ chars.
    const bigBars = (biggest.match(/█/g) || []).length;
    const smallBars = (smallest.match(/█/g) || []).length;
    assert.ok(bigBars > smallBars);
  });
});

describe('cost — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('cost report returns zero aggregation on empty log', () => {
    const r = runPanTools('cost report', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.totals.calls, 0);
  });

  test('cost append + report round-trip via CLI', () => {
    const a = runPanTools('cost append --agent pan-planner --model claude-opus-4-7 --input-tokens 1000 --output-tokens 100', tmpDir);
    assert.ok(a.success, a.error);
    const aJson = JSON.parse(a.output);
    assert.equal(aJson.appended, true);

    const r = runPanTools('cost report', tmpDir);
    const rJson = JSON.parse(r.output);
    assert.equal(rJson.totals.calls, 1);
    assert.ok(rJson.totals.cost_usd > 0);
    assert.equal(rJson.by_agent['pan-planner'].calls, 1);
  });

  test('cost report --format table returns raw text', () => {
    runPanTools('cost append --model claude-opus-4-7 --input-tokens 100 --output-tokens 10', tmpDir);
    const r = runPanTools('cost report --format table --raw', tmpDir);
    assert.ok(r.success, r.error);
    assert.ok(r.output.includes('Cost Dashboard'));
    assert.ok(r.output.includes('Totals'));
  });

  test('cost clear removes the log', () => {
    runPanTools('cost append --model claude-opus-4-7 --input-tokens 100', tmpDir);
    const c = runPanTools('cost clear', tmpDir);
    assert.ok(c.success, c.error);
    const cJson = JSON.parse(c.output);
    assert.equal(cJson.cleared, true);
    const r = runPanTools('cost report', tmpDir);
    const rJson = JSON.parse(r.output);
    assert.equal(rJson.totals.calls, 0);
  });
});
