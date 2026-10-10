#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: stop the two-plan seed halfway through its phase (memory
 * optimisation O11, the planning-with-files resume protocol). Plan 01-01 is done —
 * its code, test and summary are written and state.md says so — and plan 01-02 is
 * next. A fresh session told only "continue" must find that out and finish.
 * Prints JSON { advanced, stopped_at } and exits 0.
 *
 *   node seed-midphase.cjs <workspace>
 */
const fs = require('fs');
const path = require('path');

const ws = process.argv[2];
if (!ws || !fs.existsSync(path.join(ws, '.planning', 'phases', '01-greetings', '01-02-plan.md'))) {
  console.log(JSON.stringify({ error: 'not a two-plan-phase workspace', ws: ws || null }));
  process.exit(1);
}
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); };
write('src/greet.js', "'use strict';\n\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\nmodule.exports = { greet };\n");
write('tests/greet.test.js', "'use strict';\n\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { greet } = require('../src/greet.js');\n\ntest(\"greet('Ada') returns 'Hello, Ada!'\", () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!');\n});\n");
write('.planning/phases/01-greetings/01-01-summary.md', [
  '---', 'phase: 01-greetings', 'plan: 01', 'requirements-completed: [REQ-01]', 'completed: 2026-10-04',
  'one-liner: greet(name) returns Hello, <name>! with a node:test test', '---', '',
  '# Phase 1 Plan 01: Greet Summary', '', '`src/greet.js` and `tests/greet.test.js` are written and `npm test` passes.', '',
].join('\n'));
const stoppedAt = 'Completed 01-01-plan.md; 01-02-plan.md (farewell and the index entry point) is next';
const statePath = path.join(ws, '.planning', 'state.md');
let state = fs.readFileSync(statePath, 'utf8');
state = state
  .replace(/\*\*Current Plan:\*\* 01/, '**Current Plan:** 02')
  .replace(/\*\*Status:\*\* .*/, '**Status:** In progress')
  .replace(/\*\*Last Activity Description:\*\* .*/, `**Last Activity Description:** ${stoppedAt}`)
  .replace(/\*\*Progress:\*\* .*/, '**Progress:** [█████░░░░░] 50%');
if (!/\*\*Stopped At:\*\*/.test(state)) state = state.replace(/(\*\*Progress:\*\* .*\n)/, `$1**Stopped At:** ${stoppedAt}\n`);
fs.writeFileSync(statePath, state);
const roadmapPath = path.join(ws, '.planning', 'roadmap.md');
fs.writeFileSync(roadmapPath, fs.readFileSync(roadmapPath, 'utf8').replace('- [ ] 01-01:', '- [x] 01-01:'));
console.log(JSON.stringify({ advanced: true, stopped_at: stoppedAt }));
