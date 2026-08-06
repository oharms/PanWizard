/**
 * Squads — agent groupings for the bot-army model (ADR-0032).
 *
 * A squad is a named grouping of existing PAN agents under the pan-conductor
 * coordinator, labelled with an intended model tier and an intended access
 * contract. This module is a registry + resolver only — it modifies no agent
 * and changes no execution path. `/pan:army` (ADR-0033) and `hud.cjs` read it;
 * `grep -rn "squads.cjs')" pan-wizard-core/` enumerates its consumers.
 *
 * BOTH LABELS BELOW ARE ADVISORY METADATA, NOT ENFORCEMENT. Read this before
 * writing any doc sentence about them, because the live docs now quote this
 * header as the authority for exactly that (`grep -rn 'changes no execution
 * path' docs commands` finds them):
 *
 *  - `access` is the intended least-privilege contract the conductor's prompt is
 *    told to honour when it delegates. Nothing here strips a tool from an agent
 *    or narrows a grant at spawn time. The binding grant is each agent's own
 *    `tools:` frontmatter (`grep '^tools:' agents/*.md`), and it can be wider
 *    than the label: several members of a `read-only` squad hold `Write` so they
 *    can emit planning or verification artifacts, and the coordinator itself
 *    holds `Write` and `Bash`. So a squad agent doing more than its label says
 *    is the expected case, not a bug in this file.
 *  - `tier` is a squad grouping attribute, not the resolver of anybody's model.
 *    The active `model_profile` plus any per-agent `model:` pin decides that.
 *
 * The one rail the grants do enforce is delegation depth: only an agent granted
 * `Task` can spawn another (`grep -l '^tools:.*Task' agents/*.md`), so squad
 * members cannot fan out further.
 */

'use strict';

const { output, error } = require('./core.cjs');

/**
 * Coordinator + worker/utility agents that are NOT squad members.
 * - coordinator: the top of the hierarchy (Tier 0).
 * - workers: narrow-job agents (Tier 2) + standalone utility agents
 *   invoked directly by commands, not delegated through a squad.
 *
 * "Tier 2" is a hierarchy position, not a model tier. Post-COST-RESET (2026-07)
 * every agent in MODEL_PROFILES resolves to `reasoning` under both quality and
 * balanced (the default); `budget` is the only profile that down-tiers, and it is
 * the profile — never this list — that decides what an agent drops to. Note it
 * down-tiers per agent, not per group: `budget` sends some of the workers below
 * to `fast` and others to `mid`. MODEL_PROFILES in core.cjs is the table; read it
 * rather than assuming one tier covers a row of a doc.
 */
const COORDINATOR = 'pan-conductor';
const WORKERS = Object.freeze([
  'pan-document_code',     // codebase mapper
  'pan-distiller',         // code-bloat optimizer
  'pan-optimizer',         // optimization loop
  'pan-experiment-runner', // self-improvement loop
  'pan-knowledge',         // retrieval/Q&A
  'pan-counterfactual',    // what-if worktree replay
  'pan-previewer',         // foresight synthesis
]);

/**
 * The squads, keyed by lifecycle role — `squad list` enumerates them at runtime.
 * `tier` is a PAN model tier label (resolve-model maps a tier to a provider
 * model); `access` is the intended
 * least-privilege contract the conductor is instructed to honour when delegating
 * to the squad. Neither is applied by this module — see the advisory note in the
 * file header before describing either one as a restriction.
 */
const SQUADS = Object.freeze({
  architecture: Object.freeze({
    label: 'Architecture',
    tier: 'reasoning',
    access: 'read-only',
    summary: 'Designs the system before code — contract-first.',
    agents: Object.freeze([
      'pan-roadmapper', 'pan-planner', 'pan-designer', 'pan-plan-checker', 'pan-design-checker',
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
