#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: check the DEPLOYED native workflow scripts in a directory.
 * Prints JSON { checked, problems[] } and exits 1 on any problem.
 *
 *   node check-workflows.cjs <dir-with-pan-*.js>
 *
 * Mirrors the static gate in tests/native-workflows-drift.test.cjs but runs
 * against the installed copies — the ones Claude Code actually loads.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = process.argv[2];
const problems = [];
let checked = 0;
if (!dir || !fs.existsSync(dir)) { console.log(JSON.stringify({ checked: 0, problems: [`directory missing: ${dir}`] })); process.exit(1); }
for (const f of fs.readdirSync(dir).filter(n => /^pan-.*\.js$/.test(n)).sort()) {
  checked++;
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  if (!src.startsWith('export const meta = {')) problems.push(`${f}: meta is not the first statement`);
  const nameMatch = src.match(/^\s*name: '([^']+)',$/m);
  if (!nameMatch || nameMatch[1] + '.js' !== f) problems.push(`${f}: meta.name does not equal the file stem`);
  const metaEnd = src.indexOf('\n}\n');
  const meta = metaEnd > 0 ? src.slice(0, metaEnd + 2) : '';
  const declared = [...meta.matchAll(/\{ title: '([^']+)'/g)].map(m => m[1]).sort();
  const called = [...new Set([...src.matchAll(/^phase\('([^']+)'\)/gm)].map(m => m[1]))].sort();
  if (JSON.stringify(declared) !== JSON.stringify(called)) problems.push(`${f}: meta.phases ${JSON.stringify(declared)} vs phase() ${JSON.stringify(called)}`);
  const code = src.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  for (const [re, label] of [[/\bimport\s*\(/, 'import()'], [/\brequire\s*\(/, 'require()'], [/\bDate\.now\s*\(/, 'Date.now()'], [/\bMath\.random\s*\(/, 'Math.random()'], [/\bnew Date\s*\(\s*\)/, 'new Date()']]) {
    if (re.test(code)) problems.push(`${f}: uses ${label}`);
  }
  try { new vm.Script(`(async () => {\n${src.replace(/^export const meta = /m, 'const meta = ')}\n})`); }
  catch (e) { problems.push(`${f}: does not parse — ${e.message}`); }
}
if (checked === 0) problems.push('no pan-*.js scripts found');
console.log(JSON.stringify({ checked, problems }));
process.exit(problems.length ? 1 : 0);
