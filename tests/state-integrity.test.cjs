/**
 * 3.42 Stage A — state.md integrity (docs/specs/field_defects_342_featureai.md).
 *
 * A field project (decimal phases, shipped milestones, hundreds of plans) banned
 * most `state *` writers because they damaged state.md:
 *   DD-1  every write re-serialised the front matter: comments, quoting and
 *         unknown nested keys were lost, and plan counts were added
 *   DD-2  counts came from summary FILES (orphans included), any directory,
 *         case-sensitive suffixes, and no archives (PAN-02, PAN-13)
 *   DD-3  a guessed milestone replaced the recorded one; a stale body date
 *         moved last_activity backwards
 *   DD-4  health regenerated an existing state.md over a mention of an archived
 *         phase (PAN-16)
 *   DD-5  days were UTC (PAN-06)
 *   DD-6  phase complete staged all of .planning/ and wrote "1/2 | Complete" (PAN-04)
 *   PAN-01 add-blocker stripped "none" from inside earlier blockers
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTempProject, cleanup, gateOff, TOOLS_PATH } = require('./helpers.cjs');

const LIB = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib');

let dir;
const P = (...s) => path.join(dir, '.planning', ...s);
const write = (rel, text) => { fs.mkdirSync(path.dirname(P(rel)), { recursive: true }); fs.writeFileSync(P(rel), text); };
const state = () => fs.readFileSync(P('state.md'), 'utf8');
const pan = (...args) => {
  const r = spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
};
const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const hasGit = git('--version').status === 0;

const FRONT = `---
# Project state: the team keeps notes in here
pan_state_version: '1.0'
milestone: v3.0
milestone_name: "Platform"
current_phase: "29.4"
current_plan: 1
status: executing
last_activity: 2026-11-04
last_updated: "2026-11-01T00:00:00.000Z"
progress:
  # counts the team keeps by hand
  total_phases: 7
  completed_phases: 0
  plans_executed: 3
  percent: 50
  percent_note: "half, by hand"
custom_notes: keep me  # trailing comment
---
`;

const BODY = `
# Project State

## Current Position

**Current Phase:** 29.4
**Current Phase Name:** Decimal work
**Current Plan:** 1
**Total Plans in Phase:** 2
**Total Phases:** 9
**Status:** Executing
**Last Activity:** 2026-11-04
**Last Activity Description:** Working on 29.4
**Progress:** [░░░░░░░░░░] 0%

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| - | - | - | - |

## Accumulated Context

### Decisions

None yet.

### Blockers/Concerns

- Upstream says none of the fixes landed
- Nonetheless, keep going
None.

## Session Continuity

**Last session:** 2026-11-01 10:00
**Stopped At:** Plan 1
**Resume File:** None
`;

const ROADMAP = `# Roadmap

## v3.0 Platform

- [ ] **Phase 29.4: Decimal work**
- [ ] **Phase 30: Next**

### Phase 29.4: Decimal work
**Goal:** decimal
**Plans:** 0/2 plans

### Phase 30: Next
**Goal:** next

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 29.4. Decimal work | 0/2 | Not started | - |
| 30. Next | 0/0 | Not started | - |
`;

function seed() {
  write('state.md', FRONT + BODY);
  write('roadmap.md', ROADMAP);
  write('phases/29.4-decimal/29.4-01-plan.md', '# plan 1\n');
  write('phases/29.4-decimal/29.4-02-PLAN.md', '# plan 2, upper-case suffix\n');
  write('phases/29.4-decimal/29.4-01-summary.md', '# summary 1\n');
  write('phases/29.4-decimal/29.4-research-summary.md', '# an orphan: no plan has this id\n');
  write('phases/scratch/01-plan.md', '# not a phase directory\n');
  write('milestones/v2.0-phases/01-old/01-01-plan.md', '# shipped\n');
  write('milestones/v2.0-phases/01-old/01-01-summary.md', '# shipped\n');
}

/** The front-matter lines, without the keys a writer owns. */
function unownedLines(text, owned) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1].split(/\r?\n/);
  return block.filter((line) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_-]+):/);
    if (!m) return true;
    const key = m[1] ? `progress.${m[2]}` : m[2];
    return !owned.includes(key);
  });
}

