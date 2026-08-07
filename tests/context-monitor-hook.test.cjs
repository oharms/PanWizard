/**
 * Tests for hooks/pan-context-monitor.js — PostToolUse context warning hook.
 *
 * The threshold / debounce / escalation decision logic (M59) is now the pure
 * exported buildContextWarning(metrics, warnState, nowSeconds); these tests
 * drive it directly, mirroring the SubagentStop-shaped inputs the hook reads
 * from the statusline bridge file.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildContextWarning,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  STALE_SECONDS,
  DEBOUNCE_CALLS,
} = require('../hooks/pan-context-monitor.js');

const NOW = 1000;
const fresh = (over = {}) => ({ remaining_percentage: 30, used_pct: 81, timestamp: NOW, ...over });

describe('pan-context-monitor — no-warning cases', () => {
  test('remaining above WARNING threshold → exit', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: 50 }), null, NOW);
    assert.equal(d.action, 'exit');
  });

  test('exactly at WARNING threshold+1 → exit (strict > guard)', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: WARNING_THRESHOLD + 1 }), null, NOW);
    assert.equal(d.action, 'exit');
  });

  test('non-object / missing metrics → exit', () => {
    assert.equal(buildContextWarning(null, null, NOW).action, 'exit');
    assert.equal(buildContextWarning({}, null, NOW).action, 'exit');
    assert.equal(buildContextWarning('nope', null, NOW).action, 'exit');
  });

  test('non-finite remaining_percentage → exit', () => {
    assert.equal(buildContextWarning({ remaining_percentage: 'x', timestamp: NOW }, null, NOW).action, 'exit');
  });

  test('stale metrics (older than STALE_SECONDS) → exit', () => {
    const d = buildContextWarning(fresh({ timestamp: NOW - (STALE_SECONDS + 1) }), null, NOW);
    assert.equal(d.action, 'exit');
  });

  test('metric exactly at the stale boundary is NOT stale', () => {
    const d = buildContextWarning(fresh({ timestamp: NOW - STALE_SECONDS }), null, NOW);
    assert.notEqual(d.action, 'exit');
  });
});

describe('pan-context-monitor — WARNING threshold', () => {
  test('first warning at <= 35% emits immediately', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: 35 }), null, NOW);
    assert.equal(d.action, 'emit');
    assert.equal(d.level, 'warning');
    assert.match(d.message, /CONTEXT MONITOR WARNING/);
  });

  test('emit resets counter and records level', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: 30 }), null, NOW);
    assert.deepEqual(d.warnState, { callsSinceWarn: 0, lastLevel: 'warning' });
  });
});

describe('pan-context-monitor — CRITICAL threshold', () => {
  test('first warning at <= 25% emits a CRITICAL message', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: 25 }), null, NOW);
    assert.equal(d.action, 'emit');
    assert.equal(d.level, 'critical');
    assert.match(d.message, /CONTEXT MONITOR CRITICAL/);
    assert.match(d.message, /STOP new work immediately/);
  });
});

describe('pan-context-monitor — debounce', () => {
  test('subsequent warning within DEBOUNCE window is suppressed', () => {
    const prior = { callsSinceWarn: 0, lastLevel: 'warning' };
    const d = buildContextWarning(fresh({ remaining_percentage: 30 }), prior, NOW);
    assert.equal(d.action, 'debounce');
    assert.equal(d.warnState.callsSinceWarn, 1);
    assert.equal(d.warnState.lastLevel, 'warning');
  });

  test('debounce counter climbs across calls but never emits until the window elapses', () => {
    let state = { callsSinceWarn: 0, lastLevel: 'warning' };
    for (let i = 1; i < DEBOUNCE_CALLS; i++) {
      const d = buildContextWarning(fresh({ remaining_percentage: 30 }), state, NOW);
      assert.equal(d.action, 'debounce', `call ${i} should debounce`);
      state = d.warnState;
    }
    // The DEBOUNCE_CALLS-th call reaches the window and emits again.
    const emit = buildContextWarning(fresh({ remaining_percentage: 30 }), state, NOW);
    assert.equal(emit.action, 'emit');
    assert.equal(emit.warnState.callsSinceWarn, 0);
  });
});

describe('pan-context-monitor — severity escalation bypasses debounce', () => {
  test('WARNING → CRITICAL emits immediately even inside the debounce window', () => {
    const prior = { callsSinceWarn: 1, lastLevel: 'warning' };
    const d = buildContextWarning(fresh({ remaining_percentage: 20 }), prior, NOW);
    assert.equal(d.action, 'emit');
    assert.equal(d.level, 'critical');
  });

  test('CRITICAL → CRITICAL still debounces (no escalation)', () => {
    const prior = { callsSinceWarn: 1, lastLevel: 'critical' };
    const d = buildContextWarning(fresh({ remaining_percentage: 20 }), prior, NOW);
    assert.equal(d.action, 'debounce');
  });
});

describe('pan-context-monitor — L39 consistent Usage/Remaining figures', () => {
  test('warning message Usage and Remaining sum to 100 (not the 80%-rescaled used_pct)', () => {
    // Bridge carries the statusline-rescaled used_pct=81; the message must NOT
    // use it. At remaining=35, Usage should read 65, not 81.
    const d = buildContextWarning(fresh({ remaining_percentage: 35, used_pct: 81 }), null, NOW);
    assert.match(d.message, /Usage at 65%\. Remaining: 35%\./);
  });

  test('critical message figures also sum to 100', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: 25, used_pct: 94 }), null, NOW);
    assert.match(d.message, /Usage at 75%\. Remaining: 25%\./);
  });

  test('fractional remaining is rounded consistently on both figures', () => {
    const d = buildContextWarning(fresh({ remaining_percentage: 24.6, used_pct: 94 }), null, NOW);
    // rem rounds to 25, used = 75 → still sums to 100
    assert.match(d.message, /Usage at 75%\. Remaining: 25%\./);
  });
});
