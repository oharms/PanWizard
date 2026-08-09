#!/usr/bin/env node
// Auto-Advance Stop Guard - Stop hook (P-1809)
//
// Catches the P-1801/P-1807 boundary drop mechanically. Field data (PanLoop,
// 2026-08): with the gate-parity fix and prose hardening in place, autonomous
// builds still stopped at a phase boundary at a low, nondeterministic rate —
// the orchestrator finishes transition.md's state bookkeeping and ends its turn
// without issuing the Route A Task spawn. Prose cannot bind that tail reliably;
// a Stop hook can, because it runs as code when the session tries to end.
//
// When the session stops, this hook blocks ONCE — with a reason telling the
// agent to spawn the next phase — if and only if the disk shows the exact
// boundary-drop fingerprint:
//   1. .planning/config.json shows an autonomy signal: workflow.auto_advance
//      === true OR mode === 'yolo'. P-1810 (PanLoop finding 7): the guard
//      originally armed on auto_advance alone — narrower than the composite
//      trigger it guards (flag OR config OR yolo) — and stayed dark on the
//      exact base64url drop it was built for (mode yolo, auto_advance false).
//      A Stop hook cannot see the --auto flag, so the chain's entry hops
//      (discuss/plan/exec-phase) persist the flag into config, and yolo is
//      accepted directly. transition.md Route B clears auto_advance at the
//      milestone boundary, which disarms the config half at the true end.
//   2. .planning/state.md does NOT show a legitimate-stop marker (gaps found,
//      verification failed, blocked). P-1812 (PanLoop finding 9): this
//      condition was originally "status begins 'Ready to plan'" — one batch
//      produced four different status phrasings for the same situation, and a
//      run with BOTH arming conditions satisfied was disarmed by wording
//      alone. The condition is now inverted: an unrecognised phrasing ARMS
//      the guard (fail-safe — at worst one extra continuation, bounded by the
//      one-shot design) instead of disarming it (fail-open — the build
//      silently stops). Never re-introduce a required phrasing here; the
//      model does not reliably write canonical wording and nothing forces it.
//   3. .planning/roadmap.md still has unticked `- [ ] **Phase N:` lines
//      (the shipped template/roadmapper checklist shape — same detector the
//      PanLoop harness uses to call a build incomplete)
//
// Loop safety: the host sets stop_hook_active on stop attempts that follow a
// stop-hook block, and this guard always allows those — it fires at most once
// per stop chain, so a user who genuinely wants to stop is delayed by exactly
// one continuation, never trapped.
//
// Escape hatch: set workflow.stop_guard to false in .planning/config.json to
// disable the guard entirely without turning off auto_advance.
//
// Fail-open everywhere: no .planning, unparseable config/state/roadmap, bad
// stdin — exit 0 silently. This guard must never block a stop on uncertainty;
// a missed catch is a re-run, a wrong block is a trapped session.
//
// The decision logic lives in the pure, exported buildStopDecision() so the
// full condition matrix is unit-tested (tests/stop-guard-hook.test.cjs)
// rather than only reachable via stdin (same pattern as the other PAN hooks).

const fs = require('fs');
const path = require('path');

// Unticked phase line, exactly as templates/roadmap.md and pan-roadmapper.md
// emit it. Fixture doctrine: this shape is pinned against the shipped template
// by the tests — never widen it from imagination, re-derive it from the files.
const UNTICKED_PHASE_RE = /^- \[ \] \*\*Phase (\d+(?:\.\d+)?):/m;

// Legitimate-stop markers in state.md (P-1812). Condition 2 exists only to
// let a REAL stop through — a verification failure, gaps, or a recorded
// blocker. Matching those (a short, high-precision list) is robust; matching
// the "chain should continue" wording was not: PAN wrote "Ready to plan",
// "Ready to execute", "Phase 2 planning pending" and two milestone phrasings
// for the same boundary within one field batch. Anything NOT matching this
// list arms the guard.
const LEGIT_STOP_RE = /gaps?\s+found|verification\s+(?:failed|found\s+gaps)|failed\s+verification|\bblocked\b|\bblocker\b/i;

