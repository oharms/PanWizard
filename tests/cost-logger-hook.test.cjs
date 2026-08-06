/**
 * Tests for hooks/pan-cost-logger.js — SubagentStop hook (v3.4+).
 *
 * The hook's pure helpers are importable. Stdin-driven execution is tested
 * indirectly via buildCostRecord inputs that mirror Claude Code's
 * SubagentStop event shape.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildCostRecord, appendRecord, isPanProject, METRICS_DIR, TOKENS_FILE, CURSOR_FILE } =
  require('../hooks/pan-cost-logger.js');
const { createTempProject, cleanup } = require('./helpers.cjs');

const COST_HOOK = path.join(__dirname, '..', 'hooks', 'pan-cost-logger.js');

describe('pan-cost-logger — buildCostRecord', () => {
  test('returns null for non-object input', () => {
    assert.equal(buildCostRecord(null), null);
    assert.equal(buildCostRecord('string'), null);
    assert.equal(buildCostRecord(undefined), null);
  });

  test('returns null when hook_event_name is wrong', () => {
    assert.equal(buildCostRecord({ hook_event_name: 'Stop' }), null);
    assert.equal(buildCostRecord({ hook_event_name: 'PostToolUse' }), null);
  });

  test('accepts SubagentStop or unlabeled event', () => {
    const r1 = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.ok(r1);
    assert.equal(r1.source, 'hook');
    const r2 = buildCostRecord({});
    assert.ok(r2);
  });

  test('extracts agent and session from event', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-planner',
      session_id: 'abc-123',
    });
    assert.equal(r.agent, 'pan-planner');
    assert.equal(r.session, 'abc-123');
  });

  test('fallback to subagent_type when agent_type absent', () => {
    const r = buildCostRecord({ subagent_type: 'pan-verifier' });
    assert.equal(r.agent, 'pan-verifier');
  });

  test('extracts usage.input_tokens and output_tokens', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      usage: { input_tokens: 5000, output_tokens: 200 },
    });
    assert.equal(r.input_tokens, 5000);
    assert.equal(r.output_tokens, 200);
  });

  test('extracts cache usage fields', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      usage: {
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 500,
      },
    });
    assert.equal(r.cache_read_tokens, 8000);
    assert.equal(r.cache_write_tokens, 500);
  });

  test('defaults token fields to 0 when usage missing', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.equal(r.input_tokens, 0);
    assert.equal(r.output_tokens, 0);
    assert.equal(r.cache_read_tokens, 0);
    assert.equal(r.cache_write_tokens, 0);
  });

  test('sets source: "hook" for aggregator to distinguish from caller writes', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.equal(r.source, 'hook');
  });

  test('timestamp is ISO-8601', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('model and phase passed through when present', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      model: 'claude-opus-4-7',
      phase: '07',
    });
    assert.equal(r.model, 'claude-opus-4-7');
    assert.equal(r.phase, '07');
  });
});

describe('pan-cost-logger — appendRecord', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('no-op when record is null', () => {
    assert.equal(appendRecord(tmpDir, null), false);
  });

  test('creates file and directory on first record', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'x' });
    const ok = appendRecord(tmpDir, r);
    assert.equal(ok, true);
    const file = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
    assert.ok(fs.existsSync(file));
  });

  test('appends multiple records as separate lines', () => {
    const r1 = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'a' });
    const r2 = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'b' });
    appendRecord(tmpDir, r1);
    appendRecord(tmpDir, r2);
    const lines = fs.readFileSync(
      path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE),
      'utf-8'
    ).split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });

  test('dedup guard: skips an exact-duplicate of the immediately-preceding row (ignoring ts)', () => {
    const mk = () => buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'dup', session_id: 's1' });
    assert.equal(appendRecord(tmpDir, mk()), true);
    assert.equal(appendRecord(tmpDir, mk()), false, 'a re-fired identical SubagentStop is not double-logged');
    const file = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
    assert.equal(fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).length, 1);
    // a genuinely different record still appends
    assert.equal(appendRecord(tmpDir, buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'other', session_id: 's1' })), true);
    assert.equal(fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).length, 2);
  });

  test('returns false silently on write error (non-blocking)', () => {
    // Point at a path that can't be written: a file where the parent is also a file.
    const badCwd = path.join(tmpDir, '.planning', 'metrics');
    // Create .planning/metrics as a FILE so mkdirSync succeeds on cwd but
    // fails when trying to create .planning/metrics as directory.
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'metrics'), 'not-a-dir');
    const r = buildCostRecord({ hook_event_name: 'SubagentStop' });
    const ok = appendRecord(tmpDir, r);
    assert.equal(ok, false); // write failed, but no throw
  });

  test('records parse as valid JSON', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-executor',
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
    appendRecord(tmpDir, r);
    const line = fs.readFileSync(
      path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE),
      'utf-8'
    ).trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.agent, 'pan-executor');
    assert.equal(parsed.input_tokens, 1000);
    assert.equal(parsed.source, 'hook');
  });
});

describe('pan-cost-logger — M61 re-fired SubagentStop guard', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('a re-fired identical SubagentStop does not append a phantom zero-token row', () => {
    const p = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 5100, output_tokens: 250, cache_read_input_tokens: 9000 } },
    }) + '\n');
    const data = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const file = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);

    // First fire: a real row with the transcript slice's tokens.
    const r1 = buildCostRecord(data, tmpDir);
    assert.equal(r1.input_tokens, 5100);
    assert.equal(appendRecord(tmpDir, r1), true);

    // Re-fire the identical event: the cursor is already past every record, so the
    // slice is empty. The old code appended an all-zero row here (the zeros differ
    // from the real row, defeating the last-row dedup) — that phantom must be gone.
    const r2 = buildCostRecord(data, tmpDir);
    assert.equal(r2.input_tokens, 0, 'empty slice yields zeros');
    assert.equal(r2.__emptySlice, true, 'flagged as a re-fire with no new slice');
    assert.equal(appendRecord(tmpDir, r2), false, 'phantom re-fire row is dropped');

    const rows = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    assert.equal(rows.length, 1, 'ledger still has exactly the one real row');
  });

  test('appendRecord drops any record flagged __emptySlice; the flag is never persisted', () => {
    const r = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'a' });
    Object.defineProperty(r, '__emptySlice', { value: true, enumerable: false });
    assert.equal(appendRecord(tmpDir, r), false);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE)), 'nothing written');
    // A normal record still serializes without the transient flag.
    const ok = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'a' });
    appendRecord(tmpDir, ok);
    const line = fs.readFileSync(path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE), 'utf-8').trim();
    assert.ok(!line.includes('__emptySlice'), 'transient flag never leaks into the ledger');
  });
});

describe('pan-cost-logger — N17 empty-slice: re-fires dropped, siblings + first-fires recorded', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const rows = () => {
    const f = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean) : [];
  };

  test('(1) a dual-fire of the IDENTICAL event yields exactly ONE ledger row (M61 preserved)', () => {
    const p = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 5100, output_tokens: 250 } },
    }) + '\n');
    // The SAME event (same session, agent, transcript, cursor position) firing twice —
    // exactly the dual global+local hook registration case M61 guards.
    const data = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };

    const r1 = buildCostRecord(data, tmpDir);
    assert.equal(r1.input_tokens, 5100);
    assert.equal(appendRecord(tmpDir, r1), true);

    const r2 = buildCostRecord(data, tmpDir);
    assert.equal(r2.__emptySlice, true, 'the identical re-fire is flagged an empty slice');
    assert.equal(appendRecord(tmpDir, r2), false, 'the phantom re-fire row is dropped');

    assert.equal(rows().length, 1, 'exactly one real row survives');
  });

  test('(2) two DISTINCT sibling subagents sharing a transcript yield TWO rows (N17a)', () => {
    // PAN's executor+verifier wave topology: siblings share one session transcript.
    // Sibling A consumes it to EOF and advances the shared per-transcript cursor;
    // sibling B then sees an empty slice but is a DIFFERENT agent, so its spawn must
    // still be recorded (zero tokens), not dropped as a phantom re-fire.
    const p = path.join(tmpDir, 'shared-transcript.jsonl');
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 4200, output_tokens: 180 } },
    }) + '\n');

    const rA = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' }, tmpDir);
    assert.equal(rA.input_tokens, 4200, 'sibling A gets the real slice');
    assert.equal(appendRecord(tmpDir, rA), true);

    const rB = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' }, tmpDir);
    assert.ok(!rB.__emptySlice, 'a parallel sibling is NOT flagged as a phantom re-fire');
    assert.equal(rB.input_tokens, 0, 'the sibling saw an empty slice → zero tokens, but the spawn is counted');
    assert.equal(rB.agent, 'pan-verifier');
    assert.equal(appendRecord(tmpDir, rB), true, 'the sibling row is recorded');

    assert.equal(rows().length, 2, 'both sibling spawns are counted');
  });

  test('(3) a first fire whose transcript is unreadable yields ONE row (N17b)', () => {
    // transcript_path points at a file that does not exist → lineCount=0, since=0.
    // This first fire must still count the spawn (zero tokens), not be dropped.
    const missing = path.join(tmpDir, 'does-not-exist.jsonl');
    const r = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: missing, session_id: 's9' }, tmpDir);
    assert.ok(!r.__emptySlice, 'a first fire with an unreadable transcript is not dropped');
    assert.equal(r.input_tokens, 0);
    assert.equal(r.agent, 'pan-planner');
    assert.equal(appendRecord(tmpDir, r), true, 'the spawn is recorded');

    assert.equal(rows().length, 1);
  });

  test('a re-fire of a RECORDED sibling (same key) is still dropped (dual-registration of the sibling)', () => {
    const p = path.join(tmpDir, 't.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 10 } } }) + '\n');
    // A consumes the slice; B is a sibling recorded at the empty cursor.
    appendRecord(tmpDir, buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'A', transcript_path: p, session_id: 's1' }, tmpDir));
    const rB = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'B', transcript_path: p, session_id: 's1' }, tmpDir);
    assert.equal(appendRecord(tmpDir, rB), true);
    // B's SubagentStop re-fires (dual registration): identical key → must be dropped.
    const rB2 = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'B', transcript_path: p, session_id: 's1' }, tmpDir);
    assert.equal(rB2.__emptySlice, true, 'the sibling re-fire matches the stored key → dropped');
    assert.equal(appendRecord(tmpDir, rB2), false);
    assert.equal(rows().length, 2, 'A + B only — no phantom third row');
  });
});

describe('pan-cost-logger — N25/N26/N27 seen-event signatures (idempotency-marker rework)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const rows = () => {
    const f = path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean) : [];
  };
  const cursorFile = () => path.join(tmpDir, '.planning', METRICS_DIR, CURSOR_FILE);

  test('(N25) interleaved dual registration A, B, A′, B′ yields exactly TWO rows', () => {
    // Dual global+local registration with two parallel siblings finishing
    // near-simultaneously: the four hook firings interleave A, B, A-refire,
    // B-refire. Under the pre-fix SINGLE-SLOT marker, B's record overwrote the
    // key identifying A, so both re-fires slipped past the guard as phantom
    // zero-token rows (and the last-row dedup can't catch them — adjacent rows
    // differ by agent). The bounded seen-signature SET must drop both re-fires.
    const p = path.join(tmpDir, 't.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2001, output_tokens: 30 } } }) + '\n');
    const A = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const B = { hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' };

    assert.equal(appendRecord(tmpDir, buildCostRecord(A, tmpDir)), true, 'A consumes the real slice');
    assert.equal(appendRecord(tmpDir, buildCostRecord(B, tmpDir)), true, 'sibling B is recorded (zero tokens)');

    const a2 = buildCostRecord(A, tmpDir);
    assert.equal(a2.__emptySlice, true, "A′ is still recognized as A's re-fire after B displaced nothing");
    assert.equal(appendRecord(tmpDir, a2), false);

    const b2 = buildCostRecord(B, tmpDir);
    assert.equal(b2.__emptySlice, true, "B′ is recognized as B's re-fire");
    assert.equal(appendRecord(tmpDir, b2), false);

    assert.equal(rows().length, 2, 'exactly A + B — zero phantom rows');
  });

  test('(N26) two parallel siblings of the SAME agent type are both recorded when any payload field differs', () => {
    // A same-type executor wave: session, agent type, and transcript are all
    // shared; the payloads differ only per invocation (here a per-subagent id —
    // the signature hashes the WHOLE payload, so ANY differing field works:
    // agent id, cumulative usage snapshot, per-subagent transcript path).
    // Byte-identical sibling payloads are indistinguishable from re-fires and
    // stay suppressed — that residual case is pinned by test (1) of the N17
    // suite above.
    const p = path.join(tmpDir, 'wave.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 3003, output_tokens: 41 } } }) + '\n');
    const s1 = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: 'exec-1' };
    const s2 = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: 'exec-2' };

    assert.equal(appendRecord(tmpDir, buildCostRecord(s1, tmpDir)), true, 'sibling 1 consumes the slice');

    const r2 = buildCostRecord(s2, tmpDir);
    assert.ok(!r2.__emptySlice, 'a same-type sibling with a distinct payload is NOT conflated with a re-fire');
    assert.equal(r2.input_tokens, 0, 'empty slice → zero tokens, but the spawn is counted');
    assert.equal(appendRecord(tmpDir, r2), true, 'the wave records both spawns');
    assert.equal(rows().length, 2);

    // ...while sibling 2's own byte-identical dual-registration re-fire is dropped.
    const r2refire = buildCostRecord(s2, tmpDir);
    assert.equal(r2refire.__emptySlice, true, "sibling 2's re-fire is dropped");
    assert.equal(appendRecord(tmpDir, r2refire), false);
    assert.equal(rows().length, 2);
  });

  test('(N27) a missing-transcript first fire\'s marker survives the dead-transcript prune; its re-fire is dropped even after an interleaved row', () => {
    const missing = path.join(tmpDir, 'never-written.jsonl');
    const F = { hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: missing, session_id: 's9' };

    assert.equal(appendRecord(tmpDir, buildCostRecord(F, tmpDir)), true, 'first fire counts the spawn');

    // The marker must have been PERSISTED despite the transcript not existing —
    // the pre-fix writeCursor existence-prune erased it inside this very call.
    const persisted = JSON.parse(fs.readFileSync(cursorFile(), 'utf-8'));
    assert.ok(persisted.__seenEvents && Array.isArray(persisted.__seenEvents[missing]) && persisted.__seenEvents[missing].length === 1,
      'the seen-event marker for the missing transcript reached disk');

    // An unrelated record lands in between, so the last-row dedup can no longer
    // catch the re-fire — only the persisted marker can.
    const other = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-researcher', session_id: 's9', usage: { input_tokens: 7, output_tokens: 1 } }, tmpDir);
    assert.equal(appendRecord(tmpDir, other), true);

    const refire = buildCostRecord(F, tmpDir);
    assert.equal(refire.__emptySlice, true, 'the re-fire is recognized from the persisted marker');
    assert.equal(appendRecord(tmpDir, refire), false);
    assert.equal(rows().length, 2, 'first fire + unrelated row only — no phantom');
  });

  test('(L40) marker storage stays bounded: per-transcript signature FIFO and transcript-count cap', () => {
    // Per-transcript bound: one consuming event + many distinct empty-slice siblings.
    const p = path.join(tmpDir, 'bounded.jsonl');
    fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5, output_tokens: 1 } } }) + '\n');
    buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: 'a0' }, tmpDir);
    for (let i = 1; i <= 12; i++) {
      buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: `a${i}` }, tmpDir);
    }
    // Transcript-count bound: markers for many DEAD transcripts (exactly the
    // entries the existence-prune no longer removes) must stay capped too.
    for (let i = 0; i < 24; i++) {
      buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: path.join(tmpDir, `gone-${i}.jsonl`), session_id: 's2' }, tmpDir);
    }
    const persisted = JSON.parse(fs.readFileSync(cursorFile(), 'utf-8'));
    const seen = persisted.__seenEvents || {};
    assert.ok(Object.keys(seen).length <= 16, `at most 16 transcripts tracked (got ${Object.keys(seen).length})`);
    for (const sigs of Object.values(seen)) {
      assert.ok(Array.isArray(sigs) && sigs.length <= 8, 'at most 8 signatures per transcript');
    }
  });
});

describe('pan-cost-logger — M62 PAN-project gate', () => {
  test('isPanProject: true for a .planning/ tree, a local install marker, else false', () => {
    const plan = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-m62-plan-'));
    const inst = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-m62-inst-'));
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-m62-plain-'));
    try {
      fs.mkdirSync(path.join(plan, '.planning'), { recursive: true });
      assert.equal(isPanProject(plan), true, '.planning/ tree marks a PAN project');
      fs.mkdirSync(path.join(inst, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(inst, '.claude', 'pan-file-manifest.json'), '{}');
      assert.equal(isPanProject(inst), true, 'a local install manifest marks a PAN project');
      assert.equal(isPanProject(plain), false, 'a plain repo is not a PAN project');
    } finally {
      for (const d of [plan, inst, plain]) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('the stdin driver no-ops in a non-PAN repo (no .planning/ artifacts created)', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-m62-drv-'));
    try {
      const payload = { hook_event_name: 'SubagentStop', cwd: plain, session_id: 'test-sess', agent_type: 'pan-executor' };
      const res = spawnSync(process.execPath, [COST_HOOK], { input: JSON.stringify(payload), cwd: plain, encoding: 'utf8' });
      assert.equal(res.status, 0, 'hook never blocks the agent loop');
      assert.ok(!fs.existsSync(path.join(plain, '.planning')), 'no .planning/ pollution in a non-PAN repo');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  test('the stdin driver logs normally in a PAN project', () => {
    const proj = createTempProject(); // creates .planning/
    try {
      const payload = { hook_event_name: 'SubagentStop', cwd: proj, session_id: 's', agent_type: 'pan-executor', usage: { input_tokens: 10, output_tokens: 2 } };
      const res = spawnSync(process.execPath, [COST_HOOK], { input: JSON.stringify(payload), cwd: proj, encoding: 'utf8' });
      assert.equal(res.status, 0);
      assert.ok(fs.existsSync(path.join(proj, '.planning', METRICS_DIR, TOKENS_FILE)), 'metrics row written in a PAN project');
    } finally {
      cleanup(proj);
    }
  });
});

describe('pan-cost-logger — integration with cost.cjs aggregator', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('hook records are visible to cost.aggregate()', () => {
    const { aggregate } = require('../pan-wizard-core/bin/lib/cost.cjs');
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-executor',
      model: 'claude-opus-4-7',
      usage: { input_tokens: 2000, output_tokens: 200 },
    });
    appendRecord(tmpDir, r);
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 1);
    assert.equal(agg.totals.input_tokens, 2000);
    assert.equal(agg.by_agent['pan-executor'].calls, 1);
  });

  test('hook records without model still aggregate (cost_unknown bumps)', () => {
    const r = buildCostRecord({
      hook_event_name: 'SubagentStop',
      agent_type: 'pan-unknown',
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    appendRecord(tmpDir, r);
    const { aggregate } = require('../pan-wizard-core/bin/lib/cost.cjs');
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 1);
    assert.equal(agg.totals.cost_unknown, 1);
  });
});
