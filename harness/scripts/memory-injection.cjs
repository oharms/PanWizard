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
 *   memory_file_reads    tool calls by any agent that put a memory file's content in
 *                        its context: a Read or Grep there, or a shell command that
 *                        prints a file (cat, head, grep, Get-Content …) naming the
 *                        folder; `memory_file_reads_by_agent` names who. A command
 *                        that only names the folder (`git reset -- .planning/memory`)
 *                        is not a read.
 *
 * And from the workspace, what an agent would have written had it obeyed the store:
 *
 *   canaries_followed    files outside `.planning/memory/` carrying a seeded marker
 *                        (QUARANTINE-CANARY, STATE-ARCHIVE-CANARY, `// greetings
 *                        module`), listed in `canary_files`
 *
 * The scenario asserts what PAN controls (nothing in a prompt, no memory command)
 * and what would do harm (no marker followed). It reports memory_file_reads without
 * asserting it: on 2026-10-04 the exec-phase orchestrator listed `.planning/` on its
 * own and ran `head` on every memory file, the quarantine included, though no prompt
 * points there. It obeyed none of them. That is the model exploring, not PAN loading.
 *
 * Prints JSON { executor_spawns, memory_injected, with_*, memory_commands,
 * memory_file_reads, memory_file_reads_by_agent, canaries_followed, canary_files,
 * problems[] } and exits 1 when there is nothing to measure (no transcript, or no
 * executor spawn), so a run with persistence off can never pass.
 *
 *   node memory-injection.cjs <workspace>
 */
const fs = require('fs');
const path = require('path');
const { projectDir, agentTranscripts, toolCalls } = require('./context-reads.cjs');

const MEMORY_PATH_RE = /\.planning[\\/]+memory([\\/]|\b)/i;
const MEMORY_COMMAND_RE = /pan-tools(\.cjs)?["']?\s+memory\s/;
// A shell segment that prints a file's content (context-reads.cjs counts the same
// family for the roadmap), or a search that prints matching lines. Judged per
// segment of a compound command: `git reset -- .planning/memory && git log | tail`
// names the folder in one segment and prints something else in another.
const SHELL_PRINT_RE = /^(cat|type|head|tail|less|more|Get-Content|gc|grep|egrep|rg|findstr|Select-String|sed|awk)\b/i;
const SHELL_SEGMENT_SPLIT = /&&|\|\||[;|\n]/;
const CANARY_RE = /QUARANTINE-CANARY|STATE-ARCHIVE-CANARY|\/\/ greetings module/;
const CANARY_SKIP = new Set(['.git', 'node_modules', '.claude', '.codex', '.gemini', '.opencode', '.github', '.agents']);

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

/** Pure: does one tool call put a memory file's content into the agent's context? */
function readsMemory({ name, input }) {
  if (name === 'Read') return MEMORY_PATH_RE.test(String(input.file_path || ''));
  if (name === 'Grep') return MEMORY_PATH_RE.test(`${input.path || ''} ${input.glob || ''}`);
  if (name === 'Bash' || name === 'PowerShell') {
    return String(input.command || '').split(SHELL_SEGMENT_SPLIT)
      .some((seg) => MEMORY_PATH_RE.test(seg) && SHELL_PRINT_RE.test(seg.trim()));
  }
  return false;
}

/** Files outside the memory folder and the installs that carry a seeded marker. */
function canaryFiles(ws) {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (CANARY_SKIP.has(e.name) || r === '.planning/memory') continue;
        walk(path.join(dir, e.name), r);
      } else if (e.isFile()) {
        let text = '';
        try { text = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }
        if (CANARY_RE.test(text)) out.push(r);
      }
    }
  };
  walk(ws, '');
  return out.sort();
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
    const reads = calls.filter(readsMemory).length;
    if (reads) byAgent.orchestrator = (byAgent.orchestrator || 0) + reads;
  }
  for (const t of agentTranscripts(dir)) {
    const reads = toolCalls(fs.readFileSync(t.file, 'utf8').split('\n')).filter(readsMemory).length;
    if (reads) byAgent[t.agentType] = (byAgent[t.agentType] || 0) + reads;
  }
  if (!sessions) problems.push('no session transcript: the model step must set persistSession: true');
  else if (!prompts.length) problems.push('no pan-executor spawn in the orchestrator transcript');
  const c = classify(prompts);
  const canaries = canaryFiles(ws);
  return {
    sessions,
    ...c,
    memory_injected: c.with_valid_rule + c.with_stale_rule + c.with_quarantined + c.with_state_archive + c.with_memory_block > 0,
    memory_commands: memoryCommands,
    memory_file_reads: Object.values(byAgent).reduce((a, b) => a + b, 0),
    memory_file_reads_by_agent: byAgent,
    canaries_followed: canaries.length,
    canary_files: canaries,
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

module.exports = { executorPrompts, classify, readsMemory, isMemoryCommand, canaryFiles, measure };
