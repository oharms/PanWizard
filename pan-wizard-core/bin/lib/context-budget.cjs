/**
 * Context Budget — Estimate context utilization and quality for current phase
 *
 * Reads state.md, phase plans, and config to produce a context health report.
 * Makes PAN's context rot prevention visible and measurable.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, loadConfig, findPhaseInternal, toPosix } = require('./core.cjs');
const { planningPath, phasesPath, fileAccessible } = require('./utils.cjs');
const { STATE_FILE, ROADMAP_FILE, PROJECT_FILE, isPlanFile, isSummaryFile, CHARS_PER_TOKEN, CONTEXT_WINDOW, WARNING_THRESHOLD, CRITICAL_THRESHOLD } = require('./constants.cjs');

/**
 * Estimate token count from text content.
 * @param {string} text - Text content
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate a relevance signal for per-phase markdown content (P-RES-002).
 *
 * Per Chroma's "Context Rot" research (Hong & Huber, July 2025): a single
 * semantically-similar-but-irrelevant distractor degrades performance even
 * at modest context sizes. Distractor density matters more than token count.
 *
 * Computing TRUE topic-relevance requires embeddings or keyword analysis
 * we can't do cheaply at zero deps. This v0 heuristic reports a simpler
 * signal: structure-vs-content ratio. Markdown files heavy on headers,
 * separators, empty bullet lists, and placeholder text are LESS dense in
 * actual signal than files of equal length with concrete prose. The ratio
 * isn't true distractor density but is correlated with it for the
 * "thin/template-only context" failure mode.
 *
 * Returns ratio in [0, 1] where 1 = all content lines, 0 = all structure.
 * Returns null if not enough lines to compute meaningfully.
 *
 * @param {string} text
 * @returns {number|null}
 */
function estimateRelevanceRatio(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  if (lines.length < 5) return null;
  let contentLines = 0;
  let totalLines = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;                              // skip blank
    totalLines++;
    if (/^#{1,6}\s/.test(line)) continue;             // skip header
    if (/^[-*_]{3,}$/.test(line)) continue;           // skip separator
    if (/^[-*]\s*$/.test(line)) continue;             // skip empty bullet
    if (/^[-*]\s*\[\s*[\]x_]\s*\]\s*$/.test(line)) continue; // empty checkbox
    if (/^\|\s*-+\s*\|/.test(line)) continue;         // table separator row
    if (/^>\s*$/.test(line)) continue;                // empty blockquote
    if (line.length < 10) continue;                   // very short — likely scaffolding
    if (/^(TODO|TBD|FIXME|placeholder|todo|tbd|fixme|placeholder|coming soon)\b/i.test(line)) continue;
    contentLines++;
  }
  if (totalLines === 0) return null;
  return Math.round((contentLines / totalLines) * 1000) / 1000;
}

/**
 * Compute context budget for the current project state.
 * @param {string} cwd - Project root directory
 * @param {boolean} raw - If true, output human-readable string
 */
// ─── Prompt-cache lifetime signal (2026-09, ADR-0044 follow-up) ─────────────
//
// Claude Code decides the prompt-cache lifetime per request bucket: the main
// conversation can get one hour on a subscription, but EVERYTHING ELSE —
// subagents, workflows, forks — gets five minutes unless `subagentPromptCacheTtl`
// (≥2.1.242) says otherwise. Every PAN agent is a subagent. So a phase whose
// agents are spaced more than five minutes apart re-writes the same cached
// context block each time, and ADR-0044 measured that block as the bulk of PAN's
// token traffic. This assessor reads the cost ledger for exactly that signature:
// a cache WRITE that follows an idle gap of five to sixty minutes — a miss the
// one-hour lifetime would have turned into a hit. It recommends the setting only
// when the pattern recurs, because one-hour writes bill at 2× base input against
// 1.25× for five-minute writes: the longer lifetime pays off once a block is read
// twice inside the hour, and costs more on bursts that never idle.

const TTL_SHORT_MIN = 5;     // the default subagent lifetime, in minutes
const TTL_LONG_MIN = 60;     // the lifetime the setting buys
const TTL_MIN_WRITE_TOKENS = 1000;  // ignore trivial writes (a few tokens of tool results)
const TTL_RECOMMEND_AT = 2;  // recurrence, not a single event, earns the recommendation
// Above this much re-written context the recommendation is a warning, not an aside: it
// fired in eight of ten field projects while filed at `info`, where nothing surfaces it
// (sweep 2026-09-17). Below it the pattern is real but cheap, and stays informational.
const TTL_WARN_TOKENS = 1000000;

