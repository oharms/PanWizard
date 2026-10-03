#!/usr/bin/env node
// State Re-injection - SessionStart hook, `compact` matcher (market-ideas queue M10)
//
// Compaction replaces the conversation with a summary, and a summary can drop the
// one line that mattered: which phase is in flight, which plan, where it stopped.
// The PanLoop boundary-drop class (finding 0) is that failure — an agent that no
// longer knows it is mid-chain ends the turn or re-plans finished work. This hook
// runs when the session restarts after a compaction and hands the model PAN's
// current position, read from the planning tree on disk, as `additionalContext`.
//
// Why SessionStart and not PostCompact: Claude Code's PostCompact has no decision
// control and discards its output ("Used for side effects like logging"), while
// SessionStart fires again after a compaction with `source: "compact"` and honours
// `hookSpecificOutput.additionalContext` (code.claude.com/docs/en/hooks, read
// 2026-09-26). Codex is the same: its PostCompact output schema has no
// additionalContext, and SessionStart hooks matching `source: "compact"` deliver it
// to the continuation (codex hooks docs, read 2026-09-26). Registered with the
// `compact` matcher on both; the source is re-checked here so a registration
// without the matcher stays inert on every other start.
//
// Gemini CLI and Copilot CLI (market-ideas M33) restart no session after a
// compaction (Gemini's SessionStart sources: startup | resume | clear; Copilot's:
// startup | resume | new), and their pre-compaction events cannot add context
// (Gemini PreCompress and Copilot preCompact are advisory). So there the block
// arrives in two steps:
//   --mark            on PreCompress / preCompact: when a PAN phase is in flight,
//                     leave a per-session marker in the per-user hook directory
//                     under the OS temp directory (0700, written 0600);
//   --inject <host>   on the next tool result (Gemini AfterTool, Copilot
//                     postToolUse): consume the marker and return the block once,
//                     in that host's output shape. With no marker it prints nothing.
// A tool result is the first point after a compaction where both hosts take added
// context, including an autonomous `-p` run that never sees another prompt (read
// 2026-10-03: gemini-cli v0.61.0 docs/hooks/reference.md; the Copilot hooks
// reference on docs.github.com). The marker modes need no R39 deferral: in a
// project with both installs, Copilot also runs Claude's registration of this
// script, but that one is the SessionStart mode, which a Copilot start never matches.
//
// Inert unless the project is a PAN project with work in flight: `.planning/`
// holds a state.md that names a current phase AND a roadmap.md with an unticked
// phase. Everywhere else — no planning tree, a focus-only project, a finished
// milestone — it prints nothing. It never writes into the project (field finding:
// hooks that scaffolded `.planning/` in projects that never ran PAN); the only
// file it writes is the marker, outside the project.
//
// Fail-open everywhere: bad stdin, unreadable files — exit 0 silently. A missing
// reminder costs a re-read; a crashed hook is a failing hook at every start.
//
// The block is capped well under the host's 10,000-character limit for
// additionalContext; each field is truncated on its own.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Which planning tree this hook acts on.
 *
 * Mirrors pan-wizard-core/bin/lib/planning-root.cjs, which hooks cannot require
 * (they are standalone and run inside the host runtime). Every PAN hook that
 * reads the planning tree carries an identical copy — if the CLI is pointed at a track while a hook still writes to
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

// Same unticked-phase shape the stop guard and the PanLoop harness use: the
// checklist line templates/roadmap.md and pan-roadmapper.md emit.
const UNTICKED_PHASE_RE = /^- \[ \] \*\*Phase (\d+(?:\.\d+)?):/m;

const FIELD_MAX = 240;
const BLOCK_MAX = 2000;

/** A `**Name:** value` field from state.md — the shape state.cjs reads and writes. */
function field(content, name) {
  const m = content.match(new RegExp(`\\*\\*${name}:\\*\\*[ \\t]*(.+)`, 'i'));
  if (!m) return null;
  const v = m[1].trim();
  // Template placeholders ("[X]", "[Phase name]") are not a position.
  if (!v || /^\[.*\]$/.test(v) || /^none$/i.test(v)) return null;
  return v.length > FIELD_MAX ? v.slice(0, FIELD_MAX - 1) + '…' : v;
}

/**
 * Pure: the additionalContext block for this planning tree, or null when there is
 * nothing in flight to restore.
 * @param {object} args
 * @param {string|null} args.stateContent   .planning/state.md, or null
 * @param {string|null} args.roadmapContent .planning/roadmap.md, or null
 * @param {string} [args.planningRel]       the planning directory, for the pointer line
 * @returns {string|null}
 */
