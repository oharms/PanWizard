#!/usr/bin/env node
'use strict';

/**
 * Which PAN skills did the host list to the model?
 *
 *   node wire-skill-listing.cjs <captures-dir> <commands-dir>
 *
 * The model can invoke a skill only when the host lists it. PAN's commands must be listed:
 * 3.37.0 to 3.41.2 marked them disable-model-invocation, and the model could then neither
 * start one for a plain request nor chain to the next step (reverted in 3.41.3).
 * This reads the model-double captures of a double-backed step and each command's
 * `description:` from the package's SOURCE, and reports which descriptions appear
 * anywhere in a captured request body.
 *
 * Prints {skills, listed, unlisted, firstListed[]} and exits 0; the scenario asserts on it.
 */

const fs = require('fs');
const path = require('path');

const [capturesDir, commandsDir] = process.argv.slice(2);
const descriptions = [];
for (const f of fs.readdirSync(commandsDir).filter((n) => n.endsWith('.md')).sort()) {
  const text = fs.readFileSync(path.join(commandsDir, f), 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n[\s\S]*?^description:\s*(.+)$/m);
  if (!m) continue;
  const d = m[1].trim().replace(/^["']|["']$/g, '');
  // A short or generic description could match unrelated text; long ones are distinctive.
  if (d.length >= 40) descriptions.push({ name: f.replace(/\.md$/, ''), text: d.slice(0, 60) });
}

let corpus = '';
for (const f of fs.readdirSync(capturesDir).filter((n) => /^\d{3}\.json$/.test(n)).sort()) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(capturesDir, f), 'utf8'));
    if (c && c.protocol) corpus += '\n' + JSON.stringify(c.body || {}) + '\n' + (c.system || '');
  } catch { /* skip */ }
}
// JSON-escaped and plain forms both count.
const listed = descriptions.filter((d) => corpus.includes(d.text) || corpus.includes(JSON.stringify(d.text).slice(1, -1)));

process.stdout.write(JSON.stringify({
  skills: descriptions.length,
  listed: listed.length,
  unlisted: descriptions.length - listed.length,
  captured: corpus.length > 0,
  firstListed: listed.slice(0, 3).map((d) => d.name),
}) + '\n');
