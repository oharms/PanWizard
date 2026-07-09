'use strict';
/**
 * doc-lint.cjs — markdown frontmatter linter for PAN's own files.
 *
 * Vendored from whooo (https://github.com/oharms/PanWizard experiments/whooo).
 * Wraps doc-lint/{frontmatter,schema,validate,walk,reporter}.js with PAN's
 * core.cjs output() pattern.
 *
 * Spec: docs/specs/self_improvement_loop_featureai.md (whooo experiment outputs)
 * Pattern source: P-201 + P-202 + P-301 (promoted from whooo run, v3.7.0)
 *
 * Usage (CLI):
 *   pan-tools doc-lint <dir> [--schema <path>] [--format json|human] [--strict]
 *
 * Default schema: pan-wizard-core/references/schemas/pan-command.schema.yml
 */

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');

const { parseFrontmatter } = require('./doc-lint/frontmatter.js');
const { parseSchema } = require('./doc-lint/schema.js');
const { validateAgainstSchema } = require('./doc-lint/validate.js');
const { walkMarkdownFiles } = require('./doc-lint/walk.js');
const { formatHuman, formatJson, summaryLine } = require('./doc-lint/reporter.js');

const DEFAULT_SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'references',
  'schemas',
  'pan-command.schema.yml'
);

/**
 * Lint a directory of markdown files against a schema.
 * @param {string} cwd - working directory (used to resolve relative paths)
 * @param {string} dir - directory to scan (relative to cwd or absolute)
 * @param {object} opts - { schema: string, format: 'json'|'human', strict: bool, exclude: string[], raw: bool }
 * @returns {void} — writes to stdout via output(); exit code via process.exit
 */
