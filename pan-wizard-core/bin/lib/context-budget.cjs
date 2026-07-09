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
    cache = {
      block_count: cached.blocks.length,
      block_paths: cached.blocks.map(b => b.path),
      total_bytes: cached.total_bytes,
      total_tokens: cacheTokens,
      eligible_pct: eligiblePct,
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
};
