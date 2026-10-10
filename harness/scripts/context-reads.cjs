#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step: which planning files PAN's phase agents actually read, taken
 * from their own transcripts (memory optimisation O2). The prompts say "read the
 * phase's roadmap slice, not the whole roadmap.md and requirements.md"; this counts
 * whether the agents did.
 *
 *   node context-reads.cjs <workspace>
 *
 * Prints JSON:
 *   { transcripts, by_agent: { <agentType>: { spawns, whole_roadmap, whole_requirements,
 *     section_roadmap, slice } }, phase_agent_whole_reads, phase_agent_slice_reads,
 *     slice_written, plans, plans_naming_whole_roadmap, problems[] }
 * and exits 1 when nothing could be measured: no agent transcript (the model step
 * must set `persistSession: true`), or no slice in the phase directory.
 *
 * A "whole" read is a Read of the file with no `limit` (Read returns up to 2000
 * lines from the top) or a shell command that prints it (cat, type, Get-Content,
 * gc, more, less). A Read with a `limit`, or a grep / Select-String, is a targeted
 * read and is counted as `section_roadmap` for the roadmap. Transcripts live under
 * ~/.claude/projects/<workspace path with every non-alphanumeric as '-'>/, one
 * `<session>/subagents/agent-<id>.jsonl` per spawned agent beside its `.meta.json`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PHASE_AGENTS = ['pan-phase-researcher', 'pan-planner', 'pan-plan-checker', 'pan-executor', 'pan-verifier'];
const ROADMAP_RE = /(^|[\\/\s"'`])\.planning[\\/]roadmap\.md\b/i;
const REQUIREMENTS_RE = /(^|[\\/\s"'`])\.planning[\\/]requirements\.md\b/i;
const SLICE_RE = /-roadmap-slice\.md\b/i;
const SHELL_PRINT_RE = /(^|[;&|(\s])(cat|type|Get-Content|gc|more|less)\s/i;

/** Tool calls in a transcript's lines: [{ name, input }]. Torn lines are skipped. */
function toolCalls(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    const content = j && j.message && j.message.content;
    if (!Array.isArray(content)) continue;
    for (const p of content) if (p && p.type === 'tool_use') out.push({ name: p.name, input: p.input || {} });
  }
  return out;
}

/** Pure: count one agent's reads of the roadmap, requirements and slice. */
function classifyReads(calls) {
  const c = { whole_roadmap: 0, whole_requirements: 0, section_roadmap: 0, slice: 0 };
  for (const { name, input } of calls) {
    if (name === 'Read') {
      const p = String(input.file_path || '').replace(/\\/g, '/');
      const whole = input.limit === undefined || input.limit === null;
      if (SLICE_RE.test(p)) c.slice++;
      else if (ROADMAP_RE.test(p)) whole ? c.whole_roadmap++ : c.section_roadmap++;
      else if (REQUIREMENTS_RE.test(p) && whole) c.whole_requirements++;
    } else if (name === 'Bash' || name === 'PowerShell') {
      const cmd = String(input.command || '');
      const prints = SHELL_PRINT_RE.test(cmd);
      // One command can print the slice and a whole file too (`cat slice.md requirements.md`).
      if (SLICE_RE.test(cmd) && prints) c.slice++;
      if (ROADMAP_RE.test(cmd)) prints ? c.whole_roadmap++ : c.section_roadmap++;
      if (REQUIREMENTS_RE.test(cmd) && prints) c.whole_requirements++;
    }
  }
  return c;
}

/** Claude Code's per-project transcript folder for a workspace. */
function projectDir(ws, home = os.homedir()) {
  return path.join(home, '.claude', 'projects', path.resolve(ws).replace(/[^A-Za-z0-9]/g, '-'));
}

/** Every subagent transcript under a project folder, with its agent type. */
function agentTranscripts(dir) {
  const out = [];
  let sessions = [];
  try { sessions = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return out; }
  for (const s of sessions) {
    const sub = path.join(dir, s.name, 'subagents');
    let files = [];
    try { files = fs.readdirSync(sub); } catch { continue; }
    for (const f of files.filter((n) => /^agent-.*\.jsonl$/.test(n))) {
      let agentType = 'unknown';
      try { agentType = JSON.parse(fs.readFileSync(path.join(sub, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType || 'unknown'; } catch { /* no meta */ }
      out.push({ agentType, file: path.join(sub, f) });
    }
  }
  return out;
}

function measure(ws, home) {
  const problems = [];
  const byAgent = {};
  const transcripts = agentTranscripts(projectDir(ws, home));
  for (const t of transcripts) {
    const counts = classifyReads(toolCalls(fs.readFileSync(t.file, 'utf8').split('\n')));
    const a = byAgent[t.agentType] || (byAgent[t.agentType] = { spawns: 0, whole_roadmap: 0, whole_requirements: 0, section_roadmap: 0, slice: 0 });
    a.spawns++;
    for (const k of Object.keys(counts)) a[k] += counts[k];
  }
  if (!transcripts.length) problems.push('no agent transcript: the model step must set persistSession: true');

  const phases = path.join(ws, '.planning', 'phases');
  let sliceWritten = false;
  let plans = 0;
  let naming = 0;
  try {
    for (const d of fs.readdirSync(phases)) {
      let files = [];
      try { files = fs.readdirSync(path.join(phases, d)); } catch { continue; }
      if (files.some((f) => SLICE_RE.test(f))) sliceWritten = true;
      for (const f of files.filter((n) => /-plan\.md$/.test(n))) {
        plans++;
        if (/^@\.planning\/roadmap\.md\s*$/m.test(fs.readFileSync(path.join(phases, d, f), 'utf8'))) naming++;
      }
    }
  } catch { problems.push('no .planning/phases directory'); }
  if (!sliceWritten) problems.push('no *-roadmap-slice.md in any phase directory: the workflow never ran `roadmap slice --write`');

  const sum = (k) => PHASE_AGENTS.reduce((n, a) => n + ((byAgent[a] && byAgent[a][k]) || 0), 0);
  return {
    transcripts: transcripts.length,
    by_agent: byAgent,
    phase_agent_whole_reads: sum('whole_roadmap') + sum('whole_requirements'),
    phase_agent_slice_reads: sum('slice'),
    slice_written: sliceWritten,
    plans,
    plans_naming_whole_roadmap: naming,
    problems,
  };
}

if (require.main === module) {
  const ws = process.argv[2];
  if (!ws) { process.stderr.write('usage: context-reads.cjs <workspace>\n'); process.exit(2); }
  const r = measure(ws);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.transcripts && r.slice_written ? 0 : 1);
}

module.exports = { toolCalls, classifyReads, projectDir, agentTranscripts, measure, PHASE_AGENTS };
