/**
 * PAN Tools Tests — auto-advance chain gate parity (P-1807)
 *
 * The autonomous chain (discuss-phase → plan-phase → exec-phase → transition →
 * next phase) hops across four workflow files, and each hop decides "continue
 * without a human?" on its own. PanLoop finding 0 (2026-08-07) was a gate-parity
 * bug: exec-phase.md triggered auto-advance on `--auto` OR `workflow.auto_advance`,
 * then handed off to transition.md whose continuation branch was gated on
 * `mode: yolo` alone — a condition the template default (`mode: interactive`)
 * never satisfies. transition.md read neither the flag nor the config key, so an
 * autonomous run updated state to the next phase, printed the interactive menu,
 * and exited cleanly: exactly one phase built, success reported.
 *
 * The gates are workflow prose an LLM executes, so behavior cannot be pinned
 * here. What CAN be pinned — and what actually drifted — is the set of inputs
 * each gate reads. These tests assert the canonical trigger tokens exist in each
 * hop, and that no continuation gate in transition.md keys on `mode` alone.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOWS = path.join(__dirname, '..', 'pan-wizard-core', 'workflows');
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf-8');

// Every hop in the autonomous chain must read the same trigger: the --auto
// flag and the workflow.auto_advance config key.
const CHAIN = ['discuss-phase.md', 'plan-phase.md', 'exec-phase.md', 'transition.md'];

describe('auto-advance chain gate parity (P-1807)', () => {
  for (const file of CHAIN) {
    test(`${file} reads workflow.auto_advance to decide continuation`, () => {
      // REVERT CHECK: before P-1807, transition.md had only a config-SET of
      // this key (Route B clears it) and never a read — the gate that decides
      // whether the chain continues never consulted the chain's own trigger.
      assert.match(
        read(file),
        /config-get workflow\.auto_advance/,
        `${file} must read workflow.auto_advance (config-get) in its auto gate; ` +
        'gating continuation on config mode alone is the P-1807 regression'
      );
    });
  }

  test('transition.md parses the --auto flag exec-phase passes through', () => {
    // exec-phase.md's offer_next step hands off "passing through the --auto
    // flag". Before P-1807 nothing on the receiving side ever parsed it — the
    // only occurrences of --auto in transition.md sat inside the Task prompts
    // it composes for the NEXT phase.
    assert.match(
      read('transition.md'),
      /grep -c -- '--auto'/,
      'transition.md must detect the pass-through --auto flag (HAS_AUTO_FLAG)'
    );
  });

  test('no transition.md gate keys on mode: yolo alone', () => {
    // The three <if> gates (auto-approve, Route A continuation, Route B
    // milestone) must key on the composite AUTO condition (--auto flag, or
    // workflow.auto_advance, or mode yolo). A bare mode gate silently
    // dead-ends --auto runs on interactive-mode projects, which is the
    // template default.
    const content = read('transition.md');
    assert.doesNotMatch(
      content,
      /<if mode="yolo">/,
      'transition.md continuation gates must use the composite AUTO condition ' +
      '(HAS_AUTO_FLAG / AUTO_CFG / mode yolo), never mode alone — PanLoop finding 0'
    );
  });

  test('exec-phase.md still passes the flag through at the handoff', () => {
    assert.match(
      read('exec-phase.md'),
      /passing through the `--auto` flag/,
      'exec-phase.md must propagate --auto into the inline transition'
    );
  });

  test('transition.md states the AUTO terminal contract at the decision step', () => {
    // REVERT CHECK: field re-run 2026-08-08 — with the gate-parity fix alone,
    // 4 of 5 autonomous builds still ended between the state update and the
    // spawn. The contract names the only two valid AUTO endings at the exact
    // step where the drop happens.
    assert.match(
      read('transition.md'),
      /AUTO-mode terminal contract \(P-1807\)/,
      'offer_next_phase must state the two valid AUTO endings (Task issued / milestone boundary)'
    );
  });

  test('exec-phase.md self-checks that the transition actually spawned', () => {
    // Second chance at the caller: the orchestrator executing exec-phase's own
    // step list verifies the inline transition ended in a spawn or a milestone,
    // and is told to go issue the spawn if it did not.
    assert.match(
      read('exec-phase.md'),
      /Post-transition self-check/,
      'exec-phase must verify a Task spawn (or milestone boundary) happened after the inline transition'
    );
  });

  for (const file of ['discuss-phase.md', 'plan-phase.md', 'exec-phase.md']) {
    test(`${file} persists the --auto flag into config (P-1810)`, () => {
      // REVERT CHECK — PanLoop finding 7: the --auto flag lives only in one
      // invocation's arguments. Anything that reads the disk — later hops
      // after a context restart, and above all the P-1809 stop guard — sees a
      // flag-driven run as NOT autonomous unless an entry hop persists the
      // flag. discuss-phase always did; the other two hops must match it.
      assert.match(
        read(file),
        /config-set workflow\.auto_advance true/,
        `${file} must persist --auto via config-set so the run is autonomous on disk`
      );
    });
  }
});