/**
 * Pure. Scan ledger records (oldest first by `ts`) for cache writes that follow
 * an idle gap in (TTL_SHORT_MIN, TTL_LONG_MIN] — writes the one-hour lifetime
 * would have avoided. Records without a parseable `ts`, and records flagged
 * suspect by the caller (pass them pre-filtered), are ignored.
 *
 * @param {Array<object>} records - cost ledger rows ({ts, cache_write_tokens, …})
 * @param {{minWriteTokens?:number, recommendAt?:number}} [opts]
 * @returns {{records_considered:number, writes_after_short_idle:number, tokens_after_short_idle:number, writes_after_long_idle:number, recommend:boolean, setting:string, advice:string|null}}
 */
function assessCacheTtl(records, opts = {}) {
  const minWrite = opts.minWriteTokens ?? TTL_MIN_WRITE_TOKENS;
  const recommendAt = opts.recommendAt ?? TTL_RECOMMEND_AT;
  const rows = (Array.isArray(records) ? records : [])
    // A `cost rebuild` main-thread row is one session's whole usage dated to its
    // last record: its cache writes are not a subagent's re-write after an idle
    // gap, and the subagent cache lifetime setting does not govern them.
    .filter(r => !(r && r.token_source === 'session-transcript'))
    // A row that recorded the cache-write lifetime split (M13) says which writes
    // were five-minute ones; only those can be a re-write after a short idle gap —
    // a one-hour write already outlives it. Rows without the split fall back to the
    // gap heuristic on the whole write.
    .map(r => {
      const measured = r && typeof r.cache_write_5m_tokens === 'number';
      return {
        t: r && r.ts ? new Date(r.ts).getTime() : NaN,
        w: measured ? r.cache_write_5m_tokens : (Number(r && r.cache_write_tokens) || 0),
        w1h: measured ? (Number(r.cache_write_1h_tokens) || 0) : 0,
        measured,
      };
    })
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  const measuredRows = rows.filter(r => r.measured);
  const basis = measuredRows.length === 0 ? 'inferred' : measuredRows.length === rows.length ? 'measured' : 'mixed';
  let shortIdle = 0; let shortIdleTokens = 0; let longIdle = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].w < minWrite) continue;
    const gapMin = (rows[i].t - rows[i - 1].t) / 60000;
    if (gapMin > TTL_SHORT_MIN && gapMin <= TTL_LONG_MIN) { shortIdle++; shortIdleTokens += rows[i].w; }
    else if (gapMin > TTL_LONG_MIN) longIdle++;
  }
  const recommend = shortIdle >= recommendAt;
  const setting = 'subagentPromptCacheTtl';
  const severity = recommend && shortIdleTokens >= (opts.warnTokens ?? TTL_WARN_TOKENS) ? 'warn' : 'info';
  const basisNote = basis === 'measured'
    ? ' (measured: the ledger records each write\'s cache lifetime)'
    : basis === 'mixed'
      ? ' (partly measured: rows written before PAN recorded the cache lifetime are counted from idle gaps alone)'
      : ' (inferred from idle gaps between rows: no row records the cache lifetime)';
  const advice = recommend
    ? `${shortIdle} cache writes followed an idle gap of ${TTL_SHORT_MIN}–${TTL_LONG_MIN} min (~${shortIdleTokens.toLocaleString()} tokens re-written): subagents get the five-minute cache lifetime by default — set \`${setting}: "1h"\` in a Claude Code settings file. One-hour writes bill at 2× base input against 1.25×, so this pays off once a block is read twice within the hour.${basisNote}`
    : null;
  return {
    records_considered: rows.length,
    writes_after_short_idle: shortIdle,
    tokens_after_short_idle: shortIdleTokens,
    writes_after_long_idle: longIdle,
    // Where the split came from: 'measured' (every row carries it), 'mixed', or
    // 'inferred' (none does — the gap heuristic alone).
    basis,
    measured_rows: measuredRows.length,
    cache_write_1h_tokens: measuredRows.reduce((n, r) => n + r.w1h, 0),
    cache_write_5m_tokens: measuredRows.reduce((n, r) => n + r.w, 0),
    recommend,
    setting,
    severity,
    advice,
  };
}

