/**
 * Focus cycles registered as quick tasks (spec focus_phase_integration_featureai.md,
 * Stage A): `focus open` and `focus close`, the measured test counts `focus auto
 * --update` reads back, `--stop` closing an open cycle, the guard seeing an open
 * cycle as work in flight on every hook host, and the focus prompts bracketing their
 * edits and committing through the commit verb.
 */
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const focus = require('../pan-wizard-core/bin/lib/focus.cjs');
const G = require('../hooks/pan-guard.js');

const ROOT = path.join(__dirname, '..');
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const json = (r) => JSON.parse(r.output);

const STATE = '# Project State\n\n## Current Position\n\n**Last Activity:** 2026-10-01\n**Last Activity Description:** started\n\n### Blockers/Concerns\n\nNone\n';
const BATCH = {
  date: '2026-10-31', mode: 'balanced', budget: 10, allocated: 6,
  batch: [
    { id: 'P1-1', title: 'Guard readdir', file: 'src/a.js', tier: 'MICRO', status: 'active' },
    { id: 'P2-2', title: 'Two files', files: ['src/b.js', 'lib/c.js'], tier: 'STANDARD' },
    { id: 'phase-2', title: 'Phase 2: API', source: 'phase', file: '.planning/phases/02-api', tier: 'FULL' },
    { id: 'todo-fix-login.md', title: 'Fix login', source: 'todo', file: '.planning/todos/pending/fix-login.md', tier: 'MICRO' },
  ],
};

// A test command whose pass count is whatever count.txt says: the measurement is real
// (test-gate runs it and parses Node's spec summary), the number is the fixture's.
function withSuite(dir, count) {
  write(dir, 't.cjs', "const n=require('fs').readFileSync(__dirname+'/count.txt','utf8').trim();console.log('\\u2139 tests '+n+'\\n\\u2139 pass '+n+'\\n\\u2139 fail 0');\n");
  write(dir, 'count.txt', String(count));
  write(dir, '.planning/config.json', JSON.stringify({ workflow: { test_command: 'node t.cjs' } }));
}

function seed(dir, { batch = BATCH, count = 5 } = {}) {
  write(dir, '.planning/state.md', STATE);
  write(dir, '.planning/todos/pending/fix-login.md', '---\ntitle: Fix login\n---\nThe login button.\n');
  if (batch) write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify(batch, null, 2));
  if (count != null) withSuite(dir, count);
}

// A TAP suite: `pass.txt` passing tests, one failing test per line of `fail.txt`.
function withTapSuite(dir, pass, failing = []) {
  write(dir, 'tap.cjs', [
    "const fs=require('fs');const p=Number(fs.readFileSync(__dirname+'/pass.txt','utf8'));",
    "const f=fs.readFileSync(__dirname+'/fail.txt','utf8').split('\\n').filter(Boolean);let n=0;",
    "for(let i=0;i<p;i++)console.log('ok '+(++n)+' - pass '+i);for(const x of f)console.log('not ok '+(++n)+' - '+x);",
    "console.log('# tests '+(p+f.length)+'\\n# pass '+p+'\\n# fail '+f.length);process.exit(f.length?1:0);",
  ].join('\n'));
  write(dir, 'pass.txt', String(pass));
  write(dir, 'fail.txt', failing.join('\n'));
  write(dir, '.planning/config.json', JSON.stringify({ workflow: { test_command: 'node tap.cjs' } }));
}

const git = (dir, cmd) => execSync(`git ${cmd}`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function gitInit(dir) {
  git(dir, 'init -q');
  git(dir, 'config user.email t@example.com');
  git(dir, 'config user.name t');
  git(dir, 'config commit.gpgsign false');
  write(dir, 'src/a.js', 'a\n');
  git(dir, 'add -A');
  git(dir, 'commit -qm init');
}

const cycleDir = (dir) => fs.readdirSync(path.join(dir, '.planning', 'quick')).find((n) => /-focus-/.test(n));

describe('focus open', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  test('registers a quick task numbered after /pan:quick\'s, with the items and only source paths', () => {
    seed(dir);
    fs.mkdirSync(path.join(dir, '.planning', 'quick', '3-fix-typo'), { recursive: true });
    const r = runPanTools('focus open', dir);
    assert.ok(r.success, r.error);
    const out = json(r);
    assert.equal(out.num, 4);
    assert.match(out.dir, /^\.planning\/quick\/4-focus-exec-\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(out.items, ['P1-1', 'P2-2', 'todo-fix-login.md'], 'the phase item is the phase system\'s');
    assert.deepEqual(out.handoff, [{ id: 'phase-2', phase: '2', command: '/pan:plan-phase 2' }]);
    assert.deepEqual(out.files_modified, ['src/a.js', 'src/b.js', 'lib/c.js'], 'pointers into .planning/ are not files the cycle changes');
    assert.equal(out.tests_before, 5, 'measured by running the test command');
    const plan = read(dir, out.plan);
    assert.match(plan, /^source: focus$/m);
    assert.match(plan, /^focus_kind: exec$/m);
    assert.match(plan, /^items:\n  - "P1-1"\n  - "P2-2"\n  - "todo-fix-login\.md"$/m);
    assert.match(plan, /^files_modified:\n  - "src\/a\.js"\n  - "src\/b\.js"\n  - "lib\/c\.js"$/m);
    assert.match(plan, /^tests_before: 5$/m);
    assert.equal(focus.openFocusCycle(dir).num, 4);
  });

  test('refuses a second cycle while one is open, naming it', () => {
    seed(dir);
    const first = json(runPanTools('focus open', dir));
    const second = runPanTools('focus open', dir);
    assert.equal(second.success, false);
    const out = json(second);
    assert.equal(out.error, 'cycle_open');
    assert.equal(out.dir, first.dir);
    assert.equal(fs.readdirSync(path.join(dir, '.planning', 'quick')).length, 1, 'nothing new created');
  });

  test('every batch shape opens: a "batch" array, an "items" array, items with file, files or neither', () => {
    seed(dir, { batch: { items: [{ id: 'a', file: 'x.js' }, { id: 'b', files: ['y.js'] }, { id: 'c' }, 'a bare string'] } });
    const out = json(runPanTools('focus open', dir));
    assert.deepEqual(out.items, ['a', 'b', 'c', 'item-4']);
    assert.deepEqual(out.files_modified, ['x.js', 'y.js']);
  });

  test('a batch file that is not JSON is refused with the reader\'s message, and no directory is made', () => {
    seed(dir, { batch: null });
    write(dir, '.planning/focus/batch-2026-10-31.json', '{ not json');
    const r = runPanTools('focus open', dir);
    assert.equal(r.success, false);
    assert.match(json(r).reason, /is not valid JSON/);
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'quick')), false);
  });

  test('--batch names a file; an unknown one and an unknown --kind are refused', () => {
    seed(dir);
    write(dir, '.planning/focus/batch-2026-11-01-docs.json', JSON.stringify({ items: [{ id: 'd1' }] }));
    assert.equal(json(runPanTools('focus open --batch batch-2026-11-01-docs.json', dir)).items[0], 'd1');
    focus.focusClose(dir, { dir: focus.openFocusCycle(dir).rel, status: 'failed', measure: false });
    assert.equal(json(runPanTools('focus open --batch nope.json', dir)).error, 'batch_not_found');
    assert.equal(json(runPanTools('focus open --kind deploy', dir)).error, 'invalid_kind');
  });

  test('a docs cycle needs no batch and runs no tests', () => {
    seed(dir, { batch: null });
    const out = json(runPanTools('focus open --kind docs', dir));
    assert.match(out.dir, /-focus-docs-/);
    assert.deepEqual(out.items, []);
    assert.equal(out.tests_before, null);
    assert.equal(out.test_status, null);
  });
});

