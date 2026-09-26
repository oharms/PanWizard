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
// Inert unless the project is a PAN project with work in flight: `.planning/`
// holds a state.md that names a current phase AND a roadmap.md with an unticked
// phase. Everywhere else — no planning tree, a focus-only project, a finished
// milestone — it prints nothing. It never writes a file (field finding: hooks
// that scaffolded `.planning/` in projects that never ran PAN).
//
// Fail-open everywhere: bad stdin, unreadable files — exit 0 silently. A missing
// reminder costs a re-read; a crashed hook is a failing hook at every start.
//
// The block is capped well under the host's 10,000-character limit for
// additionalContext; each field is truncated on its own.

const fs = require('fs');
const path = require('path');

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

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      let payload = {};
      try { payload = JSON.parse(input); } catch { /* fail open on bad stdin */ }
      if (!payload || typeof payload !== 'object') payload = {};
      if (payload.source !== 'compact') { process.exit(0); return; }

      const projectDir = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
      const context = buildReinjectContext({
        stateContent: readIfExists(planningPath(projectDir, 'state.md')),
        roadmapContent: readIfExists(planningPath(projectDir, 'roadmap.md')),
        planningRel: planningDirName(),
      });
      if (context) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
        }));
      }
    } catch { /* fail open — never break a session start */ }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { buildReinjectContext, UNTICKED_PHASE_RE };
