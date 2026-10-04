#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the lesson-chain control (memory optimisation O6): remove
 * the workspace's `.planning/memory/` folder, so the next phase runs exactly as the
 * chain does except that no lesson can reach it. Prints JSON { dropped, entries }.
 *
 *   node drop-memory.cjs <workspace>
 */
const fs = require('fs');
const path = require('path');

const ws = process.argv[2];
if (!ws || !fs.existsSync(ws)) {
  console.log(JSON.stringify({ error: 'workspace does not exist', ws: ws || null }));
  process.exit(1);
}
const dir = path.join(ws, '.planning', 'memory');
let entries = 0;
try {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    entries += (fs.readFileSync(path.join(dir, f), 'utf8').match(/^- /gm) || []).length;
  }
} catch { /* no memory folder: nothing to drop */ }
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ dropped: true, entries }));
