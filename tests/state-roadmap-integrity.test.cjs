// state.md and roadmap.md writes keep what they did not mean to change.
//
// A field report (2026-08-22, PAN 3.27.0) found `state` writes stacking a second,
// regressed front-matter block on a CRLF checkout, dropping fields and keys the
// body did not restate, overwriting a recorded letter-series milestone with the
// resolver's `v1.0`, and mixing line endings; and `roadmap update-plan-progress`
// rewriting a phase's table row by column position. Every write reported success.
// These fixtures are neutral stand-ins for the shapes that broke.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createTempProject, cleanup, runPanTools } = require('./helpers.cjs');
const { extractFrontmatter } = require('../pan-wizard-core/bin/lib/frontmatter.cjs');
const { getMilestoneInfo } = require('../pan-wizard-core/bin/lib/core.cjs');

let dir;
beforeEach(() => { dir = createTempProject(); });
afterEach(() => cleanup(dir));

const planning = (...p) => path.join(dir, '.planning', ...p);
const write = (rel, text) => fs.writeFileSync(planning(rel), text);
const read = (rel) => fs.readFileSync(planning(rel), 'utf8');
const blocks = (text) => (text.replace(/\r\n/g, '\n').match(/^---\n[\s\S]*?\n---\n/gm) || []).length;

const STATE_LF = [
  '---',
  'pan_state_version: "1.0"',
  'milestone: R-2',
  'milestone_name: Second release',
  'current_phase: 7',
  'current_phase_name: Sync engine',
  'status: executing',
  'review_note: kept by the team, not by PAN',
  '---',
  '',
  '# Project State',
  '',
  '## Current Position',
  '',
  '**Current Phase:** 7',
  '**Status:** In progress',
  '',
  '### Decisions',
  '',
  '- Earlier decision',
  '',
  '## Session Continuity',
  '',
  '**Stopped At:** Plan 7-01 task 2',
  '**Resume File:** None',
  '',
].join('\n');

// A roadmap with no vN.N milestone heading — the case where the resolver can only guess.
const ROADMAP_NO_VERSION = '# Roadmap\n\n## Phases\n\n- [ ] **Phase 7: Sync engine**\n';

describe('state writes on a CRLF file (git core.autocrlf=true)', () => {
  beforeEach(() => {
    write('state.md', STATE_LF.replace(/\n/g, '\r\n'));
    write('roadmap.md', ROADMAP_NO_VERSION);
  });

  test('one front-matter block, CRLF throughout, and every recorded key kept', () => {
    const r = runPanTools('state add-decision --phase 7 --summary "Use a queue"', dir);
    assert.ok(r.success, r.error);
    const text = read('state.md');
    assert.equal(blocks(text), 1, 'a second block must never be stacked on top');
    assert.ok(!/[^\r]\n/.test(text), 'no bare LF — the file keeps its own line ending');
    const fm = extractFrontmatter(text);
    assert.equal(fm.review_note, 'kept by the team, not by PAN', 'a key PAN does not manage survives');
    assert.equal(fm.current_phase_name, 'Sync engine', 'a field the body does not restate keeps its value');
    assert.equal(fm.milestone, 'R-2', 'a recorded milestone is not replaced by a guess');
    assert.ok(text.includes('Use a queue'), 'the write itself landed');
  });

  test('without a roadmap the resolver can only guess, and the guess never replaces a recorded milestone', () => {
    fs.rmSync(planning('roadmap.md'));
    assert.equal(getMilestoneInfo(dir).basis, 'default', 'fixture premise: no roadmap, a pure guess');
    assert.ok(runPanTools('state record-session --stopped-at "Plan 7-01 done"', dir).success);
    assert.equal(extractFrontmatter(read('state.md')).milestone, 'R-2');
  });

  test('extractFrontmatter reads a CRLF or BOM-prefixed block', () => {
    assert.equal(extractFrontmatter(STATE_LF.replace(/\n/g, '\r\n')).milestone, 'R-2');
    assert.equal(extractFrontmatter('﻿' + STATE_LF).current_phase, '7');
  });
});

describe('a stacked state.md is refused, never rewritten', () => {
  test('two front-matter blocks → exit 1, file byte-identical', () => {
    const stacked = '---\nmilestone: v1.0\n---\n\n' + STATE_LF;
    write('state.md', stacked);
    write('roadmap.md', ROADMAP_NO_VERSION);
    const r = runPanTools('state record-session --stopped-at "x"', dir);
    assert.equal(r.success, false, 'the write must fail loudly');
    assert.match(`${r.output} ${r.error}`, /more than one front-matter block/);
    assert.equal(read('state.md'), stacked, 'the file is untouched');
  });
});

