/**
 * Transitions — the declared state machine of every orchestration entity that
 * PAN writes a status for (durable orchestration Stage B).
 *
 * Each table is data: the entity's states and, for each state, the states a
 * writer may move it to. A state not listed as a key is not a state of that
 * entity. Writers check a change before they make it (store.updateRecord's
 * `transition` option does it inside the record's lock); next-action checks
 * the statuses it routes on and reports the edges open from the current one.
 *
 * Only a CHANGE of status is checked: rewriting a record without touching its
 * status (focus open setting current_cycle on a completed run) is not a
 * transition. A record whose identity field changed (a new focus run replacing
 * the last one's file) starts over at the table's initial states.
 *
 * Zero dependencies beyond constants.cjs.
 */

'use strict';

const { AUTORUN_STATUSES: A } = require('./constants.cjs');

const TABLES = Object.freeze({
  // .planning/focus/auto-run.json — `focus auto` start, --update, --stop, --continue.
  'focus.run': {
    statusField: 'status',
    identity: 'run_id',
    initial: [A.INITIALIZED],
    edges: {
      [A.INITIALIZED]: [A.IN_PROGRESS, A.STOPPED, A.COMPLETED],
      [A.IN_PROGRESS]: [A.STOPPED, A.COMPLETED],
      [A.STOPPED]: [A.IN_PROGRESS, A.INITIALIZED],
      [A.COMPLETED]: [],
    },
  },
  // .planning/autodev/<run>/run.json — claimed by the process driving it.
  'autodev.run': {
    statusField: 'status',
    identity: 'id',
    initial: ['running'],
    edges: {
      running: ['stopped'],
      stopped: ['running'],
    },
  },
  // .planning/orchestration/approvals/<branch>.json — the human merge gate.
  'merge.request': {
    statusField: 'status',
    identity: null,
    initial: ['awaiting_approval'],
    edges: {
      awaiting_approval: ['merged'],
      // A merged branch may be staged again with new commits: a new round, with
      // a fresh token (the old one was consumed by the merge).
      merged: ['awaiting_approval'],
    },
  },
  // One step of a plan's or cycle's journal (journal.cjs): the latest event of a
  // step is its state. A step may be recorded completed without a started line
  // (an executor that records only its commits); completed is final.
  'plan.step': {
    statusField: 'event',
    identity: 'step',
    initial: ['started', 'completed', 'failed', 'paused'],
    edges: {
      started: ['completed', 'failed', 'paused'],
      // A step may complete straight from paused or failed: its evidence (a
      // commit, a file) is what counts, and a cancelled or expired pause must
      // not strand the step.
      paused: ['resumed', 'failed', 'completed'],
      resumed: ['completed', 'failed', 'paused'],
      failed: ['started', 'completed'],
      completed: [],
    },
  },
  // .planning/pauses/<id>.json — a typed pause for a person's answer (pause.cjs).
  'pause': {
    statusField: 'status',
    identity: 'id',
    initial: ['open'],
    edges: {
      open: ['answered', 'expired', 'cancelled'],
      answered: [],
      expired: [],
      cancelled: [],
    },
  },
  // A phase's status on disk (classifyPhaseStatus). Derived, never written as a
  // field: next-action routes on it and reports the edges open from it.
  // (`phase complete` on a complete phase stays idempotent, by contract.)
  'phase': {
    statusField: 'status',
    identity: 'number',
    initial: ['empty', 'discussed', 'researched', 'planned'],
    edges: {
      empty: ['discussed', 'researched', 'planned'],
      discussed: ['researched', 'planned'],
      researched: ['planned'],
      planned: ['partial', 'complete'],
      partial: ['complete'],
      complete: [],
    },
  },
});

// state.md's Quick Tasks table: the statuses its writers record (focus close
// records a cycle's derived status; /pan:quick records its verification's).
const QUICK_TASK_STATUSES = Object.freeze(['verified', 'partial', 'failed', 'needs review', 'gaps', 'done']);

/** The states of an entity (its table's keys), or null for an unknown entity. */
function statesOf(entity) {
  const t = TABLES[entity];
  return t ? Object.keys(t.edges) : null;
}

/** True when state is a state of entity. */
function isState(entity, state) {
  const s = statesOf(entity);
  return Boolean(s && s.includes(state));
}

/** The states entity may move to from `from` (a fresh record: the initial states). */
function allowedFrom(entity, from) {
  const t = TABLES[entity];
  if (!t) return [];
  if (from === null || from === undefined) return [...t.initial];
  return [...(t.edges[from] || [])];
}

/**
 * Check one change of status.
 * @param {string} entity - a TABLES key
 * @param {string|null} from - current status (null: no record yet)
 * @param {string} to - status the writer wants to set
 * @returns {null | {error: 'illegal_transition'|'unknown_state', entity, from, to, allowed}}
 */
function checkTransition(entity, from, to) {
  const t = TABLES[entity];
  if (!t) throw new Error(`unknown entity: ${entity}`);
  if (from === to) return null;
  if (!isState(entity, to)) return { error: 'unknown_state', entity, from: from ?? null, to, allowed: allowedFrom(entity, isState(entity, from) ? from : null) };
  if (from !== null && from !== undefined && !isState(entity, from)) {
    // A status no writer produces (a hand edit): report it rather than guess.
    return { error: 'unknown_state', entity, from, to, allowed: [] };
  }
  const allowed = allowedFrom(entity, from);
  if (allowed.includes(to)) return null;
  return {
    error: 'illegal_transition', entity, from: from ?? null, to, allowed,
    reason: `${entity} cannot go from ${from ?? '(new)'} to ${to}; allowed: ${allowed.length ? allowed.join(', ') : 'nothing — it is final'}`,
  };
}

/**
 * Check the change between two records of an entity, as store.updateRecord
 * sees them. A changed identity (a new run in the same file) starts fresh.
 * @returns {null | refusal}
 */
function checkRecord(entity, current, next) {
  const t = TABLES[entity];
  if (!t) throw new Error(`unknown entity: ${entity}`);
  if (!next) return null;
  const sameThing = current && (!t.identity || current[t.identity] === next[t.identity]);
  const from = sameThing ? (current[t.statusField] ?? null) : null;
  const to = next[t.statusField];
  if (to === undefined) return null; // the write sets no status: not a transition
  if (sameThing && from === to) return null;
  return checkTransition(entity, from, to);
}

/** Normalise and check a Quick Tasks status; '' and null mean none was given. */
function checkQuickTaskStatus(status) {
  if (status === null || status === undefined || String(status).trim() === '') return null;
  if (QUICK_TASK_STATUSES.includes(String(status).trim().toLowerCase())) return null;
  return { error: 'invalid_status', status, allowed: [...QUICK_TASK_STATUSES], reason: `quick-task --status must be one of: ${QUICK_TASK_STATUSES.join(', ')} (any case)` };
}

module.exports = {
  TABLES,
  QUICK_TASK_STATUSES,
  statesOf,
  isState,
  allowedFrom,
  checkTransition,
  checkRecord,
  checkQuickTaskStatus,
};
