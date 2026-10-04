#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: what project memory reached the executors (memory optimisation
 * O4). Reads the orchestrator's own transcript and checks every pan-executor spawn's
 * prompt for the markers seed-memory.cjs planted:
 *
 *   with_valid_rule      the valid, cited entry ("greetings module")   — should be > 0
 *   with_stale_rule      the entry whose cited file does not exist     — must be 0
 *   with_quarantined     a directive from quarantine.md                — must be 0
 *   with_state_archive   old state from state-archive.md               — must be 0
 *
 * Prints JSON { executor_spawns, memory_injected, with_*, problems[] } and exits 1
 * when there is nothing to measure (no transcript, or no executor spawn), so a run
 * with persistence off can never pass.
 *
 *   node memory-injection.cjs <workspace>
 */
const fs = require('fs');
const path = require('path');
const { projectDir } = require('./context-reads.cjs');

/** The pan-executor spawn prompts in a session transcript's lines. */
function executorPrompts(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    const c = j && j.message && j.message.content;
    if (!Array.isArray(c)) continue;
    for (const p of c) {
      if (!p || p.type !== 'tool_use' || !/^(Task|Agent)$/.test(p.name)) continue;
      const input = p.input || {};
      if (input.subagent_type === 'pan-executor') out.push(String(input.prompt || ''));
    }
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
  };
}

function measure(ws, home) {
  const problems = [];
  const dir = projectDir(ws, home);
  const prompts = [];
  let sessions = 0;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { /* none */ }
  for (const f of files) {
    sessions++;
    prompts.push(...executorPrompts(fs.readFileSync(path.join(dir, f), 'utf8').split('\n')));
  }
  if (!sessions) problems.push('no session transcript: the model step must set persistSession: true');
  else if (!prompts.length) problems.push('no pan-executor spawn in the orchestrator transcript');
  const c = classify(prompts);
  return { sessions, ...c, memory_injected: c.with_valid_rule > 0, problems };
}

if (require.main === module) {
  const ws = process.argv[2];
  if (!ws) { process.stderr.write('usage: memory-injection.cjs <workspace>\n'); process.exit(2); }
  const r = measure(ws);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.executor_spawns ? 0 : 1);
}

module.exports = { executorPrompts, classify, measure };
