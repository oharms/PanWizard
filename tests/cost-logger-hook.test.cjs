/**
 * Tests for hooks/pan-cost-logger.js — SubagentStop hook (v3.4+).
 *
 * The hook's pure helpers are importable. Stdin-driven execution is tested
 * indirectly via buildCostRecord inputs that mirror Claude Code's
 * SubagentStop event shape.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildCostRecord, appendRecord, isPanProject, hasPlanningTree, readCommandFromTranscript, readUsageFromTranscript, isSessionStale, PAN_RUNTIME_DIRS, METRICS_DIR, TOKENS_FILE, CURSOR_FILE } =
  require('../hooks/pan-cost-logger.js');
const { createTempProject, cleanup, installInto } = require('./helpers.cjs');

const COST_HOOK = path.join(__dirname, '..', 'hooks', 'pan-cost-logger.js');


// ── Telemetry fills a planning tree; it never creates one ────────────────────
// isPanProject also accepts a bare install marker, which is right for "is PAN here"
// and wrong as a licence to write: a global-install hook fires in every repo the user
// opens, and five of the fourteen projects swept on 2026-09-17 carried a .planning/
// tree no /pan command ever created, which then read as a half-built project to
// `validate health` and `hygiene scan`.
describe('pan-cost-logger — never scaffolds a planning tree', () => {
  let bare;
  beforeEach(() => { bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-notree-')); });
  afterEach(() => { fs.rmSync(bare, { recursive: true, force: true }); });

  const fire = () => spawnSync(process.execPath, [COST_HOOK], {
    cwd: bare, input: JSON.stringify({ hook_event_name: 'SubagentStop', cwd: bare, agent_id: 'a1', session_id: 's1', usage: { input_tokens: 10, output_tokens: 5 } }), encoding: 'utf-8',
  });

  test('an install marker alone buys no write: no .planning/, and the gate says why', () => {
    fs.mkdirSync(path.join(bare, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(bare, '.claude', 'pan-file-manifest.json'), '{}');
    assert.equal(isPanProject(bare), true, 'the marker still answers "is PAN installed here"');
    assert.equal(hasPlanningTree(bare), false, 'but it is not a licence to write');

    const r = fire();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(bare, '.planning')), false, 'the hook must not scaffold a tree');
  });

  test('a plain repo with no PAN trace at all is untouched', () => {
    const r = fire();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(bare, '.planning')), false);
  });

  test('once a /pan command has created the tree, the hook writes into it as before', () => {
    fs.mkdirSync(path.join(bare, '.planning'), { recursive: true });
    const r = fire();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(bare, '.planning', METRICS_DIR, TOKENS_FILE)), true, 'the artifact lands in the existing tree');
  });
});


// ── Command attribution from the parent transcript ───────────────────────────
// `command` used to come only from the optimizer's trace session, which is off by
// default, so outside focus mode every field row carried `command: null` and "which
// command got expensive" could not be answered from PAN's own telemetry (sweep
// 2026-09-17). A runtime records a slash-command invocation as a typed user turn.
describe('pan-cost-logger — a dead trace session backfills nothing', () => {
  // readActiveSessionMeta used to trust the `current-session` pointer at any age. A field
  // project still pointed at a session started on 17 July when it was swept on
  // 17 September, so every ledger row written in between inherited that session's command
  // and phase — which is also why command attribution looked like a focus-mode-only
  // feature (sweep 2026-09-17).
  let tree;
  beforeEach(() => { tree = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-stalesess-')); fs.mkdirSync(path.join(tree, '.planning'), { recursive: true }); });
  afterEach(() => { fs.rmSync(tree, { recursive: true, force: true }); });

  const writeSession = (sid, meta) => {
    const dir = path.join(tree, '.planning', 'optimization', 'traces', sid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ session_id: sid, ...meta }, null, 2) + '\n');
    fs.writeFileSync(path.join(tree, '.planning', 'optimization', 'current-session'), sid + '\n');
    return dir;
  };
  const transcriptNaming = (command) => {
    const f = path.join(tree, 'parent.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'user', timestamp: '2026-09-17T10:00:00.000Z', message: { role: 'user', content: `<command-name>${command}</command-name>` } }) + '\n');
    return f;
  };
  const rowFor = (transcript) => {
    const payload = { hook_event_name: 'SubagentStop', cwd: tree, transcript_path: transcript, session_id: 's1', usage: { input_tokens: 10, output_tokens: 5 } };
    const r = spawnSync(process.execPath, [COST_HOOK], { cwd: tree, input: JSON.stringify(payload), encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    const rows = fs.readFileSync(path.join(tree, '.planning', METRICS_DIR, TOKENS_FILE), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    return rows[rows.length - 1];
  };

  test('a two-month-old pointer supplies nothing, and the transcript names the command instead', () => {
    const sid = 'sess_20260717T143520';
    const dir = writeSession(sid, { started_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), command: 'army', phase: '03-legacy', ended_at: null });
    assert.equal(isSessionStale(dir, JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8'))), true);

    const row = rowFor(transcriptNaming('/pan:exec-phase'));
    assert.equal(row.command, 'exec-phase', 'the live transcript decides, not the dead session');
    assert.notEqual(row.phase, '03-legacy', 'nor does the dead session set the phase');
  });

  test('a session active now still supplies its command', () => {
    writeSession('sess_auto_today', { started_at: new Date().toISOString(), command: 'optimize', phase: '05-tuning', ended_at: null });
    const row = rowFor(transcriptNaming('/pan:exec-phase'));
    assert.equal(row.command, 'optimize', 'a live trace session is the better source');
    assert.equal(row.phase, '05-tuning');
  });

  test('a session that has ended is not active, however recent', () => {
    writeSession('sess_done', { started_at: new Date().toISOString(), command: 'army', ended_at: new Date().toISOString() });
    assert.equal(rowFor(transcriptNaming('/pan:verify-phase')).command, 'verify-phase');
  });
});

describe('pan-cost-logger — readCommandFromTranscript', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-cmd-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const jsonl = (...records) => {
    const f = path.join(dir, 'session.jsonl');
    fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return f;
  };
  const typed = (text) => ({ type: 'user', timestamp: '2026-09-17T10:00:00.000Z', message: { role: 'user', content: text } });
  const cmd = (name) => typed(`<command-message>running</command-message>\n<command-name>${name}</command-name>`);
  const toolResult = (text) => ({
    type: 'user', timestamp: '2026-09-17T10:00:01.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: text }] },
  });

  test('names the PAN command from a typed invocation, in either runtime spelling', () => {
    assert.equal(readCommandFromTranscript(jsonl(cmd('/pan:exec-phase'))), 'exec-phase');
    assert.equal(readCommandFromTranscript(jsonl(cmd('/pan-exec-phase'))), 'exec-phase', 'Codex/OpenCode/Copilot spelling');
    assert.equal(readCommandFromTranscript(jsonl(cmd('pan:map-codebase'))), 'map-codebase', 'no leading slash');
  });

  test('the most recent invocation wins', () => {
    assert.equal(readCommandFromTranscript(jsonl(cmd('/pan:plan-phase'), cmd('/pan:exec-phase'))), 'exec-phase');
  });

  test('a plain typed turn after the command does not erase the attribution', () => {
    // A mid-run "continue", or an injected reminder, arrives as a typed user turn with
    // no command of its own. The agent is still doing the command's work.
    const f = jsonl(cmd('/pan:exec-phase'), typed('continue'), toolResult('ok'));
    assert.equal(readCommandFromTranscript(f), 'exec-phase');
  });

  test('a command quoted inside tool output is not an invocation', () => {
    // Regression: a session that had grepped another project's transcripts carried the
    // literal tag in a Bash tool_result and reported that project's command as its own.
    const quoted = toolResult('grep output: <command-name>/pan:army</command-name>');
    assert.equal(readCommandFromTranscript(jsonl(quoted)), null);
    assert.equal(readCommandFromTranscript(jsonl(cmd('/pan:update'), quoted)), 'update',
      'a real invocation is still found past the quoted one');
  });

  test('a host UI command and a non-PAN command are never attributed', () => {
    assert.equal(readCommandFromTranscript(jsonl(cmd('/model'), cmd('/compact'))), null);
    assert.equal(readCommandFromTranscript(jsonl(cmd('/execplan'))), null, 'a dev skill is not a PAN command');
    assert.equal(readCommandFromTranscript(jsonl(typed('just a prompt'))), null);
  });

  test('an unreadable path, a missing file and a non-string never throw', () => {
    assert.equal(readCommandFromTranscript(path.join(dir, 'nope.jsonl')), null);
    assert.equal(readCommandFromTranscript(null), null);
    assert.equal(readCommandFromTranscript(''), null);
    assert.equal(readCommandFromTranscript(dir), null, 'a directory is not a transcript');
    fs.writeFileSync(path.join(dir, 'empty.jsonl'), '');
    assert.equal(readCommandFromTranscript(path.join(dir, 'empty.jsonl')), null);
  });

  test('malformed lines are skipped, not fatal', () => {
    const f = path.join(dir, 'mixed.jsonl');
    fs.writeFileSync(f, ['{not json', JSON.stringify(cmd('/pan:focus')), '}{'].join('\n') + '\n');
    assert.equal(readCommandFromTranscript(f), 'focus');
  });

  test('an invocation beyond the tail window is out of scope, and the truncated first record is not misread', () => {
    const f = path.join(dir, 'big.jsonl');
    const filler = JSON.stringify(toolResult('x'.repeat(4000)));
    const lines = [JSON.stringify(cmd('/pan:army'))];
    for (let i = 0; i < 120; i++) lines.push(filler); // ~480 KB, well past COMMAND_TAIL_BYTES
    fs.writeFileSync(f, lines.join('\n') + '\n');
    assert.equal(readCommandFromTranscript(f), null, 'recency window is bounded on purpose');
  });

  test('the record lands on the row: a stop in a project whose transcript names a PAN command is attributed', () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-cmdproj-'));
    try {
      fs.mkdirSync(path.join(tree, '.planning'), { recursive: true });
      const transcript = jsonl(cmd('/pan:exec-phase'));
      const payload = {
        hook_event_name: 'SubagentStop', cwd: tree, transcript_path: transcript,
        session_id: 's1', usage: { input_tokens: 10, output_tokens: 5 },
      };
      const r = spawnSync(process.execPath, [COST_HOOK], { cwd: tree, input: JSON.stringify(payload), encoding: 'utf-8' });
      assert.equal(r.status, 0, r.stderr);
      const rows = fs.readFileSync(path.join(tree, '.planning', METRICS_DIR, TOKENS_FILE), 'utf-8')
        .trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].command, 'exec-phase');
    } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  });
});


// ── The runtime list must survive the installer's templating ────────────────
// The installer templates a hook by rewriting the string `'.claude'`, with a
// documented catch-all for unanchored occurrences. That rewrote PAN_RUNTIME_DIRS too:
// a Codex install shipped ['.codex', '.codex', '.gemini', '.opencode', '.github'] —
// `.claude` gone, the target duplicated — so isPanProject in four of the five installed
// copies stopped recognising a project carrying only a `.claude/` local install
// (measured against a real 5-runtime install, 2026-09-17). The list is runtime-AGNOSTIC
// and the assertion is about the INSTALLED copy, because the source was always right.
describe('pan-cost-logger — the installed copy still knows every runtime', () => {
  let target;
  before(() => { target = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rdirs-')); installInto(target, ['--codex', '--local']); });
  after(() => { fs.rmSync(target, { recursive: true, force: true }); });

  test('a non-Claude install lists all five config dirs, once each', () => {
    const installed = require(path.join(target, '.codex', 'hooks', 'pan-cost-logger.js'));
    const dirs = installed.PAN_RUNTIME_DIRS;
    assert.ok(Array.isArray(dirs), 'the installed hook must still export the runtime list');
    assert.deepEqual([...dirs].sort(), ['.claude', '.codex', '.gemini', '.github', '.opencode'],
      `the installer corrupted the runtime list: ${JSON.stringify(dirs)}`);
    assert.equal(new Set(dirs).size, dirs.length, `a duplicated entry means a rewrite hit the list: ${JSON.stringify(dirs)}`);
  });

  test('so a Codex install still recognises a project that carries only a .claude/ install', () => {
    const installed = require(path.join(target, '.codex', 'hooks', 'pan-cost-logger.js'));
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rdirs-probe-'));
    try {
      fs.mkdirSync(path.join(probe, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(probe, '.claude', 'pan-file-manifest.json'), '{}');
      assert.equal(installed.isPanProject(probe), true, 'a .claude-only project is still a PAN project');
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
  });
});

describe('pan-cost-logger — the transcript session filter reads the field Claude Code writes', () => {
  // The guard read `entry.session_id`; real records name it `sessionId` — 199 of 200 in a
  // local transcript carried the camelCase spelling and none the snake_case one (measured
  // 2026-09-17), so the scoping it claimed to do never happened. Harmless on the per-agent
  // path, where every record in the file belongs to the one agent, but the parent-slice
  // fallback was summing a sibling session's records too. Both spellings are accepted now.
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-sesskey-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const rec = (key, session, out) => JSON.stringify({
    type: 'assistant', [key]: session, timestamp: '2026-09-17T10:00:00.000Z',
    message: { id: `m-${session}-${out}`, model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: out } },
  });
  const write = (...records) => {
    const f = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(f, records.join('\n') + '\n');
    return f;
  };

  test('scopes to the given session, and sums everything when none is given', () => {
    const f = write(rec('sessionId', 'mine', 100), rec('sessionId', 'other', 900));
    assert.equal(readUsageFromTranscript(f, 'mine', 0).output_tokens, 100,
      'a sibling session\'s records must not be attributed to this one');
    assert.equal(readUsageFromTranscript(f, null, 0).output_tokens, 1000,
      'with no session to scope to, every record still counts');
  });

  test('the snake_case spelling keeps working, in case a host writes it', () => {
    const f = write(rec('session_id', 'mine', 100), rec('session_id', 'other', 900));
    assert.equal(readUsageFromTranscript(f, 'mine', 0).output_tokens, 100);
  });

  test('a record naming no session is counted, not dropped', () => {
    // The file is the session's own transcript, so an unlabelled record belongs to it.
    const bare = JSON.stringify({ type: 'assistant', timestamp: '2026-09-17T10:00:00.000Z', message: { id: 'm-bare', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 7 } } });
    const f = write(rec('sessionId', 'mine', 100), bare);
    assert.equal(readUsageFromTranscript(f, 'mine', 0).output_tokens, 107);
  });
});

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

// A1/N26 + A2/N29. The marker layer (N25-N27, above) decides whether an event is
// ADMITTED; this suite pins what the LEDGER ends up holding, which is where the
// defect lived: the per-invocation discriminator was hashed into the seen-event
// signature but never written into the row, so two admitted same-type siblings
// produced rows that were byte-identical modulo `ts` and the pre-existing identity
// dedup ate the second. Reproduced before the fix: a 3-sibling same-type wave
// wrote 2 rows.
//
// Each case names the assertion that fails if the `event_sig` row field is
// reverted, so a future reader can tell the six cases apart — several of them are
// distinguished only by which layer does the suppressing.
//
// WHAT `agent_id` IS IN CASES (3) AND (4): a stand-in for "some per-invocation
// field", not a field PAN has observed. Nothing in this repo establishes that a
// real SubagentStop payload carries `agent_id` or any other per-invocation
// identifier — `grep -rn agent_id hooks/ pan-wizard-core/ docs/` finds only PAN's
// own agent-tracking artifacts (written by workflows, not by the host) plus these
// tests. What the repo HAS observed, from the trace rows recorded under
// experiments/*/.planning/optimization/traces/ (written by the sibling hook from
// real payloads) and from docs/FIELD-REPORT-army-2026-06.md:
//   • `agent_type`/`subagent_type` is supplied, and varies between DIFFERENT-type
//     siblings — which is what makes case (2) real and unconditional;
//   • `session_id` is SHARED with the parent, and so is the session transcript;
//   • `model` and `phase` came out null (the payload carried neither), and
//     `usage` is absent entirely in headless mode.
// So NO payload field is confirmed to vary between two CONCURRENT SAME-TYPE
// siblings on any host. Cases (3) and (4) therefore pin a CONDITIONAL benefit:
// what the ledger holds when the host does supply some per-invocation field.
// Where it supplies none, the two payloads are the same bytes and the second
// sibling stays suppressed by design — the residual pinned by case (1) of the N17
// suite above.
describe('pan-cost-logger — A1/A2 ledger-row discriminator (six-case behavior matrix)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const file = () => path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
  const rows = () => (fs.existsSync(file())
    ? fs.readFileSync(file(), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);
  // One-record transcript: whichever event arrives first consumes a real slice.
  const transcript = (name) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', message: { usage: { input_tokens: 1200, output_tokens: 34 } },
    }) + '\n');
    return p;
  };
  const fire = (data) => appendRecord(tmpDir, buildCostRecord(data, tmpDir));

  test('(1) a true byte-identical re-fire yields exactly ONE row', () => {
    const p = transcript('refire.jsonl');
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    assert.equal(fire(ev), true);
    assert.equal(fire(ev), false, 'the same event delivered twice is suppressed');
    assert.equal(rows().length, 1);
  });

  test('(1b) a byte-identical re-fire with NO transcript_path is still caught by the row dedup', () => {
    // No transcript → the marker layer is never consulted, so the last-row dedup
    // is the only guard. Both rows carry the SAME event_sig because the payload is
    // the same bytes. REVERT CHECK (in the other direction): this assertion is
    // what fails if the discriminator is ever made per-row-unique — a counter, a
    // nonce, a timestamp — instead of derived from the payload.
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: 's1', usage: { input_tokens: 9, output_tokens: 2 } };
    assert.equal(fire(ev), true);
    assert.equal(fire(ev), false, 'identical payload → identical discriminator → duplicate');
    assert.equal(rows().length, 1);
  });

  test('(2) interleaved dual registration A, B, A′, B′ yields exactly TWO rows, no phantoms', () => {
    const p = transcript('interleaved.jsonl');
    const A = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const B = { hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' };
    assert.equal(fire(A), true, 'A consumes the real slice');
    assert.equal(fire(B), true, 'sibling B is recorded with zero tokens');
    assert.equal(fire(A), false, "A′ is A's re-fire");
    assert.equal(fire(B), false, "B′ is B's re-fire");
    assert.equal(rows().length, 2, 'A + B only');
  });

  test('(3) two same-type siblings with distinct per-invocation identity yield TWO rows', () => {
    // The audit's reproduction. A verifier consumes the shared transcript FIRST,
    // so both same-type siblings then see an empty slice and produce rows that are
    // equal in every field except the discriminator — the exact input the last-row
    // dedup used to collapse.
    // REVERT CHECK: without event_sig in the row, the second `fire` returns false
    // ("the second same-type sibling is recorded") and rows().length is 2, not 3.
    const p = transcript('pair.jsonl');
    assert.equal(fire({ hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' }), true,
      'the verifier consumes the shared transcript');
    const sib = (id) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: id });
    assert.equal(fire(sib('exec-1')), true);
    assert.equal(fire(sib('exec-2')), true, 'the second same-type sibling is recorded');
    const r = rows();
    assert.equal(r.length, 3, 'verifier + both executors');
    // The two sibling rows are identical apart from ts and the discriminators —
    // the hashed signature, and since v3.29 the host's own `agent_id`, persisted
    // in the clear — which is precisely what saves the second one.
    const strip = (x) => { const { ts, event_sig, agent_id, ...rest } = x; return JSON.stringify(rest); };
    assert.equal(strip(r[1]), strip(r[2]), 'the sibling rows differ in nothing else');
    assert.notEqual(r[1].event_sig, r[2].event_sig, 'distinct per-invocation discriminators');
    assert.deepEqual([r[1].agent_id, r[2].agent_id], ['exec-1', 'exec-2'], 'the host id is on the row itself');
  });

  test('(4) a 3-sibling same-type wave yields THREE rows', () => {
    // Reproduced as 2 rows before the fix: sibling 1 consumed the slice, sibling 2
    // was recorded with zeros, and sibling 3's row was byte-identical to sibling
    // 2's modulo ts, so the dedup dropped it.
    // REVERT CHECK: the third `fire` returns false and rows().length is 2.
    const p = transcript('wave.jsonl');
    const sib = (id) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1', agent_id: id });
    assert.equal(fire(sib('exec-1')), true, 'sibling 1 consumes the slice');
    assert.equal(fire(sib('exec-2')), true, 'sibling 2 (empty slice) is recorded');
    assert.equal(fire(sib('exec-3')), true, 'sibling 3 is recorded — not eaten as a duplicate of sibling 2');
    assert.equal(rows().length, 3, 'a three-subagent wave counts three spawns');
    assert.equal(new Set(rows().map((r) => r.event_sig)).size, 3, 'three distinct discriminators');
  });

  test('(5) a first fire with a missing/unreadable transcript_path yields ONE row', () => {
    const missing = path.join(tmpDir, 'never-written.jsonl');
    const r = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-planner', transcript_path: missing, session_id: 's9' }, tmpDir);
    assert.ok(!r.__emptySlice, 'a first fire is not a re-fire');
    assert.equal(appendRecord(tmpDir, r), true, 'the spawn is counted');
    assert.equal(rows().length, 1);
    assert.equal(typeof rows()[0].event_sig, 'string', 'the row still carries a discriminator');
  });

  test('(6) the M61 phantom — a re-fire after the cursor consumed the slice — stays suppressed', () => {
    // Same input as case (1); pinned separately because the SUPPRESSING LAYER is
    // what matters here: the marker layer flags __emptySlice and appendRecord drops
    // the row before the dedup ever compares it. The dedup could not catch this one
    // (the phantom's zeros differ from the real row it follows), which is why the
    // discriminator change must not shift this case onto the dedup.
    const p = transcript('m61.jsonl');
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };
    const r1 = buildCostRecord(ev, tmpDir);
    assert.equal(r1.input_tokens, 1200);
    assert.equal(appendRecord(tmpDir, r1), true);
    const r2 = buildCostRecord(ev, tmpDir);
    assert.equal(r2.input_tokens, 0, 'the re-fire sees an empty slice');
    assert.equal(r2.__emptySlice, true, 'suppressed by the marker layer, not by the row dedup');
    assert.equal(appendRecord(tmpDir, r2), false);
    assert.equal(rows().length, 1);
  });

  test('the discriminator is a plain string field; the transient __emptySlice flag is still never persisted', () => {
    const p = transcript('shape.jsonl');
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' }, tmpDir);
    appendRecord(tmpDir, rec);
    const line = fs.readFileSync(file(), 'utf-8').trim();
    assert.ok(!line.includes('__emptySlice'), 'transient flag never leaks into the ledger');
    assert.match(JSON.parse(line).event_sig, /^[0-9a-f]{40}$/, 'the persisted discriminator is the event signature');
  });

  test('a pre-discriminator ledger still parses and reports (backward compatibility)', () => {
    const { aggregate } = require('../pan-wizard-core/bin/lib/cost.cjs');
    // Two rows exactly as the previous hook wrote them — v2, no event_sig.
    const legacy = (agent, input) => JSON.stringify({
      v: 2, ts: '2026-08-01T00:00:00.000Z', agent, command: null, model: 'claude-opus-4-8', tier: 'reasoning',
      input_tokens: input, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0,
      cost_usd: null, duration_ms: null, phase: null, session: 's1', source: 'hook',
      token_source: 'transcript', clamped: false,
    });
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), legacy('pan-executor', 500) + '\n' + legacy('pan-verifier', 700) + '\n');
    const agg = aggregate(tmpDir);
    assert.equal(agg.totals.calls, 2, 'rows without the field still aggregate');
    assert.equal(agg.totals.input_tokens, 1200);
    assert.ok(agg.totals.cost_usd > 0, 'and still price');
    // A new-shape row appends alongside them, and the guard works normally
    // thereafter (a new row is never equal to one written in the older shape —
    // they differ in `v` as well as in the discriminator).
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-planner', session_id: 's1', usage: { input_tokens: 5, output_tokens: 1 } };
    assert.equal(fire(ev), true);
    assert.equal(fire(ev), false, 'the guard is live again on the following same-shape pair');
    assert.equal(rows().length, 3);
    assert.equal(aggregate(tmpDir).totals.calls, 3, 'mixed-shape ledgers aggregate as one');
  });
});

