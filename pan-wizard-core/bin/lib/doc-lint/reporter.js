'use strict';
/**
 * reporter.js — format violations for output.
 *
 * Two formats per DESIGN_SPEC.md §"CLI surface":
 *   - human: <file>:<line> — <code> — <message>   (multi-line, colorless for v0.1)
 *   - json:  NDJSON, one violation per line
 */

/**
 * @param {Array<Violation>} violations
 * @returns {string}
 */
function formatHuman(violations) {
  if (!violations || violations.length === 0) return '';
  const lines = [];
  for (const v of violations) {
    const sev = v.severity === 'warning' ? '[warn]' : '[err] ';
    lines.push(`${sev} ${v.file}:${v.line} — ${v.code} — ${v.message}`);
  }
  return lines.join('\n');
}

/**
 * @param {Array<Violation>} violations
 * @returns {string}
 */
function formatJson(violations) {
  if (!violations || violations.length === 0) return '';
  return violations.map(v => JSON.stringify(v)).join('\n');
}

/**
 * Returns a one-line summary suitable for end-of-run output.
 * @param {Array<Violation>} violations
 * @param {number} fileCount
 * @returns {string}
 */
function summaryLine(violations, fileCount) {
  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;
  return `Linted ${fileCount} file(s): ${errors} error(s), ${warnings} warning(s)`;
}

module.exports = { formatHuman, formatJson, summaryLine };
