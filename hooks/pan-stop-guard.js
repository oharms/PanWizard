#!/usr/bin/env node
// Auto-Advance Stop Guard - Stop hook (P-1809)
//
// Catches the P-1801/P-1807 boundary drop mechanically. Field data (PanLoop,
// 2026-08): with the gate-parity fix and prose hardening in place, autonomous
// builds still stopped at a phase boundary at a low, nondeterministic rate —
// the orchestrator finishes transition.md's state bookkeeping and ends its turn
// without issuing the Route A Task spawn. Prose cannot bind that tail reliably;
// a Stop hook can, because it runs as code when the session tries to end.
//
// When the session stops, this hook blocks ONCE — with a reason telling the
// agent to spawn the next phase — if and only if the disk shows the exact
// boundary-drop fingerprint:
//   1. .planning/config.json shows an autonomy signal: workflow.auto_advance
//      === true OR mode === 'yolo'. P-1810 (PanLoop finding 7): the guard
//      originally armed on auto_advance alone — narrower than the composite
//      trigger it guards (flag OR config OR yolo) — and stayed dark on the
//      exact base64url drop it was built for (mode yolo, auto_advance false).
//      A Stop hook cannot see the --auto flag, so the chain's entry hops
//      (discuss/plan/exec-phase) persist the flag into config, and yolo is
//      accepted directly. transition.md Route B clears auto_advance at the
//      milestone boundary, which disarms the config half at the true end.
//   2. .planning/state.md does NOT show a legitimate-stop marker (gaps found,
//      verification failed, blocked). P-1812 (PanLoop finding 9): this
//      condition was originally "status begins 'Ready to plan'" — one batch
//      produced four different status phrasings for the same situation, and a
//      run with BOTH arming conditions satisfied was disarmed by wording
//      alone. The condition is now inverted: an unrecognised phrasing ARMS
//      the guard (fail-safe — at worst one extra continuation, bounded by the
//      one-shot design) instead of disarming it (fail-open — the build
//      silently stops). Never re-introduce a required phrasing here; the
//      model does not reliably write canonical wording and nothing forces it.
//   3. .planning/roadmap.md still has unticked `- [ ] **Phase N:` lines
//      (the shipped template/roadmapper checklist shape — same detector the
//      PanLoop harness uses to call a build incomplete)
//
// Loop safety: the host sets stop_hook_active on stop attempts that follow a
// stop-hook block, and this guard always allows those — it fires at most once
// per stop chain, so a user who genuinely wants to stop is delayed by exactly
// one continuation, never trapped.
//
// Gemini CLI (R29, 2026-09-23): the guard is registered there on AfterAgent,
// Gemini's end-of-turn event — until this date PAN registered it under Claude's
// `Stop` key, which Gemini skips with an "Invalid hook event name" warning, so it
// had never run. AfterAgent honours the same {decision: 'block', reason} output
// (a block re-prompts the agent with the reason), but its stop_hook_active is only
// true for the AfterAgent that evaluates a continuation the block started
// directly: a continuation that used tools reports false again (gemini-cli
// client.ts / useGeminiStream.ts, read 2026-09-23). The flag alone would let the
// guard block every such turn. So on AfterAgent the one-shot promise is kept with
// a marker per session, project and target phase in the per-user 0700 hook
// directory: a second stop aimed at the same phase is allowed. No safe marker
// directory, or no session id, means no block (fail open, as everywhere else).
//
// Codex and Copilot CLI (M14, 2026-09-26): registered on Codex's `Stop` and
// Copilot's `agentStop`. Both payloads carry `cwd` and `stop_hook_active` (Copilot
// keeps that one field snake_case inside its camelCase payload) and both honour the
// same {decision: 'block', reason} output, so the logic above applies unchanged.
// Copilot also ends the turn itself after eight consecutive blocks.
//
// Escape hatch: set workflow.stop_guard to false in .planning/config.json to
// disable the guard entirely without turning off auto_advance.
//
// Fail-open everywhere: no .planning, unparseable config/state/roadmap, bad
// stdin — exit 0 silently. This guard must never block a stop on uncertainty;
// a missed catch is a re-run, a wrong block is a trapped session.
//
// The decision logic lives in the pure, exported buildStopDecision() so the
// full condition matrix is unit-tested (tests/stop-guard-hook.test.cjs)
// rather than only reachable via stdin (same pattern as the other PAN hooks).

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
const crypto = require('crypto');
/**
 * Which planning tree this hook acts on.
 *
 * Mirrors pan-wizard-core/bin/lib/planning-root.cjs, which hooks cannot require
 * (they are standalone and run inside the host runtime). All PAN hooks carry an
 * identical copy — if the CLI is pointed at a track while a hook still writes to
 * `.planning/`, that tree's telemetry lands in the wrong place.
 *
 * Env only — a hook gets no argv. A value that escapes the project root is
 * ignored rather than honoured: a bad value degrades to the default, never
 * writes outside the project.
 */