// A4/N29 — how far the dedup reaches, where it stops, and the floor it must never
// cross.
//
// A pass once tried to close the residual pinned below by widening the ledger
// dedup: scan a tail of recent rows for an identical row, and additionally treat a
// repeated `event_sig` as a re-fire whenever the candidate carried no tokens on
// any axis and no measured duration. Both halves destroy real data, which is why
// the guard is back to comparing against the immediately preceding row only.
//
// The first two cases below are the floor — they are the reproduction that killed
// the widening, and they fail loudly if it is ever reintroduced. The rest pin the
// residual the simple guard leaves standing, so the hooks' comments can be checked
// against behavior instead of taken on trust.
describe('pan-cost-logger — A4 dedup reach, the data-loss floor, and the honest residual', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const file = () => path.join(tmpDir, '.planning', METRICS_DIR, TOKENS_FILE);
  const rows = () => (fs.existsSync(file())
    ? fs.readFileSync(file(), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);
  const transcript = (name) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', message: { usage: { input_tokens: 1200, output_tokens: 34 } },
    }) + '\n');
    return p;
  };
  // A same-type wave on one shared transcript, distinguished per invocation.
  // WAVE is deliberately larger than the hook's MAX_SEEN_SIGS so sibling 1's
  // signature is evicted from the marker FIFO by the time its re-fire arrives.
  const WAVE = 12;
  const sib = (p, i) => ({
    hook_event_name: 'SubagentStop', agent_type: 'pan-executor',
    transcript_path: p, session_id: 's1', agent_id: `exec-${i}`,
  });
  const fire = (data) => appendRecord(tmpDir, buildCostRecord(data, tmpDir));

  // The shared transcript from docs/FIELD-REPORT-army-2026-06.md: one session
  // transcript that every subagent appends to, so each spawn's slice is the
  // records added since the previous spawn's. Two agent types alternate, which
  // makes each repeat of a payload NON-ADJACENT in the ledger.
  const SPAWNS = ['X', 'Y', 'X', 'Y', 'X'];
  const PAYLOAD = {
    X: (p) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' }),
    Y: (p) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', transcript_path: p, session_id: 's1' }),
  };
  // One record per spawn. `usage: null` → the slice yields zeros; no `timestamp`
  // field → duration_ms stays null, so the row looks "contentless" even though the
  // spawn was entirely real.
  const growBy = (p, usage) => fs.appendFileSync(p, JSON.stringify(
    usage ? { type: 'assistant', message: { usage } } : { type: 'assistant', message: {} },
  ) + '\n');
  const runSharedTranscript = (usageFor) => {
    const p = path.join(tmpDir, 'shared.jsonl');
    fs.writeFileSync(p, '');
    for (const which of SPAWNS) {
      growBy(p, usageFor(which));       // the subagent does its work…
      fire(PAYLOAD[which](p));          // …then SubagentStop fires for it
    }
    return rows();
  };

  test('no genuine spawn is ever dropped: five spawns X,Y,X,Y,X on one shared transcript whose slices carry no usage yield FIVE rows', () => {
    // THE DATA-LOSS FLOOR. Every one of these five events is a distinct real
    // spawn; none is a re-fire. Because X's payload is byte-identical each time it
    // runs (agent type, session id and transcript path are all shared — the field
    // report's topology) all three X rows carry ONE signature, and because the
    // slices hold no usage and no timestamps every row is all-zero with a null
    // duration.
    //
    // WHICH ASSERTION FAILS IF THE WINDOW SCAN IS REINTRODUCED: this test's first
    // assertion — `rows().length === SPAWNS.length` — reports 2 instead of 5.
    // Spawns 3, 4 and 5 are eaten, by either half of the widening independently:
    // the identity scan finds spawn 1's row (identical modulo `ts`) further back in
    // the tail, and the signature prong finds spawn 1's `event_sig` on a candidate
    // that looks contentless. The `agents` assertion then reports
    // ['pan-executor','pan-verifier'].
    const r = runSharedTranscript(() => null);
    assert.equal(r.length, SPAWNS.length, 'five real spawns, five ledger rows');
    assert.deepEqual(r.map((x) => x.agent),
      ['pan-executor', 'pan-verifier', 'pan-executor', 'pan-verifier', 'pan-executor'],
      'in spawn order, with no collapse of the repeated payloads');
    assert.equal(new Set(r.map((x) => x.event_sig)).size, 2,
      'only TWO signatures across the five rows — the signature is not an identity');
  });

  test('no genuine spawn is ever dropped, and real token counts survive with it', () => {
    // Same five spawns, now with real usage in each slice and each agent type's
    // slices identical to its own earlier ones — so the rows repeat exactly.
    // WHICH ASSERTION FAILS IF THE WINDOW SCAN IS REINTRODUCED: the token-sum
    // assertion — the identity scan drops spawns 3-5 and `inputSum` reports 2000
    // instead of 5200, i.e. 3200 input tokens of real, billed usage deleted from
    // the ledger. This is the case that makes the widening strictly worse than the
    // phantom row it was chasing.
    const r = runSharedTranscript((which) => (which === 'X'
      ? { input_tokens: 1200, output_tokens: 340 }
      : { input_tokens: 800, output_tokens: 120 }));
    assert.equal(r.length, SPAWNS.length, 'five real spawns, five ledger rows');
    assert.deepEqual(r.map((x) => x.input_tokens), [1200, 800, 1200, 800, 1200]);
    assert.equal(r.reduce((n, x) => n + x.input_tokens, 0), 5200, 'no billed tokens lost');
    assert.deepEqual(r.map((x) => x.output_tokens), [340, 120, 340, 120, 340]);
  });

  test('sequential subagents with byte-identical payloads on a growing transcript keep their counts', () => {
    // The same topology reduced to its smallest form and stated in the terms of
    // docs/FIELD-REPORT-army-2026-06.md: two subagents of the SAME type, same
    // session id, same transcript path, no usage in the payload — so byte-identical
    // payloads and therefore the same event_sig — each consuming a real slice as
    // the transcript grows. Here the rows differ in their token counts, so the
    // identity comparison cannot collapse them at any window width; it is the
    // signature prong alone that used to.
    const p = path.join(tmpDir, 'growing.jsonl');
    const rec = (usage) => JSON.stringify({ type: 'assistant', message: { usage } }) + '\n';
    fs.writeFileSync(p, rec({ input_tokens: 70, output_tokens: 64549 }));
    const ev = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', transcript_path: p, session_id: 's1' };

    assert.equal(fire(ev), true, 'the first subagent records its slice');
    fs.appendFileSync(p, rec({ input_tokens: 42, output_tokens: 9011 })); // next subagent appends
    assert.equal(fire(ev), true, 'the second subagent records ITS slice, same signature and all');

    const r = rows();
    assert.equal(r.length, 2);
    assert.equal(r[0].event_sig, r[1].event_sig, 'identical payloads → identical signature');
    assert.deepEqual(r.map((x) => x.input_tokens), [70, 42], 'both real token counts survive');
    assert.deepEqual(r.map((x) => x.output_tokens), [64549, 9011]);
  });

  test('the residual: a re-fire is suppressed while its signature is in the marker window, and admitted as a phantom row once evicted', () => {
    // The hooks promise suppression only while a re-fire is still RECOGNIZABLE —
    // its signature in the per-transcript FIFO, or the row it duplicates sitting
    // immediately before it in the ledger. This pins BOTH sides of that line so the
    // comments can be checked rather than trusted. If a future change suppresses
    // the second half too, update the comments in BOTH hooks first — and re-run the
    // two data-loss-floor cases above, because widening the guard is how the last
    // attempt paid for it.
    const p = transcript('wave.jsonl');
    for (let i = 1; i <= WAVE; i++) {
      assert.equal(fire(sib(p, i)), true, `sibling ${i} is recorded`);
    }
    assert.equal(rows().length, WAVE, 'every sibling spawn is counted');

    // Still recognizable: the NEWEST sibling's signature has not been evicted.
    const fresh = buildCostRecord(sib(p, WAVE), tmpDir);
    assert.equal(fresh.__emptySlice, true, 'the marker layer recognizes a recent re-fire');
    assert.equal(appendRecord(tmpDir, fresh), false);
    assert.equal(rows().length, WAVE, 'no phantom row for the recent re-fire');

    // Past the window: sibling 1's dual registration arrives after the wave has
    // pushed its signature out of the FIFO, and sibling 1's row is long past
    // adjacency. Nothing left can tell it from a fresh zero-token spawn.
    const late = buildCostRecord(sib(p, 1), tmpDir);
    assert.equal(late.__emptySlice, undefined,
      'the marker layer no longer recognizes it — its signature was evicted');
    assert.ok(late.event_sig && late.event_sig === rows()[0].event_sig,
      'the signature it carries is still the one on sibling 1\'s row — but nothing searches by it');
    assert.equal(appendRecord(tmpDir, late), true, 'the documented residual: it is admitted');
    assert.equal(rows().length, WAVE + 1, 'one phantom row — the accepted price of never dropping a real spawn');
  });

  test('the wider residual on the NO-transcript path: an interleaved dual registration leaves phantom rows', () => {
    // That path never consults the marker layer at all — there is no transcript to
    // key it by — so the adjacent-row comparison is the only guard. A′ and B′ are
    // not adjacent to A and B, so both are admitted. Closing this needs a lookback,
    // and a lookback is exactly what the two floor cases above forbid: the hook
    // cannot tell this A′ from a genuine third spawn carrying A's payload, and
    // guessing wrong deletes real rows. Documented in the hook rather than fixed.
    const A = { hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: 's1', usage: { input_tokens: 9, output_tokens: 2 } };
    const B = { hook_event_name: 'SubagentStop', agent_type: 'pan-verifier', session_id: 's1', usage: { input_tokens: 5, output_tokens: 1 } };
    assert.equal(fire(A), true);
    assert.equal(fire(B), true);
    assert.equal(fire(A), true, "A′ is out of adjacency reach — admitted");
    assert.equal(fire(B), true, "B′ likewise");
    assert.deepEqual(rows().map((r) => r.agent),
      ['pan-executor', 'pan-verifier', 'pan-executor', 'pan-verifier'],
      'two real spawns + two phantoms — the residual, not a fix');
    // An ADJACENT re-fire on the same path is still suppressed, which is the reach
    // the simple guard does have (matrix case 1b pins it from the other side).
    assert.equal(fire(B), false, 'B″ arrives adjacent to B′ and is caught');
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

// ─── Phase attribution and planning root ────────────────────────────────────

/**
 * Phase attribution used to come ONLY from the active optimizer trace session,
 * and tracing is off by default — so in ordinary use every ledger row carried
 * `phase: null`. A field ledger had 121 rows, 100% unattributed, which makes
 * "which phase got expensive" unanswerable from PAN's own telemetry.
 */
describe('pan-cost-logger — phase attribution', () => {
  let tmp;
  const EVENT = { hook_event_name: 'SubagentStop', subagent_type: 'pan-executor', session_id: 's1' };

  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => {
    cleanup(tmp);
    delete process.env.PAN_TRACK;
    delete process.env.PAN_PLANNING_DIR;
  });

  const writeState = (body) => fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), body);

  test('falls back to state.md frontmatter when no trace session is running', () => {
    writeState('---\npan_state_version: 1.0\ncurrent_phase: "05"\n---\n\n## Phase Progress\n');
    assert.equal(buildCostRecord(EVENT, tmp).phase, '05');
  });

  test('falls back to the **Current Phase:** body field', () => {
    writeState('---\nv: 1\n---\n\n## Phase Progress\n\n**Current Phase:** 07\n');
    assert.equal(buildCostRecord(EVENT, tmp).phase, '07');
  });

  test('an explicit payload phase still wins over the fallback', () => {
    writeState('---\ncurrent_phase: "05"\n---\n');
    assert.equal(buildCostRecord({ ...EVENT, phase: '99' }, tmp).phase, '99');
  });

  test('no state.md leaves phase null rather than inventing one', () => {
    assert.equal(buildCostRecord(EVENT, tmp).phase, null);
  });

  test('a null-valued frontmatter phase is not treated as a phase', () => {
    writeState('---\ncurrent_phase: null\n---\n');
    assert.equal(buildCostRecord(EVENT, tmp).phase, null);
  });
});