describe('focus close', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); });
  afterEach(() => cleanup(dir));

  test('writes the summary, the state row and Last Activity, the batch results, and completes the todo', () => {
    gitInit(dir);
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'count.txt', '7');
    write(dir, 'src/a.js', 'fixed\n');
    const r = runPanTools(`focus close --dir ${opened.dir} --status verified --files src/a.js --done P1-1,todo-fix-login.md --failed "P2-2=the fix broke b, reverted"`, dir);
    assert.ok(r.success, r.output);
    const out = json(r);
    assert.equal(out.status, 'partial', 'one item failed and one was not reported: the claim cannot raise that');
    assert.equal(out.reported_status, 'verified');
    assert.deepEqual(out.derived_from, ['not every item done']);
    assert.equal(out.commit, git(dir, 'log -1 --format=%h -- src/a.js'));
    assert.match(git(dir, 'log -1 --format=%s -- src/a.js'), /^fix\(focus-\d+\): P1-1, todo-fix-login\.md$/);
    assert.equal(out.record_commit, git(dir, 'rev-parse --short HEAD'), 'the record is committed after the source');
    assert.doesNotMatch(git(dir, 'status --porcelain'), /\.planning\//, 'the todo move and the record are committed, nothing left behind');
    assert.deepEqual(out.items_done, ['P1-1', 'todo-fix-login.md']);
    assert.deepEqual(out.items_failed, ['P2-2']);
    assert.deepEqual(out.items_not_reported, []);
    assert.equal(out.tests_before, 5);
    assert.equal(out.tests_after, 7);

    const summary = read(dir, out.summary);
    assert.match(summary, /^status: partial$/m);
    assert.match(summary, /^tests_after: 7$/m);
    assert.match(summary, /\| P2-2 \| failed \| the fix broke b, reverted \|/);

    const state = read(dir, '.planning/state.md');
    assert.match(state, /\| focus: mode balanced — 2 of 3 items \| \d{4}-\d{2}-\d{2} \| [0-9a-f]{7,} \| partial \| \[4?\d*-focus-exec-[\d-]+\]\(\.\/quick\/\d+-focus-exec-[\d-]+\/\) \|/);
    assert.match(state, /\*\*Last Activity Description:\*\* Closed focus cycle \d+: focus: mode balanced/);

    const batch = JSON.parse(read(dir, '.planning/focus/batch-2026-10-31.json'));
    assert.deepEqual(batch.results, { 'P1-1': 'done', 'todo-fix-login.md': 'done', 'P2-2': 'failed' });
    assert.equal(batch.result_reasons['P2-2'], 'the fix broke b, reverted');
    assert.equal(batch.batch[0].status, 'active', 'the scan-time status is left alone');

    assert.ok(fs.existsSync(path.join(dir, '.planning', 'todos', 'completed', 'fix-login.md')));
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'todos', 'pending', 'fix-login.md')), false);
    assert.equal(focus.openFocusCycle(dir), null, 'the cycle is no longer open');
  });

  test('with no test command, both counts are null and verified is capped at partial', () => {
    fs.rmSync(path.join(dir, '.planning', 'config.json'));
    const opened = json(runPanTools('focus open', dir));
    assert.equal(opened.tests_before, null);
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status verified --done P1-1`, dir));
    assert.equal(out.status, 'partial');
    assert.equal(out.reported_status, 'verified');
    assert.deepEqual(out.derived_from, ['no measured test count', 'not every item done']);
    assert.equal(out.tests_after, null);
  });

  test('a directory that is not an open focus cycle is refused, and nothing is written', () => {
    write(dir, '.planning/quick/2-fix/2-plan.md', '# a /pan:quick plan\n');
    const before = read(dir, '.planning/state.md');
    for (const ref of ['.planning/quick/2-fix', '9', '']) {
      const r = runPanTools(`focus close --dir "${ref}" --status verified`, dir);
      assert.equal(r.success, false, ref);
      assert.equal(json(r).error, 'not_a_focus_cycle', ref);
    }
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'quick', '2-fix', '2-summary.md')), false);
    assert.equal(read(dir, '.planning/state.md'), before);
  });

  test('refuses an unknown item, an item both done and failed, a bad status, and a second close', () => {
    const opened = json(runPanTools('focus open', dir));
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status verified --done Z-9`, dir)).error, 'unknown_items');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status verified --done P1-1 --failed P1-1=x`, dir)).error, 'conflicting_items');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status done`, dir)).error, 'invalid_status');
    assert.ok(runPanTools(`focus close --dir ${opened.dir} --status failed`, dir).success);
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --status failed`, dir)).error, 'cycle_closed');
  });

  test('--failed splits on a comma only before the next id=', () => {
    assert.deepEqual({ ...focus.parseFailed(['a=x, y and z,b=w', 'c']) }, { a: 'x, y and z', b: 'w', c: 'no reason given' });
    assert.deepEqual(focus.parseDone(['a,b', 'b, c', 'd e']), ['a', 'b', 'c', 'd', 'e']);
  });

  test('a flag with no value takes none; spaced ids and an unquoted reason are kept', () => {
    const opened = json(runPanTools('focus open', dir));
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status partial --commit --done P1-1 todo-fix-login.md --failed P2-2=broke the build`, dir));
    assert.deepEqual(out.items_done, ['P1-1', 'todo-fix-login.md']);
    assert.deepEqual(out.items_failed, ['P2-2']);
    assert.match(read(dir, out.summary), /^commit: null$/m, '--commit did not swallow --done');
    assert.match(read(dir, out.summary), /\| P2-2 \| failed \| broke the build \|/);
  });

  test('a todo id that climbs out of todos/ deletes nothing', () => {
    write(dir, 'victim.md', 'keep me\n');
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ batch: [{ id: 'todo-../../victim.md', title: 'x' }] }));
    const opened = json(runPanTools('focus open', dir));
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status partial --done todo-../../victim.md`, dir));
    assert.equal(read(dir, 'victim.md'), 'keep me\n');
    assert.equal(out.todos_completed[0].error, 'not a todo file name');
    assert.equal(runPanTools('todo complete ../../victim.md', dir).success, false);
    assert.equal(read(dir, 'victim.md'), 'keep me\n');
  });

  test('ids holding a comma, a quote or a prototype name round-trip through the plan and summary', () => {
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ batch: [{ id: 'a,b' }, { id: 'say "hi"' }, { id: 'constructor' }, { id: 'toString' }] }));
    const opened = focus.focusOpen(dir, { measure: () => ({ passed: 5, status: 'passed', command: 'node t.cjs' }) });
    assert.ok(opened.opened, opened.reason);
    const out = focus.focusClose(dir, { dir: opened.dir, status: 'partial', measure: false, done: ['a,b', 'constructor'], failed: { 'say "hi"': 'no' } });
    assert.ok(out.closed, out.reason);
    assert.deepEqual(out.items_not_reported, ['toString'], 'toString is not mistaken for a failed id');
    const fm = require('../pan-wizard-core/bin/lib/frontmatter.cjs').extractFrontmatter(read(dir, out.summary));
    assert.deepEqual([fm.items_done.length, fm.items_failed.length, fm.items_not_reported.length], [2, 1, 1]);
  });

  test('closing keeps the batch file\'s mtime, so a finished batch does not become the newest', () => {
    const abs = path.join(dir, '.planning', 'focus', 'batch-2026-10-31.json');
    const old = new Date('2026-10-31T08:00:00Z');
    fs.utimesSync(abs, old, old);
    const opened = json(runPanTools('focus open', dir));
    assert.ok(runPanTools(`focus close --dir ${opened.dir} --status failed`, dir).success);
    assert.equal(fs.statSync(abs).mtimeMs, old.getTime());
    assert.ok(JSON.parse(read(dir, '.planning/focus/batch-2026-10-31.json')).results);
  });

  test('a /pan:quick task whose slug looks like a focus cycle neither blocks focus open nor is closed by it', () => {
    write(dir, '.planning/quick/3-focus-exec-2026-10-30/3-plan.md', '---\nphase: quick\n---\nA quick task.\n');
    const r = runPanTools('focus open', dir);
    assert.ok(r.success, r.output);
    assert.equal(json(r).num, 4);
    assert.equal(json(runPanTools('focus close --dir 3 --status failed', dir)).error, 'not_a_focus_cycle');
  });

  test('the summary is written last: a state.md without the fields is reported, a project without one still closes', () => {
    const opened = json(runPanTools('focus open', dir));
    write(dir, '.planning/state.md', '# Project State\n\n### Blockers/Concerns\n\nNone\n');
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status failed`, dir));
    assert.equal(out.state, 'recorded');
    assert.deepEqual(out.state_warnings, ['state.md has no "Last Activity" field', 'state.md has no "Last Activity Description" field']);

    const second = json(runPanTools('focus open', dir));
    fs.rmSync(path.join(dir, '.planning', 'state.md'));
    const out2 = json(runPanTools(`focus close --dir ${second.dir} --status failed`, dir));
    assert.equal(out2.closed, true);
    assert.equal(out2.state, 'state_missing');
  });

  test('a close run again after the todo moved still reports it completed', () => {
    const opened = json(runPanTools('focus open', dir));
    assert.equal(require('../pan-wizard-core/bin/lib/commands.cjs').completeTodo(dir, 'fix-login.md').completed, true);
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status partial --done todo-fix-login.md`, dir));
    assert.deepEqual(out.todos_completed, [{ file: 'fix-login.md', completed: true }]);
  });
});

describe('focus close commits the cycle (A1-C)', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); gitInit(dir); });
  afterEach(() => cleanup(dir));

  test('commit_docs false: the source is committed, the record is not', () => {
    write(dir, '.planning/config.json', JSON.stringify({ commit_docs: false, workflow: { test_command: 'node t.cjs' } }));
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'src/a.js', 'fixed\n');
    const out = json(runPanTools(`focus close --dir ${opened.dir} --files src/a.js --done P1-1`, dir));
    assert.ok(out.closed, JSON.stringify(out));
    assert.equal(out.commit, git(dir, 'rev-parse --short HEAD'));
    assert.equal(git(dir, 'show --name-only --format= HEAD'), 'src/a.js');
    assert.equal(out.record_commit, 'skipped_commit_docs_false');
    assert.match(read(dir, out.summary), new RegExp(`^commit: "${out.commit}"$`, 'm'));
  });

  test('a gitignored planning tree: the source is committed, the record is skipped', () => {
    write(dir, '.gitignore', '.planning/\n');
    git(dir, 'rm -r -q --cached .planning');
    git(dir, 'add .gitignore');
    git(dir, 'commit -qm ignore');
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'src/a.js', 'fixed\n');
    const out = json(runPanTools(`focus close --dir ${opened.dir} --files src/a.js --done P1-1`, dir));
    assert.equal(out.commit, git(dir, 'rev-parse --short HEAD'));
    assert.equal(out.record_commit, 'skipped_gitignored');
  });

  // 3.42 (PAN-11): src/server.key no longer matches (the defaults are basename rules, not
  // the bare word "token" anywhere); a key file still does.
  test('a sensitive path refuses the close, unstages it and writes nothing; a commit of your own then closes it', () => {
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'src/server.key', 'module.exports = 1;\n');
    const before = read(dir, '.planning/state.md');
    const r = runPanTools(`focus close --dir ${opened.dir} --files src/server.key --done P1-1`, dir);
    assert.equal(r.success, false);
    const out = json(r);
    assert.equal(out.error, 'commit_blocked');
    assert.deepEqual(out.safety_checks.sensitive_files_blocked, ['src/server.key']);
    assert.equal(git(dir, 'diff --cached --name-only'), '', 'the refused file is not left staged');
    assert.ok(focus.openFocusCycle(dir), 'the cycle stays open');
    assert.equal(read(dir, '.planning/state.md'), before);
    git(dir, 'add src/server.key');
    git(dir, 'commit -qm "fix: key"');
    const sha = git(dir, 'rev-parse --short HEAD');
    const closed = json(runPanTools(`focus close --dir ${opened.dir} --commit ${sha} --done P1-1`, dir));
    assert.equal(closed.commit, sha);
  });

  test('--commit must name a commit reachable from HEAD; --files with --commit, or with nothing done, is refused', () => {
    const opened = json(runPanTools('focus open', dir));
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --commit deadbeef --done P1-1`, dir)).error, 'commit_unknown');
    write(dir, 'src/a.js', 'gone soon\n');
    git(dir, 'commit -qam lost');
    const lost = git(dir, 'rev-parse --short HEAD');
    git(dir, 'reset -q --hard HEAD~1');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --commit ${lost} --done P1-1`, dir)).error, 'commit_unknown');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --commit ${lost} --files src/a.js --done P1-1`, dir)).error, 'commit_conflict');
    assert.equal(json(runPanTools(`focus close --dir ${opened.dir} --files src/a.js --failed P1-1=broke`, dir)).error, 'nothing_done');
    assert.ok(focus.openFocusCycle(dir));
  });

  test('a completed todo leaves no deletion behind, so the next cycle commits', () => {
    const first = json(runPanTools('focus open', dir));
    write(dir, 'src/a.js', 'one\n');
    assert.ok(json(runPanTools(`focus close --dir ${first.dir} --files src/a.js --done todo-fix-login.md`, dir)).closed);
    assert.doesNotMatch(git(dir, 'status --porcelain'), /todos/);
    const second = json(runPanTools('focus open', dir));
    write(dir, 'src/a.js', 'two\n');
    const out = json(runPanTools(`focus close --dir ${second.dir} --files src/a.js --done P1-1`, dir));
    assert.equal(out.commit, git(dir, 'log -1 --format=%h -- src/a.js'));
  });
});

