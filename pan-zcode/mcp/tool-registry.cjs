'use strict';

/**
 * PAN-Z MCP tool/resource registry (M1).
 *
 * Maps a curated, SAFE subset of `pan-tools` verbs onto MCP tools and resources.
 * This module is PURE — no I/O, no spawning — so the mapping and its guardrails
 * are unit-testable in isolation. The server (server.cjs) consumes it.
 *
 * Read-only aggregators are exposed as MCP *resources* (cheaper, side-effect-free,
 * quota-friendly); anything that can act is a *tool* carrying accurate hints.
 *
 * Inputs to a tool originate from an LLM tool-call, so each arg is validated to a
 * strict shape before it becomes a process argument. The spawn is shell-less
 * (execFile with an argv array — no shell, so no metacharacter risk), but we still
 * validate early for clear errors and defense in depth.
 */

/** Validate a string arg against a whitelist regex + length bound, else throw. */
function str(name, value, re, max = 200) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !re.test(value)) {
    throw new Error(`Invalid "${name}": must match ${re} and be 1-${max} chars`);
  }
  return value;
}

const AGENT_RE = /^[a-z][a-z0-9_-]{1,60}$/;   // agent type, e.g. pan-planner
const PHASE_RE = /^[0-9]{1,3}$/;              // phase number, e.g. 03
const QUERY_RE = /^[\w .,:/&()-]{1,120}$/;    // find-phase query fragment

/** Read-only aggregators → MCP resources (no side effects). */
const RESOURCES = [
  { uri: 'pan://state',    name: 'Project state', verb: 'state',    description: 'Current PAN project state snapshot derived from .planning/.' },
  { uri: 'pan://roadmap',  name: 'Roadmap',       verb: 'roadmap',  description: 'The project roadmap: phases, goals, success criteria.' },
  { uri: 'pan://phases',   name: 'Phases',        verb: 'phases',   description: 'Phase inventory with per-phase status.' },
  { uri: 'pan://progress', name: 'Progress',      verb: 'progress', description: 'Requirement and plan completion progress.' },
];

/** Actionable pan-tools verbs → MCP tools (each spawns `node pan-tools.cjs <verb>`). */
const SPAWN_TOOLS = [
  {
    name: 'pan_resolve_model', title: 'Resolve model for an agent', verb: 'resolve-model',
    description: 'Resolve the model tier/id PAN would use for an agent under the active profile.',
    readOnly: true, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['agent'],
      properties: { agent: { type: 'string', description: 'Agent type, e.g. pan-planner' } },
    },
    args: (i) => [str('agent', i && i.agent, AGENT_RE, 64)],
  },
  {
    name: 'pan_find_phase', title: 'Find a phase', verb: 'find-phase',
    description: 'Locate a phase directory by number or slug fragment.',
    readOnly: true, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: { query: { type: 'string', description: 'Phase number or slug fragment' } },
    },
    args: (i) => [str('query', i && i.query, QUERY_RE, 120)],
  },
  {
    name: 'pan_report_phase', title: 'Generate a phase HTML report', verb: 'report',
    description: 'Render the self-contained HTML report for one phase (a build deliverable). Writes only its own file; non-destructive and idempotent.',
    readOnly: false, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['phase'],
      properties: { phase: { type: 'string', description: 'Phase number, e.g. 03' } },
    },
    args: (i) => ['phase', str('phase', i && i.phase, PHASE_RE, 3)],
  },
];

/**
 * Guardrail: this bridge must NEVER expose a history-rewriting or force git op.
 * merge/commit verbs arrive in M2 behind the deterministic human-token gate, and
 * force-push/reset/rebase are never exposed at all (recovery is revert-only).
 */
const FORBIDDEN_VERB = /(^|-)(push|reset|rebase|force)($|-)/;

// Native, in-process tools (M2: orchestrator + merge gate) join the spawn-backed
// tools into one advertised list. Required after SPAWN_TOOLS/FORBIDDEN_VERB so the
// native module (which imports nothing back from here) composes cleanly — no cycle.
const { NATIVE_TOOLS } = require('./native-tools.cjs');
const TOOLS = [...SPAWN_TOOLS, ...NATIVE_TOOLS];

const byToolName = Object.create(null);
for (const t of TOOLS) byToolName[t.name] = t;
const byResourceUri = Object.create(null);
for (const r of RESOURCES) byResourceUri[r.uri] = r;

module.exports = {
  TOOLS, SPAWN_TOOLS, NATIVE_TOOLS, RESOURCES, byToolName, byResourceUri, FORBIDDEN_VERB,
  AGENT_RE, PHASE_RE, QUERY_RE, str,
};