const POSITION = ['current_phase', 'current_phase_name', 'current_plan', 'status', 'last_activity', 'last_updated'];
const PROGRESS = ['progress.total_phases', 'progress.completed_phases', 'progress.total_plans', 'progress.completed_plans', 'progress.percent'];

beforeEach(() => { dir = createTempProject(); seed(); });
afterEach(() => cleanup(dir));

describe('DD-1: every state writer patches only the keys it owns', () => {
  const cases = [
    ['update', ['update', 'Status', 'Executing'], POSITION],
    ['patch', ['patch', '--Status', 'Executing'], POSITION],
    ['advance-plan', ['advance-plan'], POSITION],
    ['record-metric', ['record-metric', '--phase', '29.4', '--plan', '1', '--duration', '5min'], ['last_updated']],
    ['update-progress', ['update-progress'], [...POSITION, ...PROGRESS]],
    ['add-decision', ['add-decision', '--phase', '29.4', '--summary', 'Use pairs'], ['last_updated']],
    ['add-blocker', ['add-blocker', '--text', 'CI is red'], ['last_updated']],
    ['resolve-blocker', ['resolve-blocker', '--text', 'Nonetheless'], ['last_updated']],
    ['record-session', ['record-session', '--stopped-at', 'Plan 2'], ['last_updated']],
    ['section', ['section', 'Pending Todos', '--append', '- a todo'], ['last_updated']],
    ['quick-task', ['quick-task', '--description', 'fix', '--commit', 'abc1234', '--directory', '.planning/quick/1-fix'], ['last_updated']],
    ['apply', ['apply', '--json', '{"fields":{"Status":"Executing"}}'], POSITION],
    ['init --force --keep-context', ['init', '--phase', '29.4', '--force', '--keep-context'], [...POSITION, ...PROGRESS, 'milestone', 'milestone_name']],
  ];
  for (const [name, args, owned] of cases) {
    test(`state ${name}: comments, quoting, order and unknown nested keys survive byte for byte`, () => {
      const before = state();
      const r = pan('state', ...args);
      assert.equal(r.status, 0, `${name}: ${r.stdout} ${r.stderr}`);
      const after = state();
      assert.deepEqual(unownedLines(after, owned), unownedLines(before, owned), `${name} changed a key it does not own:\n${after}`);
      assert.match(after, /^---\n# Project state: the team keeps notes in here\n/);
      assert.match(after, /^  # counts the team keeps by hand$/m);
      assert.match(after, /^pan_state_version: '1\.0'$/m);
      assert.match(after, /^custom_notes: keep me  # trailing comment$/m);
      assert.equal((after.match(/^---$/gm) || []).length, 2, 'one front-matter block');
    });
  }

  test('no total_plans or completed_plans are added when absent; --write-counts adds them', () => {
    let r = pan('state', 'update-progress');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(state(), /total_plans:|completed_plans:/);
    // The keys that were there are updated from the count.
    assert.match(state(), /^  total_phases: 1$/m);
    assert.match(state(), /^  percent: 50$/m);
    r = pan('state', 'update-progress', '--write-counts');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.counts_written, true);
    assert.match(state(), /^  total_plans: 2$/m);
    assert.match(state(), /^  completed_plans: 1$/m);
    assert.match(state(), /^  plans_executed: 3$/m, 'unknown nested key kept');
  });

  test('a write with the body only keeps the front matter on disk', () => {
    const r = pan('state', 'section', 'Pending Todos', '--append', '- one');
    assert.equal(r.status, 0, r.stderr);
    assert.match(state(), /^milestone_name: "Platform"$/m);
    assert.match(state(), /^  percent_note: "half, by hand"$/m);
  });
});

describe('DD-2: one plan count', () => {
  const { countPlanProgress } = require(path.join(LIB, 'state.cjs'));

  test('an orphan summary is not counted; an upper-case -PLAN.md is', () => {
    const c = countPlanProgress(dir);
    assert.equal(c.total_plans, 2);
    assert.equal(c.completed_plans, 1);
  });

  test('a decimal phase with 1 of 2 plans summarised is not complete; non-phase directories are skipped', () => {
    const c = countPlanProgress(dir);
    assert.equal(c.total_phases, 1);
    assert.equal(c.completed_phases, 0);
    assert.deepEqual(c.phases.map((p) => [p.number, p.plans, p.completed, p.complete]), [['29.4', 2, 1, false]]);
  });

  test("an archived phase is counted under scope 'all' only", () => {
    const all = countPlanProgress(dir, { scope: 'all' });
    assert.equal(all.total_phases, 2);
    assert.equal(all.completed_phases, 1);
    assert.equal(all.total_plans, 3);
    assert.equal(all.completed_plans, 2);
    assert.equal(all.phases.find((p) => p.archived).archived, 'v2.0');
  });

  test('completed never exceeds total, however many stray summaries there are', () => {
    for (let i = 0; i < 5; i++) write(`phases/29.4-decimal/29.4-note${i}-summary.md`, 'x');
    const r = pan('state', 'update-progress');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.total, 2);
    assert.equal(r.json.completed, 1);
    assert.equal(r.json.percent, 50);
    assert.ok(r.json.completed <= r.json.total);
    assert.match(state(), /\*\*Progress:\*\* \[\S+\] 50%/);
  });
});

describe('DD-3: the recorded milestone and last_activity', () => {
  test('a recorded milestone v3.0 survives a write when the roadmap only implies another', () => {
    write('roadmap.md', '# Roadmap\n\n## v2.0 Foundation (Shipped)\n\n## v4.0 Next\n\n### Phase 29.4: Decimal work\n');
    for (const args of [['update', 'Status', 'Executing'], ['init', '--phase', '29.4', '--force', '--keep-context']]) {
      const r = pan('state', ...args);
      assert.equal(r.status, 0, r.stderr);
      assert.match(state(), /^milestone: v3\.0$/m, `after state ${args[0]}`);
      assert.match(state(), /^milestone_name: "Platform"$/m);
    }
  });

  test('last_activity never moves backwards when the body carries an older date, and still moves forward', () => {
    write('state.md', FRONT + BODY.replace('**Last Activity:** 2026-11-04', '**Last Activity:** 2026-10-01'));
    let r = pan('state', 'update', 'Status', 'Executing');
    assert.equal(r.status, 0, r.stderr);
    assert.match(state(), /^last_activity: 2026-11-04$/m);
    r = pan('state', 'update', 'Last Activity', '2026-11-20');
    assert.equal(r.status, 0, r.stderr);
    assert.match(state(), /^last_activity: 2026-11-20$/m);
  });
});

describe('DD-6: phase complete', () => {
  test('commits only what it wrote, and writes no Complete at 1 of 2 plans (--force)', (t) => {
    if (!hasGit) { t.skip('git unavailable'); return; }
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    write('stray-notes.md', 'an untracked planning file the user has not committed\n');
    const r = pan('phase', 'complete', '29.4', '--force', '--reason', 'testing a partial close');
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.ok(r.json.commit_hash, `committed: ${r.stdout}`);
    const files = git('show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n');
    assert.ok(!files.some((f) => f.endsWith('stray-notes.md')), `stray file committed: ${files}`);
    assert.ok(files.includes('.planning/roadmap.md'), `roadmap committed: ${files}`);
    assert.equal(git('status', '--porcelain', '--', '.planning/stray-notes.md').stdout.trim(), '?? .planning/stray-notes.md');
    const roadmap = fs.readFileSync(P('roadmap.md'), 'utf8');
    assert.match(roadmap, /\| 29\.4\. Decimal work \| 1\/2 \| In Progress \|/);
    assert.doesNotMatch(roadmap, /1\/2 \| Complete/);
    assert.match(roadmap, /- \[ \] \*\*Phase 29\.4/, 'checkbox not ticked at 1 of 2');
    assert.equal(r.json.plans_executed, '1/2');
    assert.equal(r.json.roadmap_status, 'In Progress');
  });

  test('completed_phases and the Progress bar are recounted', () => {
    gateOff(dir);
    write('phases/29.4-decimal/29.4-02-summary.md', '# summary 2\n');
    const r = pan('phase', 'complete', '29.4', '--no-commit');
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.equal(r.json.roadmap_status, 'Complete');
    const s = state();
    assert.match(s, /^  completed_phases: 1$/m);
    assert.match(s, /^  percent: 100$/m);
    assert.match(s, /\*\*Progress:\*\* \[\S+\] 100%/);
    assert.match(s, /^  plans_executed: 3$/m, 'unknown nested key kept');
    assert.match(fs.readFileSync(P('roadmap.md'), 'utf8'), /\| 2\/2 \| Complete /);
  });

  // PAN-03: phase complete marked requirements with a three-column `Pending` regex, so a
  // traceability table with the Status column elsewhere was never updated.
  test('a five-column traceability table is marked Complete by its Status header', () => {
    gateOff(dir);
    write('roadmap.md', ROADMAP.replace('**Goal:** decimal\n', '**Goal:** decimal\n**Requirements:** CHK-01\n'));
    write('requirements.md', [
      '# Requirements', '',
      '- [ ] **CHK-01**: checkout totals the cart', '',
      '## Traceability', '',
      '| Requirement | Description | Phase | Status | Notes |',
      '|-------------|-------------|-------|--------|-------|',
      '| CHK-01 | Checkout totals | 29.4 | In Progress | owner: ops |',
      '',
    ].join('\n'));
    write('phases/29.4-decimal/29.4-02-summary.md', '# summary 2\n');
    const r = pan('phase', 'complete', '29.4', '--no-commit');
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const req = fs.readFileSync(P('requirements.md'), 'utf8');
    assert.match(req, /\| CHK-01 \| Checkout totals \| 29\.4 \| Complete +\| owner: ops \|/);
    assert.match(req, /- \[x\] \*\*CHK-01\*\*/);
  });
});

describe('DD-4: health never rewrites an existing state.md', () => {
  test('archived and decimal phase references raise no W002', () => {
    write('phases/5.1-hotfix/5.1-01-plan.md', '# p\n');
    write('state.md', FRONT + BODY.replace('None yet.', '- [Phase 1]: shipped in v2.0\n- [Phase 05.1]: hotfix'));
    const r = pan('validate', 'health');
    const w002 = (r.json.warnings || []).filter((w) => w.code === 'W002');
    assert.deepEqual(w002, [], JSON.stringify(w002));
  });

  test('--repair never shrinks an existing state.md, even with a bad phase reference; a missing one is still made (E004)', () => {
    write('state.md', FRONT + BODY.replace('None yet.', '- [Phase 77]: a phase that never existed'));
    const before = state();
    const r = pan('validate', 'health', '--repair');
    const w002 = (r.json.warnings || []).find((w) => w.code === 'W002');
    assert.ok(w002, 'the bad reference is still reported');
    assert.equal(w002.repairable, false);
    assert.equal(state(), before);
    fs.rmSync(P('state.md'));
    pan('validate', 'health', '--repair');
    assert.ok(fs.existsSync(P('state.md')));
  });
});

describe('PAN-01: add-blocker drops only a whole placeholder line', () => {
  test('"none" and "nonetheless" inside earlier blockers survive; a lone None. line goes', () => {
    const r = pan('state', 'add-blocker', '--text', 'CI is red');
    assert.equal(r.status, 0, r.stderr);
    const s = state();
    assert.match(s, /^- Upstream says none of the fixes landed$/m);
    assert.match(s, /^- Nonetheless, keep going$/m);
    assert.match(s, /^- CI is red$/m);
    assert.doesNotMatch(s, /^None\.$/m);
  });

  test('add-decision keeps "none yet" inside a decision and drops the placeholder line', () => {
    write('state.md', FRONT + BODY.replace('None yet.', '- [Phase 29]: Ship it, none yet blocked\nNone yet.'));
    const r = pan('state', 'add-decision', '--phase', '29.4', '--summary', 'Pairs');
    assert.equal(r.status, 0, r.stderr);
    const s = state();
    assert.match(s, /^- \[Phase 29\]: Ship it, none yet blocked$/m);
    assert.doesNotMatch(s, /^None yet\.$/m);
  });
});

describe('DD-5: local days', () => {
  // A clock at 2026-11-04T23:30Z is 01:30 on 5 November in Johannesburg (UTC+2).
  const MOCK = path.join(os.tmpdir(), `pan-mock-date-${process.pid}.cjs`);
  const mockSrc = `const Real = Date;
global.Date = class extends Real {
  constructor(...a) { super(...(a.length ? a : ['2026-11-04T23:30:00Z'])); }
  static now() { return new Real('2026-11-04T23:30:00Z').getTime(); }
};
`;
  const env = { ...process.env, TZ: 'Africa/Johannesburg' };

  test('localDay() gives the local day, not the UTC one', () => {
    fs.writeFileSync(MOCK, mockSrc);
    try {
      const r = spawnSync(process.execPath, ['-r', MOCK, '-e', `process.stdout.write(require(${JSON.stringify(path.join(LIB, 'utils.cjs'))}).localDay())`], { env, encoding: 'utf8' });
      assert.equal(r.stdout, '2026-11-05', r.stderr);
    } finally { fs.rmSync(MOCK, { force: true }); }
  });

  test('state advance-plan records the local day', () => {
    fs.writeFileSync(MOCK, mockSrc);
    try {
      const r = spawnSync(process.execPath, ['-r', MOCK, TOOLS_PATH, 'state', 'advance-plan'], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(state(), /\*\*Last Activity:\*\* 2026-11-05/);
    } finally { fs.rmSync(MOCK, { force: true }); }
  });
});

describe('patchFrontmatter', () => {
  const { patchFrontmatter } = require(path.join(LIB, 'frontmatter.cjs'));

  test('edits one nested key in place and leaves CRLF and the body alone', () => {
    const text = '---\r\na: 1\r\nprogress:\r\n  percent: 10  # by hand\r\n---\r\nbody\r\n';
    assert.equal(patchFrontmatter(text, { set: { 'progress.percent': 40 } }), '---\r\na: 1\r\nprogress:\r\n  percent: 40  # by hand\r\n---\r\nbody\r\n');
  });

  test('an unchanged value leaves the line as written, quotes included', () => {
    const text = "---\nv: '1.0'\n---\n";
    assert.equal(patchFrontmatter(text, { set: { v: '1.0' } }), text);
  });

  test('removes a key and adds a missing one', () => {
    assert.equal(patchFrontmatter('---\na: 1\nb: 2\n---\n', { set: { c: 3 }, remove: ['a'] }), '---\nb: 2\nc: 3\n---\n');
  });
});

// Doc-audit pass 9 (3.42.0): more decisions counted summary files. Milestone audit called a
// phase complete when any summary existed, `phase remove` refused a phase holding only a research
// summary as "executed", and open work could not see an upper-case -PLAN.md.
describe('PAN-02: every completion decision pairs plans with their own summary', () => {
  test('init milestone-op does not count a phase whose only summary is an orphan', () => {
    const before = pan('init', 'milestone-op').json.completed_phases;
    write('phases/31-solo/31-01-plan.md', '# p\n');
    write('phases/31-solo/31-research-summary.md', '# research\n');
    const r = pan('init', 'milestone-op');
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.equal(r.json.completed_phases, before, 'a research summary beside an unexecuted plan completes nothing');
    assert.equal(r.json.all_phases_complete, false);
  });

  test('phase remove does not treat an orphan summary as an executed plan', () => {
    gateOff(dir);
    write('roadmap.md', ROADMAP + '\n### Phase 31: Solo\n**Goal:** g\n');
    write('phases/31-solo/31-01-plan.md', '# p\n');
    write('phases/31-solo/31-research-summary.md', '# research\n');
    const r = pan('phase', 'remove', '31');
    assert.equal(r.status, 0, `an orphan summary refused the removal: ${r.stdout} ${r.stderr}`);
  });

  test('open work sees an upper-case plan that has no summary', () => {
    const { openWork } = require(path.join(LIB, 'open-work.cjs'));
    const ow = openWork(dir);
    const plans = ow.phase_plans.map((p) => String(p.plan || p.file || p.path || JSON.stringify(p)));
    assert.ok(plans.some((p) => /29\.4-02-PLAN\.md/.test(p)), JSON.stringify(ow.phase_plans));
  });
});