describe('focus close derives the status from the measurements (A1-S)', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir, { count: null }); });
  afterEach(() => cleanup(dir));

  test('a failure already there when the cycle opened is pre-existing, and the cycle can be verified', () => {
    withTapSuite(dir, 4, ['known flake']);
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ batch: [{ id: 'A' }] }));
    const opened = json(runPanTools('focus open', dir));
    assert.ok(fs.existsSync(path.join(dir, opened.dir, `${opened.num}-test-baseline.json`)));
    write(dir, 'pass.txt', '5');
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status verified --done A`, dir));
    assert.equal(out.status, 'verified', JSON.stringify(out.derived_from));
    assert.equal(out.preexisting_failures, 1);
    assert.equal(out.regressions, 0);
    assert.ok(fs.existsSync(path.join(dir, opened.dir, `${opened.num}-test-run.json`)));
  });

  test('a new failure is a regression: failed whatever the claim, and nothing is committed', () => {
    gitInit(dir);
    withTapSuite(dir, 4);
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ batch: [{ id: 'A' }] }));
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'fail.txt', 'broken by the fix');
    write(dir, 'src/a.js', 'regressed\n');
    const head = git(dir, 'rev-parse HEAD');
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status verified --files src/a.js --done A`, dir));
    assert.equal(out.status, 'failed');
    assert.equal(out.regressions, 1);
    assert.equal(out.commit, null);
    assert.match(out.commit_skipped, /^regression/);
    assert.match(git(dir, 'log -1 --format=%s'), /^docs\(focus-/, 'only the record was committed');
    assert.equal(git(dir, `diff --name-only ${head} HEAD -- src`), '');
  });

  test('deriveCycleStatus: the table, and a claim that only lowers', () => {
    const base = { kind: 'exec', items: ['a', 'b'], done: ['a', 'b'], tests_before: 5, tests_after: 5, run: { status: 'passed' }, regressions: 0 };
    assert.equal(focus.deriveCycleStatus(base).status, 'verified');
    assert.equal(focus.deriveCycleStatus({ ...base, done: [] }).status, 'failed');
    assert.equal(focus.deriveCycleStatus({ ...base, regressions: 1, run: { status: 'failed' } }).status, 'failed');
    assert.equal(focus.deriveCycleStatus({ ...base, tests_after: 4 }).status, 'failed');
    assert.equal(focus.deriveCycleStatus({ ...base, tests_after: null }).status, 'partial');
    assert.equal(focus.deriveCycleStatus({ ...base, run: { status: 'failed', reason: '1 failing test(s)' } }).status, 'partial');
    assert.equal(focus.deriveCycleStatus({ ...base, done: ['a'] }).status, 'partial');
    assert.deepEqual(focus.deriveCycleStatus({ ...base, kind: 'docs' }), { status: null, reasons: [] });

    withSuite(dir, 5);
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ batch: [{ id: 'A' }] }));
    const opened = json(runPanTools('focus open', dir));
    const out = json(runPanTools(`focus close --dir ${opened.dir} --status partial --done A`, dir));
    assert.equal(out.derived_status, 'verified');
    assert.equal(out.status, 'partial', 'the agent may lower the status, for a deep-review finding');
  });

  test('--status is optional for an exec cycle and required for a docs cycle', () => {
    withSuite(dir, 5);
    const exec = json(runPanTools('focus open', dir));
    assert.equal(json(runPanTools(`focus close --dir ${exec.dir} --done P1-1 P2-2 todo-fix-login.md`, dir)).status, 'verified');
    const docs = json(runPanTools('focus open --kind docs', dir));
    assert.equal(json(runPanTools(`focus close --dir ${docs.dir}`, dir)).error, 'invalid_status');
    assert.equal(json(runPanTools(`focus close --dir ${docs.dir} --status verified`, dir)).status, 'verified');
  });
});

