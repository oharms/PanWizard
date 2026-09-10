'use strict';

/**
 * Model steps (ADR-0047 D2): drive Claude Code headlessly in the workspace.
 *
 *   claude -p --output-format json --dangerously-skip-permissions
 *          --no-session-persistence --max-budget-usd <cap>
 *          [--mcp-config <ws>/.mcp.json --strict-mcp-config] [--plugin-dir <dir>]
 *
 * The prompt goes in on STDIN so no shell quoting is involved (`claude` is a .cmd
 * shim on Windows and needs a shell there; the argv stays literal). Isolation:
 * when the workspace carries an MCP registration the run is pinned to it with
 * --strict-mcp-config — PanLoop measured an agent seeing two `pan` servers
 * (workspace + plugin cache) with near-identical tool names without it.
 *
 * Cost is read from the JSON result (`total_cost_usd`), never estimated.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runModelStep(ws, prompt, opts) {
  const { maxUsd, timeoutMs = 20 * 60000, pluginDir, strictMcp = true } = opts;
  if (!(typeof maxUsd === 'number' && maxUsd > 0)) {
    return { code: 2, stdout: '', stderr: 'refused: model steps require an explicit --max-usd', costUsd: 0, refused: true };
  }
  const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions', '--no-session-persistence', '--max-budget-usd', String(maxUsd)];
  const mcpConfig = path.join(ws, '.mcp.json');
  if (strictMcp && fs.existsSync(mcpConfig)) args.push('--mcp-config', mcpConfig, '--strict-mcp-config');
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  const r = spawnSync('claude', args, {
    cwd: ws, input: prompt, encoding: 'utf8', timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024,
  });
  const raw = String(r.stdout || '');
  let json = null;
  try { json = JSON.parse(raw); } catch { /* not JSON — surface raw */ }
  const result = json && typeof json.result === 'string' ? json.result : raw;
  const isError = json ? !!json.is_error : r.status !== 0;
  return {
    code: isError ? 1 : (r.status ?? 1),
    stdout: result,
    stderr: String(r.stderr || '') + (r.error ? `\n${r.error.message}` : ''),
    costUsd: json && typeof json.total_cost_usd === 'number' ? json.total_cost_usd : 0,
    durationMs: json && typeof json.duration_ms === 'number' ? json.duration_ms : null,
    turns: json && typeof json.num_turns === 'number' ? json.num_turns : null,
    json,
  };
}

module.exports = { runModelStep };