function planningDirName() {
  const raw = process.env.PAN_PLANNING_DIR || '';
  if (raw.trim()) {
    const rel = raw.trim().replace(/\\/g, '/');
    const bad = rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)
      || rel.split('/').includes('..');
    if (!bad) return rel;
  }
  const track = (process.env.PAN_TRACK || '').trim();
  if (track && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(track)) {
    return `.planning/tracks/${track}`;
  }
  return '.planning';
}

/** Absolute path inside the active planning tree. */
function planningPath(cwd, ...segments) {
  return path.join(cwd, ...planningDirName().split('/'), ...segments);
}

// Unticked phase line, exactly as templates/roadmap.md and pan-roadmapper.md
// emit it. Fixture doctrine: this shape is pinned against the shipped template
// by the tests — never widen it from imagination, re-derive it from the files.
const UNTICKED_PHASE_RE = /^- \[ \] \*\*Phase (\d+(?:\.\d+)?):/m;

// Legitimate-stop markers in state.md (P-1812). Condition 2 exists only to
// let a REAL stop through — a verification failure, gaps, or a recorded
// blocker. Matching those (a short, high-precision list) is robust; matching
// the "chain should continue" wording was not: PAN wrote "Ready to plan",
// "Ready to execute", "Phase 2 planning pending" and two milestone phrasings
// for the same boundary within one field batch. Anything NOT matching this
// list arms the guard.
const LEGIT_STOP_RE = /gaps?\s+found|verification\s+(?:failed|found\s+gaps)|failed\s+verification|\bblocked\b|\bblocker\b/i;

// The stopped_at "ready to plan Phase N" phrasing, when present, names the
// next phase more precisely than the first-unticked roadmap line (a
// completed-but-unticked earlier phase would misdirect it — finding 8).
const READY_STOPPED_AT_RE = /ready to plan phase\s*(\d+(?:\.\d+)?)/i;

/**
 * Pure decision: should this stop be blocked?
 * @param {object} args
 * @param {boolean} args.stopHookActive  stop_hook_active from the payload
 * @param {object|null} args.config      parsed .planning/config.json, or null
 * @param {string|null} args.stateContent    .planning/state.md, or null
 * @param {string|null} args.roadmapContent  .planning/roadmap.md, or null
 * @returns {{decision: 'block', reason: string}|null} null = allow the stop
 */
