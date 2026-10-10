// Padded phase numbers in the roadmap and requirements lookups (doc audit 2026-10-05,
// pass 2). The same class of bug tests/phase-number-padding.test.cjs guards for focus
// scan and deps validate, found in four more places:
//
// `init` hands workflows a zero-padded phase number ("05") and phase directories are
// padded, while PAN writes `### Phase 5:` headings. Matching the number as typed made
// `roadmap get-phase 05` answer found:false, `roadmap update-plan-progress 05` report
// updated:true and change nothing (the executor's own call), and `report phase` find
// no goal. And `phase complete` / `validate health --repair` took the first
// `**Requirements:**` line after the first "Phase N" anywhere: with the checklist
// above the sections, as templates/roadmap.md lays it out, that was phase 1's.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const ROADMAP = [
  '# Roadmap', '',
  '## Phases', '',
  '- [x] **Phase 1: Base** - base',
  '- [ ] **Phase 5: Pay** - payments', '',
  '## Phase Details', '',
  '### Phase 1: Base',
  '**Goal:** Base works',
  '**Requirements:** BASE-01',
  '**Plans:** 1 plans', '',
  '### Phase 5: Pay',
  '**Goal:** Users can pay',
  '**Requirements:** PAY-01, PAY-02',
  '**Success Criteria** (what must be TRUE):',
  '  1. A payment completes', '',
  '**Plans:** 0 plans', '',
  '## Progress', '',
  '| Phase | Plans Complete | Status | Completed |',
  '|-------|----------------|--------|-----------|',
  '| 1. Base | 1/1 | Complete | 2026-10-01 |',
  '| 5. Pay | 0/1 | Not started | - |', '',
].join('\n');

const REQUIREMENTS = [
  '# Requirements', '',
  '- [ ] **BASE-01**: base',
  '- [ ] **PAY-01**: pay one',
  '- [ ] **PAY-02**: pay two', '',
  '## Traceability', '',
  '| Requirement | Phase | Status |',
  '|-------------|-------|--------|',
  '| BASE-01 | Phase 1 | Pending |',
  '| PAY-01 | Phase 5 | Pending |',
  '| PAY-02 | Phase 5 | Pending |', '',
].join('\n');

function seed(tmp) {
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text);
  };
  write('.planning/roadmap.md', ROADMAP);
  write('.planning/requirements.md', REQUIREMENTS);
  write('.planning/state.md', '# State\n\n**Current Phase:** 5\n');
  write('.planning/phases/05-pay/05-01-plan.md', '---\nphase: 05-pay\nplan: 01\n---\n# Plan\n');
  write('.planning/phases/05-pay/05-01-summary.md', '---\nphase: 05-pay\nplan: 01\n---\n# Summary\n');
}
const read = (tmp, rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');

describe('a padded phase number finds an unpadded roadmap heading', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); });
  afterEach(() => cleanup(tmp));

  test('roadmap get-phase 05 finds `### Phase 5:`', () => {
    const r = runPanTools('roadmap get-phase 05', tmp);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.found, true);
    assert.equal(json.goal, 'Users can pay');
    assert.deepEqual(json.success_criteria, ['A payment completes']);
  });

  test('roadmap update-plan-progress 05 updates the table row, the Plans line and the checkbox', () => {
    const r = runPanTools('roadmap update-plan-progress 05', tmp);
    assert.ok(r.success, r.error);
    assert.equal(JSON.parse(r.output).table_updated, true);
    const roadmap = read(tmp, '.planning/roadmap.md');
    assert.match(roadmap, /^\| 5\. Pay \| 1\/1 \| Complete \| \d{4}-\d{2}-\d{2} \|$/m);
    assert.match(roadmap, /^\*\*Plans:\*\* 1\/1 plans complete$/m);
    assert.match(roadmap, /^- \[x\] \*\*Phase 5: Pay\*\*/m);
    assert.match(roadmap, /^\| 1\. Base \| 1\/1 \| Complete \| 2026-10-01 \|$/m, 'phase 1 untouched');
  });

  test('report phase reads the goal under an unpadded heading', () => {
    const r = runPanTools('report phase 5 --stdout', tmp);
    assert.ok(r.success, r.error);
    assert.match(r.output, /Users can pay/);
    assert.match(r.output, /A payment completes/);
  });
});

describe('completing a phase ticks its own requirements', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); seed(tmp); });
  afterEach(() => cleanup(tmp));

  test('phase complete 5 ticks PAY-01 and PAY-02 and leaves phase 1\'s BASE-01 alone', () => {
    const r = runPanTools('phase complete 5 --no-commit', tmp);
    assert.ok(r.success, r.error);
    const req = read(tmp, '.planning/requirements.md');
    assert.match(req, /^- \[x\] \*\*PAY-01\*\*/m);
    assert.match(req, /^- \[x\] \*\*PAY-02\*\*/m);
    assert.match(req, /^- \[ \] \*\*BASE-01\*\*/m);
    assert.match(req, /^\| PAY-01 \| Phase 5 \| Complete \|$/m);
    assert.match(req, /^\| BASE-01 \| Phase 1 \| Pending \|$/m);
  });

  test('the --repair requirements sync ticks each completed phase\'s own requirements', () => {
    // syncRequirementCheckboxes reads files and writes requirements.md; it prints nothing.
    const { syncRequirementCheckboxes } = require('../pan-wizard-core/bin/lib/verify.cjs');
    fs.writeFileSync(path.join(tmp, '.planning', 'roadmap.md'),
      ROADMAP.replace('- [x] **Phase 1: Base**', '- [ ] **Phase 1: Base**').replace('- [ ] **Phase 5: Pay**', '- [x] **Phase 5: Pay**'));
    const result = syncRequirementCheckboxes(tmp);
    assert.equal(result.fixed, 2);
    const req = read(tmp, '.planning/requirements.md');
    assert.match(req, /^- \[x\] \*\*PAY-01\*\*/m);
    assert.match(req, /^- \[x\] \*\*PAY-02\*\*/m);
    assert.match(req, /^- \[ \] \*\*BASE-01\*\*/m);
  });
});

// A bare prefix match found `02.1-fix` for phase 2 when phase 2 had no directory yet,
// so plan, discuss and research would have written phase 2's files into 2.1's.
describe('phase lookups match a phase number, not a prefix of a longer one', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.1-fix'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '02.1-fix', '02.1-01-plan.md'), '---\nphase: 02.1-fix\nplan: 01\nwave: 1\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n\n### Phase 2: Base\n**Goal:** g\n\n### Phase 2.1: Fix\n**Goal:** h\n');
  });
  afterEach(() => { cleanup(tmpDir); });

  test('init, find-phase, phase-plan-index and phases list do not hand phase 2 the 2.1 directory', () => {
    const init = JSON.parse(runPanTools('init plan-phase 2', tmpDir).output);
    assert.equal(init.phase_dir, null, `init plan-phase 2 → ${init.phase_dir}`);
    const found = JSON.parse(runPanTools('find-phase 2', tmpDir).output);
    assert.equal(found.found, false, `find-phase 2 → ${found.directory}`);
    const index = JSON.parse(runPanTools('phase-plan-index 2', tmpDir).output);
    assert.deepEqual(index.plans || [], [], 'phase 2 has no plans');
    const list = JSON.parse(runPanTools('phases list --phase 2', tmpDir).output);
    assert.ok(!JSON.stringify(list).includes('02.1-fix'), JSON.stringify(list));
    assert.equal(JSON.parse(runPanTools('find-phase 2.1', tmpDir).output).directory, '.planning/phases/02.1-fix', '2.1 itself is still found');
  });
});
