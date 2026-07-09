/**
 * Bridge — MCP tool discovery + per-phase recommendation (Spec B v2 Y-5, v3.3).
 *
 * Discovery-only scope. We discover what MCP tools are reachable from the
 * host runtime and what their shapes look like, then recommend which tools
 * a given phase plan might use. We do NOT auto-inject tools into plans or
 * auto-invoke them — those belong to a future wave once MCP schemas stabilize.
 *
 * Data lives at `.planning/bridge/available-tools.json`:
 *   {
 *     cached_at: "2026-04-18T...",
 *     runtime: "claude",
 *     servers: [
 *       {
 *         name: "linear",
 *         version: "1.2.3",
 *         tools: [
 *           { name: "linear.updateTicket", description: "...", schema: {...} },
 *           ...
 *         ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Populating this file is the host runtime's responsibility (Claude Code's
 * MCP list API, etc.). This module reads the cache and reasons over it.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, toPosix, findPhaseInternal } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

const BRIDGE_DIR = 'bridge';
const TOOLS_FILE = 'available-tools.json';

function bridgeDir(cwd) {
  return path.join(planningPath(cwd), BRIDGE_DIR);
}

function toolsCacheFile(cwd) {
  return path.join(bridgeDir(cwd), TOOLS_FILE);
}

/**
 * Load the cached tool list. Returns an empty catalog if the cache is
 * missing or malformed.
 *
 * @param {string} cwd - Project root
 * @returns {{cached_at: string|null, runtime: string|null, servers: Array, source: 'cache'|'empty'}}
 */
function loadToolCache(cwd) {
  const raw = safeReadFile(toolsCacheFile(cwd));
  if (!raw) return { cached_at: null, runtime: null, servers: [], source: 'empty' };
  try {
    const parsed = JSON.parse(raw);
    return {
      cached_at: parsed.cached_at || null,
      runtime: parsed.runtime || null,
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      source: 'cache',
    };
  } catch {
    return { cached_at: null, runtime: null, servers: [], source: 'empty' };
  }
}

/**
 * Write the tool cache. Used by the command when the host runtime provides
 * a fresh tool list (or by tests for fixture setup).
 *
 * @param {string} cwd - Project root
 * @param {{runtime, servers}} data
 * @returns {{written: true, file: string}|{error: string}}
 */
function writeToolCache(cwd, data) {
  if (!data || typeof data !== 'object') return { error: 'data required' };
  try {
    fs.mkdirSync(bridgeDir(cwd), { recursive: true });
  } catch (e) {
    return { error: `Failed to create bridge dir: ${e.message}` };
  }
  const payload = {
    cached_at: new Date().toISOString(),
    runtime: data.runtime || null,
    servers: Array.isArray(data.servers) ? data.servers : [],
  };
  const file = toolsCacheFile(cwd);
  try {
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    return { error: `Failed to write ${file}: ${e.message}` };
  }
  return { written: true, file: toPosix(path.relative(cwd, file)) };
}

/**
 * Flatten server → tool hierarchy into a single list for easier reasoning.
 *
 * @param {Array} servers - From loadToolCache().servers
 * @returns {Array<{server, name, description, schema}>}
 */
function flattenTools(servers) {
  const tools = [];
  for (const server of servers || []) {
    if (!server || !Array.isArray(server.tools)) continue;
    for (const tool of server.tools) {
      if (!tool || !tool.name) continue;
      tools.push({
        server: server.name,
        name: tool.name,
        description: tool.description || '',
        schema: tool.schema || null,
      });
    }
  }
  return tools;
}

/**
 * List all available MCP tools, flattened.
 *
 * @param {string} cwd - Project root
 * @returns {Object}
 */
function listTools(cwd) {
  const cache = loadToolCache(cwd);
  const tools = flattenTools(cache.servers);
  return {
    cached_at: cache.cached_at,
    runtime: cache.runtime,
    server_count: cache.servers.length,
    tool_count: tools.length,
    tools,
    source: cache.source,
  };
}