function buildStopDecision({ stopHookActive, config, stateContent, roadmapContent }) {
  if (stopHookActive) return null; // one-shot: never block a post-block stop
  if (!config || typeof config !== 'object') return null;
  const wf = (config.workflow && typeof config.workflow === 'object') ? config.workflow : {};
  if (wf.stop_guard === false) return null; // explicit escape hatch beats every arming signal
  // P-1810: arm on EITHER disk-visible autonomy signal — auto_advance alone
  // was narrower than the trigger it guards and missed a real drop (finding 7).
  const armed = wf.auto_advance === true || config.mode === 'yolo';
  if (!armed) return null;
  if (typeof stateContent !== 'string' || typeof roadmapContent !== 'string') return null;

  // P-1812: inverted condition — allow the stop only when state records a
  // legitimate reason to stop. Unrecognised status phrasings arm the guard.
  if (LEGIT_STOP_RE.test(stateContent)) return null;

  const unticked = roadmapContent.match(UNTICKED_PHASE_RE);
  if (!unticked) return null; // every phase built — nothing to continue

  // Prefer the phase state.md says is next: a COMPLETED phase left unticked
  // (finding 8) would otherwise make the first-unticked line name a phase that
  // is already built. The roadmap match still gates arming; state names the
  // target when it can.
  const stateNext = stateContent.match(READY_STOPPED_AT_RE);
  const nextPhase = (stateNext && stateNext[1]) || unticked[1];
  return {
    decision: 'block',
    reason:
      `PAN auto-advance chain incomplete: autonomy is armed in .planning/config.json, ` +
      `state.md records no failure/gaps/blocker, and roadmap.md still has unbuilt phases ` +
      `(next: Phase ${nextPhase}). Ending the turn here is the P-1801/P-1807 boundary drop. ` +
      `Continue the chain now: if the current phase is finished, follow transition.md's ` +
      `offer_next_phase Route A and spawn Phase ${nextPhase} as a Task subagent ` +
      `(plan-phase orchestrator, ARGUMENTS='${nextPhase} --auto'); if the current phase is ` +
      `mid-flight, resume it instead. If the user explicitly asked to stop, first run: ` +
      `pan-tools config-set workflow.auto_advance false — then stop. ` +
      `(Disable this guard permanently with workflow.stop_guard: false.)`
  };
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// Per-user hook state directory inside tmpdir, created 0700 — the same directory
// and the same checks as bridgeDir() in pan-context-monitor.js (hooks are
// standalone files and cannot require one another). Fail CLOSED (null) when the
// directory is not provably ours: a shared host must not be able to pre-plant a
// marker that silences the guard, or a symlink it writes through (M60).
function hookStateDir() {
  const uid = (typeof process.getuid === 'function' ? process.getuid() : process.env.USERNAME || 'win');
  const dir = path.join(os.tmpdir(), `pan-hooks-${uid}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) return null;
    // POSIX-only ownership and mode checks: Windows fakes mode bits (N15).
    if (typeof process.getuid === 'function') {
      if (st.uid !== process.getuid()) return null;
      if ((st.mode & 0o077) !== 0) return null;
    }
    return dir;
  } catch { return null; }
}

/**
 * The file name of the one-shot marker for an AfterAgent block (Gemini CLI).
 * Keyed by session, project and the block's reason — the reason names the target
 * phase, so a later drop at a DIFFERENT phase in the same session is still caught.
 * Pure; null when there is no session id to key on.
 */
function onceMarkerName(sessionId, projectDir, reason) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const key = crypto.createHash('sha256').update(`${sessionId}\0${projectDir}\0${reason}`).digest('hex').slice(0, 32);
  return `stop-guard-${key}.json`;
}

const MARKER_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/**
 * Apply the AfterAgent one-shot rule: returns true when this block may be issued
 * (and records it), false when the same session already got it or no safe place
 * to remember it exists. Best-effort pruning keeps the directory from growing.
 */
function claimOnceMarker(dir, name, now = Date.now()) {
  if (!dir || !name) return false;
  const marker = path.join(dir, name);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^stop-guard-[0-9a-f]{32}\.json$/.test(f)) continue;
      try { if (now - fs.statSync(path.join(dir, f)).mtimeMs > MARKER_MAX_AGE_MS) fs.unlinkSync(path.join(dir, f)); } catch { /* keep */ }
    }
  } catch { /* unreadable dir — the exclusive create below still decides */ }
  try {
    // 'wx' fails when the marker exists: the create IS the check, so two hook
    // processes racing on the same stop cannot both block.
    fs.writeFileSync(marker, JSON.stringify({ at: new Date(now).toISOString() }), { flag: 'wx', mode: 0o600 });
    return true;
  } catch { return false; }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      let payload = {};
      try { payload = JSON.parse(input); } catch { /* fail open on bad stdin */ }
      if (!payload || typeof payload !== 'object') payload = {};

      const projectDir = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
      if (deferToClaudeRegistration(projectDir)) process.exit(0);
      const planningDir = planningPath(projectDir);

      let config = null;
      try { config = JSON.parse(fs.readFileSync(path.join(planningDir, 'config.json'), 'utf8')); } catch { /* no project / bad config -> allow */ }

      let decision = buildStopDecision({
        stopHookActive: payload.stop_hook_active === true,
        config,
        stateContent: readIfExists(path.join(planningDir, 'state.md')),
        roadmapContent: readIfExists(path.join(planningDir, 'roadmap.md')),
      });

      // Gemini CLI's end-of-turn event: its stop_hook_active cannot carry the
      // one-shot promise on its own (see the header), so a marker does.
      if (decision && payload.hook_event_name === 'AfterAgent') {
        const name = onceMarkerName(payload.session_id || payload.sessionId, projectDir, decision.reason);
        if (!claimOnceMarker(hookStateDir(), name)) decision = null;
      }

      if (decision) process.stdout.write(JSON.stringify(decision));
    } catch { /* fail open — never break a stop */ }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { deferToClaudeRegistration, buildStopDecision, UNTICKED_PHASE_RE, onceMarkerName, claimOnceMarker };
