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
 * Rates are US dollars per million tokens, indicative as of 2026-08. Users
 * can override with `.planning/config.json` → `cost.rates`.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, loadConfig } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');

const METRICS_DIR = 'metrics';
const TOKENS_FILE = 'tokens.jsonl';

/**
 * Default rate table ($ per million tokens).
 * Override per-model in config.json → cost.rates.
 */
const DEFAULT_RATES = {
  // Anthropic — verified against platform pricing 2026-09-10. Opus 4.6+/Opus 5 are
  // $5/$25 (the old $15/$75 Opus pricing ended with the 4.5 generation). Cache
  // rates follow Anthropic's convention: read ≈ 0.1× input, write ≈ 1.25× input —
  // EXCEPT Fable 5.1, whose cache reads bill at 0.025× input ($0.25). Fable 5.1
  // needs its own row: without it the family-prefix fallback priced its reads at
  // the Fable 5 rate, 4× too high on the model the `fable`/`best` aliases resolve to
  // (model-config, read 2026-09-10: neither Fable model is any plan's default), and
  // cached re-reads are the bulk of PAN's traffic (ADR-0044).
  'claude-fable-5-1':   { input: 10.0, output: 50.0, cache_read: 0.25, cache_write: 12.5 },
  'claude-fable-5':     { input: 10.0, output: 50.0, cache_read: 1.0,  cache_write: 12.5 },
  // Mythos 5.1 / Mythos 5 (limited availability) — platform.claude.com/docs/en/about-claude/pricing,
  // read 2026-09-10: $10/$50; the page's cache footnote names Fable 5.1 AND Mythos 5.1 as
  // the two models whose cache reads bill at 0.025× input; Mythos 5 follows the 0.1× rule.
  // Added for reality check R7: resolveRate returned null for both ids.
  'claude-mythos-5-1':  { input: 10.0, output: 50.0, cache_read: 0.25, cache_write: 12.5 },
  'claude-mythos-5':    { input: 10.0, output: 50.0, cache_read: 1.0,  cache_write: 12.5 },
  'claude-opus-5':      { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'claude-opus-4-8':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'claude-opus-4-7':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  'claude-opus-4-6':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  // Opus 4.5 (dated id claude-opus-4-5-20251101) — same pricing page, read 2026-09-10:
  // $5/$25/$0.50/$6.25. Without this row the dated id had no family prefix to land on
  // and priced as null (R7).
  'claude-opus-4-5':    { input: 5.0,  output: 25.0, cache_read: 0.5,  cache_write: 6.25 },
  // Sonnet 5 is $2/$10: the launch price announced as introductory through
  // 2026-08-31 was made permanent and the scheduled rise to $3/$15 cancelled
  // (pricing page, read 2026-09-10). Lesson: never write down a pre-announced
  // price — this row carried the future rate for a month and over-billed by half.
  'claude-sonnet-5':    { input: 2.0,  output: 10.0, cache_read: 0.20, cache_write: 2.50 },
  'claude-sonnet-4-6':  { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75 },
  // Sonnet 4.5 (dated id claude-sonnet-4-5-20250929) — pricing page, read 2026-09-10:
  // $3/$15/$0.30/$3.75 (the pre-Sonnet-5 rate; Sonnet 5 is $2/$10). R7.
  'claude-sonnet-4-5':  { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75 },
  'claude-haiku-4-5':   { input: 1.0,  output: 5.0,  cache_read: 0.1,  cache_write: 1.25 },

  // OpenAI — verified against published pricing 2026-08. Prompt caching is a 90%
  // input discount with no separate write charge, so cache_write bills at the
  // plain input rate. GPT-5.6 ships in three tiers; the bare `gpt-5.6` id prices
  // as the Sol flagship, with tier-specific keys for Terra/Luna (longest-prefix
  // match wins in resolveRate). Luna reflects the 2026-07-30 price cut.
  'gpt-5.6':            { input: 5.0,  output: 30.0, cache_read: 0.5,  cache_write: 5.0 },
  'gpt-5.6-terra':      { input: 2.0,  output: 12.0, cache_read: 0.2,  cache_write: 2.0 },
  'gpt-5.6-luna':       { input: 0.20, output: 1.20, cache_read: 0.02, cache_write: 0.20 },
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

// Longest-prefix family match against a rates table. Transcript/hook-captured
// ids are versioned ("claude-opus-4-8-20260301", "claude-fable-5[1m]") while
// rate tables use family keys — match the longest key the model starts with so
// the most specific family wins.
function familyPrefixRate(rates, model) {
  const families = Object.keys(rates)
    .filter(k => model.startsWith(k))
    .sort((a, b) => b.length - a.length);
  return families.length > 0 ? rates[families[0]] : null;
}

// ─── Claude Code `modelPricing` as a rate source (2026-09) ──────────────────
//
// Claude Code ≥2.1.243 lets an organisation pin contracted per-model rates in
// MANAGED settings — `modelPricing: { "<modelId>": { inputCostPer1MTokens,
// outputCostPer1MTokens } }` (settings-reference, read 2026-09-10) — and prices
// its own /usage with them. Honouring the same block keeps PAN's ledger on the
// numbers the organisation actually pays. The shape carries no cache fields, so
// cache rates are DERIVED: the family's own multipliers when DEFAULT_RATES knows
// the family (Fable 5.1 reads bill at 0.025× input, not 0.1×), otherwise the
// Anthropic convention (read 0.1×, write 1.25×).

const round6 = (n) => Number(n.toFixed(6));

function ratesFromModelPricing(modelPricing) {
  const out = {};
  if (!modelPricing || typeof modelPricing !== 'object' || Array.isArray(modelPricing)) return out;
  for (const [id, p] of Object.entries(modelPricing)) {
    if (!p || typeof p !== 'object') continue;
    const input = Number(p.inputCostPer1MTokens);
    const output = Number(p.outputCostPer1MTokens);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    const fam = DEFAULT_RATES[id] || familyPrefixRate(DEFAULT_RATES, id);
    const readMult = fam && fam.input > 0 ? fam.cache_read / fam.input : 0.1;
    const writeMult = fam && fam.input > 0 ? fam.cache_write / fam.input : 1.25;
    out[id] = { input, output, cache_read: round6(input * readMult), cache_write: round6(input * writeMult) };
  }
  return out;
}

// Where Claude Code reads managed settings (code.claude.com/docs/en/managed-settings,
// read 2026-09-10): macOS `/Library/Application Support/ClaudeCode`, Linux and WSL
// `/etc/claude-code`, Windows `C:\Program Files\ClaudeCode`. Claude Code does NOT
// read the legacy Windows path `C:\ProgramData\ClaudeCode` — so neither does PAN.
// `managed-settings.json` is merged first, then every `*.json` in
// `managed-settings.d/` in alphabetical order (hidden files skipped), later
// files winning. `PAN_MANAGED_SETTINGS_DIR` redirects the lookup (tests, and
// hosts that relocate the directory).
function managedSettingsDir(platform = process.platform, env = process.env) {
  if (env.PAN_MANAGED_SETTINGS_DIR) return env.PAN_MANAGED_SETTINGS_DIR;
  // `path.win32.join`, not `path.join`: the platform is an argument, so a POSIX
  // host asked for the win32 directory must still get backslashes. On Windows the
  // two are the same function.
  if (platform === 'win32') return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode');
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

function loadManagedModelPricing(dir = managedSettingsDir()) {
  const files = [path.join(dir, 'managed-settings.json')];
  try {
    const dropIns = path.join(dir, 'managed-settings.d');
    files.push(...fs.readdirSync(dropIns)
      .filter(f => !f.startsWith('.') && f.endsWith('.json'))
      .sort()
      .map(f => path.join(dropIns, f)));
  } catch { /* no drop-in directory */ }
  let merged = null;
  for (const f of files) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const mp = parsed && typeof parsed === 'object' ? parsed.modelPricing : null;
    if (mp && typeof mp === 'object' && !Array.isArray(mp)) merged = { ...(merged || {}), ...mp };
  }
  return merged;
}

// The rate table a cost computation actually sees. Precedence, highest first:
//   1. `.planning/config.json → cost.rates` — PAN's explicit per-project override
//   2. managed `modelPricing` — the organisation's contracted rates
//   3. DEFAULT_RATES — resolveRate's own fallback when neither names the model
// Returns undefined (not {}) when nothing overrides, so callers keep the exact
// pre-2026-09 behaviour of passing no config rates.
function effectiveRates(config, managedPricing = loadManagedModelPricing()) {
  const rates = { ...ratesFromModelPricing(managedPricing), ...(config?.cost?.rates || {}) };
  return Object.keys(rates).length > 0 ? rates : undefined;
}

function resolveRate(model, tier, configRates) {
  // Config overrides win over the built-in table — including for versioned ids.
  // Without the family-prefix pass here, a cost.rates override keyed on a family
  // ("claude-opus-5") was silently ignored for the versioned id the hooks
  // actually record ("claude-opus-5-20260101"), which fell through to
  // DEFAULT_RATES instead.
  if (configRates) {
    if (model && configRates[model]) return configRates[model];
    if (model) {
      const fam = familyPrefixRate(configRates, model);
      if (fam) return fam;
    }
    if (tier && configRates[tier]) return configRates[tier];
  }
  if (model && DEFAULT_RATES[model]) return DEFAULT_RATES[model];
  if (model) {
    const fam = familyPrefixRate(DEFAULT_RATES, model);
    if (fam) return fam;
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
  // The three input axes are DISJOINT as PAN records them. hooks/pan-cost-logger.js
  // copies Anthropic's `input_tokens`, `cache_read_input_tokens` and
  // `cache_creation_input_tokens` into separate fields, and Anthropic's
  // `input_tokens` already EXCLUDES both cache axes — so each token is counted once
  // and billed at its own rate.
  //
  // This previously subtracted cache_read from input, hedging that "cache_read is
  // already in input on some providers". That double-discounted: with a warm cache,
  // cache_read is far larger than input, so Math.max(0, …) zeroed the billed input
  // outright. On a realistic row (30k input / 5k output / 200k cache read / 12k
  // cache write on Opus-5 rates) it reported $0.30 against a true $0.45 — a 33%
  // understatement, always in the direction of looking cheaper.
  const usd = (input * rate.input + output * rate.output
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
  // Allow caller-supplied cost override; otherwise compute at the user's
  // configured rates (config.cost.rates) — without this, CLI-appended rows froze
  // at DEFAULT_RATES while hook rows (cost_usd:null) got config rates at read
  // time, so the two producers priced identical tokens differently.
  normalized.cost_usd = typeof rec.cost_usd === 'number'
    ? rec.cost_usd
    : computeCost(normalized, effectiveRates(loadConfig(cwd)));

  try {
    fs.mkdirSync(metricsDir(cwd), { recursive: true });
    fs.appendFileSync(tokensFile(cwd), JSON.stringify(normalized) + '\n', 'utf-8');
    return { appended: true, file: tokensFile(cwd) };
  } catch (e) {
    return { appended: false, error: e.message || 'ledger_append_failed' };
  }
}

/**
 * Read all cost records from the log.
 * @param {string} cwd
 * @returns {Array<Object>}
 */
// Count of malformed (unparseable) rows dropped by the most recent readRecords
// call. A crash mid-append or interleaved concurrent appends can leave a torn
// row; surfacing the count (rather than swallowing it) mirrors the existing
// suspect_excluded contract. Module-level so aggregate() can read it without a
// breaking change to readRecords' bare-array return (consumed as an array by
// aggregate, memory.cjs, and hygiene.cjs).
let _lastReadMalformed = 0;

function readRecords(cwd) {
  _lastReadMalformed = 0;
  const raw = safeReadFile(tokensFile(cwd));
  if (!raw) return [];
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch { _lastReadMalformed += 1; }
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
 * single subagent — the oversum signature: a session's cumulative usage booked
 * to one subagent row (billions of cache-read, cache-read dwarfing input, 100%
 * cache-hit). Written by pre-v3.12.4 hooks, and by the parent-transcript slice
 * path of every later hook up to v3.28 whenever a slice started at cursor 0 on a
 * long-lived session. Such records are quarantined from aggregates so a
 * poisoned ledger can't report millions of dollars.
 * See docs/FIELD-REPORT-army-2026-06.md.
 * @param {Object} r - a cost record
 * @returns {boolean}
 */
// No single subagent runs for six hours — the longest native-workflow phase runs
// measured in the harness finish inside an hour — while a parent-transcript slice
// that spans a working day, or the idle night between two stops, does. Mirrored by
// the hooks' SLICE_MAX_DURATION_MS, which nulls the span on write. Calibrated on
// eleven field ledgers (2026-09): of the timed rows the old ratio rule flagged,
// 55 spanned under three hours and 12 spanned six to twenty-four — the latter all
// parent slices booked to a `general-purpose` or workflow subagent.
const SUSPECT_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

function isSuspectRecord(r) {
  if (!r || typeof r !== 'object') return false;
  // Rows measured from a transcript that belongs to exactly one actor — the
  // subagent's own file (v3.29 hooks, `cost rebuild`) or the main thread's
  // session file (`cost rebuild`) — cannot carry another actor's usage, so the
  // oversum signature does not apply to them: a 24-day main thread with
  // billions of cached reads is simply a long session, measured exactly.
  if (r.token_source === 'agent-transcript' || r.token_source === 'session-transcript') return false;
  const cr = r.cache_read_tokens || 0;
  const io = (r.input_tokens || 0) + (r.output_tokens || 0);
  if (cr > 5e8) return true;                        // no scoped subagent re-reads >500M cached tokens
  if ((r.output_tokens || 0) > 1e7) return true;    // ~10M output = cumulative oversum
  const dur = typeof r.duration_ms === 'number' ? r.duration_ms : null;
  if (dur != null && dur > SUSPECT_MAX_DURATION_MS) return true; // a six-hour-plus "subagent" is a session's history
  // Cache-read dwarfing input+output is the oversum signature ONLY for a row the
  // hook could not time (pre-v3.20 rows, unreadable transcripts). A timed row
  // with a plausible span is a real agent: under prompt caching every turn
  // re-reads the cached context, so a hundred-turn agent legitimately reads
  // 300× more cached tokens than it writes. Applied to timed rows, this rule
  // had excluded fifty sub-hour agents (~3 billion real cache-read tokens)
  // from eleven field ledgers (2026-09).
  if (dur == null && cr > 1e7 && cr > 100 * (io + 1)) return true;
  return false;
}

/**
 * A record is "empty" when it carries no tokens on any axis and no model: a
 * spawn the hook could not measure — a sibling stop that arrived before the
 * shared parent transcript had grown (the pre-v3.29 slice path), or a payload
 * with neither usage nor a readable transcript. It has no cost and no tokens;
 * counting it as a call inflated call counts by up to 2x in the field (480 of
 * 976 rows across eleven ledgers, 2026-09). A zero-token row that names a model
 * is NOT empty — that is a measured run that happened to use nothing.
 * @param {Object} r - a cost record
 * @returns {boolean}
 */
function isEmptyRecord(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.model) return false;
  return !(r.input_tokens || r.output_tokens || r.cache_read_tokens || r.cache_write_tokens);
}

function aggregate(cwd, opts) {
  const records = readRecords(cwd);
  const malformedSkipped = _lastReadMalformed; // captured before any later read
  const since = opts?.since ? new Date(opts.since).getTime() : null;
  const until = opts?.until ? new Date(opts.until).getTime() : null;
  const config = loadConfig(cwd);
  const configRates = effectiveRates(config);

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
    empty_excluded: 0,
    malformed_skipped: malformedSkipped,
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
    // Quarantine physically-impossible records (the transcript-oversum
    // signature) so a poisoned ledger doesn't poison the totals / HUD / /pan:cost.
    if (isSuspectRecord(r)) { totals.suspect_excluded += 1; continue; }
    // Skip unmeasured spawns: no tokens, no model, nothing to price or count.
    if (isEmptyRecord(r)) { totals.empty_excluded += 1; continue; }
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

  // Cache hit rate: cached input / all input read. Same disjoint-axes fact as
  // computeCost — input_tokens excludes the cache axes, so the denominator is simply
  // their sum. Subtracting cache_read from input here made the denominator collapse
  // to cache_read whenever the cache was warm (the normal case), pinning the metric
  // at exactly 100% and making it carry no information at all.
  const hitDenom = totals.cache_read_tokens + totals.input_tokens;
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
  const skipped = [
    agg.totals.suspect_excluded > 0 ? `${agg.totals.suspect_excluded} suspect` : null,
    agg.totals.empty_excluded > 0 ? `${agg.totals.empty_excluded} empty` : null,
    agg.totals.malformed_skipped > 0 ? `${agg.totals.malformed_skipped} malformed` : null,
  ].filter(Boolean);
  lines.push(`  Calls              : ${agg.totals.calls}${skipped.length ? ` (excluded: ${skipped.join(', ')})` : ''}`);
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
    output({ cleared: false, error: e.message || 'ledger_clear_failed' }, raw);
  }
}

// ─── Rate-table staleness ───────────────────────────────────────────────────

// Date DEFAULT_RATES was last verified against published provider pricing.
// Bump this whenever the table is re-verified; `models check` flags the table
// once it is older than RATES_STALE_AFTER_DAYS (provider prices move faster
// than PAN releases do).
const RATES_VERIFIED_AT = '2026-09-10';
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
  // Surface the managed rates too: an organisation that pins `modelPricing`
  // should be able to see that PAN found the block, not infer it from totals.
  const result = { ...checkRatesStaleness(), managed_model_pricing: Object.keys(loadManagedModelPricing() || {}) };
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
  isEmptyRecord,
  renderTable,
  renderChart,
  resolveRate,
  ratesFromModelPricing,
  managedSettingsDir,
  loadManagedModelPricing,
  effectiveRates,
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
