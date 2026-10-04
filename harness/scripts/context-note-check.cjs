#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for context-note-headless: did PAN's context-monitor note reach
 * a headless session? Reads the session transcript the model step persisted.
 *
 *   noted               the transcript holds a `hook_additional_context` attachment
 *                       carrying "PAN context note (from the context-monitor hook" —
 *                       the shape Claude Code 2.1.288 records a PostToolUse hook's
 *                       additionalContext in (captured 2026-10-04)
 *   levels              "warning" or "critical" for each note, in order
 *   noted_before_compaction  the first note comes before the first compaction
 *                       boundary, or there is none: a note after the host compacted
 *                       arrived too late to be any use
 *   max_context_tokens  the largest input + cache-read + cache-write of any call
 *   bridge_present      whether a status-line bridge file exists for the session; in
 *                       a `claude -p` run it must not, or the note came from the
 *                       status line rather than the transcript
 *
 * Prints JSON { sessions, noted, notes, levels, max_context_tokens, bridge_present,
 * problems[] } and exits 1 when there is no transcript (the model step must set
 * persistSession: true).
 *
 *   node context-note-check.cjs <workspace>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectDir } = require('./context-reads.cjs');

const NOTE = 'PAN context note (from the context-monitor hook';

/** Pure: the notes, whether the first came before any compaction, and the largest context. */
function scan(lines) {
  const levels = [];
  let max = 0;
  let compacted = false;
  let beforeCompaction = null;
  for (const l of lines) {
    if (!l) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'compact_boundary') compacted = true;
    if (e.type === 'attachment' && e.attachment && e.attachment.type === 'hook_additional_context') {
      const text = [].concat(e.attachment.content || []).join('\n');
      if (text.includes(NOTE)) {
        if (beforeCompaction === null) beforeCompaction = !compacted;
        levels.push(/will compact this session soon/.test(text) ? 'critical' : 'warning');
      }
    }
    const u = e.type === 'assistant' && e.message && e.message.usage;
    if (u) max = Math.max(max, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
  }
  return { levels, max, beforeCompaction: beforeCompaction === true };
}

/** The status-line bridge directory the hooks share (pan-context-monitor.js bridgeDir()). */
function bridgeDir() {
  const uid = (typeof process.getuid === 'function' ? process.getuid() : process.env.USERNAME || 'win');
  return path.join(os.tmpdir(), `pan-hooks-${uid}`);
}

function measure(ws, home) {
  const problems = [];
  const dir = projectDir(ws, home);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { /* none */ }
  const levels = [];
  let max = 0;
  let beforeCompaction = false;
  let bridgePresent = false;
  for (const f of files) {
    const r = scan(fs.readFileSync(path.join(dir, f), 'utf8').split('\n'));
    levels.push(...r.levels);
    max = Math.max(max, r.max);
    beforeCompaction = beforeCompaction || r.beforeCompaction;
    if (fs.existsSync(path.join(bridgeDir(), `claude-ctx-${f.replace(/\.jsonl$/, '')}.json`))) bridgePresent = true;
  }
  if (!files.length) problems.push('no session transcript: the model step must set persistSession: true');
  return { sessions: files.length, noted: levels.length > 0, noted_before_compaction: beforeCompaction, notes: levels.length, levels, max_context_tokens: max, bridge_present: bridgePresent, problems };
}

if (require.main === module) {
  const ws = process.argv[2];
  if (!ws) { process.stderr.write('usage: context-note-check.cjs <workspace>\n'); process.exit(2); }
  const r = measure(ws);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.sessions ? 0 : 1);
}

module.exports = { scan, measure, NOTE };
