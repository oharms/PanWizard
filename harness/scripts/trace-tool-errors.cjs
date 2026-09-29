#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: count the tool failures the trace hook captured in a workspace.
 * Prints JSON { tool_errors, shell_exit_code, completions_with_counts, problems[] }
 * and exits 1 when no failed shell call was captured. The shell tool is Bash, or
 * PowerShell on Windows: the first real run on 2026-09-28 used PowerShell.
 *
 *   node trace-tool-errors.cjs <workspace>
 *
 * The tier-1 gate of the evidence loop (docs/specs/investigations/features/
 * trace-failure-capture.md): a real subagent runs a failing test suite, and the
 * failure must appear in the trace without any agent calling `optimize trace log`.
 * The prompt never mentions that verb, so a captured `tool_error` event can only
 * have come from the hook.
 */
const fs = require('fs');
const path = require('path');

const ws = process.argv[2];
const problems = [];
const events = [];
const tracesDir = path.join(ws || '', '.planning', 'optimization', 'traces');
try {
  for (const s of fs.readdirSync(tracesDir)) {
    const f = path.join(tracesDir, s, 'trace.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { events.push(JSON.parse(l)); } catch { /* skip a torn line */ }
    }
  }
} catch (e) {
  problems.push(`no trace directory in the workspace: ${e.code || e.message}`);
}
const toolErrors = events.filter((e) => e.type === 'error' && e.category === 'tool_error');
const shellExit = toolErrors.filter((e) => e.context && e.context.error_class === 'exit_code');
const counted = events.filter((e) => e.category === 'agent_completion' && e.context && typeof e.context.tool_errors === 'number');
if (!shellExit.length) problems.push('no failed shell call (a non-zero exit code) was captured from the subagent transcript');
if (!counted.length) problems.push('no completion carries tool counts: the hook never read an agent transcript (is session persistence off?)');
console.log(JSON.stringify({ tool_errors: toolErrors.length, shell_exit_code: shellExit.length, completions_with_counts: counted.length, problems }));
process.exit(problems.length ? 1 : 0);
