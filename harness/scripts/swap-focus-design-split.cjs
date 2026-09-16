'use strict';
// R21 A/B helper (harness `sh` step): replace the installed /pan:focus-design command with
// the split variant and drop its procedure reference into the installed core. Paths are
// rewritten the way the local installer rewrites them (~/.claude/ -> ./.claude/).
// Usage: node swap-focus-design-split.cjs <ws> <repo>
//
// No check-then-act on the filesystem (CodeQL js/file-system-race, alert #58 on PR #29):
// every read and write is attempted directly and its own error is the report.
const fs = require('fs');
const path = require('path');
const [ws, repo] = process.argv.slice(2);
if (!ws || !repo) { process.stderr.write('usage: swap-focus-design-split.cjs <workspace> <repo>\n'); process.exit(2); }
const cmdSrc = path.join(repo, 'harness', 'variants', 'focus-design.split.md');
const refSrc = path.join(repo, 'harness', 'variants', 'focus-design-procedure.md');
const cmdDest = path.join(ws, '.claude', 'commands', 'pan', 'focus-design.md');
const refDest = path.join(ws, '.claude', 'pan-wizard-core', 'references', 'focus-design-procedure.md');
const localise = (s) => s.split('~/.claude/').join('./.claude/');

function readOrExit(file, what) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e) { process.stderr.write(`cannot read ${what} ${file}: ${e.message}\n`); process.exit(1); }
}
const cmdText = localise(readOrExit(cmdSrc, 'variant command'));
const refText = localise(readOrExit(refSrc, 'variant procedure'));
const before = readOrExit(cmdDest, 'installed command (is there a local Claude install in the workspace?)').length;
try {
  fs.writeFileSync(cmdDest, cmdText);
  fs.mkdirSync(path.dirname(refDest), { recursive: true });
  fs.writeFileSync(refDest, refText);
} catch (e) { process.stderr.write(`swap failed: ${e.message}\n`); process.exit(1); }
process.stdout.write(JSON.stringify({ swapped: true, command_bytes_before: before, command_bytes_after: Buffer.byteLength(cmdText), reference_bytes: Buffer.byteLength(refText) }) + '\n');
