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
const fs = require('fs');
const {
  buildContextWarning,
  compactTrigger,
  roomLeft,
  readClaudeSettings,
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
    assert.match(d.message, /^PAN context note \(from the context-monitor hook, not the user\): this session's context is filling up\./);
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
    assert.match(d.message, /the host will compact this session soon/);
    assert.match(d.message, /\.planning\/state\.md/);
    assert.match(d.message, /\/pan:pause/);
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

describe('pan-context-monitor — no countdown (O7)', () => {
  // Vendor guidance: a visible remaining-context figure makes a model wrap up early
  // and cut corners, and a STOP order after a tool result reads like an injection.
  test('neither note carries a figure, a STOP order, or a request to wrap up', () => {
    for (const remaining of [35, 30, 25, 10, 0]) {
      const d = buildContextWarning(fresh({ remaining_percentage: remaining, used_pct: 94 }), null, NOW);
      assert.equal(d.action, 'emit');
      assert.doesNotMatch(d.message, /\d|%/, `no number at ${remaining}`);
      assert.doesNotMatch(d.message, /STOP/, 'no shouted order');
      assert.doesNotMatch(d.message, /immediately|wrap(ping)? up|exhausted|nearly full/i);
    }
  });

  test('each note asks for the checkpoint, says compaction is safe, and asks for no shortcuts', () => {
    const warning = buildContextWarning(fresh({ remaining_percentage: 30 }), null, NOW).message;
    const critical = buildContextWarning(fresh({ remaining_percentage: 20 }), null, NOW).message;
    for (const m of [warning, critical]) {
      assert.match(m, /\.planning\/state\.md/);
      assert.match(m, /PAN restores the planning state/);
      assert.match(m, /not the user/);
    }
    assert.match(warning, /next natural stopping point/);
    assert.match(warning, /no shortcuts and no skipped verification/);
    assert.match(critical, /Before your next step/);
    assert.match(critical, /finish the task properly rather than quickly/);
  });
});

describe('pan-context-monitor — measured against where the host compacts (O7)', () => {
  test('the compaction point: env, then per-model setting, then the all-model setting, then the default', () => {
    assert.equal(compactTrigger({ modelWindow: 200000 }), 200000, 'a 200K model compacts at its limit');
    assert.equal(compactTrigger({ modelWindow: 1000000 }), 967000, 'a native 1M window compacts at about 967K');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' } }), 500000);
    assert.equal(compactTrigger({ modelWindow: 200000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' } }), 200000, 'capped at the model window');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500k' } }), 967000, 'only a plain integer counts');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '50000' } }), 100000, 'clamped to the 100K minimum');
    const settings = [{ autoCompactWindow: 400000, modelSettings: { 'claude-x': { autoCompactWindow: 300000 } } }, { autoCompactWindow: 800000 }];
    assert.equal(compactTrigger({ modelWindow: 1000000, modelId: 'claude-x', settings }), 300000, 'the per-model window wins in its file');
    assert.equal(compactTrigger({ modelWindow: 1000000, modelId: 'claude-y', settings }), 400000, 'the higher-precedence file wins');
    assert.equal(compactTrigger({ modelWindow: 1000000, settings: [{ autoCompactWindow: 'auto' }, { autoCompactWindow: 800000 }] }), 967000, '"auto" is the tuned default');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } }), 300000);
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { DISABLE_AUTO_COMPACT: '1' } }), null);
    assert.equal(compactTrigger({ modelWindow: 1000000, settings: [{ autoCompactEnabled: false }] }), null);
  });

  test('a session half through its model window but near its compaction point gets the critical note', () => {
    // 1M model, 500K auto-compact window, 400K in context: the model window shows 60%
    // remaining (no warning), but only 20% of the room before compaction is left.
    const metrics = fresh({ remaining_percentage: 60, total_input_tokens: 400000, context_window_size: 1000000, model_id: 'claude-x' });
    const d = buildContextWarning(metrics, null, NOW, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' } });
    assert.equal(d.action, 'emit');
    assert.equal(d.level, 'critical');
    assert.equal(d.basis, 'compact-window');
    assert.equal(buildContextWarning({ ...metrics }, null, NOW, { env: { DISABLE_AUTO_COMPACT: '1' } }).action, 'exit', 'no compaction: the model window applies');
  });

  test('without token counts on the bridge, the model window applies as before', () => {
    assert.deepEqual(roomLeft({ remaining_percentage: 30 }), { remaining: 30, basis: 'model-window' });
  });

  test('settings are read highest precedence first: local, project, user', () => {
    const os = require('os');
    const path = require('path');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ctxset-'));
    try {
      const proj = path.join(base, 'p');
      const home = path.join(base, 'h');
      for (const [d, f, v] of [[proj, 'settings.local.json', 1], [proj, 'settings.json', 2], [home, 'settings.json', 3]]) {
        fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(d, '.claude', f), JSON.stringify({ autoCompactWindow: v * 100000 }));
      }
      assert.deepEqual(readClaudeSettings(proj, home).map((x) => x.autoCompactWindow), [100000, 200000, 300000]);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});
