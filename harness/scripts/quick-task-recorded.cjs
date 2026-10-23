#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (program H6, quick-mode's covered rule): did /pan:quick record its task
 * in state.md the way quick.md's Step 7 says — a "### Quick Tasks Completed" table with a
 * numbered row that links the task's `.planning/quick/<n>-<slug>/` directory?
 *
 *   node quick-task-recorded.cjs <workspace>
 *
 * Prints JSON `{ recorded, table, rows, linked }`; exits 0 when recorded, 1 otherwise.
 */
const fs = require('fs');
const path = require('path');

/** Pure: read the Quick Tasks Completed table out of state.md's text. */
function quickTaskRecord(stateText) {
  const lines = String(stateText || '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^#{2,3}\s+Quick Tasks Completed\s*$/.test(l));
  if (at < 0) return { recorded: false, table: false, rows: 0, linked: 0 };
  const body = [];
  for (let i = at + 1; i < lines.length && !/^#{1,3}\s/.test(lines[i]); i++) body.push(lines[i]);
  const rows = body.filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const linked = rows.filter((l) => /quick\/\d+-[^\s|)]+/.test(l)).length;
  return { recorded: rows.length > 0 && linked > 0, table: true, rows: rows.length, linked };
}

if (require.main === module) {
  const ws = process.argv[2] || process.cwd();
  let text = '';
  try { text = fs.readFileSync(path.join(ws, '.planning', 'state.md'), 'utf8'); } catch { /* missing reads as unrecorded */ }
  const r = quickTaskRecord(text);
  console.log(JSON.stringify(r));
  process.exit(r.recorded ? 0 : 1);
}

module.exports = { quickTaskRecord };
