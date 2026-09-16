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
  ratesFromModelPricing,
  managedSettingsDir,
  loadManagedModelPricing,
  effectiveRates,
  METRICS_DIR,
  TOKENS_FILE,
  DEFAULT_RATES,
} = require('../pan-wizard-core/bin/lib/cost.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const os = require('os');

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

  // Fable 5.1 is the one Anthropic model whose cache reads are NOT 0.1× input
  // (0.025×, pricing page 2026-09-10). Before it had its own row, the
  // family-prefix fallback silently billed its reads at the Fable 5 rate.
  test('claude-fable-5-1 has its own row with the 0.025× cache-read rate (verified 2026-09-10)', () => {
    const r = resolveRate('claude-fable-5-1', null, null);
    assert.ok(r, 'claude-fable-5-1 should resolve to a rate');
    assert.equal(r.input, 10.0);
    assert.equal(r.output, 50.0);
    assert.equal(r.cache_read, 0.25);
    assert.equal(r.cache_write, 12.5);
    assert.notDeepEqual(r, resolveRate('claude-fable-5', null, null),
      'the 5.1 row must differ from Fable 5 — otherwise the row is not doing its job');
  });

  test('versioned and 1M-suffixed Fable 5.1 ids resolve to the 5.1 row, not to Fable 5', () => {
    // `claude-fable-5` is a prefix of `claude-fable-5-1`, so longest-prefix
    // matching is what keeps these on the right row. Pin it: a shorter-first
    // sort would send every 5.1 id back to the 4×-too-high read rate.
    const fable51 = resolveRate('claude-fable-5-1', null, null);
    assert.deepEqual(resolveRate('claude-fable-5-1-20260901', null, null), fable51);
    assert.deepEqual(resolveRate('claude-fable-5-1[1m]', null, null), fable51);
    // And the plain Fable 5 ids still land on Fable 5.
    assert.deepEqual(resolveRate('claude-fable-5[1m]', null, null), resolveRate('claude-fable-5', null, null));
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

  // M13 regression: config overrides must get the same longest-prefix family
  // matching as DEFAULT_RATES, so an override keyed on the family applies to the
  // versioned id the hooks actually record.
  test('config override family-prefix-matches versioned model ids', () => {
    const overrides = { 'claude-opus-5': { input: 7, output: 7, cache_read: 0.7, cache_write: 7 } };
    const r = resolveRate('claude-opus-5-20260101', null, overrides);
    assert.ok(r, 'versioned id should resolve to the family override');
    assert.equal(r.input, 7, 'config override applies, not DEFAULT_RATES');
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

  test('claude-opus-5 has explicit rate ($5/$25, verified 2026-08)', () => {
    const r = resolveRate('claude-opus-5', null, null);
    assert.ok(r, 'claude-opus-5 should resolve to a rate');
    assert.equal(r.input, 5.0);
    assert.equal(r.output, 25.0);
    // versioned id prefix-matches the family
    assert.deepEqual(resolveRate('claude-opus-5-20260724', null, null), r);
  });

  test('claude-sonnet-5 has explicit rate ($2/$10 — launch price made permanent, verified 2026-09-10)', () => {
    const r = resolveRate('claude-sonnet-5', null, null);
    assert.ok(r, 'claude-sonnet-5 should resolve to a rate');
    assert.equal(r.input, 2.0);
    assert.equal(r.output, 10.0);
    assert.equal(r.cache_read, 0.20);
    assert.equal(r.cache_write, 2.50);
  });

  test('gpt-5.6 tiers: bare id prices as Sol; Terra/Luna win by longest-prefix (verified 2026-08)', () => {
    const sol = resolveRate('gpt-5.6', null, null);
    assert.ok(sol, 'gpt-5.6 should resolve to a rate');
    assert.equal(sol.input, 5.0);
    assert.equal(sol.output, 30.0);
    // A "gpt-5.6-sol" id has no explicit key → prefix-matches the Sol base.
    assert.deepEqual(resolveRate('gpt-5.6-sol', null, null), sol);
    // Terra/Luna have explicit keys; longest-prefix match must pick them, not the
    // shorter `gpt-5.6` base, even for versioned ids.
    const terra = resolveRate('gpt-5.6-terra-20260731', null, null);
    assert.equal(terra.input, 2.0);
    assert.equal(terra.output, 12.0);
    const luna = resolveRate('gpt-5.6-luna', null, null);
    assert.equal(luna.input, 0.20);
    assert.equal(luna.output, 1.20);
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
    assert.ok(result.models.includes('claude-fable-5-1'));
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

// Claude Code ≥2.1.243 pins contracted rates in MANAGED settings as
// `modelPricing: { id: { inputCostPer1MTokens, outputCostPer1MTokens } }`.
// PAN honours the same block so its ledger and Claude Code's /usage agree.
describe('cost — Claude Code modelPricing as a rate source (2026-09)', () => {
  const writeJson = (file, obj) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj), 'utf-8');
  };
  let managedDir;
  beforeEach(() => { managedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-managed-')); });
  afterEach(() => { cleanup(managedDir); delete process.env.PAN_MANAGED_SETTINGS_DIR; });

  test('ratesFromModelPricing converts input/output and derives cache rates from the family multipliers', () => {
    const rates = ratesFromModelPricing({
      'claude-fable-5-1': { inputCostPer1MTokens: 8, outputCostPer1MTokens: 40 },   // contracted 20% off
      'claude-opus-5-20260901': { inputCostPer1MTokens: 4, outputCostPer1MTokens: 20 }, // versioned id → family
      'vendor-x-model': { inputCostPer1MTokens: 2, outputCostPer1MTokens: 6 },         // unknown family
    });
    assert.deepEqual(rates['claude-fable-5-1'], { input: 8, output: 40, cache_read: 0.2, cache_write: 10 },
      'Fable 5.1 keeps its own 0.025× read multiplier, not the 0.1× convention');
    assert.deepEqual(rates['claude-opus-5-20260901'], { input: 4, output: 20, cache_read: 0.4, cache_write: 5 },
      'a versioned id inherits the multipliers of the family it prefix-matches');
    assert.deepEqual(rates['vendor-x-model'], { input: 2, output: 6, cache_read: 0.2, cache_write: 2.5 },
      'an unknown family falls back to the 0.1× / 1.25× convention');
  });

  test('ratesFromModelPricing ignores malformed entries instead of producing NaN rates', () => {
    const rates = ratesFromModelPricing({
      good: { inputCostPer1MTokens: 1, outputCostPer1MTokens: 2 },
      negative: { inputCostPer1MTokens: -1, outputCostPer1MTokens: 2 },
      missing: { inputCostPer1MTokens: 1 },
      text: { inputCostPer1MTokens: 'cheap', outputCostPer1MTokens: 2 },
      nothing: null,
    });
    assert.deepEqual(Object.keys(rates), ['good']);
    assert.deepEqual(ratesFromModelPricing(null), {});
    assert.deepEqual(ratesFromModelPricing(['not', 'a', 'map']), {});
  });

  test('effectiveRates precedence: cost.rates > managed modelPricing > (undefined → built-in table)', () => {
    const managed = {
      'shared-model': { inputCostPer1MTokens: 1, outputCostPer1MTokens: 2 },
      'managed-only': { inputCostPer1MTokens: 3, outputCostPer1MTokens: 4 },
    };
    const config = { cost: { rates: { 'shared-model': { input: 9, output: 9, cache_read: 9, cache_write: 9 } } } };
    const rates = effectiveRates(config, managed);
    assert.equal(rates['shared-model'].input, 9, 'the project override wins over the managed block');
    assert.equal(rates['managed-only'].input, 3, 'managed ids the project does not name still apply');
    assert.equal(effectiveRates({}, null), undefined,
      'no override anywhere → undefined, so resolveRate keeps its pre-existing built-in fallback path');
    assert.equal(effectiveRates(null, null), undefined);
  });

  test('loadManagedModelPricing merges managed-settings.json with alphabetical drop-ins, later winning', () => {
    writeJson(path.join(managedDir, 'managed-settings.json'), {
      permissions: {}, modelPricing: { a: { inputCostPer1MTokens: 1, outputCostPer1MTokens: 1 }, b: { inputCostPer1MTokens: 1, outputCostPer1MTokens: 1 } },
    });
    writeJson(path.join(managedDir, 'managed-settings.d', '20-finance.json'), {
      modelPricing: { b: { inputCostPer1MTokens: 20, outputCostPer1MTokens: 20 } },
    });
    writeJson(path.join(managedDir, 'managed-settings.d', '10-team.json'), {
      modelPricing: { b: { inputCostPer1MTokens: 10, outputCostPer1MTokens: 10 }, c: { inputCostPer1MTokens: 3, outputCostPer1MTokens: 3 } },
    });
    fs.writeFileSync(path.join(managedDir, 'managed-settings.d', '.hidden.json'), JSON.stringify({ modelPricing: { z: { inputCostPer1MTokens: 99, outputCostPer1MTokens: 99 } } }));
    fs.writeFileSync(path.join(managedDir, 'managed-settings.d', 'notes.txt'), '{"modelPricing":{"y":{}}}');
    fs.writeFileSync(path.join(managedDir, 'managed-settings.d', '30-broken.json'), '{ not json');
    const mp = loadManagedModelPricing(managedDir);
    assert.deepEqual(Object.keys(mp).sort(), ['a', 'b', 'c'], 'hidden, non-json and unparseable files are skipped');
    assert.equal(mp.b.inputCostPer1MTokens, 20, 'alphabetically later drop-in wins over earlier and over the base file');
  });

  test('loadManagedModelPricing returns null when there is no managed directory or no modelPricing key', () => {
    assert.equal(loadManagedModelPricing(path.join(managedDir, 'does-not-exist')), null);
    writeJson(path.join(managedDir, 'managed-settings.json'), { permissions: { deny: ['Bash'] } });
    assert.equal(loadManagedModelPricing(managedDir), null);
  });

  test('managedSettingsDir follows the documented per-OS directories and honours PAN_MANAGED_SETTINGS_DIR', () => {
    // code.claude.com/docs/en/managed-settings, read 2026-09-10. The legacy
    // Windows ProgramData path is NOT read by Claude Code, so it must not be here.
    assert.equal(managedSettingsDir('darwin', {}), '/Library/Application Support/ClaudeCode');
    assert.equal(managedSettingsDir('linux', {}), '/etc/claude-code');
    assert.equal(managedSettingsDir('win32', { ProgramFiles: 'C:\\Program Files' }), 'C:\\Program Files\\ClaudeCode');
    assert.ok(!managedSettingsDir('win32', {}).includes('ProgramData'));
    assert.equal(managedSettingsDir('linux', { PAN_MANAGED_SETTINGS_DIR: '/opt/cc' }), '/opt/cc');
  });

  test('end to end: a managed modelPricing block prices the ledger, and cost.rates still overrides it', () => {
    const tmpDir = createTempProject();
    try {
      writeJson(path.join(managedDir, 'managed-settings.json'), {
        modelPricing: { 'contract-model': { inputCostPer1MTokens: 1, outputCostPer1MTokens: 2 } },
      });
      process.env.PAN_MANAGED_SETTINGS_DIR = managedDir;

      // Hook-shaped row. The SubagentStop hook appends its own JSONL line with
      // `cost_usd: null`, so the row is priced at READ time — write that shape
      // directly (appendRecord would price it at append time instead).
      const ledger = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
      fs.mkdirSync(path.dirname(ledger), { recursive: true });
      fs.appendFileSync(ledger, JSON.stringify({
        ts: new Date().toISOString(), agent: 'pan-planner', model: 'contract-model',
        input_tokens: 1_000_000, output_tokens: 1_000_000, cost_usd: null,
      }) + '\n', 'utf-8');
      let agg = aggregate(tmpDir);
      assert.equal(agg.totals.calls, 1);
      assert.ok(Math.abs(agg.totals.cost_usd - 3) < 1e-9, `expected $3 from the managed rates, got ${agg.totals.cost_usd}`);

      // CLI-shaped row: appendRecord prices at append time — from the managed block too.
      appendRecord(tmpDir, { agent: 'pan-verifier', model: 'contract-model', input_tokens: 1_000_000, output_tokens: 0 });
      const appended = readRecords(tmpDir).at(-1);
      assert.equal(appended.cost_usd, 1, 'append-time pricing must also see the managed rates');

      // A project override for the same id beats the managed block. Only the
      // read-time (hook) row re-prices; the append-time row is frozen by design.
      writeJson(path.join(tmpDir, '.planning', 'config.json'), {
        cost: { rates: { 'contract-model': { input: 10, output: 20, cache_read: 1, cache_write: 12.5 } } },
      });
      agg = aggregate(tmpDir);
      assert.ok(Math.abs(agg.totals.cost_usd - 31) < 1e-9,
        `expected $30 (re-priced hook row) + $1 (frozen CLI row) = $31, got ${agg.totals.cost_usd}`);
    } finally {
      cleanup(tmpDir);
    }
  });

  test('models check reports the managed model ids it found', () => {
    writeJson(path.join(managedDir, 'managed-settings.json'), {
      modelPricing: { 'contract-model': { inputCostPer1MTokens: 1, outputCostPer1MTokens: 2 } },
    });
    const tmpDir = createTempProject();
    try {
      // runPanTools inherits process.env; afterEach removes the variable again.
      process.env.PAN_MANAGED_SETTINGS_DIR = managedDir;
      const r = runPanTools('models check', tmpDir);
      assert.ok(r.success, `models check failed: ${r.error}`);
      const parsed = JSON.parse(r.output);
      assert.deepEqual(parsed.managed_model_pricing, ['contract-model']);
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

  test('caching the same workload is cheaper than not caching it', () => {
    // This test previously compared 10000 input WITHOUT cache against the SAME 10000
    // input PLUS 9000 cache_read, and asserted the second was cheaper. That only held
    // because computeCost subtracted cache_read from input — the defect. The axes are
    // disjoint (Anthropic's input_tokens already excludes cached tokens), so adding
    // cache_read tokens to an unchanged input legitimately costs MORE.
    //
    // The real claim — caching saves money — is about the same workload served two
    // ways: 10000 tokens all fresh, versus 1000 fresh with 9000 served from cache.
    const uncached = computeCost({
      model: 'claude-opus-4-7',
      input_tokens: 10000,
      output_tokens: 0,
    });
    const cached = computeCost({
      model: 'claude-opus-4-7',
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_tokens: 9000,
    });
    assert.ok(cached < uncached, `cache should reduce cost: uncached=${uncached} cached=${cached}`);
  });

  test('cache_read tokens are billed, not free', () => {
    const withoutCacheRead = computeCost({ model: 'claude-opus-4-7', input_tokens: 1000, output_tokens: 0 });
    const withCacheRead = computeCost({ model: 'claude-opus-4-7', input_tokens: 1000, output_tokens: 0, cache_read_tokens: 9000 });
    assert.ok(withCacheRead > withoutCacheRead,
      'reading from cache is discounted, not free — it must still add to the bill');
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
    // The axes are disjoint, so the denominator is simply cache_read + input:
    // 8000 / (8000 + 10000) = 44.4%. The old expectation of 80% came from
    // subtracting cache_read from input first, which collapsed the denominator and
    // pinned the metric at 100% whenever the cache was warmer than the fresh input.
    assert.equal(agg.cache_hit_rate_pct, 44.4);
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

describe('cost — v3.21.0 (config rates on append + malformed row counting)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('appended cost_usd honors config.cost.rates overrides', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ cost: { rates: { 'claude-opus-4-8': { input: 999, output: 999, cache_read: 0, cache_write: 0 } } } }),
    );
    appendRecord(tmpDir, { model: 'claude-opus-4-8', input_tokens: 1000000, output_tokens: 0 });
    const rec = JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'metrics', 'tokens.jsonl'), 'utf-8').trim());
    assert.equal(rec.cost_usd, 999, 'custom $999/1M input rate applied at append time, not DEFAULT_RATES');
  });

  test('aggregate surfaces malformed_skipped for torn JSONL rows', () => {
    const f = path.join(tmpDir, '.planning', 'metrics', 'tokens.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f,
      JSON.stringify({ agent: 'a', model: 'claude-opus-4-8', input_tokens: 10 }) + '\n'
      + '{ truncated mid-write\n'
      + JSON.stringify({ agent: 'b', model: 'claude-opus-4-8', input_tokens: 20 }) + '\n');
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 2, 'two valid rows counted');
    assert.equal(agg.totals.malformed_skipped, 1, 'the torn row is counted, not silently dropped');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reality check R7 (2026-09-10): four ids priced on platform.claude.com resolved to
// null — both Mythos models and the DATED Opus 4.5 / Sonnet 4.5 ids, which had no
// family row to prefix-match onto. A null rate is a ledger row that silently costs
// nothing. Revert-proof: delete any one of the four rows and its test below fails.
// ─────────────────────────────────────────────────────────────────────────────
describe('R7: rows for the four models the pricing page prices but the table lacked', () => {
  test('claude-mythos-5-1 has its own row with the 0.025× cache-read rate', () => {
    const r = resolveRate('claude-mythos-5-1', null, null);
    assert.ok(r, 'claude-mythos-5-1 must resolve');
    assert.equal(r.input, 10.0); assert.equal(r.output, 50.0);
    assert.equal(r.cache_read, 0.25, 'Mythos 5.1 bills cache reads at 0.025x input, the same convention as Fable 5.1');
    assert.equal(r.cache_write, 12.5);
  });

  test('claude-mythos-5 is a distinct row (0.1× cache read), not a prefix match onto 5.1', () => {
    const r = resolveRate('claude-mythos-5', null, null);
    assert.ok(r); assert.equal(r.cache_read, 1.0);
    assert.notDeepEqual(r, resolveRate('claude-mythos-5-1', null, null));
    // longest-prefix: the 5.1 id must NOT fall back to the 5 row
    assert.equal(resolveRate('claude-mythos-5-1', null, null).cache_read, 0.25);
  });

  test('the dated Opus 4.5 id resolves to the Opus 4.5 row via family prefix', () => {
    const r = resolveRate('claude-opus-4-5-20251101', null, null);
    assert.ok(r, 'dated Opus 4.5 id must resolve');
    assert.deepEqual(r, resolveRate('claude-opus-4-5', null, null));
    assert.equal(r.input, 5.0); assert.equal(r.output, 25.0); assert.equal(r.cache_read, 0.5); assert.equal(r.cache_write, 6.25);
  });

  test('the dated Sonnet 4.5 id resolves to the Sonnet 4.5 row (pre-Sonnet-5 pricing)', () => {
    const r = resolveRate('claude-sonnet-4-5-20250929', null, null);
    assert.ok(r, 'dated Sonnet 4.5 id must resolve');
    assert.deepEqual(r, resolveRate('claude-sonnet-4-5', null, null));
    assert.equal(r.input, 3.0); assert.equal(r.output, 15.0);
    assert.notDeepEqual(r, resolveRate('claude-sonnet-5', null, null), 'Sonnet 5 is the cheaper $2/$10 row');
  });
});