describe('ownership: focus executes its own items and hands phase work off (D1)', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); });
  afterEach(() => cleanup(dir));

  const REQS = '# Requirements\n\n- [ ] **AUTH-01**: login\n- [ ] **AUTH-02**: logout\n- [ ] **AUTH-03**: reset\n\n## Traceability\n\n| Requirement | Phase | Status |\n|---|---|---|\n| AUTH-01 | Phase 2 | Pending |\n| AUTH-02 | — | Pending |\n';

  test('classifyOwner: a phase, a mapped requirement, an unmapped one, one missing from the table, a todo and a pattern', () => {
    const trace = focus.parseTraceability(REQS);
    const owner = (item) => { const c = focus.classifyOwner(item, trace); return [c.owner, c.phase || null]; };
    assert.deepEqual(owner({ id: 'phase-3', source: 'phase' }), ['phase', '3']);
    assert.deepEqual(owner({ id: 'X', title: 'a plan', file: '.planning/phases/04.1-hotfix/04.1-01-plan.md' }), ['phase', '4.1']);
    assert.deepEqual(owner({ id: 'AUTH-01' }), ['phase', '2']);
    assert.deepEqual(owner({ id: 'r1', source: 'requirement', requirement: 'AUTH-01' }), ['phase', '2']);
    assert.deepEqual(owner({ id: 'AUTH-02' }), ['focus', null], 'listed with no phase');
    assert.deepEqual(owner({ id: 'AUTH-03' }), ['focus', null], 'missing from the table');
    assert.deepEqual(owner({ id: 'todo-a.md', source: 'todo' }), ['focus', null]);
    assert.deepEqual(owner({ id: 'pattern-7', source: 'pattern', file: '.planning/patterns.md' }), ['focus', null]);
    assert.deepEqual(owner({ id: 'P1-1', file: 'src/a.js' }), ['focus', null], 'a scan id shaped like a requirement id is not one');
  });

  test('focus route stamps owners, records the hand-offs and keeps the batch mtime; focus open registers only the rest', () => {
    write(dir, '.planning/requirements.md', REQS);
    write(dir, '.planning/phases/02-api/02-01-plan.md', '# plan\n');
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ items: [{ id: 'AUTH-01' }, { id: 'AUTH-02', file: 'src/b.js' }, { id: 'phase-2', source: 'phase' }, { id: 'P1-1', file: 'src/a.js' }] }));
    const abs = path.join(dir, '.planning', 'focus', 'batch-2026-10-31.json');
    const old = new Date('2026-10-31T08:00:00Z');
    fs.utimesSync(abs, old, old);
    const r = runPanTools('focus route', dir);
    assert.ok(r.success, r.output);
    const out = json(r);
    assert.deepEqual(out.execute, ['AUTH-02', 'P1-1']);
    assert.deepEqual(out.handoff.map((h) => [h.id, h.phase, h.command]), [['AUTH-01', '2', '/pan:exec-phase 2'], ['phase-2', '2', '/pan:exec-phase 2']]);
    const batch = JSON.parse(read(dir, '.planning/focus/batch-2026-10-31.json'));
    assert.deepEqual(batch.items.map((i) => i.owner), ['phase', 'focus', 'phase', 'focus']);
    assert.deepEqual(batch.results, { 'AUTH-01': 'routed', 'phase-2': 'routed' });
    assert.equal(batch.routes['AUTH-01'].command, '/pan:exec-phase 2');
    assert.equal(fs.statSync(abs).mtimeMs, old.getTime());

    const opened = json(runPanTools('focus open', dir));
    assert.deepEqual(opened.items, ['AUTH-02', 'P1-1']);
    assert.deepEqual(opened.files_modified, ['src/b.js', 'src/a.js']);
  });

  test('a batch of only phase work opens no cycle and names the commands', () => {
    write(dir, '.planning/focus/batch-2026-10-31.json', JSON.stringify({ batch: [{ id: 'phase-2', source: 'phase' }] }));
    const r = runPanTools('focus open', dir);
    assert.equal(r.success, false);
    const out = json(r);
    assert.equal(out.error, 'all_routed');
    assert.deepEqual(out.handoff, [{ id: 'phase-2', phase: '2', command: '/pan:plan-phase 2' }]);
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'quick')), false);
  });

  test('focus plan stamps each item\'s owner', () => {
    write(dir, '.planning/roadmap.md', '# Roadmap\n\n### Phase 2: API\n\n**Goal:** an API\n');
    write(dir, '.planning/phases/02-api/02-01-plan.md', '---\npriority: P1\neffort: S\n---\n# plan\n');
    const out = json(runPanTools('focus plan', dir));
    const owners = Object.fromEntries(out.batch.map((i) => [i.id, i.owner]));
    assert.equal(owners['phase-2'], 'phase');
    assert.equal(owners['todo-fix-login.md'], 'focus');
  });

  test('focus route refuses a missing batch', () => {
    assert.equal(json(runPanTools('focus route --batch nope.json', dir)).error, 'batch_not_found');
  });
});

