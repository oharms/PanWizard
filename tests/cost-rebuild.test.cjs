/**
 * Tests for cost-rebuild.cjs — rebuilding the cost ledger from Claude Code
 * transcripts (2026-09). Everything runs against a synthetic Claude config dir
 * under os.tmpdir(); nothing touches the developer's real ~/.claude.
 *
 * `cmdCostRebuild` goes through `output()`, which exits the process, so it is
 * exercised only through the CLI (runPanTools); the module functions are called
 * directly for everything else.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  encodeProjectDirName, readJsonl, sumTranscriptUsage, mapAgentsFromParent, mapAgentsFromWorkflowRuns,
  listAgentFiles, discoverSessions, planRebuild, applyRebuild, renderPlan, MAIN_THREAD_AGENT,
} = require('../pan-wizard-core/bin/lib/cost-rebuild.cjs');
const { aggregate, readRecords, isSuspectRecord } = require('../pan-wizard-core/bin/lib/cost.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const S1 = 'a72c1321-73dd-422f-95c8-2b8a17d86efe'; // rebuildable: transcript + agent files
const S2 = '11111111-2222-4333-8444-555555555555'; // named in the ledger, transcript gone
const S3 = '99999999-8888-4777-8666-555555555555'; // not in the ledger, but has an agent file
const S4 = 'abcdefab-0000-4000-8000-000000000000'; // a plain chat session: no agents, not in the ledger

const line = (obj) => JSON.stringify(obj) + '\n';
const assistant = (id, usage, ts, model = 'claude-opus-5', content = [{ type: 'text', text: 'ok' }]) =>
  line({ type: 'assistant', timestamp: ts, message: { id, model, usage, content } });
const U = (i, o, cr, cw = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });

describe('cost-rebuild — rebuilding the ledger from transcripts', () => {
  let tmp, claudeDir, projDir, ledger;
  const S1_ROWS = () => [
    { v: 3, ts: '2026-09-02T18:09:17.000Z', agent: 'workflow-subagent', model: 'claude-opus-5', input_tokens: 28976, output_tokens: 11235261, cache_read_tokens: 7486471684, cache_write_tokens: 91223140, duration_ms: 858781822, session: S1, source: 'hook', token_source: 'transcript' },
    { v: 3, ts: '2026-09-02T18:09:55.000Z', agent: 'workflow-subagent', model: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, session: S1, source: 'hook', token_source: 'transcript' },
    { v: 3, ts: '2026-09-02T18:10:29.000Z', agent: 'workflow-subagent', model: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, session: S1, source: 'hook', token_source: 'transcript' },
  ];
  const S2_ROW = { v: 3, ts: '2026-08-10T12:00:00.000Z', agent: 'pan-planner', model: 'claude-opus-5', input_tokens: 500, output_tokens: 2000, cache_read_tokens: 300000, cache_write_tokens: 1000, duration_ms: 600000, session: S2, source: 'hook', token_source: 'transcript' };
  const CALLER_ROW = { ts: '2026-08-11T12:00:00.000Z', agent: 'manual', model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0 };

  beforeEach(() => {
    tmp = createTempProject();
    claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-claude-'));
    projDir = path.join(claudeDir, 'projects', encodeProjectDirName(tmp));
    fs.mkdirSync(projDir, { recursive: true });

    // S1 main thread: an Agent tool_use paired to its result (agentId a1 → pan-executor)
    // in a user record that ALSO carries a Bash tool_result first; one turn written as
    // two block records (same message.id — counted once); one more turn.
    fs.writeFileSync(path.join(projDir, `${S1}.jsonl`),
      assistant('msg_1', U(10, 5, 1000), '2026-09-02T18:00:00.000Z', 'claude-opus-5', [
        { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'pan-executor', description: 'do it', prompt: '...' } },
      ])
      + line({ type: 'user', timestamp: '2026-09-02T18:00:01.000Z', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_bash', content: 'files' },
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' },
      ] }, toolUseResult: { isAsync: true, agentId: 'a1', resolvedModel: 'claude-opus-5[1m]' } })
      + assistant('msg_2', U(20, 1, 2000), '2026-09-02T18:10:00.000Z')
      + assistant('msg_2', U(20, 300, 2000), '2026-09-02T18:10:03.000Z'));
    // S1 agents: a direct subagent, a Workflow-tool subagent one level down, one that never ran.
    const sub = path.join(projDir, S1, 'subagents');
    fs.mkdirSync(path.join(sub, 'workflows', 'wf_01987606-115'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'),
      assistant('m_a', U(100, 4000, 500000, 7000), '2026-09-02T18:01:00.000Z')
      + assistant('m_a', U(100, 4500, 500000, 7000), '2026-09-02T18:01:05.000Z')
      + assistant('m_b', U(30, 700, 510000), '2026-09-02T18:09:00.000Z'));
    fs.writeFileSync(path.join(sub, 'workflows', 'wf_01987606-115', 'agent-w1.jsonl'),
      assistant('m_w', U(9, 900, 90000), '2026-09-03T20:11:30.000Z', 'claude-fable-5-1'));
    fs.writeFileSync(path.join(sub, 'workflows', 'wf_01987606-115', 'agent-never-ran.jsonl'),
      line({ type: 'user', timestamp: '2026-09-03T20:11:00.000Z', message: { role: 'user', content: 'prompt' } }));
    // The Workflow run record: real shape keeps agents under `workflowProgress`.
    fs.mkdirSync(path.join(projDir, S1, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(projDir, S1, 'workflows', 'wf_01987606-115.json'),
      JSON.stringify({ runId: 'wf_01987606-115', workflowName: 'reality-check-audit', logs: ['started'], workflowProgress: [{ type: 'workflow_phase', index: 1 }, { type: 'workflow_agent', agentId: 'w1', label: 'R1 vacuity-sweep', model: 'claude-fable-5-1' }] }));

    // S3: not in the ledger, but it has an agent file → included. Its main thread has one
    // record without a message.id, which sums on its own. S4: a plain chat → skipped.
    fs.writeFileSync(path.join(projDir, `${S3}.jsonl`),
      assistant('m3', U(1, 2, 3), '2026-09-05T10:00:00.000Z')
      + line({ type: 'assistant', timestamp: '2026-09-05T10:00:30.000Z', message: { model: 'claude-opus-5', usage: U(1, 8, 3) } }));
    fs.mkdirSync(path.join(projDir, S3, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(projDir, S3, 'subagents', 'agent-c1.jsonl'), assistant('m3a', U(4, 40, 400), '2026-09-05T10:01:00.000Z'));
    fs.writeFileSync(path.join(projDir, `${S4}.jsonl`), assistant('m4', U(1, 1, 1), '2026-09-06T10:00:00.000Z'));

    ledger = path.join(tmp, '.planning', 'metrics', 'tokens.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, [...S1_ROWS(), S2_ROW, CALLER_ROW].map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
  afterEach(() => { cleanup(tmp); fs.rmSync(claudeDir, { recursive: true, force: true }); });

  const runCli = (args) => runPanTools(`cost rebuild ${args} --claude-dir "${claudeDir}"`, tmp);

  test('encodeProjectDirName reproduces Claude Code\'s folder naming', () => {
    if (process.platform === 'win32') {
      assert.equal(encodeProjectDirName('D:\\montyhall_Door_One'), 'D--montyhall-Door-One');
      assert.equal(encodeProjectDirName('D:\\proj\\.claude\\worktrees\\x-1'), 'D--proj--claude-worktrees-x-1');
    } else {
      assert.equal(encodeProjectDirName('/home/u/my_proj'), '-home-u-my-proj');
    }
  });

  test('readJsonl parses from a Buffer: CRLF lines, torn lines skipped, an unreadable file reports its error', () => {
    const f = path.join(claudeDir, 'mixed.jsonl');
    fs.writeFileSync(f, '{"a":1}\r\n{"b":2}\n{torn\n\n{"c":3}');
    const r = readJsonl(f);
    assert.deepEqual(r.entries, [{ a: 1 }, { b: 2 }, { c: 3 }]);
    assert.equal(r.error, null);
    assert.equal(readJsonl(path.join(claudeDir, 'absent.jsonl')).error, 'ENOENT');
  });

  test('sumTranscriptUsage counts one turn once, keeps the last snapshot, ignores <synthetic> when choosing the model, flags unreadable files', () => {
    const u = sumTranscriptUsage(path.join(projDir, S1, 'subagents', 'agent-a1.jsonl'));
    assert.deepEqual([u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.turns], [130, 5200, 1010000, 7000, 2]);
    assert.equal(u.model, 'claude-opus-5');
    const f = path.join(claudeDir, 'interrupted.jsonl');
    fs.writeFileSync(f, assistant('x1', U(1, 10, 100), '2026-09-02T10:00:00.000Z', 'claude-fable-5-1')
      + assistant('x2', U(0, 0, 0), '2026-09-02T10:00:05.000Z', '<synthetic>'));
    assert.equal(sumTranscriptUsage(f).model, 'claude-fable-5-1', 'an interruption record is not a model');
    assert.equal(sumTranscriptUsage(path.join(claudeDir, 'absent.jsonl')).unreadable, true);
  });

  test('mapAgentsFromParent pairs the Agent tool_use with its result even beside another tool_result; mapAgentsFromWorkflowRuns reads workflowProgress', () => {
    const m = mapAgentsFromParent(path.join(projDir, `${S1}.jsonl`));
    assert.deepEqual(m.get('a1'), { type: 'pan-executor', model: 'claude-opus-5[1m]' });
    const w = mapAgentsFromWorkflowRuns(path.join(projDir, S1));
    assert.deepEqual(w.get('w1'), { label: 'R1 vacuity-sweep', model: 'claude-fable-5-1', workflow: 'reality-check-audit' });
    assert.equal(listAgentFiles(path.join(projDir, S1)).length, 3, 'direct + two under workflows/<run>/');
  });

  test('discoverSessions: encoded-cwd folder, ledger-named sessions and agent-bearing sessions; plain chats skipped', () => {
    const found = discoverSessions(tmp, new Set([S1, S2]), { claudeDir });
    assert.deepEqual(found.sessions.map((s) => s.sessionId).sort(), [S1, S3].sort(), 'S2 has no transcript, S4 never involved agents');
  });

  test('a folder reached only through a ledger-named session contributes that session and nothing else', () => {
    // A ledger copied from another project (the pantesting fixtures) names that
    // project's sessions; rebuilding must not import its whole agent history.
    const F1 = 'f0000000-0000-4000-8000-000000000001'; // named in our ledger
    const F2 = 'f0000000-0000-4000-8000-000000000002'; // its neighbour, with agents — not ours
    const foreign = path.join(claudeDir, 'projects', 'D--some-other-project');
    for (const sid of [F1, F2]) {
      fs.mkdirSync(path.join(foreign, sid, 'subagents'), { recursive: true });
      fs.writeFileSync(path.join(foreign, `${sid}.jsonl`), assistant('m', U(1, 1, 1), '2026-09-01T10:00:00.000Z'));
      fs.writeFileSync(path.join(foreign, sid, 'subagents', 'agent-z.jsonl'), assistant('mz', U(5, 50, 500), '2026-09-01T10:01:00.000Z'));
    }
    const found = discoverSessions(tmp, new Set([F1]), { claudeDir });
    const ids = found.sessions.map((s) => s.sessionId);
    assert.ok(ids.includes(F1), 'the named session is rebuilt');
    assert.ok(!ids.includes(F2), "the neighbour is another project's history");
    assert.ok(ids.includes(S3), 'our own folder is still swept for agent-bearing sessions');
  });

  test('a transcript folder the cost cursor points into is swept, but agent-transcript cursor keys do not add folders', () => {
    const S5 = 'c0ffee00-1111-4222-8333-444444444444';
    const odd = path.join(claudeDir, 'projects', 'renamed-project-folder');
    fs.mkdirSync(path.join(odd, S5, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(odd, `${S5}.jsonl`), assistant('m5', U(1, 1, 1), '2026-09-07T10:00:00.000Z'));
    fs.writeFileSync(path.join(odd, S5, 'subagents', 'agent-e1.jsonl'), assistant('m5a', U(2, 20, 200), '2026-09-07T10:01:00.000Z'));
    fs.writeFileSync(path.join(tmp, '.planning', 'metrics', '.cost-cursor.json'), JSON.stringify({
      [path.join(odd, `${S5}.jsonl`)]: 3,
      [path.join(odd, S5, 'subagents', 'agent-e1.jsonl')]: 1,
    }));
    const found = discoverSessions(tmp, new Set(), { claudeDir });
    assert.ok(found.sessions.some((s) => s.sessionId === S5), 'reached through the cursor, not the encoded name');
    assert.equal(found.candidateDirs.filter((d) => d.toLowerCase().includes('subagents')).length, 0, 'an agent file key is not a project folder');
  });

  test('planRebuild is a dry run: rows per agent file and per main thread, hook rows superseded, the rest kept, prices as the report does, nothing written', () => {
    const before = fs.readFileSync(ledger, 'utf8');
    const plan = planRebuild(tmp, { claudeDir });
    assert.equal(plan.dry_run, true);
    assert.equal(fs.readFileSync(ledger, 'utf8'), before, 'dry run writes nothing');
    const s1 = plan.sessions.find((s) => s.session === S1);
    assert.equal(s1.agent_files, 3);
    assert.equal(s1.superseded_rows, 3, 'the oversum row and both phantoms');
    assert.equal(s1.rebuilt_rows, 3, 'two agents that ran (the never-ran file yields no row) + the main thread');
    assert.equal(s1.old_cost_usd, 0, 'the old rows were all quarantined or empty — the report showed $0 for them');
    assert.ok(s1.new_cost_usd > 0 && s1.main_thread_cost_usd > 0 && s1.main_thread_cost_usd < s1.new_cost_usd);
    assert.deepEqual(s1.warnings, []);
    assert.deepEqual(plan.kept_rows, { hook_without_transcript: 1, caller: 1 });
    const rows = plan._ledger.filter((r) => r.source === 'rebuild' && r.session === S1);
    const exec = rows.find((r) => r.agent_id === 'a1');
    assert.equal(exec.agent, 'pan-executor', 'typed from the parent\'s Agent tool_use');
    assert.equal(exec.model, 'claude-opus-5');
    assert.equal(exec.tier, 'reasoning');
    assert.equal(exec.cache_read_tokens, 1010000);
    assert.equal(exec.output_tokens, 5200);
    assert.equal(exec.duration_ms, Date.parse('2026-09-02T18:09:00.000Z') - Date.parse('2026-09-02T18:01:00.000Z'));
    assert.equal(exec.token_source, 'agent-transcript');
    assert.equal(exec.v, 4);
    const wf = rows.find((r) => r.agent_id === 'w1');
    assert.equal(wf.agent, 'workflow-subagent');
    assert.equal(wf.command, 'reality-check-audit', 'the Workflow run record names what spawned it');
    assert.equal(wf.model, 'claude-fable-5-1');
    const main = rows.find((r) => r.agent === MAIN_THREAD_AGENT);
    assert.equal(main.token_source, 'session-transcript');
    assert.equal(main.output_tokens, 305, 'msg_2 counted once with its final snapshot');
    assert.equal(main.cache_read_tokens, 3000);
    assert.equal(main.agent_id, null);
    assert.equal(main.ts, '2026-09-02T18:10:03.000Z', 'dated at the session\'s last record');
    for (const r of rows) assert.equal(isSuspectRecord(r), false, 'rebuilt rows are never quarantined');
    const mainS3 = plan._ledger.find((r) => r.session === S3 && r.agent === MAIN_THREAD_AGENT);
    assert.equal(mainS3.output_tokens, 10, 'the keyed turn plus the unkeyed record');
    assert.match(renderPlan(plan), /DRY RUN[\s\S]*a72c1321  agent files   3  rows   3 →   3/);
  });

  test('--no-main-thread leaves the ledger subagent-only', () => {
    const plan = planRebuild(tmp, { claudeDir, mainThread: false });
    assert.equal(plan._ledger.some((r) => r.agent === MAIN_THREAD_AGENT), false);
    assert.equal(plan.sessions.find((s) => s.session === S1).rebuilt_rows, 2);
  });

  test('an unreadable agent transcript is named in warnings and contributes no row', () => {
    fs.mkdirSync(path.join(projDir, S1, 'subagents', 'agent-dir.jsonl'));
    const plan = planRebuild(tmp, { claudeDir });
    const s1 = plan.sessions.find((s) => s.session === S1);
    assert.equal(s1.agent_files, 4);
    assert.equal(s1.rebuilt_rows, 3);
    assert.match(s1.warnings.join(' '), /agent transcript unreadable: agent-dir\.jsonl/);
    assert.match(renderPlan(plan), /! agent transcript unreadable/);
  });

  test('applyRebuild moves the old ledger aside, writes the rebuilt one, aggregates cleanly, and a re-apply changes nothing', () => {
    const original = fs.readFileSync(ledger, 'utf8');
    const plan = planRebuild(tmp, { claudeDir, apply: true });
    const applied = applyRebuild(tmp, plan);
    assert.equal(applied.written, true);
    assert.ok(applied.backup && fs.existsSync(applied.backup), 'previous ledger kept as evidence');
    assert.equal(fs.readFileSync(applied.backup, 'utf8'), original);
    assert.equal(applied.carried_forward, 0);
    const rows = readRecords(tmp);
    assert.equal(rows.length, 2 + 3 + 2, 'S2 hook row + caller row kept; S1 → 3 rows; S3 → agent + main thread');
    assert.deepEqual(rows.map((r) => r.ts), [...rows.map((r) => r.ts)].sort(), 'written in time order');
    const agg = aggregate(tmp);
    assert.equal(agg.totals.suspect_excluded, 0, 'the 7.5-billion row is gone');
    assert.equal(agg.totals.empty_excluded, 0, 'so are the phantoms');
    assert.equal(agg.totals.calls, 7);
    assert.equal(agg.by_agent['pan-executor'].calls, 1);
    assert.equal(agg.by_agent[MAIN_THREAD_AGENT].calls, 2);
    assert.equal(agg.by_command['reality-check-audit'].calls, 1);
    assert.ok(agg.by_agent.manual, 'caller rows survive');

    const again = applyRebuild(tmp, planRebuild(tmp, { claudeDir, apply: true }));
    assert.equal(again.written, false, 'the same plan writes nothing');
    assert.equal(again.unchanged, true);
    assert.equal(again.backup, null, 'and takes no second backup');
    assert.equal(readRecords(tmp).length, 7);
    assert.equal(fs.readdirSync(path.dirname(ledger)).filter((f) => f.includes('.rebuilt-')).length, 1);
  });

  test('a second apply that does change the ledger keeps the first backup intact under its own name', () => {
    const original = fs.readFileSync(ledger, 'utf8');
    const first = applyRebuild(tmp, planRebuild(tmp, { claudeDir, apply: true }));
    // Something changes between applies: a new agent transcript appears in S3, so a
    // second rebuild has a row to add.
    fs.writeFileSync(path.join(projDir, S3, 'subagents', 'agent-c2.jsonl'), assistant('m3b', U(6, 60, 600), '2026-09-05T11:00:00.000Z'));
    const second = applyRebuild(tmp, planRebuild(tmp, { claudeDir, apply: true }));
    assert.equal(second.written, true);
    assert.notEqual(first.backup, second.backup, 'the second backup gets its own name');
    assert.match(path.basename(second.backup), /\.rebuilt-\d{4}-\d{2}-\d{2}-2$/);
    assert.equal(fs.readFileSync(first.backup, 'utf8'), original, 'the original ledger survives the second apply');
    assert.equal(readRecords(tmp).length, 8);
    assert.ok(readRecords(tmp).some((r) => r.agent_id === 'c2'));
  });

  test('a row a hook appends between planning and applying is carried into the new ledger', () => {
    const plan = planRebuild(tmp, { claudeDir, apply: true });
    const live = { v: 4, ts: '2026-09-09T09:00:00.000Z', agent: 'pan-verifier', agent_id: 'live1', model: 'claude-opus-5', input_tokens: 5, output_tokens: 50, cache_read_tokens: 500, cache_write_tokens: 0, session: 'live-session', source: 'hook', token_source: 'agent-transcript' };
    fs.appendFileSync(ledger, JSON.stringify(live) + '\n');
    const applied = applyRebuild(tmp, plan);
    assert.equal(applied.carried_forward, 1);
    assert.ok(readRecords(tmp).some((r) => r.agent_id === 'live1'), 'the racing row is not lost');
    assert.equal(readRecords(tmp).length, 8);
  });

  test('with nothing to rebuild and no ledger, apply creates no file', () => {
    const bare = createTempProject();
    try {
      const plan = planRebuild(bare, { claudeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pan-empty-')), apply: true });
      assert.equal(plan.sessions.length, 0);
      const applied = applyRebuild(bare, plan);
      assert.equal(applied.written, false);
      assert.equal(fs.existsSync(path.join(bare, '.planning', 'metrics', 'tokens.jsonl')), false);
    } finally { cleanup(bare); }
  });

  test('a project with no transcripts anywhere rebuilds nothing and keeps every row', () => {
    const plan = planRebuild(tmp, { claudeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pan-empty-')) });
    assert.equal(plan.sessions.length, 0);
    assert.equal(plan.totals.new_rows, plan.totals.old_rows);
  });

  test('CLI: `cost rebuild` defaults to a dry run with the row list stripped; --raw prints the table; --apply --no-main-thread writes a subagent-only ledger; unknown subcommands name it', () => {
    const dry = runCli('');
    assert.ok(dry.success, dry.error);
    const plan = JSON.parse(dry.output);
    assert.equal(plan.dry_run, true);
    assert.equal(plan.sessions.length, 2);
    assert.equal(plan._ledger, undefined);
    assert.equal(plan._snapshot, undefined);
    assert.equal(readRecords(tmp).length, 5, 'a dry run writes nothing');
    const raw = runCli('--raw');
    assert.match(raw.output, /^Cost ledger rebuild — DRY RUN/);
    const applied = runCli('--apply --no-main-thread');
    assert.ok(applied.success, applied.error);
    const payload = JSON.parse(applied.output);
    assert.equal(payload.dry_run, false);
    assert.equal(payload.written, true);
    assert.ok(payload.backup && fs.existsSync(payload.backup));
    const rows = readRecords(tmp);
    assert.equal(rows.some((r) => r.agent === MAIN_THREAD_AGENT), false);
    assert.equal(rows.length, 2 + 2 + 1, 'kept rows + two S1 agents + the S3 agent');
    const unknown = runPanTools('cost frobnicate', tmp);
    assert.equal(unknown.success, false);
    assert.match(unknown.error + unknown.output, /Available: report, append, clear, rebuild/);
  });
});
