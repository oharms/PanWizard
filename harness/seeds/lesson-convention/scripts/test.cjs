'use strict';
// The project's test runner: runs exactly the files test/manifest.json lists, so a
// release never picks up a scratch test. A test file that is not listed never runs.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const manifest = path.join(__dirname, '..', 'test', 'manifest.json');
const files = JSON.parse(fs.readFileSync(manifest, 'utf8')).files;
if (!Array.isArray(files) || files.length === 0) {
  console.error('test/manifest.json lists no test files');
  process.exit(1);
}
console.log(`running ${files.length} test file(s) from test/manifest.json`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status === null ? 1 : r.status);
