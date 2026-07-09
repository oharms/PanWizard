'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { assertSchema, assertErrorSchema } = require('../contracts/assert-schema.cjs');

describe('E2E Focus Command Contracts', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    // Set up a minimal project for focus commands
    const pd = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(pd, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'state.md'), '---\nStatus: In progress\nCurrent Phase: 01\n---\n');
    fs.writeFileSync(path.join(pd, 'roadmap.md'),
      '| Phase | Name | Status |\n|---|---|---|\n| 01 | setup | Not started |\n| 02 | api | Not started |\n');
    fs.writeFileSync(path.join(pd, 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: true }));
    fs.mkdirSync(path.join(pd, 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(pd, 'phases', '02-api'), { recursive: true });
  });

  after(() => { runner.cleanup(); });

  test('focus scan returns valid schema with items array and total', () => {
    const result = runner.run('focus scan');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['items', 'total'],
      types: { items: 'array', total: 'number' },
    });
    assert.ok('sources' in parsed, 'should have sources field');
  });

  test('focus sync returns valid schema with needs_sync boolean', () => {
    const result = runner.run('focus sync');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['needs_sync', 'stale_count', 'actuals'],
      types: { needs_sync: 'boolean', stale_count: 'number', actuals: 'object' },
    });
  });

  test('focus plan returns error JSON when no items available', () => {
    const result = runner.run('focus plan --mode balanced');
    // Returns success=true but with error field inside JSON
    const parsed = JSON.parse(result.output);
    assertErrorSchema(parsed);
  });

  test('focus scan with no items returns message field', () => {
    const result = runner.run('focus scan');
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    // When no items found, early return includes message but not source_todos
    assert.ok('message' in parsed, 'empty scan should have message field');
    assert.equal(typeof parsed.message, 'string');
  });

  test('focus auto --status returns error when no auto-run exists', () => {
    const result = runner.run('focus auto --status');
    // auto --status without init returns error via stderr
    assert.ok(!result.success || result.output.includes('error') || result.error.includes('No auto-run'),
      'should indicate no auto-run exists');
  });

  test('focus sync --tests flag passes through count', () => {
    const result = runner.run('focus sync --tests 1500');
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assertSchema(parsed, {
      success_fields: ['needs_sync', 'actuals'],
      types: { needs_sync: 'boolean' },
    });
  });

  test('focus scan on empty project returns zero total', () => {
    const result = runner.run('focus scan');
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.total, 0, 'empty project should have 0 items');
    assert.ok(Array.isArray(parsed.items), 'items should be array');
    assert.equal(parsed.items.length, 0, 'items should be empty');
  });
});
