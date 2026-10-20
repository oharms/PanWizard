#!/usr/bin/env node
'use strict';

/**
 * Did any request the host sent carry this text? (market-ideas M49)
 *
 *   node wire-contains.cjs <captures-dir> <text>
 *
 * Searches every captured request of a double-backed step (body and system prompt)
 * for the text, plain or JSON-escaped. skill-listing-claude uses it to show that a
 * command marked user-invoked only still runs when the user types it: its body
 * reaches the model.
 *
 * Prints {found, requests} and exits 0; the scenario asserts `json:found=true`.
 */

const fs = require('fs');
const path = require('path');

const [capturesDir, text] = process.argv.slice(2);
let requests = 0;
let found = false;
const escaped = JSON.stringify(String(text || '')).slice(1, -1);
for (const f of fs.readdirSync(capturesDir).filter((n) => /^\d{3}\.json$/.test(n)).sort()) {
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(capturesDir, f), 'utf8')); } catch { continue; }
  if (!c || !c.protocol) continue;
  requests++;
  const hay = JSON.stringify(c.body || {}) + '\n' + (c.system || '');
  if (text && (hay.includes(text) || hay.includes(escaped))) found = true;
}
process.stdout.write(JSON.stringify({ found, requests }) + '\n');
