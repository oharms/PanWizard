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
 *
 * CLAUDE_CODE_FORK_SUBAGENT is deliberately left alone. Claude Code 2.1.302 turned fork
 * mode on by default in `claude -p`: main-conversation spawns run in the background and
 * `run_in_background` leaves the Agent tool, while typed and `general-purpose` spawns
 * still start fresh. That is what users now run, so the harness measures it; the
 * double-backed scenarios passed on 2.1.302 (reality check R54, 2026-10-19). Set
 * `CLAUDE_CODE_FORK_SUBAGENT=0` in the caller's environment to compare with a baseline
 * recorded before 2.1.302.
 */
function modelEnv(base = process.env) {
  const env = { ...base };
  if (env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS === undefined) env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '0';
  return env;
}

/** The `claude` argv for a model step. Pure apart from the .mcp.json existence check. */
function modelArgs(ws, { maxUsd, pluginDir, strictMcp = true, persistSession = false, resume = null }) {
  const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions'];
  // A resumed session (H9's scripted user) is written back, so the next answer finds it.
  if (resume) args.push('--resume', String(resume));
  else if (!persistSession) args.push('--no-session-persistence');
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
    sessionId: json && typeof json.session_id === 'string' ? json.session_id : null,
    json,
  };
}

/** Block this thread for `ms` (the step runner is synchronous; the double is another process). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Start a model-double process and wait for its port (the step runner is synchronous).
 * @returns {{child, port: number|null}}
 */
function startDoubleProcess(args, portFile) {
  const { spawn } = require('child_process');
  try { fs.rmSync(portFile, { force: true }); } catch { /* fresh */ }
  const child = spawn(process.execPath, [path.join(__dirname, 'double-server.cjs'), ...args, '--port-file', portFile], { stdio: ['pipe', 'ignore', 'pipe'] });
  let port = null;
  for (let waited = 0; waited < 10000 && port === null; waited += 50) {
    try { port = Number(fs.readFileSync(portFile, 'utf8').trim()) || null; } catch { sleepSync(50); }
  }
  return { child, port };
}

function stopDoubleProcess(d) {
  if (!d || !d.child) return;
  try { d.child.stdin.end(); } catch { /* gone */ }
  sleepSync(100);
  try { d.child.kill(); } catch { /* gone */ }
}

/**
 * A model step backed by the local model double (H1; ADR-0047 D2 as amended 2026-10-12):
 * the host CLI runs for real against `harness/src/double-server.cjs`. Nothing reaches a
 * real model, so nothing is spent and the step is tier 0. The host gets a scratch config
 * dir and a dummy key, so a user's own login is never read or used.
 *
 * Modes (H2):
 *   script   `double.script`: answer from the script
 *   record   `double.record.script` + `double.cassette`: a scripted upstream answers through
 *            a recorder, and the recorded pairs are written to the cassette (synthetic,
 *            tier 0). Recording from a real model (`double.record.upstream`) is refused here:
 *            it spends, needs an API key and a per-run --max-usd (program H2 evidence step).
 *   replay   `double.cassette` alone: answer from the cassette; a request with no recorded
 *            pair is drift, attributed to the agent whose body it carries
 * @param {string} ws - the workspace
 * @param {string} prompt
 * @param {{runtime?: string, double: object, capturesDir: string, configDir: string, other?: string, timeoutMs?: number}} opts
 */
