// CRLF parity for every parser that reads a planning file (memory optimisation O1).
//
// A Windows working tree (core.autocrlf=true) holds `.planning/` with CRLF endings:
// on 2026-10-04 every Windows field project measured was CRLF throughout. A parser
// written for '\n' then finds nothing and says nothing. `memory optimize` reported
// every such state.md as lean, `parseMustHavesBlock` returned no must-haves (so the
// reconcile gate trusted the verdict), and `frontmatter set` stacked a second block.
// Each case runs the same fixture with LF and with CRLF endings and expects the same
// answer once '\r' is set aside; the write paths must also keep the file's ending.

'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPanTools } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const lib = (m) => require(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', `${m}.cjs`));
const toCrlf = (s) => s.replace(/\r?\n/g, '\r\n');
const same = (s) => s;
// The answer with every '\r' set aside, so only a real parse difference counts.
const comparable = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(/\\r/g, ''));

const STATE = [
  '---', 'status: executing', 'current_phase: 3', '---', '',
  '# Project State', '',
  '## Current Position', '',
  '**Current Phase:** 3', '**Current Phase Name:** Payments', '**Status:** In progress', '',
  '## Accumulated Context', '',
  '### Decisions', '',
  ...Array.from({ length: 20 }, (_, i) => `- Decision ${i + 1}: use approach ${i + 1}`), '',
  '### Blockers/Concerns', '', '- None', '',
  '## Session Continuity', '', '**Stopped At:** Task 2 of plan 3-02', '',
].join('\n');
const ROADMAP = [
  '# Roadmap', '',
  '## Milestones', '', '- ✅ **v1.0 MVP** — Phases 1-2 (shipped 2026-01-01)', '- 🚧 **v1.1 Payments** — Phases 3-4', '',
  '## Phases', '',
  '- [x] **Phase 1: Base** — scaffolding', '- [x] **Phase 2: Auth** — sign-in', '- [ ] **Phase 3: Payments** — cards', '- [ ] **Phase 4: Ship** — release', '',
  '## Phase Details', '',
  '### Phase 3: Payments', '**Goal**: take card payments', '**Depends on**: Phase 2', '**Requirements**: PAY-01, PAY-02', '',
  '### Phase 4: Ship', '**Goal**: release', '**Requirements**: SHIP-01', '',
].join('\n');
const PLAN = [
  '---', 'phase: 03-payments', 'plan: 01', 'type: execute', 'wave: 1', 'depends_on: [phase:2]', 'files_modified: [src/pay.ts]',
  'must_haves:', '  truths:', '    - "A card payment settles"', '  artifacts:', '    - path: "src/pay.ts"', '      provides: "settle()"', '---', '',
  '<objective>', 'Settle payments', '</objective>', '',
].join('\n');
const LEARNINGS = ['# Learnings', '', '### LEARN-001: Bulk writes', '', '**Pattern:** prefer bulk writes', '**Source:** phase 2', ''].join('\n');
const MEMORY = ['---', 'agent: pan-executor', 'created: 2026-01-01', '---', '', '## Entries', '', '- 2026-01-02: Prefer bulk writes for Postgres', '- 2026-01-03: Mock the clock in settle tests', ''].join('\n');
const CONVENTIONS = ['# Conventions', '', '- Never use `setTimeout` in services', '- Use `zod` instead of `joi`', ''].join('\n');
// A real shipped topic, so the learnings readers see the shape they read in the field.
const TOPIC = fs.readFileSync(path.join(ROOT, 'pan-wizard-core', 'learnings', 'universal', 'output-conventions.md'), 'utf8');

const made = [];
function project(eol) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-crlf-'));
  made.push(d);
  const put = (rel, text) => {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, eol(text));
  };
  put('.planning/state.md', STATE);
  put('.planning/roadmap.md', ROADMAP);
  put('.planning/memory/pan-executor.md', MEMORY);
  put('.planning/phases/02-auth/02-01-plan.md', PLAN.replace('03-payments', '02-auth').replace('depends_on: [phase:2]', 'depends_on: []'));
  put('.planning/phases/03-payments/03-01-plan.md', PLAN);
  put('pan-wizard-core/learnings/universal/output-conventions.md', TOPIC);
  return d;
}
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// Run a reader on a fresh project and report its answer with that project's own
// path written as <root>, so two projects compare by content, not by location.
function inProject(eol, read) {
  const d = project(eol);
  let text = JSON.stringify(read(d) ?? null);
  for (const form of [d, d.replace(/\\/g, '/')]) text = text.split(JSON.stringify(form).slice(1, -1)).join('<root>');
  return JSON.parse(text);
}

