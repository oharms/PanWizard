'use strict';

/**
 * Model steps (ADR-0047 D2): drive Claude Code headlessly in the workspace.
 *
 *   claude -p --output-format json --dangerously-skip-permissions
 *          --no-session-persistence --max-budget-usd <cap>
 *          [--mcp-config <ws>/.mcp.json --strict-mcp-config] [--plugin-dir <dir>]
 *
 * `persistSession: true` on a step drops --no-session-persistence. Without session
 * persistence the host writes no transcripts, including the per-agent
 * `subagents/agent-<id>.jsonl` files, so a step that measures what PAN's hooks read
 * from transcripts (tool-failure capture, per-agent token slices) must persist.
 * Every other step keeps the default: nothing lands in ~/.claude/projects.
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

/**
 * Environment for a headless `claude -p` model step. Pure over the base env.
 *
 * CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS — `claude -p` stays open while a background
 * subagent or Workflow it started is still running, but by default that wait ends
 * after ten minutes and Claude Code "stops whatever is still running and drops its
 * partial result" (code.claude.com/docs/en/headless, "Background tasks at exit", read
 * 2026-09-10). Both native-workflow reps measured that day died at ~605 s with
 * `Workflow aborted` — the ceiling, not PAN's script. `0` removes it; the harness's
 * own per-step timeout still bounds the run. A caller's explicit value wins.
 */
function modelEnv(base = process.env) {
  const env = { ...base };
  if (env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS === undefined) env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '0';
  return env;
}

/** The `claude` argv for a model step. Pure apart from the .mcp.json existence check. */
function modelArgs(ws, { maxUsd, pluginDir, strictMcp = true, persistSession = false }) {
  const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions'];
  if (!persistSession) args.push('--no-session-persistence');
  args.push('--max-budget-usd', String(maxUsd));
  const mcpConfig = path.join(ws, '.mcp.json');
  if (strictMcp && fs.existsSync(mcpConfig)) args.push('--mcp-config', mcpConfig, '--strict-mcp-config');
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  return args;
}

/**
 * The hosts a model step can name with `runtime` (MI-104: PAN's behaviour measured on
 * every host CLI, not Claude Code alone). `claude` is the measured path above. Each
 * other host carries only what its CLI's own --help states (read 2026-10-10: codex-cli
 * 0.157.1, GitHub Copilot CLI 1.0.91, Gemini CLI 0.61.0, OpenCode 1.18.32) and no output
 * parser: what each prints in JSON mode, and where its usage sits, has to be captured
 * from a real run before a parser is written (documented is not observed, ADR-0028).
 * Until a host has `parse`, its model steps are refused: ADR-0047 D2 caps spend, and a
 * step whose cost cannot be read cannot be capped.
 *   promptVia: 'stdin' | 'arg' — how the prompt reaches the CLI.
 */
const MODEL_RUNTIMES = {
  claude: { bin: 'claude', promptVia: 'stdin', parse: true },
  // `codex exec -` reads the prompt from stdin; --json streams JSONL events.
  codex: { bin: 'codex', promptVia: 'stdin', args: () => ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-'] },
  // `-p` takes the prompt as an argument; --output-format json is JSONL.
  copilot: { bin: 'copilot', promptVia: 'arg', args: (p) => ['-p', p, '--output-format', 'json', '--allow-all-tools', '--allow-all-paths'] },
  // `-p` runs headless; -o json; --approval-mode yolo auto-approves tools.
  gemini: { bin: 'gemini', promptVia: 'arg', args: (p) => ['-p', p, '-o', 'json', '--approval-mode', 'yolo'] },
  // `run <message..>` with --format json (raw JSON events).
  opencode: { bin: 'opencode', promptVia: 'arg', args: (p) => ['run', '--format', 'json', p] },
};

/** The argv for a non-Claude model step, or null for an unknown host. Pure. */
function modelArgsFor(runtime, prompt) {
  const rt = MODEL_RUNTIMES[runtime];
  if (!rt || !rt.args) return null;
  return rt.args(prompt);
}

function runModelStep(ws, prompt, opts) {
  const { maxUsd, timeoutMs = 20 * 60000 } = opts;
  if (!(typeof maxUsd === 'number' && maxUsd > 0)) {
    return { code: 2, stdout: '', stderr: 'refused: model steps require an explicit --max-usd', costUsd: 0, refused: true };
  }
  const runtime = opts.runtime || 'claude';
  if (!MODEL_RUNTIMES[runtime]) {
    return { code: 2, stdout: '', stderr: `refused: unknown model-step runtime "${runtime}"`, costUsd: 0, refused: true };
  }
  if (!MODEL_RUNTIMES[runtime].parse) {
    return { code: 2, stdout: '', stderr: `refused: no output parser for ${runtime} yet — its JSON and usage fields must be captured from a real run first, or the --max-usd cap could not be enforced (MI-104)`, costUsd: 0, refused: true };
  }
  const args = modelArgs(ws, opts);
  const r = spawnSync('claude', args, {
    cwd: ws, input: prompt, encoding: 'utf8', timeout: timeoutMs, env: modelEnv(),
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

module.exports = { runModelStep, modelEnv, modelArgs, modelArgsFor, MODEL_RUNTIMES };