describe('the milestone resolver and letter-series labels', () => {
  test('a letter-series heading is a milestone, named from the same heading', () => {
    write('roadmap.md', '# Roadmap\n\n### ✅ R-1 · First release — Phases 1-4 · CLOSED 2026-05-01\n\n### 🚧 R-2 · Second release — Phases 5-9\n\n### R-3 · Third release\n');
    const info = getMilestoneInfo(dir);
    assert.equal(info.version, 'R-2');
    assert.equal(info.name, 'Second release');
    assert.equal(info.basis, 'marked-current');
  });

  test('a label mentioned inside a heading is not a milestone', () => {
    write('roadmap.md', '# Roadmap\n\n## Notes on R-2 scope\n\n## Phase 3: Build\n');
    assert.notEqual(getMilestoneInfo(dir).version, 'R-2');
  });

  test('a repeated heading is one milestone, and a shipped one is not revived by an unmarked repeat', () => {
    write('roadmap.md', '# Roadmap\n\n## ✅ v2.0 Core — shipped\n\n## 🚧 v2.1 Reporting\n\n## Traceability\n\n### v2.0 Core\n\n### v2.1 Reporting\n');
    const info = getMilestoneInfo(dir);
    assert.equal(info.version, 'v2.1');
    assert.equal(info.candidates, 2, 'two milestones, not four');
  });

  test('all shipped: the highest label is current, whatever the document order', () => {
    write('roadmap.md', '# Roadmap\n\n## ✅ v3.0 Newest — shipped\n\n## ✅ v2.0 Middle — shipped\n\n## ✅ v1.0 Oldest — shipped\n');
    assert.equal(getMilestoneInfo(dir).version, 'v3.0');
  });

  test('with no milestone heading, state.md is read before any constant', () => {
    write('roadmap.md', ROADMAP_NO_VERSION);
    write('state.md', STATE_LF);
    const info = getMilestoneInfo(dir);
    assert.deepEqual([info.version, info.name, info.basis], ['R-2', 'Second release', 'state']);
  });
});

describe('roadmap update-plan-progress locates cells by header', () => {
  const phaseDir = () => {
    const p = planning('phases', '07-sync-engine');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, '07-01-plan.md'), '---\nphase: 07\nplan: 01\n---\n');
    fs.writeFileSync(path.join(p, '07-02-plan.md'), '---\nphase: 07\nplan: 02\n---\n');
    fs.writeFileSync(path.join(p, '07-01-summary.md'), '---\nphase: 07\nplan: 01\n---\n');
  };

  test('PAN\'s milestone variant: the Milestone column is left alone', () => {
    phaseDir();
    write('roadmap.md', '# Roadmap\n\n| Phase | Milestone | Plans Complete | Status | Completed |\n|---|---|---|---|---|\n| 7. Sync engine | R-2 | 0/2 | Planned | |\n');
    const out = JSON.parse(runPanTools('roadmap update-plan-progress 7', dir).output);
    assert.equal(out.table_updated, true);
    assert.match(read('roadmap.md'), /\| 7\. Sync engine \| R-2 \| 1\/2 \| In Progress \|\s*\|/);
  });

  test('a table without Plans and Status columns is left alone and reported', () => {
    phaseDir();
    const table = '| Phase | Goal | Requirements | Success criteria |\n|---|---|---|---|\n| 7 | Keep devices in sync | SYNC-01..03 | 3 |\n';
    write('roadmap.md', '# Roadmap\n\n' + table);
    const out = JSON.parse(runPanTools('roadmap update-plan-progress 7', dir).output);
    assert.equal(out.table_updated, false);
    assert.match(out.table_reason, /no Plans and Status columns/);
    assert.ok(read('roadmap.md').includes(table), 'goal and requirement ids untouched');
  });

  test('the Plans line is rewritten in the phase\'s own section only', () => {
    phaseDir();
    const next = '### Phase 8: Export\n\n**Plans:** 0/3 plans executed\n';
    write('roadmap.md', '# Roadmap\n\n### Phase 7: Sync engine\n\nNo plans line here.\n\n' + next);
    runPanTools('roadmap update-plan-progress 7', dir);
    assert.ok(read('roadmap.md').includes(next), 'phase 8\'s Plans line is not phase 7\'s to rewrite');
  });
});
