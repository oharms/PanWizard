// `pan-tools roadmap compact` — shipped phases' detail moves to roadmap-history.md,
// a stub stays (memory optimisation O3). roadmap.md only ever grew: a 54-phase
// field project's reached 476 KB. ADR-0044 bounded state.md; this bounds the
// roadmap with the same discipline — history written first, nothing deleted,
// dry-run by default, decline when nothing would shrink.

'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPanTools } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const { planRoadmapCompaction, compactRoadmap } = require(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', 'roadmap-compact.cjs'));

const detail = (n, name, goal, deps, reqs) => [
  `### Phase ${n}: ${name}`,
  `**Goal**: ${goal}`,
  ...(deps ? [`**Depends on**: ${deps}`] : []),
  `**Requirements**: ${reqs}`,
  '**Success Criteria**:',
  ...Array.from({ length: 10 }, (_, k) => `  ${k + 1}. ${name} criterion ${k + 1}, written out at the length a field roadmap carries`),
  '**Plans**: 2/2 plans complete',
  '',
  'Plans:',
  `- [x] 0${n}-01-plan.md — first half of ${name.toLowerCase()}`,
  `- [x] 0${n}-02-plan.md — second half of ${name.toLowerCase()}`,
  '',
  `**Notes:** ${name} decisions and the reasons for them, kept here while the phase was in flight.`,
];
const ROADMAP = [
  '# Roadmap', '',
  '## Phases', '',
  '<details>',
  '<summary>v1.0 (Phases 1-2) — SHIPPED</summary>', '',
  '- [x] **Phase 1: Base** — scaffolding',
  '- [x] **Phase 2: Auth** — sign-in', '',
  '</details>', '',
  '- [x] **Phase 3: Payments** — cards',
  '- [x] **Phase 4: Refunds** — reversals',
  '- [ ] **Phase 5: Reports** — dashboards',
  '- [ ] **Phase 6: Ship** — release', '',
  '## Phase Details', '',
  '<details>',
  '<summary>v1.0 detail</summary>', '',
  ...detail(1, 'Base', 'a running skeleton', null, 'BASE-01'), '',
  ...detail(2, 'Auth', 'users can sign in', 'Phase 1', 'AUTH-01'), '',
  '</details>', '',
  ...detail(3, 'Payments', 'take card payments', 'Phase 2', 'PAY-01, PAY-02'), '',
  ...detail(4, 'Refunds', 'refunds reverse a settlement', 'Phase 3', 'PAY-03'), '',
  ...detail(5, 'Reports', 'dashboards show the day', 'Phase 4', 'REP-01'), '',
  ...detail(6, 'Ship', 'release', 'Phase 5', 'SHIP-01'), '',
  '## Progress', '',
  '| Phase | Plans | Status |', '|---|---|---|',
  '| 1 | 2/2 | Complete |', '| 6 | 0/2 | Not started |', '',
].join('\n');

