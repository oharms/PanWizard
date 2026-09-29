#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: trust ONE workspace in a scratch Gemini CLI home.
 *
 *   node gemini-trust.cjs <scratch-home> <workspace>
 *
 * Gemini CLI enforces folder trust fail-closed: an untrusted folder's project
 * .gemini/settings.json is skipped, so PAN's MCP server lists as `Disabled`. A harness
 * workspace is created fresh on every run, so it is never trusted. Measured from the
 * Gemini CLI 0.61.0 bundle on 2026-09-29:
 *   - `GEMINI_CLI_HOME` replaces the home directory (homedir()), so every user-level
 *     file moves with it: `<home>/.gemini/settings.json`, the runtime state and
 *     `<home>/.gemini/trustedFolders.json`;
 *   - that file maps absolute paths to `TRUST_FOLDER` / `TRUST_PARENT` / `DO_NOT_TRUST`,
 *     and the longest matching path wins;
 *   - folder trust is on unless settings turn it off (`security.folderTrust.enabled ?? true`).
 * So this script writes `{ "<workspace>": "TRUST_FOLDER" }` into the scratch home. That
 * is the same file and entry Gemini's own trust prompt writes, and it trusts exactly this
 * workspace. The user's real ~/.gemini is never read or written: the script refuses a
 * home that resolves to the real one.
 * Prints JSON { trusted, file, entries } and exits 1 on any refusal.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const [homeArg, wsArg] = process.argv.slice(2);
function fail(reason) {
  console.log(JSON.stringify({ trusted: null, error: reason }));
  process.exit(1);
}
if (!homeArg || !wsArg) fail('usage: gemini-trust.cjs <scratch-home> <workspace>');
const home = path.resolve(homeArg);
const realHome = path.resolve(os.homedir());
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (same(home, realHome)) fail(`refusing to write into the real home (${realHome}): give Gemini a scratch GEMINI_CLI_HOME`);
if (!fs.existsSync(wsArg)) fail(`workspace does not exist: ${wsArg}`);
// The real path: Gemini compares trust rules against realpath'd locations.
const ws = fs.realpathSync(path.resolve(wsArg));
const dir = path.join(home, '.gemini');
const file = path.join(dir, 'trustedFolders.json');
let entries = {};
if (fs.existsSync(file)) {
  try { entries = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail(`unparseable ${file}`); }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) fail(`${file} is not a JSON object`);
}
entries[ws] = 'TRUST_FOLDER';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ trusted: ws, file, entries: Object.keys(entries).length }));
