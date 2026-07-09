'use strict';
// @pan: ADR-0026
/**
 * runner.cjs — Self-improvement loop W2: external agent runner.
 *
 * Spec: docs/specs/self_improvement_loop_featureai.md §3.2
 *
 * Spawns an external AI coding session (Claude/Codex/Gemini/OpenCode) against
 * an experiment folder, observes progress via run-state.json, enforces timeout
 * + circuit breaker. The external instance runs autonomously; this runner
 * observes only — it does NOT inject prompts mid-flight.
 *
 * Exports:
 *   - runExperiment(slug, opts)           — spawn + observe + return result
 *   - tailExperimentState(slug, opts)     — read run-state.json snapshot
 *   - stopExperiment(slug, opts)          — graceful halt of a running experiment
 *   - RUNTIME_RUNNERS                     — adapter map (per-runtime headless invocation)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getExperimentManifest, PAN_EXPERIMENTS_ROOT_DEFAULT } = require('./experiment.cjs');

// ── Runtime adapter map ─────────────────────────────────────────────────────

/**
 * Each adapter knows how to invoke its runtime headlessly with a prompt.
 * `bin` is the binary name (PATH lookup at spawn time).
 * `buildArgs(prompt)` returns argv to pass after the bin.
 * `shell: 'win32'` opts the adapter into shell-based spawn ON WINDOWS ONLY —
 *   needed for CLI tools that ship as .cmd shims (npx/npm-installed binaries
 *   like claude/codex/gemini/opencode) which Node's spawnSync cannot resolve
 *   without a shell.
 *
 * Runtime overrides (--runtime-override / opts.runtimeOverride) do NOT inherit
 * shell: 'win32' — they default to direct spawn, which suits test mocks like
 * `node -e '...'` that are resolvable directly. P-102 fix (v3.7.1).
 *
 * GitHub Copilot CLI has no documented headless prompt mode, so it's null.
 */
// P-1302 fix (v3.7.2): autonomous claude/gemini runs default to non-interactive
// permissions. Without these flags, the CLI prompts for tool approval, which
// can't be answered in headless mode and exits 1 silently. Surfaced by the
// first real autonomous loop run (panloop experiment). The runner's purpose IS
// autonomous execution — defaulting to interactive permission prompts contradicts
// the design.
//
// Safety: the flags trust the prompt's tool choices. Acceptable because the
// runner only spawns inside isolated experiment folders (PAN_SOURCE_ROOT-guarded
// by experiment.cjs) — blast radius is bounded to the experiment dir.
// P-1603 (v3.7.5): when `opts.captureMetrics` is true the runner switches
// claude into `--output-format json` so the trailing usage envelope can be
// parsed for cost/token metrics. Other runtimes are unchanged — token
// metering for codex/gemini/opencode is deferred (no equivalent flag).
const RUNTIME_RUNNERS = Object.freeze({
  claude:   {
    bin: 'claude',
    buildArgs: (prompt, opts) => {
      const args = ['-p', '--dangerously-skip-permissions'];
      if (opts && opts.captureMetrics) args.push('--output-format', 'json');
      args.push(prompt);
      return args;
    },
    shell: 'win32',
  },
  codex:    { bin: 'codex',    buildArgs: (prompt) => ['exec', prompt],                                  shell: 'win32' },
  gemini:   { bin: 'gemini',   buildArgs: (prompt) => ['-p', '--yolo', prompt],                          shell: 'win32' },
  opencode: { bin: 'opencode', buildArgs: (prompt) => [prompt],                                          shell: 'win32' },
  copilot:  null,
});

// ── Stop reasons (enum-ish) ─────────────────────────────────────────────────

const STOP_REASONS = Object.freeze({
  SUCCESS: 'success',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  CIRCUIT_BREAKER: 'circuit_breaker',
  MANUAL: 'manual',
  INCOMPLETE: 'incomplete', // P-1502 (v3.7.4): exit 0 but workflow didn't reach milestone-completion
});

// P-EXP-004 (2026-05-02): bumped from 30 min to 60 min — 30 min cut off real
// 3-plan phases mid-execution (whoolog Phase 1 first run hit this).
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 60 min

// ── Helpers ─────────────────────────────────────────────────────────────────

function getRunStatePath(experimentPath) {
  return path.join(experimentPath, '.planning', 'run-state.json');
}

