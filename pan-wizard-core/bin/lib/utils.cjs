/**
 * Utils — Shared utility functions used across multiple modules
 *
 * Functions here were previously duplicated in core.cjs, commands.cjs,
 * state.cjs, and phase.cjs. Now centralized for single-source-of-truth.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PHASES_DIR,
  MILESTONES_DIR,
  isPlanFile,
  isSummaryFile,
  PHASE_DIR_RE,
} = require('./constants.cjs');
const { planningRootRel, planningRootAbs } = require('./planning-root.cjs');

// ─── File utilities ──────────────────────────────────────────────────────────

/**
 * Read and parse a JSON file, returning null on any failure.
 * @param {string} filePath - Absolute path to the JSON file
 * @returns {Object|null} Parsed JSON object, or null if unreadable/unparseable
 */
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Remove surrounding quotes (single or double) from a string.
 * @param {string} str - Input string possibly wrapped in quotes
 * @returns {string} String with leading/trailing quotes removed
 */
function removeQuotes(str) {
  return str.replace(/^["']|["']$/g, '');
}

/**
 * Today (or d) as YYYY-MM-DD on the local clock. `toISOString()` gives the UTC
 * day, which is still yesterday just after midnight east of Greenwich, so a phase
 * finished at 00:30 in Johannesburg was recorded as done the day before (PAN-06).
 * @param {Date} [d] - The moment (default: now)
 * @returns {string} e.g. "2026-11-05"
 */
function localDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Phase directory utilities ───────────────────────────────────────────────

/**
 * Build an absolute path inside the ACTIVE planning root.
 *
 * The root is `.planning/` by default but may be a track (`--track verify`) or
 * any project-relative tree (`--planning-dir`). Every absolute planning path in
 * the codebase goes through here, which is what makes a non-default root
 * reachable at all — see planning-root.cjs.
 *
 * @param {string} cwd - Project root directory
 * @param {...string} segments - Path segments below the planning root
 * @returns {string} Absolute path
 */
function planningPath(cwd, ...segments) {
  return path.join(planningRootAbs(cwd), ...segments.filter(s => s != null && s !== ''));
}

/**
 * Build a project-relative, POSIX-separated path inside the active planning
 * root — the display form used in command output, findings, and `git add`
 * arguments. Kept in lockstep with planningPath() so what a command reports is
 * the tree it actually touched.
 *
 * @param {...string} segments - Path segments below the planning root
 * @returns {string} e.g. `.planning/tracks/verify/state.md`
 */
function planningRel(...segments) {
  const parts = [planningRootRel()];
  for (const s of segments) {
    if (s == null || s === '') continue;
    for (const seg of String(s).split(/[\\/]+/)) {
      if (seg && seg !== '.') parts.push(seg);
    }
  }
  return parts.join('/');
}

/**
 * Build the absolute path to the phases directory of the active planning root.
 * @param {string} cwd - Project root directory
 * @returns {string} Absolute path to <planning-root>/phases/
 */
function phasesPath(cwd) {
  return planningPath(cwd, PHASES_DIR);
}

/**
 * Build the absolute path to the milestones directory of the active planning root.
 * @param {string} cwd - Project root directory
 * @returns {string} Absolute path to <planning-root>/milestones/
 */
function milestonesPath(cwd) {
  return planningPath(cwd, MILESTONES_DIR);
}

/**
 * Read phase directories from the phases folder, sorted by phase number.
 * @param {string} cwd - Project root directory
 * @returns {string[]} Sorted array of directory names, or empty array on failure
 */
function listPhaseDirs(cwd) {
  const { comparePhaseNum } = require('./core.cjs');
  try {
    const entries = fs.readdirSync(phasesPath(cwd), { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => comparePhaseNum(a, b));
  } catch {
    return [];
  }
}

/**
 * Filter an array of filenames to only plan files, sorted.
 * @param {string[]} files - Array of filenames
 * @returns {string[]} Sorted plan filenames
 */
function filterPlanFiles(files) {
  return files.filter(isPlanFile).sort();
}

/**
 * Filter an array of filenames to only summary files, sorted.
 * @param {string[]} files - Array of filenames
 * @returns {string[]} Sorted summary filenames
 */
function filterSummaryFiles(files) {
  return files.filter(isSummaryFile).sort();
}

/**
 * Extract the phase number and name from a phase directory name.
 * e.g. "01-setup-auth" → { number: "01", name: "setup-auth" }
 * @param {string} dirName - Phase directory name
 * @returns {{ number: string, name: string|null }} Parsed phase info
 */
function parsePhaseDir(dirName) {
  const match = dirName.match(PHASE_DIR_RE);
  if (!match) return { number: dirName, name: null };
  return {
    number: match[1],
    name: match[2] || null,
  };
}

/**
 * Classify phase status from file counts. Returns a granular status string.
 * @param {number} planCount - Number of plan files
 * @param {number} summaryCount - Number of summary files
 * @param {{hasContext?: boolean, hasResearch?: boolean}} [flags] - Extra file flags
 * @returns {string} One of: 'complete', 'partial', 'planned', 'researched', 'discussed', 'empty'
 */
function classifyPhaseStatus(planCount, summaryCount, flags = {}) {
  if (summaryCount >= planCount && planCount > 0) return 'complete';
  if (summaryCount > 0) return 'partial';
  if (planCount > 0) return 'planned';
  if (flags.hasResearch) return 'researched';
  if (flags.hasContext) return 'discussed';
  return 'empty';
}

/**
 * Check if a file is accessible (exists and is readable).
 * @param {string} filePath - Absolute path to check
 * @returns {boolean}
 */
function fileAccessible(filePath) {
  try { fs.accessSync(filePath, fs.constants.R_OK); return true; } catch { return false; }
}

/**
 * Detect whether Brave Search API key is available (env var or key file).
 * @returns {boolean}
 */
function hasBraveSearchKey() {
  if (process.env.BRAVE_API_KEY) return true;
  return fileAccessible(path.join(os.homedir(), '.pan-wizard', 'brave_api_key'));
}

/**
 * Which workflow model a planning tree runs (PLANNING_MODEL_MARKERS). The phase model
 * wins when its markers are present, since a phase project may also hold focus
 * artifacts; `fragment` means entries exist but none of them mark a deliberate
 * workflow, and `absent` that the directory could not be read.
 *
 * @param {string} planningDir - absolute path to the tree (e.g. planningPath(cwd))
 * @returns {{model: 'phase'|'focus'|'campaign'|'fragment'|'empty'|'absent', evidence: string[], entries: number}}
 */
function detectPlanningModel(planningDir) {
  const { PLANNING_MODEL_MARKERS } = require('./constants.cjs');
  let entries;
  try { entries = fs.readdirSync(planningDir); } catch { return { model: 'absent', evidence: [], entries: 0 }; }
  const lower = new Set(entries.map(e => String(e).toLowerCase()));
  for (const model of ['phase', 'focus', 'campaign']) {
    const evidence = PLANNING_MODEL_MARKERS[model].filter(m => lower.has(m));
    if (evidence.length) return { model, evidence, entries: entries.length };
  }
  return { model: entries.length ? 'fragment' : 'empty', evidence: [], entries: entries.length };
}

/**
 * The next quick-task number: one more than the highest `<n>-` directory under
 * .planning/quick/, or 1. `/pan:quick` (through `init quick`) and focus cycles
 * (`focus open`) share it, so the two never pick the same number.
 * @param {string} cwd - Project root
 * @returns {number}
 */
/**
 * A plan's task count: its XML <task> elements (the current format), else its
 * legacy "## Task N" headings. phase-plan-index and the step journal share it, so
 * task-N in a journal is the N-th task the executor was given.
 */
function countPlanTasks(content) {
  const text = String(content || '');
  return (text.match(/<task\b/gi) || []).length || (text.match(/##\s*Task\s*\d+/gi) || []).length;
}

function nextQuickNum(cwd) {
  const { QUICK_DIR } = require('./constants.cjs');
  try {
    const nums = fs.readdirSync(planningPath(cwd, QUICK_DIR))
      .filter(entry => /^\d+-/.test(entry))
      .map(entry => parseInt(entry.split('-')[0], 10))
      .filter(num => !isNaN(num));
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
  } catch {
    return 1; // no quick directory yet
  }
}

// ─── Roadmap fields, markdown tables, path-like values (3.42.0 Stage B) ──────

function escapeLabel(label) {
  return String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A line that starts a new block: a heading, a `**Label**` line, a rule, a table, a comment. */
const BLOCK_START_RE = /^\s*(?:#{1,6}\s|(?:[-*+]\s+)?\*\*[^*\n]+\*\*|-{3,}\s*$|\||<!--)/;
const LIST_ITEM_RE = /^\s*(\d+[.)]|[-*+])\s+(.*)$/;

/**
 * A `**Label:**` (or `**Label**:`) field's value from a roadmap section, joined
 * across wrapped lines. The value runs from after the label to the next blank
 * line, list item, heading or `**Other**` line. The single-line regex this
 * replaces cut a wrapped goal at its first newline (PAN-15).
 * @param {string} section - markdown text (LF or CRLF)
 * @param {string} label - e.g. 'Goal'
 * @returns {string|null}
 */
function extractField(section, label) {
  const lines = String(section || '').replace(/\r\n?/g, '\n').split('\n');
  const re = new RegExp(`\\*\\*${escapeLabel(label)}(?::\\*\\*|\\*\\*:)[ \\t]*(.*)$`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const parts = m[1].trim() ? [m[1].trim()] : [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) { if (parts.length) break; continue; }
      if (BLOCK_START_RE.test(line) || LIST_ITEM_RE.test(line)) break;
      parts.push(line.trim());
    }
    const value = parts.join(' ').replace(/\s+/g, ' ').trim();
    return value || null;
  }
  return null;
}

/**
 * The items of a `**Success Criteria**` block: numbered (`1.` / `1)`) or bulleted
 * (`-`, `*`, `+`) items, an indented line joining the item above it. The block
 * ends at a blank line not followed by another item, a heading, a `**Other**`
 * line, or an unindented non-item line (PAN-15).
 * @param {string} section - markdown text (LF or CRLF)
 * @param {string} [label] - defaults to 'Success Criteria'
 * @returns {string[]}
 */
function extractListField(section, label = 'Success Criteria') {
  const lines = String(section || '').replace(/\r\n?/g, '\n').split('\n');
  const re = new RegExp(`\\*\\*${escapeLabel(label)}(?::\\*\\*|\\*\\*)`, 'i');
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return [];
  const items = [];
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim()) {
      // A loose list keeps going; anything else after a blank line ends the block.
      if (!items.length) continue;
      const next = lines.slice(j + 1).find((l) => l.trim());
      if (next !== undefined && LIST_ITEM_RE.test(next)) continue;
      break;
    }
    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      items.push(item[2].replace(/^\[[ xX]\]\s*/, '').trim());
      continue;
    }
    if (BLOCK_START_RE.test(line)) break;
    if (items.length && /^\s+\S/.test(line)) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`.trim();
      continue;
    }
    break;
  }
  return items.filter(Boolean);
}

/** A table row's cells, without the outer pipes. `\|` is not a separator. */
function splitTableRow(line) {
  const body = String(line).replace(/\r$/, '').trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.trim());
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Every pipe table in a markdown text that has a header row and a separator.
 * Line indexes are 0-based into text.split('\n').
 * @param {string} text
 * @returns {Array<{header_line: number, headers: string[], rows: Array<{line: number, cells: string[]}>}>}
 */
function readMarkdownTables(text) {
  const lines = String(text || '').split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !TABLE_SEPARATOR_RE.test(lines[i + 1].replace(/\r$/, ''))) continue;
    const table = { header_line: i, headers: splitTableRow(lines[i]).map((h) => h.replace(/[*_`]+/g, '').trim()), rows: [] };
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) table.rows.push({ line: j, cells: splitTableRow(lines[j]) });
    tables.push(table);
    i = j - 1;
  }
  return tables;
}

