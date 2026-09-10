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

/**
 * Read-only aggregators → MCP resources (no side effects).
 *
 * Optional `args` is a STATIC argv tail for verbs whose read lives in a
 * subcommand (`validate health`, `links validate`, `cost report`). It is
 * deliberately a fixed array and never a function of client input — a resource
 * takes no parameters, and that is precisely what makes the surface safe: there
 * is no path from an LLM tool-call to these argv elements.
 *
 * THE RULE FOR ADDING ONE — a resource must be readable on ANY project, including
 * a bare directory with no `.planning/`. If "no data yet" is reported as an error
 * (non-zero exit / an error-family key), it is a TOOL, not a resource: a client
 * that lists resources and reads them should not collect failures for a young
 * project. `preview` is the worked example — `preview phases` exits non-zero
 * without a roadmap, so it is exposed as a tool below rather than as a resource.
 * Check before adding: run the verb in an empty dir and read `$?`.
 */
const RESOURCES = [
  { uri: 'pan://state',    name: 'Project state', verb: 'state',    description: 'Current PAN project state snapshot derived from .planning/.' },
  // NOTE: there is deliberately no `pan://roadmap`. One existed and was DEAD from
  // M1 until 2026-08 — its descriptor named the bare verb `roadmap`, which requires
  // a subcommand, so every read returned "Unknown roadmap subcommand". Nothing
  // caught it because the protocol tests inject a fake spawn, so no test had ever
  // run a resource against the real engine. It is now `pan_roadmap_analyze` in
  // TOOLS: `roadmap analyze` exits non-zero on a project with no roadmap.md, which
  // fails the resource rule above. Removing the URI breaks no consumer — no
  // consumer can have depended on a read that always errored.
  // `phases` alone is not a verb — the subcommand is `list`. This descriptor named
  // the bare verb and was DEAD from M1 alongside pan://roadmap, for the same reason
  // and found by the same test. Returns {directories, count}.
  { uri: 'pan://phases',   name: 'Phases',        verb: 'phases',   args: ['list'],
    description: 'Phase inventory: the phase directories present, with a count.' },
  { uri: 'pan://progress', name: 'Progress',      verb: 'progress', description: 'Requirement and plan completion progress.' },
  { uri: 'pan://health',   name: 'Project health', verb: 'validate', args: ['health'],
    description: 'Health check over .planning/: issue codes with severities. Reports an unhealthy project as DATA (exit 0), so it is readable even on a broken or empty one.' },
  { uri: 'pan://links',    name: 'Doc-code links', verb: 'links',   args: ['validate'],
    description: 'Doc↔code link graph verdict: forward links, backlink contracts, and anchor targets, with finding codes.' },
  { uri: 'pan://cost',     name: 'Token cost',     verb: 'cost',    args: ['report'],
    description: 'Aggregated token spend from the .planning/metrics ledger. Reads as zeros on a project with no recorded calls.' },
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
    name: 'pan_roadmap_analyze', title: 'Analyze the roadmap', verb: 'roadmap',
    description: 'The roadmap read: milestones, phases, goals and success criteria with completion analysis. A tool rather than a resource because it reports a project with no roadmap.md as an error.',
    readOnly: true, destructive: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    args: () => ['analyze'],
  },
  {
    name: 'pan_preview_phases', title: 'Preview all phases (dependency graph)', verb: 'preview',
    description: 'Phase dependency graph: a mermaid DAG, the parallel-executable batches, and any hidden dependencies. Errors on a project with no roadmap, which is why this is a tool rather than a resource.',
    readOnly: true, destructive: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    args: () => ['phases'],
  },
  {
    name: 'pan_preview_phase', title: 'Preview one phase (blast radius)', verb: 'preview',
    description: 'Blast radius for a single phase: what it touches and what depends on it, before any work starts.',
    readOnly: true, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['phase'],
      properties: { phase: { type: 'string', description: 'Phase number, e.g. 03' } },
    },
    args: (i) => ['phase', str('phase', i && i.phase, PHASE_RE, 3)],
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

// ─── Per-call project root (ADR-0045 D6, 2026-09) ───────────────────────────
//
// The server resolves its project as `opts.cwd || PAN_PROJECT_ROOT || process.cwd()`.
// Under Claude Code the process cwd IS the project. Under an Agent Plugins client
// the spec makes the PLUGIN ROOT the default working directory of a stdio server,
// so every verb would read `.planning/` from inside the plugin cache and report an
// empty project — cleanly, which is the worst kind of failure. So every TOOL takes
// an optional `cwd`: the absolute path of the project to operate on, honoured for
// that call only. Applied here, centrally, so a tool added later cannot miss it.
//
// Resources deliberately do NOT get it: their argv is a static array and the
// safety argument of ADR-0041 is that no client input reaches it.
const PROJECT_CWD_PROPERTY = Object.freeze({
  type: 'string',
  description: 'Absolute path of the PAN project to operate on. Optional: defaults to the directory the server was started in. Pass it when the server was launched from a plugin directory (Agent Plugins clients do this by default), or to address another project.',
});

const PROJECT_CWD_MAX = 1024;

/**
 * Shape-validate a per-call project root: a non-empty absolute path with no NUL,
 * within a sane length. Existence is the SERVER's check (it has fs); this module
 * stays pure. Throws a message fit for a -32602 on failure.
 */
function validateProjectCwd(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PROJECT_CWD_MAX) {
    throw new Error(`Invalid "cwd": must be a non-empty string of at most ${PROJECT_CWD_MAX} chars`);
  }
  if (value.includes('\0')) throw new Error('Invalid "cwd": contains a NUL byte');
  // Absolute on either platform family: `/…`, `C:\…`, `C:/…`, or a UNC `\\host\share`.
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)) throw new Error('Invalid "cwd": must be an absolute path');
  return value;
}

/** Return a copy of a tool descriptor whose inputSchema also accepts `cwd`. Never mutates the source. */
function withProjectCwd(tool) {
  const schema = tool.inputSchema || { type: 'object', additionalProperties: false, properties: {} };
  return {
    ...tool,
    inputSchema: { ...schema, properties: { ...(schema.properties || {}), cwd: PROJECT_CWD_PROPERTY } },
  };
}

const TOOLS = [...SPAWN_TOOLS, ...NATIVE_TOOLS].map(withProjectCwd);

const byToolName = Object.create(null);
for (const t of TOOLS) byToolName[t.name] = t;
const byResourceUri = Object.create(null);
for (const r of RESOURCES) byResourceUri[r.uri] = r;

module.exports = {
  TOOLS, SPAWN_TOOLS, NATIVE_TOOLS, RESOURCES, byToolName, byResourceUri, FORBIDDEN_VERB,
  AGENT_RE, PHASE_RE, QUERY_RE, str,
  PROJECT_CWD_PROPERTY, validateProjectCwd, withProjectCwd,
};