// ─── Recommendation scoring ────────────────────────────────────────────────

/**
 * Score a tool's relevance to a phase by matching plan keywords against
 * tool name + description. Naive frequency-based scoring (no embeddings).
 *
 * @param {string} phaseText - Combined plan text
 * @param {{server, name, description}} tool
 * @returns {{score: number, hits: Array<string>}}
 */
function scoreToolForPhase(phaseText, tool) {
  if (!phaseText || !tool) return { score: 0, hits: [] };
  const body = phaseText.toLowerCase();
  const haystack = `${tool.server || ''} ${tool.name || ''} ${tool.description || ''}`.toLowerCase();

  // Extract keywords from the tool's identity: split on non-word chars, dedupe, keep ≥3 chars.
  const keywords = [...new Set(haystack.split(/\W+/).filter(w => w.length >= 3))];

  let score = 0;
  const hits = [];
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const count = (body.match(re) || []).length;
    if (count > 0) {
      score += count;
      hits.push(kw);
    }
  }
  return { score, hits };
}

/**
 * Recommend MCP tools for a specific phase based on plan text keyword match.
 *
 * @param {string} cwd - Project root
 * @param {string|number} phaseNum - Phase identifier
 * @param {Object} [opts] - {max_recommendations, min_score}
 * @returns {Object}
 */
function recommendForPhase(cwd, phaseNum, opts) {
  const cache = loadToolCache(cwd);
  const tools = flattenTools(cache.servers);
  if (tools.length === 0) {
    return {
      phase: String(phaseNum),
      runtime: cache.runtime,
      recommendations: [],
      reason: 'no MCP tools cached — run `pan-tools bridge cache` or ensure host runtime populates .planning/bridge/available-tools.json',
    };
  }

  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo || !phaseInfo.found) {
    return {
      phase: String(phaseNum),
      error: `Phase ${phaseNum} not found in .planning/phases/`,
    };
  }

  const phaseDir = path.join(cwd, phaseInfo.directory);
  const planTexts = (phaseInfo.plans || [])
    .map(f => safeReadFile(path.join(phaseDir, f)) || '')
    .join('\n');

  const max = Math.max(1, Math.min(50, Number(opts?.max_recommendations) || 10));
  const minScore = Math.max(0, Number(opts?.min_score) || 1);

  const scored = tools
    .map(tool => ({
      ...tool,
      ...scoreToolForPhase(planTexts, tool),
    }))
    .filter(t => t.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, max);

  return {
    phase: String(phaseNum),
    phase_name: phaseInfo.name || null,
    runtime: cache.runtime,
    total_candidates: tools.length,
    recommendations: scored.map(t => ({
      server: t.server,
      name: t.name,
      description: t.description,
      score: t.score,
      hits: t.hits,
    })),
  };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdBridgeList(cwd, raw) {
  output(listTools(cwd), raw);
}

function cmdBridgeRecommend(cwd, phaseNum, opts, raw) {
  if (!phaseNum) error('Usage: bridge recommend <phase> [--max N] [--min-score N]');
  output(recommendForPhase(cwd, phaseNum, opts), raw);
}

function cmdBridgeCache(cwd, serversJson, runtime, raw) {
  // For scripted cache writes. Normally the host runtime writes the file,
  // but this CLI path lets users seed it for testing or from external scripts.
  if (!serversJson) {
    // No payload — just echo the current cache path/state.
    output(listTools(cwd), raw);
    return;
  }
  let servers;
  try { servers = JSON.parse(serversJson); }
  catch (e) { error(`Invalid --servers JSON: ${e.message}`); }
  output(writeToolCache(cwd, { runtime, servers }), raw);
}

module.exports = {
  loadToolCache,
  writeToolCache,
  flattenTools,
  listTools,
  scoreToolForPhase,
  recommendForPhase,
  cmdBridgeList,
  cmdBridgeRecommend,
  cmdBridgeCache,
  BRIDGE_DIR,
  TOOLS_FILE,
};
