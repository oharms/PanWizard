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
  lastContextFromLines,
  contextFromTranscript,
  parseModelId,
  modelWindowFor,
  metricsFromTranscript,
  transcriptForPayload,
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
    assert.equal(compactTrigger({ modelWindow: 200000 }), 167000, 'a 200K model compacts 33K short of its limit');
    assert.equal(compactTrigger({ modelWindow: 1000000 }), 967000, 'a native 1M window compacts at about 967K');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' } }), 467000);
    assert.equal(compactTrigger({ modelWindow: 200000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' } }), 167000, 'capped at the model window');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500k' } }), 967000, 'only a plain integer counts');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '50000' } }), 67000, 'clamped to the 100K minimum');
    const settings = [{ autoCompactWindow: 400000, modelSettings: { 'claude-x': { autoCompactWindow: 300000 } } }, { autoCompactWindow: 800000 }];
    assert.equal(compactTrigger({ modelWindow: 1000000, modelId: 'claude-x', settings }), 267000, 'the per-model window wins in its file');
    assert.equal(compactTrigger({ modelWindow: 1000000, modelId: 'claude-y', settings }), 367000, 'the higher-precedence file wins');
    assert.equal(compactTrigger({ modelWindow: 1000000, settings: [{ autoCompactWindow: 'auto' }, { autoCompactWindow: 800000 }] }), 967000, '"auto" is the tuned default');
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } }), 300000);
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { DISABLE_AUTO_COMPACT: '1' } }), null);
    assert.equal(compactTrigger({ modelWindow: 1000000, settings: [{ autoCompactEnabled: false }] }), null);
  });

  test('the host compacts a fixed margin short of the window, as measured: the 1M default and a 100K window', () => {
    // Docs: a native 1M window compacts at about 967K. Harness context-note-headless,
    // 2026-10-04: with autoCompactWindow 100000 the host compacted after a call that
    // measured 67,032 tokens and not after one that measured 54,371. A margin
    // proportional to the window would have put that compaction near 96.7K.
    assert.equal(compactTrigger({ modelWindow: 1000000 }), 967000);
    const trigger = compactTrigger({ modelWindow: 1000000, settings: [{ autoCompactWindow: 100000 }] });
    assert.ok(trigger > 54371 && trigger <= 67032, `the measured bracket holds the trigger (${trigger})`);
    assert.equal(compactTrigger({ modelWindow: 1000000, env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '99' } }), 967000, 'a percentage above the margin leaves it');
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

// ─── Without the status line: the transcript ─────────────────────────────────
// `claude -p` never runs the status line, so the bridge is missing in headless runs.
// Fixture records are shaped from Claude Code 2.1.288 transcripts captured on
// 2026-10-04 (tests/fixtures/hooks/context-transcript-claude.meta.json).

const path = require('path');
const os = require('os');
const HOOK_FIXTURES = path.join(__dirname, 'fixtures', 'hooks');
const TRANSCRIPTS = JSON.parse(fs.readFileSync(path.join(HOOK_FIXTURES, 'context-transcript-claude.json'), 'utf8'));
const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';
const linesOf = (records) => jsonl(records).split('\n');
const MAIN_USED = 2 + 28519 + 15744; // the captured call: input + cache-read + cache-write

/** The fixture's main-thread records, the assistant record's model and usage set. */
function mainRecords({ model = 'claude-sonnet-5-5', cacheRead = 28519 } = {}) {
  const recs = JSON.parse(JSON.stringify(TRANSCRIPTS.main));
  const a = recs.find((r) => r.type === 'assistant');
  a.message.model = model;
  a.message.usage.cache_read_input_tokens = cacheRead;
  return recs;
}
function withTranscript(records, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ctx-tx-'));
  try {
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, typeof records === 'string' ? records : jsonl(records));
    return fn(file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('pan-context-monitor — the newest call in the transcript', () => {
  test('the newest assistant record\'s input + cache-read + cache-write is the context; output is left out', () => {
    assert.deepEqual(lastContextFromLines(linesOf(mainRecords())), { found: true, used: MAIN_USED, model: 'claude-sonnet-5-5' });
  });

  test('a later assistant record wins over an earlier one', () => {
    const recs = mainRecords();
    const later = JSON.parse(JSON.stringify(recs.find((r) => r.type === 'assistant')));
    later.message.usage.cache_read_input_tokens = 100000;
    assert.equal(lastContextFromLines(linesOf([...recs, later])).used, 2 + 100000 + 15744);
  });

  test('a record with no usage, or a zero one, is passed over', () => {
    const synthetic = { type: 'assistant', isSidechain: false, message: { model: '<synthetic>', role: 'assistant', content: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
    const bare = { type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [] } };
    assert.equal(lastContextFromLines(linesOf([...mainRecords(), synthetic, bare])).used, MAIN_USED);
  });

  test('in the main transcript a sidechain record is not the session\'s context; in a subagent\'s own file it is', () => {
    const side = JSON.parse(JSON.stringify(TRANSCRIPTS.agent[1]));
    assert.equal(lastContextFromLines(linesOf([...mainRecords(), side])).used, MAIN_USED);
    assert.equal(lastContextFromLines(linesOf(TRANSCRIPTS.agent), { skipSidechain: false }).used, 2 + 34105);
    assert.deepEqual(lastContextFromLines(linesOf(TRANSCRIPTS.agent)), { found: false });
  });

  test('a compaction boundary after the newest call means nothing has measured the context yet', () => {
    assert.deepEqual(lastContextFromLines(linesOf([...mainRecords(), TRANSCRIPTS.compact_boundary])), { found: false, compacted: true });
    const next = mainRecords().filter((r) => r.type === 'assistant');
    assert.equal(lastContextFromLines(linesOf([...mainRecords(), TRANSCRIPTS.compact_boundary, ...next])).found, true, 'the first call after compaction measures again');
  });

  test('lines with no assistant record, and torn lines, find nothing', () => {
    assert.deepEqual(lastContextFromLines(['', '{"type":"assistant"', 'not json', JSON.stringify(TRANSCRIPTS.main[0])]), { found: false });
  });
});

describe('pan-context-monitor — reading the transcript file', () => {
  test('reads further back when a large tool result hides the newest assistant record, but never past the cap', () => {
    const big = { type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(20000) }] } };
    withTranscript([...mainRecords(), big], (file) => {
      assert.equal(contextFromTranscript(file, { tailBytes: 1024, maxBytes: 1024 * 1024 }).used, MAIN_USED);
      assert.equal(contextFromTranscript(file, { tailBytes: 1024, maxBytes: 4096 }), null);
    });
  });

  test('a tail that starts inside a record drops the partial line and widens until the record is whole', () => {
    const recs = mainRecords();
    const tailOfLast = jsonl([recs[recs.length - 1]]).length;
    withTranscript(recs, (file) => {
      assert.equal(contextFromTranscript(file, { tailBytes: tailOfLast + 200, maxBytes: fs.statSync(file).size }).used, MAIN_USED);
    });
  });

  test('a compaction boundary stops the search: no older call is reported as the current context', () => {
    const big = { type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(5000) }] } };
    withTranscript([...mainRecords(), TRANSCRIPTS.compact_boundary, big], (file) => {
      assert.equal(contextFromTranscript(file, { tailBytes: 512 }), null);
    });
  });

  test('a missing transcript or a bad path is null, never a throw', () => {
    assert.equal(contextFromTranscript(path.join(os.tmpdir(), `pan-no-such-transcript-${process.pid}.jsonl`)), null);
    assert.equal(contextFromTranscript(undefined), null);
    assert.equal(contextFromTranscript(os.tmpdir()), null, 'a directory is not a transcript');
  });
});

