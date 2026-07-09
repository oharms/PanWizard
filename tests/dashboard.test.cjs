/**
 * PAN Tools Tests - Dashboard
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('dashboard command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns project info from package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.2.3' })
    );

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.project, 'test-project');
    assert.strictEqual(output.version, '1.2.3');
  });

  test('returns current phase and status from state.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 03\n**Current Phase Name:** API Layer\n**Status:** Executing\n**Last Activity:** 2026-03-01\n**Last Activity Description:** Completed task 2\n\n## Blockers\n- None\n'
    );

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.current_phase.number, '03');
    assert.strictEqual(output.current_phase.name, 'API Layer');
    assert.strictEqual(output.current_phase.status, 'Executing');
    assert.strictEqual(output.last_activity, '2026-03-01');
    assert.strictEqual(output.last_activity_description, 'Completed task 2');
  });

  test('counts blockers correctly', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Blocked\n\n## Blockers\n- API key expired\n- Waiting on review\n- Server down\n'
    );

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.blockers, 3);
    assert.ok(Array.isArray(output.blocker_list), 'should have blocker_list');
    assert.strictEqual(output.blocker_list.length, 3);
    assert.ok(output.blocker_list.includes('API key expired'));
  });

  test('ignores None placeholder in blockers', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Executing\n\n## Blockers\n- None\n'
    );

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.blockers, 0);
    assert.strictEqual(output.blocker_list, undefined, 'should not include blocker_list when empty');
  });

  test('shows phase progress from disk', () => {
    // Create phase directories with plan and summary files
    const phase1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    const phase2 = path.join(tmpDir, '.planning', 'phases', '02-core');
    fs.mkdirSync(phase1, { recursive: true });
    fs.mkdirSync(phase2, { recursive: true });
    fs.writeFileSync(path.join(phase1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phase1, '01-01-summary.md'), '# Summary');
    fs.writeFileSync(path.join(phase2, '02-01-plan.md'), '# Plan');

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.progress.phases_total, 2);
    assert.strictEqual(output.progress.phases_completed, 1);
    assert.strictEqual(output.progress.plans_total, 2);
    assert.strictEqual(output.progress.plans_completed, 1);
  });

  test('detects next phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Executing\n\n## Blockers\n- None\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-core'), { recursive: true });

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.next_phase, 'should detect next phase');
    assert.strictEqual(output.next_phase.number, '02');
    assert.strictEqual(output.next_phase.name, 'core');
  });

  test('handles missing state.md gracefully', () => {
    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.current_phase, null);
    assert.strictEqual(output.blockers, 0);
    assert.strictEqual(output.last_activity, null);
  });

  test('handles empty project gracefully', () => {
    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.blockers, 'number');
    assert.ok(output.progress !== undefined, 'should have progress object');
  });

  test('output has all expected fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Executing\n\n## Blockers\n- None\n'
    );

    const result = runPanTools('dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok('project' in output, 'should have project field');
    assert.ok('version' in output, 'should have version field');
    assert.ok('milestone' in output, 'should have milestone field');
    assert.ok('current_phase' in output, 'should have current_phase field');
    assert.ok('progress' in output, 'should have progress field');
    assert.ok('blockers' in output, 'should have blockers field');
    assert.ok('last_activity' in output, 'should have last_activity field');
    assert.ok('next_phase' in output, 'should have next_phase field');
  });
});
