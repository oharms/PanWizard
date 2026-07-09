/**
 * PAN Tools Tests - Tier Classification (classifyPlanTier)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { classifyPlanTier } = require('../pan-wizard-core/bin/lib/phase.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// classifyPlanTier — unit tests (no filesystem needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyPlanTier', () => {

  test('1 task, 1 file → MICRO', () => {
    const fm = { task_count: 1, files_modified: ['src/a.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });

  test('3 tasks, 2 files → MICRO (boundary)', () => {
    const fm = { task_count: 3, files_modified: ['a.cjs', 'b.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });

  test('4 tasks, 2 files → STANDARD (task boundary exceeded)', () => {
    const fm = { task_count: 4, files_modified: ['a.cjs', 'b.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'standard');
  });

  test('3 tasks, 3 files → STANDARD (file boundary exceeded)', () => {
    const fm = { task_count: 3, files_modified: ['a.cjs', 'b.cjs', 'c.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'standard');
  });

  test('5 tasks, 3 files → STANDARD', () => {
    const fm = { task_count: 5, files_modified: ['a.cjs', 'b.cjs', 'c.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'standard');
  });

  test('8 tasks, 5 files → STANDARD (boundary)', () => {
    const fm = { task_count: 8, files_modified: ['a','b','c','d','e'] };
    assert.strictEqual(classifyPlanTier(fm), 'standard');
  });

  test('9 tasks, 5 files → FULL (task boundary exceeded)', () => {
    const fm = { task_count: 9, files_modified: ['a','b','c','d','e'] };
    assert.strictEqual(classifyPlanTier(fm), 'full');
  });

  test('autonomous=false with 1 task → FULL (override)', () => {
    const fm = { task_count: 1, files_modified: ['a.cjs'], autonomous: false };
    assert.strictEqual(classifyPlanTier(fm), 'full');
  });

  test('explicit tier: micro with 20 tasks → MICRO (frontmatter override)', () => {
    const fm = { task_count: 20, files_modified: Array(10).fill('x'), tier: 'micro' };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });

  test('explicit tier: full with 1 task → FULL (frontmatter override)', () => {
    const fm = { task_count: 1, files_modified: ['a.cjs'], tier: 'full' };
    assert.strictEqual(classifyPlanTier(fm), 'full');
  });

  test('explicit tier: standard with 1 task → STANDARD (frontmatter override)', () => {
    const fm = { task_count: 1, files_modified: ['a.cjs'], tier: 'standard' };
    assert.strictEqual(classifyPlanTier(fm), 'standard');
  });

  test('invalid tier value is ignored, uses algorithm', () => {
    const fm = { task_count: 1, files_modified: ['a.cjs'], tier: 'banana' };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });

  test('missing files_modified (undefined) → treated as 0 files', () => {
    const fm = { task_count: 2 };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });

  test('missing task_count with no tasks array → defaults to standard', () => {
    const fm = { files_modified: ['a.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'standard');
  });

  test('tasks array used when task_count not present', () => {
    const fm = { tasks: ['do a', 'do b'], files_modified: ['a.cjs'] };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });

  test('tasks array with 9 items → FULL', () => {
    const fm = { tasks: Array(9).fill('t'), files_modified: ['a','b','c','d','e'] };
    assert.strictEqual(classifyPlanTier(fm), 'full');
  });

  test('empty plan (no frontmatter) → standard', () => {
    assert.strictEqual(classifyPlanTier({}), 'standard');
  });

  test('null frontmatter → standard', () => {
    assert.strictEqual(classifyPlanTier(null), 'standard');
  });

  test('undefined frontmatter → standard', () => {
    assert.strictEqual(classifyPlanTier(undefined), 'standard');
  });

  test('custom config thresholds respected', () => {
    const fm = { task_count: 5, files_modified: ['a','b','c','d'] };
    const config = { budget: { micro_threshold_tasks: 5, micro_threshold_files: 4 } };
    assert.strictEqual(classifyPlanTier(fm, config), 'micro');
  });

  test('default thresholds used when config missing budget', () => {
    const fm = { task_count: 3, files_modified: ['a.cjs', 'b.cjs'] };
    assert.strictEqual(classifyPlanTier(fm, {}), 'micro');
  });

  test('autonomous=true does not force FULL', () => {
    const fm = { task_count: 2, files_modified: ['a.cjs'], autonomous: true };
    assert.strictEqual(classifyPlanTier(fm), 'micro');
  });
});
