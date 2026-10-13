#!/usr/bin/env node
'use strict';

/**
 * Append one line to a workspace file (program H2: the one-line agent edit).
 *
 *   node append-line.cjs <workspace-relative-file> <line>
 *
 * Run with the workspace as cwd. Refuses a path outside it. Prints {file, bytes} and
 * exits 0; exits 1 when the file is missing, so the scenario cannot edit nothing.
 */

const fs = require('fs');
const path = require('path');

const [rel, line] = process.argv.slice(2);
if (!rel || line === undefined) { process.stderr.write('usage: append-line.cjs <file> <line>\n'); process.exit(2); }
const ws = process.cwd();
const file = path.resolve(ws, rel);
if (path.relative(ws, file).startsWith('..') || path.isAbsolute(path.relative(ws, file))) { process.stderr.write(`refused: ${rel} is outside the workspace\n`); process.exit(2); }
// One open descriptor for the read, the rewrite and the size: no check-then-use window.
let fd;
try { fd = fs.openSync(file, 'r+'); } catch { process.stderr.write(`no such file: ${rel}\n`); process.exit(1); }
const text = fs.readFileSync(fd, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
fs.ftruncateSync(fd, 0);
fs.writeSync(fd, `${text.replace(/\r?\n$/, '')}${eol}${eol}${line}${eol}`, 0);
const bytes = fs.fstatSync(fd).size;
fs.closeSync(fd);
process.stdout.write(JSON.stringify({ file: rel, bytes }) + '\n');