describe('pan-context-monitor — the model window from the model id (code.claude.com/docs/en/model-config, read 2026-10-04)', () => {
  test('native 1M on the Anthropic API: Fable 5.x, Sonnet 5 and later, Opus 4.7 and later', () => {
    for (const id of ['claude-fable-5-1', 'claude-fable-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5-5']) {
      assert.equal(modelWindowFor(id), 1000000, id);
    }
  });

  test('200K: Haiku, Opus 4.6 and Sonnet 4.6 and older, and the 3.x models', () => {
    for (const id of ['claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514', 'claude-opus-4-1-20250805', 'claude-3-5-sonnet-20241022']) {
      assert.equal(modelWindowFor(id), 200000, id);
    }
    assert.equal(parseModelId('claude-sonnet-4-20250514').minor, 0, 'a date suffix is not a minor version');
  });

  test('a configured [1m] variant opens 1M for the models that need it, and never for Haiku', () => {
    assert.equal(modelWindowFor('claude-opus-4-6', { settings: [{ model: 'opus[1m]' }] }), 1000000);
    assert.equal(modelWindowFor('claude-sonnet-4-6', { env: { ANTHROPIC_MODEL: 'claude-sonnet-4-6[1m]' } }), 1000000);
    assert.equal(modelWindowFor('claude-haiku-4-5', { settings: [{ model: 'sonnet[1m]' }] }), 200000);
  });

  test('CLAUDE_CODE_DISABLE_1M_CONTEXT=1 holds every model to 200K', () => {
    assert.equal(modelWindowFor('claude-opus-5-5', { env: { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' } }), 200000);
  });

  test('on a third-party provider a native-1M model\'s window is unknown; a 200K model is 200K anywhere', () => {
    assert.equal(modelWindowFor('claude-opus-5-5', { env: { CLAUDE_CODE_USE_BEDROCK: '1' } }), null);
    assert.equal(modelWindowFor('us.anthropic.claude-opus-4-7-v1:0'), null);
    assert.equal(modelWindowFor('claude-opus-4-7@20260101'), null);
    assert.equal(modelWindowFor('us.anthropic.claude-haiku-4-5-v1:0'), 200000);
  });

  test('a context already past 200K can only be a 1M window; an unknown model is null', () => {
    assert.equal(modelWindowFor('us.anthropic.claude-opus-4-7-v1:0', { used: 250000 }), 1000000);
    assert.equal(modelWindowFor('gpt-5'), null);
    assert.equal(modelWindowFor(null), null);
  });
});

describe('pan-context-monitor — metrics from the transcript, and the note they lead to', () => {
  test('the bridge\'s shape: tokens in context, the window, the model, and the model-window share', () => {
    withTranscript(mainRecords(), (file) => assert.deepEqual(metricsFromTranscript(file), {
      total_input_tokens: MAIN_USED,
      context_window_size: 1000000,
      model_id: 'claude-sonnet-5-5',
      remaining_percentage: 100 - (MAIN_USED / 1000000) * 100,
      source: 'transcript',
    }));
  });

  test('a 1M session is measured against the ~967K compaction point', () => {
    const decide = (cacheRead) => withTranscript(mainRecords({ cacheRead }), (file) => buildContextWarning(metricsFromTranscript(file), null, NOW, { env: {}, settings: [] }));
    assert.equal(decide(300000).action, 'exit', 'about 66% left: no note');
    const warn = decide(700000 - 15746);
    assert.deepEqual([warn.action, warn.level, warn.basis], ['emit', 'warning', 'compact-window'], '700K of 967K: about 28% left');
    assert.equal(decide(760000 - 15746).level, 'critical', '760K of 967K: about 21% left');
  });

  test('the compaction window settings apply as they do with the bridge', () => {
    const decide = (used) => withTranscript(mainRecords({ cacheRead: used - 15746 }), (file) =>
      buildContextWarning(metricsFromTranscript(file, { env: {} }), null, NOW, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' }, settings: [] }));
    assert.equal(decide(40000).action, 'exit', '40K against a 100K window compacting at 67K: 40% left');
    assert.deepEqual([decide(45000).action, decide(45000).level], ['emit', 'warning'], '45K: about 33% left');
    assert.equal(decide(54371).level, 'critical', 'the measured call one before the compaction: about 19% left');
  });

  test('a window that cannot be known says nothing rather than guess', () => {
    withTranscript(mainRecords({ model: 'gpt-5' }), (file) => assert.equal(metricsFromTranscript(file), null));
    withTranscript(mainRecords({ model: 'claude-opus-5-5' }), (file) => assert.equal(metricsFromTranscript(file, { env: { CLAUDE_CODE_USE_VERTEX: '1' } }), null));
  });
});

describe('pan-context-monitor — which transcript measures the call', () => {
  const fill = (name, map) => JSON.parse(fs.readFileSync(path.join(HOOK_FIXTURES, name), 'utf8')
    .replace(/\{\{[A-Z_]+\}\}/g, (m) => JSON.stringify(map[m] || m).slice(1, -1)));
  const dir = path.join(os.tmpdir(), 'pan-ctx-payload');
  const map = { '{{SESSION_ID}}': 'sess-0001', '{{TRANSCRIPT_PATH}}': path.join(dir, 'sess-0001.jsonl'), '{{PROJECT_DIR}}': dir, '{{SCRATCHPAD_DIR}}': dir, '{{AGENT_ID}}': 'a22d4bd17ed377380' };

  test('a main-thread call is measured against the transcript the payload names', () => {
    assert.deepEqual(transcriptForPayload(fill('post-tool-use-claude.json', map)), { file: map['{{TRANSCRIPT_PATH}}'], subagent: false });
  });

  test('a subagent\'s call names the MAIN transcript; its own file is derived from the session and agent ids', () => {
    const payload = fill('post-tool-use-subagent-claude.json', map);
    assert.equal(payload.transcript_path, map['{{TRANSCRIPT_PATH}}'], 'the captured shape: the main file even inside a subagent');
    assert.deepEqual(transcriptForPayload(payload), { file: path.join(dir, 'sess-0001', 'subagents', 'agent-a22d4bd17ed377380.jsonl'), subagent: true });
    assert.deepEqual(transcriptForPayload({ ...payload, agent_transcript_path: '/elsewhere/agent.jsonl' }), { file: '/elsewhere/agent.jsonl', subagent: true }, 'a host that sends the path wins');
  });

  test('a Workflow-tool subagent is found one level down, under the run that spawned it', () => {
    // PAN's native workflow scripts spawn through the Workflow tool, whose agents are
    // written to subagents/workflows/<run>/ (pan-cost-logger.js resolveAgentTranscript).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ctx-wf-'));
    try {
      const nested = path.join(root, 'sess-0001', 'subagents', 'workflows', 'wf_0001', 'agent-a22d4bd17ed377380.jsonl');
      fs.mkdirSync(path.dirname(nested), { recursive: true });
      fs.writeFileSync(nested, '\n');
      const payload = fill('post-tool-use-subagent-claude.json', { ...map, '{{TRANSCRIPT_PATH}}': path.join(root, 'sess-0001.jsonl') });
      assert.deepEqual(transcriptForPayload(payload), { file: nested, subagent: true });
      const direct = path.join(root, 'sess-0001', 'subagents', 'agent-a22d4bd17ed377380.jsonl');
      fs.writeFileSync(direct, '\n');
      assert.deepEqual(transcriptForPayload(payload), { file: direct, subagent: true }, 'the direct file wins when both exist');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('ids that are not safe in a path measure nothing', () => {
    const payload = fill('post-tool-use-subagent-claude.json', map);
    assert.equal(transcriptForPayload({ ...payload, agent_id: '../../etc' }), null);
    assert.equal(transcriptForPayload({ ...payload, session_id: '../sess' }), null);
    assert.equal(transcriptForPayload({ ...payload, agent_id: 42 }), null);
    assert.equal(transcriptForPayload({ session_id: 'sess-0001' }), null, 'no transcript at all');
  });
});
