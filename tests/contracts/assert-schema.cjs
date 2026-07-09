'use strict';

const assert = require('node:assert/strict');

/**
 * Assert that a parsed JSON output matches an expected schema contract.
 *
 * @param {object} output - Parsed JSON output from a pan-tools command
 * @param {object} schema - Schema definition with fields, types, and optional enums
 * @param {string[]} [schema.success_fields] - Required field names
 * @param {object} [schema.types] - Field name → expected typeof value
 * @param {object} [schema.enum_values] - Field name → array of allowed values
 * @param {string[]} [schema.error_fields] - Required fields on error output
 */
function assertSchema(output, schema) {
  assert.ok(output !== null && output !== undefined, 'output must not be null/undefined');
  assert.equal(typeof output, 'object', 'output must be an object');

  // Check required success fields
  if (schema.success_fields) {
    for (const field of schema.success_fields) {
      assert.ok(field in output, `missing required field: "${field}"`);
    }
  }

  // Check field types
  if (schema.types) {
    for (const [field, expectedType] of Object.entries(schema.types)) {
      if (!(field in output)) continue; // only check type if field present
      const actualType = Array.isArray(output[field]) ? 'array' : typeof output[field];
      assert.equal(actualType, expectedType, `field "${field}" should be ${expectedType}, got ${actualType}`);
    }
  }

  // Check enum constraints
  if (schema.enum_values) {
    for (const [field, allowed] of Object.entries(schema.enum_values)) {
      if (!(field in output)) continue;
      assert.ok(
        allowed.includes(output[field]),
        `field "${field}" value "${output[field]}" not in allowed: [${allowed.join(', ')}]`
      );
    }
  }

  // Check error fields if present
  if (schema.error_fields && output.error) {
    for (const field of schema.error_fields) {
      assert.ok(field in output, `missing error field: "${field}"`);
    }
  }
}

/**
 * Assert that output is a valid error response.
 * @param {object} output - Parsed JSON output
 * @param {string} [contains] - Optional substring the error message should contain
 */
function assertErrorSchema(output, contains) {
  assert.ok(output !== null && typeof output === 'object', 'error output must be an object');
  assert.ok('error' in output, 'error output must have "error" field');
  assert.equal(typeof output.error, 'string', 'error field must be a string');
  if (contains) {
    assert.ok(
      output.error.toLowerCase().includes(contains.toLowerCase()),
      `error "${output.error}" should contain "${contains}"`
    );
  }
}

module.exports = { assertSchema, assertErrorSchema };
