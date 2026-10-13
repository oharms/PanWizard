#!/usr/bin/env node
'use strict';

/**
 * Did the host send an agent's whole body to the model? (program H1, the MI-015 class)
 *
 *   node wire-agent-body.cjs <captures-dir> <source-agent.md>
 *
 * Reads the model-double captures of a double-backed step and the agent's SOURCE in the
 * package (not the installed copy: a package that truncates the agent on install would
 * otherwise agree with itself). Every non-empty body line of the source must appear in
 * the system prompt of one captured request. The installer rewrites runtime paths
 * (`~/.claude/…` to `./.claude/…`), so those are normalised on both sides.
 *
 * Prints {agent, lines, missing, whole, request, firstMissing[]} and exits 0; the
 * scenario asserts `json:whole=true`.
 */

const fs = require('fs');
const path = require('path');

const [capturesDir, sourceFile] = process.argv.slice(2);
const norm = (s) => String(s).replace(/\r\n/g, '\n')
  // The installer expands `pan-tools …` into the installed script's full invocation.
  .replace(/node "?[^\s"`]*pan-tools\.cjs"?/g, 'pan-tools')
  .replace(/(?:~\/|\.\/|\.\.\/)?\.(?:claude|codex|gemini|opencode|github|agents)\//g, '<rt>/')
  .replace(/[ \t]+$/gm, '');

const source = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
const lines = norm(body).split('\n').map((l) => l.trim()).filter(Boolean);

let best = { request: null, missing: lines.length, firstMissing: lines.slice(0, 3) };
for (const f of fs.readdirSync(capturesDir).filter((n) => /^\d{3}\.json$/.test(n)).sort()) {
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(capturesDir, f), 'utf8')); } catch { continue; }
  if (!c || !c.protocol) continue;
  const sys = norm(c.system || '');
  const missing = lines.filter((l) => !sys.includes(l));
  if (missing.length < best.missing) best = { request: c.n, missing: missing.length, firstMissing: missing.slice(0, 3) };
}

process.stdout.write(JSON.stringify({
  agent: path.basename(sourceFile, '.md'),
  lines: lines.length,
  missing: best.missing,
  whole: lines.length > 0 && best.missing === 0,
  request: best.request,
  firstMissing: best.firstMissing,
}) + '\n');
