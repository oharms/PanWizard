'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSchema, assertErrorSchema } = require('./contracts/assert-schema.cjs');

describe('assertSchema', () => {
  test('passes for valid output matching schema', () => {
    const output = { status: 'healthy', errors: [], warnings: [], count: 5 };
    const schema = {
      success_fields: ['status', 'errors', 'warnings'],
      types: { status: 'string', errors: 'array', warnings: 'array', count: 'number' },
    };
    assertSchema(output, schema); // should not throw
  });

  test('fails when required field is missing', () => {
    const output = { status: 'healthy' };
    const schema = { success_fields: ['status', 'errors'] };
    assert.throws(() => assertSchema(output, schema), /missing required field: "errors"/);
  });

  test('fails when field has wrong type', () => {
    const output = { status: 42, errors: [] };
    const schema = {
      success_fields: ['status'],
      types: { status: 'string' },
    };
    assert.throws(() => assertSchema(output, schema), /field "status" should be string, got number/);
  });

  test('fails when enum value is invalid', () => {
    const output = { status: 'unknown' };
    const schema = {
      success_fields: ['status'],
      enum_values: { status: ['healthy', 'degraded', 'broken'] },
    };
    assert.throws(() => assertSchema(output, schema), /not in allowed/);
  });

  test('handles nested objects and arrays correctly', () => {
    const output = { items: [{ name: 'a' }], meta: { count: 1 } };
    const schema = {
      success_fields: ['items', 'meta'],
      types: { items: 'array', meta: 'object' },
    };
    assertSchema(output, schema); // should not throw
  });
});

describe('assertErrorSchema', () => {
  test('passes for valid error output', () => {
    const output = { error: 'state.md not found' };
    assertErrorSchema(output); // should not throw
  });

  test('passes with contains check', () => {
    const output = { error: 'STATE.md not found in project' };
    assertErrorSchema(output, 'not found'); // should not throw
  });

  test('fails when error field is missing', () => {
    const output = { status: 'ok' };
    assert.throws(() => assertErrorSchema(output), /must have "error" field/);
  });

  test('fails when contains substring not found', () => {
    const output = { error: 'something went wrong' };
    assert.throws(() => assertErrorSchema(output, 'not found'), /should contain/);
  });

  test('fails for null output', () => {
    assert.throws(() => assertErrorSchema(null), /must be an object/);
  });
});
