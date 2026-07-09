/**
 * Cost — per-call cost aggregation and dashboard (Spec B v2 Y-6, v3.0).
 *
 * Storage: `.planning/metrics/tokens.jsonl` — append-only JSON Lines.
 *
 * Each line is a cost record:
 *   {
 *     ts: "2026-04-18T12:34:56.789Z",
 *     agent: "pan-planner" | null,         // agent name, if spawned as agent
 *     command: "exec-phase" | null,         // command name, if invoked directly
 *     model: "claude-opus-4-7" | null,      // model id when known
 *     tier: "reasoning" | "mid" | "fast" | null,
 *     input_tokens: 12345,
 *     output_tokens: 678,
 *     cache_read_tokens: 0,
 *     cache_write_tokens: 0,
 *     cost_usd: 0.123,                      // computed if model+tokens known, else null
 *     phase: "07" | null,
 *     session: "abc123" | null
 *   }
 *
 * The appender is deliberately tolerant: if fields are missing the record
 * is still written; aggregation skips null fields gracefully. Non-blocking
 * — failure to write never breaks the caller (cost is observability, not
 * critical path).
 *
 * Aggregation produces:
 *   - by agent, by command, by tier, by day
 *   - totals: input/output/cache tokens, cost
 *   - hit rate: cache_read / (cache_read + input - cache_write) if any cache activity
 *
 * Rate table is approximate — real pricing comes from the provider's API.
 * Rates are US dollars per million tokens, indicative as of 2026-06. Users
 * can override with `.planning/config.json` → `cost.rates`.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, loadConfig } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

const METRICS_DIR = 'metrics';
const TOKENS_FILE = 'tokens.jsonl';

/**
 * Default rate table ($ per million tokens).
 * Override per-model in config.json → cost.rates.
 */
