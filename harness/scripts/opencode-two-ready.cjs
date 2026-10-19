#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: wait until OpenCode 2's background service has loaded this
 * workspace (R51, 2026-10-19).
 *
 * OpenCode 2's `debug agents`, `mcp list` and `plugin list` go through a background
 * service and refuse --standalone. Right after `opencode2 service start`, the service
 * answers before it has loaded the project: on 2.0.32 the first two `debug agents`
 * calls listed only the built-in agents and `mcp list` reported no servers, and from
 * the third call on every answer was stable. Without this step the gate measures that
 * race, not PAN.
 *
 *   node opencode-two-ready.cjs [timeoutSeconds]
 *
 * Polls `opencode2 debug agents` from the workspace (the step's cwd) until a `pan-`
 * agent appears. Exits 0 with the number of attempts, or 1 on timeout (default 60 s).
 */
const { spawnSync } = require('child_process');
const { findCli } = require('../src/cli-detect.cjs');

const timeoutMs = (Number(process.argv[2]) || 60) * 1000;
const bin = findCli('opencode2');
if (!bin) { process.stderr.write('opencode2 not on PATH\n'); process.exit(1); }
const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

const started = Date.now();
let attempts = 0;
while (Date.now() - started < timeoutMs) {
  attempts++;
  const r = spawnSync(viaShell ? `"${bin}"` : bin, ['debug', 'agents'], { encoding: 'utf8', shell: viaShell, timeout: 30000 });
  if (/"id":\s*"pan-/.test(String(r.stdout || ''))) {
    process.stdout.write(JSON.stringify({ ready: true, attempts, ms: Date.now() - started }) + '\n');
    process.exit(0);
  }
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
}
process.stderr.write(`OpenCode 2 never listed a pan- agent within ${timeoutMs / 1000}s (${attempts} attempts)\n`);
process.exit(1);