describe('pan-cost-logger — planning root', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => {
    cleanup(tmp);
    delete process.env.PAN_TRACK;
    delete process.env.PAN_PLANNING_DIR;
  });

  test('PAN_TRACK moves the hook onto the track\'s tree', () => {
    const track = path.join(tmp, '.planning', 'tracks', 'verify');
    fs.mkdirSync(track, { recursive: true });
    fs.writeFileSync(path.join(track, 'state.md'), '---\ncurrent_phase: "12"\n---\n');
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '---\ncurrent_phase: "01"\n---\n');

    process.env.PAN_TRACK = 'verify';
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', subagent_type: 'x', session_id: 's' }, tmp);
    assert.equal(rec.phase, '12', 'read the track tree, not the root tree');
  });

  test('a PAN_TRACK that escapes the project root is ignored, not honoured', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '---\ncurrent_phase: "01"\n---\n');
    process.env.PAN_TRACK = '../../evil';
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', subagent_type: 'x', session_id: 's' }, tmp);
    assert.equal(rec.phase, '01', 'degrades to the default tree');
  });

  test('a PAN_PLANNING_DIR with .. is ignored, not honoured', () => {
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), '---\ncurrent_phase: "01"\n---\n');
    process.env.PAN_PLANNING_DIR = '../outside';
    const rec = buildCostRecord({ hook_event_name: 'SubagentStop', subagent_type: 'x', session_id: 's' }, tmp);
    assert.equal(rec.phase, '01');
  });

  test('isPanProject follows the configured root', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-bare-'));
    try {
      assert.equal(isPanProject(bare), false);
      fs.mkdirSync(path.join(bare, '.planning', 'tracks', 'core'), { recursive: true });
      process.env.PAN_TRACK = 'core';
      assert.equal(isPanProject(bare), true);
    } finally {
      cleanup(bare);
    }
  });
});