function runDoubledModelStep(ws, prompt, opts) {
  const runtime = opts.runtime || 'claude';
  const { hostEnv, attributeDrift } = require('./model-double.cjs');
  const spec = opts.double || (opts.script ? { script: opts.script } : {});
  if (!hostEnv(runtime, 'http://127.0.0.1:1')) {
    return { code: 2, stdout: '', stderr: `refused: ${runtime} takes no model base URL from the environment, so the double cannot stand in for its model yet`, costUsd: 0, refused: true };
  }
  if (spec.record && spec.record.upstream) {
    return { code: 2, stdout: '', stderr: 'refused: recording from a real model spends and needs an API key and a per-run --max-usd; it is not a tier-0 step', costUsd: 0, refused: true };
  }
  fs.mkdirSync(opts.capturesDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(opts.configDir, { recursive: true, mode: 0o700 });
  const tag = path.join(opts.capturesDir, '..', path.basename(opts.capturesDir));
  const agentsDir = path.join(ws, `.${runtime === 'claude' ? 'claude' : runtime}`, 'agents');
  const ctxArgs = ['--ws', ws, '--home', opts.configDir, '--agents', agentsDir, ...(opts.other ? ['--other', opts.other] : [])];
  const started = [];
  let front;
  if (spec.record) {
    fs.writeFileSync(`${tag}.upstream.json`, JSON.stringify(spec.record.script || {}), { mode: 0o600 });
    const up = startDoubleProcess(['--mode', 'script', '--script', `${tag}.upstream.json`, '--captures', `${opts.capturesDir}-upstream`, ...ctxArgs], `${tag}.upstream.port`);
    started.push(up);
    if (!up.port) { started.forEach(stopDoubleProcess); return { code: 1, stdout: '', stderr: 'the upstream double did not start within 10 s', costUsd: 0, doubled: true, captures: [], drift: [] }; }
    front = startDoubleProcess(['--mode', 'record', '--upstream', `http://127.0.0.1:${up.port}`, '--captures', opts.capturesDir, ...ctxArgs], `${tag}.port`);
  } else if (spec.cassette && !spec.script) {
    front = startDoubleProcess(['--mode', 'replay', '--cassette', spec.cassette, '--captures', opts.capturesDir, ...ctxArgs], `${tag}.port`);
  } else {
    fs.writeFileSync(`${tag}.script.json`, JSON.stringify(spec.script || {}), { mode: 0o600 });
    front = startDoubleProcess(['--mode', 'script', '--script', `${tag}.script.json`, '--captures', opts.capturesDir, ...ctxArgs], `${tag}.port`);
  }
  started.push(front);
  if (!front.port) {
    started.forEach(stopDoubleProcess);
    return { code: 1, stdout: '', stderr: 'the model double did not start within 10 s', costUsd: 0, doubled: true, captures: [], drift: [] };
  }
  const env = hostEnv(runtime, `http://127.0.0.1:${front.port}`, { ...modelEnv(), CLAUDE_CONFIG_DIR: opts.configDir });
  const args = ['-p', '--output-format', 'json', '--dangerously-skip-permissions'];
  if (opts.resume) args.push('--resume', String(opts.resume));
  else if (!opts.persistSession) args.push('--no-session-persistence');
  const mcpConfig = path.join(ws, '.mcp.json');
  if (fs.existsSync(mcpConfig)) args.push('--mcp-config', mcpConfig, '--strict-mcp-config');
  const r = spawnSync(MODEL_RUNTIMES[runtime].bin, args, {
    cwd: ws, input: prompt, encoding: 'utf8', timeout: opts.timeoutMs || 5 * 60000, env,
    stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024,
  });
  started.slice().reverse().forEach(stopDoubleProcess);
  const captures = [];
  for (const f of fs.readdirSync(opts.capturesDir).filter((n) => /^\d{3}\.json$/.test(n)).sort()) {
    try { captures.push(JSON.parse(fs.readFileSync(path.join(opts.capturesDir, f), 'utf8'))); } catch { /* a torn capture is skipped */ }
  }
  const readList = (name) => { try { return JSON.parse(fs.readFileSync(path.join(opts.capturesDir, name), 'utf8')); } catch { return []; } };
  // One drift per key (the host retries a refused request), attributed from the full captured
  // system prompt: the drift record keeps only its first lines.
  const driftByKey = new Map();
  for (const d of readList('drift.json')) {
    const seen = driftByKey.get(d.key);
    if (seen) { seen.requests++; continue; }
    const cap = captures.find((c) => c.n === d.n);
    driftByKey.set(d.key, { ...d, requests: 1, attributed: attributeDrift(cap ? cap.system : d.system, agentsDir) });
  }
  const drift = [...driftByKey.values()];
  let recorded = 0;
  if (spec.record && spec.cassette) {
    const pairs = readList('recorded.json');
    fs.mkdirSync(path.dirname(spec.cassette), { recursive: true, mode: 0o700 });
    fs.writeFileSync(spec.cassette, JSON.stringify(pairs, null, 2), { mode: 0o600 });
    recorded = pairs.length;
  }
  let json = null;
  try { json = JSON.parse(String(r.stdout || '')); } catch { /* not JSON */ }
  return {
    code: json ? (json.is_error ? 1 : 0) : (r.status ?? 1),
    stdout: json && typeof json.result === 'string' ? json.result : String(r.stdout || ''),
    stderr: String(r.stderr || '') + (r.error ? `\n${r.error.message}` : ''),
    costUsd: 0, // the double answered: nothing was spent, whatever the host computed from its usage fields
    turns: json && typeof json.num_turns === 'number' ? json.num_turns : null,
    sessionId: json && typeof json.session_id === 'string' ? json.session_id : null,
    captures, drift, recorded, capturesDir: opts.capturesDir, doubled: true, resumed: !!opts.resume, json,
  };
}

module.exports = { runModelStep, runDoubledModelStep, modelEnv, modelArgs, modelArgsFor, MODEL_RUNTIMES };