const DEFAULT_RATES = {
  // Anthropic — verified against platform pricing 2026-06. Opus 4.6+ is $5/$25
  // (the old $15/$75 Opus pricing ended with the 4.5 generation). Cache rates
  // follow Anthropic's convention: read ≈ 0.1× input, write ≈ 1.25× input.
  'claude-fable-5':     { input: 10.0, output: 50.0, cache_read: 1.0,  cache_write: 12.5 },
  'claude-opus-4-8':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'claude-opus-4-7':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'claude-opus-4-6':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'claude-sonnet-4-6':  { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75 },
  'claude-haiku-4-5':   { input: 1.0,  output: 5.0,  cache_read: 0.1,  cache_write: 1.25 },

  // OpenAI — verified against published pricing 2026-06 ($5/$30 standard tier).
  // Prompt caching is a 90% input discount with no separate write charge, so
  // cache_write bills at the plain input rate.
  'gpt-5.5':            { input: 5.0,  output: 30.0, cache_read: 0.5,  cache_write: 5.0 },

  // Google Gemini — published rates (per million tokens, approximate; users can override via config.json → cost.rates).
  // Pro tiers use the <=200K-context tier; long-context calls may be billed at ~2x. Cache rates are Google's context-cache pricing (~25% of input rate).
  // (gemini-1.5-pro removed 2026-06: retired model; records for it fall back to tier rates.)
  'gemini-3.1-pro':         { input: 2.00, output: 12.0, cache_read: 0.50,   cache_write: 2.00 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.0, cache_read: 0.50,   cache_write: 2.00 },
  'gemini-2.5-pro':         { input: 1.25, output: 10.0, cache_read: 0.3125, cache_write: 1.25 },
  'gemini-2.5-flash':       { input: 0.30, output: 2.50, cache_read: 0.075,  cache_write: 0.30 },
  'gemini-2.5-flash-lite':  { input: 0.10, output: 0.40, cache_read: 0.025,  cache_write: 0.10 },

  // Tier fallbacks when model id is unknown (reasoning tracks current Opus pricing)
  'reasoning': { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'mid':       { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75 },
  'fast':      { input: 1.0,  output: 5.0,  cache_read: 0.1,  cache_write: 1.25 },
};

function metricsDir(cwd) {
  return path.join(planningPath(cwd), METRICS_DIR);
}

function tokensFile(cwd) {
  return path.join(metricsDir(cwd), TOKENS_FILE);
}

function resolveRate(model, tier, configRates) {
  if (configRates) {
    if (model && configRates[model]) return configRates[model];
    if (tier && configRates[tier]) return configRates[tier];
  }
  if (model && DEFAULT_RATES[model]) return DEFAULT_RATES[model];
  // Transcript/hook-captured ids are versioned ("claude-opus-4-8-20260301",
  // "claude-fable-5[1m]") while the table uses family keys — prefix-match,
  // longest key first so the most specific family wins.
  if (model) {
    const families = Object.keys(DEFAULT_RATES)
      .filter(k => model.startsWith(k))
      .sort((a, b) => b.length - a.length);
    if (families.length > 0) return DEFAULT_RATES[families[0]];
  }
  if (tier && DEFAULT_RATES[tier]) return DEFAULT_RATES[tier];
  return null;
}

/**
 * Compute cost in USD for a single record given known rates.
 * Returns null when rate is unknown.
 * @param {Object} rec - Cost record
 * @param {Object} [configRates] - Optional rate overrides
 * @returns {number|null}
 */
function computeCost(rec, configRates) {
  const rate = resolveRate(rec.model, rec.tier, configRates);
  if (!rate) return null;
  const input = rec.input_tokens || 0;
  const output = rec.output_tokens || 0;
  const cacheRead = rec.cache_read_tokens || 0;
  const cacheWrite = rec.cache_write_tokens || 0;
  // Non-cache-hit input tokens = input - cache_read (cache_read already in input on some providers,
  // separate on others; we treat cache_read as a reduction of effective new input).
  const newInput = Math.max(0, input - cacheRead);
  const usd = (newInput * rate.input + output * rate.output
    + cacheRead * rate.cache_read + cacheWrite * rate.cache_write) / 1_000_000;
  return Math.round(usd * 10000) / 10000;
}

/**
 * Append a cost record. Non-blocking — errors are swallowed so instrumentation
 * never breaks the caller.
 * @param {string} cwd - Project root
 * @param {Object} rec - Partial record; missing fields default to null/0.
 * @returns {{appended: boolean, file?: string, error?: string}}
 */
function appendRecord(cwd, rec) {
  const normalized = {
    ts: rec.ts || new Date().toISOString(),
    agent: rec.agent || null,
    command: rec.command || null,
    model: rec.model || null,
    tier: rec.tier || null,
    input_tokens: Number(rec.input_tokens) || 0,
    output_tokens: Number(rec.output_tokens) || 0,
    cache_read_tokens: Number(rec.cache_read_tokens) || 0,
    cache_write_tokens: Number(rec.cache_write_tokens) || 0,
    phase: rec.phase || null,
    session: rec.session || null,
  };
  // Allow caller-supplied cost override; otherwise compute.
  normalized.cost_usd = typeof rec.cost_usd === 'number'
    ? rec.cost_usd
    : computeCost(normalized);

  try {
    fs.mkdirSync(metricsDir(cwd), { recursive: true });
    fs.appendFileSync(tokensFile(cwd), JSON.stringify(normalized) + '\n', 'utf-8');
    return { appended: true, file: tokensFile(cwd) };
  } catch (e) {
    return { appended: false, error: e.message };
  }
}

/**
 * Read all cost records from the log.
 * @param {string} cwd
 * @returns {Array<Object>}
 */
function readRecords(cwd) {
  const raw = safeReadFile(tokensFile(cwd));
  if (!raw) return [];
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch { /* skip malformed line */ }
  }
  return records;
}

/**
 * Aggregate records into totals + breakdowns.
 * @param {string} cwd
 * @param {Object} [opts] - {since, until, group_by}
 * @returns {Object} Aggregation
 */
/**
 * A record is "suspect" when its token counts are physically implausible for a
 * single subagent — the signature of the pre-v3.12.4 transcript-oversum bug
 * (billions of cache-read, cache-read dwarfing input, 100% cache-hit). Such
 * records are quarantined from aggregates so a poisoned ledger can't report
 * millions of dollars. See docs/FIELD-REPORT-army-2026-06.md.
 * @param {Object} r - a cost record
 * @returns {boolean}
 */
function isSuspectRecord(r) {
  if (!r || typeof r !== 'object') return false;
  const cr = r.cache_read_tokens || 0;
  const io = (r.input_tokens || 0) + (r.output_tokens || 0);
  if (cr > 5e8) return true;                        // no scoped subagent re-reads >500M cached tokens
  if (cr > 1e7 && cr > 100 * (io + 1)) return true; // cache-read dwarfs input+output
  if ((r.output_tokens || 0) > 1e7) return true;    // ~10M output = cumulative oversum
  return false;
}

