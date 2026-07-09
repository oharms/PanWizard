/**
 * PAN Tools Tests - Roadmap Mutation Commands
 *
 * Tests for the `roadmap update-plan-progress` command which:
 *   - Takes a phase number, finds the phase on disk, counts plans and summaries
 *   - Updates roadmap.md: progress table row, status, date, plan count, checkbox
 *   - Returns JSON with update results
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ── roadmap.md fixture template ─────────────────────────────────────────────

const ROADMAP_FIXTURE = `# Roadmap

## v1.0 MVP

### Progress
| Phase | Plans | Status | Date |
|-------|-------|--------|------|
| 01. Setup | 0/3 | Planned | |

### Summary
- [ ] **Phase 01: Setup**

### Phase 01: Setup
**Goal:** Set up the project
**Plans:** 0/3 plans executed
`;

// ── Minimal PLAN.md frontmatter ─────────────────────────────────────────────

const MINIMAL_PLAN = `---
phase: "01"
plan: "01"
---
# Plan
`;

const MINIMAL_SUMMARY = `---
phase: "01"
plan: "01"
---
# Summary
`;

// ─────────────────────────────────────────────────────────────────────────────
// roadmap update-plan-progress command
// ─────────────────────────────────────────────────────────────────────────────

describe('roadmap update-plan-progress command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('updates progress for partial phase (1 of 3 plans complete)', () => {
    // Set up phase directory with 3 plans and 1 summary
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-03-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), MINIMAL_SUMMARY);

    // Write roadmap.md
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      ROADMAP_FIXTURE
    );

    const result = runPanTools('roadmap update-plan-progress 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should report updated');
    assert.strictEqual(output.phase, '01', 'phase should be 01');
    assert.strictEqual(output.plan_count, 3, 'plan_count should be 3');
    assert.strictEqual(output.summary_count, 1, 'summary_count should be 1');
    assert.strictEqual(output.status, 'In Progress', 'status should be In Progress');
    assert.strictEqual(output.complete, false, 'complete should be false');

    // Verify roadmap.md was updated on disk
    const roadmap = fs.readFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      'utf-8'
    );
    assert.ok(roadmap.includes('1/3'), 'progress table should show 1/3');
    assert.ok(roadmap.includes('In Progress'), 'status should show In Progress');
    assert.ok(roadmap.includes('1/3 plans executed'), 'plan count line should show 1/3 plans executed');
    // Checkbox should remain unchecked
    assert.ok(roadmap.includes('- [ ] **Phase 01: Setup**'), 'checkbox should remain unchecked');
  });

  test('marks phase complete when all summaries exist (2 of 2)', () => {
    // Set up phase directory with 2 plans and 2 summaries
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), MINIMAL_SUMMARY);
    fs.writeFileSync(path.join(phaseDir, '01-02-summary.md'), MINIMAL_SUMMARY);

    // ROADMAP with 2 plans in progress table
    const roadmapWith2Plans = ROADMAP_FIXTURE.replace('0/3', '0/2').replace('0/3', '0/2');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      roadmapWith2Plans
    );

    const result = runPanTools('roadmap update-plan-progress 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should report updated');
    assert.strictEqual(output.plan_count, 2, 'plan_count should be 2');
    assert.strictEqual(output.summary_count, 2, 'summary_count should be 2');
    assert.strictEqual(output.status, 'Complete', 'status should be Complete');
    assert.strictEqual(output.complete, true, 'complete should be true');

    // Verify roadmap.md was updated on disk
    const roadmap = fs.readFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      'utf-8'
    );
    assert.ok(roadmap.includes('2/2'), 'progress table should show 2/2');
    assert.ok(roadmap.includes('Complete'), 'status should show Complete');
    assert.ok(roadmap.includes('2/2 plans complete'), 'plan count line should show 2/2 plans complete');
    // Checkbox should be checked
    assert.ok(roadmap.includes('[x]'), 'checkbox should be checked');
    assert.ok(roadmap.includes('completed'), 'checkbox line should include completed date');
    // Date should appear in the progress table row
    assert.ok(
      roadmap.match(/\d{4}-\d{2}-\d{2}/),
      'completion date should appear in ROADMAP'
    );
  });

  test('returns no-plans when phase has no plan files', () => {
    // Create phase directory but with no plan files
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    // ROADMAP exists but phase has no plans
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      ROADMAP_FIXTURE
    );

    const result = runPanTools('roadmap update-plan-progress 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, false, 'should report not updated');
    assert.strictEqual(output.reason, 'No plans found', 'reason should be No plans found');
    assert.strictEqual(output.plan_count, 0, 'plan_count should be 0');
    assert.strictEqual(output.summary_count, 0, 'summary_count should be 0');
  });

  test('returns error when phase not found on disk', () => {
    // No phase directory created for phase 99
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      ROADMAP_FIXTURE
    );

    const result = runPanTools('roadmap update-plan-progress 99', tmpDir);
    assert.ok(!result.success, 'command should fail when phase not found');
    assert.ok(
      result.error.includes('Phase 99 not found') || result.error.includes('not found'),
      'error should indicate phase not found'
    );
  });

  test('returns error when phase number is missing', () => {
    const result = runPanTools('roadmap update-plan-progress', tmpDir);
    assert.ok(!result.success, 'command should fail when phase number missing');
    assert.ok(
      result.error.includes('required') || result.error.includes('phase number'),
      'error should indicate phase number is required'
    );
  });

  test('handles missing roadmap.md when phase exists on disk', () => {
    // Create phase with plans but no roadmap.md
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), MINIMAL_PLAN);

    // Explicitly do NOT create roadmap.md

    const result = runPanTools('roadmap update-plan-progress 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, false, 'should report not updated');
    assert.strictEqual(output.reason, 'roadmap.md not found', 'reason should be roadmap.md not found');
    assert.strictEqual(output.plan_count, 2, 'plan_count should reflect disk state');
    assert.strictEqual(output.summary_count, 0, 'summary_count should be 0');
  });

  test('status is Planned when phase has plans but zero summaries', () => {
    // Set up phase directory with 3 plans and 0 summaries
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), MINIMAL_PLAN);
    fs.writeFileSync(path.join(phaseDir, '01-03-plan.md'), MINIMAL_PLAN);

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      ROADMAP_FIXTURE
    );

    const result = runPanTools('roadmap update-plan-progress 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should report updated');
    assert.strictEqual(output.status, 'Planned', 'status should be Planned when 0 summaries');
    assert.strictEqual(output.summary_count, 0, 'summary_count should be 0');
    assert.strictEqual(output.plan_count, 3, 'plan_count should be 3');
    assert.strictEqual(output.complete, false, 'complete should be false');

    // Verify roadmap.md table shows Planned
    const roadmap = fs.readFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      'utf-8'
    );
    assert.ok(roadmap.includes('0/3'), 'progress table should show 0/3');
    assert.ok(roadmap.includes('Planned'), 'status should remain Planned');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exported helper unit tests
// ─────────────────────────────────────────────────────────────────────────────

const {
  enumerateRoadmapPhases,
  extractMilestones,
  computeRoadmapStats,
  syncRequirementCheckboxes,
} = require('../pan-wizard-core/bin/lib/roadmap.cjs');

describe('enumerateRoadmapPhases', () => {
  test('parses multiple phase headings', () => {
    const content = `# Roadmap\n## Phase 1: Setup\n**Goal:** Initialize project\n## Phase 2: Auth\n**Goal:** Add auth\n`;
    const phases = enumerateRoadmapPhases(content);
    assert.strictEqual(phases.length, 2);
    assert.strictEqual(phases[0].number, '1');
    assert.strictEqual(phases[0].name, 'Setup');
    assert.strictEqual(phases[0].goal, 'Initialize project');
    assert.strictEqual(phases[1].number, '2');
    assert.strictEqual(phases[1].name, 'Auth');
  });

  test('returns empty array for roadmap with no phases', () => {
    const phases = enumerateRoadmapPhases('# Roadmap\n\nNo phases yet.');
    assert.strictEqual(phases.length, 0);
  });

  test('extracts depends_on field', () => {
    const content = `## Phase 3: Deploy\n**Goal:** Ship it\n**Depends on:** Phase 1, Phase 2\n`;
    const phases = enumerateRoadmapPhases(content);
    assert.strictEqual(phases[0].depends_on, 'Phase 1, Phase 2');
  });
});

describe('extractMilestones', () => {
  test('finds milestone headings with versions', () => {
    const content = `## v1.0 MVP\nPhases here\n## v2.0 Enhanced\nMore phases\n`;
    const milestones = extractMilestones(content);
    assert.strictEqual(milestones.length, 2);
    assert.strictEqual(milestones[0].version, 'v1.0');
    assert.ok(milestones[0].heading.includes('v1.0'));
    assert.strictEqual(milestones[1].version, 'v2.0');
  });

  test('returns empty array when no milestones found', () => {
    const milestones = extractMilestones('## Phase 1: Setup\n');
    assert.strictEqual(milestones.length, 0);
  });
});

describe('computeRoadmapStats', () => {
  test('computes totals and identifies current/next phase', () => {
    const phases = [
      { number: '1', disk_status: 'complete', plan_count: 3, summary_count: 3 },
      { number: '2', disk_status: 'partial', plan_count: 2, summary_count: 1 },
      { number: '3', disk_status: 'empty', plan_count: 0, summary_count: 0 },
    ];
    const stats = computeRoadmapStats(phases);
    assert.strictEqual(stats.totalPlans, 5);
    assert.strictEqual(stats.totalSummaries, 4);
    assert.strictEqual(stats.completedPhases, 1);
    assert.strictEqual(stats.currentPhase, '2');
    assert.strictEqual(stats.nextPhase, '3');
    assert.strictEqual(stats.progressPercent, 80);
  });

  test('returns 0% for project with no plans', () => {
    const stats = computeRoadmapStats([
      { number: '1', disk_status: 'empty', plan_count: 0, summary_count: 0 },
    ]);
    assert.strictEqual(stats.totalPlans, 0);
    assert.strictEqual(stats.progressPercent, 0);
    assert.strictEqual(stats.currentPhase, null);
  });
});

describe('roadmap update-plan-progress happy path', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    const planningDir = path.join(tmpDir, '.planning');
    // Create roadmap with progress table
    fs.writeFileSync(path.join(planningDir, 'roadmap.md'), [
      '# Roadmap',
      '',
      '| Phase | Plans | Status | Date |',
      '|-------|-------|--------|------|',
      '| 1 Setup |  | Planned |  |',
      '',
      '- [ ] Phase 1: Setup',
      '',
      '### Phase 1',
      '',
      '**Plans:** not started',
    ].join('\n'));
    // Create phase dir with 2 plans and 1 summary
    const phaseDir = path.join(planningDir, 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan 1\n');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary 1\n');
  });
  afterEach(() => cleanup(tmpDir));

  test('updates roadmap with plan progress', () => {
    const result = runPanTools(`roadmap update-plan-progress 1 --cwd "${tmpDir}"`);
    assert.ok(result.success, result.error);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.updated, true);
    assert.strictEqual(json.plan_count, 2);
    assert.strictEqual(json.summary_count, 1);
    assert.strictEqual(json.status, 'In Progress');
    assert.strictEqual(json.complete, false);
  });

  test('returns not-updated when no plans exist', () => {
    // Create phase dir with no plans
    const emptyPhase = path.join(tmpDir, '.planning', 'phases', '02-empty');
    fs.mkdirSync(emptyPhase, { recursive: true });
    const result = runPanTools(`roadmap update-plan-progress 2 --cwd "${tmpDir}"`);
    assert.ok(result.success, result.error);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.updated, false);
    assert.strictEqual(json.plan_count, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncRequirementCheckboxes
// ─────────────────────────────────────────────────────────────────────────────

describe('syncRequirementCheckboxes', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('checks matching requirement IDs in REQUIREMENTS.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [ ] **REQ-001** First requirement\n- [ ] **REQ-002** Second requirement\n- [ ] **REQ-003** Third requirement\n'
    );
    const result = syncRequirementCheckboxes(tmpDir, ['REQ-001', 'REQ-003']);
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.checked, 2);
    assert.strictEqual(result.total, 2);

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');
    assert.ok(content.includes('- [x] **REQ-001**'), 'REQ-001 should be checked');
    assert.ok(content.includes('- [ ] **REQ-002**'), 'REQ-002 should remain unchecked');
    assert.ok(content.includes('- [x] **REQ-003**'), 'REQ-003 should be checked');
  });

  test('is idempotent — already checked boxes stay checked', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [x] **REQ-001** Already done\n- [ ] **REQ-002** Not done\n'
    );
    const result = syncRequirementCheckboxes(tmpDir, ['REQ-001', 'REQ-002']);
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.checked, 1, 'only REQ-002 should be newly checked');

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');
    assert.ok(content.includes('- [x] **REQ-001**'), 'REQ-001 should still be checked');
    assert.ok(content.includes('- [x] **REQ-002**'), 'REQ-002 should now be checked');
  });

  test('returns not-updated when requirement IDs do not exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [ ] **REQ-001** Only requirement\n'
    );
    const result = syncRequirementCheckboxes(tmpDir, ['REQ-999']);
    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.checked, 0);
  });

  test('returns not-updated when no IDs provided', () => {
    const result = syncRequirementCheckboxes(tmpDir, []);
    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.checked, 0);
    assert.strictEqual(result.total, 0);
  });

  test('handles missing REQUIREMENTS.md gracefully', () => {
    const result = syncRequirementCheckboxes(tmpDir, ['REQ-001']);
    assert.strictEqual(result.updated, false);
    assert.ok(result.reason, 'should provide reason');
  });
});
