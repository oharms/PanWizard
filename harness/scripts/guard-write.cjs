#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step (focus-cycle-registered): would the INSTALLED guard let a source write
 * through? Feeds the runtime's copy of pan-guard.js a Claude PreToolUse Write payload for
 * <file> in <workspace>, the way the host does.
 *
 *   node guard-write.cjs <workspace> <runtime dir, e.g. .claude> <file>
 *
 * Prints JSON `{ decision: "allow"|"deny", status, guard }` and exits 0 when it ran; the
 * scenario asserts the decision. Exit 2 from the hook is Claude's deny.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [ws, runtimeDir, file] = process.argv.slice(2);
const guard = path.join(ws, runtimeDir || '.claude', 'hooks', 'pan-guard.js');
if (!fs.existsSync(guard)) {
  console.log(JSON.stringify({ decision: null, status: null, guard: 'missing' }));
  process.exit(1);
}
const payload = { cwd: ws, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(ws, file), content: 'x' } };
const env = { ...process.env };
delete env.PAN_PLANNING_DIR;
delete env.PAN_TRACK;
const r = spawnSync(process.execPath, [guard, '--host', 'claude'], { cwd: ws, input: JSON.stringify(payload), encoding: 'utf8', env });
console.log(JSON.stringify({ decision: r.status === 2 ? 'deny' : r.status === 0 ? 'allow' : 'error', status: r.status, guard: 'installed' }));
