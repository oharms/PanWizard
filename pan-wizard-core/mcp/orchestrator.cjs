'use strict';

/**
 * The deterministic orchestrator ("next-action" state machine).
 *
 * A host with no workflow engine cannot machine-intercept a subagent spawn, so
 * PAN's sequencing + safety harness (waves, regression circuit-breaker,
 * spawn/budget caps, the human merge gate) cannot live in agent prose or a
 * pre-spawn hook. The fix: keep the state machine here and expose ONE
 * `next-action` tool the primary Agent polls before each step. Enforcement then
 * happens at the (gateable) MCP-tool-call boundary, not at the (un-gateable)
 * spawn event.
 *
 * `nextAction` is a PURE function of a snapshot, so its decisions are
 * reproducible and unit-testable.
 *
 * ─── THE VOCABULARY, and why it is what it is ──────────────────────────────
 *
 * An external audit (2026-08-15) found this machine keyed on statuses that
 * NOTHING IN PAN EMITS. It expected `executed` and `verified`; the only producer
 * of a phase status is `classifyPhaseStatus()` (bin/lib/utils.cjs), which emits
 *
 *     complete · partial · planned · researched · discussed · empty
 *
 * The consequences were severe and all three were reproduced before this rewrite:
 *
 *   1. `verify` and `request_merge` were UNREACHABLE. A phase ran
 *      planned → execute → complete and the machine moved to the next one, so
 *      **the human merge gate — the safety centrepiece — was skipped entirely.**
 *   2. `partial` had no entry and fell through to `plan`, re-planning a
 *      half-executed phase forever (a live-lock).
 *   3. `pan://progress` reports Title Case (`"Planned"`), so a caller following
 *      this file's own instruction to assemble the snapshot from the MCP
 *      resources got `undefined` → `plan` on every cycle, forever.
 *
 * The suite was green throughout because its fixtures spoke `executed`/`verified`
 * — a vocabulary no producer emits. The fixture was MORE capable than reality and
 * therefore produced false confidence. Fixtures here must use the real vocabulary.
 *
 * ─── The model now ─────────────────────────────────────────────────────────
 *
 * Disk status answers "how far did the artifacts get?". It cannot answer "was
 * this verified?" or "was it merged?" — those are RUN facts, known to the caller
 * that just performed them, and no file on disk records them. So a phase carries
 * its disk status plus two optional booleans:
 *
 *     { number, status, verified?: boolean, merged?: boolean }
 *
 * which makes the full ladder reachable from the vocabulary PAN actually emits:
 *
 *     planned                        → execute
 *     partial                        → execute   (RESUME, never re-plan)
 *     empty | discussed | researched → plan
 *     complete & !verified           → verify
 *     complete &  verified & !merged → request_merge
 *     complete &  verified &  merged → (skip; this phase is finished)
 */

// Budget is advisory by default (enforceBudget:false) — it never stops the loop
// unless the caller opts in. maxCycles remains a hard safety stop.
const DEFAULT_CAPS = { maxCycles: 25, budget: Infinity, enforceBudget: false };

/**
 * Disk status → next action, for statuses that precede execution.
 * Keys are the REAL `classifyPhaseStatus()` vocabulary. `complete` is absent on
 * purpose: what follows completion depends on the run facts, not on disk.
 *
 * The two legacy keys are retained as aliases so a caller written against the
 * old contract keeps working, but nothing in PAN produces them.
 */
const PHASE_NEXT = {
  // real disk vocabulary
  empty: 'plan',
  discussed: 'plan',
  researched: 'plan',
  planned: 'execute',
  partial: 'execute',
  // legacy aliases — no producer emits these; kept for callers written against
  // the pre-2026-08 contract. Do NOT use them in new fixtures.
  none: 'plan',
  executed: 'verify',
  verified: 'request_merge',
};

/** Statuses meaning "the artifacts are all there". */
const COMPLETE_STATUS = 'complete';

/**
 * Normalise a status to the lowercase vocabulary the table keys on.
 *
 * `pan://progress` emits Title Case (`"Planned"`) while `roadmap analyze` emits
 * lowercase (`"planned"`); this file's docs point callers at the resources, so
 * the Title Case form is the one a compliant caller will actually send. Folding
 * case here is what makes the documented assembly path work at all.
 */
function normalizeStatus(status) {
  return typeof status === 'string' ? status.trim().toLowerCase() : '';
}

/** True when a phase still needs work of any kind. */
function isPhaseOpen(phase) {
  if (!phase || typeof phase !== 'object') return false;
  const status = normalizeStatus(phase.status);
  if (status !== COMPLETE_STATUS) return true;
  // Complete on disk, but the run facts decide whether it is actually finished.
  return !(phase.verified === true && phase.merged === true);
}

/**
 * Decide the next deterministic action.
 *
 * @param {Object} state snapshot:
 *   { phases:[{number, status, verified?, merged?}], cycles?, points_used?,
 *     tests_before?, tests_after?, awaiting_approval?, aborted? }
 *   `phases` is REQUIRED. A snapshot without a usable one is reported as
 *   `no_phases` / `done:false` — never as success (see below).
 * @param {Object} [caps] { maxCycles, budget, enforceBudget }
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
  if (c.enforceBudget && (state.points_used || 0) >= c.budget) return { action: 'stop', reason: 'budget_cap', done: true };

  // The human merge gate is a barrier: while a merge awaits approval, do nothing else.
  if (state.awaiting_approval) return { action: 'await_approval', reason: 'human_gate', done: false };

  // A MISSING OR MISSHAPEN `phases` IS NOT SUCCESS.
  //
  // This previously collapsed to `[]`, and `[].find(...)` is indistinguishable
  // from "every phase is complete" — so `{}`, a wrong key, or a non-array all
  // returned all_complete/done:true. An orchestrator wrong in the "keep working"
  // direction wastes tokens and gets noticed; one wrong in the `done:true`
  // direction silently stops the loop and reports success. `no_phases` carries
  // `done:false` precisely so a caller cannot mistake "I could not read this"
  // for "the work is finished".
  const hasPhases = Array.isArray(state.phases)
    && state.phases.some((p) => p && typeof p === 'object' && (p.status !== undefined || p.number !== undefined));
  if (!hasPhases) {
    return { action: 'stop', reason: 'no_phases', done: false };
  }

  // Advance the first phase that is not finished.
  const phase = state.phases.find(isPhaseOpen);
  if (!phase) return { action: 'stop', reason: 'all_complete', done: true };

  const status = normalizeStatus(phase.status);
  const args = { phase: phase.number };

  // Complete on disk: the run facts decide. This is the branch that makes the
  // merge gate reachable — without it a completed phase was simply skipped.
  if (status === COMPLETE_STATUS) {
    if (phase.verified !== true) return { action: 'verify', args, reason: 'phase_complete_unverified', done: false };
    return { action: 'request_merge', args, reason: 'phase_verified_unmerged', done: false };
  }

  const action = PHASE_NEXT[status];
  if (!action) {
    // An unknown status is a caller/producer mismatch, not a licence to re-plan.
    // Say so, rather than silently defaulting the way the old `|| 'plan'` did —
    // that default is what turned Title Case into an infinite plan loop.
    return { action: 'plan', args, reason: `phase_unknown_status_${status || 'missing'}`, done: false };
  }
  return { action, args, reason: `phase_${status}`, done: false };
}

module.exports = { nextAction, DEFAULT_CAPS, PHASE_NEXT, normalizeStatus, isPhaseOpen };
