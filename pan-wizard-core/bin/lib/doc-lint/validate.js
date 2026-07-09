'use strict';
/**
 * validate.js — validate parsed frontmatter data against a parsed schema.
 *
 * Returns an array of violations matching the shape documented in
 * DESIGN_SPEC.md §"Key data shapes":
 *
 *   { file, line, field, code, message, severity }
 *
 * Implements the 8 error codes in DESIGN_SPEC.md §"Error codes":
 *   frontmatter-missing, frontmatter-malformed, required-missing,
 *   type-mismatch, enum-violation, pattern-mismatch, array-item-type,
 *   unknown-field
 *
 * The {data, errors, hasFrontmatter} input is whatever frontmatter.js
 * returned for a given file. line numbers are absolute in the source file.
 */

/**
 * @param {object} fmResult - {data, bodyStart, errors, hasFrontmatter} from parseFrontmatter
 * @param {object} schema   - parsed schema from parseSchema (i.e., {fields: {...}})
 * @param {string} sourceFile - POSIX-style relative path for the violation report
 * @param {object} [opts]   - {strict: bool} — if true, frontmatter-missing is error severity
 * @returns {Array<Violation>}
 */
function validateAgainstSchema(fmResult, schema, sourceFile, opts = {}) {
  const violations = [];
  const strict = !!opts.strict;

  // 1. Frontmatter parse errors → frontmatter-malformed
  if (fmResult.errors && fmResult.errors.length > 0) {
    for (const err of fmResult.errors) {
      violations.push(violation({
        file: sourceFile, line: err.line, field: null,
        code: 'frontmatter-malformed',
        message: err.message,
        severity: 'error',
      }));
    }
    return violations; // can't validate fields if parse failed
  }

  // 2. No frontmatter at all
  if (fmResult.hasFrontmatter === false) {
    violations.push(violation({
      file: sourceFile, line: 1, field: null,
      code: 'frontmatter-missing',
      message: 'file has no frontmatter',
      severity: strict ? 'error' : 'warning',
    }));
    return violations;
  }

  const data = fmResult.data || {};
  const fields = schema.fields || {};

  // 3. Per-field checks
  for (const [name, def] of Object.entries(fields)) {
    const present = name in data;
    const value = data[name];

    if (!present) {
      if (def.required) {
        violations.push(violation({
          file: sourceFile, line: 1, field: name,
          code: 'required-missing',
          message: `field "${name}" is required`,
          severity: 'error',
        }));
      }
      continue;
    }

    // Type check
    const typeError = checkType(value, def);
    if (typeError) {
      violations.push(violation({
        file: sourceFile, line: 1, field: name,
        code: typeError.code,
        message: typeError.message,
        severity: 'error',
      }));
      continue;
    }

    // Enum check
    if (def.type === 'enum' && Array.isArray(def.values) && !def.values.includes(String(value))) {
      violations.push(violation({
        file: sourceFile, line: 1, field: name,
        code: 'enum-violation',
        message: `field "${name}" value ${JSON.stringify(value)} not in [${def.values.join(', ')}]`,
        severity: 'error',
      }));
      continue;
    }

    // Pattern check
    if (def.pattern instanceof RegExp && typeof value === 'string' && !def.pattern.test(value)) {
      violations.push(violation({
        file: sourceFile, line: 1, field: name,
        code: 'pattern-mismatch',
        message: `field "${name}" value ${JSON.stringify(value)} does not match pattern ${def.pattern}`,
        severity: 'error',
      }));
      continue;
    }
  }

  // 4. Unknown fields (warning only — info-level)
  for (const key of Object.keys(data)) {
    if (!(key in fields)) {
      violations.push(violation({
        file: sourceFile, line: 1, field: key,
        code: 'unknown-field',
        message: `field "${key}" is not in schema (consider adding it or removing from file)`,
        severity: 'warning',
      }));
    }
  }

  return violations;
}

function checkType(value, def) {
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') {
        return { code: 'type-mismatch', message: `expected string, got ${typeOf(value)}` };
      }
      return null;
    case 'number':
      if (typeof value !== 'number') {
        return { code: 'type-mismatch', message: `expected number, got ${typeOf(value)}` };
      }
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { code: 'type-mismatch', message: `expected boolean, got ${typeOf(value)}` };
      }
      return null;
    case 'enum':
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { code: 'type-mismatch', message: `expected scalar (for enum), got ${typeOf(value)}` };
      }
      return null;
    case 'array':
      if (!Array.isArray(value)) {
        return { code: 'type-mismatch', message: `expected array, got ${typeOf(value)}` };
      }
      // Item type check
      if (def.items) {
        for (let i = 0; i < value.length; i++) {
          const itemType = typeOf(value[i]);
          const expected = def.items;
          // Note: the item-type contract treats string/number/boolean only;
          // enum/array items are out of scope for v0.1.
          const matches = (
            (expected === 'string' && itemType === 'string') ||
            (expected === 'number' && itemType === 'number') ||
            (expected === 'boolean' && itemType === 'boolean')
          );
          if (!matches) {
            return { code: 'array-item-type', message: `array item [${i}] expected ${expected}, got ${itemType}` };
          }
        }
      }
      return null;
    default:
      return null;
  }
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function violation(v) {
  return {
    file: v.file,
    line: v.line || 1,
    field: v.field || null,
    code: v.code,
    message: v.message,
    severity: v.severity || 'error',
  };
}

module.exports = { validateAgainstSchema };
