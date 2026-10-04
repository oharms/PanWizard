#!/usr/bin/env node
// Context Monitor - PostToolUse hook
// Works out how full the agent's context is and injects a note when the host
// will compact it soon. This makes the AGENT aware of context limits (the
// statusline only shows the user).
//
// How it works:
// 1. The statusline hook writes metrics to <os tmpdir>/pan-hooks-<uid>/claude-ctx-{session_id}.json
// 2. This hook reads those metrics after each tool use
// 3. When the room left before the host compacts drops below thresholds, it
//    injects a note as additionalContext, which the agent sees in its conversation
//
// Without the status line. `claude -p` never runs the status line (checked
// 2026-10-04), and a user may run their own, so the bridge is often missing. Then
// the hook reads the session transcript the payload names: the newest assistant
// record carries the usage of the API call that issued this tool call, and its
// input + cache-read + cache-write tokens are what the status line reports as
// `total_input_tokens` (code.claude.com/docs/en/statusline). The model id on that
// record gives the window. A tool call inside a subagent is measured against the
// subagent's own transcript, never the main session's: the payload carries
// `agent_id` and still names the MAIN transcript (Claude Code 2.1.288, captured
// 2026-10-04). Only a bounded tail of the file is read.
//
// What it measures (O7). Claude Code's percentages are against the full model
// window, but the host compacts earlier: at the auto-compact window
// (CLAUDE_CODE_AUTO_COMPACT_WINDOW, then `autoCompactWindow` in settings, per model
// or for all), at about 967K on a 1M model by default, and at a percentage of that
// with CLAUDE_AUTOCOMPACT_PCT_OVERRIDE. With token counts on the bridge, the room
// left is measured against that point; without them, against the model window.
//
// What it says (O7). No countdown: vendor guidance is that a visible remaining-
// context figure makes a model wrap up early and cut corners, and a note after a
// tool result that orders it to STOP reads like an injection. The note asks for a
// checkpoint in state.md at the next natural stopping point, says compaction is
// safe because PAN restores the state, and asks for no shortcuts.
//
// Thresholds (of the room before compaction):
//   WARNING  (left <= 35%): checkpoint at the next natural stopping point
//   CRITICAL (left <= 25%): checkpoint before the next step
//
// Debounce: 5 tool uses between warnings to avoid spam
// Severity escalation bypasses debounce (WARNING -> CRITICAL fires immediately)
//
// The decision logic lives in the pure, exported buildContextWarning() so it is
// unit-tested (tests/context-monitor-hook.test.cjs) rather than only reachable
// via stdin (M59, ADR audit 2026-08).

const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── R39: one run per hook when Claude and Copilot share a project ───────────
// Copilot CLI also runs the hooks in a repository's .claude/settings.json and
// .claude/settings.local.json. Measured 2026-09-26 (Copilot CLI 1.0.88, repository
// hooks loaded): in a project with both the Claude and the Copilot install, every
// PAN hook ran twice under Copilot — once from .github/hooks/pan.json, once from the
// Claude settings. The Copilot project copy (this file under .github/hooks) steps
// aside whenever the project's Claude settings register the same script, so the hook
// runs once, and runs again from here the moment the Claude registration is gone.
// Both files are repository hooks to Copilot and load under the same trust rule, so
// deferring never leaves zero. Only this copy defers: Claude Code never reads
// .github/hooks, Gemini and Codex never read .claude/settings.json, and a global
// Copilot copy loads where repository hooks may not. Identical in every hook
// Copilot registers — tests/copilot-hook-dedupe.test.cjs pins the copies.
function deferToClaudeRegistration(projectDir, hookFile = __filename) {
  // Assembled, not written as a literal: the installer rewrites every quoted .claude
  // literal in a hook copy to that runtime's own directory, and this one must stay Claude's.
  const claudeDir = ['.', 'claude'].join('');
  try {
    const hooksDir = path.dirname(hookFile);
    if (path.basename(hooksDir) !== 'hooks' || path.basename(path.dirname(hooksDir)) !== '.github') return false;
    if (typeof projectDir !== 'string' || !projectDir) return false;
    const script = path.basename(hookFile);
    for (const name of ['settings.json', 'settings.local.json']) {
      let settings;
      try { settings = JSON.parse(fs.readFileSync(path.join(projectDir, claudeDir, name), 'utf8')); } catch { continue; }
      const events = settings && typeof settings.hooks === 'object' ? settings.hooks : null;
      if (!events) continue;
      for (const groups of Object.values(events)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const handlers = group && Array.isArray(group.hooks) ? group.hooks : [];
          if (handlers.some((h) => h && typeof h.command === 'string' && h.command.includes(script))) return true;
        }
      }
    }
  } catch { /* fail open: run this copy */ }
  return false;
}

