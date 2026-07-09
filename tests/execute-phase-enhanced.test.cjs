/**
 * PAN Tools Tests - Enhanced Execute Phase Init (dry-run, budget, tiers)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// Helper: create a minimal phase with plans
function setupPhaseWithPlans(tmpDir, phaseDir, plans) {
  const phasePath = path.join(tmpDir, '.planning', 'phases', phaseDir);
  fs.mkdirSync(phasePath, { recursive: true });

  // Create roadmap.md and state.md (needed by init)
  fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), `# Roadmap\n\n## Phase 1: ${phaseDir}\n- [ ] Step 1`);
  fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\ncurrent_phase: 1\n---\n# State');
  runPanTools('config-ensure-section', tmpDir);

  for (const plan of plans) {
    const tierLine = plan.tier ? `\ntier: ${plan.tier}` : '';
    const content = `---\nphase: "${phaseDir}"\nplan: "${plan.id}"\ntype: execute\nwave: ${plan.wave || 1}\ndepends_on: []\nfiles_modified: [${(plan.files || []).map(f => `"${f}"`).join(', ')}]\nautonomous: ${plan.autonomous !== false}\ntask_count: ${plan.task_count || 1}\neffort: ${plan.effort || 'M'}${tierLine}\n---\n# Plan ${plan.id}`;
    fs.writeFileSync(path.join(phasePath, `${phaseDir.split('-')[0]}-${plan.id}-plan.md`), content);
  }
}

describe('execute-phase enhanced output', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('output includes plans_by_tier breakdown', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, files: ['a.cjs'], effort: 'XS' },
      { id: '02', task_count: 5, files: ['a','b','c'], effort: 'M' },
      { id: '03', task_count: 12, files: ['a','b','c','d','e','f'], effort: 'XL' },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.plans_by_tier, 'should have plans_by_tier');
    assert.strictEqual(typeof out.plans_by_tier.micro, 'number');
    assert.strictEqual(typeof out.plans_by_tier.standard, 'number');
    assert.strictEqual(typeof out.plans_by_tier.full, 'number');
  });

  test('output includes estimated_points total', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', effort: 'XS', task_count: 1, files: ['a'] },
      { id: '02', effort: 'S', task_count: 2, files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // XS=1 + S=2 = 3
    assert.strictEqual(out.estimated_points, 3, 'XS(1) + S(2) = 3');
  });

  test('output includes total_budget_points (default 50)', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.total_budget_points, 50, 'default budget should be 50');
  });

  test('--budget 30 overrides default budget', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1 --budget 30', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.total_budget_points, 30);
  });

  test('--budget 0 returns error', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1 --budget 0', tmpDir);
    assert.ok(!result.success, 'should fail with budget 0');
    assert.ok(result.error.includes('Budget must be >= 1'));
  });

  test('--budget abc returns error', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1 --budget abc', tmpDir);
    assert.ok(!result.success, 'should fail with non-numeric budget');
    assert.ok(result.error.includes('Budget must be a number'));
  });

  test('--budget 201 clamped to 200', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1 --budget 201', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.total_budget_points, 200);
  });

  test('budget_exceeded true when estimated > budget', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 5, effort: 'XL', files: ['a','b','c'] },
      { id: '02', task_count: 5, effort: 'XL', files: ['a','b','c'] },
    ]);
    const result = runPanTools('init execute-phase 1 --budget 5', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.budget_exceeded, true, 'should be exceeded (40 > 5)');
  });

  test('--dry-run sets dry_run true in output', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1 --dry-run', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.dry_run, true);
  });

  test('dry_run is false by default', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.dry_run, false);
  });

  test('output includes execution_mode', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.execution_mode, 'wave_order');
  });

  test('output includes rollback_tag (null)', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.rollback_tag, null);
  });

  test('all existing output fields still present', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, effort: 'S', files: ['a'] },
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // Existing fields
    assert.ok('executor_model' in out, 'should have executor_model');
    assert.ok('verifier_model' in out, 'should have verifier_model');
    assert.ok('commit_docs' in out, 'should have commit_docs');
    assert.ok('phase_found' in out, 'should have phase_found');
    assert.ok('plans' in out, 'should have plans');
    assert.ok('plan_count' in out, 'should have plan_count');
    // New fields
    assert.ok('plans_by_tier' in out, 'should have plans_by_tier');
    assert.ok('total_budget_points' in out, 'should have total_budget_points');
    assert.ok('estimated_points' in out, 'should have estimated_points');
    assert.ok('execution_mode' in out, 'should have execution_mode');
    assert.ok('dry_run' in out, 'should have dry_run');
  });

  test('empty phase with no plans → zeros', () => {
    const phasePath = path.join(tmpDir, '.planning', 'phases', '01-empty');
    fs.mkdirSync(phasePath, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n\n## Phase 1: empty\n- [ ] Step');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '---\ncurrent_phase: 1\n---\n# State');
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.deepStrictEqual(out.plans_by_tier, { micro: 0, standard: 0, full: 0 });
    assert.strictEqual(out.estimated_points, 0);
  });

  test('plan without effort field defaults to M (4 pts)', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, files: ['a'] }, // no effort field
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.estimated_points, 4, 'default effort M = 4 points');
  });

  test('tier counts match plan classifications', () => {
    setupPhaseWithPlans(tmpDir, '01-setup', [
      { id: '01', task_count: 1, files: ['a'], effort: 'XS' },      // MICRO
      { id: '02', task_count: 2, files: ['a'], effort: 'S' },       // MICRO
      { id: '03', task_count: 5, files: ['a','b','c'], effort: 'M' }, // STANDARD
      { id: '04', task_count: 12, files: Array(6).fill('x'), effort: 'L' }, // FULL
    ]);
    const result = runPanTools('init execute-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.plans_by_tier.micro, 2, '2 MICRO plans');
    assert.strictEqual(out.plans_by_tier.standard, 1, '1 STANDARD plan');
    assert.strictEqual(out.plans_by_tier.full, 1, '1 FULL plan');
    // Points: XS(1) + S(2) + M(4) + L(10) = 17
    assert.strictEqual(out.estimated_points, 17);
  });
});
