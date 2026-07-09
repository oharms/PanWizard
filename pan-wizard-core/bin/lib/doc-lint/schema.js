'use strict';
/**
 * schema.js — parse + validate schema definition files.
 *
 * Schema source format (also YAML-ish, parsed by frontmatter.js's parser
 * applied to a fenced wrapper):
 *
 *   fields:
 *     title:
 *       required: true
 *       type: string
 *       pattern: ^[A-Z]
 *
 * Returns: {schema, errors} where schema is the normalized form with regexes
 * compiled, types validated, etc.
 *
 * Note: we don't reuse the frontmatter parser's block style — schemas use a
 * deeper nested map shape than v0.1 frontmatter supports. We hand-roll a tiny
 * indentation-aware parser tuned for the schema shape only. This is a
 * scope-bounded compromise documented in DESIGN_SPEC §"YAML subset".
 */

const VALID_TYPES = ['string', 'number', 'boolean', 'enum', 'array'];
const FIELD_KEYS = ['required', 'type', 'pattern', 'values', 'default', 'items'];

/**
 * Parse a schema source string into a normalized schema or return errors.
 * @returns {{schema: object|null, errors: Array<{line:number, message:string}>}}
 */
function parseSchema(text) {
  const errors = [];
  if (text == null || text.trim() === '') {
    return { schema: null, errors: [{ line: 1, message: 'schema is empty' }] };
  }

  const lines = text.split(/\r?\n/);

  // Find `fields:` line
  let fieldsLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'fields:') {
      fieldsLine = i;
      break;
    }
  }

  if (fieldsLine === -1) {
    errors.push({ line: 1, message: 'schema must start with `fields:` block' });
    return { schema: null, errors };
  }

  // Parse fields block
  const fields = {};
  let currentField = null;
  let currentFieldLine = 0;

  for (let i = fieldsLine + 1; i < lines.length; i++) {
    const lineNum = i + 1; // 1-indexed
    const raw = lines[i];

    // Skip blank lines
    if (raw.trim() === '') continue;
    // Skip comment lines
    if (raw.trim().startsWith('#')) continue;

    // Field name: 2-space indent, ends with `:`
    const fieldMatch = raw.match(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (fieldMatch) {
      currentField = fieldMatch[1];
      currentFieldLine = lineNum;
      if (currentField in fields) {
        errors.push({ line: lineNum, message: `duplicate field "${currentField}"` });
      }
      fields[currentField] = { _line: lineNum };
      continue;
    }

    // Field property: 4-space indent
    const propMatch = raw.match(/^    ([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (propMatch && currentField) {
      const key = propMatch[1];
      const rawValue = propMatch[2].trim();

      if (!FIELD_KEYS.includes(key)) {
        errors.push({ line: lineNum, message: `unknown field property "${key}" (allowed: ${FIELD_KEYS.join(', ')})` });
        continue;
      }

      const parsed = parseSchemaValue(key, rawValue, lineNum);
      if (parsed.error) {
        errors.push({ line: lineNum, message: parsed.error });
        continue;
      }
      fields[currentField][key] = parsed.value;
      continue;
    }

    // Anything else (including incorrectly-indented lines)
    if (raw.length > 0 && !/^\s*$/.test(raw)) {
      errors.push({ line: lineNum, message: `unexpected line in fields block: ${JSON.stringify(raw)}` });
    }
  }

  // Validate each field
  const normalized = {};
  for (const [name, def] of Object.entries(fields)) {
    const fieldErrors = checkFieldDefinition(name, def);
    errors.push(...fieldErrors);
    if (fieldErrors.length === 0) {
      // Strip the _line marker from the public shape; keep all other props
      const { _line, ...publicDef } = def;
      normalized[name] = publicDef;
    }
  }

  return {
    schema: errors.length === 0 ? { fields: normalized } : null,
    errors,
  };
}

function parseSchemaValue(key, rawValue, lineNum) {
  if (key === 'required') {
    if (rawValue === 'true') return { value: true };
    if (rawValue === 'false') return { value: false };
    return { error: `required must be true|false, got ${JSON.stringify(rawValue)}` };
  }

  if (key === 'type') {
    if (!VALID_TYPES.includes(rawValue)) {
      return { error: `type must be one of ${VALID_TYPES.join(', ')}, got ${JSON.stringify(rawValue)}` };
    }
    return { value: rawValue };
  }

  if (key === 'pattern') {
    try {
      return { value: new RegExp(rawValue) };
    } catch (e) {
      return { error: `invalid regex pattern: ${e.message}` };
    }
  }

  if (key === 'values') {
    // Inline list shape: [a, b, c]
    if (!rawValue.startsWith('[') || !rawValue.endsWith(']')) {
      return { error: `values must be a flow list [a, b, c], got ${JSON.stringify(rawValue)}` };
    }
    const inner = rawValue.slice(1, -1).trim();
    if (inner === '') return { value: [] };
    return { value: inner.split(',').map(s => s.trim()).filter(Boolean) };
  }

  if (key === 'default') {
    return { value: rawValue }; // store raw
  }

  if (key === 'items') {
    if (!VALID_TYPES.includes(rawValue)) {
      return { error: `items must be one of ${VALID_TYPES.join(', ')}, got ${JSON.stringify(rawValue)}` };
    }
    return { value: rawValue };
  }

  return { error: `unknown property ${key}` };
}

function checkFieldDefinition(name, def) {
  const errors = [];
  const line = def._line || 1;

  if (!('type' in def)) {
    errors.push({ line, message: `field "${name}" missing required property "type"` });
    return errors;
  }

  if (def.type === 'enum' && !('values' in def)) {
    errors.push({ line, message: `field "${name}" type=enum requires "values:"` });
  }

  if (def.type === 'array' && !('items' in def)) {
    errors.push({ line, message: `field "${name}" type=array requires "items:"` });
  }

  if (def.required === true && 'default' in def) {
    errors.push({ line, message: `field "${name}" cannot have both required:true and default:` });
  }

  return errors;
}

/**
 * Public API: validate that a parsed schema is well-formed (no extra checks
 * beyond what parseSchema already does, but exposed for the CLI's
 * `whooo schema check` subcommand).
 */
function checkSchema(schemaText) {
  const result = parseSchema(schemaText);
  return { ok: result.errors.length === 0, errors: result.errors };
}

module.exports = { parseSchema, checkSchema, VALID_TYPES, FIELD_KEYS };
