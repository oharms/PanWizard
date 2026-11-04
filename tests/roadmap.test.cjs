/**
 * PAN Tools Tests - Roadmap
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('roadmap get-phase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('extracts phase section from roadmap.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0

## Phases

### Phase 1: Foundation
**Goal:** Set up project infrastructure
**Plans:** 2 plans

Some description here.

### Phase 2: API
**Goal:** Build REST API
**Plans:** 3 plans
`
    );

    const result = runPanTools('roadmap get-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true, 'phase should be found');
    assert.strictEqual(output.phase_number, '1', 'phase number correct');
    assert.strictEqual(output.phase_name, 'Foundation', 'phase name extracted');
    assert.strictEqual(output.goal, 'Set up project infrastructure', 'goal extracted');
  });

  test('returns not found for missing phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Set up project
`
    );

    const result = runPanTools('roadmap get-phase 5', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'phase should not be found');
  });

  test('handles decimal phase numbers', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### Phase 2: Main
**Goal:** Main work

### Phase 2.1: Hotfix
**Goal:** Emergency fix
`
    );

    const result = runPanTools('roadmap get-phase 2.1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true, 'decimal phase should be found');
    assert.strictEqual(output.phase_name, 'Hotfix', 'phase name correct');
    assert.strictEqual(output.goal, 'Emergency fix', 'goal extracted');
  });

  test('extracts full section content', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### Phase 1: Setup
**Goal:** Initialize everything

This phase covers:
- Database setup
- Auth configuration
- CI/CD pipeline

### Phase 2: Build
**Goal:** Build features
`
    );

    const result = runPanTools('roadmap get-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.section.includes('Database setup'), 'section includes description');
    assert.ok(output.section.includes('CI/CD pipeline'), 'section includes all bullets');
    assert.ok(!output.section.includes('Phase 2'), 'section does not include next phase');
  });

  test('handles missing roadmap.md gracefully', () => {
    const result = runPanTools('roadmap get-phase 1', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'should return not found');
    assert.strictEqual(output.error, 'roadmap.md not found', 'should explain why');
  });

  test('accepts ## phase headers (two hashes)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0

## Phase 1: Foundation
**Goal:** Set up project infrastructure
**Plans:** 2 plans

## Phase 2: API
**Goal:** Build REST API
`
    );

    const result = runPanTools('roadmap get-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true, 'phase with ## header should be found');
    assert.strictEqual(output.phase_name, 'Foundation', 'phase name extracted');
    assert.strictEqual(output.goal, 'Set up project infrastructure', 'goal extracted');
  });

  test('detects malformed ROADMAP with summary list but no detail sections', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0

## Phases

- [ ] **Phase 1: Foundation** - Set up project
- [ ] **Phase 2: API** - Build REST API
`
    );

    const result = runPanTools('roadmap get-phase 1', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'phase should not be found');
    assert.strictEqual(output.error, 'malformed_roadmap', 'should identify malformed roadmap');
    assert.ok(output.message.includes('missing'), 'should explain the issue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase next-decimal command
// ─────────────────────────────────────────────────────────────────────────────


describe('roadmap analyze command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing roadmap.md returns error', () => {
    const result = runPanTools('roadmap analyze', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'roadmap.md not found');
  });

  test('parses phases with goals and disk status', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Set up infrastructure

### Phase 2: Authentication
**Goal:** Add user auth

### Phase 3: Features
**Goal:** Build core features
`
    );

    // Create phase dirs with varying completion
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');

    const p2 = path.join(tmpDir, '.planning', 'phases', '02-authentication');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, '02-01-plan.md'), '# Plan');

    const result = runPanTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_count, 3, 'should find 3 phases');
    assert.strictEqual(output.phases[0].disk_status, 'complete', 'phase 1 complete');
    assert.strictEqual(output.phases[1].disk_status, 'planned', 'phase 2 planned');
    assert.strictEqual(output.phases[2].disk_status, 'no_directory', 'phase 3 no directory');
    assert.strictEqual(output.completed_phases, 1, '1 phase complete');
    assert.strictEqual(output.total_plans, 2, '2 total plans');
    assert.strictEqual(output.total_summaries, 1, '1 total summary');
    assert.strictEqual(output.progress_percent, 50, '50% complete');
    assert.strictEqual(output.current_phase, '2', 'current phase is 2');
  });

  test('extracts goals and dependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### Phase 1: Setup
**Goal:** Initialize project
**Depends on:** Nothing

### Phase 2: Build
**Goal:** Build features
**Depends on:** Phase 1
`
    );

    const result = runPanTools('roadmap analyze', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phases[0].goal, 'Initialize project');
    assert.strictEqual(output.phases[0].depends_on, 'Nothing');
    assert.strictEqual(output.phases[1].goal, 'Build features');
    assert.strictEqual(output.phases[1].depends_on, 'Phase 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Roadmap helper unit tests (direct require)
// ─────────────────────────────────────────────────────────────────────────────

const {
  enumerateRoadmapPhases,
  enrichPhaseWithDiskStatus,
  extractMilestones,
  computeRoadmapStats,
} = require('../pan-wizard-core/bin/lib/roadmap.cjs');

describe('enumerateRoadmapPhases', () => {
  test('parses single phase', () => {
    const content = '## Phase 1: Foundation\n**Goal:** Build the base\n';
    const phases = enumerateRoadmapPhases(content);
    assert.strictEqual(phases.length, 1);
    assert.strictEqual(phases[0].number, '1');
    assert.strictEqual(phases[0].name, 'Foundation');
    assert.strictEqual(phases[0].goal, 'Build the base');
  });

  test('parses multiple phases', () => {
    const content = [
      '## Phase 1: Foundation',
      '**Goal:** Build the base',
      '## Phase 2: Features',
      '**Goal:** Add features',
      '**Depends on:** Phase 1',
    ].join('\n');
    const phases = enumerateRoadmapPhases(content);
    assert.strictEqual(phases.length, 2);
    assert.strictEqual(phases[1].number, '2');
    assert.strictEqual(phases[1].name, 'Features');
    assert.strictEqual(phases[1].depends_on, 'Phase 1');
  });

  test('handles decimal phases', () => {
    const content = '## Phase 2.1: Hotfix (INSERTED)\n**Goal:** Fix bug\n';
    const phases = enumerateRoadmapPhases(content);
    assert.strictEqual(phases.length, 1);
    assert.strictEqual(phases[0].number, '2.1');
    assert.strictEqual(phases[0].name, 'Hotfix');
  });

  test('returns empty array for no phases', () => {
    const phases = enumerateRoadmapPhases('# Roadmap\nJust some text.');
    assert.deepStrictEqual(phases, []);
  });

  test('goal is null when missing', () => {
    const content = '## Phase 1: Setup\nNo goal line here.\n';
    const phases = enumerateRoadmapPhases(content);
    assert.strictEqual(phases[0].goal, null);
  });
});

describe('enrichPhaseWithDiskStatus', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns no_directory when phase dir missing', () => {
    const result = enrichPhaseWithDiskStatus(tmpDir, { number: '99' });
    assert.strictEqual(result.disk_status, 'no_directory');
    assert.strictEqual(result.plan_count, 0);
    assert.strictEqual(result.summary_count, 0);
  });

  test('returns planned when plan.md exists', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'plan.md'), '# Plan');
    const result = enrichPhaseWithDiskStatus(tmpDir, { number: '1' });
    assert.strictEqual(result.disk_status, 'planned');
    assert.strictEqual(result.plan_count, 1);
  });

  test('returns complete when summaries match plans', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, 'summary.md'), '# Summary');
    const result = enrichPhaseWithDiskStatus(tmpDir, { number: '1' });
    assert.strictEqual(result.disk_status, 'complete');
    assert.strictEqual(result.summary_count, 1);
  });

  test('returns empty for phase dir with no plan/summary files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'notes.txt'), 'random');
    const result = enrichPhaseWithDiskStatus(tmpDir, { number: '1' });
    assert.strictEqual(result.disk_status, 'empty');
  });
});

describe('extractMilestones', () => {
  test('extracts milestone headings with versions', () => {
    const content = [
      '## v0.1 MVP',
      'Phase 1: Foundation',
      '## v1.0 Production Release',
      'Phase 5: Polish',
    ].join('\n');
    const milestones = extractMilestones(content);
    assert.strictEqual(milestones.length, 2);
    assert.strictEqual(milestones[0].version, 'v0.1');
    assert.ok(milestones[0].heading.includes('MVP'));
    assert.strictEqual(milestones[1].version, 'v1.0');
  });

  test('returns empty array when no milestones', () => {
    const milestones = extractMilestones('# Roadmap\n## Phase 1: Setup\n');
    assert.deepStrictEqual(milestones, []);
  });
});

describe('computeRoadmapStats', () => {
  test('computes stats for mixed phases', () => {
    const phases = [
      { number: '1', disk_status: 'complete', plan_count: 1, summary_count: 1 },
      { number: '2', disk_status: 'planned', plan_count: 2, summary_count: 0 },
      { number: '3', disk_status: 'no_directory', plan_count: 0, summary_count: 0 },
    ];
    const stats = computeRoadmapStats(phases);
    assert.strictEqual(stats.completedPhases, 1);
    assert.strictEqual(stats.totalPlans, 3);
    assert.strictEqual(stats.totalSummaries, 1);
    assert.strictEqual(stats.currentPhase, '2');
  });

  test('identifies current and next phase', () => {
    const phases = [
      { number: '1', disk_status: 'complete', plan_count: 1, summary_count: 1 },
      { number: '2', disk_status: 'partial', plan_count: 2, summary_count: 1 },
      { number: '3', disk_status: 'no_directory', plan_count: 0, summary_count: 0 },
    ];
    const stats = computeRoadmapStats(phases);
    assert.strictEqual(stats.currentPhase, '2');
    assert.strictEqual(stats.nextPhase, '3');
  });

  test('returns zeroes for empty phases array', () => {
    const stats = computeRoadmapStats([]);
    assert.strictEqual(stats.completedPhases, 0);
    assert.strictEqual(stats.totalPlans, 0);
    assert.strictEqual(stats.progressPercent, 0);
    assert.strictEqual(stats.currentPhase, null);
    assert.strictEqual(stats.nextPhase, null);
  });

  test('progressPercent caps at 100', () => {
    const phases = [
      { disk_status: 'complete', plan_count: 1, summary_count: 2 },
    ];
    const stats = computeRoadmapStats(phases);
    assert.strictEqual(stats.progressPercent, 100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// roadmap error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('roadmap commands handle missing roadmap.md', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // No roadmap.md — commands should handle gracefully
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('roadmap get-phase returns error when roadmap.md missing', () => {
    const result = runPanTools('roadmap get-phase 1', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false);
  });

  test('roadmap analyze returns error when roadmap.md missing', () => {
    const result = runPanTools('roadmap analyze', tmpDir);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.deepStrictEqual(output.phases, []);
  });

  test('roadmap update-plan-progress returns error when roadmap.md missing', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    const result = runPanTools('roadmap update-plan-progress 1', tmpDir);
    // Exit 1: there are plans to record and nowhere to record them. The JSON body is
    // still on stdout, which is what "succeed with error JSON" was really checking.
    assert.equal(result.success, false, 'plan progress was computed and then dropped');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, false);
    assert.ok(output.reason.includes('roadmap.md'), 'reason should mention roadmap.md');
  });

  // PAN-02: summaries were counted as files, so an orphan (a research summary) made the
  // Progress row read 2/2 Complete with one of two plans done.
  test('roadmap update-plan-progress counts only summaries that belong to a plan', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '29.4-decimal');
    fs.mkdirSync(phaseDir, { recursive: true });
    for (const f of ['29.4-01-plan.md', '29.4-02-PLAN.md', '29.4-01-summary.md', '29.4-research-summary.md']) fs.writeFileSync(path.join(phaseDir, f), '# x\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), [
      '# Roadmap', '', '- [ ] **Phase 29.4: Decimal**', '', '### Phase 29.4: Decimal', '**Goal:** g', '**Plans:** 0/2 plans', '',
      '## Progress', '', '| Phase | Plans Complete | Status | Completed |', '|---|---|---|---|', '| 29.4. Decimal | 0/2 | Not started | - |', '',
    ].join('\n'));
    const result = runPanTools('roadmap update-plan-progress 29.4', tmpDir);
    assert.equal(result.success, true, result.output);
    const out = JSON.parse(result.output);
    assert.equal(out.summary_count, 1, JSON.stringify(out));
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf8');
    assert.match(roadmap, /\| 29\.4\. Decimal \| 1\/2 \| In Progress \|/);
    assert.doesNotMatch(roadmap, /2\/2 \| Complete/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase add command
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PAN-15 (3.42.0): wrapped goals and wrapped or bulleted success criteria
// ─────────────────────────────────────────────────────────────────────────────

describe('PAN-15: multi-line goal and criteria', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const write = (text) => fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), text);
  const getPhase = (n) => {
    const r = runPanTools(`roadmap get-phase ${n}`, tmpDir);
    assert.ok(r.success, r.error);
    return JSON.parse(r.output);
  };

  const WRAPPED = [
    '# Roadmap',
    '',
    '### Phase 1: Auth',
    '',
    '**Goal:** Users can sign in with SSO',
    'and stay signed in across',
    'browser restarts',
    '**Depends on:** Nothing',
    '',
    '**Success Criteria** (what must be TRUE):',
    '1. A user signs in with',
    '   their company account',
    '2. A session survives a restart',
    '',
    '### Phase 2: Billing',
    '',
    '**Goal:** Charge cards',
    '',
    '**Success Criteria**:',
    '- Cards are charged once',
    '- Refunds',
    '  reach the card',
    '',
    '### Phase 3: Mixed',
    '**Goal:**',
    '  Goal on the next line',
    '**Success Criteria:**',
    '1. Numbered first',
    '- then a bullet',
    '2) then a paren item',
    '',
    'Plans:',
    '- [ ] TBD',
    '',
  ].join('\n');

  test('a wrapped goal is read whole and stops at **Depends on:**', () => {
    write(WRAPPED);
    assert.equal(getPhase(1).goal, 'Users can sign in with SSO and stay signed in across browser restarts');
  });

  test('a wrapped numbered criterion joins its continuation line', () => {
    write(WRAPPED);
    assert.deepEqual(getPhase(1).success_criteria, ['A user signs in with their company account', 'A session survives a restart']);
  });

  test('bullet criteria are read', () => {
    write(WRAPPED);
    assert.deepEqual(getPhase(2).success_criteria, ['Cards are charged once', 'Refunds reach the card']);
  });

  test('mixed numbered and bulleted criteria, and a goal on the next line', () => {
    write(WRAPPED);
    const p = getPhase(3);
    assert.equal(p.goal, 'Goal on the next line');
    assert.deepEqual(p.success_criteria, ['Numbered first', 'then a bullet', 'then a paren item']);
  });

  test('a CRLF roadmap reads the same', () => {
    write(WRAPPED.replace(/\n/g, '\r\n'));
    const p = getPhase(1);
    assert.equal(p.goal, 'Users can sign in with SSO and stay signed in across browser restarts');
    assert.deepEqual(p.success_criteria, ['A user signs in with their company account', 'A session survives a restart']);
  });

  test('roadmap analyze reports the full goal', () => {
    write(WRAPPED);
    const r = runPanTools('roadmap analyze', tmpDir);
    assert.ok(r.success, r.error);
    const phase1 = JSON.parse(r.output).phases.find((p) => p.number === '1');
    assert.equal(phase1.goal, 'Users can sign in with SSO and stay signed in across browser restarts');
    assert.equal(phase1.depends_on, 'Nothing');
  });

  test('core getRoadmapPhaseInternal (init) returns the full goal', () => {
    write(WRAPPED);
    const { getRoadmapPhaseInternal } = require('../pan-wizard-core/bin/lib/core.cjs');
    assert.equal(getRoadmapPhaseInternal(tmpDir, '1').goal, 'Users can sign in with SSO and stay signed in across browser restarts');
  });
});