describe('the main system sees focus, and autodev never runs beside it (D5, D9)', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); });
  afterEach(() => cleanup(dir));

  const HOUR = 3600000;
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
  const autoRun = (o) => write(dir, '.planning/focus/auto-run.json', JSON.stringify({ run_id: 'auto-2026-11-01-1', status: 'in_progress', category: 'stability', started_at: iso(HOUR), max_cycles: 10, cycles: [], totals: { cycles_completed: 0, items_completed: 0 }, ...o }, null, 2));
  const phaseProject = () => {
    write(dir, '.planning/roadmap.md', '# Roadmap\n\n- [ ] **Phase 1: API**\n\n### Phase 1: API\n\n**Goal:** an API\n');
    write(dir, '.planning/requirements.md', '# Requirements\n');
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-api'), { recursive: true });
  };

  test('next-action puts an open focus cycle ahead of a phase ready to plan; without one it routes as before', () => {
    phaseProject();
    const before = json(runPanTools('next-action', dir));
    assert.equal(before.action, 'plan');
    assert.equal(before.focus, undefined, 'no focus work: the output is unchanged');
    const opened = json(runPanTools('focus open', dir));
    const out = json(runPanTools('next-action', dir));
    assert.equal(out.action, 'focus');
    assert.equal(out.reason, 'focus_cycle_open');
    assert.equal(out.command, `pan-tools focus close --dir ${opened.dir} --status failed`);
    assert.equal(out.focus.open_cycle.dir, opened.dir);
  });

  test('a live run working its cycle asks to wait; a stale one asks to stop', () => {
    runPanTools('focus auto --category stability', dir);
    json(runPanTools('focus open', dir));
    assert.equal(json(runPanTools('next-action', dir)).reason, 'focus_cycle_in_progress');
    const run = focus.readAutoRun(dir);
    focus.writeAutoRun(dir, { ...run, started_at: iso(13 * HOUR) });
    const out = json(runPanTools('next-action', dir));
    assert.equal(out.reason, 'focus_run_stale');
    assert.equal(out.command, 'pan-tools focus auto --stop');
  });

  test('a stale run: --status says so, next-action and hygiene name it; a fresh run raises neither', () => {
    autoRun({ started_at: iso(HOUR) });
    assert.equal(json(runPanTools('focus auto --status', dir)).stale, false);
    assert.equal(json(runPanTools('hygiene scan', dir)).findings.filter((f) => f.check === 'focus-stale-run').length, 0);
    assert.notEqual(json(runPanTools('next-action', dir)).action, 'focus');

    autoRun({ started_at: iso(20 * HOUR), cycles: [{ timestamp: iso(13 * HOUR) }] });
    const st = json(runPanTools('focus auto --status', dir));
    assert.equal(st.stale, true);
    assert.equal(st.stale_hours, 12);
    assert.equal(json(runPanTools('next-action', dir)).reason, 'focus_run_stale');
    const f = json(runPanTools('hygiene scan', dir)).findings.find((x) => x.check === 'focus-stale-run');
    assert.ok(f, 'hygiene reports the stale run');
    assert.equal(f.fixable, false);

    write(dir, '.planning/config.json', JSON.stringify({ focus: { stale_hours: 24 } }));
    assert.equal(json(runPanTools('focus auto --status', dir)).stale, false, 'focus.stale_hours moves the line');
  });

  test('hygiene: a quick task open for a day is reported, a newer one is not', () => {
    write(dir, '.planning/quick/3-fix-typo/3-plan.md', '---\nphase: quick\n---\n');
    write(dir, '.planning/quick/4-focus-exec-2026-10-30/4-plan.md', '---\nphase: quick\nsource: focus\n---\n');
    write(dir, '.planning/quick/5-new/5-plan.md', '---\nphase: quick\n---\n');
    const old = new Date(Date.now() - 30 * HOUR);
    fs.utimesSync(path.join(dir, '.planning/quick/3-fix-typo/3-plan.md'), old, old);
    fs.utimesSync(path.join(dir, '.planning/quick/4-focus-exec-2026-10-30/4-plan.md'), old, old);
    const found = json(runPanTools('hygiene scan', dir)).findings.filter((f) => f.check === 'open-task-stale');
    assert.deepEqual(found.map((f) => f.path).sort(), ['.planning/quick/3-fix-typo/3-plan.md', '.planning/quick/4-focus-exec-2026-10-30/4-plan.md']);
    assert.match(found.find((f) => f.path.includes('focus')).detail, /focus close --dir \.planning\/quick\/4-focus-exec-2026-10-30/);
  });

  test('autodev refuses a fresh run beside an open focus cycle or a live run; a stale run does not block it', () => {
    const { runAutodev } = require('../pan-wizard-core/bin/lib/autodev.cjs');
    json(runPanTools('focus open', dir));
    const r = runAutodev(dir, { host: 'claude', maxUsd: 1 });
    assert.equal(r.error, 'focus_active');
    assert.match(r.reason, /focus close --dir/);
    fs.rmSync(path.join(dir, '.planning', 'quick'), { recursive: true });

    autoRun({ started_at: iso(HOUR) });
    assert.equal(runAutodev(dir, { host: 'claude', maxUsd: 1 }).focus_run, 'auto-2026-11-01-1');
    autoRun({ started_at: iso(20 * HOUR) });
    // Past the focus check, it stops on the host: nothing runs in a test.
    assert.equal(runAutodev(dir, { host: 'no-such-host', maxUsd: 1 }).error, 'unsupported_host');
  });

  test('focus auto refuses to start or continue beside a live autodev run, not beside a stopped or stale one', () => {
    const ledger = (rows) => {
      write(dir, '.planning/autodev/run-20261101-000000-abcdef/run.json', JSON.stringify({ id: 'run-20261101-000000-abcdef', started: iso(HOUR) }));
      write(dir, '.planning/autodev/run-20261101-000000-abcdef/ledger.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    };
    ledger([{ ts: iso(HOUR), status: 'started', unit: { action: 'plan', phase: '1' } }]);
    const r = runPanTools('focus auto --category stability', dir);
    assert.equal(r.success, false);
    assert.equal(json(r).error, 'autodev_active');
    assert.equal(json(r).run, 'run-20261101-000000-abcdef');

    ledger([{ ts: iso(HOUR), status: 'started' }, { ts: iso(HOUR), status: 'stopped', reason: 'done' }]);
    assert.ok(runPanTools('focus auto --category stability', dir).success, 'a stopped run does not block');
    runPanTools('focus auto --stop', dir);

    ledger([{ ts: iso(HOUR), status: 'started' }]);
    assert.equal(json(runPanTools('focus auto --continue', dir)).error, 'autodev_active', '--continue refuses too');
    ledger([{ ts: iso(20 * HOUR), status: 'started' }]);
    assert.ok(runPanTools('focus auto --continue', dir).success, 'a run with nothing recorded for stale_hours does not block');
  });

  test('the HUD shows a focus panel beside the roadmap', () => {
    phaseProject();
    const hud = require('../pan-wizard-core/bin/lib/hud.cjs');
    assert.equal(hud.collectHudData(dir).focus, null, 'no focus work, no panel');
    runPanTools('focus auto --category stability', dir);
    const opened = json(runPanTools('focus open', dir));
    const data = hud.collectHudData(dir);
    assert.equal(data.focus.open_cycle.dir, opened.dir);
    const html = hud.renderHud(data);
    assert.match(html, /<div class="ph">focus<\/div>/);
    assert.ok(html.includes(`open cycle ${opened.dir}`));
  });
});