// ─── Per-agent transcript attribution (2026-09) ─────────────────────────────

/**
 * On SubagentStop the host passes the PARENT session transcript; the subagent's
 * own conversation sits beside it under <session_id>/subagents/agent-<agent_id>.jsonl
 * (the layout observed on disk, whose first record carries the same agentId and
 * sessionId). Slicing the parent per event booked the session's usage to
 * whichever subagent stopped next — 7.5 billion cache-read tokens over a ten-day
 * "duration" on one field row — and produced all-zero rows for siblings that
 * stopped before the parent grew. The numbers below are that field agent's real
 * totals (two summed usage records standing in for its 118).
 */
describe('pan-cost-logger — per-agent transcript attribution', () => {
  const { resolveAgentTranscript } = require('../hooks/pan-cost-logger.js');
  const { isSuspectRecord } = require('../pan-wizard-core/bin/lib/cost.cjs');
  const SESSION = 'a72c1321-73dd-422f-95c8-2b8a17d86efe';
  let tmp, home, parent, subagents;
  const usageLine = (u, ts, model = 'claude-opus-5') =>
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { model, usage: u } });

  beforeEach(() => {
    tmp = createTempProject();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-transcripts-'));
    parent = path.join(home, `${SESSION}.jsonl`);
    // The parent transcript: a long-lived session with a session's worth of history.
    fs.writeFileSync(parent, [
      usageLine({ input_tokens: 500, output_tokens: 9000, cache_read_input_tokens: 700000000, cache_creation_input_tokens: 900000 }, '2026-09-01T08:00:00.000Z'),
      usageLine({ input_tokens: 400, output_tokens: 8000, cache_read_input_tokens: 600000000, cache_creation_input_tokens: 800000 }, '2026-09-10T08:00:00.000Z'),
    ].join('\n') + '\n');
    subagents = path.join(home, SESSION, 'subagents');
    fs.mkdirSync(subagents, { recursive: true });
  });
  afterEach(() => { cleanup(tmp); fs.rmSync(home, { recursive: true, force: true }); });

  const agentFile = (id, lines) => {
    const p = path.join(subagents, `agent-${id}.jsonl`);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };
  const payload = (extra) => ({ hook_event_name: 'SubagentStop', agent_type: 'pan-executor', session_id: SESSION, transcript_path: parent, ...extra });
  const rows = () => fs.readFileSync(path.join(tmp, '.planning', METRICS_DIR, TOKENS_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  test('the subagent\'s own transcript is sliced when agent_id names one — never the parent session', () => {
    const agentPath = agentFile('a15f28b4fab5c68d1', [
      usageLine({ input_tokens: 120, output_tokens: 24000, cache_read_input_tokens: 7400000, cache_creation_input_tokens: 210000 }, '2026-09-02T18:03:09.614Z'),
      usageLine({ input_tokens: 116, output_tokens: 23950, cache_read_input_tokens: 7401352, cache_creation_input_tokens: 207922 }, '2026-09-02T18:15:53.930Z'),
    ]);
    const rec = buildCostRecord(payload({ agent_id: 'a15f28b4fab5c68d1' }), tmp);
    assert.equal(rec.v, 4);
    assert.equal(rec.token_source, 'agent-transcript');
    assert.equal(rec.agent_id, 'a15f28b4fab5c68d1');
    assert.equal(rec.input_tokens, 236);
    assert.equal(rec.output_tokens, 47950);
    assert.equal(rec.cache_read_tokens, 14801352, 'the agent\'s own cache reads, not the session\'s 1.3 billion');
    assert.equal(rec.cache_write_tokens, 417922);
    assert.equal(rec.duration_ms, Date.parse('2026-09-02T18:15:53.930Z') - Date.parse('2026-09-02T18:03:09.614Z'));
    assert.equal(rec.clamped, false);
    assert.equal(rec.model, 'claude-opus-5');
    assert.equal(isSuspectRecord(rec), false, 'a real agent row must survive aggregate()');
    const cursor = JSON.parse(fs.readFileSync(path.join(tmp, '.planning', METRICS_DIR, CURSOR_FILE), 'utf8'));
    assert.equal(cursor[agentPath], 2, 'the cursor is keyed by the agent transcript');
    assert.equal(cursor[parent], undefined, 'the parent transcript is not consumed');
  });

  test('a Workflow-tool subagent — written under subagents/workflows/<run>/ — is found one level down', () => {
    // The native /pan-* workflow scripts spawn their agents through the Workflow
    // tool, whose transcripts land under the run that spawned them. In the
    // field those were 269 of one ledger's 331 rows; missing the level would
    // have recorded every one of them as an unmeasured spawn.
    const run = path.join(subagents, 'workflows', 'wf_01987606-115');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'agent-a03a8fead919fb4a9.jsonl'),
      usageLine({ input_tokens: 9, output_tokens: 900, cache_read_input_tokens: 90000, cache_creation_input_tokens: 0 }, '2026-09-03T20:11:30.913Z') + '\n');
    const rec = buildCostRecord(payload({ agent_type: 'workflow-subagent', agent_id: 'a03a8fead919fb4a9' }), tmp);
    assert.equal(rec.token_source, 'agent-transcript');
    assert.equal(rec.cache_read_tokens, 90000);
    assert.equal(rec.output_tokens, 900);
    assert.equal(resolveAgentTranscript(payload({ agent_id: 'a03a8fead919fb4a9' })), path.join(run, 'agent-a03a8fead919fb4a9.jsonl'));
  });

  test('a resumed agent — a second stop on the same agent transcript — is charged only its new lines', () => {
    const p = agentFile('b1', [usageLine({ input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:00.000Z')]);
    appendRecord(tmp, buildCostRecord(payload({ agent_id: 'b1' }), tmp));
    fs.appendFileSync(p, usageLine({ input_tokens: 20, output_tokens: 200, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 }, '2026-09-02T10:05:00.000Z') + '\n');
    appendRecord(tmp, buildCostRecord(payload({ agent_id: 'b1', last_assistant_message: 'done' }), tmp));
    assert.deepEqual(rows().map((r) => r.output_tokens), [100, 200]);
    assert.deepEqual(rows().map((r) => r.cache_read_tokens), [1000, 2000]);
  });

  test('an explicit agent_transcript_path in the payload wins over the derivation', () => {
    const explicit = path.join(home, 'elsewhere.jsonl');
    fs.writeFileSync(explicit, usageLine({ input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:00.000Z') + '\n');
    const rec = buildCostRecord(payload({ agent_id: 'no-such-agent', agent_transcript_path: explicit }), tmp);
    assert.equal(rec.token_source, 'agent-transcript');
    assert.equal(rec.output_tokens, 50);
  });

  test('one turn, one usage: a turn written as several content-block records is counted once, last snapshot wins', () => {
    // Claude Code writes an assistant turn as one JSONL record per content block,
    // each carrying the turn's message.id and a usage snapshot; on a real 65-turn
    // agent file that made 118 records and a per-record sum of 14.8M cache-read
    // tokens against 8.5M actual. Records without an id still sum individually.
    const turn = (id, u, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5', usage: u } });
    agentFile('d4', [
      turn('msg_A', { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:00.000Z'),
      turn('msg_A', { input_tokens: 5, output_tokens: 90, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:04.000Z'),
      turn('msg_A', { input_tokens: 5, output_tokens: 146, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:06.000Z'),
      turn('msg_B', { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 100200, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:20.000Z'),
      usageLine({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:30.000Z'),
      usageLine({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:31.000Z'),
    ]);
    const rec = buildCostRecord(payload({ agent_id: 'd4' }), tmp);
    assert.equal(rec.cache_read_tokens, 100000 + 100200 + 3 + 3, 'two turns plus two unkeyed records — not five blocks');
    assert.equal(rec.output_tokens, 146 + 40 + 2 + 2, "the turn's final snapshot, not the sum of its blocks");
    assert.equal(rec.input_tokens, 5 + 3 + 1 + 1);
  });

  test('without an agent id the parent slice is still used — token axes are clamped and flagged, the span is recorded and the reader quarantines it', () => {
    const rec = buildCostRecord(payload({}), tmp);
    assert.equal(rec.token_source, 'transcript');
    assert.equal(rec.agent_id, null);
    assert.equal(rec.cache_read_tokens, 0, '1.3 billion cache reads is a session, not a subagent — dropped');
    assert.equal(rec.cache_write_tokens, 1700000, 'axes under their ceiling keep their values');
    assert.equal(rec.output_tokens, 17000);
    assert.equal(rec.clamped, true);
    assert.equal(rec.duration_ms, Date.parse('2026-09-10T08:00:00.000Z') - Date.parse('2026-09-01T08:00:00.000Z'),
      'the nine-day span is written as measured, not nulled — nulling would hand the row to the untimed ratio rule');
    assert.equal(isSuspectRecord(rec), true, "a nine-day 'subagent' is a session's history; the reader's span rule quarantines it");
  });

  test('a named agent whose transcript file is absent consumes nothing: zeros, its own token_source, and the parent is left for others', () => {
    // Not flushed yet, or a host that sends ids without per-agent files. Slicing
    // the parent here would book the whole session since the last parent-slice
    // stop to this one spawn (the reviewer's 120M-cache-read probe).
    const rec = buildCostRecord(payload({ agent_id: 'notflushed' }), tmp);
    assert.equal(rec.token_source, 'agent-transcript-missing');
    assert.equal(rec.agent_id, 'notflushed');
    assert.deepEqual([rec.input_tokens, rec.output_tokens, rec.cache_read_tokens, rec.cache_write_tokens], [0, 0, 0, 0]);
    assert.equal(rec.model, null);
    assert.equal(rec.duration_ms, null);
    assert.equal(appendRecord(tmp, rec), true, 'the spawn is recorded');
    const cursor = JSON.parse(fs.readFileSync(path.join(tmp, '.planning', METRICS_DIR, CURSOR_FILE), 'utf8'));
    assert.equal(cursor[parent], undefined, 'the parent transcript was not consumed');
    const refire = buildCostRecord(payload({ agent_id: 'notflushed' }), tmp);
    assert.equal(appendRecord(tmp, refire), false, 'its byte-identical re-fire is still dropped');
    const { isEmptyRecord } = require('../pan-wizard-core/bin/lib/cost.cjs');
    assert.equal(isEmptyRecord(rec), true, 'the reader excludes it from calls as an unmeasured spawn');
    // The parent slice remains available to a stop that names no agent at all.
    const other = buildCostRecord(payload({}), tmp);
    assert.equal(other.token_source, 'transcript');
    assert.equal(other.output_tokens, 17000);
  });

  test('an agent_id that is not a bare id never becomes a path', () => {
    fs.writeFileSync(path.join(home, 'agent-x.jsonl'), '');
    for (const bad of ['../agent-x', '..\\agent-x', '/abs', 'a b', '', 42]) {
      assert.equal(resolveAgentTranscript(payload({ agent_id: bad })), null, JSON.stringify(bad));
    }
    assert.equal(resolveAgentTranscript(payload({ agent_id: 'x', session_id: '../..' })), null, 'a traversing session_id is refused too');
  });

  test('stdin driver: a SubagentStop payload with agent_id lands the agent\'s numbers in tokens.jsonl', () => {
    agentFile('c9', [usageLine({ input_tokens: 7, output_tokens: 70, cache_read_input_tokens: 7000, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:00.000Z')]);
    const r = spawnSync(process.execPath, [COST_HOOK], { input: JSON.stringify({ ...payload({ agent_id: 'c9' }), cwd: tmp }), encoding: 'utf8' });
    assert.equal(r.status, 0);
    const written = rows();
    assert.equal(written.length, 1);
    assert.equal(written[0].cache_read_tokens, 7000);
    assert.equal(written[0].token_source, 'agent-transcript');
    assert.equal(written[0].agent_id, 'c9');
    assert.equal(written[0].v, 4);
  });

  test('a byte-identical re-fire on the agent-transcript path is dropped; an explicit agent_transcript_path that is missing is an unmeasured spawn', () => {
    agentFile('r1', [usageLine({ input_tokens: 3, output_tokens: 30, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 }, '2026-09-02T10:00:00.000Z')]);
    const p = payload({ agent_id: 'r1' });
    assert.equal(appendRecord(tmp, buildCostRecord(p, tmp)), true, 'first fire recorded');
    const refire = buildCostRecord(p, tmp);
    assert.equal(refire.__emptySlice, true, 'the agent file has no new lines and the signature was seen');
    assert.equal(appendRecord(tmp, refire), false);
    assert.equal(rows().length, 1);
    const missing = buildCostRecord(payload({ agent_transcript_path: path.join(home, 'not-flushed-yet.jsonl') }), tmp);
    assert.equal(missing.token_source, 'agent-transcript-missing');
    assert.equal(missing.output_tokens, 0);
  });

  test('every token axis has its ceiling on the agent path: output and input past theirs are dropped and flagged, the rest kept', () => {
    agentFile('big', [usageLine({ input_tokens: 25000000, output_tokens: 11000000, cache_read_input_tokens: 400000, cache_creation_input_tokens: 5000 }, '2026-09-02T10:00:00.000Z')]);
    const rec = buildCostRecord(payload({ agent_id: 'big' }), tmp);
    assert.deepEqual([rec.input_tokens, rec.output_tokens, rec.cache_read_tokens, rec.cache_write_tokens], [0, 0, 400000, 5000]);
    assert.equal(rec.clamped, true);
  });

  test('the cursor keeps only the newest MAX_CURSOR_KEYS transcript keys (a key per spawn no longer grows it without bound)', () => {
    const { readCursor, writeCursor, MAX_CURSOR_KEYS } = require('../hooks/pan-cost-logger.js');
    const cursor = {};
    const files = [];
    for (let i = 0; i < MAX_CURSOR_KEYS + 40; i++) {
      const f = path.join(subagents, `agent-k${i}.jsonl`);
      fs.writeFileSync(f, '');
      files.push(f);
      cursor[f] = i + 1;
    }
    writeCursor(tmp, cursor);
    const kept = readCursor(tmp);
    const keys = Object.keys(kept).filter((k) => k !== '__seenEvents');
    assert.equal(keys.length, MAX_CURSOR_KEYS);
    assert.equal(kept[files[0]], undefined, 'the oldest key is evicted');
    assert.equal(kept[files[files.length - 1]], MAX_CURSOR_KEYS + 40, 'the newest key survives with its value');
  });
});
