/**
 * PAN Tools Tests - Validate Health, Verify Phase-Completeness, Verify Plan-Structure
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a minimal healthy .planning/ project structure
// ─────────────────────────────────────────────────────────────────────────────

function createHealthyProject(tmpDir) {
  const planningDir = path.join(tmpDir, '.planning');
  fs.writeFileSync(
    path.join(planningDir, 'project.md'),
    '# Project\n**Name:** Test\n\n## What This Is\nA test project.\n\n## Core Value\nTesting.\n\n## Requirements\n- Req 1\n'
  );
  fs.writeFileSync(
    path.join(planningDir, 'roadmap.md'),
    '# Roadmap v1.0 MVP\n\n### Phase 1: Setup\n**Goal:** Test\n'
  );
  fs.writeFileSync(
    path.join(planningDir, 'state.md'),
    '# Project State\n\n**Current Phase:** 01\n**Status:** Planning\n**Total Phases:** 1\n'
  );
  fs.writeFileSync(
    path.join(planningDir, 'config.json'),
    JSON.stringify({ model_profile: 'balanced' })
  );
  // Create a matching phase directory on disk
  fs.mkdirSync(path.join(planningDir, 'phases', '01-setup'), { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// validate health command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('healthy project reports status healthy with no errors or warnings', () => {
    createHealthyProject(tmpDir);

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy', 'should report healthy');
    assert.strictEqual(output.errors.length, 0, 'should have zero errors');
    assert.strictEqual(output.warnings.length, 0, 'should have zero warnings');
    assert.strictEqual(output.repairable_count, 0, 'nothing to repair');
  });

  test('missing .planning directory reports status broken with E001', () => {
    // Remove the .planning directory entirely
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should report broken');
    assert.ok(output.errors.length >= 1, 'should have at least 1 error');
    assert.ok(
      output.errors.some(e => e.code === 'E001'),
      'should have E001 error for missing .planning/'
    );
  });

  test('missing roadmap.md reports status broken with E003', () => {
    createHealthyProject(tmpDir);
    fs.unlinkSync(path.join(tmpDir, '.planning', 'roadmap.md'));

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should report broken');
    assert.ok(
      output.errors.some(e => e.code === 'E003'),
      'should have E003 error for missing roadmap.md'
    );
  });

  test('missing state.md reports status broken with E004', () => {
    createHealthyProject(tmpDir);
    fs.unlinkSync(path.join(tmpDir, '.planning', 'state.md'));

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should report broken');
    assert.ok(
      output.errors.some(e => e.code === 'E004'),
      'should have E004 error for missing state.md'
    );
    assert.ok(
      output.errors.find(e => e.code === 'E004').repairable,
      'E004 should be flagged as repairable'
    );
  });

  test('missing config.json reports status degraded with W003 warning', () => {
    createHealthyProject(tmpDir);
    fs.unlinkSync(path.join(tmpDir, '.planning', 'config.json'));

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'degraded', 'should report degraded');
    assert.strictEqual(output.errors.length, 0, 'no errors, only warnings');
    assert.ok(
      output.warnings.some(w => w.code === 'W003'),
      'should have W003 warning for missing config.json'
    );
  });

  test('missing requirements.md (optional) does not affect healthy status', () => {
    createHealthyProject(tmpDir);
    // requirements.md is not checked by health — verify healthy stays healthy
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy', 'should remain healthy without requirements.md');
  });

  test('malformed config.json (invalid JSON) reports error E005', () => {
    createHealthyProject(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      '{ invalid json content !!!'
    );

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should report broken for invalid JSON');
    assert.ok(
      output.errors.some(e => e.code === 'E005'),
      'should have E005 error for invalid config.json'
    );
  });

  test('--repair creates missing config.json with defaults', () => {
    createHealthyProject(tmpDir);
    fs.unlinkSync(path.join(tmpDir, '.planning', 'config.json'));

    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.repairs_performed, 'should have repairs_performed array');
    assert.ok(
      output.repairs_performed.some(r => r.action === 'createConfig' && r.success),
      'should have successful createConfig repair'
    );

    // Verify the config file was actually created
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should exist after repair');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.model_profile, 'balanced', 'config should have balanced profile');
  });

  test('--repair regenerates missing state.md', () => {
    createHealthyProject(tmpDir);
    fs.unlinkSync(path.join(tmpDir, '.planning', 'state.md'));

    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.repairs_performed, 'should have repairs_performed array');
    assert.ok(
      output.repairs_performed.some(r => r.action === 'regenerateState' && r.success),
      'should have successful regenerateState repair'
    );

    // Verify state.md was regenerated
    const statePath = path.join(tmpDir, '.planning', 'state.md');
    assert.ok(fs.existsSync(statePath), 'state.md should exist after repair');

    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.ok(stateContent.includes('Session State'), 'regenerated state.md should have heading');
    assert.ok(stateContent.includes('regenerated by'), 'should note it was regenerated');
  });

  test('--repair resets corrupt config.json to defaults', () => {
    createHealthyProject(tmpDir);
    // Corrupt the config.json
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{invalid json!!!', 'utf-8');

    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.repairs_performed, 'should have repairs_performed array');
    assert.ok(
      output.repairs_performed.some(r => r.action === 'resetConfig' && r.success),
      'should have successful resetConfig repair'
    );

    // Verify config.json was reset to valid defaults
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.model_profile, 'balanced', 'reset config should have default model_profile');
    assert.strictEqual(config.commit_docs, true, 'reset config should have commit_docs default');
  });

  test('missing project.md sections reports degraded with W001 warnings', () => {
    createHealthyProject(tmpDir);
    // Overwrite project.md with minimal content missing required sections
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'project.md'),
      '# Project\n**Name:** Test\n'
    );

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'degraded', 'should report degraded');
    assert.ok(
      output.warnings.some(w => w.code === 'W001'),
      'should have W001 warning for missing project.md sections'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify phase-completeness command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify phase-completeness command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('all plans with matching summaries reports complete', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan 1\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary 1\n');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2\n');
    fs.writeFileSync(path.join(phaseDir, '01-02-summary.md'), '# Summary 2\n');

    const result = runPanTools('verify phase-completeness 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, true, 'should report complete');
    assert.strictEqual(output.plan_count, 2, 'should have 2 plans');
    assert.strictEqual(output.summary_count, 2, 'should have 2 summaries');
    assert.deepStrictEqual(output.incomplete_plans, [], 'no incomplete plans');
  });

  test('missing summary for a plan reports incomplete', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan 1\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary 1\n');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2\n');
    // No 01-02-summary.md

    const result = runPanTools('verify phase-completeness 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, false, 'should report incomplete');
    assert.strictEqual(output.plan_count, 2, 'should have 2 plans');
    assert.strictEqual(output.summary_count, 1, 'should have 1 summary');
    assert.ok(
      output.incomplete_plans.includes('01-02'),
      'should list 01-02 as incomplete'
    );
  });

  test('nonexistent phase returns error', () => {
    const result = runPanTools('verify phase-completeness 99', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Phase not found', 'should report phase not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify plan-structure command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify plan-structure command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('well-formed plan with all elements passes validation', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified: ["src/index.ts"]
autonomous: true
must_haves:
  artifacts: []
---

# Phase 01, Plan 01: Setup

<task type="auto">
  <name>Initialize project</name>
  <action>Set up the project structure</action>
  <verify>Check all files exist</verify>
  <done>Project structure is in place</done>
  <files>src/index.ts</files>
</task>
`;
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'should be valid');
    assert.strictEqual(output.errors.length, 0, 'no errors');
    assert.strictEqual(output.task_count, 1, 'should find 1 task');
    assert.strictEqual(output.tasks[0].name, 'Initialize project', 'task name extracted');
    assert.strictEqual(output.tasks[0].hasVerify, true, 'task has verify');
    assert.strictEqual(output.tasks[0].hasAction, true, 'task has action');
  });

  test('plan missing required verify element reports warning', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified: ["src/index.ts"]
autonomous: true
must_haves:
  artifacts: []
---

# Phase 01, Plan 01: Setup

<task type="auto">
  <name>Build feature</name>
  <action>Implement the feature</action>
  <done>Feature works</done>
</task>
`;
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'still valid (verify is recommended, not required)');
    assert.ok(
      output.warnings.some(w => w.includes("'Build feature' missing <verify>")),
      'should warn about missing verify element'
    );
    assert.ok(
      output.warnings.some(w => w.includes("'Build feature' missing <files>")),
      'should warn about missing files element'
    );
  });

  test('plan missing required action element reports error', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified: ["src/index.ts"]
autonomous: true
must_haves:
  artifacts: []
---

# Phase 01, Plan 01: Setup

<task type="auto">
  <name>Incomplete task</name>
  <verify>Check output</verify>
  <done>Task done</done>
  <files>src/main.ts</files>
</task>
`;
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid');
    assert.ok(
      output.errors.some(e => e.includes("'Incomplete task' missing <action>")),
      'should report missing action element'
    );
  });

  test('plan file not found returns error JSON', () => {
    const result = runPanTools('verify plan-structure .planning/phases/99-missing/99-01-plan.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report file not found');
  });

  test('plan missing required frontmatter fields reports errors', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Plan with no frontmatter at all
    const planContent = `# Phase 01, Plan 01: Setup

<task type="auto">
  <name>Do something</name>
  <action>Execute the task</action>
  <verify>Verify output</verify>
  <done>Task complete</done>
  <files>src/app.ts</files>
</task>
`;
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid without frontmatter');
    assert.ok(
      output.errors.some(e => e.includes('Missing required frontmatter field: phase')),
      'should report missing phase field'
    );
    assert.ok(
      output.errors.some(e => e.includes('Missing required frontmatter field: wave')),
      'should report missing wave field'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkStateConsistency — cross-document drift detection (B.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('checkStateConsistency via validate health', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('no drift warning when STATE and REQUIREMENTS are in sync', () => {
    createHealthyProject(tmpDir);
    // No requirements or state progress mismatch — should stay healthy
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy');
    assert.ok(
      !output.warnings.some(w => w.code === 'STATE_REQ_DRIFT'),
      'should not have STATE_REQ_DRIFT warning'
    );
  });

  test('warns when STATE shows all complete but REQUIREMENTS has unchecked boxes', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    // STATE with frontmatter showing all plans complete
    fs.writeFileSync(path.join(planningDir, 'state.md'), [
      '---',
      'progress:',
      '  completed_plans: 3',
      '  total_plans: 3',
      '  completed_phases: 1',
      '  total_phases: 1',
      '---',
      '# Project State',
      '',
      '**Current Phase:** 01',
      '**Status:** Complete',
      '**Total Phases:** 1',
    ].join('\n'));
    // REQUIREMENTS with unchecked boxes
    fs.writeFileSync(path.join(planningDir, 'requirements.md'), [
      '# Requirements',
      '',
      '- [x] **REQ-001** Done requirement',
      '- [ ] **REQ-002** Undone requirement',
      '- [ ] **REQ-003** Another undone',
    ].join('\n'));
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'STATE_REQ_DRIFT'),
      'should report STATE_REQ_DRIFT when STATE is complete but REQUIREMENTS has unchecked items'
    );
  });

  test('warns when STATE shows all complete but ROADMAP has unchecked plan checkboxes', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    // STATE with all plans complete
    fs.writeFileSync(path.join(planningDir, 'state.md'), [
      '---',
      'progress:',
      '  completed_plans: 3',
      '  total_plans: 3',
      '  completed_phases: 1',
      '  total_phases: 1',
      '---',
      '# Project State',
      '',
      '**Current Phase:** 01',
      '**Status:** Complete',
      '**Total Phases:** 1',
    ].join('\n'));
    // ROADMAP with unchecked plan lines
    fs.writeFileSync(path.join(planningDir, 'roadmap.md'), [
      '# Roadmap v1.0 MVP',
      '',
      '### Phase 1: Setup',
      '**Goal:** Test',
      '',
      '- [x] 01-01-plan.md',
      '- [ ] 01-02-plan.md',
      '- [ ] 01-03-plan.md',
    ].join('\n'));
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'STATE_ROADMAP_DRIFT'),
      'should report STATE_ROADMAP_DRIFT when STATE is complete but ROADMAP has unchecked plan boxes'
    );
  });

  test('no drift warning when STATE shows incomplete (plans still in progress)', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    // STATE with plans still in progress
    fs.writeFileSync(path.join(planningDir, 'state.md'), [
      '---',
      'progress:',
      '  completed_plans: 1',
      '  total_plans: 3',
      '  completed_phases: 0',
      '  total_phases: 1',
      '---',
      '# Project State',
      '',
      '**Current Phase:** 01',
      '**Status:** In Progress',
      '**Total Phases:** 1',
    ].join('\n'));
    // REQUIREMENTS with unchecked boxes — but that's expected since plans aren't complete
    fs.writeFileSync(path.join(planningDir, 'requirements.md'), [
      '# Requirements',
      '',
      '- [ ] **REQ-001** To do',
      '- [ ] **REQ-002** To do',
    ].join('\n'));
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'STATE_REQ_DRIFT'),
      'should not warn when STATE shows incomplete progress'
    );
  });
});

describe('checkVerificationGate in validate health', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('no warning when verifier is not enabled', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    // config has no workflow.verifier
    fs.writeFileSync(path.join(planningDir, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
    // Phase with summary but no verification
    const phaseDir = path.join(planningDir, 'phases', '01-setup');
    fs.writeFileSync(path.join(phaseDir, '01-summary.md'), '# Summary\nDone.');
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'VERIFICATION_GATE_MISSING'),
      'should not warn about verification when verifier is disabled'
    );
  });

  test('warns when verifier enabled and completed phase has no verification', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planningDir, 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { verifier: true } }));
    const phaseDir = path.join(planningDir, 'phases', '01-setup');
    fs.writeFileSync(path.join(phaseDir, '01-summary.md'), '# Summary\nDone.');
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'VERIFICATION_GATE_MISSING'),
      'should warn about missing verification for completed phase'
    );
  });

  test('no warning when completed phase has verification file', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planningDir, 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { verifier: true } }));
    const phaseDir = path.join(planningDir, 'phases', '01-setup');
    fs.writeFileSync(path.join(phaseDir, '01-summary.md'), '# Summary\nDone.');
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'), '---\nstatus: passed\n---\n# Verification');
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'VERIFICATION_GATE_MISSING'),
      'should not warn when verification exists'
    );
  });

  test('no warning for phase without summary (not yet executed)', () => {
    createHealthyProject(tmpDir);
    const planningDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planningDir, 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { verifier: true } }));
    // Phase exists but has no summary → not executed yet
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'VERIFICATION_GATE_MISSING'),
      'should not warn for unexecuted phases'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncRequirementCheckboxes / syncRoadmapPlanCheckboxes
// ─────────────────────────────────────────────────────────────────────────────

const { syncRequirementCheckboxes, syncRoadmapPlanCheckboxes, validateRuntimeInstall, detectInstalledRuntimes } = require('../pan-wizard-core/bin/lib/verify.cjs');

describe('syncRequirementCheckboxes', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('checks requirement boxes for completed phases', () => {
    const planDir = path.join(tmpDir, '.planning');
    // Roadmap has phase 1 completed with linked requirements
    fs.writeFileSync(path.join(planDir, 'roadmap.md'),
      '# Roadmap\n- [x] Phase 1: Setup (completed 2026-03-01)\n  **Requirements:** REQ-001, REQ-002\n- [ ] Phase 2: Build\n  **Requirements:** REQ-003\n');
    // Requirements has unchecked boxes
    fs.writeFileSync(path.join(planDir, 'requirements.md'),
      '# Requirements\n- [ ] **REQ-001** User login\n- [ ] **REQ-002** User logout\n- [ ] **REQ-003** Dashboard\n');

    const result = syncRequirementCheckboxes(tmpDir);
    assert.strictEqual(result.fixed, 2);

    const content = fs.readFileSync(path.join(planDir, 'requirements.md'), 'utf8');
    assert.ok(content.includes('- [x] **REQ-001**'));
    assert.ok(content.includes('- [x] **REQ-002**'));
    assert.ok(content.includes('- [ ] **REQ-003**')); // Phase 2 not complete
  });

  test('returns 0 when no completed phases', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'), '# Roadmap\n- [ ] Phase 1: Setup\n');
    fs.writeFileSync(path.join(planDir, 'requirements.md'), '# Requirements\n- [ ] **REQ-001** Something\n');
    const result = syncRequirementCheckboxes(tmpDir);
    assert.strictEqual(result.fixed, 0);
  });

  test('returns error when requirements.md missing', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'), '# Roadmap\n');
    const result = syncRequirementCheckboxes(tmpDir);
    assert.ok(result.error);
  });

  test('does not double-check already checked boxes', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'),
      '# Roadmap\n- [x] Phase 1: Setup\n  **Requirements:** REQ-001\n');
    fs.writeFileSync(path.join(planDir, 'requirements.md'),
      '# Requirements\n- [x] **REQ-001** Already done\n');
    const result = syncRequirementCheckboxes(tmpDir);
    assert.strictEqual(result.fixed, 0);
  });
});

describe('syncRoadmapPlanCheckboxes', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('checks plan boxes when summary files exist', () => {
    const planDir = path.join(tmpDir, '.planning');
    // Roadmap has unchecked plan checkboxes
    fs.writeFileSync(path.join(planDir, 'roadmap.md'),
      '# Roadmap\n## Phase 1\n- [ ] 01-01-plan.md\n- [ ] 01-02-plan.md\n');
    // Phase dir has summary for plan 01-01 only
    const phaseDir = path.join(planDir, 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary');

    const result = syncRoadmapPlanCheckboxes(tmpDir);
    assert.strictEqual(result.fixed, 1);

    const content = fs.readFileSync(path.join(planDir, 'roadmap.md'), 'utf8');
    assert.ok(content.includes('- [x] 01-01-plan.md'));
    assert.ok(content.includes('- [ ] 01-02-plan.md')); // No summary → stays unchecked
  });

  test('returns 0 when no summary files exist', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'), '# Roadmap\n- [ ] 01-01-plan.md\n');
    fs.mkdirSync(path.join(planDir, 'phases', '01-setup'), { recursive: true });
    const result = syncRoadmapPlanCheckboxes(tmpDir);
    assert.strictEqual(result.fixed, 0);
  });

  test('returns error when roadmap.md missing', () => {
    const result = syncRoadmapPlanCheckboxes(tmpDir);
    assert.ok(result.error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// repair path tests — validate health --repair
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --repair', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('repair creates config.json when missing', () => {
    createHealthyProject(tmpDir);
    const planDir = path.join(tmpDir, '.planning');
    // Remove config to trigger repair
    try { fs.unlinkSync(path.join(planDir, 'config.json')); } catch {}

    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok((data.repairs_performed || []).length > 0, 'should have repair actions');
    assert.ok((data.repairs_performed || []).some(a => a.action === 'createConfig' && a.success));
    // Config file should now exist
    assert.ok(fs.existsSync(path.join(planDir, 'config.json')));
  });

  test('repair regenerates state.md when corrupted', () => {
    createHealthyProject(tmpDir);
    const planDir = path.join(tmpDir, '.planning');
    // Corrupt state.md by removing it
    try { fs.unlinkSync(path.join(planDir, 'state.md')); } catch {}

    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok((data.repairs_performed || []).some(a => a.action === 'regenerateState'));
    assert.ok(fs.existsSync(path.join(planDir, 'state.md')));
  });

  test('repair syncs requirement checkboxes for STATE_REQ_DRIFT', () => {
    createHealthyProject(tmpDir);
    const planDir = path.join(tmpDir, '.planning');
    // State says all complete
    fs.writeFileSync(path.join(planDir, 'state.md'),
      '---\nprogress:\n  completed_plans: 2\n  total_plans: 2\n---\n# State\n');
    // Roadmap has completed phase with requirement links
    fs.writeFileSync(path.join(planDir, 'roadmap.md'),
      '# Roadmap\n- [x] Phase 1: Setup\n  **Requirements:** REQ-001\n');
    // Requirements has unchecked box
    fs.writeFileSync(path.join(planDir, 'requirements.md'),
      '# Requirements\n- [ ] **REQ-001** User login\n');

    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    // Should have synced requirements
    const syncAction = (data.repairs_performed || []).find(a => a.action === 'syncRequirements');
    assert.ok(syncAction, 'should have syncRequirements repair action');
    assert.ok(syncAction.success);
    // Requirement should now be checked
    const content = fs.readFileSync(path.join(planDir, 'requirements.md'), 'utf8');
    assert.ok(content.includes('- [x] **REQ-001**'));
  });

  test('no repair actions when healthy', () => {
    createHealthyProject(tmpDir);
    const result = runPanTools('validate health --repair', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.strictEqual((data.repairs_performed || []).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// health edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health edge cases', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('health with no .planning/ returns broken', () => {
    // tmpDir has .planning from createTempProject — remove it
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.status, 'broken');
  });

  test('health with empty .planning/ returns degraded or broken', () => {
    const planDir = path.join(tmpDir, '.planning');
    // Remove all files but keep directory
    for (const f of fs.readdirSync(planDir)) {
      const p = path.join(planDir, f);
      fs.rmSync(p, { recursive: true, force: true });
    }
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.ok(['degraded', 'broken'].includes(data.status));
  });

  test('health with malformed config.json reports error', () => {
    createHealthyProject(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), 'NOT JSON{{{');
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.ok(data.errors.some(e => e.code === 'E005'));
  });

  test('health reports degraded for missing project.md', () => {
    createHealthyProject(tmpDir);
    fs.unlinkSync(path.join(tmpDir, '.planning', 'project.md'));
    const result = runPanTools('validate health', tmpDir);
    const data = JSON.parse(result.output);
    assert.ok(data.errors.some(e => e.message.includes('project.md')));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deployment validation helpers (unit tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('detectInstalledRuntimes', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns empty when no runtimes installed', () => {
    const result = detectInstalledRuntimes(tmpDir);
    assert.strictEqual(result.length, 0);
  });

  test('detects claude and codex runtimes', () => {
    for (const dir of ['.claude', '.codex']) {
      const d = path.join(tmpDir, dir);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'pan-file-manifest.json'), '{}');
    }
    const result = detectInstalledRuntimes(tmpDir);
    assert.strictEqual(result.length, 2);
    assert.ok(result.some(r => r.runtime === 'claude'));
    assert.ok(result.some(r => r.runtime === 'codex'));
  });
});

describe('validateRuntimeInstall', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns broken for unreadable manifest', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.claude', 'pan-file-manifest.json'), 'NOT JSON');
    const result = validateRuntimeInstall(tmpDir, '.claude', 'claude');
    assert.strictEqual(result.status, 'broken');
    assert.ok(result.error);
  });

  test('returns clean for empty manifest', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.claude', 'pan-file-manifest.json'),
      JSON.stringify({ version: '2.8.1', files: {} }));
    const result = validateRuntimeInstall(tmpDir, '.claude', 'claude');
    assert.strictEqual(result.status, 'clean');
    assert.strictEqual(result.version, '2.8.1');
  });

  // Copilot settings moved to .github/copilot/settings.json (2026-06) and the
  // file is optional — hooks live in .github/hooks/pan.json.
  test('copilot: settings_ok without any settings file (optional)', () => {
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'pan-file-manifest.json'),
      JSON.stringify({ version: '3.9.0', files: {} }));
    const result = validateRuntimeInstall(tmpDir, '.github', 'copilot');
    assert.strictEqual(result.status, 'clean');
    assert.strictEqual(result.settings_ok, true, 'absent settings must not be flagged for copilot');
  });

  test('copilot: validates statusline hook path from copilot/settings.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.github', 'copilot'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'pan-file-manifest.json'),
      JSON.stringify({ version: '3.9.0', files: {} }));
    fs.writeFileSync(path.join(tmpDir, '.github', 'copilot', 'settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'node .github/hooks/pan-statusline.js' } }));
    const broken = validateRuntimeInstall(tmpDir, '.github', 'copilot');
    assert.strictEqual(broken.settings_ok, false, 'dangling hook path should be flagged');

    fs.mkdirSync(path.join(tmpDir, '.github', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'hooks', 'pan-statusline.js'), '// hook');
    const ok = validateRuntimeInstall(tmpDir, '.github', 'copilot');
    assert.strictEqual(ok.settings_ok, true, 'resolvable hook path should pass');
  });
});
