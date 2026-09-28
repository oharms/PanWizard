/**
 * optimize learn reads the evidence loop's signal (EL-10).
 *
 * The trace now carries runtime-captured tool failures (error/tool_error, from the
 * hook) and judge verdicts (verdict_*, from `findings record`). The analysis has to
 * turn them into something the optimizer can act on: failures grouped the way a
 * lesson would be, and ranked by recurrence across spawns and sessions, because one
 * run's accident is not a lesson. It must also keep reading the legacy
 * verdict categories that older sessions hold.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analyzeEvents, deriveActionsFromAnalysis } = require('../pan-wizard-core/bin/lib/optimize.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const toolError = (session, agentId, over = {}) => ({
  v: 5, ts: `2026-09-28T10:0${agentId.length % 10}:00.000Z`, session, agent: 'pan-executor', phase: '03', type: 'error', category: 'tool_error',
  description: 'pan-executor: Bash failed (exit_code)', impact: 'minor',
  context: { tool: 'Bash', error_class: 'exit_code', exit_code: 1, message: 'npm error Test failed.', message_sig: 'aaaaaaaaaaaa', count: 1, agent_id: agentId, ...over },
});
const completion = (session, agentId, toolErrors) => ({
  v: 5, ts: '2026-09-28T10:00:00.000Z', session, agent: 'pan-executor', type: 'decision', category: 'agent_completion',
  context: { agent_id: agentId, input_tokens: 10, output_tokens: 5, tool_calls: 4, tool_errors: toolErrors },
});
const verdict = (category, agent, over = {}) => ({ ts: '2026-09-28T11:00:00.000Z', session: 's1', agent, type: category === 'verdict_failed' ? 'error' : 'decision', category, context: { agent, ...over } });

describe('analysis — tool failures ranked by recurrence', () => {
  const events = [
    completion('s1', 'a1', 2), toolError('s1', 'a1', { count: 2 }),
    completion('s2', 'a2', 1), toolError('s2', 'a2'),
    completion('s2', 'a3', 1), toolError('s2', 'a3', { tool: 'Read', error_class: 'not_found', exit_code: null, message: 'File does not exist.', message_sig: 'bbbbbbbbbbbb' }),
    completion('s2', 'a4', 0),
  ];

  test('the same failure in two spawns and two sessions is one pattern, ranked first', () => {
    const a = analyzeEvents(events, {});
    assert.deepEqual(a.tool_error_patterns.map((p) => [p.tool, p.error_class, p.spawns, p.sessions, p.occurrences]), [
      ['Bash', 'exit_code', 2, 2, 3],
      ['Read', 'not_found', 1, 1, 1],
    ]);
    assert.equal(a.tool_error_patterns[0].message, 'npm error Test failed.');
  });

  test('the summary counts failures, patterns and the spawns that had any', () => {
    const s = analyzeEvents(events, {}).summary;
    assert.deepEqual([s.tool_errors, s.tool_error_patterns, s.spawns_measured, s.spawns_with_tool_errors], [4, 2, 4, 3]);
  });

  test('only a failure that recurs across spawns becomes a suggestion', () => {
    const actions = deriveActionsFromAnalysis(analyzeEvents(events, {}));
    const notes = actions.filter((x) => /Recurring tool failure/.test(x.description));
    assert.equal(notes.length, 1, 'the Bash failure (2 spawns) — not the one-off Read');
    assert.match(notes[0].content, /failed with "npm error Test failed\." in 2 spawns across 2 session\(s\)/);
    assert.equal(notes[0].target, '.planning/memory/');
  });
});

describe('analysis — judge verdicts, new and legacy', () => {
  test('verdict_stats counts outcomes per judge, retries, and the retries that resolved a failure', () => {
    const a = analyzeEvents([
      verdict('verdict_failed', 'pan-verifier'),
      { ts: '2026-09-28T12:00:00.000Z', session: 's1', agent: 'pan-verifier', type: 'correction', category: 'verdict_retry', context: { agent: 'pan-verifier', attempt: 2, previous_outcome: 'fail', outcome: 'pass' } },
      verdict('verdict_passed', 'pan-verifier'),
      verdict('verdict_needs_human', 'pan-verifier'),
      verdict('verdict_failed', 'pan-reviewer'),
    ], {});
    assert.deepEqual(a.verdict_stats['pan-verifier'], { pass: 1, fail: 1, needs_human: 1, retries: 1, resolved_by_retry: 1 });
    assert.deepEqual(a.verdict_stats['pan-reviewer'], { pass: 0, fail: 1, needs_human: 0, retries: 0, resolved_by_retry: 0 });
    assert.equal(a.summary.verdict_failures, 2);
    assert.equal(a.summary.verdict_retries, 1);
  });

  test('legacy categories from older sessions are read as their judge\'s verdicts', () => {
    const legacy = ['verification_gaps', 'verification_passed', 'plan_verified', 'plan_checker_issues', 'reviewer_correction', 'reviewer_warnings']
      .map((category) => ({ ts: '2026-08-01T00:00:00.000Z', session: 'old', agent: 'orchestrator', type: /gaps|issues|correction/.test(category) ? 'error' : 'decision', category }));
    const a = analyzeEvents(legacy, {});
    assert.deepEqual(a.verdict_stats['pan-verifier'], { pass: 1, fail: 1, needs_human: 0, retries: 0, resolved_by_retry: 0 });
    assert.deepEqual([a.verdict_stats['pan-plan-checker'].pass, a.verdict_stats['pan-plan-checker'].fail], [1, 1]);
    assert.deepEqual([a.verdict_stats['pan-reviewer'].pass, a.verdict_stats['pan-reviewer'].fail], [1, 1]);
    assert.deepEqual(a.tool_error_patterns, []);
  });

  test('reviewer corrections count the legacy category and the reviewer\'s failed verdict alike', () => {
    const a = analyzeEvents([
      { ts: 't', session: 's', agent: 'pan-reviewer', type: 'error', category: 'reviewer_correction' },
      verdict('verdict_failed', 'pan-reviewer'),
      verdict('verdict_failed', 'pan-verifier'),
    ], {});
    assert.equal(a.summary.reviewer_corrections, 2);
  });

  test('a judge that failed twice or more gets a suggestion pointing at its recorded findings', () => {
    const actions = deriveActionsFromAnalysis(analyzeEvents([verdict('verdict_failed', 'pan-plan-checker'), verdict('verdict_failed', 'pan-plan-checker')], {}));
    const note = actions.find((x) => x.description === 'Repeated judge failures: pan-plan-checker');
    assert.ok(note);
    assert.match(note.content, /findings list --agent pan-plan-checker/);
  });
});

describe('optimize learn --sessions <n> pools the last n sessions', () => {
  let dir;
  const traces = () => path.join(dir, '.planning', 'optimization', 'traces');
  function session(id, startedAt, events) {
    const d = path.join(traces(), id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify({ session_id: id, started_at: startedAt }));
    fs.writeFileSync(path.join(d, 'trace.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  beforeEach(() => {
    dir = createTempProject();
    session('sess_old', '2026-09-20T00:00:00.000Z', [toolError('sess_old', 'x0', { tool: 'Grep', message_sig: 'cccccccccccc' })]);
    session('sess_mid', '2026-09-26T00:00:00.000Z', [toolError('sess_mid', 'x1')]);
    session('sess_new', '2026-09-28T00:00:00.000Z', [toolError('sess_new', 'x2')]);
    fs.writeFileSync(path.join(dir, '.planning', 'optimization', 'current-session'), 'sess_new\n');
  });
  afterEach(() => cleanup(dir));

  test('--sessions 2 analyses the two newest sessions together and names them', () => {
    const r = runPanTools('optimize learn --sessions 2', dir);
    assert.equal(r.success, true, r.error);
    const json = JSON.parse(r.output);
    assert.deepEqual(json.pooled_sessions, ['sess_mid', 'sess_new']);
    assert.deepEqual(json.top_tool_error_patterns.map((p) => [p.tool, p.spawns, p.sessions]), [['Bash', 2, 2]], 'the old session\'s Grep failure is outside the window');
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'optimization', 'reports', 'pooled-2-sess_new-analysis.json')), true);
  });

  test('--sessions 1 is the single current session, as before', () => {
    const json = JSON.parse(runPanTools('optimize learn --sessions 1', dir).output);
    assert.equal(json.session_id, 'sess_new');
    assert.equal(json.pooled_sessions, undefined);
    assert.equal(json.summary.tool_errors, 1);
  });

  test('--sessions larger than the history pools what exists', () => {
    assert.deepEqual(JSON.parse(runPanTools('optimize learn --sessions 9', dir).output).pooled_sessions, ['sess_old', 'sess_mid', 'sess_new']);
  });

  test('--sessions that is not a whole number of sessions exits 1', () => {
    for (const bad of ['0', 'two', '1.5']) {
      const r = runPanTools(`optimize learn --sessions ${bad}`, dir);
      assert.equal(r.success, false, bad);
      assert.match(JSON.parse(r.output).error, /--sessions must be a whole number/);
    }
  });
});
