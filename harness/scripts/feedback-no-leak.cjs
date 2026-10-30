#!/usr/bin/env node
'use strict';

/**
 * Does the installed `pan-tools feedback` leak the project? (`/pan:feedback`)
 *
 *   node feedback-no-leak.cjs <workspace> <runtime-dir>
 *
 * Runs the installed engine's `feedback --tool-errors --days 100000` in the workspace
 * and checks its output against the seed's `canaries.json`: every string a seed plants
 * in free text must be absent. Prints {exit, report, leaks, leaked[]} (the leaked
 * strings' indexes in canaries.json, never the strings) and exits 0; the scenario
 * asserts `json:leaks=0` and `json:report=true`.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [ws, rtDir = '.claude'] = process.argv.slice(2);
const canaries = JSON.parse(fs.readFileSync(path.join(ws, 'canaries.json'), 'utf8'));
const tools = path.join(ws, rtDir, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const r = spawnSync(process.execPath, [tools, 'feedback', '--tool-errors', '--days', '100000'], { cwd: ws, encoding: 'utf8', env: { ...process.env, PAN_PROJECT_ROOT: '' } });
const out = String(r.stdout || '');
const lower = out.toLowerCase();
const leaked = canaries.map((c, i) => (lower.includes(String(c).toLowerCase()) ? i : -1)).filter((i) => i >= 0);
process.stdout.write(JSON.stringify({ exit: r.status, report: /## PAN learning report/.test(out) && /```pan-feedback\n/.test(out), leaks: leaked.length, leaked }) + '\n');
