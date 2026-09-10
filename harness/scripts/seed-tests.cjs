#!/usr/bin/env node
'use strict';
/** Harness `sh` step: run the seed project's own `npm test` in the workspace; print {passed, exit, tail}. */
const { spawnSync } = require('child_process');
const ws = process.argv[2] || process.cwd();
const r = spawnSync('npm', ['test', '--silent'], { cwd: ws, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
const out = String(r.stdout || '') + String(r.stderr || '');
console.log(JSON.stringify({ passed: r.status === 0, exit: r.status, tail: out.split('\n').slice(-12).join('\n') }));
process.exit(r.status === 0 ? 0 : 1);
