#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: what project memory reached PAN's agents. Since `2026-10-04`
 * PAN's workflows load no agent memory into agents (ADR-0036, amended): the harness
 * found that a recorded lesson changed nothing that state.md, the summaries and the
 * code did not already carry. The memory-not-loaded scenario seeds a store that
 * nothing may read, and this step reads the transcripts to check that nothing did.
 *
 * From the orchestrator's own transcript, every pan-executor spawn's prompt is
 * checked for the markers seed-memory.cjs planted:
 *
 *   with_valid_rule      the valid, cited entry ("greetings module")
 *   with_stale_rule      the entry whose cited file does not exist
 *   with_quarantined     a directive from quarantine.md (ADR-0040)
 *   with_state_archive   old state from state-archive.md
 *   with_memory_block    a `<project_memory>` block of any content
 *
 * And from every transcript, the orchestrator's and each subagent's:
 *
 *   memory_commands      orchestrator shell calls of `pan-tools … memory …`
 *   memory_file_reads    tool calls by any agent that touch `.planning/memory/`
 *                        (a Read, Glob or Grep there, or a shell command naming it),
 *                        with `memory_file_reads_by_agent` naming who
 *
 * Prints JSON { executor_spawns, memory_injected, with_*, memory_commands,
 * memory_file_reads, memory_file_reads_by_agent, problems[] } and exits 1 when there
 * is nothing to measure (no transcript, or no executor spawn), so a run with
 * persistence off can never pass.
 *
 *   node memory-injection.cjs <workspace>
 */
const fs = require('fs');
const path = require('path');
const { projectDir, agentTranscripts, toolCalls } = require('./context-reads.cjs');

const MEMORY_PATH_RE = /\.planning[\\/]+memory([\\/]|\b)/i;
const MEMORY_COMMAND_RE = /pan-tools(\.cjs)?["']?\s+memory\s/;

/** The pan-executor spawn prompts in a session transcript's lines. */
function executorPrompts(lines) {
  const out = [];
  for (const { name, input } of toolCalls(lines)) {
    if (!/^(Task|Agent)$/.test(name)) continue;
    if (input.subagent_type === 'pan-executor') out.push(String(input.prompt || ''));
  }
  return out;
}

/** Pure: count the markers across executor prompts. */
function classify(prompts) {
  const count = (re) => prompts.filter((p) => re.test(p)).length;
  return {
    executor_spawns: prompts.length,
    with_valid_rule: count(/greetings module/i),
    with_stale_rule: count(/trailing underscore/i),
    with_quarantined: count(/QUARANTINE-CANARY/),
    with_state_archive: count(/STATE-ARCHIVE-CANARY|indent with tabs/i),
    with_memory_block: count(/<project_memory>/),
  };
}

/** Pure: does one tool call touch the memory folder? */
function touchesMemory({ name, input }) {
  if (name === 'Read') return MEMORY_PATH_RE.test(String(input.file_path || ''));
  if (name === 'Glob' || name === 'Grep') return MEMORY_PATH_RE.test(`${input.path || ''} ${input.pattern || ''}`);
  if (name === 'Bash' || name === 'PowerShell') return MEMORY_PATH_RE.test(String(input.command || ''));
  return false;
}

/** Pure: an orchestrator shell call that runs a `pan-tools memory` command. */
function isMemoryCommand({ name, input }) {
  return (name === 'Bash' || name === 'PowerShell') && MEMORY_COMMAND_RE.test(String(input.command || ''));
}

function measure(ws, home) {
  const problems = [];
  const dir = projectDir(ws, home);
  const prompts = [];
  const byAgent = {};
  let sessions = 0;
  let memoryCommands = 0;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { /* none */ }
  for (const f of files) {
    sessions++;
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    const calls = toolCalls(lines);
    prompts.push(...executorPrompts(lines));
    memoryCommands += calls.filter(isMemoryCommand).length;
    const reads = calls.filter(touchesMemory).length;
    if (reads) byAgent.orchestrator = (byAgent.orchestrator || 0) + reads;
  }
  for (const t of agentTranscripts(dir)) {
    const reads = toolCalls(fs.readFileSync(t.file, 'utf8').split('\n')).filter(touchesMemory).length;
    if (reads) byAgent[t.agentType] = (byAgent[t.agentType] || 0) + reads;
  }
  if (!sessions) problems.push('no session transcript: the model step must set persistSession: true');
  else if (!prompts.length) problems.push('no pan-executor spawn in the orchestrator transcript');
  const c = classify(prompts);
  return {
    sessions,
    ...c,
    memory_injected: c.with_valid_rule + c.with_stale_rule + c.with_quarantined + c.with_state_archive + c.with_memory_block > 0,
    memory_commands: memoryCommands,
    memory_file_reads: Object.values(byAgent).reduce((a, b) => a + b, 0),
    memory_file_reads_by_agent: byAgent,
    problems,
  };
}

if (require.main === module) {
  const ws = process.argv[2];
  if (!ws) { process.stderr.write('usage: memory-injection.cjs <workspace>\n'); process.exit(2); }
  const r = measure(ws);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.executor_spawns ? 0 : 1);
}

module.exports = { executorPrompts, classify, touchesMemory, isMemoryCommand, measure };
