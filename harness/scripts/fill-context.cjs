#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for context-note-headless: set the workspace up so a short
 * headless session crosses the context monitor's warning line.
 *
 *   - `.claude/settings.local.json` gains `autoCompactWindow: 100000`, the smallest
 *     window Claude Code accepts (code.claude.com/docs/en/model-config). The host
 *     compacts there, and the monitor measures against the same setting, so the
 *     note's 35% line is 65K tokens of context.
 *   - `notes/reference-<n>.md`, three files of about 8K tokens each. A session in a
 *     PAN project starts at roughly 45K-60K tokens (a bare project measured 44K on
 *     2026-10-04); reading the three brings it past 65K and stays under the 100K
 *     compaction point. The check reports the largest context it saw, so a miss
 *     says which way it missed.
 *
 * Prints JSON { written, autoCompactWindow } and exits 0.
 *
 *   node fill-context.cjs <workspace>
 */
const fs = require('fs');
const path = require('path');

const WINDOW = 100000;
const FILES = 3;
const LINES = 500; // ~45 characters a line, numbers included: ~8K tokens a file as the Read tool returns it

const ws = process.argv[2];
if (!ws || !fs.existsSync(ws)) {
  console.log(JSON.stringify({ error: 'workspace does not exist', ws: ws || null }));
  process.exit(1);
}

const settingsPath = path.join(ws, '.claude', 'settings.local.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* none yet */ }
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, autoCompactWindow: WINDOW }, null, 2) + '\n');

const written = [];
fs.mkdirSync(path.join(ws, 'notes'), { recursive: true });
for (let f = 1; f <= FILES; f++) {
  const lines = [`# Reference ${f}`, ''];
  for (let i = 1; i <= LINES; i++) lines.push(`- Entry ${f}.${i}: greeting variant ${(f * 7919 + i * 104729) % 100003} is kept.`);
  const rel = `notes/reference-${f}.md`;
  fs.writeFileSync(path.join(ws, rel), lines.join('\n') + '\n');
  written.push(rel);
}

console.log(JSON.stringify({ written, autoCompactWindow: WINDOW }));
