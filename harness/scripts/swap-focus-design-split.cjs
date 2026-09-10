'use strict';
// R21 A/B helper (harness `sh` step): replace the installed /pan:focus-design command with
// the split variant and drop its procedure reference into the installed core. Paths are
// rewritten the way the local installer rewrites them (~/.claude/ -> ./.claude/).
// Usage: node swap-focus-design-split.cjs <ws> <repo>
const fs = require('fs');
const path = require('path');
const [ws, repo] = process.argv.slice(2);
if (!ws || !repo) { process.stderr.write('usage: swap-focus-design-split.cjs <workspace> <repo>\n'); process.exit(2); }
const cmdSrc = path.join(repo, 'harness', 'variants', 'focus-design.split.md');
const refSrc = path.join(repo, 'harness', 'variants', 'focus-design-procedure.md');
const cmdDest = path.join(ws, '.claude', 'commands', 'pan', 'focus-design.md');
const refDest = path.join(ws, '.claude', 'pan-wizard-core', 'references', 'focus-design-procedure.md');
for (const p of [cmdSrc, refSrc]) if (!fs.existsSync(p)) { process.stderr.write(`missing variant file ${p}\n`); process.exit(1); }
if (!fs.existsSync(path.dirname(cmdDest))) { process.stderr.write(`no local Claude install in ${ws}\n`); process.exit(1); }
const localise = (s) => s.split('~/.claude/').join('./.claude/');
const before = fs.statSync(cmdDest).size;
fs.writeFileSync(cmdDest, localise(fs.readFileSync(cmdSrc, 'utf8')));
fs.mkdirSync(path.dirname(refDest), { recursive: true });
fs.writeFileSync(refDest, localise(fs.readFileSync(refSrc, 'utf8')));
process.stdout.write(JSON.stringify({ swapped: true, command_bytes_before: before, command_bytes_after: fs.statSync(cmdDest).size, reference_bytes: fs.statSync(refDest).size }) + '\n');
