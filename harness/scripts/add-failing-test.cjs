#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: write one deliberately failing test into a workspace, so the
 * project's `npm test` fails with a real assertion on every Node version.
 * Prints JSON { written } and exits 0.
 *
 *   node add-failing-test.cjs <workspace>
 *
 * tool-error-capture needs a subagent's shell call to fail. It used to rely on the
 * seed's `node --test tests/` script, which only failed because Node 24 no longer
 * searches a directory argument (on Node 18 and 20 the seed's tests pass). Once the
 * seeds ran `node --test`, their suites passed, so the failure is now put there on
 * purpose instead of arriving by accident.
 */
const fs = require('fs');
const path = require('path');

const ws = process.argv[2];
if (!ws || !fs.existsSync(ws)) {
  console.log(JSON.stringify({ error: 'workspace does not exist', ws: ws || null }));
  process.exit(1);
}
const file = path.join(ws, 'tests', 'zz-harness-deliberate-failure.test.js');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, [
  "'use strict';",
  "// Written by the harness (add-failing-test.cjs): a failure on purpose, for tool-error-capture.",
  "const { test } = require('node:test');",
  "const assert = require('node:assert/strict');",
  "test('harness: a deliberately failing assertion', () => {",
  "  assert.equal(1 + 1, 3, 'this test fails on purpose');",
  '});',
  '',
].join('\n'));
console.log(JSON.stringify({ written: path.relative(ws, file).split(path.sep).join('/') }));