function cmdContextBudget(cwd, raw) {
  const planDir = planningPath(cwd);
  if (!fileAccessible(planDir)) {
    return output({ error: '.planning/ directory not found', hint: 'Run /pan:new-project to initialize' }, raw,
      'Error: .planning/ directory not found\nHint: Run /pan:new-project to initialize');
  }

  const config = loadConfig(cwd);

  // Read core files and estimate tokens
  const stateContent = safeReadFile(path.join(planDir, STATE_FILE));
  const roadmapContent = safeReadFile(path.join(planDir, ROADMAP_FILE));
  const projectContent = safeReadFile(path.join(planDir, PROJECT_FILE));

  const stateTokens = estimateTokens(stateContent);
  const roadmapTokens = estimateTokens(roadmapContent);
  const projectTokens = estimateTokens(projectContent);

  // Find current phase and estimate plan tokens
  let currentPhase = null;
  let planTokens = 0;
  let planCount = 0;
  let incompletePlanCount = 0;
  let phaseDir = null;

  if (stateContent) {
    const phaseMatch = stateContent.match(/\*\*Current Phase:\*\*\s*(\S+)/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1];
      const phaseInfo = findPhaseInternal(cwd, currentPhase);
      if (phaseInfo && phaseInfo.found) {
        phaseDir = phaseInfo.directory;
        planCount = phaseInfo.plans.length;
        incompletePlanCount = phaseInfo.incomplete_plans.length;

        // Estimate plan tokens
        const fullPhasePath = path.join(cwd, phaseInfo.directory);
        for (const planFile of phaseInfo.plans) {
          const planContent = safeReadFile(path.join(fullPhasePath, planFile));
          planTokens += estimateTokens(planContent);
        }
      }
    }
  }

  // Calculate totals
  const contextTokens = stateTokens + roadmapTokens + projectTokens;
  const totalTokens = contextTokens + planTokens;
  const utilization = totalTokens / CONTEXT_WINDOW;

  // Determine status
  let status = 'healthy';
  if (!currentPhase) {
    status = 'idle';
  } else if (utilization >= CRITICAL_THRESHOLD) {
    status = 'critical';
  } else if (utilization >= WARNING_THRESHOLD) {
    status = 'warning';
  }

  // Generate recommendation
  let recommendation;
  if (status === 'idle') {
    recommendation = 'No active phase. Run /pan:plan-phase to start.';
  } else if (status === 'critical') {
    recommendation = 'Context budget near limit. Consider splitting this phase into smaller phases.';
  } else if (status === 'warning') {
    recommendation = 'Context usage is elevated. Monitor quality during execution.';
  } else {
    const remainingTokens = CONTEXT_WINDOW - totalTokens;
    const avgPlanTokens = planCount > 0 ? Math.ceil(planTokens / planCount) : 5000;
    const additionalPlans = avgPlanTokens > 0 ? Math.floor(remainingTokens / avgPlanTokens) : 0;
    recommendation = `Within budget. ~${additionalPlans} more plans could fit before degradation.`;
  }

  // P-RES-002 signal: structure-vs-content ratio for per-phase markdown.
  // High structure (lots of empty bullets, headers, placeholders) suggests
  // the per-phase context is thin/templatey rather than substantive — a
  // proxy for "context that's wasting tokens on filler."
  let relevanceSignal = null;
  if (phaseDir) {
    const fullPhasePath = path.join(cwd, phaseDir);
    const samples = [];
    for (const fname of ['research.md', 'context.md']) {
      const candidate = path.join(fullPhasePath, fname);
      const content = safeReadFile(candidate);
      if (content) {
        const ratio = estimateRelevanceRatio(content);
        if (ratio !== null) samples.push({ file: toPosix(path.join(phaseDir, fname)), ratio });
      }
    }
    if (samples.length > 0) {
      const avg = samples.reduce((a, s) => a + s.ratio, 0) / samples.length;
      relevanceSignal = {
        avg_ratio: Math.round(avg * 1000) / 1000,
        samples,
        note: 'P-RES-002 v0 heuristic — structure/content ratio. <0.4 suggests thin per-phase context (heavy on headers + empty buckets + placeholders).',
      };
    }
  }

  // E-8: cache metrics — surface how much of the total context would be
  // served from prompt cache when Opus 4.7 cache_control is active.
  const { buildCachedContext } = require('./core.cjs');
  let cache = null;
  try {
    const cached = buildCachedContext(cwd);
    const cacheTokens = Math.ceil(cached.total_bytes / 4); // CHARS_PER_TOKEN ~ 4
    const eligiblePct = totalTokens > 0
      ? Math.round((cacheTokens / totalTokens) * 1000) / 10
      : 0;
    // The cached block is re-read into EVERY agent call, so its size is the
    // project's largest recurring cost. This used to be measured and reported
    // with no threshold attached, which meant a block that had grown to ~28k
    // tokens of mostly closed history looked exactly like a healthy one.
    // Classifying it is what turns the measurement into a signal.
    const { CACHE_BLOCK_WARN_TOKENS, CACHE_BLOCK_CRIT_TOKENS, CACHE_FILE_WARN_TOKENS } = require('./constants.cjs');
    const largest = cached.blocks
      .map(b => ({ path: b.path, tokens: Math.ceil((b.content || '').length / 4) }))
      .sort((a, b) => b.tokens - a.tokens);

    let cacheStatus = 'ok';
    if (cached.blocks.length === 0) cacheStatus = 'absent';
    else if (cacheTokens >= CACHE_BLOCK_CRIT_TOKENS) cacheStatus = 'critical';
    else if (cacheTokens >= CACHE_BLOCK_WARN_TOKENS) cacheStatus = 'warn';

    const advice = cacheStatus === 'absent'
      ? 'no cacheable context files — every agent call re-sends its context uncached'
      : cacheStatus === 'ok'
        ? null
        : `cached context is re-read on every agent call; largest file ${largest[0].path} (~${largest[0].tokens} tokens)`
          + (largest[0].path.endsWith('state.md') ? ' — run `pan-tools state compact`' : '');

    // Lifetime signal from the ledger (suspect rows excluded — they carry
    // poisoned counters, not real writes). Absent ledger → zero rows, no advice.
    let ttl = null;
    try {
      const { readRecords, isSuspectRecord } = require('./cost.cjs');
      ttl = assessCacheTtl(readRecords(cwd).filter(r => !isSuspectRecord(r)));
    } catch { ttl = null; }

    cache = {
      block_count: cached.blocks.length,
      block_paths: cached.blocks.map(b => b.path),
      block_tokens: largest,
      total_bytes: cached.total_bytes,
      total_tokens: cacheTokens,
      eligible_pct: eligiblePct,
      status: cacheStatus,
      warn_tokens: CACHE_BLOCK_WARN_TOKENS,
      crit_tokens: CACHE_BLOCK_CRIT_TOKENS,
      file_warn_tokens: CACHE_FILE_WARN_TOKENS,
      advice,
      ttl,
      sha: cached.sha,
    };
  } catch {
    // buildCachedContext failed — surface as null, not as an error.
    cache = null;
  }

  const result = {
    status,
    currentPhase: currentPhase || null,
    phaseDirectory: phaseDir ? toPosix(phaseDir) : null,
    plans: planCount,
    incompletePlans: incompletePlanCount,
    modelProfile: config.model_profile,
    tokens: {
      project: projectTokens,
      roadmap: roadmapTokens,
      state: stateTokens,
      plans: planTokens,
      total: totalTokens,
    },
    contextWindow: CONTEXT_WINDOW,
    budgetUtilization: Math.round(utilization * 1000) / 1000,
    cache,
    relevanceSignal,
    recommendation,
  };

  if (raw) {
    const lines = [
      `Context Budget: ${status.toUpperCase()}`,
      ``,
      `Current Phase: ${currentPhase || 'none'}`,
      `Model Profile: ${config.model_profile}`,
      `Plans: ${planCount} total, ${incompletePlanCount} incomplete`,
      ``,
      `Token Estimates:`,
      `  project.md:  ${projectTokens.toLocaleString()}`,
      `  roadmap.md:  ${roadmapTokens.toLocaleString()}`,
      `  state.md:    ${stateTokens.toLocaleString()}`,
      `  Phase Plans: ${planTokens.toLocaleString()}`,
      `  Total:       ${totalTokens.toLocaleString()} / ${CONTEXT_WINDOW.toLocaleString()}`,
      ``,
      `Utilization: ${(utilization * 100).toFixed(1)}%`,
      cache && cache.block_count > 0
        ? `Cache: ${cache.block_count} blocks, ${cache.total_tokens.toLocaleString()} tokens (${cache.eligible_pct}% of total)`
        : `Cache: 0 blocks (no cacheable .planning files)`,
      `${recommendation}`,
    ];
    return output(result, true, lines.join('\n'));
  }

  return output(result, false);
}

module.exports = {
  cmdContextBudget,
  estimateTokens,
  estimateRelevanceRatio,
  assessCacheTtl,
};
