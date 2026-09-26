// pan-state-reinject.js — the planning position, re-injected after a compaction
// (market-ideas queue M10). The e2e driver in tests/hooks-e2e.test.cjs runs the
// installed copy for every runtime that registers it; this file pins the pure
// builder's rules and the process contract from the source.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildReinjectContext } = require('../hooks/pan-state-reinject.js');
const { spawnHook } = require('./helpers.cjs');

const STATE = [
  '# Project State', '',
  '## Current Position', '',
  '**Current Phase:** 3',
  '**Current Phase Name:** Payments',
  '**Current Plan:** 2',
  '**Total Plans in Phase:** 4',
  '**Status:** In progress',
  '**Last Activity Description:** Plan 3-01 summary written', '',
  '## Session Continuity', '',
  '**Stopped At:** Task 2 of plan 3-02',
  '**Resume File:** None', '',
].join('\n');
const ROADMAP = '- [x] **Phase 1: Base**\n- [x] **Phase 2: Auth**\n- [ ] **Phase 3: Payments**\n- [ ] **Phase 4: Ship**\n';

describe('buildReinjectContext', () => {
  test('names the phase, plan, status and stop point in flight', () => {
    const ctx = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP });
    assert.match(ctx, /^PAN project state, re-read from disk after context compaction:/);
    assert.match(ctx, /- Current phase: 3 \(Payments\), plan 2 of 4/);
    assert.match(ctx, /- Status: In progress/);
    assert.match(ctx, /- Stopped at: Task 2 of plan 3-02/);
    assert.match(ctx, /- First unbuilt roadmap phase: Phase 3/);
    assert.match(ctx, /Re-read \.planning\/state\.md/);
    assert.doesNotMatch(ctx, /Resume file/, '"None" is not a resume file');
    assert.doesNotMatch(ctx, /Last activity/, 'the stop point wins over the last-activity line');
  });

  test('silent without a state, a roadmap, a current phase, or unbuilt phases', () => {
    assert.equal(buildReinjectContext({ stateContent: null, roadmapContent: ROADMAP }), null);
    assert.equal(buildReinjectContext({ stateContent: STATE, roadmapContent: null }), null);
    assert.equal(buildReinjectContext({ stateContent: '**Status:** Ready', roadmapContent: ROADMAP }), null);
    assert.equal(buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP.replace(/\[ \]/g, '[x]') }), null);
  });

  test('template placeholders are not a position', () => {
    const template = '**Current Phase:** [X]\n**Status:** [Ready to plan / Planning]\n';
    assert.equal(buildReinjectContext({ stateContent: template, roadmapContent: ROADMAP }), null);
  });

  test('each field and the whole block stay bounded', () => {
    const long = STATE.replace('Task 2 of plan 3-02', 'x'.repeat(5000));
    const ctx = buildReinjectContext({ stateContent: long, roadmapContent: ROADMAP });
    assert.ok(ctx.length < 2000, `block is ${ctx.length} chars`);
    assert.match(ctx, /x…\n/, 'the long field is cut with an ellipsis');
  });

  test('a track names its own planning directory in the pointer line', () => {
    const ctx = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP, planningRel: '.planning/tracks/api' });
    assert.match(ctx, /Re-read \.planning\/tracks\/api\/state\.md/);
  });
});

describe('the hook process', () => {
  const HOOK = path.join(__dirname, '..', 'hooks', 'pan-state-reinject.js');

  test('a project with no planning tree gets nothing, and no directory is created', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-bare-'));
    try {
      const r = spawnHook(HOOK, { hook_event_name: 'SessionStart', source: 'compact', cwd: dir }, dir);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.deepEqual(fs.readdirSync(dir), [], 'the hook must never scaffold .planning/');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads the tree the payload cwd names, not the process cwd', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-proj-'));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-else-'));
    try {
      fs.mkdirSync(path.join(project, '.planning'));
      fs.writeFileSync(path.join(project, '.planning', 'state.md'), STATE);
      fs.writeFileSync(path.join(project, '.planning', 'roadmap.md'), ROADMAP);
      const r = spawnHook(HOOK, { hook_event_name: 'SessionStart', source: 'compact', cwd: project }, elsewhere);
      assert.equal(r.status, 0);
      assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Current phase: 3/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