function aggregate(cwd, opts) {
  const records = readRecords(cwd);
  const since = opts?.since ? new Date(opts.since).getTime() : null;
  const until = opts?.until ? new Date(opts.until).getTime() : null;
  const config = loadConfig(cwd);
  const configRates = config?.cost?.rates;

  const filtered = records.filter(r => {
    if (!r.ts) return true;
    const t = new Date(r.ts).getTime();
    if (since !== null && t < since) return false;
    if (until !== null && t > until) return false;
    return true;
  });

  const totals = {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    cost_unknown: 0,
    suspect_excluded: 0,
  };

  const byAgent = {};
  const byCommand = {};
  const byTier = {};
  const byDay = {};

  function bump(map, key, rec) {
    if (!key) return;
    if (!map[key]) map[key] = { calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0 };
    map[key].calls += 1;
    map[key].input += rec.input_tokens || 0;
    map[key].output += rec.output_tokens || 0;
    map[key].cache_read += rec.cache_read_tokens || 0;
    map[key].cache_write += rec.cache_write_tokens || 0;
    const cost = typeof rec.cost_usd === 'number' ? rec.cost_usd : computeCost(rec, configRates);
    if (typeof cost === 'number') map[key].cost += cost;
  }

  for (const r of filtered) {
    // Quarantine physically-impossible records (pre-v3.12.4 transcript-oversum
    // bug) so a poisoned ledger doesn't poison the totals / HUD / /pan:cost.
    if (isSuspectRecord(r)) { totals.suspect_excluded += 1; continue; }
    totals.calls += 1;
    totals.input_tokens += r.input_tokens || 0;
    totals.output_tokens += r.output_tokens || 0;
    totals.cache_read_tokens += r.cache_read_tokens || 0;
    totals.cache_write_tokens += r.cache_write_tokens || 0;
    const cost = typeof r.cost_usd === 'number' ? r.cost_usd : computeCost(r, configRates);
    if (typeof cost === 'number') totals.cost_usd += cost;
    else totals.cost_unknown += 1;

    bump(byAgent, r.agent, r);
    bump(byCommand, r.command, r);
    bump(byTier, r.tier, r);
    const day = r.ts ? r.ts.slice(0, 10) : null;
    bump(byDay, day, r);
  }

  totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;

  // Cache hit rate: cache_read / (cache_read + new input tokens billed at full rate)
  const billedInput = Math.max(0, totals.input_tokens - totals.cache_read_tokens);
  const hitDenom = totals.cache_read_tokens + billedInput;
  const cacheHitRatePct = hitDenom > 0
    ? Math.round((totals.cache_read_tokens / hitDenom) * 1000) / 10
    : null;

  return {
    totals,
    cache_hit_rate_pct: cacheHitRatePct,
    by_agent: byAgent,
    by_command: byCommand,
    by_tier: byTier,
    by_day: byDay,
    window: {
      since: opts?.since || null,
      until: opts?.until || null,
    },
  };
}

/**
 * Render aggregation as a human-readable table.
 * @param {Object} agg - from aggregate()
 * @returns {string}
 */
function renderTable(agg) {
  const lines = [];
  lines.push('=== PAN Wizard Cost Dashboard ===');
  const window = agg.window.since || agg.window.until
    ? `  Window: ${agg.window.since || '(any)'} → ${agg.window.until || 'now'}`
    : '  Window: all time';
  lines.push(window);
  lines.push('');
  lines.push('Totals');
  lines.push(`  Calls              : ${agg.totals.calls}`);
  lines.push(`  Input tokens       : ${agg.totals.input_tokens.toLocaleString()}`);
  lines.push(`  Output tokens      : ${agg.totals.output_tokens.toLocaleString()}`);
  lines.push(`  Cache read         : ${agg.totals.cache_read_tokens.toLocaleString()}`);
  lines.push(`  Cache write        : ${agg.totals.cache_write_tokens.toLocaleString()}`);
  lines.push(`  Estimated cost     : $${agg.totals.cost_usd.toFixed(4)}${agg.totals.cost_unknown > 0 ? ` (+${agg.totals.cost_unknown} unknown)` : ''}`);
  lines.push(`  Cache hit rate     : ${agg.cache_hit_rate_pct == null ? 'n/a' : `${agg.cache_hit_rate_pct}%`}`);

  function section(title, map) {
    const keys = Object.keys(map).sort((a, b) => (map[b].cost || 0) - (map[a].cost || 0));
    if (keys.length === 0) return;
    lines.push('');
    lines.push(title);
    lines.push('  ' + 'name'.padEnd(28) + 'calls'.padStart(7) + 'input'.padStart(11) + 'output'.padStart(9) + '  cost');
    for (const k of keys) {
      const row = map[k];
      lines.push('  ' + k.slice(0, 28).padEnd(28)
        + String(row.calls).padStart(7)
        + row.input.toLocaleString().padStart(11)
        + row.output.toLocaleString().padStart(9)
        + '  $' + row.cost.toFixed(4));
    }
  }
  section('By agent', agg.by_agent);
  section('By command', agg.by_command);
  section('By tier', agg.by_tier);
  section('By day', agg.by_day);

  return lines.join('\n');
}