describe('focus auto with registered cycles', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); seed(dir); });
  afterEach(() => cleanup(dir));

  test('--update records the closed cycle\'s measured counts as verified, without focus.verify_tests', () => {
    assert.ok(runPanTools('focus auto --category stability', dir).success);
    const opened = json(runPanTools('focus open', dir));
    assert.match(opened.run_id, /^auto-/, 'the live run is recorded on the cycle');
    write(dir, 'count.txt', '6');
    runPanTools(`focus close --dir ${opened.dir} --status verified --done P1-1 --failed P2-2=broke`, dir);
    // The agent's own figures disagree with what was measured; the measurement wins.
    const up = json(runPanTools('focus auto --update --items-completed 9 --items-failed 0 --points-used 4 --tests-before 100 --tests-after 100', dir));
    assert.equal(up.status, 'in_progress');
    const run = focus.readAutoRun(dir);
    const cycle = run.cycles[0];
    assert.equal(cycle.cycle_dir, opened.dir);
    assert.equal(cycle.items_completed, 1);
    assert.equal(cycle.items_failed, 1);
    assert.equal(cycle.tests_before, 5);
    assert.equal(cycle.tests_after, 6);
    assert.equal(cycle.tests_verified, true);
  });

  test('a measured drop trips the regression breaker', () => {
    runPanTools('focus auto --category stability', dir);
    const opened = json(runPanTools('focus open', dir));
    write(dir, 'count.txt', '3');
    runPanTools(`focus close --dir ${opened.dir} --status partial --done P1-1`, dir);
    const up = json(runPanTools('focus auto --update --items-completed 1 --points-used 2 --tests-before 5 --tests-after 5', dir));
    assert.equal(up.stop_reason, 'regression');
  });

  test('an unregistered cycle keeps the flag path (tests_verified false)', () => {
    runPanTools('focus auto --category stability', dir);
    runPanTools('focus auto --update --items-completed 1 --points-used 2 --tests-before 5 --tests-after 5', dir);
    const cycle = focus.readAutoRun(dir).cycles[0];
    assert.equal(cycle.cycle_dir, undefined);
    assert.equal(cycle.tests_verified, false);
  });

  test('--update records the cycle the run opened, never an older one; an open one is refused', () => {
    runPanTools('focus auto --category stability', dir);
    const a = json(runPanTools('focus open', dir));
    assert.equal(focus.readAutoRun(dir).current_cycle, a.dir);
    runPanTools(`focus close --dir ${a.dir} --done P1-1`, dir);
    const b = json(runPanTools('focus open', dir));
    const refused = runPanTools('focus auto --update --items-completed 1 --points-used 1', dir);
    assert.equal(refused.success, false, 'the run\'s cycle is still open');
    runPanTools(`focus close --dir ${b.dir} --done P1-1 P2-2`, dir);
    runPanTools('focus auto --update --items-completed 1 --points-used 1', dir);
    const run = focus.readAutoRun(dir);
    assert.deepEqual(run.cycles.map((c) => c.cycle_dir), [b.dir]);
    assert.equal(run.current_cycle, undefined);
    assert.deepEqual(json(runPanTools('focus auto --status', dir)).unrecorded_cycles, [a.dir]);
  });

  test('a cycle whose items all failed stops the run resumable, not completed', () => {
    runPanTools('focus auto --category stability', dir);
    const opened = json(runPanTools('focus open', dir));
    runPanTools(`focus close --dir ${opened.dir} --failed P1-1=broke P2-2=broke`, dir);
    const up = json(runPanTools('focus auto --update --items-completed 0 --points-used 2', dir));
    assert.equal(up.stop_reason, 'cycle_failed');
    assert.equal(up.status, 'stopped');
    assert.ok(runPanTools('focus auto --continue', dir).success);

    assert.equal(focus.determineStopReason({ items_completed: 0, items_failed: 2, tests_before: 5, tests_after: 5 }, { totals: { cycles_completed: 1, points_used: 1 }, max_cycles: 9, cycles: [] }), 'all_failed');
    assert.equal(focus.determineStopReason({ items_completed: 1, items_failed: 0, tests_before: 5, tests_after: 5, regressions: 1 }, { totals: { cycles_completed: 1, points_used: 1 }, max_cycles: 9, cycles: [] }), 'regression');
  });

  test('--stop closes only the run\'s own cycle', () => {
    const stray = json(runPanTools('focus open', dir));
    runPanTools('focus auto --category stability', dir);
    const out = json(runPanTools('focus auto --stop', dir));
    assert.equal(out.closed_cycle, null);
    assert.equal(focus.openFocusCycle(dir).rel, stray.dir, 'a cycle the run did not open is left alone');
  });

  test('--stop closes an open cycle as failed', () => {
    runPanTools('focus auto --category stability', dir);
    const opened = json(runPanTools('focus open', dir));
    const out = json(runPanTools('focus auto --stop', dir));
    assert.equal(out.closed_cycle, opened.dir);
    assert.equal(focus.openFocusCycle(dir), null);
    assert.match(read(dir, `${opened.dir}/${opened.num}-summary.md`), /^status: failed$/m);
  });
});