describe('every planning-file parser answers the same on LF and CRLF', () => {
  const cases = [
    ['memory optimize: optimizeStateContent', (eol) => lib('memory-optimize').optimizeStateContent(eol(STATE), { keep: 5 })],
    ['state compact: splitSections', (eol) => lib('state-compact').splitSections(eol(STATE))],
    ['memory: parseEntries', (eol) => lib('memory').parseEntries(eol(MEMORY))],
    ['memory: selectMemory', (eol) => inProject(eol, (d) => lib('memory').selectMemory(d, 'pan-executor', { cue: 'postgres bulk' }))],
    ['roadmap: extractMilestones', (eol) => lib('roadmap').extractMilestones(eol(ROADMAP))],
    ['core: parseMilestoneHeadings', (eol) => lib('core').parseMilestoneHeadings(eol(ROADMAP))],
    ['core: getRoadmapPhaseInternal', (eol) => inProject(eol, (d) => lib('core').getRoadmapPhaseInternal(d, '3'))],
    ['core: getMilestoneInfo', (eol) => inProject(eol, (d) => lib('core').getMilestoneInfo(d))],
    ['verify retro: countRoadmapPhases', (eol) => lib('verify-retro').countRoadmapPhases(eol(ROADMAP))],
    ['frontmatter: extractFrontmatter', (eol) => lib('frontmatter').extractFrontmatter(eol(PLAN))],
    ['frontmatter: parseMustHavesBlock (truths)', (eol) => lib('frontmatter').parseMustHavesBlock(eol(PLAN), 'truths')],
    ['frontmatter: parseMustHavesBlock (artifacts)', (eol) => lib('frontmatter').parseMustHavesBlock(eol(PLAN), 'artifacts')],
    ['learnings: parseLearnings', (eol) => lib('commands-learnings').parseLearnings(eol(LEARNINGS))],
    ['drift: parseConventionRules', (eol) => lib('verify-drift').parseConventionRules(eol(CONVENTIONS))],
    ['preview: buildPhaseDependencyGraph', (eol) => inProject(eol, (d) => lib('preview').buildPhaseDependencyGraph(d))],
    ['learn lint: collectAllPatterns', (eol) => inProject(eol, (d) => lib('learn-lint').collectAllPatterns(d))],
    ['optimize: listPromotedPatterns', (eol) => inProject(eol, (d) => lib('optimize').listPromotedPatterns({ sourceRoot: d }))],
    ['state hook: buildReinjectContext', (eol) => require(path.join(ROOT, 'hooks', 'pan-state-reinject.js')).buildReinjectContext({ stateContent: eol(STATE), roadmapContent: eol(ROADMAP) })],
  ];
  for (const [name, parse] of cases) {
    test(name, () => {
      assert.deepEqual(comparable(parse(toCrlf)), comparable(parse(same)));
    });
  }

  test('the fixtures exercise the parsers (an empty answer on both sides proves nothing)', () => {
    assert.deepEqual(lib('frontmatter').parseMustHavesBlock(PLAN, 'truths'), ['A card payment settles']);
    assert.equal(lib('memory-optimize').optimizeStateContent(STATE, { keep: 5 }).changed, true);
    assert.ok(lib('learn-lint').collectAllPatterns(project(same)).length > 0, 'the shipped topic carries patterns');
  });

  test('state compact plans the same compaction, sizes measured in the file\'s own ending', () => {
    const plan = (eol) => lib('state-compact').planStateCompaction(project(eol), { keepDays: 30, now: new Date('2026-10-04') });
    const lf = plan(same);
    const crlf = plan(toCrlf);
    const noSizes = (p) => comparable(JSON.parse(JSON.stringify(p, (k, v) => (/bytes|tokens/.test(k) ? undefined : v))));
    assert.deepEqual(noSizes(crlf), noSizes(lf));
    // A compaction that archives nothing saves nothing, whatever the line ending:
    // the LF rebuild of a CRLF file used to read as a byte saved per line.
    assert.equal(lf.archivable.length, 0);
    assert.equal(crlf.tokens_saved_per_call, 0);
    assert.equal(crlf.bytes_after, crlf.bytes_before);
  });
});

describe('the write paths keep a CRLF file CRLF', () => {
  const onlyCrlf = (s) => !/(^|[^\r])\n/.test(s);

  test('memory optimize reconciles a CRLF state.md as it does an LF one, and returns it CRLF', () => {
    const { optimizeStateContent } = lib('memory-optimize');
    const lf = optimizeStateContent(STATE, { keep: 5 });
    const crlf = optimizeStateContent(toCrlf(STATE), { keep: 5 });
    assert.equal(crlf.changed, true);
    assert.deepEqual(crlf.sectionsTouched, lf.sectionsTouched);
    assert.equal(crlf.archived.length, lf.archived.length);
    assert.equal(crlf.content, toCrlf(lf.content));
    assert.ok(onlyCrlf(crlf.content), 'no bare LF line in the reconciled file');
  });

  test('spliceFrontmatter replaces a CRLF block instead of stacking a second one', () => {
    const { spliceFrontmatter, extractFrontmatter } = lib('frontmatter');
    const out = spliceFrontmatter(toCrlf(PLAN), { ...extractFrontmatter(PLAN), wave: 2 });
    assert.equal(out.split('\r\n').filter((l) => l === '---').length, 2, 'exactly one frontmatter block');
    assert.equal(extractFrontmatter(out).wave, '2');
    assert.ok(onlyCrlf(out));
  });

  test('`frontmatter set` on a CRLF file updates the one block and keeps CRLF', () => {
    const d = project(toCrlf);
    const rel = '.planning/phases/03-payments/03-01-plan.md';
    const r = runPanTools(`frontmatter set ${rel} --field wave --value 3`, d);
    assert.ok(r.success, r.error);
    const after = fs.readFileSync(path.join(d, rel), 'utf8');
    assert.equal(after.split('\r\n').filter((l) => l === '---').length, 2);
    assert.match(after, /\r\nwave: 3\r\n/);
    assert.ok(onlyCrlf(after));
  });
});