/**
 * Render aggregation as an ASCII bar chart of cost per day.
 * @param {Object} agg
 * @returns {string}
 */
function renderChart(agg) {
  const days = Object.keys(agg.by_day).sort();
  if (days.length === 0) return 'No cost data in window.';
  const max = Math.max(...days.map(d => agg.by_day[d].cost || 0), 0.0001);
  const width = 30;
  const lines = ['=== Cost per day ==='];
  for (const day of days) {
    const cost = agg.by_day[day].cost || 0;
    const len = Math.round((cost / max) * width);
    const bar = '█'.repeat(len) + '░'.repeat(width - len);
    lines.push(`  ${day}  ${bar}  $${cost.toFixed(4)}`);
  }
  lines.push('');
  lines.push(`  Total window cost: $${agg.totals.cost_usd.toFixed(4)}`);
  return lines.join('\n');
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdCostReport(cwd, opts, raw) {
  const format = opts?.format || 'json';
  const agg = aggregate(cwd, opts);
  if (format === 'table') {
    output(agg, raw, renderTable(agg));
  } else if (format === 'chart') {
    output(agg, raw, renderChart(agg));
  } else {
    output(agg, raw);
  }
}

function cmdCostAppend(cwd, rec, raw) {
  const result = appendRecord(cwd, rec);
  output(result, raw);
}

function cmdCostClear(cwd, raw) {
  try {
    fs.unlinkSync(tokensFile(cwd));
    output({ cleared: true, file: tokensFile(cwd) }, raw);
  } catch (e) {
    output({ cleared: false, error: e.message }, raw);
  }
}

// ─── Rate-table staleness ───────────────────────────────────────────────────

// Date DEFAULT_RATES was last verified against published provider pricing.
// Bump this whenever the table is re-verified; `models check` flags the table
// once it is older than RATES_STALE_AFTER_DAYS (provider prices move faster
// than PAN releases do).
const RATES_VERIFIED_AT = '2026-06-10';
const RATES_STALE_AFTER_DAYS = 180;
const RATE_TIERS = ['reasoning', 'mid', 'fast'];

function checkRatesStaleness(now = new Date()) {
  const verified = new Date(RATES_VERIFIED_AT + 'T00:00:00Z');
  const ageDays = Math.floor((now.getTime() - verified.getTime()) / 86400000);
  return {
    rates_verified_at: RATES_VERIFIED_AT,
    age_days: ageDays,
    stale_after_days: RATES_STALE_AFTER_DAYS,
    stale: ageDays > RATES_STALE_AFTER_DAYS,
    models: Object.keys(DEFAULT_RATES).filter(k => !RATE_TIERS.includes(k)),
    tiers: RATE_TIERS,
  };
}

function cmdModelsCheck(raw) {
  const result = checkRatesStaleness();
  const human = result.stale
    ? `Rate table verified ${result.rates_verified_at} (${result.age_days} days ago) — STALE: re-verify provider pricing and bump RATES_VERIFIED_AT in cost.cjs`
    : `Rate table verified ${result.rates_verified_at} (${result.age_days} days ago) — OK`;
  output(result, raw, human);
}

module.exports = {
  computeCost,
  appendRecord,
  readRecords,
  aggregate,
  isSuspectRecord,
  renderTable,
  renderChart,
  resolveRate,
  checkRatesStaleness,
  cmdCostReport,
  cmdCostAppend,
  cmdCostClear,
  cmdModelsCheck,
  METRICS_DIR,
  TOKENS_FILE,
  DEFAULT_RATES,
  RATES_VERIFIED_AT,
};
