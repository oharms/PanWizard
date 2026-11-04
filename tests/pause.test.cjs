/**
 * Tests for pause.cjs and pause-schema.cjs — typed pauses for a person's
 * answer (durable orchestration Stage D) — and for what they feed: next-action,
 * open_work, autodev's human_needed stop, the merge gate's expiry and the MCP
 * pause tools.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'pan-wizard-core', 'bin', 'lib');
const S = require(path.join(LIB, 'pause-schema.cjs'));
const P = require(path.join(LIB, 'pause.cjs'));
const { openWork } = require(path.join(LIB, 'open-work.cjs'));
const gate = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'merge-gate.cjs'));
const { NATIVE_TOOLS } = require(path.join(ROOT, 'pan-wizard-core', 'mcp', 'native-tools.cjs'));
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-pause-'));
  fs.mkdirSync(path.join(dir, '.planning'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const tools = (...args) => {
  const r = spawnSync(process.execPath, [TOOLS, ...args], { cwd: dir, encoding: 'utf-8' });
  return { status: r.status, json: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null, stdout: r.stdout.trim() };
};

describe('pause-schema', () => {
  test('schemaProblem accepts each type and names what is wrong otherwise', () => {
    assert.equal(S.schemaProblem({ type: 'enum', values: ['a', 'b'], noteFor: ['b'] }), null);
    assert.equal(S.schemaProblem({ type: 'string', pattern: '^v\\d', maxLength: 10 }), null);
    assert.equal(S.schemaProblem({ type: 'boolean' }), null);
    assert.equal(S.schemaProblem({ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }), null);
    assert.match(S.schemaProblem({ type: 'enum', values: [] }), /non-empty/);
    assert.match(S.schemaProblem({ type: 'enum', values: ['a'], noteFor: ['z'] }), /noteFor/);
    assert.match(S.schemaProblem({ type: 'string', pattern: '(' }), /regular expression/);
    assert.match(S.schemaProblem({ type: 'object', properties: { a: { type: 'object' } } }), /cannot nest/);
    assert.match(S.schemaProblem({ type: 'number' }), /type must be/);
  });

  test('validateAnswer: enum values, per-value notes, strings, booleans, objects', () => {
    const verify = { type: 'enum', values: ['approved', 'issues'], noteFor: ['issues'] };
    assert.equal(S.validateAnswer(verify, { value: 'approved' }), null);
    assert.deepEqual(S.validateAnswer(verify, { value: 'maybe' }).allowed, ['approved', 'issues']);
    assert.match(S.validateAnswer(verify, { value: 'issues' }).problem, /needs a --note/);
    assert.equal(S.validateAnswer(verify, { value: 'issues', note: 'the button is off' }), null);
    assert.match(S.validateAnswer({ type: 'string', pattern: '^v\\d' }, { value: 'x1' }).problem, /must match/);
    assert.match(S.validateAnswer({ type: 'string' }, { value: '   ' }).problem, /non-empty/);
    assert.equal(S.validateAnswer({ type: 'boolean' }, { value: false }), null);
    const obj = { type: 'object', required: ['reason'], properties: { reason: { type: 'string' }, ok: { type: 'boolean' } } };
    assert.equal(S.validateAnswer(obj, { value: { reason: 'r', ok: true } }), null);
    assert.match(S.validateAnswer(obj, { value: { ok: true } }).problem, /reason is required/);
    assert.match(S.validateAnswer(obj, { value: { reason: 'r', extra: 'x' } }).problem, /not a field/);
  });
});

describe('open, answer, cancel', () => {
  test('a decision pause offers its options; one of them is recorded as is', () => {
    const o = P.openPause(dir, { kind: 'decision', run: '03-02', step: 'task-4', question: 'Which store?', options: ['redis', 'sqlite'] });
    assert.equal(o.opened, true);
    assert.equal(o.pause.id, 'p-decision-03-02-task-4');
    assert.equal(o.pause.status, 'open');
    const ok = P.answerPause(dir, o.pause.id, { value: 'sqlite' });
    assert.equal(ok.answered, true);
    assert.equal(ok.pause.answer, 'sqlite');
    assert.equal(ok.pause.own_words, undefined, 'an offered option is not marked');
    assert.ok(ok.pause.answered_at);
  });

  // 3.41.3: the person answering has the last word. An answer outside the options used to be
  // refused and the model told to ask again, so a user who answered in their own words was overruled.
  test("an answer in the person's own words is recorded as given, marked own_words, never refused", () => {
    const d = P.openPause(dir, { kind: 'decision', question: 'Which store?', options: ['redis', 'sqlite'] });
    const mine = P.answerPause(dir, d.pause.id, { value: 'neither: use the postgres we already run' });
    assert.equal(mine.answered, true);
    assert.equal(mine.pause.answer, 'neither: use the postgres we already run');
    assert.equal(mine.pause.own_words, true);
    const v = P.openPause(dir, { kind: 'human-verify', question: 'Check the page' });
    const issues = P.answerPause(dir, v.pause.id, { value: 'issues' });
    assert.equal(issues.answered, true, "issues without a note is still the person's answer");
    assert.equal(issues.pause.own_words, true);
    const a = P.openPause(dir, { kind: 'human-action', question: 'Log in to the dashboard' });
    assert.equal(P.answerPause(dir, a.pause.id, { value: 'cannot, skip it' }).pause.answer, 'cannot, skip it');
  });

  test('an empty or oversized answer is still refused, and leaves the pause open', () => {
    const o = P.openPause(dir, { kind: 'decision', question: 'Which?', options: ['a', 'b'] });
    const empty = P.answerPause(dir, o.pause.id, { value: '   ' });
    assert.equal(empty.error, 'pause_answer_invalid');
    assert.deepEqual(empty.allowed, ['a', 'b']);
    assert.equal(P.answerPause(dir, o.pause.id, { value: 'x'.repeat(2001) }).error, 'pause_answer_invalid');
    assert.equal(P.readPause(dir, o.pause.id).status, 'open', 'a refused answer leaves it open');
  });

  test('an answered pause is final: a second answer or a cancel is illegal_transition', () => {
    const o = P.openPause(dir, { kind: 'human-action', question: 'Log in to the dashboard' });
    P.answerPause(dir, o.pause.id, { value: 'done' });
    assert.equal(P.answerPause(dir, o.pause.id, { value: 'done' }).error, 'illegal_transition');
    assert.equal(P.cancelPause(dir, o.pause.id, 'changed my mind').error, 'illegal_transition');
  });

  test('opening the same open question again returns the open pause; after an answer it opens a new one', () => {
    const a = P.openPause(dir, { kind: 'human-verify', run: '01-01', step: 'task-2', question: 'Check the page' });
    const again = P.openPause(dir, { kind: 'human-verify', run: '01-01', step: 'task-2', question: 'Check the page' });
    assert.equal(again.existing, true);
    assert.equal(again.pause.id, a.pause.id);
    P.answerPause(dir, a.pause.id, { value: 'approved' });
    const next = P.openPause(dir, { kind: 'human-verify', run: '01-01', step: 'task-2', question: 'Check it again' });
    assert.equal(next.pause.id, `${a.pause.id}-2`);
  });

  test('refusals: unknown kind, no question, decision without options, bad expects', () => {
    assert.equal(P.openPause(dir, { kind: 'vibe', question: 'q' }).error, 'invalid_kind');
    assert.equal(P.openPause(dir, { kind: 'human-action' }).error, 'question_required');
    assert.equal(P.openPause(dir, { kind: 'decision', question: 'q' }).error, 'expects_required');
    assert.equal(P.openPause(dir, { kind: 'decision', question: 'q', expects: { type: 'enum', values: [] } }).error, 'invalid_expects');
    assert.equal(P.answerPause(dir, 'p-nothing', { value: 'x' }).error, 'pause_not_found');
  });

  test('an expired pause refuses its answer and is recorded expired', () => {
    const o = P.openPause(dir, { kind: 'human-action', question: 'q', ttlHours: 1e-9 });
    const r = P.answerPause(dir, o.pause.id, { value: 'done' });
    assert.equal(r.error, 'pause_expired');
    assert.equal(P.readPause(dir, o.pause.id).status, 'expired');
  });

  test('orchestration.pause_ttl_hours sets expires_at', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ orchestration: { pause_ttl_hours: 2 } }));
    const o = P.openPause(dir, { kind: 'human-action', question: 'q' });
    const ms = Date.parse(o.pause.expires_at) - Date.parse(o.pause.created_at);
    assert.equal(ms, 2 * 3600000);
  });

  test('pause cancel needs a reason', () => {
    const o = P.openPause(dir, { kind: 'human-action', question: 'q' });
    assert.equal(P.cancelPause(dir, o.pause.id, '').error, 'reason_required');
    assert.equal(P.cancelPause(dir, o.pause.id, 'done another way').pause.status, 'cancelled');
  });
});

describe('the CLI', () => {
  test('pause open / answer / list with --raw answers; an empty answer exits 1, an off-list one is kept', () => {
    assert.equal(tools('pause', 'open', '--kind', 'decision', '--question', 'Which?', '--options', 'a,b', '--raw').stdout, 'p-decision');
    const bad = tools('pause', 'answer', 'p-decision', '--value', ' ');
    assert.equal(bad.status, 1);
    assert.equal(bad.json.error, 'pause_answer_invalid');
    const mine = tools('pause', 'answer', 'p-decision', '--value', 'c, not a or b');
    assert.equal(mine.status, 0);
    assert.equal(mine.json.pause.own_words, true);
    assert.equal(tools('pause', 'open', '--kind', 'decision', '--question', 'Again?', '--options', 'a,b', '--raw').stdout, 'p-decision-2');
    assert.equal(tools('pause', 'answer', 'p-decision-2', '--value', 'b', '--raw').stdout, 'answered');
    assert.equal(tools('pause', 'list', '--raw').stdout, '2');
    assert.equal(tools('pause', 'nope').status, 1);
  });

  test('next-action asks an open pause before any other work, and open_work lists it', () => {
    tools('pause', 'open', '--kind', 'human-verify', '--run', '02-01', '--step', 'task-3', '--question', 'Does the chart render?');
    const r = tools('next-action');
    assert.equal(r.json.action, 'answer_pause');
    assert.equal(r.json.pause.id, 'p-human-verify-02-01-task-3');
    assert.match(r.json.command, /pan-tools pause answer p-human-verify-02-01-task-3 --value <approved\|issues>/);
    const ow = openWork(dir);
    assert.equal(ow.pauses.length, 1);
    assert.equal(ow.in_flight, false, 'a question is not work in flight for the guard');
  });
});

describe('autodev human_needed', () => {
  test('the stop opens an autodev-human pause, and no run starts until it is answered', () => {
    const autodev = require(path.join(LIB, 'autodev.cjs'));
    const r = autodev.runAutodev(dir, { host: 'claude', maxUsd: 1, execute: () => ({ exit: 0, cost_usd: 0 }) });
    assert.equal(r.stop.reason, 'human_needed', JSON.stringify(r));
    const open = P.listPauses(dir, { open: true });
    assert.equal(open.length, 1);
    assert.equal(open[0].kind, 'autodev-human');
    const again = autodev.runAutodev(dir, { host: 'claude', maxUsd: 1, execute: () => ({ exit: 0, cost_usd: 0 }) });
    assert.equal(again.error, 'pause_open');
    assert.equal(again.pause, open[0].id);
    P.answerPause(dir, open[0].id, { value: 'created the roadmap with /pan:new-project' });
    const third = autodev.runAutodev(dir, { host: 'claude', maxUsd: 1, execute: () => ({ exit: 0, cost_usd: 0 }) });
    assert.notEqual(third.error, 'pause_open');
  });
});

describe('merge gate expiry', () => {
  test('a request records requested_at and expires_at (72 h by default); past it, approval_expired', () => {
    const rec = gate.requestMerge(dir, { branch: 'army/x', ci_green: true, verify_pass: true, now: '2026-11-02T00:00:00.000Z' });
    assert.equal(rec.requested_at, '2026-11-02T00:00:00.000Z');
    assert.equal(rec.expires_at, '2026-11-05T00:00:00.000Z');
    const env = { PAN_MERGE_APPROVAL: rec.approval_token };
    assert.ok(gate.evaluateMerge(dir, { branch: 'army/x', nowMs: Date.parse('2026-11-04T00:00:00Z') }, env).allowed);
    const late = gate.evaluateMerge(dir, { branch: 'army/x', nowMs: Date.parse('2026-11-06T00:00:00Z') }, env);
    assert.equal(late.allowed, false);
    assert.ok(late.reasons.includes('approval_expired'));
  });

  test('approval_ttl_hours 0 never expires; a confirmed merge records approved_at', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ orchestration: { approval_ttl_hours: 0 } }));
    const rec = gate.requestMerge(dir, { branch: 'army/y', ci_green: true, verify_pass: true });
    assert.equal(rec.expires_at, undefined);
    const r = gate.confirmMerge(dir, { branch: 'army/y' }, { PAN_MERGE_APPROVAL: rec.approval_token }, () => ({ ok: true, stdout: '', stderr: '' }));
    assert.equal(r.merged, true);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'orchestration', 'approvals', 'army-y.json'), 'utf-8'));
    assert.ok(saved.approved_at);
  });
});

describe('MCP pause tools', () => {
  const tool = (name) => NATIVE_TOOLS.find((t) => t.name === name);

  test("pan_list_pauses is read-only; pan_answer_pause keeps the person's words", () => {
    assert.equal(tool('pan_list_pauses').readOnly, true);
    assert.equal(tool('pan_answer_pause').destructive, false);
    const o = P.openPause(dir, { kind: 'decision', question: 'Which?', options: ['a', 'b'] });
    assert.equal(tool('pan_list_pauses').handler({ cwd: dir, input: { open: true } }).json.pauses.length, 1);
    const bad = tool('pan_answer_pause').handler({ cwd: dir, input: { id: o.pause.id, value: '' } });
    assert.equal(bad.json.error, 'pause_answer_invalid');
    assert.equal(bad.isError, false, 'an invalid answer is a normal result to read');
    const ok = tool('pan_answer_pause').handler({ cwd: dir, input: { id: o.pause.id, value: 'z, my own choice' } });
    assert.equal(ok.json.answered, true);
    assert.equal(ok.json.pause.own_words, true);
  });
});

describe('prompt contracts', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

  test('exec-phase and execute-plan open a pause for a checkpoint and record the answer through it', () => {
    for (const f of ['pan-wizard-core/workflows/exec-phase.md', 'pan-wizard-core/workflows/execute-plan.md']) {
      const t = read(f);
      assert.match(t, /pause open --kind <human-verify\|decision\|human-action>/, f);
      assert.match(t, /pause answer .+--value <approved\|issues\|done\|option-id>/, f);
    }
  });

  test('progress and resume handle answer_pause first', () => {
    assert.match(read('pan-wizard-core/workflows/progress.md'), /When `action` is `answer_pause`/);
    assert.match(read('pan-wizard-core/workflows/resume-project.md'), /- `pauses`:/);
  });
});

describe('hygiene H-15: durable state left behind', () => {
  const H = require(path.join(LIB, 'hygiene.cjs'));
  const J = require(path.join(LIB, 'journal.cjs'));

  test('a pause open for a week and a journaled plan quiet for a day with no summary are reported', () => {
    P.openPause(dir, { kind: 'human-action', question: 'Log in to the dashboard' });
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-a', '01-01-plan.md'), '<task type="auto">x</task>\n');
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-a', `01-01${J.JOURNAL_SUFFIX}`), JSON.stringify({ seq: 1, ts: new Date().toISOString(), step: 'task-1', event: 'started' }) + '\n');
    assert.deepEqual(H.checkDurableState(dir).findings, [], 'nothing is stale yet');
    const found = H.checkDurableState(dir, Date.now() + 8 * 86400000).findings;
    assert.deepEqual(found.map((f) => f.check).sort(), ['journal-abandoned', 'pause-open-stale']);
    assert.ok(found.every((f) => f.severity === 'info' && f.fixable === false), 'report-only');
  });

  test('a plan with a summary is never reported, however old its journal', () => {
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-a'), { recursive: true });
    for (const n of ['01-01-plan.md', '01-01-summary.md']) fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-a', n), 'x\n');
    fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-a', `01-01${J.JOURNAL_SUFFIX}`), JSON.stringify({ seq: 1, ts: '2026-01-01T00:00:00Z', step: 'task-1', event: 'started' }) + '\n');
    assert.deepEqual(H.checkDurableState(dir, Date.now()).findings, []);
  });
});