// Per-user bridge directory inside tmpdir, created 0700 so another user on a
// shared host can't pre-plant a symlink at a predictable session path or read
// the bridge files. Both hooks derive the same dir from the same uid, so the
// statusline→context-monitor IPC channel is preserved.
function bridgeDir() {
  const uid = (typeof process.getuid === 'function' ? process.getuid() : process.env.USERNAME || 'win');
  const dir = path.join(os.tmpdir(), `pan-hooks-${uid}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdirSync{recursive} is a silent no-op on an EXISTING dir, so on a shared
    // host an attacker can pre-plant pan-hooks-<uid> and read the session id /
    // swap in a symlink. Verify WE own it, it isn't a symlink, and it isn't
    // group/other-accessible; fail CLOSED (null) otherwise — the bridge is
    // best-effort observability, so skipping beats a leak (M60, ADR audit 2026-08).
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) return null; // cross-platform
    // POSIX ownership/mode checks ONLY where they're meaningful. Windows fakes
    // mode bits — a dir just created with mode 0o700 lstats as 0o666 — so
    // applying the mode/uid gate there returned null on every call and disabled
    // the bridge entirely (N15). The finding's threat model is shared Unix hosts.
    if (typeof process.getuid === 'function') {
      if (st.uid !== process.getuid()) return null;
      if ((st.mode & 0o077) !== 0) return null;
    }
    return dir;
  } catch { return null; }
}

const WARNING_THRESHOLD = 35;  // room left before compaction <= 35%
const CRITICAL_THRESHOLD = 25; // room left before compaction <= 25%
const STALE_SECONDS = 60;      // ignore metrics older than 60s
const DEBOUNCE_CALLS = 5;      // min tool uses between warnings
const MIN_COMPACT_WINDOW = 100000;
const MAX_COMPACT_WINDOW = 1000000;
const ONE_M_DEFAULT_TRIGGER = 967000; // a native 1M window compacts at about 967K by default
const STANDARD_WINDOW = 200000;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;      // the first read from the end of the transcript
const TRANSCRIPT_MAX_BYTES = 4 * 1024 * 1024;  // never read more than this of it
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/; // session and agent ids name files

/**
 * The token count at which the host compacts this session, or null when it does
 * not compact. Pure over its inputs.
 *   modelWindow — context_window_size from the statusline
 *   modelId     — the model id, for `modelSettings.<id>.autoCompactWindow`
 *   env         — the environment (CLAUDE_CODE_AUTO_COMPACT_WINDOW,
 *                 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, DISABLE_AUTO_COMPACT)
 *   settings    — settings objects, highest precedence first (local, project, user)
 */
function compactTrigger({ modelWindow, modelId, env = {}, settings = [] }) {
  if (!Number.isFinite(modelWindow) || modelWindow <= 0) return null;
  if (env.DISABLE_AUTO_COMPACT === '1') return null;
  for (const s of settings) if (s && s.autoCompactEnabled === false) return null;
  const clamp = (n) => Math.min(modelWindow, Math.max(MIN_COMPACT_WINDOW, Math.min(MAX_COMPACT_WINDOW, n)));
  let window = null;
  if (/^\d+$/.test(String(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || ''))) {
    window = clamp(Number(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW));
  } else {
    for (const s of settings) {
      if (!s || typeof s !== 'object') continue;
      const perModel = modelId && s.modelSettings && s.modelSettings[modelId] ? s.modelSettings[modelId].autoCompactWindow : undefined;
      const v = perModel !== undefined ? perModel : s.autoCompactWindow;
      if (v === 'auto') break; // the tuned default, below
      if (Number.isFinite(v)) { window = clamp(v); break; }
    }
  }
  if (window == null) window = modelWindow >= MAX_COMPACT_WINDOW ? Math.min(modelWindow, ONE_M_DEFAULT_TRIGGER) : modelWindow;
  const pct = Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  if (Number.isInteger(pct) && pct >= 1 && pct < 100) window = Math.floor(window * pct / 100);
  return window;
}

/**
 * The room left before compaction, as a percentage, and what it was measured
 * against. Falls back to the model window's remaining_percentage when the bridge
 * carries no token counts or the host does not compact.
 */
function roomLeft(metrics, opts = {}) {
  const used = Number(metrics.total_input_tokens);
  const trigger = Number.isFinite(used)
    ? compactTrigger({ modelWindow: Number(metrics.context_window_size), modelId: metrics.model_id, env: opts.env || {}, settings: opts.settings || [] })
    : null;
  if (trigger) return { remaining: Math.max(0, Math.min(100, ((trigger - used) / trigger) * 100)), basis: 'compact-window' };
  const r = Number(metrics.remaining_percentage);
  return { remaining: r, basis: 'model-window' };
}

// ─── Without the status line: the transcript ─────────────────────────────────

/**
 * Pure: the context of the newest API call in a transcript's lines, scanning back
 * from the end. Returns `{ found: true, used, model }`, `{ found: false, compacted:
 * true }` when a compaction boundary comes first (the context was just rebuilt and
 * no call has measured it yet), or `{ found: false }` when these lines hold no
 * assistant record, so the caller can read further back.
 *
 * `used` is input + cache-read + cache-write tokens, the status line's
 * `total_input_tokens`. Output tokens are left out, as its `used_percentage` leaves
 * them out. A record with no usage (a synthetic or error record) is skipped. In the
 * main transcript a sidechain record (an older host's subagent turn) is skipped; in
 * a subagent's own transcript every record is a sidechain one.
 */
function lastContextFromLines(lines, { skipSidechain = true } = {}) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || (!line.includes('"assistant"') && !line.includes('"compact_boundary"'))) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'system' && e.subtype === 'compact_boundary') return { found: false, compacted: true };
    if (e.type !== 'assistant' || (skipSidechain && e.isSidechain === true)) continue;
    const u = e.message && e.message.usage;
    if (!u || typeof u !== 'object') continue;
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    const used = n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
    if (used <= 0) continue;
    return { found: true, used, model: typeof e.message.model === 'string' ? e.message.model : null };
  }
  return { found: false };
}

/**
 * The last `bytes` of a file as text, without the partial line the cut starts in.
 * Defensive only: in well-formed JSONL a line's tail never parses as an object (a
 * nested object is always followed by its parent's closing brace), so keeping the
 * fragment would change nothing; dropping it keeps a fragment from ever being read.
 */
function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return { text, whole: start === 0 };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The context of the newest API call in a transcript file, or null. Reads the
 * tail, and further back (up to TRANSCRIPT_MAX_BYTES) only while a large tool
 * result hides the last assistant record. Fails open: any error is null.
 */
function contextFromTranscript(file, { skipSidechain = true, tailBytes = TRANSCRIPT_TAIL_BYTES, maxBytes = TRANSCRIPT_MAX_BYTES } = {}) {
  if (typeof file !== 'string' || !file) return null;
  let bytes = tailBytes;
  for (;;) {
    let tail;
    try { tail = readTail(file, bytes); } catch { return null; }
    const r = lastContextFromLines(tail.text.split('\n'), { skipSidechain });
    if (r.found) return { used: r.used, model: r.model };
    if (r.compacted || tail.whole || bytes >= maxBytes) return null;
    bytes = Math.min(bytes * 4, maxBytes);
  }
}

/**
 * Pure: a Claude model id's family and version, or null. Accepts the API ids
 * (`claude-opus-5-5`, `claude-haiku-4-5-20251001`, `claude-3-5-sonnet-20241022`)
 * and marks the forms a third-party provider gives them (`us.anthropic.claude-…-v1:0`
 * on Bedrock, `claude-…@date` on Google Cloud).
 */
function parseModelId(id) {
  if (typeof id !== 'string' || !id) return null;
  const s = id.toLowerCase().trim().replace(/\[1m\]$/, '');
  const thirdParty = /(^|\.)anthropic\.|@|-v\d+(:\d+)?$|^arn:/.test(s);
  let m = s.match(/claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/);
  if (m) return { family: m[1], major: Number(m[2]), minor: m[3] === undefined ? 0 : Number(m[3]), thirdParty };
  m = s.match(/claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)/);
  if (m) return { family: m[3], major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]), thirdParty };
  return null;
}

/**
 * Pure: the context window of the model that wrote a transcript record, or null
 * when it cannot be known — then the hook says nothing rather than guess. From
 * code.claude.com/docs/en/model-config (read 2026-10-04):
 *   - On the Anthropic API, Fable 5.x, Sonnet 5 and later and Opus 4.7 and later
 *     run a native 1M window. On Bedrock, Google Cloud and Foundry some of them run
 *     200K, so there the window is unknown.
 *   - Opus 4.6 and Sonnet 4.6 (and older) run 200K unless their `[1m]` variant is
 *     configured; Haiku runs 200K.
 *   - CLAUDE_CODE_DISABLE_1M_CONTEXT=1 holds every model to 200K.
 *   - A context already past 200K can only be in a 1M window.
 */
function modelWindowFor(modelId, { env = {}, settings = [], used = 0 } = {}) {
  if (used > STANDARD_WINDOW) return MAX_COMPACT_WINDOW;
  if (env.CLAUDE_CODE_DISABLE_1M_CONTEXT === '1') return STANDARD_WINDOW;
  const m = parseModelId(modelId);
  if (!m) return null;
  const native1m = m.family === 'fable'
    || (m.family === 'sonnet' && m.major >= 5)
    || (m.family === 'opus' && (m.major > 4 || (m.major === 4 && m.minor >= 7)));
  if (native1m) {
    const thirdParty = m.thirdParty || ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']
      .some((k) => env[k] === '1' || env[k] === 'true');
    return thirdParty ? null : MAX_COMPACT_WINDOW;
  }
  if (m.family === 'haiku') return STANDARD_WINDOW;
  const extended = [env.ANTHROPIC_MODEL, ...settings.map((s) => (s && typeof s === 'object' ? s.model : undefined))]
    .some((v) => typeof v === 'string' && /\[1m\]\s*$/i.test(v));
  return extended ? MAX_COMPACT_WINDOW : STANDARD_WINDOW;
}

/**
 * Metrics shaped like the bridge's, from a transcript: the tokens in context, the
 * model window and the model id. Null when the transcript, its usage or the window
 * cannot be known.
 */
function metricsFromTranscript(file, { env = {}, settings = [], skipSidechain = true, tailBytes, maxBytes } = {}) {
  const ctx = contextFromTranscript(file, { skipSidechain, tailBytes, maxBytes });
  if (!ctx) return null;
  const window = modelWindowFor(ctx.model, { env, settings, used: ctx.used });
  if (!window) return null;
  return {
    total_input_tokens: ctx.used,
    context_window_size: window,
    ...(ctx.model ? { model_id: ctx.model } : {}),
    remaining_percentage: Math.max(0, 100 - (ctx.used / window) * 100),
    source: 'transcript',
  };
}

/**
 * Pure over the payload: which transcript measures this tool call. A call inside
 * a subagent carries `agent_id`; the payload's `transcript_path` is still the main
 * session's, and the subagent's own file is `<dir>/<session>/subagents/agent-<id>.jsonl`
 * (an `agent_transcript_path`, where a host sends one, wins). Null when the ids are
 * not safe to put in a path.
 */
function transcriptForPayload(data) {
  if (!data || typeof data !== 'object') return null;
  const agentId = data.agent_id;
  if (agentId === undefined || agentId === null || agentId === '') {
    return typeof data.transcript_path === 'string' && data.transcript_path ? { file: data.transcript_path, subagent: false } : null;
  }
  if (typeof agentId !== 'string' || !SAFE_ID.test(agentId)) return null;
  if (typeof data.agent_transcript_path === 'string' && data.agent_transcript_path) return { file: data.agent_transcript_path, subagent: true };
  if (typeof data.transcript_path !== 'string' || !data.transcript_path) return null;
  if (typeof data.session_id !== 'string' || !SAFE_ID.test(data.session_id)) return null;
  return { file: path.join(path.dirname(data.transcript_path), data.session_id, 'subagents', `agent-${agentId}.jsonl`), subagent: true };
}

// Pure decision function (exported for tests).
//
//   metrics    — { remaining_percentage, total_input_tokens?, context_window_size?,
//                  model_id?, timestamp? } from the bridge, or the same shape from
//                  metricsFromTranscript (no timestamp: measured now)
//   warnState  — { callsSinceWarn, lastLevel } from the prior warn file, or null
//                on the first warning (no file yet / corrupt file)
//   nowSeconds — current unix time in seconds
//   opts       — { env, settings } for the compaction point (see compactTrigger)
//
// Returns one of:
//   { action: 'exit' }                                   — nothing to do
//   { action: 'debounce', warnState }                    — persist counter, no warn
//   { action: 'emit', level, warnState, message, basis } — persist + emit the note
function buildContextWarning(metrics, warnState, nowSeconds, opts = {}) {
  if (!metrics || typeof metrics !== 'object') return { action: 'exit' };

  // Ignore stale metrics (statusline stopped updating — e.g. session ended).
  if (metrics.timestamp != null && (nowSeconds - metrics.timestamp) > STALE_SECONDS) {
    return { action: 'exit' };
  }

  const { remaining, basis } = roomLeft(metrics, opts);
  if (!Number.isFinite(remaining)) return { action: 'exit' };

  // No warning needed
  if (remaining > WARNING_THRESHOLD) return { action: 'exit' };

  const firstWarn = warnState == null || typeof warnState !== 'object';
  const prev = firstWarn ? { callsSinceWarn: 0, lastLevel: null } : warnState;
  const callsSinceWarn = (prev.callsSinceWarn || 0) + 1;

  const isCritical = remaining <= CRITICAL_THRESHOLD;
  const currentLevel = isCritical ? 'critical' : 'warning';

  // Emit immediately on first warning, then debounce subsequent ones.
  // Severity escalation (WARNING -> CRITICAL) bypasses debounce.
  const severityEscalated = currentLevel === 'critical' && prev.lastLevel === 'warning';
  if (!firstWarn && callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
    // Bump the counter but leave lastLevel untouched, then exit without warning.
    return {
      action: 'debounce',
      warnState: { callsSinceWarn, lastLevel: prev.lastLevel || null },
    };
  }

  // No figures (O7): a countdown makes a model wrap up early, and a percentage is
  // the thing it would count down. The note names the checkpoint, says compaction
  // is safe, and asks for no shortcuts.
  const message = isCritical
    ? 'PAN context note (from the context-monitor hook, not the user): the host will compact this session soon. ' +
      'Before your next step, make sure .planning/state.md records where you are — the phase, the plan and task, and what comes next; /pan:pause writes it. ' +
      'Then carry on with the current task as normal. After compaction PAN restores the planning state, so finish the task properly rather than quickly.'
    : 'PAN context note (from the context-monitor hook, not the user): this session\'s context is filling up. ' +
      'At your next natural stopping point, such as a finished task or a commit, make sure .planning/state.md records where you are; /pan:pause writes it. ' +
      'Nothing needs to stop: the host compacts on its own and PAN restores the planning state afterwards, so keep working at full quality, with no shortcuts and no skipped verification.';

  return {
    action: 'emit',
    level: currentLevel,
    warnState: { callsSinceWarn: 0, lastLevel: currentLevel },
    message,
    basis,
  };
}

/** Claude Code's settings for a project, highest precedence first: local, project, user. */
function readClaudeSettings(projectDir, homeDir = os.homedir()) {
  // Assembled, not a literal: the installer rewrites quoted .claude literals in hook
  // copies, and these are Claude Code's own settings (only it writes the bridge).
  const dir = ['.', 'claude'].join('');
  const files = [];
  if (typeof projectDir === 'string' && projectDir) files.push(path.join(projectDir, dir, 'settings.local.json'), path.join(projectDir, dir, 'settings.json'));
  if (homeDir) files.push(path.join(homeDir, dir, 'settings.json'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* absent or unreadable */ }
  }
  return out;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      if (deferToClaudeRegistration(data.cwd || process.cwd())) process.exit(0);
      const sessionId = data.session_id;

      if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) {
        process.exit(0);
      }

      const tmpDir = bridgeDir();
      if (!tmpDir) process.exit(0); // insecure/unavailable bridge dir — fail closed (M60)
      const now = Math.floor(Date.now() / 1000);
      const settings = readClaudeSettings(data.cwd || process.cwd());
      const source = transcriptForPayload(data);
      const subagent = !!(source && source.subagent) || (data.agent_id !== undefined && data.agent_id !== null && data.agent_id !== '');

      // The bridge is the main session's context (the status line renders the main
      // thread), so only a main-thread call reads it, and only while it is fresh.
      // Absence or a corrupt file falls through to the transcript. No
      // existsSync-then-read gap.
      let metrics = null;
      if (!subagent) {
        try {
          const bridge = JSON.parse(fs.readFileSync(path.join(tmpDir, `claude-ctx-${sessionId}.json`), 'utf8'));
          if (bridge && typeof bridge === 'object' && !(bridge.timestamp != null && (now - bridge.timestamp) > STALE_SECONDS)) metrics = bridge;
        } catch { /* no bridge: no status line, or not PAN's */ }
      }
      if (!metrics && source) {
        metrics = metricsFromTranscript(source.file, { env: process.env, settings, skipSidechain: !source.subagent });
      }
      if (!metrics) process.exit(0);

      // Load prior warn state (null when no file / corrupt → treated as first warn).
      // A subagent debounces on its own: its context is not the main session's.
      const warnKey = source && source.subagent ? `${sessionId}-${data.agent_id}` : sessionId;
      const warnPath = path.join(tmpDir, `claude-ctx-${warnKey}-warned.json`);
      let warnData = null;
      try {
        warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
      } catch {
        warnData = null;
      }

      const decision = buildContextWarning(metrics, warnData, now, {
        env: process.env,
        settings: Number.isFinite(Number(metrics.total_input_tokens)) ? settings : [],
      });

      if (decision.action === 'exit') {
        process.exit(0);
      }

      if (decision.action === 'debounce') {
        fs.writeFileSync(warnPath, JSON.stringify(decision.warnState));
        process.exit(0);
      }

      // action === 'emit'
      fs.writeFileSync(warnPath, JSON.stringify(decision.warnState));

      const output = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: decision.message
        }
      };

      process.stdout.write(JSON.stringify(output));
    } catch (e) {
      // Silent fail -- never block tool execution
      process.exit(0);
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  deferToClaudeRegistration,
  buildContextWarning,
  compactTrigger,
  roomLeft,
  readClaudeSettings,
  bridgeDir,
  lastContextFromLines,
  contextFromTranscript,
  parseModelId,
  modelWindowFor,
  metricsFromTranscript,
  transcriptForPayload,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  STALE_SECONDS,
  DEBOUNCE_CALLS,
};
