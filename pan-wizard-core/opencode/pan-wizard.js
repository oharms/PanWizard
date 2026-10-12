'use strict';
// PAN Wizard plugin for OpenCode (memory optimisation O12)
//
// OpenCode was the last host without PAN's state re-injection. It runs no command
// hooks, but its plugins can add to the prompt it compacts a session with:
// `experimental.session.compacting` fires before the model writes the continuation
// summary, and strings pushed onto `output.context` go into that prompt
// (opencode.ai/docs/plugins, read 2026-10-04). This plugin pushes PAN's position —
// the phase in flight, the plan, where it stopped — read from the planning tree on
// disk, so the summary carries it. The other hosts get the same block from
// hooks/pan-state-reinject.js after compaction.
//
// Installed by the PAN installer as <opencode config dir>/plugins/pan-wizard.js,
// below the `{"type":"commonjs"}` package.json PAN writes in the config dir, so this file is
// CommonJS and exports one object both loaders accept: `{ id, server, setup }`
// (OpenCode 1 calls server(), OpenCode 2 calls setup()).
//
// Inert unless the project is a PAN project with work in flight (a state.md naming
// a current phase and a roadmap.md with an unticked phase). Never writes anything.
// Fail-open: an error adds nothing and never breaks a compaction.
//
// planningDirName(), field() and positionLines() are copies of the same logic in
// hooks/pan-state-reinject.js; tests/opencode-plugin.test.cjs pins the two to the
// same output.

const fs = require('fs');
const path = require('path');

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

const UNTICKED_PHASE_RE = /^- \[ \] \*\*Phase (\d+(?:\.\d+)?):/m;
const FIELD_MAX = 240;
const BLOCK_MAX = 2000;

function field(content, name) {
  const m = content.match(new RegExp(`\\*\\*${name}:\\*\\*[ \\t]*(.+)`, 'i'));
  if (!m) return null;
  const v = m[1].trim();
  if (!v || /^\[.*\]$/.test(v) || /^none$/i.test(v)) return null;
  return v.length > FIELD_MAX ? v.slice(0, FIELD_MAX - 1) + '…' : v;
}

/** The position lines for a planning tree, or null when nothing is in flight. */
function positionLines(stateContent, roadmapContent) {
  if (typeof stateContent !== 'string' || typeof roadmapContent !== 'string') return null;
  const phase = field(stateContent, 'Current Phase');
  if (!phase) return null;
  const unticked = roadmapContent.match(UNTICKED_PHASE_RE);
  if (!unticked) return null;
  const name = field(stateContent, 'Current Phase Name');
  const plan = field(stateContent, 'Current Plan');
  const plans = field(stateContent, 'Total Plans in Phase');
  const status = field(stateContent, 'Status');
  const stoppedAt = field(stateContent, 'Stopped At');
  const lastDesc = field(stateContent, 'Last Activity Description');
  const resume = field(stateContent, 'Resume File');
  const lines = [];
  let position = `- Current phase: ${phase}${name ? ` (${name})` : ''}`;
  if (plan) position += `, plan ${plan}${plans ? ` of ${plans}` : ''}`;
  lines.push(position);
  if (status) lines.push(`- Status: ${status}`);
  if (stoppedAt) lines.push(`- Stopped at: ${stoppedAt}`);
  else if (lastDesc) lines.push(`- Last activity: ${lastDesc}`);
  if (resume) lines.push(`- Resume file: ${resume}`);
  lines.push(`- First unbuilt roadmap phase: Phase ${unticked[1]}`);
  return lines;
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** The block to add to the compaction prompt for a project, or null. */
function compactionContext(directory) {
  const rel = planningDirName();
  const dir = path.join(directory, ...rel.split('/'));
  const lines = positionLines(readIfExists(path.join(dir, 'state.md')), readIfExists(path.join(dir, 'roadmap.md')));
  if (!lines) return null;
  const block = [
    'PAN project state at this compaction — keep it in the summary so the work resumes where it stopped:',
    ...lines,
    `After compaction, re-read ${rel}/state.md and the current phase's plan before the next step: continue the work in flight rather than re-planning finished work.`,
  ].join('\n');
  return block.length > BLOCK_MAX ? block.slice(0, BLOCK_MAX - 1) + '…' : block;
}

function directoryOf(ctx) {
  return (ctx && (ctx.directory || ctx.worktree)) || process.cwd();
}

/** Push PAN's block onto the first array target; fail-open, inert outside work in flight. */
function pushBlock(directory, target) {
  try {
    if (!Array.isArray(target)) return;
    const block = compactionContext(directory);
    if (block) target.push(block);
  } catch { /* fail open: a compaction without PAN's block beats a broken one */ }
}

// OpenCode 1: the loader calls server() and reads its hook map.
async function server(ctx) {
  const directory = directoryOf(ctx);
  return {
    'experimental.session.compacting': async (input, output) => {
      pushBlock(directory, output && output.context);
    },
  };
}

// OpenCode 2: the loader requires `setup` (or `effect`) and hooks register through
// `ctx.session.hook(name, fn)` (opencode.ai/v2/docs/build/plugins, migrate-v1). The
// compaction event's prompt parts are `system` (read from the 2.0 binary); `context`
// is the documented v1 name and the fallback.
function setup(ctx) {
  try {
    const directory = directoryOf(ctx);
    const session = ctx && ctx.session;
    if (!session || typeof session.hook !== 'function') return;
    session.hook('compaction', async (event) => {
      if (!event) return;
      pushBlock(directory, Array.isArray(event.system) ? event.system : event.context);
    });
  } catch { /* fail open: a plugin that cannot register leaves the session as it was */ }
}

module.exports = { id: 'pan-wizard', server, setup };
