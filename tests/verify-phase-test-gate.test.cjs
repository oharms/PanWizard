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
 * V2 (2026-10-13) moved the gate into code: `pan-tools test run` detects the command in
 * any language, runs it, and decides passed / failed / skipped from the exit code and the
 * runner's own output (tests/test-gate.test.cjs pins every branch above, on real runner
 * output). What is left in the prose is the contract that the verifier COPIES that
 * decision and never makes its own, and the three statuses with the same narrow rules:
 * a suite that did not run is failed, skipped means there was nothing to run.
 */

'use strict';

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

/** The decision table's rows (header and separator included; callers match on the status cell). */
const tableRows = () => gate.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));

describe('verify-phase test gate — the engine decides, the verifier copies', () => {
  test('the gate runs the suite through pan-tools, not through npm', () => {
    assert.match(gate, /pan-tools\.cjs test run --phase "\$\{phase_number\}"/, 'the step calls the engine for this phase');
    assert.doesNotMatch(gate, /npm test 2>&1|TEST_EXIT=\$\?/, 'the verifier no longer runs npm test and reads the exit code itself');
  });

  test('the status is copied, not judged', () => {
    assert.match(gate, /Copy the status; do not judge it/);
    assert.match(gate, /test_gate: <status>/, 'test_gate is written as the record says');
    assert.match(gate, /disagrees with the record is refused/, 'and the prose says what happens if it is not');
  });
});

describe('verify-phase test gate — the crash branch', () => {
  test('a crashed/unrunnable suite is explicitly scored FAILED', () => {
    const failedRow = tableRows().find((l) => /^\|\s*`failed`/.test(l.trim()));
    assert.ok(failedRow, 'expected a row for failed');
    assert.match(failedRow, /did not run/i, 'the failed row covers a suite that did not run');
    assert.match(failedRow, /gaps_found/, 'and sends the phase to gaps_found');
    assert.match(gate, /did not run is `failed`, never `skipped`/, 'the rule is stated in words');
  });
});

describe('verify-phase test gate — skipped is narrow', () => {
  test('there is exactly ONE route to skipped: nothing to run', () => {
    const skippedRows = tableRows().filter((l) => /^\|\s*`skipped`/.test(l.trim()));
    assert.equal(skippedRows.length, 1);
    assert.match(skippedRows[0], /nothing to run/i);
    assert.match(skippedRows[0], /not_checked/, 'a skipped gate is listed as not checked');
  });
  test('exactly three statuses, each with one row', () => {
    const statuses = tableRows().map((l) => (l.match(/^\|\s*`(\w+)`/) || [])[1]).filter((s) => s && s !== 'status');
    assert.deepEqual(statuses, ['passed', 'failed', 'skipped']);
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
