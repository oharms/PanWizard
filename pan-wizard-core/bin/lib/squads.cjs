/**
 * Squads — agent groupings for the bot-army model (ADR-0032).
 *
 * A squad is a named, tool-scoped, model-tiered grouping of existing PAN
 * agents under the pan-conductor coordinator. This module is a registry +
 * resolver only — it modifies no agent and changes no execution path. The
 * army campaign command (ADR-0033) consumes it; until then it is inert.
 */

'use strict';

const { output, error } = require('./core.cjs');

/**
 * Coordinator + worker/utility agents that are NOT squad members.
 * - coordinator: the top of the hierarchy (Tier 0).
 * - workers: cheap narrow-job agents (Tier 2) + standalone utility agents
 *   invoked directly by commands, not delegated through a squad.
 */
const COORDINATOR = 'pan-conductor';
const WORKERS = Object.freeze([
  'pan-document_code',     // Haiku-tier codebase mapper
  'pan-distiller',         // Haiku-tier code-bloat optimizer
  'pan-optimizer',         // optimization loop
  'pan-experiment-runner', // self-improvement loop
  'pan-knowledge',         // retrieval/Q&A
  'pan-counterfactual',    // what-if worktree replay
  'pan-previewer',         // foresight synthesis
]);

/**
 * The four squads, keyed by lifecycle role. `tier` is a PAN model tier
 * (resolve-model maps it to a provider model); `access` is the least-privilege
 * tool contract the conductor grants when delegating to the squad.
 */
const SQUADS = Object.freeze({
  architecture: Object.freeze({
    label: 'Architecture',
    tier: 'reasoning',
    access: 'read-only',
    summary: 'Designs the system before code — contract-first.',
    agents: Object.freeze([
      'pan-roadmapper', 'pan-planner', 'pan-plan-checker',
      'pan-project-researcher', 'pan-phase-researcher', 'pan-research-synthesizer',
    ]),
  }),
  build: Object.freeze({
    label: 'Build',
    tier: 'reasoning',
    access: 'read-write-bash',
    summary: 'Turns design and contracts into committed code.',
    agents: Object.freeze(['pan-executor']),
  }),
  quality: Object.freeze({
    label: 'Quality',
    tier: 'mid',
    access: 'read-only',
    summary: 'Adversarially breaks what Build makes before users do.',
    agents: Object.freeze([
      'pan-reviewer', 'pan-hardener', 'pan-meta-reviewer',
      'pan-verifier', 'pan-integration-checker', 'pan-debugger',
    ]),
  }),
  release: Object.freeze({
    label: 'Release',
    tier: 'mid',
    access: 'always-ask',
    summary: 'Ships safely behind a human gate; rolls back fast.',
    agents: Object.freeze(['pan-release']),
  }),
});

const SQUAD_NAMES = Object.freeze(Object.keys(SQUADS));

/** @returns {Array<{name, label, tier, access, summary, agent_count}>} */
function listSquads() {
  return SQUAD_NAMES.map(name => {
    const s = SQUADS[name];
    return { name, label: s.label, tier: s.tier, access: s.access, summary: s.summary, agent_count: s.agents.length };
  });
}

/** @returns {object|null} the squad record (with name) or null if unknown. */
function getSquad(name) {
  const s = SQUADS[name];
  return s ? { name, ...s, agents: [...s.agents] } : null;
}

/** Reverse lookup: which squad owns an agent? @returns {string|null} */
function squadForAgent(agent) {
  for (const name of SQUAD_NAMES) {
    if (SQUADS[name].agents.includes(agent)) return name;
  }
  return null;
}

/**
 * Validate the roster against the set of real agents.
 * @param {string[]} knownAgents - agent names that exist on disk
 * @returns {{ ok: boolean, missing: string[], unassigned: string[] }}
 *   missing    = squad members with no agent file
 *   unassigned = real agents that are neither coordinator, worker, nor squad member
 */
function validateRoster(knownAgents) {
  const known = new Set(knownAgents);
  const missing = [];
  for (const name of SQUAD_NAMES) {
    for (const a of SQUADS[name].agents) {
      if (!known.has(a)) missing.push(a);
    }
  }
  const assigned = new Set([COORDINATOR, ...WORKERS]);
  for (const name of SQUAD_NAMES) for (const a of SQUADS[name].agents) assigned.add(a);
  const unassigned = knownAgents.filter(a => !assigned.has(a));
  return { ok: missing.length === 0 && unassigned.length === 0, missing, unassigned };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function cmdSquadList(raw) {
  const squads = listSquads();
  const human = squads
    .map(s => `${s.label.padEnd(13)} ${s.tier.padEnd(10)} ${s.access.padEnd(16)} ${s.agent_count} agents`)
    .join('\n');
  output({ squads, coordinator: COORDINATOR, workers: [...WORKERS] }, raw, human);
}

function cmdSquadShow(name, raw) {
  const s = getSquad(name);
  if (!s) {
    return error(`Unknown squad "${name}". Available: ${SQUAD_NAMES.join(', ')}`);
  }
  const human = [
    `${s.label} squad — ${s.tier} tier · ${s.access}`,
    s.summary,
    s.agents.length ? 'Agents: ' + s.agents.join(', ') : 'Agents: (none — git-tool driven)',
  ].join('\n');
  output(s, raw, human);
}

module.exports = {
  SQUADS,
  SQUAD_NAMES,
  COORDINATOR,
  WORKERS,
  listSquads,
  getSquad,
  squadForAgent,
  validateRoster,
  cmdSquadList,
  cmdSquadShow,
};