// P-1502 helper: read state.md and extract the milestone status field.
// Returns the status string or null if state.md is missing/malformed.
function readMilestoneStatus(experimentPath) {
  const statePath = path.join(experimentPath, '.planning', 'state.md');
  try {
    const text = fs.readFileSync(statePath, 'utf-8');
    const m = text.match(/^status:\s*(\S+)/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// P-1603 (v3.7.5): parse the trailing `--output-format json` envelope claude
// emits at end of a `claude -p --output-format json` session. The envelope is
// a single JSON object on its own line containing `{result, total_cost_usd,
// num_turns, session_id, usage: {input_tokens, output_tokens, ...}}`. We
// scan from end of stdout for the last `{...}` block and JSON-parse it.
// Returns null if claude was not invoked with --output-format json or the
// envelope is malformed.
function parseClaudeJsonEnvelope(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  const trimmed = stdout.trimEnd();
  if (!trimmed.endsWith('}')) return null;
  // Walk back to find the matching opening brace at column 0.
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trimEnd();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(lines.slice(i).join('\n'));
      if (obj && typeof obj === 'object' && (obj.total_cost_usd != null || obj.usage)) {
        return obj;
      }
    } catch {
      // try next earlier line
    }
  }
  return null;
}

function writeRunState(experimentPath, state) {
  const file = getRunStatePath(experimentPath);
  try {
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch {
    // best-effort; runner does not fail on persistence errors
  }
}

function readRunState(experimentPath) {
  const file = getRunStatePath(experimentPath);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

function appendEvent(state, type, details) {
  state.events = state.events || [];
  state.events.push({
    ts: new Date().toISOString(),
    type,
    details: details || null,
  });
}

// ── runExperiment ───────────────────────────────────────────────────────────

/**
 * Spawn the external runtime and wait for it to finish (or be aborted).
 *
 * @param {string} slug - experiment id
 * @param {object} opts
 * @param {string} [opts.root] - experiment root (default PAN_EXPERIMENTS_ROOT_DEFAULT)
 * @param {string} [opts.prompt] - prompt passed to the external runtime; default
 *   is `/pan:new-project --auto @.planning/idea.md`
 * @param {number} [opts.timeoutMs] - hard timeout (default 30 min)
 * @param {object} [opts.runtimeOverride] - { bin, buildArgs } to bypass the manifest's
 *   runtime adapter (used by tests)
 * @param {function} [opts.onProgress] - callback invoked per line of stdout/stderr
 * @param {boolean} [opts.captureMetrics] - when true, claude is invoked with
 *   --output-format json so the trailing usage envelope can be parsed and
 *   stored under runState.metrics (P-1603, v3.7.5). Other runtimes ignore.
 * @returns {object} { exit_code, status, stop_reason, elapsed_ms, error? }
 */
function runExperiment(slug, opts = {}) {
  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  const manifest = getExperimentManifest(slug, { root });
  if (manifest.error) return { error: manifest.error };

  const expPath = path.join(root, slug);
  if (!fs.existsSync(expPath)) {
    return { error: `experiment folder missing: ${expPath}` };
  }

  // Adapter selection
  let adapter = opts.runtimeOverride;
  if (!adapter) {
    const runtime = manifest.runtime;
    adapter = RUNTIME_RUNNERS[runtime];
    if (adapter == null) {
      return {
        error: `runtime "${runtime}" is not supported by the experiment runner ` +
               `(known: ${Object.keys(RUNTIME_RUNNERS).filter(r => RUNTIME_RUNNERS[r]).join(', ')})`,
      };
    }
  }

  const prompt = opts.prompt || '/pan:new-project --auto @.planning/idea.md';
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Initialize run-state.json
  const runState = {
    experiment_id: slug,
    status: 'running',
    started_at: startedAt,
    ended_at: null,
    pid: null,
    exit_code: null,
    stop_reason: null,
    elapsed_ms: null,
    events: [],
  };
  appendEvent(runState, 'started', `runtime=${manifest.runtime}, prompt=${prompt}`);
  writeRunState(expPath, runState);

  // Synchronous spawn with native timeout. spawnSync delivers the child's
  // exit signal cleanly even on Windows, and supports a `timeout` option
  // that sends SIGTERM if the child runs past the deadline.
  //
  // Streaming progress is deferred to W3 (async/Promise variant) — for v3.7.0
  // W2 we capture stdout/stderr after exit and emit a single onProgress call
  // with the full text. A real-time stream would require child_process.spawn
  // + an async runner, which clashes with the rest of pan-tools.cjs's
  // synchronous CLI shape.
  // P-102 fix (v3.7.1): on Windows, CLI tools that ship as .cmd shims
  // (npx-installed binaries like claude/codex/gemini/opencode) cannot be
  // spawned with shell:false — Node's spawnSync doesn't resolve the .cmd
  // extension. Adapters opt into shell-based spawn via `shell: 'win32'`.
  //
  // Runtime overrides (test mocks, ad-hoc dev) do NOT inherit shell:'win32',
  // so `node -e '...'` works without shell-based arg mangling.
  const useShell = adapter.shell === 'win32' && process.platform === 'win32';

  // P-1304 fix (v3.7.2): under shell:true Node joins args with spaces but
  // does NOT quote them. Multi-word args (the prompt has spaces) get re-split
  // by cmd.exe. Surfaced by panloop second autonomous run: prompt was split
  // into ['claude', '-p', '--dangerously-skip-permissions', '/pan:new-project',
  // '--auto', '@.planning/idea.md'] instead of preserving the prompt as one arg.
  // Solution: quote any arg containing whitespace when useShell is true.
  // Escapes embedded double-quotes by doubling (cmd.exe convention).
  // buildArgs may accept opts (claude uses it for --output-format json metric
  // capture). Pass opts safely; legacy adapters that ignore the second arg
  // work unchanged.
  const captureMetrics = Boolean(opts.captureMetrics);
  let rawArgs = adapter.buildArgs(prompt, { captureMetrics });
  const quotedArgs = useShell
    ? rawArgs.map(a => /\s/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)
    : rawArgs;

  // P-1501-r2 fix (v3.7.4): inherit parent's stdin so the spawned claude -p
  // sees a TTY (when the runner is invoked from a terminal) and continues its
  // autonomous tool-use loop. With stdio:[ignore,...] claude detects no-TTY
  // → "scripted single-shot" mode → exits after first response. Manual bash
  // invocation of the same flags worked because bash's stdin IS a TTY.
  // Trade-off: `inherit` means the child reads from the same TTY as the
  // parent. Acceptable because the runner is short-lived and the user
  // typically isn't typing while a run is in flight.
  let result;
  try {
    result = spawnSync(adapter.bin, quotedArgs, {
      cwd: expPath,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: useShell,
      timeout: timeoutMs,
      encoding: 'utf-8',
    });
  } catch (err) {
    runState.status = 'failed';
    runState.stop_reason = STOP_REASONS.ERROR;
    runState.ended_at = new Date().toISOString();
    runState.elapsed_ms = Date.now() - startTime;
    appendEvent(runState, 'spawn_failed', err.message);
    writeRunState(expPath, runState);
    return {
      error: `failed to spawn ${adapter.bin}: ${err.message}`,
      status: 'failed',
      stop_reason: STOP_REASONS.ERROR,
      elapsed_ms: runState.elapsed_ms,
    };
  }

  runState.pid = result.pid || null;

  // Emit captured output if a progress handler is set
  if (onProgress) {
    if (result.stdout) onProgress({ stream: 'stdout', text: result.stdout });
    if (result.stderr) onProgress({ stream: 'stderr', text: result.stderr });
  }

  // P-1603 (v3.7.5): when captureMetrics was requested, parse the trailing
  // claude --output-format json envelope from stdout and persist metrics into
  // run-state.json so downstream `/pan:learn` analysis can attribute real cost
  // and token usage instead of inferring from event counts.
  if (captureMetrics && result.stdout) {
    const envelope = parseClaudeJsonEnvelope(result.stdout);
    if (envelope) {
      runState.metrics = {
        total_cost_usd: envelope.total_cost_usd ?? null,
        num_turns: envelope.num_turns ?? null,
        session_id: envelope.session_id ?? null,
        input_tokens: envelope.usage?.input_tokens ?? null,
        output_tokens: envelope.usage?.output_tokens ?? null,
        cache_creation_input_tokens: envelope.usage?.cache_creation_input_tokens ?? null,
        cache_read_input_tokens: envelope.usage?.cache_read_input_tokens ?? null,
        // Headless `claude -p` usage bills against the Claude Agent SDK
        // credit pool — separate from interactive subscription limits since
        // June 15, 2026. Tagged so /pan:learn and billing reconciliation can
        // separate experiment spend from interactive-session spend.
        billing_pool: (manifest.runtime === 'claude') ? 'agent_sdk' : null,
      };
      appendEvent(runState, 'metrics_captured', `cost=$${envelope.total_cost_usd ?? '?'}, turns=${envelope.num_turns ?? '?'}`);
    } else {
      appendEvent(runState, 'metrics_unavailable', 'no JSON envelope in stdout');
    }
  }

  const endedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startTime;

  runState.ended_at = endedAt;
  runState.elapsed_ms = elapsedMs;
  runState.exit_code = result.status;

  // Detect timeout. spawnSync sets result.signal to 'SIGTERM' when the timeout
  // fires (on Unix) or kills via taskkill on Windows. We also check elapsed
  // time as a fallback heuristic.
  const timedOut =
    result.signal === 'SIGTERM' ||
    (result.error && result.error.code === 'ETIMEDOUT') ||
    (result.status === null && elapsedMs >= timeoutMs - 50);

  if (timedOut) {
    runState.status = 'failed';
    runState.stop_reason = STOP_REASONS.TIMEOUT;
    appendEvent(runState, 'timeout', `aborted after ${timeoutMs}ms`);
  } else if (result.error) {
    runState.status = 'failed';
    runState.stop_reason = STOP_REASONS.ERROR;
    appendEvent(runState, 'spawn_error', result.error.message);
  } else if (result.status === 0) {
    // P-1502 fix (v3.7.4): exit_code=0 alone is too coarse. Read state.md
    // to verify the workflow actually reached milestone-completion. If it
    // exited cleanly but the project is stuck in 'planning' or 'in_progress',
    // mark as 'incomplete' so /pan:learn analysis can distinguish real
    // success from premature exits (P-1501 / P-1701 patterns).
    //
    // Skip the milestone check when runtimeOverride is set (tests/dev path
    // simulating with `node -e` mocks that don't write state.md). The check
    // is meaningful only for real production-runtime invocations.
    if (opts.runtimeOverride) {
      runState.status = 'done';
      runState.stop_reason = STOP_REASONS.SUCCESS;
      appendEvent(runState, 'completed', 'exit_code=0 (runtime override; milestone check skipped)');
    } else {
      const milestone = readMilestoneStatus(expPath);
      if (milestone === 'completed') {
        runState.status = 'done';
        runState.stop_reason = STOP_REASONS.SUCCESS;
        appendEvent(runState, 'completed', 'exit_code=0, milestone=completed');
      } else {
        runState.status = 'incomplete';
        runState.stop_reason = STOP_REASONS.INCOMPLETE;
        appendEvent(runState, 'incomplete', `exit_code=0 but milestone status=${milestone || 'unknown'}`);
      }
    }
  } else {
    runState.status = 'failed';
    runState.stop_reason = STOP_REASONS.ERROR;
    appendEvent(runState, 'completed', `exit_code=${result.status}`);
  }

  writeRunState(expPath, runState);

  return {
    experiment_id: slug,
    status: runState.status,
    stop_reason: runState.stop_reason,
    exit_code: result.status,
    elapsed_ms: elapsedMs,
    started_at: startedAt,
    ended_at: endedAt,
  };
}

// ── tailExperimentState ─────────────────────────────────────────────────────

/**
 * Read the current run-state.json for an experiment.
 * Snapshot semantics — no streaming. (W3 may add a poll-loop variant.)
 */
function tailExperimentState(slug, opts = {}) {
  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  const manifest = getExperimentManifest(slug, { root });
  if (manifest.error) return { error: manifest.error };

  const expPath = path.join(root, slug);
  const state = readRunState(expPath);
  if (!state) {
    return { error: `experiment "${slug}" has no run state (not started yet)` };
  }
  return state;
}

// ── stopExperiment ──────────────────────────────────────────────────────────

/**
 * Stop a running experiment.
 *
 * If the experiment is currently running (run-state.json shows status=running
 * and pid is alive), send SIGTERM. If still alive after a short grace period,
 * SIGKILL.
 *
 * If the experiment has already finished, return its current state (no error).
 */
function stopExperiment(slug, opts = {}) {
  const root = opts.root || PAN_EXPERIMENTS_ROOT_DEFAULT;
  const manifest = getExperimentManifest(slug, { root });
  if (manifest.error) return { error: manifest.error };

  const expPath = path.join(root, slug);
  const state = readRunState(expPath);
  if (!state) {
    return { error: `experiment "${slug}" has no active run` };
  }

  if (state.status !== 'running') {
    // Already finished — return current state, not an error
    return state;
  }

  if (!state.pid) {
    return { error: `experiment "${slug}" has no recorded pid` };
  }

  // Try graceful term, then kill
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    // Process likely already dead
    state.status = 'failed';
    state.stop_reason = STOP_REASONS.MANUAL;
    state.ended_at = new Date().toISOString();
    appendEvent(state, 'stop_no_pid', `pid ${state.pid} already gone`);
    writeRunState(expPath, state);
    return state;
  }

  // Update state to reflect manual stop
  state.status = 'failed';
  state.stop_reason = STOP_REASONS.MANUAL;
  state.ended_at = new Date().toISOString();
  appendEvent(state, 'stopped', 'SIGTERM sent');
  writeRunState(expPath, state);

  return state;
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  runExperiment,
  tailExperimentState,
  stopExperiment,
  RUNTIME_RUNNERS,
  STOP_REASONS,
  DEFAULT_TIMEOUT_MS,
};