describe('planRoadmapCompaction', () => {
  const plan = planRoadmapCompaction(ROADMAP, { current: '5', now: Date.UTC(2026, 9, 4) });
  const archived = (p) => p.archivable.map((v) => v.phase);

  test('archives shipped phases past the two most recent, and nothing else', () => {
    assert.deepEqual(archived(plan), ['1', '2']);
    const reasons = Object.fromEntries(plan.sections.map((v) => [v.phase, v.reason]));
    assert.match(reasons['3'], /most recently shipped/);
    assert.match(reasons['4'], /most recently shipped/);
    assert.match(reasons['5'], /not shipped/);
    assert.ok(plan.bytes_after < plan.bytes_before);
  });

  test('a stub keeps the heading, goal, dependencies and requirements, and points at the history', () => {
    assert.match(plan.content, /### Phase 2: Auth\n\*\*Goal\*\*: users can sign in\n\*\*Depends on\*\*: Phase 1\n\*\*Requirements\*\*: AUTH-01\n\n_Shipped; the full section is in \[roadmap-history\.md\]\(roadmap-history\.md\) \(compacted 2026-10-04\)\._/);
    assert.doesNotMatch(plan.content, /Auth criterion 1,/, 'the success criteria moved out');
    assert.match(plan.archivedText, /### Phase 1: Base[\s\S]*Base criterion 10,[\s\S]*### Phase 2: Auth[\s\S]*Auth criterion 10,/);
  });

  test('section ends hold: the milestone `</details>` and the progress table stay in roadmap.md', () => {
    assert.match(plan.content, /\(compacted 2026-10-04\)\._\n\n<\/details>\n/);
    assert.match(plan.content, /## Progress\n\n\| Phase \| Plans \| Status \|/);
    assert.doesNotMatch(plan.archivedText, /## Progress|<\/details>/);
  });

  test('--keep 0 archives every shipped phase; the current phase never moves', () => {
    assert.deepEqual(archived(planRoadmapCompaction(ROADMAP, { current: '5', keep: 0 })), ['1', '2', '3', '4']);
    const ticked = ROADMAP.replace('- [ ] **Phase 5: Reports**', '- [x] **Phase 5: Reports**');
    assert.deepEqual(archived(planRoadmapCompaction(ticked, { current: '5', keep: 0 })), ['1', '2', '3', '4']);
  });

  test('the current phase does not take one of the kept slots', () => {
    // Phase 5 ticked and current: the two kept are still the two shipped before it.
    const ticked = ROADMAP.replace('- [ ] **Phase 5: Reports**', '- [x] **Phase 5: Reports**');
    assert.deepEqual(archived(planRoadmapCompaction(ticked, { current: '5' })), ['1', '2']);
  });

  test('a shipped last phase stops at the next heading, so the progress table after it stays', () => {
    const allShipped = ROADMAP.replace('- [ ] **Phase 5: Reports**', '- [x] **Phase 5: Reports**').replace('- [ ] **Phase 6: Ship**', '- [x] **Phase 6: Ship**');
    const p = planRoadmapCompaction(allShipped, { current: null, keep: 0 });
    assert.ok(archived(p).includes('6'));
    assert.match(p.content, /\(compacted [\d-]+\)\._\n\n## Progress\n\n\| Phase \| Plans \| Status \|/);
    assert.doesNotMatch(p.archivedText, /## Progress/);
  });

  test('a compacted roadmap has nothing more to compact', () => {
    const again = planRoadmapCompaction(plan.content, { current: '5' });
    assert.deepEqual(again.archivable, []);
    assert.equal(again.sections.find((v) => v.phase === '1').reason, 'already compacted');
  });

  test('declines when the stubs would not shrink the file', () => {
    const tiny = ['- [x] **Phase 1: A** — a', '- [x] **Phase 2: B** — b', '- [x] **Phase 3: C** — c', '', '### Phase 1: A', '**Goal**: a', '', '### Phase 2: B', '**Goal**: b', '', '### Phase 3: C', '**Goal**: c', ''].join('\n');
    const p = planRoadmapCompaction(tiny, { keep: 0 });
    assert.deepEqual(p.archivable, []);
    assert.match(p.sections[0].reason, /would not shrink/);
    assert.equal(p.content, tiny);
  });

  test('a CRLF roadmap compacts the same way and stays CRLF', () => {
    const crlf = planRoadmapCompaction(ROADMAP.replace(/\n/g, '\r\n'), { current: '5', now: Date.UTC(2026, 9, 4) });
    assert.deepEqual(archived(crlf), ['1', '2']);
    assert.equal(crlf.content, plan.content.replace(/\n/g, '\r\n'));
  });
});

describe('roadmap compact on a project', () => {
  const made = [];
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
  function project(roadmap = ROADMAP) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rmc-'));
    made.push(d);
    fs.mkdirSync(path.join(d, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(d, '.planning', 'roadmap.md'), roadmap);
    fs.writeFileSync(path.join(d, '.planning', 'state.md'), '# Project State\n\n**Current Phase:** 5\n**Status:** In progress\n');
    return d;
  }
  const rm = (d) => fs.readFileSync(path.join(d, '.planning', 'roadmap.md'), 'utf8');
  const hist = (d) => path.join(d, '.planning', 'roadmap-history.md');

  test('the dry run writes nothing', () => {
    const d = project();
    const r = JSON.parse(runPanTools('roadmap compact', d).output);
    assert.deepEqual(r.archivable.map((v) => v.phase), ['1', '2']);
    assert.equal(r.applied, false);
    assert.equal(rm(d), ROADMAP);
    assert.equal(fs.existsSync(hist(d)), false);
  });

  test('--apply moves the sections verbatim to roadmap-history.md and leaves stubs the other tools still read', () => {
    const d = project();
    const r = runPanTools('roadmap compact --apply --raw', d);
    assert.ok(r.success, r.error);
    assert.match(r.output, /^archived 2 phase section\(s\) to \.planning\/roadmap-history\.md/);
    const h = fs.readFileSync(hist(d), 'utf8');
    assert.match(h, /^# Roadmap history\n/);
    assert.match(h, /### Phase 1: Base[\s\S]*Base criterion 10,/);
    // The stub still answers a goal lookup, and a slice still shows the dependency's goal.
    assert.equal(JSON.parse(runPanTools('roadmap get-phase 2', d).output).goal, 'users can sign in');
    assert.match(runPanTools('roadmap slice 3 --raw', d).output, /- \*\*Phase 2: Auth\*\* — users can sign in/);
    assert.equal(JSON.parse(runPanTools('roadmap analyze', d).output).phases.length, 6);
  });

  test('a later compaction appends to the history', () => {
    const d = project();
    runPanTools('roadmap compact --apply', d);
    runPanTools('roadmap compact --apply --keep 0', d);
    const h = fs.readFileSync(hist(d), 'utf8');
    assert.equal((h.match(/<!-- compacted from roadmap\.md on /g) || []).length, 2);
    assert.match(h, /### Phase 4: Refunds/);
  });

  test('history is written before roadmap.md: a failed rewrite can duplicate, never lose', () => {
    const d = project();
    const rmPath = path.join(d, '.planning', 'roadmap.md');
    fs.chmodSync(rmPath, 0o444);
    try {
      assert.throws(() => compactRoadmap(d, { apply: true }));
    } finally {
      fs.chmodSync(rmPath, 0o644);
    }
    assert.equal(rm(d), ROADMAP, 'roadmap.md untouched');
    assert.match(fs.readFileSync(hist(d), 'utf8'), /Base criterion 10,/, 'the sections are already safe in the history');
  });

  test('--keep must be a whole number', () => {
    const r = runPanTools('roadmap compact --keep two', project());
    assert.equal(r.success, false);
    assert.match(r.error, /--keep needs a whole number/);
  });

  test('hygiene offers compact-roadmap on a large roadmap and `hygiene clean --apply` runs it', () => {
    // Over the per-file warning (6,000 tokens) with shipped phases to move.
    const n = 30;
    const big = ['# Roadmap', '', ...Array.from({ length: n }, (_, i) => `- [x] **Phase ${i + 1}: Part ${i + 1}** — work`), '',
      ...Array.from({ length: n }, (_, i) => detail(i + 1, `Part ${i + 1}`, `deliver part ${i + 1}`, null, `P-${i + 1}`).join('\n')), ''].join('\n\n');
    const d = project(big);
    const scan = runPanTools('hygiene scan --raw', d);
    assert.match(scan.output, /roadmap\.md[\s\S]*can move to roadmap-history\.md/);
    const clean = runPanTools('hygiene clean --apply', d);
    assert.ok(clean.success, clean.error);
    assert.ok(fs.existsSync(hist(d)), 'clean --apply compacted the roadmap');
    assert.ok(rm(d).length < big.length);
  });
});
