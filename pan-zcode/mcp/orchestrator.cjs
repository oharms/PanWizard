'use strict';

/**
 * PAN-Z M2 — the deterministic orchestrator ("next-action" state machine).
 *
 * ZCode has no workflow engine and cannot machine-intercept a subagent spawn, so
 * PAN's sequencing + safety harness (waves, regression circuit-breaker, spawn/budget
 * caps, the human merge gate) cannot live in agent prose or a pre-spawn hook. The
 * review's fix: relocate the state machine here and expose ONE `next-action` tool the
 * primary Agent polls before each step. Enforcement then happens at the (gateable)
 * MCP-tool-call boundary, not at the (un-gateable) spawn event.
 *
 * `nextAction` is a PURE function of a snapshot the caller assembles from PAN's own
 * state (via the pan-mcp resources) — so it is fully unit-testable and its decisions
 * are reproducible.
 */

const DEFAULT_CAPS = { maxCycles: 25, budget: Infinity };
const PHASE_NEXT = {
  none: 'plan',
  researched: 'plan',
  planned: 'execute',
  executed: 'verify',
  verified: 'request_merge',
};

/**
 * Decide the next deterministic action.
 * @param {Object} state snapshot:
 *   { phases:[{number,status}], cycles?, points_used?, tests_before?, tests_after?,
 *     awaiting_approval?:boolean, aborted?:boolean }
 * @param {Object} [caps] { maxCycles, budget }
 * @returns {{action:string, args?:Object, reason:string, done:boolean}}
 *   action ∈ plan | execute | verify | request_merge | await_approval | stop
 */
function nextAction(state, caps) {
  const c = Object.assign({}, DEFAULT_CAPS, caps || {});
  state = state || {};

  // Hard stops first — safety caps and the circuit-breaker outrank all progress.
  if (state.aborted) return { action: 'stop', reason: 'aborted', done: true };
  if (
    typeof state.tests_before === 'number' &&
    typeof state.tests_after === 'number' &&
    state.tests_after < state.tests_before
  ) {
    return { action: 'stop', reason: 'regression', done: true };
  }
  if ((state.cycles || 0) >= c.maxCycles) return { action: 'stop', reason: 'max_cycles', done: true };
  if ((state.points_used || 0) >= c.budget) return { action: 'stop', reason: 'budget_cap', done: true };

  // The human merge gate is a barrier: while a merge awaits approval, do nothing else.
  if (state.awaiting_approval) return { action: 'await_approval', reason: 'human_gate', done: false };

  // Advance the first phase that isn't complete.
  const phases = Array.isArray(state.phases) ? state.phases : [];
  const phase = phases.find((p) => p && p.status !== 'complete');
  if (!phase) return { action: 'stop', reason: 'all_complete', done: true };

  const action = PHASE_NEXT[phase.status] || 'plan';
  return { action, args: { phase: phase.number }, reason: `phase_${phase.status}`, done: false };
}

module.exports = { nextAction, DEFAULT_CAPS, PHASE_NEXT };