describe('the guard sees an open focus cycle as work in flight, on every hook host', () => {
  let dir;
  beforeEach(() => {
    dir = createTempProject();
    seed(dir);
    const cfg = JSON.parse(read(dir, '.planning/config.json'));
    write(dir, '.planning/config.json', JSON.stringify({ ...cfg, hooks: { guard: 'enforce' }, instructions: { routing: 'exclusive' } }));
  });
  afterEach(() => cleanup(dir));

  const FIX = path.join(__dirname, 'fixtures', 'hooks');
  const payload = (host) => JSON.parse(fs.readFileSync(path.join(FIX, `pretool-${host}.json`), 'utf8')
    .split('{{PROJECT_DIR}}').join(dir.replace(/\\/g, '/')).split('{{SECRET}}').join('plain text'));
  const unrouted = (host) => G.evaluate(G.normalise(payload(host)), dir, '.planning', JSON.parse(read(dir, '.planning/config.json')))
    .filter((h) => h.rule === 'unrouted_write');

  for (const host of ['claude', 'codex', 'gemini', 'copilot']) {
    test(host, () => {
      assert.equal(unrouted(host).length, 1, 'nothing in flight: the source write is unrouted');
      const opened = json(runPanTools('focus open', dir));
      assert.deepEqual(unrouted(host), [], 'an open focus cycle is PAN work');
      runPanTools(`focus close --dir ${opened.dir} --status partial`, dir);
      assert.equal(unrouted(host).length, 1, 'closed: unrouted again');
    });
  }
});

