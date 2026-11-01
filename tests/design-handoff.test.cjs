/**
 * Design hand-off (spec focus_phase_integration_featureai.md, D6): `design paths` puts
 * a design where the project keeps designs, and `design handoff` turns it into a
 * roadmap phase planned from the spec, or hands it to focus.
 */
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const D = require('../pan-wizard-core/bin/lib/design-handoff.cjs');

const ROOT = path.join(__dirname, '..');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const json = (r) => JSON.parse(r.output);

const ROADMAP = '# Roadmap\n\n## Phases\n\n- [ ] **Phase 1: API**\n\n### Phase 1: API\n\n**Goal:** an API\n';
const SPEC = '# Feature: Offline sync\n\n## 0.1 Problem statement\n\nUsers lose edits made without a network. They retype them later.\n\n## 0.2 Scope\n\n| In | Out |\n';

describe('design paths', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); });
  afterEach(() => cleanup(dir));

  test('a project with docs/specs and docs/decisions gets those, with the next ADR number', () => {
    write(dir, 'docs/specs/old.md', '# old\n');
    write(dir, 'docs/decisions/ADR-0007-old.md', '# ADR\n');
    write(dir, 'docs/decisions/ADR-0012-newer.md', '# ADR\n');
    const out = json(runPanTools('design paths "Offline Sync"', dir));
    assert.deepEqual(out, {
      layout: 'docs', slug: 'offline-sync',
      spec: 'docs/specs/offline-sync_featureai.md', decision: 'docs/decisions/ADR-0013-offline-sync.md',
      check: 'docs/specs/offline-sync_featureai.check.md', adr_number: '0013',
    });
  });

  test('any other project gets .planning/designs/<slug>/, even with docs/specs alone', () => {
    write(dir, 'docs/specs/old.md', '# old\n');
    const out = json(runPanTools('design paths offline-sync', dir));
    assert.equal(out.layout, 'planning');
    assert.equal(out.spec, '.planning/designs/offline-sync/spec.md');
    assert.equal(out.decision, '.planning/designs/offline-sync/decision.md');
    assert.equal(out.check, '.planning/designs/offline-sync/check.md');
  });

  test('a name that slugs to nothing is refused', () => {
    const r = runPanTools('design paths "!!!"', dir);
    assert.equal(r.success, false);
    assert.equal(json(r).error, 'slug_required');
  });
});

describe('design handoff', () => {
  let dir;
  beforeEach(() => { dir = createTempProject(); write(dir, '.planning/designs/offline-sync/spec.md', SPEC); });
  afterEach(() => cleanup(dir));
  const SPEC_REL = '.planning/designs/offline-sync/spec.md';

  test('--as phase adds a phase that names the spec and plans from it; a second hand-off is refused', () => {
    write(dir, '.planning/roadmap.md', ROADMAP);
    const out = json(runPanTools(`design handoff ${SPEC_REL} --as phase`, dir));
    assert.equal(out.phase_number, 2);
    assert.equal(out.title, 'Offline sync');
    assert.equal(out.command, `/pan:plan-phase 2 --prd ${SPEC_REL}`);
    const roadmap = read(dir, '.planning/roadmap.md');
    assert.match(roadmap, /### Phase 2: Offline sync\n\n\*\*Goal:\*\* Users lose edits made without a network\.\n\*\*Design:\*\* \.planning\/designs\/offline-sync\/spec\.md\n/);
    assert.match(roadmap, /- \[ \] \*\*Phase 2: Offline sync\*\*/, 'the checklist entry too');
    assert.ok(fs.existsSync(path.join(dir, '.planning', 'phases', '02-offline-sync')));

    const again = runPanTools(`design handoff ${SPEC_REL} --as phase`, dir);
    assert.equal(again.success, false);
    assert.equal(json(again).error, 'already_handed_off');
  });

  test('--as focus returns the focus plan step and changes nothing', () => {
    write(dir, '.planning/roadmap.md', ROADMAP);
    const out = json(runPanTools(`design handoff ${SPEC_REL} --as focus`, dir));
    assert.equal(out.command, '/pan:focus-auto --step plan --mode features');
    assert.equal(read(dir, '.planning/roadmap.md'), ROADMAP);
  });

  test('refusals: no roadmap, a missing spec, a spec outside the project, no --as', () => {
    const noRoadmap = json(runPanTools(`design handoff ${SPEC_REL} --as phase`, dir));
    assert.equal(noRoadmap.error, 'no_roadmap');
    assert.match(noRoadmap.reason, /\/pan:new-project/);
    assert.equal(json(runPanTools('design handoff nope.md --as focus', dir)).error, 'spec_not_found');
    assert.equal(json(runPanTools('design handoff ../outside.md --as focus', dir)).error, 'spec_outside_project');
    assert.equal(json(runPanTools(`design handoff ${SPEC_REL}`, dir)).error, 'invalid_as');
    assert.equal(fs.existsSync(path.join(dir, '.planning', 'roadmap.md')), false);
  });

  test('readSpecHeadline: the title without a Feature: prefix, the problem\'s first sentence, none when absent', () => {
    assert.deepEqual(D.readSpecHeadline(SPEC), { title: 'Offline sync', problem: 'Users lose edits made without a network.' });
    assert.deepEqual(D.readSpecHeadline('# **Bare**\n\nText.\n'), { title: 'Bare', problem: null });
    assert.equal(D.readSpecHeadline(`# T\n\n## Problem\n\n${'x'.repeat(300)}\n`).problem.length, 200);
  });

  test('phase add from the CLI is unchanged: a placeholder goal and no Design line', () => {
    write(dir, '.planning/roadmap.md', ROADMAP);
    assert.ok(runPanTools('phase add Billing', dir).success);
    const roadmap = read(dir, '.planning/roadmap.md');
    assert.match(roadmap, /### Phase 2: Billing\n\n\*\*Goal:\*\* \[To be planned\]\n\*\*Requirements\*\*: TBD/);
    assert.doesNotMatch(roadmap, /\*\*Design:\*\*/);
  });
});

describe('/pan:focus-design writes where design paths says and asks where the design goes', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'commands', 'pan', 'focus-design.md'), 'utf8');

  test('Phase 10 asks the engine for the paths and saves the checker verdict', () => {
    assert.match(prompt, /pan-tools\.cjs design paths "<feature_name>"/);
    assert.doesNotMatch(prompt, /Write complete spec to: `docs\/specs\//, 'no fixed docs/ path');
    assert.match(prompt, /final verdict block, with any caveats, to `check`/);
  });

  test('the closing question offers the hand-offs and the question tool is granted', () => {
    assert.match(prompt, /### 10\.4 Hand the Design Off/);
    assert.match(prompt, /design handoff <spec> --as phase/);
    assert.match(prompt, /design handoff <spec> --as focus/);
    assert.match(prompt.split('---')[1], /- AskUserQuestion/);
  });
});
