/**
 * verify-phase's test-suite gate — the branch that decides whether a phase can
 * ship green.
 *
 * ORIGIN. An external run delivered a project and `/pan:verify-phase` passed it.
 * The reported evidence included "the delivered test suite does not run" — and the
 * brief's own note is the sharp version: *"A self-written suite is weak evidence;
 * one that does not run is decisive."*
 *
 * In that particular run the finding turned out to be a measurement artifact (the
 * suite was mid-build and is green in the final workspace). But checking it
 * exposed a REAL hole in the gate, which is why this file exists:
 *
 *   - `TEST_EXIT=$?` was captured and NEVER READ.
 *   - `TEST_CMD` was computed and NEVER USED — step 2 ran `npm test` regardless.
 *   - The decision table had three branches: pass / failures exist / no test
 *     command. A suite that CRASHES fits none of them: it emits no `ℹ fail` line,
 *     so `TEST_FAIL` is EMPTY rather than `0`, and the nearest match an agent finds
 *     is "All tests pass (TEST_FAIL = 0)".
 *
 * So a project whose tests could not execute scored as a PASS — the worst possible
 * direction for a quality gate, and the same dead-gate class this repo has been bitten
 * by twice before (the `verify reconcile` non-zero exit that `output()` swallowed, and
 * the must_haves indent that left the gate dead on every real plan for months).
 *
 * These assertions are on workflow PROSE, which is what the agent executes. They
 * follow the pattern of tests/workflow-auto-chain.test.cjs, which pins gate parity
 * the same way.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', 'pan-wizard-core', 'workflows', 'verify-phase.md');
const text = fs.readFileSync(WORKFLOW, 'utf8');

/** The gate section only — so a stray word elsewhere cannot satisfy these. */
const gate = (() => {
  const start = text.indexOf('Run the project');
  const end = text.indexOf('<step name="establish_must_haves">');
  assert.ok(start > -1 && end > start, 'could not locate the test-gate step');
  return text.slice(start, end);
})();

describe('verify-phase test gate — the crash branch', () => {
  test('the exit code is USED, not merely captured', () => {
    // REGRESSION: TEST_EXIT was assigned and never referenced again, so the one
    // signal that unambiguously says "this did not work" was discarded.
    assert.match(gate, /TEST_EXIT=\$\?/, 'the gate should still capture the exit code');
    const uses = (gate.match(/TEST_EXIT/g) || []).length;
    assert.ok(uses >= 2,
      `TEST_EXIT is captured but never read (${uses} occurrence). Capturing an exit code and ignoring it is how this gate went blind to a suite that cannot run.`);
  });

  test('a crashed/unrunnable suite is explicitly scored FAILED', () => {
    // Scope to TABLE ROWS. Searching the whole section matched my own warning
    // prose about the bug, which would have let the row itself go missing.
    const rows = gate.split('\n').filter((l) => l.trim().startsWith('|'));
    const crashRow = rows.find((l) => /CRASHED|could not run/i.test(l));
    assert.ok(crashRow, 'expected a decision-table ROW for the "suite did not run" case');
    assert.match(crashRow, /failed/i, `the crash row must set failed: ${crashRow.trim().slice(0, 140)}`);
    assert.match(crashRow, /Never `?skipped`?/i,
      'the crash row must forbid skipped explicitly — scoring a crash as skipped was the bug');
  });

  test('EMPTY is distinguished from ZERO', () => {
    // The precise defect: TEST_FAIL is empty (no `ℹ fail` line) when the suite
    // crashes, and "TEST_FAIL = 0" reads as satisfied.
    assert.match(gate, /empty is not zero|Empty is not zero|EMPTY — not `?0`?|EMPTY/i,
      'the gate must warn that an absent failure count is not the same as zero failures');
  });

  test('the pass branch requires a real number AND a clean exit', () => {
    const passRow = gate.split('\n').find((l) => /\|.*continue to must-haves/i.test(l));
    assert.ok(passRow, 'expected a pass row');
    assert.match(passRow, /TEST_EXIT/, `the pass row must gate on the exit code: ${passRow.trim().slice(0, 120)}`);
    assert.match(passRow, /real number|a number/i,
      'the pass row must require a real failure count, not an empty string');
  });
});

describe('verify-phase test gate — skipped is narrow', () => {
  test('detection happens BEFORE running, so a missing script is not a crash', () => {
    // `npm test` with no test script exits non-zero with "Missing script", which is
    // indistinguishable from a crash by exit code alone. The detection must decide
    // first, or the fix above would turn every script-less project into a failure.
    assert.match(gate, /HAS_TEST/, 'detection must produce a usable flag');
    const detectIdx = gate.indexOf('HAS_TEST');
    const runIdx = gate.indexOf('npm test 2>&1');
    assert.ok(detectIdx > -1 && runIdx > -1 && detectIdx < runIdx,
      'the has-tests check must come BEFORE the suite is run');
  });

  test('there is exactly ONE legitimate route to skipped', () => {
    // Count rows that ASSIGN skipped, not rows that merely mention the word — the
    // crash row names it in a prohibition ("Never `skipped`"), and counting that
    // as a route would be exactly backwards.
    const assigns = gate.split('\n')
      .filter((l) => l.trim().startsWith('|') && /skipped/i.test(l))
      .filter((l) => !/never\s+`?skipped`?/i.test(l));
    assert.equal(assigns.length, 1,
      `exactly one row may YIELD skipped; found ${assigns.length}:\n${assigns.join('\n')}`);
    assert.match(assigns[0], /HAS_TEST|no `?test`? script/i,
      'the only skipped route is "there is no test script at all"');
  });

  test('the workflow states why skipped and failed must not be conflated', () => {
    assert.match(gate, /never share a verdict|must never share/i,
      'the distinction between "no tests" and "tests that will not run" must be spelled out');
  });
});

describe('verify-phase test gate — it still blocks', () => {
  test('a failed gate forces gaps_found regardless of goal-backward results', () => {
    // The pre-existing guarantee. If this ever softens, a phase can ship green with
    // a red suite, which is the whole point of having the gate.
    assert.match(text, /If test gate FAILED[\s\S]{0,200}gaps_found/i,
      'a failed test gate must still force overall status to gaps_found');
  });
});