// The stopped_at "ready to plan Phase N" phrasing, when present, names the
// next phase more precisely than the first-unticked roadmap line (a
// completed-but-unticked earlier phase would misdirect it — finding 8).
const READY_STOPPED_AT_RE = /ready to plan phase\s*(\d+(?:\.\d+)?)/i;

/**
 * Pure decision: should this stop be blocked?
 * @param {object} args
 * @param {boolean} args.stopHookActive  stop_hook_active from the payload
 * @param {object|null} args.config      parsed .planning/config.json, or null
 * @param {string|null} args.stateContent    .planning/state.md, or null
 * @param {string|null} args.roadmapContent  .planning/roadmap.md, or null
 * @returns {{decision: 'block', reason: string}|null} null = allow the stop
 */
function buildStopDecision({ stopHookActive, config, stateContent, roadmapContent }) {
  if (stopHookActive) return null; // one-shot: never block a post-block stop
  if (!config || typeof config !== 'object') return null;
  const wf = (config.workflow && typeof config.workflow === 'object') ? config.workflow : {};
  if (wf.stop_guard === false) return null; // explicit escape hatch beats every arming signal
  // P-1810: arm on EITHER disk-visible autonomy signal — auto_advance alone
  // was narrower than the trigger it guards and missed a real drop (finding 7).
  const armed = wf.auto_advance === true || config.mode === 'yolo';
  if (!armed) return null;
  if (typeof stateContent !== 'string' || typeof roadmapContent !== 'string') return null;

  // P-1812: inverted condition — allow the stop only when state records a
  // legitimate reason to stop. Unrecognised status phrasings arm the guard.
  if (LEGIT_STOP_RE.test(stateContent)) return null;

  const unticked = roadmapContent.match(UNTICKED_PHASE_RE);
  if (!unticked) return null; // every phase built — nothing to continue

  // Prefer the phase state.md says is next: a COMPLETED phase left unticked
  // (finding 8) would otherwise make the first-unticked line name a phase that
  // is already built. The roadmap match still gates arming; state names the
  // target when it can.
  const stateNext = stateContent.match(READY_STOPPED_AT_RE);
  const nextPhase = (stateNext && stateNext[1]) || unticked[1];
  return {
    decision: 'block',
    reason:
      `PAN auto-advance chain incomplete: autonomy is armed in .planning/config.json, ` +
      `state.md records no failure/gaps/blocker, and roadmap.md still has unbuilt phases ` +
      `(next: Phase ${nextPhase}). Ending the turn here is the P-1801/P-1807 boundary drop. ` +
      `Continue the chain now: if the current phase is finished, follow transition.md's ` +
      `offer_next_phase Route A and spawn Phase ${nextPhase} as a Task subagent ` +
      `(plan-phase orchestrator, ARGUMENTS='${nextPhase} --auto'); if the current phase is ` +
      `mid-flight, resume it instead. If the user explicitly asked to stop, first run: ` +
      `pan-tools config-set workflow.auto_advance false — then stop. ` +
      `(Disable this guard permanently with workflow.stop_guard: false.)`
  };
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      let payload = {};
      try { payload = JSON.parse(input); } catch { /* fail open on bad stdin */ }
      if (!payload || typeof payload !== 'object') payload = {};

      const projectDir = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
      const planningDir = path.join(projectDir, '.planning');

      let config = null;
      try { config = JSON.parse(fs.readFileSync(path.join(planningDir, 'config.json'), 'utf8')); } catch { /* no project / bad config -> allow */ }

      const decision = buildStopDecision({
        stopHookActive: payload.stop_hook_active === true,
        config,
        stateContent: readIfExists(path.join(planningDir, 'state.md')),
        roadmapContent: readIfExists(path.join(planningDir, 'roadmap.md')),
      });

      if (decision) process.stdout.write(JSON.stringify(decision));
    } catch { /* fail open — never break a stop */ }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { buildStopDecision, UNTICKED_PHASE_RE };
