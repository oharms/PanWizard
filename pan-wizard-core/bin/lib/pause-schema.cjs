/**
 * Pause schema — the small, zero-dependency language a typed pause uses to say
 * what answer it waits for, and the validator that checks one (durable
 * orchestration Stage D).
 *
 *   {type: 'enum', values: [...], noteFor?: [values that need a --note]}
 *   {type: 'string', pattern?: '<regex>', maxLength?: n}
 *   {type: 'boolean'}
 *   {type: 'object', required?: [...], properties?: {name: <scalar schema>}}
 *
 * An answer is {value, note?}: a string for enum and string, true/false for
 * boolean, an object for object. Deliberately not JSON Schema: short enough to
 * test every branch.
 */

'use strict';

const TYPES = ['enum', 'string', 'boolean', 'object'];
const MAX_TEXT = 2000;

/** Is this a schema the validator understands? @returns {null | string} the problem */
function schemaProblem(s, nested = false) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'expects must be an object';
  if (!TYPES.includes(s.type)) return `expects.type must be one of: ${TYPES.join(', ')}`;
  if (s.type === 'enum') {
    if (!Array.isArray(s.values) || s.values.length === 0 || !s.values.every((v) => typeof v === 'string' && v.trim())) return 'an enum needs values: a non-empty list of strings';
    if (s.noteFor !== undefined && !(Array.isArray(s.noteFor) && s.noteFor.every((v) => s.values.includes(v)))) return 'enum noteFor must list some of its values';
  }
  if (s.type === 'string') {
    if (s.pattern !== undefined) { try { new RegExp(s.pattern); } catch { return 'string pattern is not a valid regular expression'; } }
    if (s.maxLength !== undefined && !(Number.isInteger(s.maxLength) && s.maxLength > 0)) return 'string maxLength must be a positive integer';
  }
  if (s.type === 'object') {
    if (nested) return 'an object cannot nest another object';
    if (s.required !== undefined && !(Array.isArray(s.required) && s.required.every((k) => typeof k === 'string'))) return 'object required must be a list of names';
    for (const [k, sub] of Object.entries(s.properties || {})) {
      const p = schemaProblem(sub, true);
      if (p) return `property ${k}: ${p}`;
    }
  }
  return null;
}

/** Check one scalar value. @returns {null | string} */
function scalarProblem(s, value) {
  if (s.type === 'enum') return typeof value === 'string' && s.values.includes(value) ? null : `must be one of: ${s.values.join(', ')}`;
  if (s.type === 'boolean') return typeof value === 'boolean' ? null : 'must be true or false';
  if (s.type === 'string') {
    if (typeof value !== 'string' || !value.trim()) return 'must be a non-empty string';
    if (value.length > (s.maxLength || MAX_TEXT)) return `must be at most ${s.maxLength || MAX_TEXT} characters`;
    if (s.pattern && !new RegExp(s.pattern).test(value)) return `must match ${s.pattern}`;
    return null;
  }
  return 'unsupported type';
}

/**
 * Validate an answer against a schema.
 * @param {object} s - the pause's expects
 * @param {{value: any, note?: string}} answer
 * @returns {null | {problem: string, allowed?: string[]}}
 */
function validateAnswer(s, answer) {
  const value = answer ? answer.value : undefined;
  const note = answer ? answer.note : undefined;
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_TEXT)) return { problem: `note must be text of at most ${MAX_TEXT} characters` };
  if (s.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { problem: 'must be an object (--json)' };
    for (const k of s.required || []) if (value[k] === undefined || value[k] === null || value[k] === '') return { problem: `${k} is required` };
    for (const [k, v] of Object.entries(value)) {
      const sub = (s.properties || {})[k];
      if (!sub) {
        if (s.properties) return { problem: `${k} is not a field of this answer` };
        if (typeof v !== 'string' || v.length > MAX_TEXT) return { problem: `${k} must be text of at most ${MAX_TEXT} characters` };
        continue;
      }
      const p = scalarProblem(sub, v);
      if (p) return { problem: `${k} ${p}`, ...(sub.type === 'enum' ? { allowed: sub.values } : {}) };
    }
    return null;
  }
  const p = scalarProblem(s, value);
  if (p) return { problem: p, ...(s.type === 'enum' ? { allowed: s.values } : {}) };
  if (s.type === 'enum' && (s.noteFor || []).includes(value) && !(typeof note === 'string' && note.trim())) return { problem: `the answer ${value} needs a --note saying what` };
  return null;
}

module.exports = { TYPES, schemaProblem, validateAnswer };