function cmdDocLint(cwd, dir, opts = {}) {
  const targetDir = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
  if (!fs.existsSync(targetDir)) {
    error(`directory not found: ${targetDir}`);
  }

  const schemaPath = opts.schema
    ? (path.isAbsolute(opts.schema) ? opts.schema : path.join(cwd, opts.schema))
    : DEFAULT_SCHEMA_PATH;
  if (!fs.existsSync(schemaPath)) {
    error(`schema not found: ${schemaPath}`);
  }

  const schemaText = fs.readFileSync(schemaPath, 'utf-8');
  const { schema, errors: schemaErrors } = parseSchema(schemaText);
  if (schemaErrors.length > 0) {
    if (opts.raw) {
      process.stderr.write(`schema has ${schemaErrors.length} error(s):\n`);
      for (const e of schemaErrors) {
        process.stderr.write(`  ${schemaPath}:${e.line} — ${e.message}\n`);
      }
    } else {
      output({ schema_errors: schemaErrors, schema: schemaPath }, false);
    }
    process.exit(2);
  }

  const exclude = opts.exclude || [];
  const files = walkMarkdownFiles(targetDir, { exclude });
  const violations = [];
  for (const file of files) {
    if (file.readError) {
      violations.push({
        file: file.relativePath,
        line: 1, field: null,
        code: 'file-read-error',
        message: file.readError,
        severity: 'error',
      });
      continue;
    }
    const fm = parseFrontmatter(file.content);
    const v = validateAgainstSchema(fm, schema, file.relativePath, { strict: !!opts.strict });
    violations.push(...v);
  }

  const fileCount = files.length;
  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;

  const format = opts.format || 'human';
  if (opts.raw) {
    if (format === 'json') {
      const txt = formatJson(violations);
      if (txt) process.stdout.write(txt + '\n');
    } else {
      const txt = formatHuman(violations);
      if (txt) process.stdout.write(txt + '\n');
      process.stdout.write(summaryLine(violations, fileCount) + '\n');
    }
  } else {
    output({
      directory: dir,
      schema: schemaPath,
      file_count: fileCount,
      error_count: errorCount,
      warning_count: warningCount,
      violations,
    }, false);
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

/**
 * Validate that a schema file is well-formed.
 */
function cmdDocLintSchemaCheck(cwd, schemaPath, opts = {}) {
  const resolved = path.isAbsolute(schemaPath) ? schemaPath : path.join(cwd, schemaPath);
  if (!fs.existsSync(resolved)) {
    error(`schema not found: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, 'utf-8');
  const { errors } = parseSchema(text);
  const result = {
    schema: resolved,
    ok: errors.length === 0,
    error_count: errors.length,
    errors,
  };
  output(result, opts.raw);
  process.exit(result.ok ? 0 : 1);
}

// ─── Count-drift lint (IMPROVEMENT-TODO P1, v3.7.10) ────────────────────────
//
// Counts (tests, commands, agents, modules, etc.) are supposed to live ONLY
// in CLAUDE.md. Other docs MUST NOT embed them — they drift instantly. This
// linter scans markdown files and flags any drift-prone numeric count it
// finds outside the allowed paths.

// Negative lookbehind `(?<!\.)` excludes version-number captures like
// "v3.5 module" or "v4.7 Commands" — these are version refs, not counts.
const COUNT_PATTERNS = [
  // "52 commands", "21 agents", "30 modules", "2667 tests", etc.
  // Word boundaries + allowed plurals; case-insensitive matching.
  { re: /(?<!\.)\b(\d+)\s+(commands?|agents?|modules?|workflows?|templates?|references?|specs?|adrs?|test\s+files?|test\s+suites?)\b/gi,
    label: 'noun-phrase count' },
  // "27th module", "21st agent", "52nd command" — drift-prone ordinals
  { re: /(?<!\.)\b(\d+)(th|st|nd|rd)\s+(module|reference|agent|command|template|hook|workflow|spec|adr)\b/gi,
    label: 'ordinal' },
  // "(9 files)", "(58 tests)" — parenthetical counts
  { re: /(?<!\.)\((\d+)\s+(files?|tests?)\)/gi, label: 'parenthetical count' },
];

// Files where counts ARE allowed:
//   - CLAUDE.md (the SSoT)
//   - CHANGELOG.md (frozen historical record)
//   - MEMORY.md (user memory file, not shipped)
//   - SKILLS-FULL-TEXT.md / SKILLS-REFERENCE.md (auto-generated; embed command
//     prompt text that itself may legitimately reference numbers)
//   - EXAMPLES.md (illustrative tool-output scenarios, not authoritative claims)
const COUNT_ALLOWED_RE = /(^|[\\/])(CLAUDE\.md|CHANGELOG\.md|MEMORY\.md|SKILLS-FULL-TEXT\.md|SKILLS-REFERENCE\.md|EXAMPLES\.md)$/i;

// Path SEGMENTS that mark a directory as count-allowed (frozen historical
// content). Matched as path segments so they catch both project-root-relative
// paths (e.g. "docs/decisions/X.md") and scan-root-relative paths (e.g.
// "decisions/X.md" when the scan rooted at docs/).
const COUNT_ALLOWED_DIR_SEGMENTS = [
  'decisions',  // ADRs — frozen
  'specs',      // feature specs — frozen
  'experiments', // harvested experiment artifacts
  'learnings',  // AI-derived patterns; evidence quotes reference numbers
  'archive',    // archived old docs
];

function isCountAllowed(relativePath) {
  if (COUNT_ALLOWED_RE.test(relativePath)) return true;
  const norm = relativePath.replace(/\\/g, '/');
  const segments = norm.split('/');
  return segments.some(seg => COUNT_ALLOWED_DIR_SEGMENTS.includes(seg));
}

// Things that LOOK like counts but are stable identities (allowed everywhere):
const STABLE_IDENTITIES = [
  /\b5\s+(target\s+)?runtimes\b/i,                          // 5 target runtimes
  /\b5\s+hooks\b/i,                                          // 5 hooks (named individually)
  /\bLAYER\s+\d+\b/,                                         // architecture layer labels
  /\b5\s+(parallel\s+)?(researchers?|research\s+)/i,         // 5 parallel researchers
  /\b6\s+(parallel\s+)?agents\b/i,                           // 6 parallel agents (codebase mapper)
  /\b6\s+focus\s+areas\b/i,                                  // 6 focus areas (mapper)
  /\b4\s+parallel\s+research/i,                              // 4 parallel research
  /\bthree\s+phases\b|\bfour\s+phases\b/i,                   // generic phase counts in narrative
];

function isStableIdentity(matchText, surrounding) {
  for (const re of STABLE_IDENTITIES) {
    if (re.test(matchText) || re.test(surrounding)) return true;
  }
  return false;
}

/**
 * Scan a directory tree for drift-prone count violations.
 * @param {string} cwd - working directory
 * @param {string} dir - dir to scan (relative or absolute)
 * @param {object} opts - { format, raw, exclude }
 */
function cmdDocLintCounts(cwd, dir, opts = {}) {
  const targetDir = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
  if (!fs.existsSync(targetDir)) {
    error(`directory not found: ${targetDir}`);
  }

  const exclude = opts.exclude || [];
  const files = walkMarkdownFiles(targetDir, { exclude });
  const violations = [];

  for (const file of files) {
    if (isCountAllowed(file.relativePath)) continue;
    if (file.readError) continue;

    const lines = file.content.split(/\r?\n/);
    let inFence = false;  // track ```fenced``` code blocks; skip their content
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Toggle fence on lines starting with ```
      if (/^\s{0,3}```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      for (const { re, label } of COUNT_PATTERNS) {
        re.lastIndex = 0; // reset for /g
        let m;
        while ((m = re.exec(line)) !== null) {
          // Skip if this whole line is in a stable-identity surrounding
          if (isStableIdentity(m[0], line)) continue;
          violations.push({
            file: file.relativePath,
            line: i + 1,
            column: m.index + 1,
            match: m[0],
            label,
            severity: 'warning',
            message: `Drift-prone count "${m[0]}" outside CLAUDE.md. Counts live only in CLAUDE.md; replace with qualitative phrasing or remove.`,
          });
        }
      }
    }
  }

  const fileCount = files.length;
  const result = {
    directory: dir,
    file_count: fileCount,
    violation_count: violations.length,
    violations,
  };

  if (opts.raw) {
    if (violations.length === 0) {
      process.stdout.write(`OK — ${fileCount} files scanned, no count violations\n`);
    } else {
      for (const v of violations) {
        process.stdout.write(`${v.file}:${v.line}:${v.column} — ${v.match} (${v.label})\n`);
      }
      process.stdout.write(`\n${violations.length} violation(s) across ${fileCount} files\n`);
    }
  } else {
    output(result, false);
  }
  process.exit(violations.length > 0 ? 1 : 0);
}

module.exports = {
  cmdDocLint,
  cmdDocLintSchemaCheck,
  cmdDocLintCounts,
  isCountAllowed,
  COUNT_PATTERNS,
  DEFAULT_SCHEMA_PATH,
};