/** A cell's text without markdown emphasis or code ticks. */
function tableCellText(cell) {
  return String(cell == null ? '' : cell).replace(/[*_`]+/g, '').trim();
}

/**
 * Replace one cell's text in a table row line, keeping the cell's padding
 * (its width when the new text fits) and the line's ending.
 * @param {string} line - the row line
 * @param {number} col - 0-based column
 * @param {string} text - the new cell text
 * @returns {string} the line, unchanged when the column does not exist
 */
function replaceTableCell(line, col, text) {
  const cr = /\r$/.test(line) ? '\r' : '';
  const body = cr ? line.slice(0, -1) : line;
  const pipes = [];
  for (let k = 0; k < body.length; k++) if (body[k] === '|' && body[k - 1] !== '\\') pipes.push(k);
  const leading = /^\s*\|/.test(body);
  const startIdx = leading ? pipes[col] : (col === 0 ? -1 : pipes[col - 1]);
  let endIdx = leading ? pipes[col + 1] : pipes[col];
  if (startIdx === undefined) return line;
  if (endIdx === undefined) {
    // A row without a closing pipe: its last cell runs to the end of the line.
    if (body.slice(startIdx + 1).trim() === '') return line;
    endIdx = body.length;
  }
  const inner = body.slice(startIdx + 1, endIdx);
  const lead = (inner.match(/^\s*/) || [''])[0];
  const trail = (inner.match(/\s*$/) || [''])[0];
  let next = lead + text;
  const minTrail = trail.length ? 1 : 0;
  next = next.length + minTrail <= inner.length ? next.padEnd(inner.length) : next + (minTrail ? ' ' : '');
  return body.slice(0, startIdx + 1) + next + body.slice(endIdx) + cr;
}

/**
 * Whether a must_haves value names a file rather than describing one in prose:
 * it has a path separator, or ends in a 1-8 character extension, and has no
 * space unless it also has a separator. "the checkout flow" is prose, so it is
 * not read as a file (PAN-09).
 * @param {*} v
 * @returns {boolean}
 */
function isPathLike(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  const sep = /[\\/]/.test(s);
  if (/\s/.test(s) && !sep) return false;
  return sep || /\.[A-Za-z0-9]{1,8}$/.test(s);
}

module.exports = {
  countPlanTasks,
  localDay,
  readJsonFile,
  removeQuotes,
  planningPath,
  nextQuickNum,
  detectPlanningModel,
  planningRel,
  phasesPath,
  milestonesPath,
  listPhaseDirs,
  filterPlanFiles,
  filterSummaryFiles,
  parsePhaseDir,
  classifyPhaseStatus,
  fileAccessible,
  hasBraveSearchKey,
  extractField,
  extractListField,
  readMarkdownTables,
  splitTableRow,
  tableCellText,
  replaceTableCell,
  isPathLike,
};