function buildReinjectContext({ stateContent, roadmapContent, planningRel = '.planning' }) {
  if (typeof stateContent !== 'string' || typeof roadmapContent !== 'string') return null;
  const phase = field(stateContent, 'Current Phase');
  if (!phase) return null;
  const unticked = roadmapContent.match(UNTICKED_PHASE_RE);
  if (!unticked) return null; // every roadmap phase is built — nothing in flight

  const name = field(stateContent, 'Current Phase Name');
  const plan = field(stateContent, 'Current Plan');
  const plans = field(stateContent, 'Total Plans in Phase');
  const status = field(stateContent, 'Status');
  const stoppedAt = field(stateContent, 'Stopped At');
  const lastDesc = field(stateContent, 'Last Activity Description');
  const resume = field(stateContent, 'Resume File');

  const lines = ['PAN project state, re-read from disk after context compaction:'];
  let position = `- Current phase: ${phase}${name ? ` (${name})` : ''}`;
  if (plan) position += `, plan ${plan}${plans ? ` of ${plans}` : ''}`;
  lines.push(position);
  if (status) lines.push(`- Status: ${status}`);
  if (stoppedAt) lines.push(`- Stopped at: ${stoppedAt}`);
  else if (lastDesc) lines.push(`- Last activity: ${lastDesc}`);
  if (resume) lines.push(`- Resume file: ${resume}`);
  lines.push(`- First unbuilt roadmap phase: Phase ${unticked[1]}`);
  lines.push(`Re-read ${planningRel}/state.md and the current phase's plan before the next step: continue the work in flight rather than re-planning finished work.`);
  const block = lines.join('\n');
  return block.length > BLOCK_MAX ? block.slice(0, BLOCK_MAX - 1) + '…' : block;
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// ─── The marker (Gemini, Copilot) ─────────────────────────────────────────────

// A marker older than this belongs to a session that never made another tool call.
const MARKER_TTL_MS = 6 * 60 * 60 * 1000;

/** Gemini sends `session_id`; Copilot's camelCase payloads send `sessionId`. */
function sessionIdOf(payload) {
  for (const k of ['session_id', 'sessionId']) {
    if (typeof payload[k] === 'string' && payload[k]) return payload[k];
  }
  return '';
}

/** The per-user hook directory's name: the stop guard's and the context monitor's too. */
function hookDirName() {
  const uid = (typeof process.getuid === 'function' ? process.getuid() : process.env.USERNAME || 'win');
  return `pan-hooks-${uid}`;
}

// Per-user hook state directory inside tmpdir, created 0700 — the same directory
// and the same checks as hookStateDir() in pan-stop-guard.js (hooks are standalone
// files and cannot require one another). Null when the directory is not provably
// ours: on a shared host another user must not be able to plant a marker that
// injects, or a symlink the marker is written through (M60).
function hookStateDir() {
  const dir = path.join(os.tmpdir(), hookDirName());
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

/** One marker per (session, project), named by a hash so neither leaks into a file name. Pure. */
function markerName(sessionId, projectDir) {
  const key = crypto.createHash('sha256').update(`${sessionId}\u0000${path.resolve(projectDir)}`).digest('hex').slice(0, 32);
  return `state-reinject-${key}.json`;
}

// This hook's files in the shared directory: markers, and one a crash left mid-take.
const MARKER_FILE_RE = /^state-reinject-[0-9a-f]{32}\.json(?:\.\d+\.taken)?$/;

function writeMarker(file, now = Date.now()) {
  fs.writeFileSync(file, JSON.stringify({ at: now }), { mode: 0o600 });
  // Sweep markers no session came back for — only this hook's: the directory
  // holds the other hooks' state too. Best effort.
  try {
    for (const name of fs.readdirSync(path.dirname(file))) {
      if (!MARKER_FILE_RE.test(name)) continue;
      const p = path.join(path.dirname(file), name);
      try { if (now - fs.statSync(p).mtimeMs > MARKER_TTL_MS) fs.unlinkSync(p); } catch { /* raced */ }
    }
  } catch { /* unreadable dir */ }
}

/**
 * Take the marker if there is a fresh one: rename it first, so two hooks racing on
 * the same tool result cannot both inject. True when this call took it.
 */
function takeMarker(file, now = Date.now()) {
  const taken = `${file}.${process.pid}.taken`;
  try { fs.renameSync(file, taken); } catch { return false; }
  let fresh = false;
  try { fresh = now - JSON.parse(fs.readFileSync(taken, 'utf8')).at <= MARKER_TTL_MS; } catch { /* unreadable: stale */ }
  try { fs.unlinkSync(taken); } catch { /* gone */ }
  return fresh;
}

/** The block in the shape each host's tool-result event takes. */
function injectOutput(host, context) {
  if (host === 'gemini') return { hookSpecificOutput: { hookEventName: 'AfterTool', additionalContext: context } };
  if (host === 'copilot') return { additionalContext: context };
  return null;
}

function contextFor(projectDir) {
  return buildReinjectContext({
    stateContent: readIfExists(planningPath(projectDir, 'state.md')),
    roadmapContent: readIfExists(planningPath(projectDir, 'roadmap.md')),
    planningRel: planningDirName(),
  });
}

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--mark') ? 'mark' : argv.includes('--inject') ? 'inject' : 'session-start';
  const host = mode === 'inject' ? argv[argv.indexOf('--inject') + 1] : null;
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      let payload = {};
      try { payload = JSON.parse(input); } catch { /* fail open on bad stdin */ }
      if (!payload || typeof payload !== 'object') payload = {};
      const projectDir = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();

      if (mode === 'session-start') {
        if (payload.source !== 'compact') { process.exit(0); return; }
        const context = contextFor(projectDir);
        if (context) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
          }));
        }
      } else {
        const sid = sessionIdOf(payload);
        // An unknown host leaves the marker for a host that can use it.
        if (!sid || (mode === 'inject' && !injectOutput(host, ''))) { process.exit(0); return; }
        const dir = hookStateDir();
        if (!dir) { process.exit(0); return; }
        const file = path.join(dir, markerName(sid, projectDir));
        if (mode === 'mark') {
          if (contextFor(projectDir)) writeMarker(file);
        } else if (takeMarker(file)) {
          // Re-read now: the position after the compaction, not before it.
          const context = contextFor(projectDir);
          if (context) process.stdout.write(JSON.stringify(injectOutput(host, context)));
        }
      }
    } catch { /* fail open — never break a session or a tool call */ }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { buildReinjectContext, UNTICKED_PHASE_RE, markerName, hookDirName, sessionIdOf, injectOutput, MARKER_TTL_MS };
