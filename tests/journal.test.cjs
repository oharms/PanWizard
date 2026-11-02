/**
 * Tests for journal.cjs — the step journal a plan resumes from (durable
 * orchestration Stage C), its use in open_work, focus cycles and the prompts.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'pan-wizard-core', 'bin', 'lib');
const J = require(path.join(LIB, 'journal.cjs'));
const { openWork } = require(path.join(LIB, 'open-work.cjs'));
const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let dir;
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const commit = (file, msg) => { write(file, msg + '\n'); git('add', file); git('commit', '-qm', msg); return git('rev-parse', '--short', 'HEAD'); };
const PLAN = '.planning/phases/03-api/03-02-plan.md';
const tools = (...args) => {
  const r = spawnSync(process.execPath, [TOOLS, ...args], { cwd: dir, encoding: 'utf-8' });
  return { status: r.status, json: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null, stdout: r.stdout };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-journal-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  write(PLAN, '---\nphase: 03\nplan: 02\n---\n<task type="auto">one</task>\n<task type="auto">two</task>\n<task type="auto">three</task>\n');
  commit('README.md', 'init');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('resolvePlan', () => {
  test('takes a plan id or a plan path, and names the journal beside the plan', () => {
    const byId = J.resolvePlan(dir, '03-02');
    const byPath = J.resolvePlan(dir, PLAN);
    assert.equal(byId.id, '03-02');
    assert.equal(byId.plan, PLAN);
    assert.deepEqual(byPath, byId);
    assert.equal(byId.journal, path.join(dir, '.planning/phases/03-api/03-02-journal.jsonl'));
  });

  test('an unknown plan is plan_not_found', () => {
    assert.equal(J.resolvePlan(dir, '09-01').error, 'plan_not_found');
    assert.equal(J.resolvePlan(dir, null).error, 'plan_required');
  });
});

describe('journal step', () => {
  test('records events with seq, and a completed step with its commit', () => {
    const a = commit('a.txt', 'task one');
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'started' }).seq, 1);
    const r = J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: a, by: 'pan-executor' });
    assert.equal(r.recorded, true);
    assert.equal(r.seq, 2);
    const rows = J.readJournal(J.resolvePlan(dir, '03-02').journal);
    assert.deepEqual(rows[1].artifact, { commit: a });
    assert.equal(rows[1].by, 'pan-executor');
  });

  test('a completed step needs an artifact; an unknown commit or event is refused', () => {
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed' }).error, 'artifact_required');
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: 'deadbeef' }).error, 'commit_unknown');
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'done' }).error, 'invalid_event');
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'bad step!', event: 'started' }).error, 'step_required');
  });

  test('a completed step is final: starting it again is illegal_transition, unless a forced line overrides', () => {
    const a = commit('a.txt', 'task one');
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: a });
    const r = J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'started' });
    assert.equal(r.error, 'illegal_transition');
    assert.equal(r.step, 'task-1');
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'forced', note: 'redo after review' }).recorded, true);
    assert.equal(J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'started' }).recorded, true);
  });

  test('a file artifact records the file\'s hash', () => {
    write('docs/x.md', 'v1\n');
    const r = J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', file: 'docs/x.md' });
    assert.equal(r.recorded, true);
    const row = J.readJournal(J.resolvePlan(dir, '03-02').journal)[0];
    assert.equal(row.artifact.file, 'docs/x.md');
    assert.match(row.artifact.sha1, /^[0-9a-f]{40}$/);
  });
});

describe('resume point', () => {
  test('no journal: no resume_at, so the plan restarts at its first task as before', () => {
    const r = J.resumePoint(dir, '03-02');
    assert.equal(r.journal, null);
    assert.equal(r.resume_at, null);
    assert.equal(r.tasks, 3);
  });

  test('after two proven tasks it resumes at task-3', () => {
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: commit('a.txt', 'one') });
    J.journalStep(dir, { plan: '03-02', step: 'task-2', event: 'completed', commit: commit('b.txt', 'two') });
    const r = J.resumePoint(dir, '03-02');
    assert.equal(r.resume_at, 'task-3');
    assert.deepEqual(r.completed.map((c) => c.step), ['task-1', 'task-2']);
    assert.equal(r.all_done, false);
  });

  test('a task recorded done whose commit is no longer reachable is unverified and resumed', () => {
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: commit('a.txt', 'one') });
    const lost = commit('b.txt', 'two');
    J.journalStep(dir, { plan: '03-02', step: 'task-2', event: 'completed', commit: lost });
    git('reset', '-q', '--hard', 'HEAD~1'); // the crash took task-2's commit with it
    const r = J.resumePoint(dir, '03-02');
    assert.equal(r.resume_at, 'task-2');
    assert.deepEqual(r.unverified.map((u) => u.step), ['task-2']);
    assert.match(r.unverified[0].why, /not reachable/);
  });

  test('a file changed since it was recorded is unverified', () => {
    write('docs/x.md', 'v1\n');
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', file: 'docs/x.md' });
    write('docs/x.md', 'v2\n');
    const r = J.resumePoint(dir, '03-02');
    assert.equal(r.resume_at, 'task-1');
    assert.match(r.unverified[0].why, /changed/);
  });

  test('every task proven: all_done', () => {
    for (const n of [1, 2, 3]) J.journalStep(dir, { plan: '03-02', step: `task-${n}`, event: 'completed', commit: commit(`f${n}.txt`, `t${n}`) });
    const r = J.resumePoint(dir, '03-02');
    assert.equal(r.all_done, true);
    assert.equal(r.resume_at, null);
  });
});

describe('the CLI', () => {
  test('journal step / resume-point / show, with --raw answers', () => {
    const a = commit('a.txt', 'one');
    assert.equal(tools('journal', 'step', '--plan', '03-02', '--step', 'task-1', '--event', 'completed', '--commit', a, '--raw').stdout.trim(), '1');
    assert.equal(tools('journal', 'resume-point', '--plan', '03-02', '--raw').stdout.trim(), 'task-2');
    const show = tools('journal', 'show', '--plan', '03-02');
    assert.equal(show.json.entries.length, 1);
    const bad = tools('journal', 'nope');
    assert.equal(bad.status, 1);
  });
});

describe('open_work', () => {
  test('an unfinished plan with a journal carries resume_at and its proven steps', () => {
    J.journalStep(dir, { plan: '03-02', step: 'task-1', event: 'completed', commit: commit('a.txt', 'one') });
    const p = openWork(dir).phase_plans.find((x) => x.plan.endsWith('03-02-plan.md'));
    assert.equal(p.resume_at, 'task-2');
    assert.equal(p.completed_steps[0].step, 'task-1');
    assert.deepEqual(p.unverified_steps, []);
  });

  test('a plan without a journal is listed as before, with no resume fields', () => {
    const p = openWork(dir).phase_plans.find((x) => x.plan.endsWith('03-02-plan.md'));
    assert.equal(p.resume_at, undefined);
  });
});

describe('focus cycles journal themselves', () => {
  test('focus open records the cycle started; focus close records it completed with the summary', () => {
    const focus = require(path.join(LIB, 'focus.cjs'));
    write('.planning/state.md', '# Project State\n');
    write('.planning/focus/batch-2026-11-02.json', JSON.stringify({ date: '2026-11-02', batch: [{ id: 'P1-1', title: 'x', file: 'src/a.js', tier: 'MICRO' }] }));
    const opened = focus.focusOpen(dir, { kind: 'docs', batch: '.planning/focus/batch-2026-11-02.json' });
    const plan = opened.plan;
    assert.equal(J.readJournal(J.resolvePlan(dir, plan).journal)[0].event, 'started');
    focus.focusClose(dir, { dir: opened.dir, status: 'verified', done: ['P1-1'], measure: false });
    const rows = J.readJournal(J.resolvePlan(dir, plan).journal);
    assert.equal(rows[1].event, 'completed');
    assert.match(rows[1].artifact.file, /-summary\.md$/);
  });
});

describe('prompt contracts', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

  test('the executor journals each task commit and resumes from the journal', () => {
    const ex = read('agents/pan-executor.md');
    assert.match(ex, /pan-tools\.cjs journal step --plan \{phase\}-\{plan\} --step task-N --event completed --commit \$TASK_COMMIT/);
    assert.match(ex, /journal resume-point --plan \{phase\}-\{plan\}/);
  });

  test('execute-plan journals tasks and starts a journaled plan at resume_at', () => {
    const ep = read('pan-wizard-core/workflows/execute-plan.md');
    assert.match(ep, /journal step --plan "\$\{PHASE\}-\$\{PLAN\}" --step "task-\$\{TASK_NUM\}" --event completed/);
    assert.match(ep, /journal resume-point --plan <phase>-<plan>/);
  });

  test('resume reads resume_at from open_work', () => {
    assert.match(read('pan-wizard-core/workflows/resume-project.md'), /`resume_at`/);
  });
});
