#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: create a scratch home for a CLI, so a gate never touches the
 * user's real one.
 *
 *   node scratch-home.cjs <dir>
 *
 * Codex refuses a CODEX_HOME that does not exist yet ("failed to resolve CODEX_HOME",
 * Codex CLI 0.157.1, 2026-10-03), so live-gate-codex creates its home first and runs
 * every codex step with CODEX_HOME pointing at it. Until 2026-10-03 that gate ran with
 * no CODEX_HOME at all, and `codex plugin marketplace add` registered the dev
 * marketplace in the user's real ~/.codex/config.toml. The script refuses the real home
 * and anything at or inside a dot-directory directly under it (~/.codex, ~/.gemini,
 * ~/.config, …): those are where CLIs keep their real state. A temp directory under
 * the home (Windows' os.tmpdir() is) is fine. Prints JSON { home } (or
 * { home: null, error }, exit 1).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = process.argv[2];
function fail(reason) {
  console.log(JSON.stringify({ home: null, error: reason }));
  process.exit(1);
}
if (!arg) fail('usage: scratch-home.cjs <dir>');
const dir = path.resolve(arg);
const realHome = path.resolve(os.homedir());
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const rel = path.relative(norm(realHome), norm(dir));
const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
if (rel === '') fail(`refusing ${dir}: it is the real home`);
if (inside && rel.split(path.sep)[0].startsWith('.')) {
  fail(`refusing ${dir}: it is inside ${path.join(realHome, rel.split(path.sep)[0])}, where a CLI keeps its real state`);
}
fs.mkdirSync(dir, { recursive: true });
console.log(JSON.stringify({ home: dir }));