describe('the focus prompts register their writes and commit through the close', () => {
  const PROMPTS = {
    'commands/pan/focus-auto.md': read(ROOT, 'commands/pan/focus-auto.md'),
    'pan-wizard-core/workflows/focus-exec.md': read(ROOT, 'pan-wizard-core/workflows/focus-exec.md'),
    'pan-wizard-core/workflows/focus-doc-audit.md': read(ROOT, 'pan-wizard-core/workflows/focus-doc-audit.md'),
    'pan-wizard-core/workflows/focus-sync.md': read(ROOT, 'pan-wizard-core/workflows/focus-sync.md'),
    'pan-wizard-core/workflows/focus-drift-walking.md': read(ROOT, 'pan-wizard-core/workflows/focus-drift-walking.md'),
  };

  test('no focus prompt stages or commits with raw git', () => {
    for (const [file, text] of Object.entries(PROMPTS)) {
      const hit = text.match(/.*\bgit (?:add|commit)\b.*/);
      assert.equal(hit, null, `${file} runs git add or git commit: ${hit && hit[0]}`);
    }
  });

  test('--dry-run opens no cycle, and the deep review runs before the close records the cycle', () => {
    assert.match(read(ROOT, 'pan-wizard-core/workflows/focus-exec.md'), /\*\*Open the cycle\*\* — before the first edit \(not under `--dry-run`/);
    const auto = read(ROOT, 'commands/pan/focus-auto.md');
    const review = auto.indexOf('With `--deep-review` on, run it now (below), on the cycle\'s uncommitted changes, before the close');
    assert.ok(review > 0 && review < auto.indexOf('focus close --dir <dir from focus open>'));
    assert.match(auto, /\| `block` \| STOP campaign — revert the cycle's changes, close the cycle without `--files`/);
  });

  test('every write-producing focus prompt opens a cycle before its edits and commits through the close', () => {
    for (const [file, text] of Object.entries(PROMPTS)) {
      const open = text.indexOf('pan-tools.cjs focus open');
      const close = text.indexOf('pan-tools.cjs focus close');
      assert.ok(open !== -1, `${file}: no focus open`);
      assert.ok(close > open, `${file}: focus close must follow focus open`);
      assert.match(text, /pan-tools\.cjs focus close --dir [^`\n]*--files /, `${file}: the close names the files it commits`);
      assert.doesNotMatch(text, /pan-tools\.cjs commit "(?:fix|docs)\(focus/, `${file}: source goes through the close, not the planning-docs verb`);
      assert.match(text, /`commit_blocked`[^\n]*`--commit <sha>`/, `${file}: the commit_blocked way out`);
    }
  });
});
